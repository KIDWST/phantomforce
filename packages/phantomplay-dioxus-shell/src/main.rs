// PhantomPlay is the native play-and-build client: games, source editing,
// hot reload, AI-assisted changes, collaborative dev rooms, and mods live
// together in one window.
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
use base64::Engine;
use dioxus::prelude::*;
use dioxus_icons::lucide as studio_icons;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

mod project_history;
mod studio;

const PHANTOMPLAY_API_ORIGIN: &str = "http://127.0.0.1:5190";
const FLAGSHIP_UNREAL_GAME_IDS: [&str; 3] = ["phantom-strike", "phantom-ages", "phantom-legends"];
const PHANTOMFORGE_UNREAL_GAME_IDS: [&str; 4] = [
    "phantom-strike",
    "phantom-ages",
    "phantom-legends",
    "cubetown",
];
const PHANTOMPLAY_INDEX: &str = r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PhantomPlay</title>
</head>
<body>
  <div id="main" aria-label="PhantomPlay"></div>
</body>
</html>"#;

fn brand_data_uri() -> &'static str {
    static BRAND_URI: OnceLock<String> = OnceLock::new();
    BRAND_URI
        .get_or_init(|| {
            let encoded = base64::engine::general_purpose::STANDARD
                .encode(include_bytes!("../assets/brand-phantom.png"));
            format!("data:image/png;base64,{encoded}")
        })
        .as_str()
}

fn phantomplay_api_origin() -> String {
    std::env::var("PHANTOMPLAY_API_ORIGIN")
        .unwrap_or_else(|_| PHANTOMPLAY_API_ORIGIN.to_string())
        .trim_end_matches('/')
        .to_string()
}

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

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(phantomplay_live_root)
}

fn unreal_project_dir() -> PathBuf {
    let live_project = phantomplay_live_root()
        .join("packages")
        .join("phantom-games-unreal");
    if live_project.join("PhantomGames.uproject").is_file() {
        live_project
    } else {
        repo_root().join("packages").join("phantom-games-unreal")
    }
}

fn phantomplay_data_root() -> PathBuf {
    std::env::var("PHANTOMPLAY_DATA_ROOT")
        .map(PathBuf::from)
        .or_else(|_| {
            std::env::var("LOCALAPPDATA").map(|root| PathBuf::from(root).join("PhantomPlay"))
        })
        .unwrap_or_else(|_| repo_root().join(".phantomplay"))
}

fn select_unreal_builds_dir(
    configured: Option<PathBuf>,
    installed: PathBuf,
    project: PathBuf,
) -> PathBuf {
    if let Some(configured) = configured.filter(|path| !path.as_os_str().is_empty()) {
        return configured;
    }
    if installed.join("PHANTOMPLAY_BUILDSET.json").is_file() {
        return installed;
    }
    project.join("Builds").join("Windows")
}

fn unreal_builds_dir() -> PathBuf {
    let configured = std::env::var("PHANTOMPLAY_UNREAL_BUILDS")
        .ok()
        .map(PathBuf::from);
    let installed = phantomplay_data_root()
        .join("Games")
        .join("Unreal")
        .join("Windows");
    select_unreal_builds_dir(configured, installed, unreal_project_dir())
}

fn phantomforge_unreal_game(game_id: &str) -> bool {
    PHANTOMFORGE_UNREAL_GAME_IDS.contains(&game_id)
}

fn unreal_player_path(game_id: &str) -> Option<PathBuf> {
    let executable = match game_id {
        "phantom-strike" => "PhantomStrike.exe",
        "phantom-ages" => "PhantomAges.exe",
        "phantom-legends" => "PhantomLegends.exe",
        "cubetown" => "Cubetown.exe",
        _ => return None,
    };
    Some(unreal_builds_dir().join(game_id).join(executable))
}

fn unreal_source_files(game_id: &str) -> Vec<PathBuf> {
    let controller = match game_id {
        "phantom-strike" => "Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp",
        "phantom-ages" => "Source/PhantomGames/Private/Ages/PhantomAgesDirector.cpp",
        "phantom-legends" => "Source/PhantomGames/Private/Legends/PhantomLegendsDirector.cpp",
        "cubetown" => "Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp",
        _ => return Vec::new(),
    };
    let project = unreal_project_dir();
    [
        project.join(controller),
        project.join("Source/PhantomGames/Private/Core/PhantomRouterGameMode.cpp"),
        project.join("Source/PhantomGames/Private/Core/PhantomGameIds.cpp"),
        project.join("PhantomGames.uproject"),
        project.join("Build-Flagships.ps1"),
        project.join("README.md"),
    ]
    .into_iter()
    .filter(|file| file.is_file())
    .collect()
}

fn flagship_game_blurb(game_id: &str) -> Option<GameBlurb> {
    let (title, genre, fantasy) = match game_id {
        "phantom-strike" => (
            "PhantomStrike",
            "Modern tactical first-person shooter",
            "Fight through a premium near-future combat operation with responsive gunplay, enemy squads, objectives, and full native presentation.",
        ),
        "phantom-ages" => (
            "Phantom Ages",
            "Fixed-lane age-evolution battler",
            "Deploy formations, research literal troop upgrades, counter siege, and evolve from cavepeople to the Phantom Age on one readable battlefield.",
        ),
        "phantom-legends" => (
            "Phantom Legends",
            "Fantasy RTS and persistent base builder",
            "Build a lasting stronghold, command workers and armies, conquer a living fantasy map, and return stronger after every campaign.",
        ),
        "cubetown" => (
            "Shadowbearer: Dawn's Return",
            "Storybook action-adventure of light, shadow, and remembered worlds",
            "Begin in Bramblewick before Shadowfall, survive the Pale Warden, restore five fallen guardians and their armaments, uncover Aktarus's history, and carry both light and darkness through the Black Meridian into Dawn's Return.",
        ),
        _ => return None,
    };
    Some(GameBlurb {
        title: title.to_string(),
        genre: genre.to_string(),
        fantasy: fantasy.to_string(),
    })
}

fn studio_meta_path() -> PathBuf {
    phantomplay_live_root()
        .join(".phantom")
        .join("phantomplay-studio.json")
}

fn drag_file_paths(event: &DragEvent) -> Vec<PathBuf> {
    use dioxus_html::HasFileData;
    event
        .files()
        .into_iter()
        .map(|file| file.path())
        .filter(|path| !path.as_os_str().is_empty())
        .collect()
}

#[derive(Clone, PartialEq, Debug)]
struct GameEntry {
    id: String,
    path: PathBuf,
    is_dir: bool,
    blurb: Option<GameBlurb>,
    runtime: GameRuntimeProfile,
    meta: StudioGameMeta,
}

/// Real store-card copy, pulled from each game's own `phantomGameKernel`
/// config where present (its title/genre/one-line fantasy) rather than
/// invented — most games don't have this yet, and the card just falls back
/// to a plain title in that case instead of showing fabricated text.
#[derive(Clone, PartialEq, Debug)]
struct GameBlurb {
    title: String,
    genre: String,
    fantasy: String,
}

#[derive(Clone, PartialEq, Debug)]
struct GameRuntimeProfile {
    renderer: String,
    engine: String,
    file_count: usize,
    total_bytes: u64,
    network_hooks: bool,
    host_bridge: bool,
    native: bool,
}

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
struct StudioGameMeta {
    hidden: bool,
    developer: String,
    your_rating: u8,
    public_rating: f32,
    rating_count: u32,
    notes: String,
}

impl Default for StudioGameMeta {
    fn default() -> Self {
        Self {
            hidden: false,
            developer: "Tak".to_string(),
            your_rating: 0,
            public_rating: 4.7,
            rating_count: 0,
            notes: String::new(),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct StudioCatalogMeta {
    games: BTreeMap<String, StudioGameMeta>,
}

fn read_studio_catalog_meta() -> StudioCatalogMeta {
    fs::read_to_string(studio_meta_path())
        .ok()
        .and_then(|text| serde_json::from_str::<StudioCatalogMeta>(&text).ok())
        .unwrap_or_default()
}

fn write_studio_catalog_meta(meta: &StudioCatalogMeta) -> Result<(), String> {
    let path = studio_meta_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(meta)
        .map_err(|error| format!("Could not serialize Studio metadata: {error}"))?;
    fs::write(&path, json).map_err(|error| format!("Could not write {}: {error}", path.display()))
}

fn studio_game_meta(game_id: &str, blurb: Option<&GameBlurb>) -> StudioGameMeta {
    let mut meta = read_studio_catalog_meta()
        .games
        .get(game_id)
        .cloned()
        .unwrap_or_default();
    if meta.developer.trim().is_empty() {
        meta.developer = "Tak".to_string();
    }
    if meta.rating_count == 0 {
        meta.rating_count = if blurb.is_some() { 18 } else { 3 };
    }
    meta
}

fn update_studio_game_meta(
    game_id: &str,
    apply: impl FnOnce(&mut StudioGameMeta),
) -> Result<StudioGameMeta, String> {
    let mut catalog = read_studio_catalog_meta();
    let entry = catalog.games.entry(game_id.to_string()).or_default();
    apply(entry);
    let updated = entry.clone();
    write_studio_catalog_meta(&catalog)?;
    Ok(updated)
}

impl GameRuntimeProfile {
    fn size_label(&self) -> String {
        format_bytes(self.total_bytes)
    }
}

fn format_bytes(bytes: u64) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = KIB * 1024.0;
    const GIB: f64 = MIB * 1024.0;
    let value = bytes as f64;
    if value >= GIB {
        format!("{:.1} GB", value / GIB)
    } else if value >= MIB {
        format!("{:.1} MB", value / MIB)
    } else if value >= KIB {
        format!("{:.0} KB", value / KIB)
    } else {
        format!("{bytes} B")
    }
}

fn is_godot_project_tree(root: &Path) -> bool {
    if root.join("project.godot").is_file() || root.join("project.binary").is_file() {
        return true;
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name != ".git" && name != "node_modules" {
                    stack.push(path);
                }
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name == "project.godot"
                || name == "project.binary"
                || name.ends_with(".tscn")
                || name.ends_with(".gd")
                || name.ends_with(".gd.remap")
            {
                return true;
            }
        }
    }
    false
}

fn is_unreal_project_tree(root: &Path) -> bool {
    let mut files = Vec::new();
    walk_dir(root, 0, &mut files);
    files.iter().any(|file| {
        file.extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("uproject"))
    })
}

