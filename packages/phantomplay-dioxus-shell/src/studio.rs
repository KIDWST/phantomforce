use super::studio_icons::{
    Activity, Bot, Bug, Check, CircleAlert, CirclePlay, CodeXml, Columns2, Cpu, Eye, EyeOff,
    FileCode, Files, FolderOpen, FolderPlus, Gauge, HardDrive, Import, Keyboard, Maximize2,
    Minimize2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Play, Puzzle, Radio,
    RefreshCw, Save, Search, Settings2, Star, WandSparkles, Wifi, WifiOff,
};
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq)]
enum WorkspaceView {
    Play,
    Code,
    Split,
}

#[derive(Clone, Copy, PartialEq)]
enum ToolTab {
    Ai,
    Runtime,
    Mods,
    Network,
    Settings,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct StudioSettings {
    ai_provider: String,
    ai_model: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct AiModelOption {
    id: String,
    name: String,
}

#[derive(Clone, Debug, Deserialize, Default)]
struct AiModelsResponseBody {
    ok: bool,
    configured: Option<bool>,
    dynamic: Option<bool>,
    models: Option<Vec<AiModelOption>>,
    error: Option<String>,
}

struct AiModelsOutput {
    models: Vec<AiModelOption>,
    configured: bool,
    dynamic: bool,
    error: Option<String>,
}

impl Default for StudioSettings {
    fn default() -> Self {
        Self {
            ai_provider: "auto".to_string(),
            ai_model: String::new(),
        }
    }
}

fn normalize_ai_provider(value: &str) -> String {
    match value {
        "codex" | "claude" | "openrouter" | "local" => value.to_string(),
        _ => "auto".to_string(),
    }
}

fn studio_settings_path() -> PathBuf {
    phantomplay_data_root().join("studio-settings.json")
}

fn normalize_studio_settings(settings: StudioSettings) -> StudioSettings {
    let ai_provider = normalize_ai_provider(&settings.ai_provider);
    StudioSettings {
        ai_model: settings.ai_model.trim().to_string(),
        ai_provider,
    }
}

fn load_studio_settings() -> StudioSettings {
    fs::read_to_string(studio_settings_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<StudioSettings>(&raw).ok())
        .map(normalize_studio_settings)
        .unwrap_or_default()
}

fn save_studio_settings(provider: &str, model: &str) {
    let settings = StudioSettings {
        ai_provider: normalize_ai_provider(provider),
        ai_model: model.trim().to_string(),
    };
    let root = phantomplay_data_root();
    let _ = fs::create_dir_all(&root);
    if let Ok(bytes) = serde_json::to_vec_pretty(&settings) {
        let _ = fs::write(root.join("studio-settings.json"), bytes);
    }
}

fn model_option(id: &str, name: &str) -> AiModelOption {
    AiModelOption {
        id: id.to_string(),
        name: name.to_string(),
    }
}

fn fallback_ai_model_options(provider: &str) -> Vec<AiModelOption> {
    match provider {
        "codex" => vec![
            model_option("", "Codex default"),
            model_option("gpt-5-codex", "GPT-5 Codex"),
            model_option("gpt-5", "GPT-5"),
        ],
        "claude" => vec![
            model_option("", "Claude default"),
            model_option("sonnet", "Claude Sonnet"),
            model_option("opus", "Claude Opus"),
        ],
        "openrouter" => vec![
            model_option("z-ai/glm-5.2", "GLM 5.2"),
            model_option("openrouter/free", "OpenRouter Free Router"),
            model_option("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5"),
            model_option("google/gemini-3-pro", "Gemini 3 Pro"),
            model_option("deepseek/deepseek-chat-v3.1", "DeepSeek V3.1"),
            model_option("qwen/qwen3-coder", "Qwen3 Coder"),
        ],
        "local" => vec![
            model_option("", "Auto local model"),
            model_option("llama3.1", "llama3.1"),
            model_option("qwen2.5-coder", "qwen2.5-coder"),
            model_option("deepseek-coder", "deepseek-coder"),
        ],
        _ => vec![model_option("", "Automatic model routing")],
    }
}

fn default_ai_model_for_provider(provider: &str) -> String {
    fallback_ai_model_options(provider)
        .into_iter()
        .find(|option| !option.id.is_empty())
        .map(|option| option.id)
        .unwrap_or_default()
}

fn ai_model_dropdown_options(
    mut options: Vec<AiModelOption>,
    selected_model: &str,
) -> Vec<AiModelOption> {
    let selected_model = selected_model.trim();
    if !selected_model.is_empty() && !options.iter().any(|option| option.id == selected_model) {
        options.insert(
            0,
            model_option(selected_model, &format!("Saved model: {selected_model}")),
        );
    }
    if options.is_empty() {
        options.push(model_option("", "Provider default"));
    }
    options
}

fn ai_model_label(options: &[AiModelOption], model: &str) -> String {
    if model.trim().is_empty() {
        return "Provider default".to_string();
    }
    options
        .iter()
        .find(|option| option.id == model)
        .map(|option| option.name.clone())
        .unwrap_or_else(|| model.to_string())
}

fn ai_route_status_text(
    provider: &str,
    model: &str,
    options: &[AiModelOption],
    configured: Option<bool>,
    loading: bool,
    error: &Option<String>,
) -> String {
    if configured == Some(false) {
        return error
            .clone()
            .unwrap_or_else(|| "Needs configuration".to_string());
    }
    if loading {
        return "Refreshing model list...".to_string();
    }
    if error.is_some() && provider == "openrouter" {
        return error
            .clone()
            .unwrap_or_else(|| "Needs configuration".to_string());
    }
    if provider == "auto" {
        return "Automatic route will choose the model".to_string();
    }
    format!("Selected model: {}", ai_model_label(options, model))
}

async fn request_ai_models(provider: String) -> AiModelsOutput {
    let fallback = fallback_ai_model_options(&provider);
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return AiModelsOutput {
                models: fallback,
                configured: false,
                dynamic: false,
                error: Some(error.to_string()),
            };
        }
    };
    let response = client
        .get(format!(
            "{}/api/phantomplay/ai-models?provider={provider}",
            phantomplay_api_origin()
        ))
        .send()
        .await;
    let Ok(response) = response else {
        return AiModelsOutput {
            models: fallback,
            configured: false,
            dynamic: false,
            error: Some("Local model service unavailable".to_string()),
        };
    };
    let parsed = response.json::<AiModelsResponseBody>().await;
    let Ok(parsed) = parsed else {
        return AiModelsOutput {
            models: fallback,
            configured: false,
            dynamic: false,
            error: Some("Local model service returned unreadable data".to_string()),
        };
    };
    let mut models = parsed.models.unwrap_or_default();
    if models.is_empty() {
        models = fallback;
    }
    AiModelsOutput {
        models,
        configured: parsed.configured.unwrap_or(parsed.ok),
        dynamic: parsed.dynamic.unwrap_or(false),
        error: parsed.error,
    }
}

fn preferred_file_index(files: &[(PathBuf, String)]) -> Option<usize> {
    [
        "game.js",
        "project.godot",
        "project.binary",
        "main.tscn",
        "index.html",
        "engine.js",
    ]
    .iter()
    .find_map(|preferred| files.iter().position(|(_, label)| label == preferred))
    .or_else(|| files.iter().position(|(_, label)| label.ends_with(".html")))
    .or((!files.is_empty()).then_some(0))
}

fn load_project_file(
    file_index: usize,
    files: Signal<Vec<(PathBuf, String)>>,
    mut selected_file: Signal<Option<usize>>,
    mut editor_content: Signal<String>,
    mut dirty: Signal<bool>,
    mut status: Signal<String>,
) {
    let Some((path, _)) = files().get(file_index).cloned() else {
        return;
    };
    match fs::read_to_string(&path) {
        Ok(content) => {
            selected_file.set(Some(file_index));
            editor_content.set(content);
            dirty.set(false);
            status.set(format!("Loaded {}", path.display()));
        }
        Err(error) => status.set(format!("Could not read {}: {error}", path.display())),
    }
}

