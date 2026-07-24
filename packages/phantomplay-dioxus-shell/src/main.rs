// PhantomPlay Dioxus shell — the native PhantomPlay client: play games,
// edit their code, hot-reload while playing, ask AI to edit the open file,
// invite other devs into a voice+chat dev room, and quick-toggle mods.
//
// Why this shape, not a wrapper around the web app's existing 3-slot dev
// workbench: the reported complaint was specifically that the existing
// dev-mode editor (app/js/phantomplay.js's devWorkbenchMarkup) only exposes
// three fixed file slots (index.html/style.css/game.js) and breaks on
// anything else. This shell reads the real game directory straight off
// disk — every file, not a fixed slot count — and writes changes straight
// back to disk. Since the existing web server serves these files raw with
// no build step (confirmed in Phase 1 recon), a save here is visible on the
// next page load with no separate "dev override" indirection to desync.
//
// This intentionally does NOT go through the HTTP dev-mode override API
// (POST /api/phantomplay/dev-mode/:id/override) — that system is a
// per-workspace draft mechanism for ordinary (non-owner, non-local-checkout)
// users; this tool is for editing the actual repo you have open, which
// only makes sense for someone who already has the live checkout on disk.
// Nothing under app/ or server/ that this tool doesn't explicitly open and
// save is touched.
//
// Networking/AI baseline: the local Fastify API (server/src/index.ts) grew
// two additive routes for this shell — /ws/phantomplay/devroom/:code (a
// lightweight, code-based WebSocket room: presence/chat/WebRTC signaling/
// file-sync, no PhantomForce account required) and POST
// /api/phantomplay/ai-edit (spawns the same local Claude CLI already wired
// for Phantom Console, sized for full game files). Both are local-dev-only,
// not exposed on the public site, same trust model as this editor already
// writing straight to disk with no auth.
use dioxus::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

const PHANTOMPLAY_API_ORIGIN: &str = "http://127.0.0.1:5190";

fn phantomplay_live_root() -> PathBuf {
    std::env::var("PHANTOMPLAY_LIVE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(r"C:\Users\jorda\Documents\Codex\deployments\phantomforce-live")
        })
}

fn games_dir() -> PathBuf {
    phantomplay_live_root().join("app").join("games")
}

#[derive(Clone, PartialEq, Debug)]
struct GameEntry {
    id: String,
    path: PathBuf,
    is_dir: bool,
}

fn list_games() -> Vec<GameEntry> {
    let dir = games_dir();
    let mut games = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else {
        return games;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "shared" {
            continue; // cross-game utility folder, not a game itself
        }
        if path.is_dir() {
            games.push(GameEntry { id: name, path, is_dir: true });
        } else if path.extension().and_then(|e| e.to_str()) == Some("html") {
            let id = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
            games.push(GameEntry { id, path, is_dir: false });
        }
    }
    games.sort_by(|a, b| a.id.cmp(&b.id));
    games
}

fn list_files(game: &GameEntry) -> Vec<(PathBuf, String)> {
    let mut paths = if !game.is_dir {
        vec![game.path.clone()]
    } else {
        let mut out = Vec::new();
        walk_dir(&game.path, 0, &mut out);
        out.sort();
        out
    };
    paths.sort();
    paths
        .into_iter()
        .map(|path| {
            let label = relative_label(game, &path);
            (path, label)
        })
        .collect()
}

fn walk_dir(dir: &Path, depth: u8, out: &mut Vec<PathBuf>) {
    if depth > 5 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_dir(&path, depth + 1, out);
        } else {
            out.push(path);
        }
    }
}

fn relative_label(game: &GameEntry, file: &Path) -> String {
    if !game.is_dir {
        return file.file_name().unwrap_or_default().to_string_lossy().to_string();
    }
    file.strip_prefix(&game.path)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| file.to_string_lossy().to_string())
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

// ---- mods: quick-load menu (separate from Dev Mode) ------------------------

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
struct ModEntry {
    id: String,
    file: String,
    name: String,
    desc: String,
}