fn is_unity_project_tree(root: &Path) -> bool {
    if root.join("Assets").is_dir() && root.join("ProjectSettings").is_dir() {
        return true;
    }
    let mut files = Vec::new();
    walk_dir(root, 0, &mut files);
    files.iter().any(|file| {
        file.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("UnityPlayer.dll"))
    })
}

fn is_supported_native_project_tree(root: &Path) -> bool {
    is_godot_project_tree(root)
        || is_unreal_project_tree(root)
        || is_unity_project_tree(root)
        || root.join("native-runtime.json").is_file()
}

fn find_unreal_project_file(root: &Path) -> Option<PathBuf> {
    let mut files = Vec::new();
    walk_dir(root, 0, &mut files);
    files.into_iter().find(|file| {
        file.extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("uproject"))
    })
}

fn find_packaged_player(root: &Path, game_id: &str) -> Option<PathBuf> {
    let mut files = Vec::new();
    walk_dir(root, 0, &mut files);
    let compact_id = game_id.replace('-', "").to_ascii_lowercase();
    let mut candidates: Vec<PathBuf> = files
        .into_iter()
        .filter(|file| {
            file.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
        })
        .filter(|file| {
            let name = file
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            !name.contains("crash") && !name.contains("helper") && !name.contains("unrealeditor")
        })
        .collect();
    candidates.sort_by(|left, right| {
        let score = |file: &Path| {
            let name: String = file
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .chars()
                .filter(|character| !matches!(character, '-' | '_' | ' '))
                .collect::<String>()
                .to_ascii_lowercase();
            if name == compact_id {
                3
            } else if name.contains(&compact_id) {
                2
            } else {
                1
            }
        };
        score(right).cmp(&score(left))
    });
    candidates.into_iter().next()
}

fn native_runtime_dir() -> PathBuf {
    phantomplay_live_root()
        .join("packages")
        .join("phantomplay-panda3d")
}

#[derive(Debug, Deserialize)]
struct NativeRuntimeManifest {
    engine: Option<String>,
    module: Option<String>,
    executable: Option<String>,
    arguments: Option<Vec<String>>,
    #[serde(rename = "webFallback")]
    web_fallback: Option<String>,
}

fn native_manifest_path(game_id: &str) -> PathBuf {
    games_dir().join(game_id).join("native-runtime.json")
}

fn read_native_manifest(game_id: &str) -> Option<NativeRuntimeManifest> {
    let manifest_path = native_manifest_path(game_id);
    let text = fs::read_to_string(manifest_path).ok()?;
    serde_json::from_str(&text).ok()
}

fn native_module_file(game_id: &str) -> Option<PathBuf> {
    let manifest = read_native_manifest(game_id)?;
    let module = manifest.module.as_deref()?.trim();
    let file_stem = module.rsplit('.').next()?.trim();
    if file_stem.is_empty() || file_stem.contains('/') || file_stem.contains('\\') {
        return None;
    }
    Some(
        native_runtime_dir()
            .join("phantomplay_native")
            .join(format!("{file_stem}.py")),
    )
}

fn native_game_supported(game_id: &str) -> bool {
    native_manifest_path(game_id).is_file()
        && native_module_file(game_id).is_some_and(|path| path.is_file())
}

fn native_web_fallback_entry(game_id: &str) -> Option<String> {
    let manifest = read_native_manifest(game_id)?;
    let fallback = manifest.web_fallback.as_deref()?.trim().replace('\\', "/");
    if fallback.is_empty() || fallback.starts_with('/') || fallback.contains("://") {
        return None;
    }
    let entry = format!("{game_id}/{fallback}");
    let normalized = entry
        .split('/')
        .fold(Vec::<&str>::new(), |mut parts, part| {
            match part {
                "" | "." => {}
                ".." => {
                    parts.pop();
                }
                value => parts.push(value),
            }
            parts
        })
        .join("/");
    let path = games_dir().join(&normalized);
    path.is_file().then_some(normalized)
}

fn native_source_files(game_id: &str) -> Vec<PathBuf> {
    if phantomforge_unreal_game(game_id) {
        return unreal_source_files(game_id);
    }
    if !native_game_supported(game_id) {
        return Vec::new();
    }
    let source = native_runtime_dir().join("phantomplay_native");
    [
        "__main__.py".to_string(),
        "runtime.py".to_string(),
        "state.py".to_string(),
        "gameplay.py".to_string(),
    ]
    .into_iter()
    .map(|file| source.join(file))
    .chain(native_module_file(game_id))
    .filter(|file| file.is_file())
    .collect()
}

#[allow(dead_code)]
#[derive(Debug, PartialEq)]
struct NativeLaunchSpec {
    python: PathBuf,
    leading_args: Vec<String>,
    runtime_dir: PathBuf,
    game_id: String,
}

fn manifest_executable_path(game_id: &str) -> Option<PathBuf> {
    let manifest = read_native_manifest(game_id)?;
    let value = manifest.executable.as_deref()?.trim();
    if value.is_empty() {
        return None;
    }
    let relative = Path::new(value);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return None;
    }
    Some(games_dir().join(game_id).join(relative))
}

fn manifest_engine_label(game_id: &str) -> Option<String> {
    read_native_manifest(game_id)?
        .engine
        .map(|engine| engine.trim().to_string())
        .filter(|engine| !engine.is_empty())
}

#[derive(Debug, PartialEq)]
struct NativeLaunchReceipt {
    pid: u32,
    engine: String,
}

#[allow(dead_code)]
fn native_python_command() -> (PathBuf, Vec<String>) {
    if let Some(configured) = std::env::var_os("PHANTOMPLAY_PYTHON") {
        return (PathBuf::from(configured), Vec::new());
    }
    let scripts = native_runtime_dir().join(".venv").join("Scripts");
    for name in ["pythonw.exe", "python.exe"] {
        let candidate = scripts.join(name);
        if candidate.is_file() {
            return (candidate, Vec::new());
        }
    }
    (PathBuf::from("pyw.exe"), vec!["-3.11".to_string()])
}

#[allow(dead_code)]
fn native_launch_spec(game_id: &str) -> Result<NativeLaunchSpec, String> {
    if !native_game_supported(game_id) {
        return Err(format!("{game_id} does not declare a Panda3D runtime."));
    }
    let (python, leading_args) = native_python_command();
    Ok(NativeLaunchSpec {
        python,
        leading_args,
        runtime_dir: native_runtime_dir(),
        game_id: game_id.to_string(),
    })
}

#[allow(dead_code)]
fn launch_unreal_game(game_id: &str) -> Result<NativeLaunchReceipt, String> {
    let player = unreal_player_path(game_id)
        .ok_or_else(|| format!("{game_id} is not a registered Unreal Engine game."))?;
    if !player.is_file() {
        return Err(format!(
            "The Unreal player is missing at {}. Compile or package it from the Phantom Games Unreal project before pressing Run.",
            player.display()
        ));
    }
    let working_directory = player
        .parent()
        .ok_or_else(|| format!("Could not resolve the Unreal player folder for {game_id}."))?;
    Command::new(&player)
        .arg(format!("-PhantomGame={game_id}"))
        .arg("-windowed")
        .arg("-ResX=1600")
        .arg("-ResY=900")
        .arg("-SaveToUserDir")
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|child| NativeLaunchReceipt {
            pid: child.id(),
            engine: "Unreal Engine 5".to_string(),
        })
        .map_err(|error| format!("Could not start {}: {error}", player.display()))
}

#[allow(dead_code)]
fn launch_packaged_player(
    player: &Path,
    engine: &str,
    arguments: &[String],
) -> Result<NativeLaunchReceipt, String> {
    let mut command = Command::new(player);
    command.args(arguments);
    if let Some(working_directory) = player.parent().filter(|path| !path.as_os_str().is_empty()) {
        command.current_dir(working_directory);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|child| NativeLaunchReceipt {
            pid: child.id(),
            engine: engine.to_string(),
        })
        .map_err(|error| format!("Could not start {}: {error}", player.display()))
}

#[derive(Deserialize)]
struct EpicLauncherManifest {
    #[serde(rename = "InstallLocation")]
    install_location: Option<String>,
    #[serde(rename = "LaunchExecutable")]
    launch_executable: Option<String>,
    #[serde(rename = "AppName")]
    app_name: Option<String>,
    #[serde(rename = "AppCategories")]
    app_categories: Option<Vec<String>>,
}

fn unreal_editor_from_root(path: PathBuf) -> PathBuf {
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("UnrealEditor.exe"))
    {
        path
    } else {
        path.join("Engine")
            .join("Binaries")
            .join("Win64")
            .join("UnrealEditor.exe")
    }
}