fn save_active_file(
    games: Signal<Vec<GameEntry>>,
    selected_game: Signal<Option<usize>>,
    selected_file: Signal<Option<usize>>,
    files: Signal<Vec<(PathBuf, String)>>,
    editor_content: Signal<String>,
    mut dirty: Signal<bool>,
    mut status: Signal<String>,
) {
    let Some(file_index) = selected_file() else {
        status.set("Choose a source file before saving.".to_string());
        return;
    };
    let Some((path, _)) = files().get(file_index).cloned() else {
        status.set("The selected source file is no longer available.".to_string());
        return;
    };
    let Some(game) = current_game(games, selected_game) else {
        status.set("Choose a project before saving.".to_string());
        return;
    };
    let history_root = project_history_root(&game, &path);
    match project_history::write_file(
        &history_root,
        &path,
        editor_content().as_bytes(),
        format!("Save {}", path.display()),
    ) {
        Ok(summary) => {
            dirty.set(false);
            status.set(format!(
                "Saved {} with recoverable history ({} changed file). The game will hot reload.",
                path.display(),
                summary.added + summary.replaced
            ));
        }
        Err(error) => status.set(format!("Save failed for {}: {error}", path.display())),
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_history_action(
    project_root: Option<PathBuf>,
    undoing: bool,
    selected_file: Signal<Option<usize>>,
    files: Signal<Vec<(PathBuf, String)>>,
    editor_content: Signal<String>,
    dirty: Signal<bool>,
    mut status: Signal<String>,
    mut reload_token: Signal<u64>,
) {
    if dirty() {
        status.set("Save or discard the current edit before changing project history.".to_string());
        return;
    }
    let Some(project_root) = project_root else {
        status.set("Choose a project file before using Undo or Redo.".to_string());
        return;
    };
    let result = if undoing {
        project_history::undo(&project_root)
    } else {
        project_history::redo(&project_root)
    };
    match result {
        Ok(action) => {
            if let Some(file_index) = selected_file() {
                load_project_file(
                    file_index,
                    files,
                    selected_file,
                    editor_content,
                    dirty,
                    status,
                );
            }
            reload_token.set(reload_token().wrapping_add(1));
            let conflict_note = if action.recovered_conflicts == 0 {
                String::new()
            } else {
                format!(
                    " PhantomPlay preserved {} newer conflicting file(s) in recovery storage.",
                    action.recovered_conflicts
                )
            };
            status.set(format!(
                "{} {}.{}",
                if undoing { "Undid" } else { "Redid" },
                action.label,
                conflict_note
            ));
        }
        Err(error) => status.set(format!(
            "{} failed: {error}",
            if undoing { "Undo" } else { "Redo" }
        )),
    }
}

fn current_game(
    games: Signal<Vec<GameEntry>>,
    selected_game: Signal<Option<usize>>,
) -> Option<GameEntry> {
    selected_game().and_then(|index| games().get(index).cloned())
}

fn slugify_game_id(raw: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in raw.chars().flat_map(|ch| ch.to_lowercase()) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if matches!(ch, '-' | '_' | ' ' | '.') && !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "imported-game".to_string()
    } else {
        out
    }
}

fn unique_import_target(base_id: &str, is_dir: bool) -> (String, PathBuf) {
    let id = slugify_game_id(base_id);
    for suffix in 0.. {
        let candidate_id = if suffix == 0 {
            id.clone()
        } else {
            format!("{id}-{suffix}")
        };
        let candidate_path = if is_dir {
            games_dir().join(&candidate_id)
        } else {
            games_dir().join(format!("{candidate_id}.html"))
        };
        if !candidate_path.exists() {
            return (candidate_id, candidate_path);
        }
    }
    unreachable!()
}

#[cfg(test)]
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
                if name != ".git" {
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

fn import_game_project(source: &Path) -> Result<String, String> {
    if !source.exists() {
        return Err(format!("{} does not exist.", source.display()));
    }
    if source.is_dir() {
        let base_id = source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("imported-game");
        let (id, target) = unique_import_target(base_id, true);
        let source_is_native = is_supported_native_project_tree(source);
        if !source.join("index.html").is_file() && !source_is_native {
            return Err(format!(
                "{} needs an index.html, Unreal, Unity, Godot, or declared native runtime.",
                source.display()
            ));
        }
        if let Err(error) = project_history::import_into_empty_project(&target, source) {
            let _ = fs::remove_dir(&target);
            return Err(error);
        }
        return Ok(id);
    }
    if source.extension().and_then(|ext| ext.to_str()) == Some("zip") {
        return import_zip_game_project(source);
    }
    if source.extension().and_then(|ext| ext.to_str()) != Some("html") {
        return Err(format!(
            "{} is not a supported game file. Drop a folder, .zip, or .html game.",
            source.display()
        ));
    }
    let base_id = source
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("imported-game");
    let (id, target) = unique_import_target(base_id, false);
    project_history::import_paths(&games_dir(), &[source.to_path_buf()], Some(&target))?;
    Ok(id)
}

fn project_history_root(game: &GameEntry, file: &Path) -> PathBuf {
    if game.path.exists() && (file == game.path || file.starts_with(&game.path)) {
        return project_history::project_root_for_path(&game.path, game.is_dir);
    }
    let unreal_root = unreal_project_dir();
    if file.starts_with(&unreal_root) {
        return unreal_root;
    }
    let native_root = native_runtime_dir();
    if file.starts_with(&native_root) {
        return native_root;
    }
    file.parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| game.path.clone())
}

fn ai_project_cwd(project_root: &Path) -> PathBuf {
    if project_root.is_dir() {
        project_root.to_path_buf()
    } else {
        project_root
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(phantomplay_live_root)
    }
}

fn validate_ai_edit_candidate(path: &Path, original: &str, revised: &str) -> Result<(), String> {
    if revised.trim().is_empty() {
        return Err("Phantom AI returned an empty file, so nothing was saved.".to_string());
    }
    if revised.contains('\0') {
        return Err("Phantom AI returned invalid file content, so nothing was saved.".to_string());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension == "json" {
        serde_json::from_str::<serde_json::Value>(revised)
            .map_err(|error| format!("Phantom AI returned invalid JSON: {error}"))?;
    }
    if extension == "html"
        && original.to_ascii_lowercase().contains("<html")
        && !revised.to_ascii_lowercase().contains("<html")
    {
        return Err("Phantom AI dropped the HTML document root, so nothing was saved.".to_string());
    }
    Ok(())
}

fn ai_failure_activity(error: &str) -> String {
    error
        .split(" Automatic fallbacks also failed:")
        .next()
        .unwrap_or(error)
        .trim()
        .to_string()
}

fn import_zip_game_project(source: &Path) -> Result<String, String> {
    let base_id = source
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("imported-game");
    let (id, target) = unique_import_target(base_id, true);
    if let Err(error) = project_history::import_into_empty_project(&target, source) {
        let _ = fs::remove_dir(&target);
        return Err(error);
    }
    if !target.join("index.html").is_file() && !is_supported_native_project_tree(&target) {
        let _ = project_history::undo(&target);
        let _ = fs::remove_dir(&target);
        return Err(format!(
            "{} did not contain a supported web, Unreal, Unity, Godot, or declared native project.",
            source.display()
        ));
    }
    Ok(id)
}

#[component]
pub(crate) fn Studio() -> Element {
    let initial_settings = load_studio_settings();
    let initial_ai_provider = normalize_ai_provider(&initial_settings.ai_provider);
    let initial_ai_model = initial_settings.ai_model.trim().to_string();
    let mut games = use_signal(list_games);
    let mut selected_game = use_signal(|| None::<usize>);
    let mut files = use_signal(Vec::<(PathBuf, String)>::new);
    let mut selected_file = use_signal(|| None::<usize>);
    let mut editor_content = use_signal(String::new);
    let mut dirty = use_signal(|| false);
    let mut playing_entry = use_signal(|| None::<String>);
    let mut reload_token = use_signal(|| 0_u64);
    let mut workspace_view = use_signal(|| WorkspaceView::Play);
    let mut tool_tab = use_signal(|| ToolTab::Ai);
    let mut focus_mode = use_signal(|| false);
    let mut project_rail_open = use_signal(|| true);
    let mut tool_dock_open = use_signal(|| true);
    let mut store_query = use_signal(String::new);
    let mut show_hidden = use_signal(|| false);
    let mut import_dragging = use_signal(|| false);
    let mut status = use_signal(|| {
        format!(
            "{} projects available in {}",
            games().len(),
            games_dir().display()
        )
    });

    let mut ai_instruction = use_signal(String::new);
    let mut ai_busy = use_signal(|| false);
    let mut ai_activity = use_signal(|| "Ready for direct game edits.".to_string());
    let mut ai_provider = use_signal(move || initial_ai_provider.clone());
    let mut ai_model = use_signal(move || initial_ai_model.clone());
    let mut ai_model_options = use_signal({
        let provider = initial_settings.ai_provider.clone();
        move || fallback_ai_model_options(&provider)
    });
    let mut ai_models_loading = use_signal(|| false);
    let mut ai_models_configured = use_signal(|| None::<bool>);
    let mut ai_models_dynamic = use_signal(|| false);
    let mut ai_models_error = use_signal(|| None::<String>);
    let mut api_online = use_signal(|| None::<bool>);

    let mut mods_game_id = use_signal(String::new);
    let mut mods_list = use_signal(Vec::<ModEntry>::new);
    let mut mods_enabled = use_signal(Vec::<String>::new);
    let mut new_mod_name = use_signal(String::new);
    let mut new_mod_desc = use_signal(String::new);

    use_effect(move || {
        spawn(async move {
            api_online.set(Some(check_api_health().await));
        });
    });

    use_effect(move || {
        let provider = ai_provider();
        ai_model_options.set(fallback_ai_model_options(&provider));
        ai_models_loading.set(true);
        ai_models_configured.set(None);
        ai_models_dynamic.set(false);
        ai_models_error.set(None);
        let requested_provider = provider.clone();
        spawn(async move {
            let output = request_ai_models(provider).await;
            if ai_provider() != requested_provider {
                return;
            }
            ai_model_options.set(output.models);
            ai_models_configured.set(Some(output.configured));
            ai_models_dynamic.set(output.dynamic);
            ai_models_error.set(output.error);
            ai_models_loading.set(false);
        });
    });

    use_effect(move || {
        if selected_game().is_some() {
            return;
        }
        let initial_index = games()
            .iter()
            .position(|game| game.id == "vespergate")
            .or((!games().is_empty()).then_some(0));
        let Some(index) = initial_index else {
            status.set(format!("No games found in {}", games_dir().display()));
            return;
        };
        let Some(game) = games().get(index).cloned() else {
            return;
        };
        let project_files = list_files(&game);
        let first_file = preferred_file_index(&project_files);
        selected_game.set(Some(index));
        files.set(project_files);
        playing_entry.set(
            game_entry_path(&game)
                .as_ref()
                .map(|_| game_entry_name(&game)),
        );
        mods_game_id.set(game.id.clone());
        mods_list.set(read_available_mods(&game.id));
        mods_enabled.set(read_enabled_mods(&game.id));
        if let Some(file_index) = first_file {
            load_project_file(
                file_index,
                files,
                selected_file,
                editor_content,
                dirty,
                status,
            );
        }
        let title = game
            .blurb
            .as_ref()
            .map(|blurb| blurb.title.as_str())
            .unwrap_or(game.id.as_str());
        status.set(if game_entry_path(&game).is_some() {
            format!("Playing {title} inside PhantomPlay. Auto reload is active.")
        } else {
            format!("{title} is a native-only source project. Open Code to edit; no generated web preview was created.")
        });
    });

    let mut select_project = move |index: usize| {
        let Some(game) = games().get(index).cloned() else {
            return;
        };
        let project_files = list_files(&game);
        let first_file = preferred_file_index(&project_files);
        selected_game.set(Some(index));
        files.set(project_files);
        selected_file.set(None);
        editor_content.set(String::new());
        dirty.set(false);
        mods_game_id.set(game.id.clone());
        mods_list.set(read_available_mods(&game.id));
        mods_enabled.set(read_enabled_mods(&game.id));
        if let Some(file_index) = first_file {
            load_project_file(
                file_index,
                files,
                selected_file,
                editor_content,
                dirty,
                status,
            );
        }
        status.set(format!(
            "Opened {} with {} source files.",
            game.id, game.runtime.file_count
        ));
    };

    let mut import_paths = move |paths: Vec<PathBuf>| {
        if paths.is_empty() {
            status.set("Drop a game folder, .zip, or standalone .html file to import.".to_string());
            return;
        }
        let mut imported_ids = Vec::new();
        let mut failures = Vec::new();
        for path in paths {
            match import_game_project(&path) {
                Ok(id) => imported_ids.push(id),
                Err(error) => failures.push(error),
            }
        }
        let refreshed = list_games();
        let selected_import = imported_ids.last().cloned();
        games.set(refreshed.clone());
        if let Some(imported_id) = selected_import
            && let Some(index) = refreshed.iter().position(|game| game.id == imported_id)
        {
            let game = refreshed[index].clone();
            let project_files = list_files(&game);
            let first_file = preferred_file_index(&project_files);
            selected_game.set(Some(index));
            files.set(project_files);
            selected_file.set(None);
            editor_content.set(String::new());
            dirty.set(false);
            playing_entry.set(
                game_entry_path(&game)
                    .as_ref()
                    .map(|_| game_entry_name(&game)),
            );
            mods_game_id.set(game.id.clone());
            mods_list.set(read_available_mods(&game.id));
            mods_enabled.set(read_enabled_mods(&game.id));
            if let Some(file_index) = first_file {
                load_project_file(
                    file_index,
                    files,
                    selected_file,
                    editor_content,
                    dirty,
                    status,
                );
            }
            reload_token.set(reload_token().wrapping_add(1));
        }
        if imported_ids.is_empty() {
            status.set(format!("Import failed: {}", failures.join(" ")));
        } else if failures.is_empty() {
            status.set(format!("Imported {} project(s).", imported_ids.len()));
        } else {
            status.set(format!(
                "Imported {} project(s); {} item(s) failed.",
                imported_ids.len(),
                failures.len()
            ));
        }
    };

    let mut launch_game = move |index: usize| {
        let Some(game) = games().get(index).cloned() else {
            return;
        };
        let entry_path = game_entry_path(&game);
        if entry_path.is_none() && !game.runtime.native {
            status.set(format!("{} does not have a playable entry file.", game.id));
            return;
        }

        let project_files = list_files(&game);
        let first_file = preferred_file_index(&project_files);
        selected_game.set(Some(index));
        files.set(project_files);
        selected_file.set(None);
        editor_content.set(String::new());
        dirty.set(false);
        mods_game_id.set(game.id.clone());
        mods_list.set(read_available_mods(&game.id));
        mods_enabled.set(read_enabled_mods(&game.id));
        if let Some(file_index) = first_file {
            load_project_file(
                file_index,
                files,
                selected_file,
                editor_content,
                dirty,
                status,
            );
        }
        playing_entry.set(entry_path.as_ref().map(|_| game_entry_name(&game)));
        reload_token.set(reload_token().wrapping_add(1));
        workspace_view.set(WorkspaceView::Play);
        let title = game
            .blurb
            .as_ref()
            .map(|blurb| blurb.title.as_str())
            .unwrap_or(game.id.as_str());
        if game.runtime.native {
            match launch_native_game(&game.id) {
                Ok(receipt) => status.set(format!(
                    "{title} launched in {} (PID {}). Its independent native window is now playing.",
                    receipt.engine, receipt.pid
                )),
                Err(error) => status.set(format!(
                    "{title} requires its assigned native build. {error} No legacy fallback was launched for this game."
                )),
            }
        } else {
            status.set(format!(
                "{title} is running in the embedded viewport with hot reload."
            ));
        }
    };

    let mut open_file = move |file_index: usize| {
        load_project_file(
            file_index,
            files,
            selected_file,
            editor_content,
            dirty,
            status,
        );
        workspace_view.set(WorkspaceView::Code);
    };

    let ask_ai = move |_| {
        let Some(game) = current_game(games, selected_game) else {
            status.set("Choose a project before asking Phantom AI.".to_string());
            ai_activity.set("Select a project first.".to_string());
            return;
        };
        let Some(file_index) = selected_file() else {
            status.set("Choose a source file before asking Phantom AI.".to_string());
            ai_activity.set("Select a source file first.".to_string());
            return;
        };
        let Some((path, file_label)) = files().get(file_index).cloned() else {
            return;
        };
        let instruction = ai_instruction();
        if instruction.trim().is_empty() {
            status.set("Describe the change you want Phantom AI to make.".to_string());
            ai_activity.set("Add an instruction for the exact change.".to_string());
            return;
        }

        let content = editor_content();
        let history_root = project_history_root(&game, &path);
        let cwd = ai_project_cwd(&history_root).display().to_string();
        let engine = game.runtime.renderer.clone();
        let native_runtime = game.runtime.native;
        let project_files = files()
            .iter()
            .map(|(_, label)| label.clone())
            .take(160)
            .collect::<Vec<_>>();
        let disk_content_before = fs::read_to_string(&path).ok();
        let provider = ai_provider();
        let model = ai_model();
        ai_busy.set(true);
        ai_activity.set(format!("Reviewing {file_label}..."));
        status.set(format!("Phantom AI is reviewing {file_label}."));
        let mut editor_content = editor_content;
        let mut dirty = dirty;
        let mut status = status;
        let mut ai_busy = ai_busy;
        let mut ai_activity = ai_activity;
        let mut reload_token = reload_token;
        spawn(async move {
            match request_ai_edit(AiEditRequestBody {
                game_id: game.id,
                file_path: file_label.clone(),
                file_content: content.clone(),
                instruction,
                cwd,
                engine,
                project_files,
                provider,
                model,
            })
            .await
            {
                Ok(result) if !result.changed || result.new_content == content => {
                    ai_activity.set("No file change returned.".to_string());
                    status.set(format!(
                        "Phantom AI reviewed {file_label} but returned no file changes."
                    ));
                }
                Ok(_) if fs::read_to_string(&path).ok() != disk_content_before => {
                    ai_activity.set("Source changed while AI worked. Nothing saved.".to_string());
                    status.set(format!(
                        "{file_label} changed while Phantom AI was working. The AI result was not saved; review the current file and retry."
                    ));
                }
                Ok(result) => {
                    ai_activity.set("Validating and saving the revision...".to_string());
                    match validate_ai_edit_candidate(&path, &content, &result.new_content).and_then(
                        |_| {
                            project_history::write_file(
                                &history_root,
                                &path,
                                result.new_content.as_bytes(),
                                format!("Phantom AI edit {file_label}"),
                            )
                        },
                    ) {
                        Ok(summary) => {
                            editor_content.set(result.new_content);
                            dirty.set(false);
                            reload_token.set(reload_token().wrapping_add(1));
                            let runtime_receipt = if native_runtime {
                                ai_activity
                                    .set("Saved. Native rebuild or relaunch is ready.".to_string());
                                "The source is saved; rebuild or relaunch the native game to load compiled changes."
                            } else {
                                ai_activity.set("Saved and hot reloaded.".to_string());
                                "The running preview was hot reloaded immediately."
                            };
                            status.set(format!(
                                "Phantom AI updated {file_label} through {} / {} and saved one recoverable revision ({} changed file). {runtime_receipt}",
                                result.provider,
                                result.model,
                                summary.added + summary.replaced,
                            ));
                        }
                        Err(error) => {
                            ai_activity.set("Edit held. The file was not saved.".to_string());
                            status.set(format!(
                                "Phantom AI returned an edit, but saving {file_label} failed: {error}"
                            ));
                        }
                    }
                }
                Err(error) => {
                    ai_activity.set(ai_failure_activity(&error));
                    status.set(format!("Phantom AI could not edit {file_label}: {error}"))
                }
            }
            ai_busy.set(false);
        });
    };

    let project = current_game(games, selected_game);
    let history_root = project.as_ref().and_then(|game| {
        selected_file().and_then(|index| {
            files()
                .get(index)
                .map(|(path, _)| project_history_root(game, path))
        })
    });
    let history_state = history_root
        .as_ref()
        .and_then(|root| project_history::history_state(root).ok())
        .unwrap_or_default();
    let can_undo = history_state.can_undo;
    let can_redo = history_state.can_redo;
    let undo_title = history_state
        .undo_label
        .unwrap_or_else(|| "Nothing to undo".to_string());
    let redo_title = history_state
        .redo_label
        .unwrap_or_else(|| "Nothing to redo".to_string());
    let undo_root = history_root.clone();
    let redo_root = history_root;
    let selected_path = selected_file()
        .and_then(|index| {
            files()
                .get(index)
                .map(|(path, _)| path.display().to_string())
        })
        .unwrap_or_else(|| "No source file selected".to_string());
    let selected_label = selected_file()
        .and_then(|index| files().get(index).map(|(_, label)| label.clone()))
        .unwrap_or_else(|| "No file".to_string());
    let filter_term = store_query().trim().to_lowercase();
    let visible_project_count = games()
        .iter()
        .filter(|game| {
            (show_hidden() || !game.meta.hidden)
                && (filter_term.is_empty()
                    || game.id.to_lowercase().contains(&filter_term)
                    || game.blurb.as_ref().is_some_and(|blurb| {
                        blurb.title.to_lowercase().contains(&filter_term)
                            || blurb.genre.to_lowercase().contains(&filter_term)
                    }))
        })
        .count();
    let shell_class = format!(
        "studio-shell{}{}{}",
        if focus_mode() { " focus-mode" } else { "" },
        if project_rail_open() {
            ""
        } else {
            " project-rail-collapsed"
        },
        if tool_dock_open() {
            ""
        } else {
            " tool-dock-collapsed"
        }
    );

    rsx! {
        style { {STUDIO_STYLE} }
        div { class: "{shell_class}",
            header { class: "topbar",
                div { class: "brand-zone",
                    div { class: "brand-lockup",
                        img {
                            class: "brand-mark",
                            src: brand_data_uri(),
                            alt: "PhantomPlay"
                        }
                        div {
                            strong { "PhantomPlay" }
                            span { "Studio" }
                        }
                    }
                    button {
                        class: "icon-button rail-toggle",
                        title: if project_rail_open() { "Hide project rail" } else { "Show project rail" },
                        aria_label: if project_rail_open() { "Hide project rail" } else { "Show project rail" },
                        onclick: move |_| project_rail_open.set(!project_rail_open()),
                        if project_rail_open() {
                            PanelLeftClose { size: 16 }
                        } else {
                            PanelLeftOpen { size: 16 }
                        }
                    }
                }

                nav { class: "view-switcher", aria_label: "Workspace view",
                    button {
                        class: if workspace_view() == WorkspaceView::Play { "is-active" } else { "" },
                        disabled: playing_entry().is_none(),
                        onclick: move |_| workspace_view.set(WorkspaceView::Play),
                        CirclePlay { size: 15 }
                        span { "Play" }
                    }
                    button {
                        class: if workspace_view() == WorkspaceView::Code { "is-active" } else { "" },
                        onclick: move |_| workspace_view.set(WorkspaceView::Code),
                        CodeXml { size: 15 }
                        span { "Code" }
                    }
                    button {
                        class: if workspace_view() == WorkspaceView::Split { "is-active" } else { "" },
                        disabled: playing_entry().is_none(),
                        onclick: move |_| workspace_view.set(WorkspaceView::Split),
                        Columns2 { size: 15 }
                        span { "Split" }
                    }
                }

                div { class: "topbar-actions",
                    div {
                        class: match api_online() {
                            Some(true) => "service-state is-online",
                            Some(false) => "service-state is-offline",
                            None => "service-state",
                        },
                        if api_online() == Some(false) {
                            WifiOff { size: 14 }
                        } else {
                            Wifi { size: 14 }
                        }
                        span {
                            {match api_online() {
                                Some(true) => "Systems ready",
                                Some(false) => "Local API offline",
                                None => "Connecting",
                            }}
                        }
                    }
                    button {
                        class: "icon-button",
                        title: "Reload game",
                        aria_label: "Reload game",
                        onclick: move |_| {
                            reload_token.set(reload_token().wrapping_add(1));
                            status.set("Game viewport reloaded.".to_string());
                        },
                        disabled: playing_entry().is_none(),
                        RefreshCw { size: 16 }
                    }
                    button {
                        class: if focus_mode() { "icon-button is-active" } else { "icon-button" },
                        title: if focus_mode() { "Exit focus mode" } else { "Enter focus mode" },
                        aria_label: if focus_mode() { "Exit focus mode" } else { "Enter focus mode" },
                        onclick: move |_| focus_mode.set(!focus_mode()),
                        if focus_mode() {
                            Minimize2 { size: 16 }
                        } else {
                            Maximize2 { size: 16 }
                        }
                    }
                    button {
                        class: "icon-button rail-toggle",
                        title: if tool_dock_open() { "Hide tool dock" } else { "Show tool dock" },
                        aria_label: if tool_dock_open() { "Hide tool dock" } else { "Show tool dock" },
                        onclick: move |_| tool_dock_open.set(!tool_dock_open()),
                        if tool_dock_open() {
                            PanelRightClose { size: 16 }
                        } else {
                            PanelRightOpen { size: 16 }
                        }
                    }
                }
            }

            div { class: "studio-layout",
                aside { class: "project-rail",
                    div { class: "library-header",
                        div { class: "section-heading",
                            div {
                                span { "PROJECT LIBRARY" }
                                strong { "{visible_project_count} visible" }
                            }
                            small { "LIVE WORKSPACE" }
                        }
                        button {
                            class: if show_hidden() { "library-toggle is-active" } else { "library-toggle" },
                            title: if show_hidden() { "Hide hidden games" } else { "Show hidden games" },
                            aria_label: if show_hidden() { "Hide hidden games" } else { "Show hidden games" },
                            onclick: move |_| show_hidden.set(!show_hidden()),
                            if show_hidden() {
                                Eye { size: 14 }
                                span { "Hidden shown" }
                            } else {
                                EyeOff { size: 14 }
                                span { "Hidden off" }
                            }
                        }
                        label { class: "search-field",
                            Search { size: 14 }
                            input {
                                class: "project-search",
                                placeholder: "Search projects",
                                aria_label: "Search projects",
                                value: "{store_query}",
                                oninput: move |event| store_query.set(event.value()),
                            }
                            if !store_query().is_empty() {
                                button {
                                    title: "Clear search",
                                    aria_label: "Clear search",
                                    onclick: move |_| store_query.set(String::new()),
                                    "Clear"
                                }
                            }
                        }
                        div {
                            class: if import_dragging() {
                                "project-import is-dragging"
                            } else {
                                "project-import"
                            },
                            ondragover: move |event| {
                                event.prevent_default();
                                import_dragging.set(true);
                            },
                            ondragleave: move |_| import_dragging.set(false),
                            ondrop: move |event| {
                                event.prevent_default();
                                import_dragging.set(false);
                                import_paths(drag_file_paths(&event));
                            },
                            div { class: "project-import-icon",
                                Import { size: 16 }
                            }
                            div { class: "project-import-copy",
                                strong { "Import game" }
                                span { "Drop folder, zip, or .html" }
                            }
                            button {
                                title: "Choose a game folder",
                                aria_label: "Choose a game folder",
                                onclick: move |event| {
                                    event.stop_propagation();
                                    if let Some(path) = rfd::FileDialog::new()
                                        .set_title("Import PhantomPlay game folder")
                                        .pick_folder()
                                    {
                                        import_paths(vec![path]);
                                    }
                                },
                                FolderPlus { size: 14 }
                            }
                        }
                    }

                    div { class: "project-list",
                        if visible_project_count == 0 {
                            div { class: "rail-empty",
                                Search { size: 20 }
                                strong { "No matching project" }
                                span { "Try a title, genre, or project ID." }
                            }
                        }
                        for (index, game) in games().iter().cloned().enumerate() {
                            if (show_hidden() || !game.meta.hidden)
                                && (filter_term.is_empty()
                                    || game.id.to_lowercase().contains(&filter_term)
                                    || game.blurb.as_ref().is_some_and(|blurb| {
                                        blurb.title.to_lowercase().contains(&filter_term)
                                            || blurb.genre.to_lowercase().contains(&filter_term)
                                    }))
                            {
                                article {
                                    class: if selected_game() == Some(index) {
                                        "project-row is-active"
                                    } else {
                                        "project-row"
                                    },
                                    onclick: move |_| select_project(index),
                                    div { class: "project-index", {format!("{:02}", index + 1)} }
                                    div { class: "project-copy",
                                        strong {
                                            "{game.blurb.as_ref().map(|blurb| blurb.title.clone()).unwrap_or_else(|| game.id.clone())}"
                                        }
                                        span {
                                            if game.meta.hidden {
                                                "Hidden"
                                            } else if let Some(blurb) = game.blurb.as_ref() {
                                                if blurb.genre.is_empty() {
                                                    "{game.id}"
                                                } else {
                                                    "{blurb.genre}"
                                                }
                                            } else {
                                                "{game.id}"
                                            }
                                        }
                                        if selected_game() == Some(index) {
                                            if let Some(blurb) = game.blurb.as_ref() {
                                                if !blurb.fantasy.is_empty() {
                                                    p { "{blurb.fantasy}" }
                                                }
                                            }
                                        }
                                    }
                                    div { class: "project-meta",
                                        span { class: "renderer-badge", "{game.runtime.renderer}" }
                                        div { class: "project-actions",
                                            button {
                                                class: "mini-action",
                                                title: if game.meta.hidden { "Show game" } else { "Hide game" },
                                                aria_label: if game.meta.hidden { "Show game" } else { "Hide game" },
                                                onclick: move |event| {
                                                    event.stop_propagation();
                                                    let next_hidden = !game.meta.hidden;
                                                    match update_studio_game_meta(&game.id, |meta| meta.hidden = next_hidden) {
                                                        Ok(_) => {
                                                            games.set(list_games());
                                                            status.set(if next_hidden {
                                                                "Game hidden from the main library.".to_string()
                                                            } else {
                                                                "Game restored to the main library.".to_string()
                                                            });
                                                        }
                                                        Err(error) => status.set(error),
                                                    }
                                                },
                                                if game.meta.hidden {
                                                    Eye { size: 13 }
                                                } else {
                                                    EyeOff { size: 13 }
                                                }
                                            }
                                            button {
                                                class: "mini-action",
                                                title: "Open source",
                                                aria_label: "Open source",
                                                onclick: move |event| {
                                                    event.stop_propagation();
                                                    select_project(index);
                                                    workspace_view.set(WorkspaceView::Code);
                                                },
                                                CodeXml { size: 13 }
                                            }
                                            button {
                                                class: "mini-action is-primary",
                                                title: "Run project",
                                                aria_label: "Run project",
                                                onclick: move |event| {
                                                    event.stop_propagation();
                                                    launch_game(index);
                                                },
                                                Play { size: 13 }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    section { class: "file-browser",
                        div { class: "file-browser-title",
                            div {
                                FolderOpen { size: 14 }
                                span { "SOURCE" }
                            }
                            small { "{files().len()} files" }
                        }
                        div { class: "file-list",
                            for (index, entry) in files().iter().cloned().enumerate() {
                                button {
                                    class: if selected_file() == Some(index) {
                                        "file-row is-active"
                                    } else {
                                        "file-row"
                                    },
                                    title: "{entry.0.display()}",
                                    onclick: move |_| open_file(index),
                                    FileCode { size: 13 }
                                    span { "{entry.1}" }
                                    if selected_file() == Some(index) && dirty() {
                                        i { class: "dirty-dot", title: "Unsaved changes" }
                                    }
                                }
                            }
                        }
                    }
                }

                main { class: "workspace",
                    div { class: "workspace-toolbar",
                        div { class: "workspace-context",
                            div { class: "workspace-breadcrumb",
                                span { "PHANTOMPLAY" }
                                span { "/" }
                                strong {
                                    if let Some(game) = project.as_ref() {
                                        "{game.id}"
                                    } else {
                                        "no-project"
                                    }
                                }
                            }
                            div { class: "workspace-heading",
                                strong {
                                    if let Some(game) = project.as_ref() {
                                        "{game.blurb.as_ref().map(|blurb| blurb.title.clone()).unwrap_or_else(|| game.id.clone())}"
                                    } else {
                                        "Choose a project"
                                    }
                                }
                                if let Some(game) = project.as_ref() {
                                    span { class: "workspace-chip is-renderer", "{game.runtime.renderer}" }
                                    span { class: "workspace-chip", "{game.runtime.engine}" }
                                    span { class: "workspace-chip", "{game.runtime.size_label()}" }
                                }
                            }
                        }
                        div { class: "workspace-toolbar-actions",
                            div {
                                class: if dirty() { "save-state is-dirty" } else { "save-state" },
                                if dirty() {
                                    CircleAlert { size: 13 }
                                    span { "Unsaved" }
                                } else {
                                    Check { size: 13 }
                                    span { "Synced" }
                                }
                            }
                            button {
                                class: "toolbar-button",
                                title: "{undo_title}",
                                disabled: dirty() || !can_undo,
                                onclick: move |_| apply_history_action(
                                    undo_root.clone(),
                                    true,
                                    selected_file,
                                    files,
                                    editor_content,
                                    dirty,
                                    status,
                                    reload_token,
                                ),
                                span { "Undo" }
                            }
                            button {
                                class: "toolbar-button",
                                title: "{redo_title}",
                                disabled: dirty() || !can_redo,
                                onclick: move |_| apply_history_action(
                                    redo_root.clone(),
                                    false,
                                    selected_file,
                                    files,
                                    editor_content,
                                    dirty,
                                    status,
                                    reload_token,
                                ),
                                span { "Redo" }
                            }
                            button {
                                class: "toolbar-button",
                                disabled: selected_file().is_none() || !dirty(),
                                onclick: move |_| save_active_file(
                                    games,
                                    selected_game,
                                    selected_file,
                                    files,
                                    editor_content,
                                    dirty,
                                    status,
                                ),
                                Save { size: 15 }
                                span { "Save" }
                            }
                            button {
                                class: "run-button",
                                disabled: selected_game().is_none(),
                                onclick: move |_| {
                                    if let Some(index) = selected_game() {
                                        launch_game(index);
                                    }
                                },
                                Play { size: 15 }
                                span { "Run" }
                            }
                        }
                    }

                    if workspace_view() == WorkspaceView::Play {
                        section { class: "game-viewport",
                            if let Some(entry) = playing_entry() {
                                Player {
                                    entry: format!("{entry}?shell_reload={}", reload_token())
                                }
                            } else {
                                div { class: "viewport-empty",
                                    CirclePlay { size: 30 }
                                    strong { "Ready for a project" }
                                    span { "Select a game, then run it in this workspace." }
                                }
                            }
                        }
                    } else if workspace_view() == WorkspaceView::Code {
                        section { class: "code-workspace",
                            div { class: "code-tabbar",
                                div { class: "code-tab is-active",
                                    FileCode { size: 13 }
                                    span { "{selected_label}" }
                                    if dirty() {
                                        i { class: "dirty-dot", title: "Unsaved changes" }
                                    }
                                }
                                div { class: "code-path", title: "{selected_path}", "{selected_path}" }
                            }
                            textarea {
                                class: "source-editor",
                                spellcheck: false,
                                value: "{editor_content}",
                                oninput: move |event| {
                                    editor_content.set(event.value());
                                    dirty.set(true);
                                }
                            }
                        }
                    } else {
                        section { class: "split-workspace",
                            div { class: "split-game",
                                if let Some(entry) = playing_entry() {
                                    Player {
                                        entry: format!("{entry}?shell_reload={}", reload_token())
                                    }
                                }
                            }
                            div { class: "split-code",
                                div { class: "code-tabbar",
                                    div { class: "code-tab is-active",
                                        FileCode { size: 13 }
                                        span { "{selected_label}" }
                                        if dirty() {
                                            i { class: "dirty-dot", title: "Unsaved changes" }
                                        }
                                    }
                                    div { class: "code-path", title: "{selected_path}", "{selected_path}" }
                                }
                                textarea {
                                    class: "source-editor",
                                    spellcheck: false,
                                    value: "{editor_content}",
                                    oninput: move |event| {
                                        editor_content.set(event.value());
                                        dirty.set(true);
                                    }
                                }
                            }
                        }
                    }
                }

                aside { class: "tool-dock",
                    nav { class: "tool-tabs", aria_label: "Production tools",
                        button {
                            class: if tool_tab() == ToolTab::Ai { "is-active" } else { "" },
                            title: "Phantom AI",
                            onclick: move |_| tool_tab.set(ToolTab::Ai),
                            Bot { size: 15 }
                            span { "AI" }
                        }
                        button {
                            class: if tool_tab() == ToolTab::Runtime { "is-active" } else { "" },
                            title: "Runtime",
                            onclick: move |_| tool_tab.set(ToolTab::Runtime),
                            Activity { size: 15 }
                            span { "Runtime" }
                        }
                        button {
                            class: if tool_tab() == ToolTab::Mods { "is-active" } else { "" },
                            title: "Mods",
                            onclick: move |_| tool_tab.set(ToolTab::Mods),
                            Puzzle { size: 15 }
                            span { "Mods" }
                        }
                        button {
                            class: if tool_tab() == ToolTab::Network { "is-active" } else { "" },
                            title: "Dev Room",
                            onclick: move |_| tool_tab.set(ToolTab::Network),
                            Radio { size: 15 }
                            span { "Room" }
                        }
                        button {
                            class: if tool_tab() == ToolTab::Settings { "is-active" } else { "" },
                            title: "Settings",
                            onclick: move |_| tool_tab.set(ToolTab::Settings),
                            Settings2 { size: 15 }
                            span { "Settings" }
                        }
                    }

                    section {
                        class: if tool_tab() == ToolTab::Ai {
                            "tool-pane ai-pane is-active"
                        } else {
                            "tool-pane ai-pane"
                        },
                        div { class: "tool-header",
                            div { class: "tool-header-icon is-ai",
                                WandSparkles { size: 18 }
                            }
                            div {
                                span { "PHANTOM AI" }
                                strong { "Direct the next change" }
                                p { "Edits land in the active source file and reload in place." }
                            }
                        }
                        div {
                            class: match api_online() {
                                Some(true) => "agent-state is-ready",
                                Some(false) => "agent-state is-offline",
                                None => "agent-state",
                            },
                            span { class: "state-dot" }
                            strong {
                                {match api_online() {
                                    Some(true) => "Edit agent ready",
                                    Some(false) => "Local service unavailable",
                                    None => "Connecting to local service",
                                }}
                            }
                            small { "Active target: {selected_label}" }
                        }
                        div {
                            class: if ai_busy() { "ai-step-state is-working" } else { "ai-step-state" },
                            Activity { size: 13 }
                            span { "{ai_activity}" }
                        }
                        div { class: "ai-route-controls",
                            label { class: "prompt-field",
                                span { "AI ROUTE" }
                                select {
                                    aria_label: "AI route",
                                    value: "{ai_provider}",
                                    onchange: move |event| {
                                        let provider = normalize_ai_provider(&event.value());
                                        let model = default_ai_model_for_provider(&provider);
                                        ai_provider.set(provider.clone());
                                        ai_model.set(model.clone());
                                        save_studio_settings(&provider, &model);
                                    },
                                    option { value: "auto", "Auto — best available" }
                                    option { value: "codex", "Codex" }
                                    option { value: "claude", "Claude" }
                                    option { value: "openrouter", "OpenRouter" }
                                    option { value: "local", "Local Ollama" }
                                }
                            }
                            label { class: "prompt-field",
                                span { "MODEL" }
                                select {
                                    aria_label: "AI model",
                                    value: "{ai_model}",
                                    onchange: move |event| {
                                        let model = event.value();
                                        ai_model.set(model.clone());
                                        save_studio_settings(&ai_provider(), &model);
                                    },
                                    for option in ai_model_dropdown_options(ai_model_options(), &ai_model()) {
                                        option { value: "{option.id}", "{option.name}" }
                                    }
                                }
                            }
                            div {
                                class: if ai_models_configured() == Some(false)
                                    || (ai_models_error().is_some() && ai_provider() == "openrouter") {
                                    "ai-config-note needs-config"
                                } else {
                                    "ai-config-note"
                                },
                                span {
                                    {ai_route_status_text(
                                        &ai_provider(),
                                        &ai_model(),
                                        &ai_model_options(),
                                        ai_models_configured(),
                                        ai_models_loading(),
                                        &ai_models_error(),
                                    )}
                                }
                            }
                        }
                        div { class: "tool-section-label",
                            span { "QUICK DIRECTIVES" }
                            small { "Apply to prompt" }
                        }
                        div { class: "ai-presets",
                            button {
                                onclick: move |_| ai_instruction.set(
                                    "Find and fix the most likely runtime bug in this file. Preserve gameplay behavior and explain the exact change in code comments only where necessary.".to_string()
                                ),
                                Bug { size: 15 }
                                div {
                                    strong { "Repair runtime" }
                                    span { "Trace and fix the highest-risk failure." }
                                }
                            }
                            button {
                                onclick: move |_| ai_instruction.set(
                                    "Optimize this file for stable frame pacing and lower per-frame allocations without changing the visible game design.".to_string()
                                ),
                                Gauge { size: 15 }
                                div {
                                    strong { "Tune frame time" }
                                    span { "Reduce frame spikes and allocations." }
                                }
                            }
                            button {
                                onclick: move |_| ai_instruction.set(
                                    "Review this file for input, resize, focus, pause, and hot-reload failures. Implement the safe fixes directly.".to_string()
                                ),
                                Keyboard { size: 15 }
                                div {
                                    strong { "Harden controls" }
                                    span { "Repair input, focus, resize, and pause." }
                                }
                            }
                        }
                        label { class: "prompt-field",
                            span { "INSTRUCTION" }
                            textarea {
                                class: "ai-instruction",
                                placeholder: "Describe the exact result you want...",
                                value: "{ai_instruction}",
                                oninput: move |event| ai_instruction.set(event.value()),
                            }
                        }
                        button {
                            class: "ai-apply",
                            disabled: ai_busy()
                                || selected_file().is_none()
                                || ai_instruction().trim().is_empty()
                                || api_online() == Some(false),
                            onclick: ask_ai,
                            WandSparkles { size: 15 }
                            span {
                                if ai_busy() { "Applying to game..." } else { "Apply to game" }
                            }
                        }
                        div { class: "target-path",
                            FileCode { size: 13 }
                            span { title: "{selected_path}", "{selected_path}" }
                        }
                    }

                    section {
                        class: if tool_tab() == ToolTab::Runtime {
                            "tool-pane runtime-pane is-active"
                        } else {
                            "tool-pane runtime-pane"
                        },
                        div { class: "tool-header",
                            div { class: "tool-header-icon is-runtime",
                                Activity { size: 18 }
                            }
                            div {
                                span { "RUNTIME" }
                                strong { "Live project topology" }
                                p { "Source-derived facts from the selected build." }
                            }
                        }
                        if let Some(game) = project.as_ref() {
                            div { class: "runtime-identity",
                                div {
                                    span { "RENDER PATH" }
                                    strong { "{game.runtime.renderer}" }
                                }
                                span { class: "runtime-live",
                                    span { class: "state-dot" }
                                    "ACTIVE"
                                }
                            }
                            div { class: "runtime-metrics",
                                div { class: "metric",
                                    Star { size: 15 }
                                    span { "Rating" }
                                    strong { {format!("{:.1} / {}", game.meta.public_rating, game.meta.rating_count)} }
                                }
                                div { class: "metric",
                                    Cpu { size: 15 }
                                    span { "Engine" }
                                    strong { "{game.runtime.engine}" }
                                }
                                div { class: "metric",
                                    Files { size: 15 }
                                    span { "Sources" }
                                    strong { "{game.runtime.file_count}" }
                                }
                                div { class: "metric",
                                    HardDrive { size: 15 }
                                    span { "Project" }
                                    strong { "{game.runtime.size_label()}" }
                                }
                                div { class: "metric",
                                    Activity { size: 15 }
                                    span { "Reload" }
                                    strong { "Watching" }
                                }
                            }
                            div { class: "tool-section-label",
                                span { "CAPABILITY MAP" }
                                small { "Detected in source" }
                            }
                            div { class: "runtime-checks",
                                div {
                                    span { class: "check is-ready" }
                                    div {
                                        b { "Developer" }
                                        small { "{game.meta.developer}" }
                                    }
                                }
                                div {
                                    span {
                                        class: if game.runtime.host_bridge { "check is-ready" } else { "check" }
                                    }
                                    div {
                                        b { "Host bridge" }
                                        small {
                                            if game.runtime.host_bridge {
                                                "Lifecycle messaging detected"
                                            } else {
                                                "No host lifecycle hook"
                                            }
                                        }
                                    }
                                }
                                div {
                                    span {
                                        class: if game.runtime.network_hooks { "check is-ready" } else { "check" }
                                    }
                                    div {
                                        b { "Game networking" }
                                        small {
                                            if game.runtime.network_hooks {
                                                "Realtime or room hooks detected"
                                            } else {
                                                "Local simulation only"
                                            }
                                        }
                                    }
                                }
                                div {
                                    span { class: "check is-ready" }
                                    div {
                                        b { "Hot reload" }
                                        small { "Watching the real project directory" }
                                    }
                                }
                                div {
                                    span { class: "check is-ready" }
                                    div {
                                        b {
                                            if game.runtime.native { "Native execution" } else { "Embedded play" }
                                        }
                                        small {
                                            {if game.runtime.native {
                                                format!("Run opens {} in its own window", game.runtime.renderer)
                                            } else {
                                                "Single-window workspace active".to_string()
                                            }}
                                        }
                                    }
                                }
                            }
                        } else {
                            div { class: "tool-empty",
                                FolderOpen { size: 20 }
                                strong { "Select a project" }
                                p { "Runtime topology appears when a project is active." }
                            }
                        }
                    }

                    section {
                        class: if tool_tab() == ToolTab::Mods {
                            "tool-pane mods-pane is-active"
                        } else {
                            "tool-pane mods-pane"
                        },
                        div { class: "tool-header",
                            div { class: "tool-header-icon is-mods",
                                Puzzle { size: 18 }
                            }
                            div {
                                span { "MOD LAYER" }
                                strong { "{mods_game_id}" }
                                p { "{mods_enabled().len()} enabled. Changes apply in the game automatically." }
                            }
                        }
                        div { class: "tool-section-label",
                            span { "DESKTOP MODS" }
                            small { "{mods_list().len()} available" }
                        }
                        div { class: "mod-create",
                            input {
                                placeholder: "New mod name",
                                value: "{new_mod_name}",
                                oninput: move |event| new_mod_name.set(event.value()),
                            }
                            input {
                                placeholder: "What it changes",
                                value: "{new_mod_desc}",
                                oninput: move |event| new_mod_desc.set(event.value()),
                            }
                            button {
                                disabled: mods_game_id().is_empty() || new_mod_name().trim().is_empty(),
                                onclick: move |_| {
                                    match create_project_mod(&mods_game_id(), &new_mod_name(), &new_mod_desc()) {
                                        Ok(entry) => {
                                            let mut current = mods_enabled();
                                            current.push(entry.id.clone());
                                            write_enabled_mods(&mods_game_id(), &current);
                                            mods_enabled.set(current);
                                            mods_list.set(read_available_mods(&mods_game_id()));
                                            new_mod_name.set(String::new());
                                            new_mod_desc.set(String::new());
                                            reload_token.set(reload_token().wrapping_add(1));
                                            status.set(format!("Created and enabled mod {}.", entry.name));
                                        }
                                        Err(error) => status.set(error),
                                    }
                                },
                                FolderPlus { size: 14 }
                                span { "Create" }
                            }
                        }
                        div { class: "mods-list",
                            for game_mod in mods_list().iter().cloned() {
                                label { class: "mod-option",
                                    div {
                                        strong { "{game_mod.name}" }
                                        span { "{game_mod.desc}" }
                                    }
                                    input {
                                        r#type: "checkbox",
                                        checked: mods_enabled().contains(&game_mod.id),
                                        onchange: move |_| {
                                            let mut current = mods_enabled();
                                            if current.contains(&game_mod.id) {
                                                current.retain(|id| id != &game_mod.id);
                                            } else {
                                                current.push(game_mod.id.clone());
                                            }
                                            write_enabled_mods(&mods_game_id(), &current);
                                            mods_enabled.set(current);
                                            reload_token.set(reload_token().wrapping_add(1));
                                            status.set("Mod selection applied to the embedded game.".to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }

                    section {
                        class: if tool_tab() == ToolTab::Network {
                            "tool-pane network-pane is-active"
                        } else {
                            "tool-pane network-pane"
                        },
                        div { class: "network-heading",
                            div { class: "tool-header-icon is-network",
                                Radio { size: 18 }
                            }
                            div {
                                span { "DEV ROOM" }
                                strong { "Live collaboration" }
                                small {
                                    if api_online() == Some(true) { "Signaling ready" } else { "Local API required" }
                                }
                            }
                            button {
                                title: "Reconnect services",
                                onclick: move |_| {
                                    api_online.set(None);
                                    spawn(async move {
                                        api_online.set(Some(check_api_health().await));
                                    });
                                },
                                RefreshCw { size: 13 }
                                span { "Reconnect" }
                            }
                        }
                        div { class: "devroom-frame",
                            DevRoomFrame {}
                        }
                    }

                    section {
                        class: if tool_tab() == ToolTab::Settings {
                            "tool-pane settings-pane is-active"
                        } else {
                            "tool-pane settings-pane"
                        },
                        div { class: "tool-header",
                            div { class: "tool-header-icon is-settings",
                                Settings2 { size: 18 }
                            }
                            div {
                                span { "SETTINGS" }
                                strong { "AI model routing" }
                                p { "Choose the route and exact model here or directly in the AI pane." }
                            }
                        }
                        div { class: "tool-section-label",
                            span { "MODEL CONFIG" }
                            small {
                                if ai_models_dynamic() {
                                    "Live catalog"
                                } else if ai_models_loading() {
                                    "Refreshing"
                                } else {
                                    "Saved locally"
                                }
                            }
                        }
                        label { class: "prompt-field settings-field",
                            span { "AI ROUTE" }
                            select {
                                value: "{ai_provider}",
                                onchange: move |event| {
                                    let provider = normalize_ai_provider(&event.value());
                                    let model = default_ai_model_for_provider(&provider);
                                    ai_provider.set(provider.clone());
                                    ai_model.set(model.clone());
                                    save_studio_settings(&provider, &model);
                                },
                                option { value: "auto", "Auto — best available" }
                                option { value: "codex", "Codex" }
                                option { value: "claude", "Claude" }
                                option { value: "openrouter", "OpenRouter" }
                                option { value: "local", "Local Ollama" }
                            }
                        }
                        label { class: "prompt-field settings-field",
                            span { "MODEL" }
                            select {
                                value: "{ai_model}",
                                onchange: move |event| {
                                    let model = event.value();
                                    ai_model.set(model.clone());
                                    save_studio_settings(&ai_provider(), &model);
                                },
                                for option in ai_model_dropdown_options(ai_model_options(), &ai_model()) {
                                    option { value: "{option.id}", "{option.name}" }
                                }
                            }
                        }
                        div {
                            class: if ai_models_configured() == Some(false)
                                || (ai_models_error().is_some() && ai_provider() == "openrouter") {
                                "settings-config-state needs-config"
                            } else {
                                "settings-config-state"
                            },
                            span { class: "state-dot" }
                            div {
                                strong {
                                    {ai_route_status_text(
                                        &ai_provider(),
                                        &ai_model(),
                                        &ai_model_options(),
                                        ai_models_configured(),
                                        ai_models_loading(),
                                        &ai_models_error(),
                                    )}
                                }
                                small {
                                    if let Some(error) = ai_models_error() {
                                        "{error}"
                                    } else if ai_models_dynamic() {
                                        "Models loaded from the provider catalog."
                                    } else if ai_provider() == "openrouter" {
                                        "Set OpenRouter transport and API key to refresh the live catalog."
                                    } else {
                                        "This selection is saved for Phantom AI edits."
                                    }
                                }
                            }
                        }
                    }
                }
            }

            footer { class: "statusbar",
                div { class: "status-primary",
                    Activity { size: 13 }
                    span { "{status}" }
                }
                div { class: "status-item",
                    RefreshCw { size: 12 }
                    span { "Hot reload armed" }
                }
                div {
                    class: if api_online() == Some(true) { "status-item is-ready" } else { "status-item" },
                    if api_online() == Some(false) {
                        WifiOff { size: 12 }
                        span { "API offline" }
                    } else {
                        Wifi { size: 12 }
                        span {
                            if api_online() == Some(true) { "Services online" } else { "Connecting" }
                        }
                    }
                }
                div { class: "status-item",
                    Files { size: 12 }
                    span { "{files().len()} sources" }
                }
                div {
                    class: "status-root",
                    title: "{phantomplay_live_root().display()}",
                    FolderOpen { size: 12 }
                    span {
                        if let Some(game) = project.as_ref() {
                            "{game.id}"
                        } else {
                            "workspace"
                        }
                    }
                }
            }
        }
    }
}

const STUDIO_STYLE: &str = r#"
    :root {
        color-scheme: dark;
        font-family: "Segoe UI Variable Text", Inter, "Segoe UI", system-ui, sans-serif;
        background: #080a0e;
        color: #f3f6f8;
        --bg-canvas: #080a0e;
        --bg-deep: #0a0d12;
        --bg-panel: #0d1117;
        --bg-elevated: #121822;
        --bg-hover: #171f2a;
        --line-soft: #202731;
        --line-strong: #303a47;
        --text: #f3f6f8;
        --text-soft: #b9c1cb;
        --muted: #788391;
        --mint: #59f2aa;
        --cyan: #56c7ff;
        --amber: #ffbe68;
        --rose: #ff7082;
        --violet: #a99cff;
    }
    html, body, #main {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: var(--bg-canvas);
    }
    * { box-sizing: border-box; }
    button, input, textarea { font: inherit; letter-spacing: 0; }
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
    button:focus-visible,
    input:focus-visible,
    textarea:focus-visible {
        outline: 2px solid var(--cyan);
        outline-offset: 1px;
    }
    button:disabled { opacity: 0.36; cursor: not-allowed; }
    .studio-shell {
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: 64px minmax(0, 1fr) 30px;
        overflow: hidden;
        background: var(--bg-canvas);
    }

    .topbar {
        position: relative;
        z-index: 5;
        display: grid;
        grid-template-columns: minmax(260px, 1fr) auto minmax(330px, 1fr);
        align-items: center;
        gap: 16px;
        padding: 0 14px;
        border-bottom: 1px solid var(--line-soft);
        background: rgba(10, 13, 18, 0.98);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
    }
    .brand-zone,
    .brand-lockup,
    .topbar-actions,
    .service-state,
    .view-switcher button,
    .workspace-toolbar,
    .workspace-heading,
    .workspace-toolbar-actions,
    .save-state,
    .toolbar-button,
    .run-button,
    .file-browser-title > div,
    .file-row,
    .tool-tabs button,
    .target-path,
    .status-primary,
    .status-item,
    .status-root {
        display: flex;
        align-items: center;
    }
    .brand-zone { min-width: 0; gap: 10px; }
    .brand-lockup { min-width: 0; gap: 10px; }
    .brand-mark {
        width: 32px;
        height: 32px;
        flex: 0 0 auto;
        object-fit: contain;
        filter: drop-shadow(0 0 12px rgba(89, 242, 170, 0.28));
    }
    .brand-lockup > div {
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .brand-lockup strong {
        color: var(--text);
        font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif;
        font-size: 16px;
        font-weight: 760;
        line-height: 1.05;
    }
    .brand-lockup span {
        margin-top: 3px;
        color: var(--muted);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
    }
    .icon-button {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: #8994a2;
        cursor: pointer;
    }
    .icon-button:hover {
        border-color: var(--line-strong);
        background: var(--bg-elevated);
        color: var(--text);
    }
    .icon-button.is-active {
        border-color: rgba(86, 199, 255, 0.45);
        background: rgba(86, 199, 255, 0.1);
        color: var(--cyan);
    }
    .view-switcher {
        display: grid;
        grid-template-columns: repeat(3, minmax(82px, 1fr));
        min-width: 276px;
        height: 38px;
        padding: 3px;
        border: 1px solid var(--line-soft);
        border-radius: 7px;
        background: #07090d;
    }
    .view-switcher button {
        justify-content: center;
        gap: 7px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: #7e8996;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
    }
    .view-switcher button:hover {
        background: var(--bg-elevated);
        color: var(--text-soft);
    }
    .view-switcher button.is-active {
        background: #1a222d;
        color: var(--text);
        box-shadow: inset 0 0 0 1px #313c49, 0 4px 12px rgba(0, 0, 0, 0.22);
    }
    .view-switcher button.is-active svg { color: var(--mint); }
    .topbar-actions {
        min-width: 0;
        justify-content: flex-end;
        gap: 6px;
    }
    .service-state {
        min-width: 0;
        gap: 7px;
        height: 32px;
        margin-right: 2px;
        padding: 0 10px;
        border: 1px solid var(--line-soft);
        border-radius: 6px;
        background: #0b0f15;
        color: #8d98a5;
        font-size: 11px;
        font-weight: 650;
        white-space: nowrap;
    }
    .service-state.is-online {
        border-color: rgba(89, 242, 170, 0.25);
        color: #b6f8d6;
    }
    .service-state.is-online svg { color: var(--mint); }
    .service-state.is-offline {
        border-color: rgba(255, 112, 130, 0.35);
        color: #ffadb8;
    }
    .service-state.is-offline svg { color: var(--rose); }

    .studio-layout {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-columns: 284px minmax(0, 1fr) 356px;
        overflow: hidden;
    }
    .project-rail {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: auto minmax(190px, 1fr) minmax(190px, 36%);
        overflow: hidden;
        border-right: 1px solid var(--line-soft);
        background: var(--bg-panel);
    }
    .library-header {
        padding: 14px 12px 12px;
        border-bottom: 1px solid var(--line-soft);
        background: #0c1016;
    }
    .section-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
    }
    .section-heading > div {
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .section-heading span,
    .file-browser-title span,
    .tool-header span,
    .network-heading > div > span,
    .workspace-breadcrumb,
    .tool-section-label span,
    .prompt-field > span,
    .runtime-identity span,
    .metric span {
        color: var(--muted);
        font-size: 9px;
        font-weight: 760;
        text-transform: uppercase;
        letter-spacing: 0;
    }
    .section-heading strong {
        margin-top: 3px;
        color: var(--text-soft);
        font-size: 12px;
        font-weight: 680;
    }
    .section-heading small {
        padding: 3px 5px;
        border: 1px solid rgba(89, 242, 170, 0.24);
        border-radius: 4px;
        color: var(--mint);
        font-size: 8px;
        font-weight: 760;
    }
    .search-field {
        height: 34px;
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr) auto;
        align-items: center;
        gap: 4px;
        border: 1px solid var(--line-soft);
        border-radius: 6px;
        padding: 0 8px;
        background: #080b10;
        color: #65707d;
    }
    .search-field:focus-within {
        border-color: rgba(86, 199, 255, 0.6);
        box-shadow: 0 0 0 3px rgba(86, 199, 255, 0.08);
        color: var(--cyan);
    }
    .project-search {
        width: 100%;
        min-width: 0;
        height: 100%;
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--text);
        font-size: 11px;
    }
    .project-search::placeholder { color: #596371; }
    .search-field button {
        height: 22px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        font-size: 9px;
    }
    .search-field button:hover { background: var(--bg-elevated); color: var(--text-soft); }
    .library-toggle {
        width: 100%;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        margin: -2px 0 9px;
        border: 1px solid var(--line-soft);
        border-radius: 6px;
        background: #0a0e14;
        color: #7d8996;
        cursor: pointer;
        font-size: 9px;
        font-weight: 760;
        text-transform: uppercase;
    }
    .library-toggle:hover,
    .library-toggle.is-active {
        border-color: rgba(89, 242, 170, 0.32);
        color: var(--mint);
        background: rgba(89, 242, 170, 0.07);
    }
    .project-import {
        min-height: 56px;
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr) 30px;
        align-items: center;
        gap: 9px;
        margin-top: 10px;
        padding: 9px;
        border: 1px dashed #324050;
        border-radius: 6px;
        background: linear-gradient(135deg, rgba(89, 242, 170, 0.06), rgba(86, 199, 255, 0.035));
        color: var(--text-soft);
    }
    .project-import.is-dragging {
        border-color: rgba(89, 242, 170, 0.8);
        background: rgba(89, 242, 170, 0.1);
        box-shadow: inset 0 0 0 1px rgba(89, 242, 170, 0.12), 0 0 28px rgba(89, 242, 170, 0.08);
    }
    .project-import-icon {
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(89, 242, 170, 0.24);
        border-radius: 5px;
        background: rgba(89, 242, 170, 0.08);
        color: var(--mint);
    }
    .project-import-copy { min-width: 0; }
    .project-import-copy strong {
        display: block;
        color: #dce2e8;
        font-size: 11px;
        font-weight: 740;
    }
    .project-import-copy span {
        display: block;
        overflow: hidden;
        margin-top: 3px;
        color: #74808e;
        font-size: 9px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .project-import button {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border: 1px solid #33404e;
        border-radius: 5px;
        background: #111720;
        color: var(--text-soft);
        cursor: pointer;
    }
    .project-import button:hover {
        border-color: rgba(89, 242, 170, 0.48);
        color: var(--mint);
    }
    .project-list {
        min-height: 0;
        overflow: auto;
        padding: 7px;
        scrollbar-color: #313a46 transparent;
        scrollbar-width: thin;
    }
    .project-row {
        position: relative;
        display: grid;
        grid-template-columns: 24px minmax(0, 1fr) auto;
        gap: 8px;
        min-height: 58px;
        margin-bottom: 3px;
        padding: 9px 8px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        cursor: pointer;
    }
    .project-row:hover {
        border-color: var(--line-soft);
        background: #11161e;
    }
    .project-row.is-active {
        border-color: #34404e;
        background: #171d26;
        box-shadow: inset 2px 0 var(--mint);
    }
    .project-index {
        padding-top: 2px;
        color: #4f5966;
        font: 600 9px "Cascadia Code", Consolas, monospace;
    }
    .project-row.is-active .project-index { color: var(--mint); }
    .project-copy { min-width: 0; }
    .project-copy strong {
        display: block;
        overflow: hidden;
        color: #dce2e8;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .project-copy > span {
        display: block;
        overflow: hidden;
        margin-top: 4px;
        color: #6f7a87;
        font-size: 9px;
        font-weight: 620;
        text-overflow: ellipsis;
        text-transform: uppercase;
        white-space: nowrap;
    }
    .project-copy p {
        display: -webkit-box;
        margin: 7px 0 1px;
        overflow: hidden;
        color: #8d98a5;
        font-size: 10px;
        line-height: 1.4;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
    }
    .project-meta {
        min-width: 54px;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        justify-content: space-between;
        gap: 7px;
    }
    .renderer-badge {
        max-width: 76px;
        overflow: hidden;
        padding: 2px 5px;
        border: 1px solid #2b3541;
        border-radius: 4px;
        color: #8f9aa7;
        font: 650 8px "Cascadia Code", Consolas, monospace;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .project-row.is-active .renderer-badge {
        border-color: rgba(86, 199, 255, 0.28);
        color: #9edfff;
    }
    .project-actions {
        display: flex;
        gap: 4px;
        opacity: 0;
        transform: translateY(2px);
        transition: opacity 120ms ease, transform 120ms ease;
    }
    .project-row:hover .project-actions,
    .project-row.is-active .project-actions {
        opacity: 1;
        transform: translateY(0);
    }
    .mini-action {
        width: 25px;
        height: 24px;
        display: grid;
        place-items: center;
        border: 1px solid var(--line-strong);
        border-radius: 4px;
        background: #111720;
        color: #8f9aa7;
        cursor: pointer;
    }
    .mini-action:hover { border-color: #475566; color: var(--text); }
    .mini-action.is-primary {
        border-color: rgba(89, 242, 170, 0.38);
        color: var(--mint);
    }
    .rail-empty {
        min-height: 150px;
        display: grid;
        place-content: center;
        justify-items: center;
        gap: 6px;
        color: #5f6976;
        text-align: center;
    }
    .rail-empty strong { color: var(--text-soft); font-size: 11px; }
    .rail-empty span { color: var(--muted); font-size: 9px; }

    .file-browser {
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-top: 1px solid var(--line-soft);
        background: #0b0f14;
    }
    .file-browser-title {
        min-height: 38px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 0 10px;
        color: #687482;
    }
    .file-browser-title > div { gap: 7px; }
    .file-browser-title small { color: #5e6976; font-size: 9px; }
    .file-list {
        min-height: 0;
        overflow: auto;
        padding: 2px 7px 8px;
        scrollbar-color: #313a46 transparent;
        scrollbar-width: thin;
    }
    .file-row {
        width: 100%;
        height: 29px;
        gap: 7px;
        overflow: hidden;
        border: 0;
        border-radius: 4px;
        padding: 0 8px;
        background: transparent;
        color: #7d8996;
        cursor: pointer;
        text-align: left;
    }
    .file-row svg { flex: 0 0 auto; color: #56616d; }
    .file-row span {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        font: 10px "Cascadia Code", Consolas, monospace;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .file-row:hover { background: #141a22; color: #c6cdd5; }
    .file-row.is-active {
        background: #1a222c;
        color: #e8edf2;
    }
    .file-row.is-active svg { color: var(--cyan); }
    .dirty-dot {
        width: 6px;
        height: 6px;
        flex: 0 0 auto;
        border-radius: 50%;
        background: var(--amber);
        box-shadow: 0 0 8px rgba(255, 190, 104, 0.45);
    }

    .workspace {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: 58px minmax(0, 1fr);
        overflow: hidden;
        background: #05070a;
    }
    .workspace-toolbar {
        min-width: 0;
        gap: 16px;
        padding: 0 12px 0 16px;
        border-bottom: 1px solid var(--line-soft);
        background: #0c1015;
    }
    .workspace-context { min-width: 0; flex: 1; }
    .workspace-breadcrumb {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-bottom: 4px;
        color: #586370;
    }
    .workspace-breadcrumb strong { color: #8b96a3; font-weight: 700; }
    .workspace-heading {
        min-width: 0;
        gap: 6px;
    }
    .workspace-heading > strong {
        min-width: 0;
        max-width: 320px;
        overflow: hidden;
        color: var(--text);
        font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif;
        font-size: 14px;
        font-weight: 720;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .workspace-chip {
        max-width: 140px;
        overflow: hidden;
        padding: 2px 6px;
        border: 1px solid #29323d;
        border-radius: 4px;
        color: #76818e;
        font-size: 8px;
        font-weight: 680;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .workspace-chip.is-renderer {
        border-color: rgba(86, 199, 255, 0.25);
        color: #8bd9ff;
    }
    .workspace-toolbar-actions {
        flex: 0 0 auto;
        gap: 7px;
        margin-left: auto;
    }
    .save-state {
        gap: 5px;
        height: 30px;
        padding: 0 7px;
        color: #6f7b88;
        font-size: 9px;
        font-weight: 700;
    }
    .save-state svg { color: var(--mint); }
    .save-state.is-dirty { color: #d5a861; }
    .save-state.is-dirty svg { color: var(--amber); }
    .toolbar-button,
    .run-button {
        height: 34px;
        justify-content: center;
        gap: 7px;
        border-radius: 6px;
        padding: 0 12px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 720;
    }
    .toolbar-button {
        border: 1px solid var(--line-strong);
        background: #121821;
        color: #b6bec8;
    }
    .toolbar-button:hover { border-color: #465361; background: #18212b; color: var(--text); }
    .run-button {
        min-width: 78px;
        border: 1px solid rgba(89, 242, 170, 0.78);
        background: var(--mint);
        color: #07110c;
        box-shadow: 0 6px 18px rgba(89, 242, 170, 0.14);
    }
    .run-button:hover { background: #7af8bd; }

    .game-viewport,
    .split-game {
        position: relative;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: #030507;
    }
    .game-viewport {
        display: block;
        padding: 0;
        box-shadow: inset 0 1px rgba(255, 255, 255, 0.025);
    }
    .split-game > #main,
    .split-game iframe,
    .devroom-frame > #main,
    .devroom-frame iframe {
        width: 100%;
        height: 100%;
        border: 0;
    }
    .game-viewport > #main,
    .game-viewport iframe {
        width: 100%;
        max-width: none;
        height: 100%;
        max-height: none;
        aspect-ratio: auto;
        border: 0;
        border-radius: 0;
        background: #020907;
        box-shadow: none;
    }
    .viewport-empty {
        width: 100%;
        height: 100%;
        display: grid;
        place-content: center;
        justify-items: center;
        gap: 7px;
        color: #586370;
        text-align: center;
        background: #080b0f;
    }
    .viewport-empty svg { color: var(--mint); }
    .viewport-empty strong {
        margin-top: 4px;
        color: #d9dfe5;
        font-size: 16px;
        font-weight: 700;
    }
    .viewport-empty span { color: var(--muted); font-size: 11px; }

    .code-workspace,
    .split-code {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: 36px minmax(0, 1fr);
        overflow: hidden;
        background: #090c10;
    }
    .code-tabbar {
        min-width: 0;
        display: flex;
        align-items: stretch;
        overflow: hidden;
        border-bottom: 1px solid var(--line-soft);
        background: #0d1117;
    }
    .code-tab {
        min-width: 0;
        max-width: 220px;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 0 11px;
        border-right: 1px solid var(--line-soft);
        color: #87929f;
        font: 10px "Cascadia Code", Consolas, monospace;
    }
    .code-tab.is-active {
        background: #111720;
        color: #dce3e9;
        box-shadow: inset 0 2px var(--cyan);
    }
    .code-tab svg { flex: 0 0 auto; color: var(--cyan); }
    .code-tab span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .code-path {
        min-width: 0;
        flex: 1;
        align-self: center;
        overflow: hidden;
        padding: 0 10px;
        color: #515b67;
        font: 9px "Cascadia Code", Consolas, monospace;
        text-align: right;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .source-editor {
        width: 100%;
        height: 100%;
        min-height: 0;
        resize: none;
        border: 0;
        outline: 0;
        padding: 18px 20px 48px;
        background: #090c10;
        color: #d8dee5;
        caret-color: var(--cyan);
        tab-size: 2;
        font: 12px/1.62 "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    }
    .source-editor::selection { background: rgba(86, 199, 255, 0.22); }
    .split-workspace {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 62%) minmax(360px, 38%);
        overflow: hidden;
    }
    .split-code { border-left: 1px solid var(--line-strong); }

    .tool-dock {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: 48px minmax(0, 1fr);
        overflow: hidden;
        border-left: 1px solid var(--line-soft);
        background: var(--bg-panel);
    }
    .tool-tabs {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        border-bottom: 1px solid var(--line-soft);
        background: #0b0f14;
    }
    .tool-tabs button {
        position: relative;
        justify-content: center;
        gap: 6px;
        border: 0;
        border-right: 1px solid #171d25;
        background: transparent;
        color: #697582;
        cursor: pointer;
        font-size: 9px;
        font-weight: 720;
    }
    .tool-tabs button:last-child { border-right: 0; }
    .tool-tabs button:hover { background: #121820; color: #aeb7c1; }
    .tool-tabs button.is-active {
        background: #121821;
        color: var(--text);
        box-shadow: inset 0 -2px var(--cyan);
    }
    .tool-tabs button.is-active svg { color: var(--cyan); }
    .tool-pane {
        display: none;
        min-height: 0;
        overflow: auto;
        padding: 17px;
        scrollbar-color: #313a46 transparent;
        scrollbar-width: thin;
    }
    .tool-pane.is-active { display: block; }
    .tool-header {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr);
        gap: 10px;
        margin-bottom: 16px;
    }
    .tool-header-icon {
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border: 1px solid var(--line-strong);
        border-radius: 7px;
        background: #111720;
        color: var(--text-soft);
    }
    .tool-header-icon.is-ai {
        border-color: rgba(169, 156, 255, 0.34);
        color: var(--violet);
    }
    .tool-header-icon.is-runtime {
        border-color: rgba(86, 199, 255, 0.34);
        color: var(--cyan);
    }
    .tool-header-icon.is-mods {
        border-color: rgba(255, 190, 104, 0.34);
        color: var(--amber);
    }
    .tool-header-icon.is-network {
        border-color: rgba(89, 242, 170, 0.34);
        color: var(--mint);
    }
    .tool-header-icon.is-settings {
        border-color: rgba(134, 226, 244, 0.34);
        color: var(--cyan);
    }
    .tool-header > div:last-child { min-width: 0; }
    .tool-header strong {
        display: block;
        margin-top: 3px;
        color: var(--text);
        font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif;
        font-size: 15px;
        font-weight: 720;
    }
    .tool-header p {
        margin: 5px 0 0;
        color: #7d8895;
        font-size: 10px;
        line-height: 1.45;
    }
    .agent-state {
        display: grid;
        grid-template-columns: 8px minmax(0, 1fr);
        column-gap: 8px;
        margin-bottom: 17px;
        padding: 10px 11px;
        border: 1px solid var(--line-soft);
        border-radius: 6px;
        background: #0a0e13;
    }
    .state-dot {
        width: 7px;
        height: 7px;
        align-self: center;
        border-radius: 50%;
        background: #69727d;
    }
    .agent-state .state-dot { grid-row: 1 / 3; }
    .agent-state strong { color: #aeb8c2; font-size: 10px; }
    .agent-state small {
        overflow: hidden;
        margin-top: 2px;
        color: #5f6975;
        font-size: 9px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .agent-state.is-ready {
        border-color: rgba(89, 242, 170, 0.2);
        background: rgba(89, 242, 170, 0.035);
    }
    .agent-state.is-ready .state-dot {
        background: var(--mint);
        box-shadow: 0 0 8px rgba(89, 242, 170, 0.5);
    }
    .agent-state.is-offline { border-color: rgba(255, 112, 130, 0.26); }
    .agent-state.is-offline .state-dot { background: var(--rose); }
    .ai-step-state {
        min-width: 0;
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        align-items: center;
        gap: 7px;
        min-height: 34px;
        margin: -7px 0 12px;
        padding: 8px 10px;
        border: 1px solid rgba(86, 199, 255, 0.18);
        border-radius: 6px;
        background: rgba(86, 199, 255, 0.035);
        color: #92a1b2;
        font: 9px/1.35 "Cascadia Code", Consolas, monospace;
    }
    .ai-step-state svg {
        color: var(--cyan);
    }
    .ai-step-state span {
        min-width: 0;
        white-space: normal;
        overflow-wrap: anywhere;
    }
    .ai-step-state.is-working {
        border-color: rgba(89, 242, 170, 0.28);
        background: rgba(89, 242, 170, 0.045);
        color: #d0e7dc;
    }
    .ai-step-state.is-working svg {
        color: var(--mint);
        animation: spin 1.05s linear infinite;
    }
    .tool-section-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: 17px 0 8px;
    }
    .tool-section-label small { color: #56616d; font-size: 8px; }
    .ai-presets {
        display: grid;
        grid-template-columns: 1fr;
        gap: 5px;
    }
    .ai-presets button {
        min-height: 48px;
        display: grid;
        grid-template-columns: 24px minmax(0, 1fr);
        align-items: center;
        gap: 7px;
        border: 1px solid var(--line-soft);
        border-radius: 6px;
        padding: 7px 9px;
        background: #0b0f14;
        color: #7d8996;
        cursor: pointer;
        text-align: left;
    }
    .ai-presets button:hover {
        border-color: #384452;
        background: #121821;
        color: var(--violet);
    }
    .ai-presets button div { min-width: 0; }
    .ai-presets button strong {
        display: block;
        color: #c5ccd4;
        font-size: 10px;
        font-weight: 700;
    }
    .ai-presets button span {
        display: block;
        overflow: hidden;
        margin-top: 2px;
        color: #66717d;
        font-size: 9px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .prompt-field {
        display: block;
        margin-top: 14px;
    }
    .prompt-field > span { display: block; margin-bottom: 7px; }
    .ai-route-controls {
        display: grid;
        grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr);
        gap: 7px;
        margin-top: 12px;
    }
    .ai-route-controls .prompt-field { margin-top: 0; }
    .ai-route-controls select,
    .settings-field select {
        width: 100%;
        height: 34px;
        border: 1px solid #2a3340;
        border-radius: 6px;
        outline: 0;
        padding: 0 9px;
        background: #090c12;
        color: #cbd3dc;
        font: 10px "Cascadia Code", Consolas, monospace;
    }
    .ai-route-controls select:focus,
    .settings-field select:focus {
        border-color: rgba(169, 156, 255, 0.68);
        box-shadow: 0 0 0 3px rgba(169, 156, 255, 0.08);
    }
    .settings-field select:disabled {
        opacity: 0.62;
        cursor: wait;
    }
    .ai-config-note {
        display: flex;
        grid-column: 1 / -1;
        justify-content: flex-start;
        min-height: 15px;
        color: #5f6975;
        font: 8px "Cascadia Code", Consolas, monospace;
        letter-spacing: 0;
        text-transform: uppercase;
    }
    .ai-config-note.needs-config {
        color: var(--amber);
    }
    .settings-config-state {
        display: grid;
        grid-template-columns: 8px minmax(0, 1fr);
        gap: 8px;
        margin-top: 14px;
        padding: 11px;
        border: 1px solid rgba(86, 199, 255, 0.2);
        border-radius: 7px;
        background: rgba(86, 199, 255, 0.035);
    }
    .settings-config-state .state-dot {
        grid-row: 1 / 3;
        background: var(--cyan);
        box-shadow: 0 0 8px rgba(86, 199, 255, 0.45);
    }
    .settings-config-state strong {
        display: block;
        color: #ccd6df;
        font-size: 10px;
        font-weight: 740;
    }
    .settings-config-state small {
        display: block;
        margin-top: 3px;
        color: #66717d;
        font-size: 9px;
        line-height: 1.35;
    }
    .settings-config-state.needs-config {
        border-color: rgba(255, 190, 104, 0.28);
        background: rgba(255, 190, 104, 0.045);
    }
    .settings-config-state.needs-config .state-dot {
        background: var(--amber);
        box-shadow: 0 0 8px rgba(255, 190, 104, 0.38);
    }
    .ai-instruction {
        width: 100%;
        height: 142px;
        min-height: 92px;
        max-height: 260px;
        resize: vertical;
        border: 1px solid #2a3340;
        border-radius: 7px;
        outline: 0;
        padding: 11px;
        background: #090c12;
        color: #dce3eb;
        font: 10px/1.55 "Cascadia Code", Consolas, monospace;
    }
    .ai-instruction::placeholder { color: #525d69; }
    .ai-instruction:focus {
        border-color: rgba(169, 156, 255, 0.68);
        box-shadow: 0 0 0 3px rgba(169, 156, 255, 0.08);
    }
    .ai-apply {
        width: 100%;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        margin-top: 8px;
        border: 1px solid rgba(169, 156, 255, 0.65);
        border-radius: 6px;
        background: #8174db;
        color: #ffffff;
        cursor: pointer;
        font-size: 11px;
        font-weight: 760;
        box-shadow: 0 7px 18px rgba(129, 116, 219, 0.16);
    }
    .ai-apply:hover { background: #9285ea; }
    .target-path {
        min-width: 0;
        gap: 6px;
        margin-top: 9px;
        color: #596572;
    }
    .target-path svg { flex: 0 0 auto; }
    .target-path span {
        min-width: 0;
        overflow: hidden;
        font: 8px "Cascadia Code", Consolas, monospace;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .runtime-identity {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 0;
        border-top: 1px solid var(--line-soft);
        border-bottom: 1px solid var(--line-soft);
    }
    .runtime-identity > div { min-width: 0; }
    .runtime-identity strong {
        display: block;
        overflow: hidden;
        margin-top: 4px;
        color: #e5ebf1;
        font-size: 17px;
        font-weight: 740;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .runtime-live {
        display: flex;
        align-items: center;
        gap: 5px;
        color: var(--mint) !important;
        font-size: 8px !important;
    }
    .runtime-live .state-dot {
        background: var(--mint);
        box-shadow: 0 0 8px rgba(89, 242, 170, 0.45);
    }
    .runtime-metrics {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-top: 12px;
    }
    .metric {
        min-width: 0;
        display: grid;
        grid-template-columns: 20px minmax(0, 1fr);
        column-gap: 6px;
        padding: 9px;
        border: 1px solid var(--line-soft);
        border-radius: 6px;
        background: #0a0e13;
    }
    .metric svg {
        grid-row: 1 / 3;
        align-self: center;
        color: #64707d;
    }
    .metric span { font-size: 8px; }
    .metric strong {
        min-width: 0;
        overflow: hidden;
        margin-top: 3px;
        color: #cfd6dd;
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .runtime-checks {
        border-top: 1px solid var(--line-soft);
    }
    .runtime-checks > div {
        display: grid;
        grid-template-columns: 9px minmax(0, 1fr);
        gap: 8px;
        padding: 10px 1px;
        border-bottom: 1px solid var(--line-soft);
    }
    .runtime-checks .check {
        width: 7px;
        height: 7px;
        margin-top: 4px;
        border-radius: 50%;
        background: #59636e;
    }
    .runtime-checks .check.is-ready {
        background: var(--mint);
        box-shadow: 0 0 7px rgba(89, 242, 170, 0.35);
    }
    .runtime-checks b {
        display: block;
        color: #b9c2cb;
        font-size: 10px;
        font-weight: 680;
    }
    .runtime-checks small {
        display: block;
        margin-top: 2px;
        color: #626d79;
        font-size: 9px;
    }

    .tool-empty {
        display: grid;
        justify-items: start;
        gap: 6px;
        padding: 14px;
        border: 1px solid var(--line-soft);
        border-radius: 6px;
        background: #0a0e13;
        color: #626d79;
    }
    .tool-empty strong { color: #c4ccd4; font-size: 11px; }
    .tool-empty p {
        margin: 0;
        color: #6d7884;
        font-size: 9px;
        line-height: 1.45;
    }
    .mods-list { display: flex; flex-direction: column; }
    .mod-create {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 7px;
        margin-bottom: 12px;
        padding: 10px;
        border: 1px solid var(--line-soft);
        border-radius: 6px;
        background: #0b1016;
    }
    .mod-create input {
        min-width: 0;
        height: 31px;
        border: 1px solid var(--line-soft);
        border-radius: 5px;
        padding: 0 9px;
        background: #080c11;
        color: var(--text);
        font-size: 10px;
        outline: 0;
    }
    .mod-create input:focus {
        border-color: rgba(86, 199, 255, 0.5);
    }
    .mod-create button {
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        border: 1px solid rgba(89, 242, 170, 0.36);
        border-radius: 5px;
        background: rgba(89, 242, 170, 0.1);
        color: var(--mint);
        cursor: pointer;
        font-size: 10px;
        font-weight: 760;
    }
    .mod-create button:disabled {
        cursor: not-allowed;
        opacity: 0.45;
    }
    .mod-option {
        min-height: 54px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 34px;
        align-items: center;
        gap: 10px;
        padding: 9px 2px;
        border-bottom: 1px solid var(--line-soft);
        cursor: pointer;
    }
    .mod-option > div { min-width: 0; }
    .mod-option strong {
        display: block;
        color: #cbd2d9;
        font-size: 10px;
        font-weight: 680;
    }
    .mod-option span {
        display: block;
        overflow: hidden;
        margin-top: 3px;
        color: #66717d;
        font-size: 9px;
        line-height: 1.3;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .mod-option input {
        position: relative;
        width: 32px;
        height: 18px;
        margin: 0;
        appearance: none;
        border: 1px solid #3a4450;
        border-radius: 9px;
        background: #141a22;
        cursor: pointer;
    }
    .mod-option input::before {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #737e8a;
        transition: transform 130ms ease, background 130ms ease;
    }
    .mod-option input:checked {
        border-color: rgba(89, 242, 170, 0.55);
        background: rgba(89, 242, 170, 0.14);
    }
    .mod-option input:checked::before {
        background: var(--mint);
        transform: translateX(14px);
        box-shadow: 0 0 8px rgba(89, 242, 170, 0.45);
    }

    .network-pane {
        padding: 0;
        overflow: hidden;
    }
    .network-heading {
        min-height: 64px;
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) auto;
        align-items: center;
        gap: 9px;
        padding: 0 12px;
        border-bottom: 1px solid var(--line-soft);
        background: #0c1016;
    }
    .network-heading > div:nth-child(2) {
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .network-heading strong {
        margin-top: 2px;
        color: #dce3e9;
        font-size: 11px;
    }
    .network-heading small { margin-top: 2px; color: #66717d; font-size: 8px; }
    .network-heading button {
        height: 29px;
        display: flex;
        align-items: center;
        gap: 5px;
        border: 1px solid var(--line-strong);
        border-radius: 5px;
        padding: 0 8px;
        background: #121821;
        color: #8d98a5;
        cursor: pointer;
        font-size: 8px;
        font-weight: 700;
    }
    .network-heading button:hover { color: var(--text); border-color: #465361; }
    .devroom-frame { height: calc(100% - 64px); }

    .statusbar {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 16px;
        overflow: hidden;
        border-top: 1px solid var(--line-soft);
        padding: 0 10px;
        background: #090c10;
        color: #606b77;
        white-space: nowrap;
    }
    .status-primary {
        min-width: 0;
        flex: 1;
        gap: 7px;
        color: #7c8794;
    }
    .status-primary svg { flex: 0 0 auto; color: var(--cyan); }
    .status-primary span {
        min-width: 0;
        overflow: hidden;
        font-size: 9px;
        text-overflow: ellipsis;
    }
    .status-item,
    .status-root {
        flex: 0 0 auto;
        gap: 5px;
        color: #616c78;
        font-size: 8px;
    }
    .status-item.is-ready svg { color: var(--mint); }
    .status-root {
        max-width: 120px;
        color: #697582;
    }
    .status-root span {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .project-rail-collapsed .project-rail,
    .tool-dock-collapsed .tool-dock,
    .focus-mode .project-rail,
    .focus-mode .tool-dock {
        display: none;
    }
    .project-rail-collapsed .studio-layout {
        grid-template-columns: minmax(0, 1fr) 356px;
    }
    .tool-dock-collapsed .studio-layout {
        grid-template-columns: 284px minmax(0, 1fr);
    }
    .project-rail-collapsed.tool-dock-collapsed .studio-layout,
    .focus-mode .studio-layout {
        grid-template-columns: minmax(0, 1fr);
    }
    .focus-mode .rail-toggle { display: none; }

    @media (max-width: 1420px) {
        .studio-layout { grid-template-columns: 250px minmax(0, 1fr) 320px; }
        .project-rail-collapsed .studio-layout { grid-template-columns: minmax(0, 1fr) 320px; }
        .tool-dock-collapsed .studio-layout { grid-template-columns: 250px minmax(0, 1fr); }
        .topbar { grid-template-columns: minmax(220px, 1fr) auto minmax(290px, 1fr); }
        .workspace-chip:nth-of-type(3) { display: none; }
    }
    @media (max-width: 1220px) {
        .studio-layout { grid-template-columns: 196px minmax(0, 1fr) 260px; }
        .project-rail-collapsed .studio-layout { grid-template-columns: minmax(0, 1fr) 260px; }
        .tool-dock-collapsed .studio-layout { grid-template-columns: 196px minmax(0, 1fr); }
        .topbar { grid-template-columns: minmax(180px, 1fr) auto minmax(220px, 1fr); gap: 8px; }
        .view-switcher { min-width: 248px; grid-template-columns: repeat(3, minmax(72px, 1fr)); }
        .service-state span { display: none; }
        .service-state { width: 32px; justify-content: center; padding: 0; }
        .project-copy p { display: none; }
        .workspace-chip:not(.is-renderer) { display: none; }
        .tool-pane { padding: 14px; }
        .ai-route-controls { grid-template-columns: 1fr; }
        .ai-config-note { grid-column: auto; }
        .ai-presets button span { display: none; }
        .split-workspace {
            grid-template-columns: 1fr;
            grid-template-rows: minmax(300px, 58%) minmax(220px, 42%);
        }
        .split-code { border-top: 1px solid var(--line-strong); border-left: 0; }
    }
    @media (max-width: 980px) {
        .studio-layout { grid-template-columns: 172px minmax(0, 1fr) 228px; }
        .project-rail-collapsed .studio-layout { grid-template-columns: minmax(0, 1fr) 228px; }
        .tool-dock-collapsed .studio-layout { grid-template-columns: 172px minmax(0, 1fr); }
        .brand-lockup span, .service-state, .save-state span, .toolbar-button span { display: none; }
        .topbar { grid-template-columns: minmax(100px, 1fr) auto minmax(100px, 1fr); }
        .view-switcher { min-width: 210px; }
        .workspace-toolbar { padding-left: 10px; gap: 8px; }
        .workspace-toolbar-actions { gap: 4px; }
    }
    @media (max-height: 780px) {
        .studio-shell { grid-template-rows: 58px minmax(0, 1fr) 28px; }
        .project-rail { grid-template-rows: auto minmax(160px, 1fr) minmax(150px, 34%); }
        .workspace { grid-template-rows: 54px minmax(0, 1fr); }
        .tool-dock { grid-template-rows: 44px minmax(0, 1fr); }
        .tool-pane { padding-top: 13px; }
        .tool-header { margin-bottom: 12px; }
        .ai-presets button { min-height: 42px; }
        .ai-instruction { height: 110px; }
    }
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_edit_candidate_rejects_empty_and_broken_json() {
        assert!(validate_ai_edit_candidate(Path::new("game.js"), "const x = 1;", "  ").is_err());
        assert!(validate_ai_edit_candidate(Path::new("manifest.json"), "{}", "{broken}").is_err());
        assert!(
            validate_ai_edit_candidate(Path::new("manifest.json"), "{}", "{\"ok\":true}").is_ok()
        );
    }

    #[test]
    fn ai_edit_candidate_preserves_html_document_boundary() {
        let original = "<!doctype html><html><body>game</body></html>";
        assert!(
            validate_ai_edit_candidate(Path::new("index.html"), original, "<body>partial</body>")
                .is_err()
        );
        assert!(
            validate_ai_edit_candidate(
                Path::new("index.html"),
                original,
                "<!doctype html><html><body>updated</body></html>"
            )
            .is_ok()
        );
    }

    #[test]
    fn ai_failure_activity_keeps_the_specific_primary_cause() {
        let message = "OpenRouter API key invalid or expired (HTTP 401). Replace it in PhantomForce Settings → Bridges & Connectors, then retry. Automatic fallbacks also failed: Codex desktop fallback could not start.";
        assert_eq!(
            ai_failure_activity(message),
            "OpenRouter API key invalid or expired (HTTP 401). Replace it in PhantomForce Settings → Bridges & Connectors, then retry."
        );
    }

    fn temp_import_dir(name: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be available")
            .as_nanos();
        std::env::temp_dir().join(format!("phantomplay-{name}-{stamp}"))
    }

    #[test]
    fn model_dropdown_keeps_the_selected_model_visible() {
        let options = vec![model_option("model-a", "Model A")];
        let visible = ai_model_dropdown_options(options, "model-b");

        assert_eq!(
            visible.first().map(|option| option.id.as_str()),
            Some("model-b")
        );
        assert!(visible.iter().any(|option| option.id == "model-a"));
    }

    #[test]
    fn route_status_names_the_model_selected_in_the_ai_pane() {
        let options = vec![model_option("model-a", "Model A")];
        let status =
            ai_route_status_text("openrouter", "model-a", &options, Some(true), false, &None);

        assert_eq!(status, "Selected model: Model A");
    }

    #[test]
    fn route_status_explains_an_invalid_openrouter_key() {
        let error = Some(
            "OpenRouter API key invalid or expired (HTTP 401). Replace it in PhantomForce Settings → Bridges & Connectors."
                .to_string(),
        );
        let status = ai_route_status_text(
            "openrouter",
            "deepseek/deepseek-v4-flash",
            &[],
            Some(false),
            false,
            &error,
        );

        assert_eq!(status, error.unwrap());
    }

    #[test]
    fn godot_folder_without_index_imports_as_native_source() {
        let source = temp_import_dir("godot-source");
        fs::create_dir_all(source.join("rooms")).expect("source folder should be created");
        fs::write(source.join("project.binary"), b"godot-binary-placeholder")
            .expect("project marker should write");
        fs::write(
            source.join("main.tscn"),
            b"[gd_scene load_steps=1 format=3]",
        )
        .expect("scene should write");
        fs::write(source.join("rooms").join("room.gd"), b"extends Node2D")
            .expect("script should write");

        let imported = import_game_project(&source).expect("Godot source tree should import");
        let target = games_dir().join(&imported);
        assert!(!target.join("index.html").is_file());
        assert!(target.join("project.binary").is_file());
        assert!(target.join("main.tscn").is_file());
        assert!(is_godot_project_tree(&target));

        let _ = fs::remove_dir_all(&source);
        let _ = fs::remove_dir_all(&target);
    }

    #[test]
    fn unreal_and_unity_folders_import_without_web_entries() {
        let unreal_source = temp_import_dir("unreal-source");
        fs::create_dir_all(&unreal_source).expect("Unreal source folder should be created");
        fs::write(unreal_source.join("ImportedGame.uproject"), b"{}")
            .expect("Unreal project marker should write");
        let unreal_id =
            import_game_project(&unreal_source).expect("Unreal source tree should import");
        let unreal_target = games_dir().join(&unreal_id);
        assert!(is_unreal_project_tree(&unreal_target));
        assert!(!unreal_target.join("index.html").is_file());

        let unity_source = temp_import_dir("unity-source");
        fs::create_dir_all(unity_source.join("Assets"))
            .expect("Unity Assets folder should be created");
        fs::write(unity_source.join("Assets").join("Main.unity"), b"%YAML 1.1")
            .expect("Unity scene should write");
        fs::create_dir_all(unity_source.join("ProjectSettings"))
            .expect("Unity ProjectSettings folder should be created");
        fs::write(
            unity_source
                .join("ProjectSettings")
                .join("ProjectVersion.txt"),
            b"m_EditorVersion: 6000.2.0f1",
        )
        .expect("Unity project marker should write");
        let unity_id = import_game_project(&unity_source).expect("Unity source tree should import");
        let unity_target = games_dir().join(&unity_id);
        assert!(is_unity_project_tree(&unity_target));
        assert!(!unity_target.join("index.html").is_file());

        let _ = fs::remove_dir_all(&unreal_source);
        let _ = fs::remove_dir_all(&unreal_target);
        let _ = fs::remove_dir_all(&unity_source);
        let _ = fs::remove_dir_all(&unity_target);
    }
}