fn mods_manifest_path(game_id: &str) -> PathBuf {
    games_dir().join(game_id).join("mods").join("manifest.json")
}
fn mods_enabled_path(game_id: &str) -> PathBuf {
    games_dir().join(game_id).join("mods").join(".enabled.json")
}

fn read_mod_manifest(game_id: &str) -> Vec<ModEntry> {
    fs::read_to_string(mods_manifest_path(game_id))
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<ModEntry>>(&text).ok())
        .unwrap_or_default()
}

fn read_enabled_mods(game_id: &str) -> Vec<String> {
    fs::read_to_string(mods_enabled_path(game_id))
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
        .unwrap_or_default()
}

fn write_enabled_mods(game_id: &str, ids: &[String]) {
    let path = mods_enabled_path(game_id);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(ids) {
        let _ = fs::write(path, json);
    }
}

// ---- hot reload: watch the currently-open game's files, bump a counter ----
// the player's custom protocol handler serves at /__pm_version; the injected
// modLoader.js poll script reloads the page when it changes. ---------------

fn watch_for_hot_reload(target: PathBuf) -> Arc<AtomicU64> {
    let version = Arc::new(AtomicU64::new(0));
    let version_for_thread = version.clone();
    std::thread::spawn(move || {
        use notify::Watcher;
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(_) => return,
        };
        let mode = if target.is_dir() {
            notify::RecursiveMode::Recursive
        } else {
            notify::RecursiveMode::NonRecursive
        };
        if watcher.watch(&target, mode).is_err() {
            return;
        }
        for res in rx {
            if res.is_ok() {
                version_for_thread.fetch_add(1, Ordering::SeqCst);
            }
        }
    });
    version
}

/// Injects the shared mod loader + a hot-reload poll script into a served
/// game's HTML. Only happens through this shell's own custom-protocol player
/// — never touches the files on disk, and the public web app never sees it.
fn inject_dev_scripts(bytes: Vec<u8>, game_id: &str) -> Vec<u8> {
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    let injection = format!(
        r#"<script>document.documentElement.setAttribute("data-pm-game-id","{game_id}");</script>
<script src="/shared/modLoader.js"></script>
<script>
(function(){{
  var lastV = null;
  setInterval(function(){{
    fetch("/__pm_version").then(function(r){{return r.text();}}).then(function(v){{
      if (lastV !== null && v !== lastV) location.reload();
      lastV = v;
    }}).catch(function(){{}});
  }}, 700);
}})();
</script>
"#
    );
    if let Some(pos) = text.rfind("</body>") {
        text.insert_str(pos, &injection);
    } else {
        text.push_str(&injection);
    }
    text.into_bytes()
}

// ---- AI edit: "AI right inside the game" ------------------------------

#[derive(Serialize)]
struct AiEditRequestBody {
    #[serde(rename = "gameId")]
    game_id: String,
    #[serde(rename = "filePath")]
    file_path: String,
    #[serde(rename = "fileContent")]
    file_content: String,
    instruction: String,
    cwd: String,
}

#[derive(Deserialize, Default)]
struct AiEditResponseBody {
    ok: bool,
    #[serde(rename = "newContent")]
    new_content: Option<String>,
    error: Option<String>,
}

async fn request_ai_edit(game_id: String, file_path: String, file_content: String, instruction: String) -> Result<String, String> {
    let body = AiEditRequestBody {
        game_id,
        file_path,
        file_content,
        instruction,
        cwd: phantomplay_live_root().display().to_string(),
    };
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{PHANTOMPLAY_API_ORIGIN}/api/phantomplay/ai-edit"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the PhantomForce API on :5190 ({e}). Is it running?"))?;
    let parsed: AiEditResponseBody = resp.json().await.map_err(|e| format!("Bad response from AI edit endpoint: {e}"))?;
    if parsed.ok {
        parsed.new_content.ok_or_else(|| "AI edit endpoint said ok but returned no content.".to_string())
    } else {
        Err(parsed.error.unwrap_or_else(|| "AI edit failed for an unknown reason.".to_string()))
    }
}