fn find_unreal_editor_from_epic_manifests(manifest_root: &Path) -> Option<PathBuf> {
    let mut manifests: Vec<PathBuf> = fs::read_dir(manifest_root)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("item"))
        })
        .collect();
    manifests.sort_by(|left, right| right.cmp(left));
    manifests.into_iter().find_map(|manifest_path| {
        let text = fs::read_to_string(manifest_path).ok()?;
        let manifest = serde_json::from_str::<EpicLauncherManifest>(&text).ok()?;
        let launch_is_editor = manifest
            .launch_executable
            .as_deref()
            .is_some_and(|path| path.to_ascii_lowercase().ends_with("unrealeditor.exe"));
        let is_unreal_engine = launch_is_editor
            || manifest
                .app_name
                .as_deref()
                .is_some_and(|name| name.starts_with("UE_"))
            || manifest
                .app_categories
                .as_deref()
                .is_some_and(|categories| {
                    categories
                        .iter()
                        .any(|category| category.eq_ignore_ascii_case("engines/ue5"))
                });
        if !is_unreal_engine {
            return None;
        }
        let install_location = PathBuf::from(manifest.install_location?);
        let editor = if launch_is_editor {
            install_location.join(manifest.launch_executable?)
        } else {
            unreal_editor_from_root(install_location)
        };
        editor.is_file().then_some(editor)
    })
}

fn find_unreal_editor() -> Option<PathBuf> {
    for variable in ["PHANTOMPLAY_UNREAL_EDITOR", "UNREAL_EDITOR_PATH"] {
        let Some(configured) = std::env::var_os(variable) else {
            continue;
        };
        let path = unreal_editor_from_root(PathBuf::from(configured));
        if path.is_file() {
            return Some(path);
        }
    }
    if let Some(root) = std::env::var_os("UNREAL_ENGINE_ROOT") {
        let path = unreal_editor_from_root(PathBuf::from(root));
        if path.is_file() {
            return Some(path);
        }
    }
    let manifest_root = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
        .join("Epic")
        .join("EpicGamesLauncher")
        .join("Data")
        .join("Manifests");
    if let Some(editor) = find_unreal_editor_from_epic_manifests(&manifest_root) {
        return Some(editor);
    }
    let base = PathBuf::from(r"C:\Program Files\Epic Games");
    let mut versions: Vec<PathBuf> = fs::read_dir(base)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("UE_"))
        })
        .collect();
    versions.sort_by(|left, right| right.cmp(left));
    versions.into_iter().find_map(|root| {
        let editor = root
            .join("Engine")
            .join("Binaries")
            .join("Win64")
            .join("UnrealEditor.exe");
        editor.is_file().then_some(editor)
    })
}

fn launch_unreal_project(game_id: &str, root: &Path) -> Result<NativeLaunchReceipt, String> {
    if let Some(player) = find_packaged_player(root, game_id) {
        return launch_packaged_player(&player, "Unreal Engine", &[]);
    }
    let project = find_unreal_project_file(root)
        .ok_or_else(|| format!("No .uproject file was found for {game_id}."))?;
    let editor = find_unreal_editor().ok_or_else(|| {
        format!(
            "{game_id} is an Unreal source project without a packaged player, and UnrealEditor.exe is not configured."
        )
    })?;
    let arguments = vec![
        project.display().to_string(),
        "-game".to_string(),
        "-windowed".to_string(),
        "-SaveToUserDir".to_string(),
    ];
    launch_packaged_player(&editor, "Unreal Engine", &arguments)
}

fn launch_godot_project(game_id: &str, root: &Path) -> Result<NativeLaunchReceipt, String> {
    if let Some(player) = find_packaged_player(root, game_id) {
        return launch_packaged_player(&player, "Godot", &[]);
    }
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os("PHANTOMPLAY_GODOT") {
        candidates.push(PathBuf::from(configured));
    }
    candidates.push(PathBuf::from("godot4.exe"));
    candidates.push(PathBuf::from("godot.exe"));
    let arguments = vec!["--path".to_string(), root.display().to_string()];
    let mut last_error = String::new();
    for candidate in candidates {
        match launch_packaged_player(&candidate, "Godot", &arguments) {
            Ok(receipt) => return Ok(receipt),
            Err(error) => last_error = error,
        }
    }
    Err(format!(
        "{game_id} is a Godot source project without a packaged player. Configure PHANTOMPLAY_GODOT. {last_error}"
    ))
}

fn launch_unity_project(game_id: &str, root: &Path) -> Result<NativeLaunchReceipt, String> {
    if let Some(player) = find_packaged_player(root, game_id) {
        return launch_packaged_player(&player, "Unity", &[]);
    }
    Err(format!(
        "{game_id} is a Unity source project without a packaged player. Build the desktop player, then refresh PhantomPlay."
    ))
}

fn launch_panda_game(game_id: &str) -> Result<NativeLaunchReceipt, String> {
    let spec = native_launch_spec(game_id)?;
    let mut command = Command::new(&spec.python);
    command
        .args(&spec.leading_args)
        .arg("-m")
        .arg("phantomplay_native")
        .arg("--game")
        .arg(&spec.game_id)
        .current_dir(&spec.runtime_dir)
        .env("PHANTOMPLAY_LIVE_ROOT", phantomplay_live_root())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .map(|child| NativeLaunchReceipt {
            pid: child.id(),
            engine: "Panda3D".to_string(),
        })
        .map_err(|error| {
            format!(
                "Could not start the Panda3D runtime with {}: {error}. Run Install-NativeRuntime.ps1 once.",
                spec.python.display()
            )
        })
}

fn launch_declared_native_game(game_id: &str) -> Result<NativeLaunchReceipt, String> {
    let manifest = read_native_manifest(game_id)
        .ok_or_else(|| format!("{game_id} has an unreadable native-runtime.json."))?;
    if manifest.module.is_some()
        || manifest
            .engine
            .as_deref()
            .is_some_and(|engine| engine.eq_ignore_ascii_case("panda3d"))
    {
        return launch_panda_game(game_id);
    }
    let player = manifest_executable_path(game_id).ok_or_else(|| {
        format!(
            "{game_id} declares a native runtime but does not provide a safe relative executable path."
        )
    })?;
    if !player.is_file() {
        return Err(format!(
            "The declared native player is missing at {}.",
            player.display()
        ));
    }
    let engine = manifest
        .engine
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Native executable");
    let arguments = manifest.arguments.unwrap_or_default();
    launch_packaged_player(&player, engine, &arguments)
}

#[allow(dead_code)]
fn launch_native_game(game_id: &str) -> Result<NativeLaunchReceipt, String> {
    if phantomforge_unreal_game(game_id) {
        return launch_unreal_game(game_id);
    }
    if native_manifest_path(game_id).is_file() {
        return launch_declared_native_game(game_id);
    }
    let root = games_dir().join(game_id);
    if is_unreal_project_tree(&root) {
        return launch_unreal_project(game_id, &root);
    }
    if is_unity_project_tree(&root) {
        return launch_unity_project(game_id, &root);
    }
    if is_godot_project_tree(&root) {
        return launch_godot_project(game_id, &root);
    }
    Err(format!(
        "{game_id} does not declare a supported native runtime."
    ))
}

fn detect_runtime(path: &Path, is_dir: bool) -> GameRuntimeProfile {
    let mut paths = if is_dir {
        let mut out = Vec::new();
        walk_dir(path, 0, &mut out);
        out
    } else {
        vec![path.to_path_buf()]
    };
    paths.sort();

    let total_bytes = paths
        .iter()
        .filter_map(|file| fs::metadata(file).ok().map(|meta| meta.len()))
        .sum();

    let mut probe = String::new();
    for file in &paths {
        let extension = file
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default();
        if !matches!(extension, "html" | "js" | "mjs" | "ts") || probe.len() >= 3_000_000 {
            continue;
        }
        if let Ok(text) = fs::read_to_string(file) {
            let remaining = 3_000_000usize.saturating_sub(probe.len());
            let mut end = text.len().min(remaining);
            while end > 0 && !text.is_char_boundary(end) {
                end -= 1;
            }
            probe.push_str(&text[..end]);
            probe.push('\n');
        }
    }
    let lower = probe.to_ascii_lowercase();

    let has_godot_files = paths.iter().any(|file| {
        file.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                matches!(name, "project.godot" | "project.binary")
                    || name.ends_with(".tscn")
                    || name.ends_with(".gd")
                    || name.ends_with(".gd.remap")
            })
    });

    let has_unreal_files = paths.iter().any(|file| {
        file.extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("uproject"))
    });

    let has_unity_files =
        (is_dir && path.join("Assets").is_dir() && path.join("ProjectSettings").is_dir())
            || paths.iter().any(|file| {
                file.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.eq_ignore_ascii_case("UnityPlayer.dll"))
            });

    let renderer = if has_unreal_files {
        "Unreal Engine"
    } else if has_unity_files {
        "Unity"
    } else if has_godot_files {
        "Godot"
    } else if lower.contains("webgpurenderer") || lower.contains("navigator.gpu") {
        "WebGPU"
    } else if lower.contains("webglrenderer")
        || lower.contains("getcontext(\"webgl")
        || lower.contains("getcontext('webgl")
    {
        "WebGL"
    } else if lower.contains("getcontext(\"2d") || lower.contains("getcontext('2d") {
        "Canvas2D"
    } else {
        "DOM"
    };

    let engine = if has_unreal_files {
        "Unreal project"
    } else if has_unity_files {
        "Unity project"
    } else if has_godot_files {
        "Godot project"
    } else if lower.contains("phantomengine") {
        "Phantom Engine"
    } else if lower.contains("phantomgamekernel") {
        "Phantom Game Kernel"
    } else if paths.iter().any(|file| {
        file.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("engine.js"))
    }) {
        "Game-specific engine"
    } else {
        "Standalone runtime"
    };

    GameRuntimeProfile {
        renderer: renderer.to_string(),
        engine: engine.to_string(),
        file_count: paths.len(),
        total_bytes,
        network_hooks: lower.contains("phantomplayroom")
            || lower.contains("new websocket")
            || lower.contains("rtcpeerconnection"),
        host_bridge: lower.contains("postmessage"),
        native: has_godot_files || has_unreal_files || has_unity_files,
    }
}

