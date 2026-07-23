// PhantomPlay Dioxus shell — Phase 3: a real, working native code editor for
// PhantomPlay game files, not a decorative splash screen.
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
use dioxus::prelude::*;
use std::fs;
use std::path::{Path, PathBuf};

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

fn main() {
    dioxus::launch(App);
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
}

#[component]
fn App() -> Element {
    let games = use_signal(list_games);
    let mut selected_game = use_signal(|| None::<usize>);
    let mut files = use_signal(Vec::<(PathBuf, String)>::new);
    let mut selected_file = use_signal(|| None::<usize>);
    let mut editor_content = use_signal(String::new);
    let mut status = use_signal(|| format!("{} game(s) found in {}", games().len(), games_dir().display()));
    let mut dirty = use_signal(|| false);

    let mut open_game = move |idx: usize| {
        selected_game.set(Some(idx));
        selected_file.set(None);
        editor_content.set(String::new());
        dirty.set(false);
        if let Some(game) = games().get(idx).cloned() {
            files.set(list_files(&game));
            status.set(format!("Opened {} — {} file(s)", game.id, files().len()));
        }
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

    let save_file = move |_| {
        if let Some(idx) = selected_file() {
            if let Some((path, _)) = files().get(idx).cloned() {
                match fs::write(&path, editor_content()) {
                    Ok(()) => {
                        dirty.set(false);
                        status.set(format!("Saved {} — reload the game in-browser to see it.", path.display()));
                    }
                    Err(err) => status.set(format!("Save failed for {}: {err}", path.display())),
                }
            }
        }
    };

    rsx! {
        style { {STYLE} }
        div { class: "shell",
            header {
                div { class: "brand", "PhantomPlay" }
                div { class: "badge", "NATIVE CODE EDITOR" }
            }
            div { class: "columns",
                nav { class: "games-pane",
                    h2 { "Games ({games().len()})" }
                    for (idx , game) in games().iter().cloned().enumerate() {
                        button {
                            class: if selected_game() == Some(idx) { "row is-active" } else { "row" },
                            onclick: move |_| open_game(idx),
                            "{game.id}"
                            if game.is_dir { span { class: "tag", "dir" } }
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
                        button {
                            class: "save-btn",
                            disabled: selected_file().is_none(),
                            onclick: save_file,
                            if dirty() { "Save*" } else { "Save" }
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
    .brand { font-weight: 900; font-size: 18px; color: #61ffb0; text-shadow: 0 0 18px #28ff8d55; }
    .badge {
        padding: 4px 10px;
        border: 1px solid #2cff9b55;
        border-radius: 999px;
        font: 900 10px ui-monospace, monospace;
        color: #7dffbd;
        letter-spacing: 0.06em;
    }
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
    .path { font: 12px ui-monospace, monospace; color: #8fb3a1; }
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
"#;