fn main() {
    // Branding: this shell IS PhantomPlay to end users — no separate
    // "Dioxus" name/logo shown anywhere in the product surface (credit for
    // Dioxus and every other underlying technology belongs in posts/
    // sponsorships/credits, not the app chrome). Uses the real brand-phantom
    // ghost mark already shipped in the live web app's app/assets/, copied
    // into this package's own assets/ so it's embedded at compile time via
    // include_bytes! rather than depending on a sibling-directory path.
    let icon = dioxus::desktop::icon_from_memory(include_bytes!("../assets/brand-phantom.png")).ok();
    let window = dioxus::desktop::WindowBuilder::new().with_title("PhantomPlay");
    let mut config = dioxus::desktop::Config::new().with_window(window);
    if let Some(icon) = icon {
        config = config.with_icon(icon);
    }
    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_real_games_from_the_live_checkout() {
        let games = list_games();
        assert!(
            games.len() >= 20,
            "expected the real app/games directory to yield 20+ entries, got {} (root={})",
            games.len(),
            games_dir().display()
        );
        assert!(games.iter().any(|g| g.id == "neon-drift" && !g.is_dir), "neon-drift.html should be a single-file game");
        assert!(games.iter().any(|g| g.id == "phantom-pizzeria" && g.is_dir), "phantom-pizzeria should be a multi-file directory");
        assert!(!games.iter().any(|g| g.id == "shared"), "the shared/ utility folder must not be listed as a game");
    }

    #[test]
    fn multi_file_game_exposes_every_file_not_just_index() {
        let games = list_games();
        let pizzeria = games.iter().find(|g| g.id == "phantom-pizzeria").expect("phantom-pizzeria must exist in the real catalog");
        let files = list_files(pizzeria);
        let labels: Vec<&str> = files.iter().map(|(_, label)| label.as_str()).collect();
        assert!(labels.contains(&"index.html"), "labels={labels:?}");
        assert!(labels.contains(&"style.css"), "labels={labels:?}");
        assert!(labels.contains(&"game.js"), "labels={labels:?}");
        assert!(files.len() >= 3, "a multi-file game must expose all of its files, not a fixed 3-slot subset: {labels:?}");
    }

    #[test]
    fn single_file_game_exposes_exactly_itself() {
        let games = list_games();
        let neon_drift = games.iter().find(|g| g.id == "neon-drift").expect("neon-drift.html must exist");
        let files = list_files(neon_drift);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].1, "neon-drift.html");
    }

    /// Restores a file's original content on drop — including on panic — so a
    /// failed assertion can never leave the real repo file mutated.
    struct RestoreOnDrop {
        path: PathBuf,
        original: String,
    }
    impl Drop for RestoreOnDrop {
        fn drop(&mut self) {
            let _ = fs::write(&self.path, &self.original);
        }
    }

    #[test]
    fn save_and_reload_round_trips_through_the_real_file_on_disk() {
        let games = list_games();
        let pizzeria = games.iter().find(|g| g.id == "phantom-pizzeria").expect("phantom-pizzeria must exist");
        let files = list_files(pizzeria);
        let (game_js_path, _) = files.iter().find(|(_, label)| label == "game.js").expect("game.js must be listed");
        let original = fs::read_to_string(game_js_path).expect("must be able to read the real game.js");
        let _guard = RestoreOnDrop { path: game_js_path.clone(), original: original.clone() };
        let probe = format!("{original}\n// dioxus-shell-round-trip-test-marker\n");
        fs::write(game_js_path, &probe).expect("must be able to write the real game.js");
        let read_back = fs::read_to_string(game_js_path).expect("must be able to re-read after writing");
        assert_eq!(read_back, probe, "what was written must be exactly what gets read back — no dev/normal-mode-style indirection");
    }

    #[test]
    fn vespergate_mod_manifest_is_real_and_has_a_healthy_mod_count() {
        let mods = read_mod_manifest("vespergate");
        assert!(mods.len() >= 10 && mods.len() <= 15, "expected 10-15 flagship mods, got {}", mods.len());
        for m in &mods {
            let mod_path = games_dir().join("vespergate").join("mods").join(&m.file);
            assert!(mod_path.exists(), "manifest references {} but the file doesn't exist on disk", m.file);
        }
    }

    #[test]
    fn inject_dev_scripts_adds_mod_loader_and_hot_reload_poll() {
        let html = b"<html><body>hi</body></html>".to_vec();
        let out = String::from_utf8(inject_dev_scripts(html, "vespergate")).unwrap();
        assert!(out.contains("/shared/modLoader.js"));
        assert!(out.contains("/__pm_version"));
        assert!(out.contains("data-pm-game-id"));
    }
}