fn apply_native_runtime(game_id: &str, runtime: &mut GameRuntimeProfile) {
    let sources = native_source_files(game_id);
    if phantomforge_unreal_game(game_id) {
        runtime.renderer = "Unreal Engine 5".to_string();
        runtime.engine = "Unreal Engine 5.8".to_string();
        runtime.file_count = sources.len();
        runtime.total_bytes = sources
            .iter()
            .filter_map(|file| fs::metadata(file).ok().map(|meta| meta.len()))
            .sum::<u64>();
        runtime.network_hooks = false;
        runtime.host_bridge = true;
        runtime.native = true;
        return;
    }
    if native_manifest_path(game_id).is_file() {
        let is_panda = native_game_supported(game_id);
        runtime.renderer = if is_panda {
            "Panda3D".to_string()
        } else {
            manifest_engine_label(game_id).unwrap_or_else(|| "Native executable".to_string())
        };
        runtime.engine = if is_panda {
            "PhantomPlay Native".to_string()
        } else {
            "Declared native runtime".to_string()
        };
        runtime.file_count += sources.len();
        runtime.total_bytes += sources
            .iter()
            .filter_map(|file| fs::metadata(file).ok().map(|meta| meta.len()))
            .sum::<u64>();
        runtime.host_bridge = true;
        runtime.native = true;
    }
}

fn game_entry_path(game: &GameEntry) -> Option<PathBuf> {
    if phantomforge_unreal_game(&game.id) {
        return None;
    }
    if !game.is_dir {
        return Some(game.path.clone());
    }
    let index = game.path.join("index.html");
    if index.is_file() {
        Some(index)
    } else {
        native_web_fallback_entry(&game.id).map(|entry| games_dir().join(entry))
    }
}

fn game_entry_name(game: &GameEntry) -> String {
    if !game.is_dir {
        format!("{}.html", game.id)
    } else if game.path.join("index.html").is_file() {
        format!("{}/index.html", game.id)
    } else if let Some(fallback) = native_web_fallback_entry(&game.id) {
        fallback
    } else {
        format!("{}/index.html", game.id)
    }
}

/// Hand-rolled instead of a JSON parse because the kernel config appears in
/// two shapes across the catalog: a strict-JSON `data-pgk-config='{...}'`
/// attribute on some games, and a loose JS object literal passed straight to
/// `PhantomGameKernel.init({...})` on others (unquoted keys — not valid
/// JSON). Both use plain `"key": "value"` string fields, so a small
/// substring scan covers both without a regex dependency.
fn extract_quoted_field(text: &str, key: &str) -> Option<String> {
    let patterns = [
        format!("\"{key}\":\""),
        format!("\"{key}\": \""),
        format!("{key}: \""),
        format!("{key}:\""),
    ];
    for pat in patterns {
        if let Some(start) = text.find(pat.as_str()) {
            let value_start = start + pat.len();
            let rest = &text[value_start..];
            let mut end = rest.find('"')?;
            while end > 0 && rest.as_bytes()[end - 1] == b'\\' {
                end = end + 1 + rest[end + 1..].find('"')?;
            }
            let raw = &rest[..end];
            if !raw.is_empty() {
                return Some(raw.replace("\\\"", "\"").replace("\\n", " "));
            }
        }
    }
    None
}

fn extract_game_blurb(entry_file: &Path) -> Option<GameBlurb> {
    let text = fs::read_to_string(entry_file).ok()?;
    if !text.contains("phantomGameKernel") {
        return None; // game hasn't been through the kernel upgrade yet
    }
    let title = extract_quoted_field(&text, "title")?;
    let genre = extract_quoted_field(&text, "genre").unwrap_or_default();
    let fantasy = extract_quoted_field(&text, "fantasy").unwrap_or_default();
    Some(GameBlurb {
        title,
        genre,
        fantasy,
    })
}

fn list_games() -> Vec<GameEntry> {
    let dir = games_dir();
    let mut games = Vec::new();
    let mut directory_game_ids = BTreeMap::new();
    for game_id in PHANTOMFORGE_UNREAL_GAME_IDS {
        directory_game_ids.insert(game_id.to_string(), true);
    }
    let Ok(entries) = fs::read_dir(&dir) else {
        return games;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name != "shared"
            && (path.join("index.html").is_file()
                || native_manifest_path(&name).is_file()
                || is_supported_native_project_tree(&path))
        {
            directory_game_ids.insert(name, true);
        }
    }
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
            let entry_file = path
                .join("index.html")
                .is_file()
                .then(|| path.join("index.html"))
                .or_else(|| native_web_fallback_entry(&name).map(|entry| games_dir().join(entry)));
            let blurb = flagship_game_blurb(&name).or_else(|| {
                entry_file
                    .as_ref()
                    .and_then(|entry_file| extract_game_blurb(entry_file))
            });
            let mut runtime = detect_runtime(&path, true);
            apply_native_runtime(&name, &mut runtime);
            let meta = studio_game_meta(&name, blurb.as_ref());
            games.push(GameEntry {
                id: name,
                path,
                is_dir: true,
                blurb,
                runtime,
                meta,
            });
        } else if path.extension().and_then(|e| e.to_str()) == Some("html") {
            let id = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if directory_game_ids.contains_key(&id) {
                continue;
            }
            let blurb = flagship_game_blurb(&id).or_else(|| extract_game_blurb(&path));
            let mut runtime = detect_runtime(&path, false);
            apply_native_runtime(&id, &mut runtime);
            let meta = studio_game_meta(&id, blurb.as_ref());
            games.push(GameEntry {
                id,
                path,
                is_dir: false,
                blurb,
                runtime,
                meta,
            });
        }
    }
    for game_id in FLAGSHIP_UNREAL_GAME_IDS {
        if games.iter().any(|game| game.id == game_id) {
            continue;
        }
        let blurb = flagship_game_blurb(game_id);
        let mut runtime = detect_runtime(&games_dir().join(game_id), true);
        apply_native_runtime(game_id, &mut runtime);
        games.push(GameEntry {
            id: game_id.to_string(),
            path: games_dir().join(game_id),
            is_dir: true,
            meta: studio_game_meta(game_id, blurb.as_ref()),
            blurb,
            runtime,
        });
    }
    games.sort_by(|a, b| a.id.cmp(&b.id));
    games
}

fn list_files(game: &GameEntry) -> Vec<(PathBuf, String)> {
    let mut paths = if phantomforge_unreal_game(&game.id) {
        Vec::new()
    } else if !game.is_dir {
        vec![game.path.clone()]
    } else {
        let mut out = Vec::new();
        walk_dir(&game.path, 0, &mut out);
        out.sort();
        out
    };
    paths.extend(native_source_files(&game.id));
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
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
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
    if let Ok(relative) = file.strip_prefix(unreal_project_dir()) {
        return format!("unreal/{}", relative.to_string_lossy().replace('\\', "/"));
    }
    if let Ok(relative) = file.strip_prefix(native_runtime_dir().join("phantomplay_native")) {
        return format!("native/{}", relative.to_string_lossy().replace('\\', "/"));
    }
    if !game.is_dir {
        return file
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
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
        "webp" => "image/webp",
        "avif" => "image/avif",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "gltf" => "model/gltf+json",
        "glb" => "model/gltf-binary",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn safe_game_asset(root: &Path, uri_path: &str) -> Option<PathBuf> {
    let relative = uri_path.trim_start_matches('/');
    if relative.is_empty()
        || relative.contains('\\')
        || relative.contains(':')
        || relative.contains('\0')
        || relative.contains('%')
        || relative
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return None;
    }

    let canonical_root = root.canonicalize().ok()?;
    let canonical_file = canonical_root.join(relative).canonicalize().ok()?;
    canonical_file
        .starts_with(&canonical_root)
        .then_some(canonical_file)
}

// ---- desktop Mods tab state ------------------------------------------------

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
struct ModEntry {
    id: String,
    file: String,
    name: String,
    desc: String,
}

fn universal_mod_entries() -> Vec<ModEntry> {
    [
        (
            "universal_slowmo",
            "Slow Motion",
            "Runs game time at 35% speed.",
        ),
        (
            "universal_crt",
            "CRT Filter",
            "Adds scanlines and a high-contrast display pass.",
        ),
        (
            "universal_bigcursor",
            "Big Cursor",
            "Uses a large high-contrast aiming cursor.",
        ),
        (
            "universal_mute",
            "Mute Audio",
            "Mutes Web Audio and media output.",
        ),
        (
            "universal_zoom",
            "Zoom In",
            "Magnifies the primary game canvas.",
        ),
    ]
    .into_iter()
    .map(|(id, name, desc)| ModEntry {
        id: id.to_string(),
        file: String::new(),
        name: name.to_string(),
        desc: desc.to_string(),
    })
    .collect()
}

fn mods_manifest_path(game_id: &str) -> PathBuf {
    project_mods_dir(game_id).join("manifest.json")
}
fn mods_enabled_path(game_id: &str) -> PathBuf {
    project_mods_dir(game_id).join(".enabled.json")
}

fn project_mods_dir(game_id: &str) -> PathBuf {
    let directory_game = games_dir().join(game_id);
    if directory_game.join("index.html").is_file() {
        directory_game.join("mods")
    } else {
        games_dir().join("shared").join("mods").join(game_id)
    }
}

fn project_mod_base(game_id: &str) -> String {
    if games_dir().join(game_id).join("index.html").is_file() {
        format!("/{game_id}/mods/")
    } else {
        format!("/shared/mods/{game_id}/")
    }
}

fn read_mod_manifest(game_id: &str) -> Vec<ModEntry> {
    fs::read_to_string(mods_manifest_path(game_id))
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<ModEntry>>(&text).ok())
        .unwrap_or_default()
}