/// Standalone player window — this is what actually lets someone play a
/// PhantomPlay game with zero PhantomForce account/server dependency: the
/// iframe loads through a custom `phantomplay-game://` protocol whose
/// handler (registered per-window in `play_game`, below) reads real files
/// straight off `app/games/` — the same root the editor pane edits — and
/// injects the shared mod loader + a hot-reload poll script into HTML
/// responses so edits saved while playing show up live.
const PLAYER_STYLE: &str = "html,body,iframe{margin:0;height:100%;width:100%;border:0;background:#03110c;}";

#[component]
fn Player(entry: String) -> Element {
    // WebView2 on Windows serves custom protocols at http://<scheme>.localhost/
    // rather than <scheme>://host/ (which is what macOS/Linux webviews use) —
    // see wry's `with_https_scheme` docs. Windows-only for now; cross-platform
    // is real follow-up work, not silently assumed to already work elsewhere.
    #[cfg(target_os = "windows")]
    let src = format!("http://phantomplay-game.localhost/{entry}");
    #[cfg(not(target_os = "windows"))]
    let src = format!("phantomplay-game://localhost/{entry}");

    rsx! {
        style { {PLAYER_STYLE} }
        iframe { src: "{src}" }
    }
}

#[component]
fn DevRoomFrame() -> Element {
    #[cfg(target_os = "windows")]
    let src = "http://phantomplay-devroom.localhost/";
    #[cfg(not(target_os = "windows"))]
    let src = "phantomplay-devroom://localhost/";

    rsx! {
        style { {PLAYER_STYLE} }
        iframe { src: "{src}" }
    }
}

const DEVROOM_HTML: &str = include_str!("../assets/devroom.html");

#[component]
fn App() -> Element {
    let games = use_signal(list_games);
    let mut selected_game = use_signal(|| None::<usize>);
    let mut files = use_signal(Vec::<(PathBuf, String)>::new);
    let mut selected_file = use_signal(|| None::<usize>);
    let mut editor_content = use_signal(String::new);
    let mut status = use_signal(|| format!("{} game(s) found in {}", games().len(), games_dir().display()));
    let mut dirty = use_signal(|| false);

    // AI edit panel state.
    let mut ai_panel_open = use_signal(|| false);
    let mut ai_instruction = use_signal(String::new);
    let mut ai_busy = use_signal(|| false);

    // Mods quick-menu state (separate from the file editor / Dev Mode).
    let mut mods_panel_open = use_signal(|| false);
    let mut mods_game_id = use_signal(String::new);
    let mut mods_list = use_signal(Vec::<ModEntry>::new);
    let mut mods_enabled = use_signal(Vec::<String>::new);

    let mut open_game = move |idx: usize| {
        selected_game.set(Some(idx));
        selected_file.set(None);
        editor_content.set(String::new());
        dirty.set(false);
        ai_panel_open.set(false);
        if let Some(game) = games().get(idx).cloned() {
            files.set(list_files(&game));
            status.set(format!("Opened {} — {} file(s)", game.id, files().len()));
        }
    };

    let mut play_game = move |idx: usize| {
        let Some(game) = games().get(idx).cloned() else { return };
        let entry_name = if game.is_dir { format!("{}/index.html", game.id) } else { format!("{}.html", game.id) };
        let entry_check = if game.is_dir { game.path.join("index.html") } else { game.path.clone() };
        if !entry_check.exists() {
            status.set(format!("{} has no index.html to play.", game.id));
            return;
        }

        let root = games_dir();
        let game_id_for_handler = game.id.clone();
        let hot_reload_version = watch_for_hot_reload(game.path.clone());

        let handler = move |_id: dioxus::desktop::wry::WebViewId<'_>, request: dioxus::desktop::wry::http::Request<Vec<u8>>| {
            let uri_path = request.uri().path().trim_start_matches('/');
            if uri_path == "__pm_version" {
                let v = hot_reload_version.load(Ordering::SeqCst).to_string();
                return dioxus::desktop::wry::http::Response::builder()
                    .header("Content-Type", "text/plain; charset=utf-8")
                    .status(200)
                    .body(std::borrow::Cow::Owned(v.into_bytes()))
                    .unwrap();
            }
            let file_path = root.join(uri_path);
            match fs::read(&file_path) {
                Ok(bytes) => {
                    let content_type = mime_for(&file_path);
                    let body = if content_type.starts_with("text/html") {
                        inject_dev_scripts(bytes, &game_id_for_handler)
                    } else {
                        bytes
                    };
                    dioxus::desktop::wry::http::Response::builder()
                        .header("Content-Type", content_type)
                        .status(200)
                        .body(std::borrow::Cow::Owned(body))
                        .unwrap()
                }
                Err(_) => dioxus::desktop::wry::http::Response::builder()
                    .status(404)
                    .body(std::borrow::Cow::Borrowed(&b"not found"[..]))
                    .unwrap(),
            }
        };

        let window_cfg = dioxus::desktop::Config::new()
            .with_window(
                dioxus::desktop::WindowBuilder::new()
                    .with_title(format!("PhantomPlay — {}", game.id))
                    .with_inner_size(dioxus::desktop::LogicalSize::new(1000.0, 720.0)),
            )
            .with_custom_protocol("phantomplay-game", handler);

        let dom = VirtualDom::new_with_props(Player, PlayerProps { entry: entry_name });
        dioxus::desktop::window().new_window(dom, window_cfg);
        status.set(format!("Launched {} — hot reload + mods are live in this window.", game.id));
    };

    let open_dev_room = move |_| {
        let handler = move |_id: dioxus::desktop::wry::WebViewId<'_>, _request: dioxus::desktop::wry::http::Request<Vec<u8>>| {
            dioxus::desktop::wry::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .status(200)
                .body(std::borrow::Cow::Borrowed(DEVROOM_HTML.as_bytes()))
                .unwrap()
        };
        let window_cfg = dioxus::desktop::Config::new()
            .with_window(
                dioxus::desktop::WindowBuilder::new()
                    .with_title("PhantomPlay — Dev Room")
                    .with_inner_size(dioxus::desktop::LogicalSize::new(440.0, 640.0)),
            )
            .with_custom_protocol("phantomplay-devroom", handler);
        let dom = VirtualDom::new(DevRoomFrame);
        dioxus::desktop::window().new_window(dom, window_cfg);
    };

    let mut open_mods_panel = move |idx: usize| {
        let Some(game) = games().get(idx).cloned() else { return };
        mods_game_id.set(game.id.clone());
        mods_list.set(read_mod_manifest(&game.id));
        mods_enabled.set(read_enabled_mods(&game.id));
        mods_panel_open.set(true);
    };

    let mut toggle_mod = move |mod_id: String| {
        let mut current = mods_enabled();
        if current.contains(&mod_id) {
            current.retain(|id| id != &mod_id);
        } else {
            current.push(mod_id);
        }
        write_enabled_mods(&mods_game_id(), &current);
        mods_enabled.set(current);
    };

    let mut open_file = move |idx: usize| {
        if let Some((path, _)) = files().get(idx).cloned() {
            match fs::read_to_string(&path) {
                Ok(content) => {
                    editor_content.set(content);
                    selected_file.set(Some(idx));
                    dirty.set(false);
                    status.set(format!("Loaded {}", path.display()));
                }
                Err(err) => status.set(format!("Failed to read {}: {err}", path.display())),
            }
        }
    };

    use_effect(move || {
        if std::env::var("PHANTOMPLAY_AUTOPLAY_TEST").is_ok() {
            play_game(0);
        }
    });

    let save_file = move |_| {
        if let Some(idx) = selected_file() {
            if let Some((path, _)) = files().get(idx).cloned() {
                match fs::write(&path, editor_content()) {
                    Ok(()) => {
                        dirty.set(false);
                        status.set(format!("Saved {} — any open player window hot-reloads within a second.", path.display()));
                    }
                    Err(err) => status.set(format!("Save failed for {}: {err}", path.display())),
                }
            }
        }
    };

    let ask_ai = move |_| {
        let Some(game_idx) = selected_game() else { return };
        let Some(file_idx) = selected_file() else { return };
        let Some(game) = games().get(game_idx).cloned() else { return };
        let Some((_, file_label)) = files().get(file_idx).cloned() else { return };
        let instruction = ai_instruction();
        if instruction.trim().is_empty() {
            status.set("Type an instruction for the AI first.".into());
            return;
        }
        ai_busy.set(true);
        status.set("Asking AI to edit the file…".into());
        let content = editor_content();
        let mut editor_content = editor_content;
        let mut status = status;
        let mut ai_busy = ai_busy;
        let mut dirty = dirty;
        spawn(async move {
            match request_ai_edit(game.id.clone(), file_label.clone(), content, instruction).await {
                Ok(new_content) => {
                    editor_content.set(new_content.clone());
                    dirty.set(true);
                    if let Some(idx) = selected_file() {
                        if let Some((path, _)) = files().get(idx).cloned() {
                            match fs::write(&path, &new_content) {
                                Ok(()) => {
                                    dirty.set(false);
                                    status.set(format!("AI updated {} and saved it — hot reload will pick it up.", path.display()));
                                }
                                Err(err) => status.set(format!("AI edit produced new content but saving failed: {err}")),
                            }
                        }
                    }
                }
                Err(err) => status.set(format!("AI edit failed: {err}")),
            }
            ai_busy.set(false);
        });
    };

    rsx! {
        style { {STYLE} }
        div { class: "shell",
            header {
                img { class: "brand-ghost", src: asset!("/assets/brand-phantom.png"), alt: "" }
                div { class: "brand", "PhantomPlay" }
                div { class: "badge", "NATIVE" }
                div { class: "spacer" }
                button { class: "header-btn", onclick: open_dev_room, "👥 Dev Room" }
            }
            div { class: "columns",
                nav { class: "games-pane",
                    h2 { "Games ({games().len()})" }
                    for (idx , game) in games().iter().cloned().enumerate() {
                        div {
                            class: if selected_game() == Some(idx) { "row is-active" } else { "row" },
                            span { class: "row-label", onclick: move |_| open_game(idx),
                                "{game.id}"
                                if game.is_dir { span { class: "tag", "dir" } }
                            }
                            button { class: "mods-btn", onclick: move |_| open_mods_panel(idx), title: "Quick-load mods", "🧩" }
                            button { class: "play-btn", onclick: move |_| play_game(idx), title: "Play standalone — no account, no server", "▶" }
                        }
                    }
                }
                nav { class: "files-pane",
                    h2 { "Files" }
                    for (idx , entry) in files().iter().cloned().enumerate() {
                        button {
                            class: if selected_file() == Some(idx) { "row is-active" } else { "row" },
                            onclick: move |_| open_file(idx),
                            "{entry.1}"
                        }
                    }
                }
                main { class: "editor-pane",
                    div { class: "editor-toolbar",
                        span { class: "path",
                            {selected_file().and_then(|i| files().get(i).map(|(p, _)| p.display().to_string())).unwrap_or_else(|| "No file open".into())}
                        }
                        div { class: "toolbar-actions",
                            button {
                                class: "ai-btn",
                                disabled: selected_file().is_none(),
                                onclick: move |_| ai_panel_open.set(!ai_panel_open()),
                                "✨ AI Assist"
                            }
                            button {
                                class: "save-btn",
                                disabled: selected_file().is_none(),
                                onclick: save_file,
                                if dirty() { "Save*" } else { "Save" }
                            }
                        }
                    }
                    if ai_panel_open() {
                        div { class: "ai-panel",
                            textarea {
                                class: "ai-instruction",
                                placeholder: "Tell the AI what to change in this file…",
                                value: "{ai_instruction}",
                                oninput: move |evt| ai_instruction.set(evt.value()),
                            }
                            button {
                                class: "ai-go-btn",
                                disabled: ai_busy(),
                                onclick: ask_ai,
                                if ai_busy() { "Thinking…" } else { "Apply with AI" }
                            }
                        }
                    }
                    textarea {
                        class: "editor",
                        spellcheck: false,
                        value: "{editor_content}",
                        oninput: move |evt| {
                            editor_content.set(evt.value());
                            dirty.set(true);
                        },
                    }
                }
            }
            footer { "{status}" }
        }
        if mods_panel_open() {
            div { class: "mods-overlay", onclick: move |_| mods_panel_open.set(false),
                div { class: "mods-panel", onclick: move |evt| evt.stop_propagation(),
                    div { class: "mods-panel-header",
                        span { "Mods — {mods_game_id}" }
                        button { class: "mods-close", onclick: move |_| mods_panel_open.set(false), "✕" }
                    }
                    if mods_list().is_empty() {
                        div { class: "mods-empty",
                            "No pre-built mods for this game yet. Universal mods (slow-mo, CRT filter, mute, zoom, big cursor) are always available in-game via the F10 overlay."
                        }
                    }
                    for m in mods_list().iter().cloned() {
                        label { class: "mod-row",
                            input {
                                r#type: "checkbox",
                                checked: mods_enabled().contains(&m.id),
                                onchange: move |_| toggle_mod(m.id.clone()),
                            }
                            div { class: "mod-copy",
                                div { class: "mod-name", "{m.name}" }
                                div { class: "mod-desc", "{m.desc}" }
                            }
                        }
                    }
                    div { class: "mods-hint", "Selections here seed the F10 in-game mod menu on next launch." }
                }
            }
        }
    }
}