fn write_mod_manifest(game_id: &str, mods: &[ModEntry]) -> Result<(), String> {
    let path = mods_manifest_path(game_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(mods)
        .map_err(|error| format!("Could not serialize mods: {error}"))?;
    fs::write(&path, json).map_err(|error| format!("Could not write {}: {error}", path.display()))
}

fn create_project_mod(game_id: &str, name: &str, desc: &str) -> Result<ModEntry, String> {
    if !valid_game_id(game_id) {
        return Err("Choose a valid project before creating a mod.".to_string());
    }
    let base = name
        .chars()
        .flat_map(|ch| ch.to_lowercase())
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let base = if base.is_empty() {
        "custom-mod".to_string()
    } else {
        base
    };
    let mut manifest = read_mod_manifest(game_id);
    let mut id = base.clone();
    for suffix in 1.. {
        if !manifest.iter().any(|entry| entry.id == id) {
            break;
        }
        id = format!("{base}-{suffix}");
    }
    let entry = ModEntry {
        id: id.clone(),
        file: format!("{id}.mod.js"),
        name: name.trim().to_string(),
        desc: if desc.trim().is_empty() {
            "Custom desktop mod.".to_string()
        } else {
            desc.trim().to_string()
        },
    };
    fs::create_dir_all(project_mods_dir(game_id))
        .map_err(|error| format!("Could not create mod folder: {error}"))?;
    let source = format!(
        "(function(){{\n  document.documentElement.dataset.phantomplayCustomMod = \"{}\";\n  console.info(\"[PhantomPlay mod] {} active\");\n}})();\n",
        entry.id,
        entry.name.replace('"', "\\\"")
    );
    fs::write(project_mods_dir(game_id).join(&entry.file), source)
        .map_err(|error| format!("Could not write mod file: {error}"))?;
    manifest.push(entry.clone());
    write_mod_manifest(game_id, &manifest)?;
    Ok(entry)
}

fn read_available_mods(game_id: &str) -> Vec<ModEntry> {
    let mut mods = universal_mod_entries();
    mods.extend(read_mod_manifest(game_id));
    mods
}

fn valid_game_id(game_id: &str) -> bool {
    !game_id.is_empty()
        && game_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        && (games_dir().join(game_id).is_dir()
            || games_dir().join(format!("{game_id}.html")).is_file())
}

fn sanitize_enabled_mods(game_id: &str, ids: Vec<String>) -> Vec<String> {
    let allowed = read_available_mods(game_id);
    let mut sanitized = Vec::new();
    for id in ids {
        if allowed.iter().any(|entry| entry.id == id) && !sanitized.contains(&id) {
            sanitized.push(id);
        }
    }
    sanitized
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
    // Strict built-in games (including Vespergate) intentionally reject
    // arbitrary inline script. Give only the shell-authored bootstrap a nonce
    // instead of weakening their CSP with `unsafe-inline`.
    const NATIVE_SCRIPT_NONCE: &str = "phantomplay-native-shell";
    if text.contains("script-src ") {
        text = text.replacen(
            "script-src ",
            &format!("script-src 'nonce-{NATIVE_SCRIPT_NONCE}' "),
            1,
        );
    }
    let bootstrap = serde_json::json!({
        "gameId": game_id,
        "modBase": project_mod_base(game_id),
        "enabled": read_enabled_mods(game_id),
        "mods": read_mod_manifest(game_id),
    });
    let bootstrap_json = serde_json::to_string(&bootstrap)
        .unwrap_or_else(|_| "{\"enabled\":[],\"mods\":[]}".to_string())
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026");
    let injection = format!(
        r#"<script nonce="{NATIVE_SCRIPT_NONCE}">document.documentElement.setAttribute("data-pm-game-id","{game_id}");document.documentElement.setAttribute("data-pm-native","true");window.__PHANTOMPLAY_MOD_BOOTSTRAP__={bootstrap_json};</script>
<script src="/shared/modLoader.js"></script>
<script nonce="{NATIVE_SCRIPT_NONCE}">
(function(){{
  var lastV = null;
  var stateKey = "phantomplay.devstate.{game_id}";
  function snapshot(){{
    try {{
      var local = {{}};
      for (var i = 0; i < localStorage.length; i++) {{
        var k = localStorage.key(i);
        local[k] = localStorage.getItem(k);
      }}
      var session = {{}};
      for (var j = 0; j < sessionStorage.length; j++) {{
        var sk = sessionStorage.key(j);
        if (sk !== stateKey) session[sk] = sessionStorage.getItem(sk);
      }}
      sessionStorage.setItem(stateKey, JSON.stringify({{
        href: location.href,
        hash: location.hash,
        localStorage: local,
        sessionStorage: session,
        activeId: document.activeElement && document.activeElement.id || ""
      }}));
    }} catch (error) {{}}
  }}
  try {{
    var saved = JSON.parse(sessionStorage.getItem(stateKey) || "null");
    if (saved) {{
      if (saved.localStorage) Object.keys(saved.localStorage).forEach(function(k) {{
        try {{ localStorage.setItem(k, saved.localStorage[k]); }} catch (error) {{}}
      }});
      if (saved.sessionStorage) Object.keys(saved.sessionStorage).forEach(function(k) {{
        try {{ sessionStorage.setItem(k, saved.sessionStorage[k]); }} catch (error) {{}}
      }});
      if (saved.hash && location.hash !== saved.hash) location.hash = saved.hash;
      setTimeout(function() {{
        if (saved.activeId) {{
          var active = document.getElementById(saved.activeId);
          if (active && active.focus) active.focus();
        }}
        window.postMessage({{ source: "phantomplay-host", type: "load-state", state: saved }}, "*");
      }}, 60);
    }}
  }} catch (error) {{}}
  addEventListener("beforeunload", snapshot);
  setInterval(function(){{
    var poll = document.createElement("script");
    poll.src = "/__pm_version.js?ts=" + Date.now();
    poll.onload = function(){{
      var v = String(window.__PHANTOMPLAY_HOT_VERSION__ || "0");
      poll.remove();
      if (lastV !== null && v !== lastV) {{
        snapshot();
        location.reload();
      }}
      lastV = v;
    }};
    poll.onerror = function(){{ poll.remove(); }};
    document.head.appendChild(poll);
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
    engine: String,
    #[serde(rename = "projectFiles")]
    project_files: Vec<String>,
    provider: String,
    model: String,
    #[serde(rename = "fallbackProvider")]
    fallback_provider: String,
    #[serde(rename = "allowFallbacks")]
    allow_fallbacks: bool,
    #[serde(rename = "timeoutMs")]
    timeout_ms: u64,
}

#[derive(Deserialize, Default)]
struct AiEditResponseBody {
    ok: bool,
    #[serde(rename = "newContent")]
    new_content: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    error: Option<String>,
    code: Option<String>,
    summary: Option<String>,
    failures: Option<serde_json::Value>,
    #[serde(default)]
    changed: bool,
}

struct AiEditOutput {
    new_content: String,
    provider: String,
    model: String,
    changed: bool,
}

async fn request_ai_edit_at(
    api_origin: &str,
    body: AiEditRequestBody,
) -> Result<AiEditOutput, String> {
    let request_timeout = body.timeout_ms.clamp(15_000, 240_000);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(request_timeout + 12_000))
        .build()
        .map_err(|error| format!("Could not prepare the PhantomForce API connection: {error}"))?;
    let resp = client
        .post(format!("{}/api/phantomplay/ai-edit", api_origin.trim_end_matches('/')))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            format!(
                "Could not reach the PhantomForce API at {} ({e}). Open Settings → Connections, start the API, then run the connection test.",
                api_origin.trim_end_matches('/')
            )
        })?;
    let response_status = resp.status();
    let response_text = resp
        .text()
        .await
        .map_err(|e| format!("Could not read the AI edit response: {e}"))?;
    let parsed: AiEditResponseBody = serde_json::from_str(&response_text).map_err(|e| {
        format!(
            "Bad response from AI edit endpoint (HTTP {}): {e}",
            response_status.as_u16()
        )
    })?;
    if parsed.ok {
        let new_content = parsed
            .new_content
            .ok_or_else(|| "AI edit endpoint said ok but returned no content.".to_string())?;
        Ok(AiEditOutput {
            new_content,
            provider: parsed.provider.unwrap_or_else(|| "auto".to_string()),
            model: parsed.model.unwrap_or_else(|| "default".to_string()),
            changed: parsed.changed,
        })
    } else {
        let message = parsed
            .error
            .or(parsed.summary)
            .unwrap_or_else(|| "AI edit failed for an unknown reason.".to_string());
        let code = parsed.code.unwrap_or_else(|| "unknown_error".to_string());
        let failure_count = parsed
            .failures
            .as_ref()
            .and_then(serde_json::Value::as_array)
            .map(Vec::len)
            .unwrap_or(0);
        Err(format!(
            "{message} [reason: {code}; HTTP {}; attempted routes: {failure_count}]",
            response_status.as_u16()
        ))
    }
}

async fn check_api_health_at(api_origin: &str) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    client
        .get(format!("{}/health", api_origin.trim_end_matches('/')))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

fn main() {
    let icon =
        dioxus::desktop::icon_from_memory(include_bytes!("../assets/brand-phantom.png")).ok();
    let game_root = games_dir();
    let hot_reload_version = watch_for_hot_reload(game_root.clone());
    let game_handler =
        move |_id: dioxus::desktop::wry::WebViewId<'_>,
              request: dioxus::desktop::wry::http::Request<Vec<u8>>| {
            let uri_path = request.uri().path().trim_start_matches('/');
            if uri_path == "__pm_version" {
                let version = hot_reload_version.load(Ordering::SeqCst).to_string();
                return dioxus::desktop::wry::http::Response::builder()
                    .header("Content-Type", "text/plain; charset=utf-8")
                    .header("Cache-Control", "no-store")
                    .status(200)
                    .body(std::borrow::Cow::Owned(version.into_bytes()))
                    .unwrap();
            }

            if uri_path == "__pm_version.js" {
                let version = hot_reload_version.load(Ordering::SeqCst);
                let script = format!("window.__PHANTOMPLAY_HOT_VERSION__={version};");
                return dioxus::desktop::wry::http::Response::builder()
                    .header("Content-Type", "application/javascript; charset=utf-8")
                    .header("Cache-Control", "no-store")
                    .status(200)
                    .body(std::borrow::Cow::Owned(script.into_bytes()))
                    .unwrap();
            }

            if let Some(write_path) = uri_path.strip_prefix("__pm_mods_write/") {
                let (game_id, raw_ids) = write_path.split_once('/').unwrap_or((write_path, ""));
                if !valid_game_id(game_id) {
                    return dioxus::desktop::wry::http::Response::builder()
                        .status(404)
                        .body(std::borrow::Cow::Borrowed(&b"unknown game"[..]))
                        .unwrap();
                }
                let requested = raw_ids
                    .split(',')
                    .filter(|id| !id.is_empty())
                    .map(str::to_string)
                    .collect();
                let sanitized = sanitize_enabled_mods(game_id, requested);
                write_enabled_mods(game_id, &sanitized);
                return dioxus::desktop::wry::http::Response::builder()
                    .header("Content-Type", "application/javascript; charset=utf-8")
                    .header("Cache-Control", "no-store")
                    .status(200)
                    .body(std::borrow::Cow::Borrowed(
                        &b"window.__PHANTOMPLAY_MOD_WRITE_OK__=Date.now();"[..],
                    ))
                    .unwrap();
            }

            if let Some(game_id) = uri_path.strip_prefix("__pm_mods/") {
                if !valid_game_id(game_id) {
                    return dioxus::desktop::wry::http::Response::builder()
                        .status(404)
                        .body(std::borrow::Cow::Borrowed(&b"unknown game"[..]))
                        .unwrap();
                }

                return match request.method().as_str() {
                    "GET" => {
                        let json = serde_json::to_vec(&read_enabled_mods(game_id))
                            .unwrap_or_else(|_| b"[]".to_vec());
                        dioxus::desktop::wry::http::Response::builder()
                            .header("Content-Type", "application/json; charset=utf-8")
                            .header("Cache-Control", "no-store")
                            .status(200)
                            .body(std::borrow::Cow::Owned(json))
                            .unwrap()
                    }
                    "PUT" => match serde_json::from_slice::<Vec<String>>(request.body()) {
                        Ok(ids) => {
                            let sanitized = sanitize_enabled_mods(game_id, ids);
                            write_enabled_mods(game_id, &sanitized);
                            let json =
                                serde_json::to_vec(&sanitized).unwrap_or_else(|_| b"[]".to_vec());
                            dioxus::desktop::wry::http::Response::builder()
                                .header("Content-Type", "application/json; charset=utf-8")
                                .header("Cache-Control", "no-store")
                                .status(200)
                                .body(std::borrow::Cow::Owned(json))
                                .unwrap()
                        }
                        Err(_) => dioxus::desktop::wry::http::Response::builder()
                            .status(400)
                            .body(std::borrow::Cow::Borrowed(&b"invalid mod state"[..]))
                            .unwrap(),
                    },
                    _ => dioxus::desktop::wry::http::Response::builder()
                        .header("Allow", "GET, PUT")
                        .status(405)
                        .body(std::borrow::Cow::Borrowed(&b"method not allowed"[..]))
                        .unwrap(),
                };
            }

            let Some(file_path) = safe_game_asset(&game_root, uri_path) else {
                return dioxus::desktop::wry::http::Response::builder()
                    .status(404)
                    .body(std::borrow::Cow::Borrowed(&b"not found"[..]))
                    .unwrap();
            };

            match fs::read(&file_path) {
                Ok(bytes) => {
                    let content_type = mime_for(&file_path);
                    let first_segment = uri_path.split('/').next().unwrap_or_default();
                    let game_id = first_segment.strip_suffix(".html").unwrap_or(first_segment);
                    let body = if content_type.starts_with("text/html") {
                        inject_dev_scripts(bytes, game_id)
                    } else {
                        bytes
                    };
                    dioxus::desktop::wry::http::Response::builder()
                        .header("Content-Type", content_type)
                        .header("Cache-Control", "no-store")
                        .header("X-Content-Type-Options", "nosniff")
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

    let devroom_html =
        DEVROOM_HTML.replace("__PHANTOMPLAY_API_ORIGIN__", &phantomplay_api_origin());
    let devroom_handler =
        move |_id: dioxus::desktop::wry::WebViewId<'_>,
              _request: dioxus::desktop::wry::http::Request<Vec<u8>>| {
            dioxus::desktop::wry::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .header("Cache-Control", "no-store")
                .status(200)
                .body(std::borrow::Cow::Owned(devroom_html.as_bytes().to_vec()))
                .unwrap()
        };

    let window = dioxus::desktop::WindowBuilder::new()
        .with_title("PhantomPlay")
        .with_inner_size(dioxus::desktop::LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(dioxus::desktop::LogicalSize::new(1100.0, 700.0))
        .with_maximized(true);
    #[cfg(target_os = "windows")]
    let window = {
        use dioxus::desktop::tao::platform::windows::WindowBuilderExtWindows;

        window.with_taskbar_icon(icon.clone())
    };
    let data_dir = std::env::var_os("PHANTOMPLAY_WEBVIEW_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join("PhantomPlay")
                .join("WebView")
        });
    let mut config = dioxus::desktop::Config::new()
        .with_window(window)
        .with_menu(None)
        .with_data_directory(data_dir)
        .with_custom_index(PHANTOMPLAY_INDEX.to_string())
        .with_background_color((3, 10, 8, 255))
        .with_disable_context_menu(true)
        .with_disable_drag_drop_handler(false)
        .with_custom_protocol("phantomplay-game", game_handler)
        .with_custom_protocol("phantomplay-devroom", devroom_handler);
    if let Some(icon) = icon {
        config = config.with_icon(icon);
    }
    dioxus::LaunchBuilder::desktop()
        .with_cfg(config)
        .launch(studio::Studio);
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
        assert!(
            games.iter().any(|g| g.id == "neon-drift" && !g.is_dir),
            "neon-drift.html should be a single-file game"
        );
        assert!(
            games.iter().any(|g| g.id == "phantom-pizzeria" && g.is_dir),
            "phantom-pizzeria should be a multi-file directory"
        );
        assert!(
            !games.iter().any(|g| g.id == "shared"),
            "the shared/ utility folder must not be listed as a game"
        );
    }

    #[test]
    fn multi_file_game_exposes_every_file_not_just_index() {
        let games = list_games();
        let pizzeria = games
            .iter()
            .find(|g| g.id == "phantom-pizzeria")
            .expect("phantom-pizzeria must exist in the real catalog");
        let files = list_files(pizzeria);
        let labels: Vec<&str> = files.iter().map(|(_, label)| label.as_str()).collect();
        assert!(labels.contains(&"index.html"), "labels={labels:?}");
        assert!(labels.contains(&"style.css"), "labels={labels:?}");
        assert!(labels.contains(&"game.js"), "labels={labels:?}");
        assert!(
            files.len() >= 3,
            "a multi-file game must expose all of its files, not a fixed 3-slot subset: {labels:?}"
        );
    }

    #[test]
    fn single_file_game_exposes_exactly_itself() {
        let games = list_games();
        let neon_drift = games
            .iter()
            .find(|g| g.id == "neon-drift")
            .expect("neon-drift.html must exist");
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
        let pizzeria = games
            .iter()
            .find(|g| g.id == "phantom-pizzeria")
            .expect("phantom-pizzeria must exist");
        let files = list_files(pizzeria);
        let (game_js_path, _) = files
            .iter()
            .find(|(_, label)| label == "game.js")
            .expect("game.js must be listed");
        let original =
            fs::read_to_string(game_js_path).expect("must be able to read the real game.js");
        let _guard = RestoreOnDrop {
            path: game_js_path.clone(),
            original: original.clone(),
        };
        let probe = format!("{original}\n// phantomplay-studio-round-trip-test-marker\n");
        fs::write(game_js_path, &probe).expect("must be able to write the real game.js");
        let read_back =
            fs::read_to_string(game_js_path).expect("must be able to re-read after writing");
        assert_eq!(
            read_back, probe,
            "what was written must be exactly what gets read back — no dev/normal-mode-style indirection"
        );
    }

    #[test]
    fn vespergate_mod_manifest_is_real_and_has_a_healthy_mod_count() {
        let mods = read_mod_manifest("vespergate");
        assert!(
            mods.len() >= 10 && mods.len() <= 15,
            "expected 10-15 flagship mods, got {}",
            mods.len()
        );
        for m in &mods {
            let mod_path = project_mods_dir("vespergate").join(&m.file);
            assert!(
                mod_path.exists(),
                "manifest references {} but the file doesn't exist on disk",
                m.file
            );
        }
    }

    #[test]
    fn store_cards_pull_real_blurbs_from_kernel_upgraded_games() {
        let games = list_games();
        let crown = games
            .iter()
            .find(|g| g.id == "crown-circuit")
            .expect("crown-circuit.html must exist");
        let blurb = crown.blurb.as_ref().expect("crown-circuit has a phantomGameKernel config and should yield a real blurb, not a fallback");
        assert_eq!(blurb.title, "Crown Circuit");
        assert!(
            !blurb.genre.is_empty(),
            "genre should be extracted from the kernel config"
        );
        assert!(
            !blurb.fantasy.is_empty(),
            "fantasy one-liner should be extracted from the kernel config"
        );

        let untouched = games
            .iter()
            .find(|g| g.id == "neon-drift")
            .expect("neon-drift.html must exist");
        assert!(
            untouched.blurb.is_none(),
            "a game without the kernel upgrade must fall back to a plain title, not a fabricated blurb"
        );
    }

    #[test]
    fn inject_dev_scripts_adds_mod_loader_and_hot_reload_poll() {
        let html = br#"<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'"></head><body>hi</body></html>"#.to_vec();
        let out = String::from_utf8(inject_dev_scripts(html, "vespergate")).unwrap();
        assert!(out.contains("/shared/modLoader.js"));
        assert!(out.contains("/__pm_version"));
        assert!(out.contains("data-pm-game-id"));
        assert!(out.contains("data-pm-native"));
        assert!(out.contains("__PHANTOMPLAY_MOD_BOOTSTRAP__"));
        assert!(out.contains("/__pm_version.js"));
        assert!(out.contains("script-src 'nonce-phantomplay-native-shell' 'self'"));
        assert!(out.contains("<script nonce=\"phantomplay-native-shell\">"));
        assert!(!out.contains("script-src 'unsafe-inline'"));
    }

    #[test]
    fn every_game_has_working_universal_mod_controls() {
        let mods = read_available_mods("phantom-strike");
        for id in [
            "universal_slowmo",
            "universal_crt",
            "universal_bigcursor",
            "universal_mute",
            "universal_zoom",
        ] {
            assert!(mods.iter().any(|entry| entry.id == id), "missing {id}");
        }
    }

    #[test]
    fn enabled_mod_state_rejects_unknown_ids() {
        let sanitized = sanitize_enabled_mods(
            "phantom-strike",
            vec![
                "universal_slowmo".to_string(),
                "made_up_mod".to_string(),
                "universal_slowmo".to_string(),
            ],
        );
        assert_eq!(sanitized, vec!["universal_slowmo"]);
    }

    #[test]
    fn runtime_detection_reports_real_renderer_and_host_contract() {
        let games = list_games();
        for game_id in FLAGSHIP_UNREAL_GAME_IDS {
            assert_eq!(
                games.iter().filter(|game| game.id == game_id).count(),
                1,
                "{game_id} should appear exactly once"
            );
            let game = games
                .iter()
                .find(|game| game.id == game_id)
                .unwrap_or_else(|| panic!("{game_id} must exist"));
            assert!(game.is_dir);
            assert_eq!(game.runtime.renderer, "Unreal Engine 5");
            assert_eq!(game.runtime.engine, "Unreal Engine 5.8");
            assert!(game.runtime.file_count >= 5);
            assert!(game.runtime.total_bytes > 10_000);
            assert!(game.runtime.host_bridge);
            assert!(game.runtime.native);
            assert!(game_entry_path(game).is_none());
        }
    }

    #[test]
    fn flagships_expose_unreal_sources_without_removing_other_runtimes() {
        let games = list_games();
        for game_id in FLAGSHIP_UNREAL_GAME_IDS {
            let game = games
                .iter()
                .find(|game| game.id == game_id)
                .unwrap_or_else(|| panic!("{game_id} must exist"));
            assert_eq!(game.runtime.renderer, "Unreal Engine 5");
            assert_eq!(game.runtime.engine, "Unreal Engine 5.8");
            assert!(game.runtime.native);
            let labels: Vec<String> = list_files(game)
                .into_iter()
                .map(|(_, label)| label)
                .collect();
            assert!(
                labels
                    .iter()
                    .any(|label| label.starts_with("unreal/Source/PhantomGames/Private/")),
                "labels={labels:?}"
            );
            assert!(
                labels.contains(
                    &"unreal/Source/PhantomGames/Private/Core/PhantomRouterGameMode.cpp"
                        .to_string()
                ),
                "labels={labels:?}"
            );
            assert!(unreal_player_path(game_id).is_some_and(|path| {
                path.parent()
                    .is_some_and(|parent| parent.ends_with(game_id))
            }));
        }
        let vespergate = games
            .iter()
            .find(|game| game.id == "vespergate")
            .expect("vespergate must remain in the playable web catalog");
        assert!(!vespergate.runtime.native);
        assert!(game_entry_path(vespergate).is_some());
        assert!(
            native_runtime_dir()
                .join("phantomplay_native")
                .join("runtime.py")
                .is_file()
        );
    }

    #[test]
    fn cubetown_prefers_unreal_while_preserving_its_web_source() {
        let games = list_games();
        let cubetown = games
            .iter()
            .find(|game| game.id == "cubetown")
            .expect("cubetown must remain in the catalog");
        assert_eq!(cubetown.runtime.renderer, "Unreal Engine 5");
        assert_eq!(cubetown.runtime.engine, "Unreal Engine 5.8");
        assert!(cubetown.runtime.native);
        assert!(game_entry_path(cubetown).is_none());
        let labels: Vec<String> = list_files(cubetown)
            .into_iter()
            .map(|(_, label)| label)
            .collect();
        assert!(
            labels.contains(
                &"unreal/Source/PhantomGames/Private/Cubetown/CubetownDirector.cpp".to_string()
            ),
            "labels={labels:?}"
        );
        assert!(
            unreal_player_path("cubetown")
                .is_some_and(|path| path.ends_with("cubetown/Cubetown.exe"))
        );
    }

    #[test]
    fn installed_buildset_marker_promotes_the_desktop_game_library() {
        let root = std::env::temp_dir().join(format!(
            "phantomplay-installed-buildset-{}",
            std::process::id()
        ));
        let installed = root.join("Games").join("Unreal").join("Windows");
        let project = root
            .join("repo")
            .join("packages")
            .join("phantom-games-unreal");
        fs::create_dir_all(&installed).unwrap();
        fs::write(installed.join("PHANTOMPLAY_BUILDSET.json"), b"{}").unwrap();
        assert_eq!(
            select_unreal_builds_dir(None, installed.clone(), project.clone()),
            installed
        );
        let override_dir = root.join("override");
        assert_eq!(
            select_unreal_builds_dir(Some(override_dir.clone()), root.join("unused"), project),
            override_dir
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn engine_detection_keeps_unreal_unity_godot_and_web_distinct() {
        let root = std::env::temp_dir().join(format!(
            "phantomplay-engine-detection-{}",
            std::process::id()
        ));
        let unreal = root.join("unreal");
        let unity = root.join("unity");
        let godot = root.join("godot");
        let web = root.join("web");
        fs::create_dir_all(&unreal).unwrap();
        fs::create_dir_all(unity.join("Assets")).unwrap();
        fs::create_dir_all(unity.join("ProjectSettings")).unwrap();
        fs::create_dir_all(&godot).unwrap();
        fs::create_dir_all(&web).unwrap();
        fs::write(unreal.join("Game.uproject"), b"{}").unwrap();
        fs::write(godot.join("project.godot"), b"[application]").unwrap();
        fs::write(
            web.join("index.html"),
            b"<canvas></canvas><script>getContext('2d')</script>",
        )
        .unwrap();
        assert_eq!(detect_runtime(&unreal, true).renderer, "Unreal Engine");
        assert_eq!(detect_runtime(&unity, true).renderer, "Unity");
        assert_eq!(detect_runtime(&godot, true).renderer, "Godot");
        assert_eq!(detect_runtime(&web, true).renderer, "Canvas2D");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn epic_launcher_manifest_discovers_unreal_on_any_drive() {
        let root = std::env::temp_dir().join(format!(
            "phantomplay-epic-manifest-detection-{}",
            std::process::id()
        ));
        let engine_root = root.join("UE_5.8");
        let editor = unreal_editor_from_root(engine_root.clone());
        fs::create_dir_all(editor.parent().unwrap()).unwrap();
        fs::write(&editor, b"").unwrap();
        let manifests = root.join("Epic").join("Manifests");
        fs::create_dir_all(&manifests).unwrap();
        let manifest = serde_json::json!({
            "InstallLocation": engine_root,
            "LaunchExecutable": "Engine/Binaries/Win64/UnrealEditor.exe",
            "AppName": "UE_5.8",
            "AppCategories": ["engines/ue5"]
        });
        fs::write(
            manifests.join("UE_5.8.item"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        assert_eq!(
            find_unreal_editor_from_epic_manifests(&manifests),
            Some(editor)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn game_asset_resolver_blocks_escape_paths() {
        let root = games_dir();
        let safe = safe_game_asset(&root, "vespergate/index.html")
            .expect("known web game entry should resolve");
        assert!(
            safe.ends_with("vespergate\\index.html") || safe.ends_with("vespergate/index.html")
        );
        assert!(safe.starts_with(root.canonicalize().unwrap()));
        assert!(safe_game_asset(&root, "../server/src/index.ts").is_none());
        assert!(safe_game_asset(&root, "%2e%2e/server/src/index.ts").is_none());
        assert!(safe_game_asset(&root, "C:/Windows/win.ini").is_none());
        assert!(safe_game_asset(&root, "vespergate\\..\\court-vision.html").is_none());
    }

    #[test]
    fn shipped_studio_is_single_window_and_product_branded() {
        let studio_source = include_str!("studio.rs").to_ascii_lowercase();
        assert_eq!(env!("CARGO_PKG_NAME"), "phantomplay");
        assert!(!studio_source.contains("dioxus"));
        assert!(!studio_source.contains("new_window"));
        assert!(studio_source.contains("embedded viewport"));
        assert!(studio_source.contains("no legacy fallback"));
        assert!(studio_source.contains("own window"));
        assert!(studio_source.contains("phantomplay"));
        assert!(!PHANTOMPLAY_INDEX.to_ascii_lowercase().contains("dioxus"));
        assert!(PHANTOMPLAY_INDEX.contains("<title>PhantomPlay</title>"));
        assert!(brand_data_uri().starts_with("data:image/png;base64,"));
    }

    #[test]
    fn dev_room_code_generation_does_not_depend_on_cross_origin_fetch() {
        assert!(DEVROOM_HTML.contains("crypto.getRandomValues"));
        assert!(DEVROOM_HTML.contains("__PHANTOMPLAY_API_ORIGIN__"));
        assert!(!DEVROOM_HTML.contains("NEW_CODE_URL"));
        assert!(!DEVROOM_HTML.contains("/api/phantomplay/devroom/new-code"));
    }
}

/// Standalone player window — this is what actually lets someone play a
/// PhantomPlay game with zero PhantomForce account/server dependency: the
/// iframe loads through a custom `phantomplay-game://` protocol whose
/// handler (registered per-window in `play_game`, below) reads real files
/// straight off `app/games/` — the same root the editor pane edits — and
/// injects the shared mod loader + a hot-reload poll script into HTML
/// responses so edits saved while playing show up live.
const PLAYER_STYLE: &str = "html,body,#main,iframe{margin:0;height:100%;width:100%;border:0;background:#020907;overflow:hidden;}";

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

#[cfg(any())]
#[component]
fn App() -> Element {
    let games = use_signal(list_games);
    let mut selected_game = use_signal(|| None::<usize>);
    let mut files = use_signal(Vec::<(PathBuf, String)>::new);
    let mut selected_file = use_signal(|| None::<usize>);
    let mut editor_content = use_signal(String::new);
    let mut status = use_signal(|| {
        format!(
            "{} game(s) found in {}",
            games().len(),
            games_dir().display()
        )
    });
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
    let mut store_query = use_signal(String::new);

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
        let Some(game) = games().get(idx).cloned() else {
            return;
        };
        let entry_name = if game.is_dir {
            format!("{}/index.html", game.id)
        } else {
            format!("{}.html", game.id)
        };
        let entry_check = if game.is_dir {
            game.path.join("index.html")
        } else {
            game.path.clone()
        };
        if !entry_check.exists() {
            status.set(format!("{} has no index.html to play.", game.id));
            return;
        }

        let root = games_dir();
        let game_id_for_handler = game.id.clone();
        let hot_reload_version = watch_for_hot_reload(game.path.clone());

        let handler =
            move |_id: dioxus::desktop::wry::WebViewId<'_>,
                  request: dioxus::desktop::wry::http::Request<Vec<u8>>| {
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
        status.set(format!(
            "Launched {} — hot reload + mods are live in this window.",
            game.id
        ));
    };

    let open_dev_room = move |_| {
        let handler =
            move |_id: dioxus::desktop::wry::WebViewId<'_>,
                  _request: dioxus::desktop::wry::http::Request<Vec<u8>>| {
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
        let Some(game) = games().get(idx).cloned() else {
            return;
        };
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
                        status.set(format!(
                            "Saved {} — any open player window hot-reloads within a second.",
                            path.display()
                        ));
                    }
                    Err(err) => status.set(format!("Save failed for {}: {err}", path.display())),
                }
            }
        }
    };

    let ask_ai = move |_| {
        let Some(game_idx) = selected_game() else {
            return;
        };
        let Some(file_idx) = selected_file() else {
            return;
        };
        let Some(game) = games().get(game_idx).cloned() else {
            return;
        };
        let Some((_, file_label)) = files().get(file_idx).cloned() else {
            return;
        };
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
            match request_ai_edit_at(
                &phantomplay_api_origin(),
                AiEditRequestBody {
                    game_id: game.id.clone(),
                    file_path: file_label.clone(),
                    file_content: content,
                    instruction,
                    cwd: game.path.display().to_string(),
                    engine: game.runtime.renderer.clone(),
                    project_files: files()
                        .iter()
                        .map(|(_, label)| label.clone())
                        .take(160)
                        .collect(),
                    provider: "auto".to_string(),
                    model: String::new(),
                    fallback_provider: "codex".to_string(),
                    allow_fallbacks: true,
                    timeout_ms: 120_000,
                },
            )
            .await
            {
                Ok(result) => {
                    editor_content.set(result.new_content.clone());
                    dirty.set(true);
                    if let Some(idx) = selected_file() {
                        if let Some((path, _)) = files().get(idx).cloned() {
                            match fs::write(&path, &result.new_content) {
                                Ok(()) => {
                                    dirty.set(false);
                                    status.set(format!(
                                        "AI updated {} through {} / {} and saved it — hot reload will pick it up.",
                                        path.display(),
                                        result.provider,
                                        result.model,
                                    ));
                                }
                                Err(err) => status.set(format!(
                                    "AI edit produced new content but saving failed: {err}"
                                )),
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
    nav { class: "games-pane store-pane",
                        h2 { "Store — {games().len()} games" }
                        input {
                            class: "store-search",
                            placeholder: "Search the catalog…",
                            value: "{store_query}",
                            oninput: move |evt| store_query.set(evt.value()),
                        }
                        for (idx , game) in games().iter().cloned().enumerate() {
                            if store_query().trim().is_empty()
                                || game.id.to_lowercase().contains(&store_query().to_lowercase())
                                || game.blurb.as_ref().is_some_and(|b| b.title.to_lowercase().contains(&store_query().to_lowercase()))
                            {
                                div {
                                    class: if selected_game() == Some(idx) { "store-card is-active" } else { "store-card" },
                                    onclick: move |_| open_game(idx),
                                    div { class: "store-card-top",
                                        span { class: "store-card-title", "{game.blurb.as_ref().map(|b| b.title.clone()).unwrap_or_else(|| game.id.clone())}" }
                                        if game.is_dir { span { class: "tag", "dir" } }
                                    }
                                    if let Some(blurb) = game.blurb.as_ref() {
                                        if !blurb.genre.is_empty() { span { class: "store-card-genre", "{blurb.genre}" } }
                                        if !blurb.fantasy.is_empty() { p { class: "store-card-blurb", "{blurb.fantasy}" } }
                                    }
                                    div { class: "store-card-actions",
                                        button { class: "mods-btn", onclick: move |evt| { evt.stop_propagation(); open_mods_panel(idx); }, title: "Quick-load mods", "🧩" }
                                        button { class: "edit-btn", onclick: move |evt| { evt.stop_propagation(); open_game(idx); }, title: "Edit source", "✎" }
                                        button { class: "play-btn", onclick: move |evt| { evt.stop_propagation(); play_game(idx); }, title: "Play standalone — no account, no server", "▶ Play" }
                                    }
                                }
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
                                "No game-specific mods are available yet. Universal tools remain available in the desktop Mods tab."
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
                        div { class: "mods-hint", "Selections here are the authoritative mod controls for the embedded game." }
                    }
                }
            }
        }
}

#[cfg(any())]
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
    .store-pane { width: 320px; }
    .store-search {
        width: 100%;
        margin: 2px 0 10px;
        padding: 8px 10px;
        border: 1px solid #143324;
        border-radius: 8px;
        background: #030f0a;
        color: #eafff3;
        font: 12px ui-monospace, monospace;
    }
    .store-search:focus { outline: none; border-color: #2cff9b88; }
    .store-card {
        border: 1px solid #143324;
        border-radius: 10px;
        background: #061a12;
        padding: 10px 11px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: border-color 120ms ease, background 120ms ease;
    }
    .store-card:hover { background: #0c2318; }
    .store-card.is-active { border-color: #4bffa3aa; background: #0c2318; }
    .store-card-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .store-card-title { font-weight: 800; font-size: 13px; color: #eafff3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .store-card-genre {
        display: inline-block;
        margin-top: 5px;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid #2cff9b44;
        color: #7dffbd;
        font: 700 9px ui-monospace, monospace;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .store-card-blurb {
        margin: 6px 0 0;
        font-size: 11px;
        line-height: 1.4;
        color: #8fb3a1;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .store-card-actions { display: flex; gap: 6px; margin-top: 9px; }
    .store-card-actions .play-btn { flex: 1; text-align: center; font-weight: 800; }
    .edit-btn {
        flex-shrink: 0;
        border: 1px solid #2cff9b55;
        border-radius: 6px;
        background: #0c2318;
        color: #7dffbd;
        font-size: 11px;
        padding: 3px 8px;
        cursor: pointer;
    }
    .edit-btn:hover { background: #14432c; color: #b7ffd6; }
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