const STYLE: &str = r#"
    html, body { margin: 0; height: 100%; }
    * { box-sizing: border-box; }
    .shell {
        height: 100vh;
        display: flex;
        flex-direction: column;
        font-family: system-ui, sans-serif;
        color: #eafff3;
        background: #03110c;
    }
    header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        background: #020b08;
        border-bottom: 1px solid #143324;
    }
    .brand-ghost { width: 22px; height: 22px; filter: drop-shadow(0 0 6px #28ff8d88); }
    .brand { font-weight: 900; font-size: 18px; color: #61ffb0; text-shadow: 0 0 18px #28ff8d55; }
    .badge {
        padding: 4px 10px;
        border: 1px solid #2cff9b55;
        border-radius: 999px;
        font: 900 10px ui-monospace, monospace;
        color: #7dffbd;
        letter-spacing: 0.06em;
    }
    .spacer { flex: 1; }
    .header-btn {
        border: 1px solid #2cff9b55;
        border-radius: 999px;
        background: #0c2318;
        color: #7dffbd;
        font: 700 12px ui-monospace, monospace;
        padding: 6px 14px;
        cursor: pointer;
    }
    .header-btn:hover { background: #14432c; color: #b7ffd6; }
    .columns { flex: 1; display: flex; min-height: 0; }
    .games-pane, .files-pane {
        width: 220px;
        overflow-y: auto;
        border-right: 1px solid #143324;
        padding: 10px;
    }
    .editor-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b8577; margin: 4px 6px 8px; }
    .row {
        display: block;
        width: 100%;
        text-align: left;
        padding: 7px 9px;
        margin-bottom: 2px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #cfe9dc;
        font-size: 13px;
        cursor: pointer;
    }
    .row:hover { background: #0c2318; }
    .row.is-active { background: #14432c; color: #b7ffd6; }
    .games-pane .row { display: flex; align-items: center; justify-content: space-between; gap: 4px; cursor: default; padding: 4px 4px 4px 9px; }
    .row-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; padding: 3px 0; }
    .play-btn, .mods-btn {
        flex-shrink: 0;
        border: 1px solid #2cff9b55;
        border-radius: 6px;
        background: #0c2318;
        color: #7dffbd;
        font-size: 11px;
        padding: 3px 8px;
        cursor: pointer;
    }
    .play-btn:hover, .mods-btn:hover { background: #14432c; color: #b7ffd6; }
    .tag {
        float: right;
        font-size: 9px;
        padding: 1px 6px;
        border-radius: 999px;
        border: 1px solid #2cff9b44;
        color: #7dffbd;
    }
    .editor-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: #020b08;
        border-bottom: 1px solid #143324;
    }
    .toolbar-actions { display: flex; gap: 8px; }
    .path { font: 12px ui-monospace, monospace; color: #8fb3a1; }
    .ai-btn {
        border: 1px solid #b98cff66;
        border-radius: 999px;
        background: #1c1330;
        color: #d9c2ff;
        font-weight: 700;
        padding: 6px 14px;
        cursor: pointer;
    }
    .ai-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .save-btn {
        border: 0;
        border-radius: 999px;
        background: #4bffa3;
        color: #021109;
        font-weight: 900;
        padding: 6px 16px;
        cursor: pointer;
    }
    .save-btn:disabled { background: #2a3b32; color: #6b8577; cursor: not-allowed; }
    .ai-panel {
        display: flex;
        gap: 8px;
        padding: 10px 12px;
        background: #0c0818;
        border-bottom: 1px solid #2a1f45;
    }
    .ai-instruction {
        flex: 1;
        min-height: 44px;
        resize: vertical;
        border-radius: 8px;
        border: 1px solid #3a2a5c;
        background: #150f24;
        color: #eafff3;
        font: 12px ui-monospace, monospace;
        padding: 8px;
    }
    .ai-go-btn {
        border: 0;
        border-radius: 8px;
        background: #b98cff;
        color: #170b2a;
        font-weight: 900;
        padding: 0 16px;
        cursor: pointer;
    }
    .ai-go-btn:disabled { background: #4a3d63; color: #8a7fa3; cursor: not-allowed; }
    .editor {
        flex: 1;
        border: 0;
        outline: none;
        resize: none;
        padding: 14px;
        background: #030f0a;
        color: #eafff3;
        font: 13px ui-monospace, monospace;
        line-height: 1.5;
    }
    footer {
        padding: 6px 14px;
        background: #020b08;
        border-top: 1px solid #143324;
        font: 11px ui-monospace, monospace;
        color: #6b8577;
    }
    .mods-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.55);
        display: flex; align-items: center; justify-content: center; z-index: 50;
    }
    .mods-panel {
        width: 360px; max-height: 70vh; overflow-y: auto;
        background: #061a12; border: 1px solid #2cff9b44; border-radius: 12px;
        padding: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .mods-panel-header {
        display: flex; justify-content: space-between; align-items: center;
        font-weight: 900; color: #7dffbd; margin-bottom: 10px;
    }
    .mods-close { border: 0; background: none; color: #7dffbd; cursor: pointer; font-size: 14px; }
    .mods-empty { color: #8fb3a1; font-size: 12px; line-height: 1.5; }
    .mod-row { display: flex; gap: 10px; align-items: flex-start; padding: 8px 4px; cursor: pointer; }
    .mod-row:hover { background: #0c2318; border-radius: 6px; }
    .mod-name { font-weight: 700; font-size: 13px; color: #eafff3; }
    .mod-desc { font-size: 11px; color: #8fb3a1; }
    .mods-hint { margin-top: 10px; font-size: 10px; color: #6b8577; }
"#;
