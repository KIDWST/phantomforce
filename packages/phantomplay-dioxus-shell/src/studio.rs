use super::*;

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
}

fn preferred_file_index(files: &[(PathBuf, String)]) -> Option<usize> {
    ["game.js", "index.html", "engine.js"]
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
    match fs::write(&path, editor_content()) {
        Ok(()) => {
            dirty.set(false);
            status.set(format!(
                "Saved {}. The embedded game will hot reload.",
                path.display()
            ));
        }
        Err(error) => status.set(format!("Save failed for {}: {error}", path.display())),
    }
}

fn current_game(
    games: Signal<Vec<GameEntry>>,
    selected_game: Signal<Option<usize>>,
) -> Option<GameEntry> {
    selected_game().and_then(|index| games().get(index).cloned())
}

#[component]
pub(crate) fn Studio() -> Element {
    let games = use_signal(list_games);
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
    let mut store_query = use_signal(String::new);
    let mut status = use_signal(|| {
        format!(
            "{} projects available in {}",
            games().len(),
            games_dir().display()
        )
    });

    let mut ai_instruction = use_signal(String::new);
    let mut ai_busy = use_signal(|| false);
    let mut api_online = use_signal(|| None::<bool>);

    let mut mods_game_id = use_signal(String::new);
    let mut mods_list = use_signal(Vec::<ModEntry>::new);
    let mut mods_enabled = use_signal(Vec::<String>::new);

    use_effect(move || {
        spawn(async move {
            api_online.set(Some(check_api_health().await));
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
        playing_entry.set(Some(game_entry_name(&game)));
        mods_game_id.set(game.id.clone());
        mods_list.set(read_mod_manifest(&game.id));
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
            "Playing {} inside PhantomPlay. Auto reload is active.",
            game.blurb
                .as_ref()
                .map(|blurb| blurb.title.as_str())
                .unwrap_or(game.id.as_str())
        ));
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
        mods_list.set(read_mod_manifest(&game.id));
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

    let mut launch_game = move |index: usize| {
        let Some(game) = games().get(index).cloned() else {
            return;
        };
        let entry_path = if game.is_dir {
            game.path.join("index.html")
        } else {
            game.path.clone()
        };
        if !entry_path.exists() {
            status.set(format!("{} does not have a playable entry file.", game.id));
            return;
        }

        let project_files = list_files(&game);
        let first_file = preferred_file_index(&project_files);
        selected_game.set(Some(index));
        files.set(project_files);
        mods_game_id.set(game.id.clone());
        mods_list.set(read_mod_manifest(&game.id));
        mods_enabled.set(read_enabled_mods(&game.id));
        if selected_file().is_none()
            && let Some(file_index) = first_file
        {
            load_project_file(
                file_index,
                files,
                selected_file,
                editor_content,
                dirty,
                status,
            );
        }
        playing_entry.set(Some(game_entry_name(&game)));
        reload_token.set(reload_token().wrapping_add(1));
        workspace_view.set(WorkspaceView::Play);
        status.set(format!(
            "{} is running in the embedded viewport with hot reload.",
            game.blurb
                .as_ref()
                .map(|blurb| blurb.title.as_str())
                .unwrap_or(game.id.as_str())
        ));
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
            return;
        };
        let Some(file_index) = selected_file() else {
            status.set("Choose a source file before asking Phantom AI.".to_string());
            return;
        };
        let Some((path, file_label)) = files().get(file_index).cloned() else {
            return;
        };
        let instruction = ai_instruction();
        if instruction.trim().is_empty() {
            status.set("Describe the change you want Phantom AI to make.".to_string());
            return;
        }

        let content = editor_content();
        ai_busy.set(true);
        status.set(format!("Phantom AI is reviewing {file_label}."));
        let mut editor_content = editor_content;
        let mut dirty = dirty;
        let mut status = status;
        let mut ai_busy = ai_busy;
        spawn(async move {
            match request_ai_edit(game.id, file_label.clone(), content, instruction).await {
                Ok(new_content) => match fs::write(&path, &new_content) {
                    Ok(()) => {
                        editor_content.set(new_content);
                        dirty.set(false);
                        status.set(format!(
                            "Phantom AI updated {file_label}. The game will hot reload."
                        ));
                    }
                    Err(error) => status.set(format!(
                        "Phantom AI returned an edit, but saving {file_label} failed: {error}"
                    )),
                },
                Err(error) => {
                    status.set(format!("Phantom AI could not edit {file_label}: {error}"))
                }
            }
            ai_busy.set(false);
        });
    };

    let project = current_game(games, selected_game);
    let selected_path = selected_file()
        .and_then(|index| {
            files()
                .get(index)
                .map(|(path, _)| path.display().to_string())
        })
        .unwrap_or_else(|| "No source file selected".to_string());

    rsx! {
        style { {STUDIO_STYLE} }
        div {
            class: if focus_mode() { "studio-shell focus-mode" } else { "studio-shell" },
            header { class: "topbar",
                div { class: "brand-lockup",
                    img {
                        class: "brand-mark",
                        src: brand_data_uri(),
                        alt: "PhantomPlay"
                    }
                    div {
                        strong { "PhantomPlay" }
                        span { "Game Studio" }
                    }
                }
                nav { class: "view-switcher", aria_label: "Workspace view",
                    button {
                        class: if workspace_view() == WorkspaceView::Play { "is-active" } else { "" },
                        disabled: playing_entry().is_none(),
                        onclick: move |_| workspace_view.set(WorkspaceView::Play),
                        "Play"
                    }
                    button {
                        class: if workspace_view() == WorkspaceView::Code { "is-active" } else { "" },
                        onclick: move |_| workspace_view.set(WorkspaceView::Code),
                        "Code"
                    }
                    button {
                        class: if workspace_view() == WorkspaceView::Split { "is-active" } else { "" },
                        disabled: playing_entry().is_none(),
                        onclick: move |_| workspace_view.set(WorkspaceView::Split),
                        "Split"
                    }
                }
                div { class: "topbar-actions",
                    div {
                        class: match api_online() {
                            Some(true) => "connection is-online",
                            Some(false) => "connection is-offline",
                            None => "connection",
                        },
                        span { class: "connection-dot" }
                        {match api_online() {
                            Some(true) => "AI + network ready",
                            Some(false) => "Local API offline",
                            None => "Checking services",
                        }}
                    }
                    button {
                        class: "quiet-button",
                        onclick: move |_| {
                            reload_token.set(reload_token().wrapping_add(1));
                            status.set("Game viewport reloaded.".to_string());
                        },
                        disabled: playing_entry().is_none(),
                        "Reload"
                    }
                    button {
                        class: "quiet-button",
                        onclick: move |_| focus_mode.set(!focus_mode()),
                        if focus_mode() { "Exit focus" } else { "Focus" }
                    }
                }
            }

            div { class: "studio-layout",
                aside { class: "project-rail",
                    div { class: "rail-heading",
                        div {
                            span { "PROJECTS" }
                            strong { "{games().len()} games" }
                        }
                        input {
                            class: "project-search",
                            placeholder: "Find a game",
                            aria_label: "Find a game",
                            value: "{store_query}",
                            oninput: move |event| store_query.set(event.value()),
                        }
                    }
                    div { class: "project-list",
                        for (index, game) in games().iter().cloned().enumerate() {
                            if store_query().trim().is_empty()
                                || game.id.to_lowercase().contains(&store_query().to_lowercase())
                                || game.blurb.as_ref().is_some_and(|blurb| {
                                    blurb.title.to_lowercase().contains(&store_query().to_lowercase())
                                })
                            {
                                article {
                                    class: if selected_game() == Some(index) {
                                        "project-card is-active"
                                    } else {
                                        "project-card"
                                    },
                                    onclick: move |_| select_project(index),
                                    div { class: "project-card-heading",
                                        strong {
                                            "{game.blurb.as_ref().map(|blurb| blurb.title.clone()).unwrap_or_else(|| game.id.clone())}"
                                        }
                                        span { "{game.runtime.renderer}" }
                                    }
                                    if let Some(blurb) = game.blurb.as_ref() {
                                        if !blurb.genre.is_empty() {
                                            p { class: "project-genre", "{blurb.genre}" }
                                        }
                                        if !blurb.fantasy.is_empty() {
                                            p { class: "project-summary", "{blurb.fantasy}" }
                                        }
                                    }
                                    div { class: "project-card-actions",
                                        button {
                                            onclick: move |event| {
                                                event.stop_propagation();
                                                launch_game(index);
                                            },
                                            "Play"
                                        }
                                        button {
                                            onclick: move |event| {
                                                event.stop_propagation();
                                                select_project(index);
                                                workspace_view.set(WorkspaceView::Code);
                                            },
                                            "Source"
                                        }
                                    }
                                }
                            }
                        }
                    }
                    section { class: "file-browser",
                        div { class: "file-browser-title",
                            span { "SOURCE" }
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
                                    "{entry.1}"
                                }
                            }
                        }
                    }
                }

                main { class: "workspace",
                    div { class: "workspace-toolbar",
                        div { class: "workspace-title",
                            if let Some(game) = project.as_ref() {
                                strong {
                                    "{game.blurb.as_ref().map(|blurb| blurb.title.clone()).unwrap_or_else(|| game.id.clone())}"
                                }
                                span {
                                    "{game.runtime.engine} / {game.runtime.renderer} / {game.runtime.size_label()}"
                                }
                            } else {
                                strong { "No project selected" }
                                span { "Choose a game from Projects" }
                            }
                        }
                        div { class: "workspace-toolbar-actions",
                            button {
                                class: "secondary-button",
                                disabled: selected_file().is_none(),
                                onclick: move |_| save_active_file(
                                    selected_file,
                                    files,
                                    editor_content,
                                    dirty,
                                    status,
                                ),
                                if dirty() { "Save changes" } else { "Saved" }
                            }
                            button {
                                class: "primary-button",
                                disabled: selected_game().is_none(),
                                onclick: move |_| {
                                    if let Some(index) = selected_game() {
                                        launch_game(index);
                                    }
                                },
                                "Run game"
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
                                    strong { "Choose a game to run" }
                                    span { "The playable build will stay inside this workspace." }
                                }
                            }
                        }
                    } else if workspace_view() == WorkspaceView::Code {
                        section { class: "code-workspace",
                            div { class: "code-path", "{selected_path}" }
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
                                div { class: "code-path", "{selected_path}" }
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
                    nav { class: "tool-tabs", aria_label: "Game tools",
                        button {
                            class: if tool_tab() == ToolTab::Ai { "is-active" } else { "" },
                            onclick: move |_| tool_tab.set(ToolTab::Ai),
                            "AI"
                        }
                        button {
                            class: if tool_tab() == ToolTab::Runtime { "is-active" } else { "" },
                            onclick: move |_| tool_tab.set(ToolTab::Runtime),
                            "Runtime"
                        }
                        button {
                            class: if tool_tab() == ToolTab::Mods { "is-active" } else { "" },
                            onclick: move |_| tool_tab.set(ToolTab::Mods),
                            "Mods"
                        }
                        button {
                            class: if tool_tab() == ToolTab::Network { "is-active" } else { "" },
                            onclick: move |_| tool_tab.set(ToolTab::Network),
                            "Room"
                        }
                    }

                    section {
                        class: if tool_tab() == ToolTab::Ai {
                            "tool-pane is-active"
                        } else {
                            "tool-pane"
                        },
                        div { class: "tool-heading",
                            span { "PHANTOM AI" }
                            strong { "Edit the active file" }
                            p {
                                "Describe the result. Phantom AI applies the change to the real source and the game reloads."
                            }
                        }
                        div { class: "ai-presets",
                            button {
                                onclick: move |_| ai_instruction.set(
                                    "Find and fix the most likely runtime bug in this file. Preserve gameplay behavior and explain the exact change in code comments only where necessary.".to_string()
                                ),
                                "Fix runtime bug"
                            }
                            button {
                                onclick: move |_| ai_instruction.set(
                                    "Optimize this file for stable frame pacing and lower per-frame allocations without changing the visible game design.".to_string()
                                ),
                                "Improve frame time"
                            }
                            button {
                                onclick: move |_| ai_instruction.set(
                                    "Review this file for input, resize, focus, pause, and hot-reload failures. Implement the safe fixes directly.".to_string()
                                ),
                                "Harden controls"
                            }
                        }
                        textarea {
                            class: "ai-instruction",
                            placeholder: "What should change in the selected file?",
                            value: "{ai_instruction}",
                            oninput: move |event| ai_instruction.set(event.value()),
                        }
                        button {
                            class: "ai-apply",
                            disabled: ai_busy() || selected_file().is_none(),
                            onclick: ask_ai,
                            if ai_busy() { "Working..." } else { "Apply with Phantom AI" }
                        }
                        p { class: "tool-note",
                            if selected_file().is_some() {
                                "Target: {selected_path}"
                            } else {
                                "Choose a source file to enable AI editing."
                            }
                        }
                    }

                    section {
                        class: if tool_tab() == ToolTab::Runtime {
                            "tool-pane is-active"
                        } else {
                            "tool-pane"
                        },
                        div { class: "tool-heading",
                            span { "RUNTIME" }
                            strong { "What is actually running" }
                            p { "Live facts from the selected project, not capability claims." }
                        }
                        if let Some(game) = project.as_ref() {
                            div { class: "runtime-metrics",
                                div {
                                    span { "Renderer" }
                                    strong { "{game.runtime.renderer}" }
                                }
                                div {
                                    span { "Shared runtime" }
                                    strong { "{game.runtime.engine}" }
                                }
                                div {
                                    span { "Source files" }
                                    strong { "{game.runtime.file_count}" }
                                }
                                div {
                                    span { "Project size" }
                                    strong { "{game.runtime.size_label()}" }
                                }
                            }
                            div { class: "runtime-checks",
                                p {
                                    span {
                                        class: if game.runtime.host_bridge { "check is-ready" } else { "check" }
                                    }
                                    b { "Host bridge" }
                                    small {
                                        if game.runtime.host_bridge {
                                            "postMessage lifecycle hooks detected"
                                        } else {
                                            "No host lifecycle hook detected"
                                        }
                                    }
                                }
                                p {
                                    span {
                                        class: if game.runtime.network_hooks { "check is-ready" } else { "check" }
                                    }
                                    b { "Game networking" }
                                    small {
                                        if game.runtime.network_hooks {
                                            "Realtime or room hooks detected"
                                        } else {
                                            "Runs as a local single-player project"
                                        }
                                    }
                                }
                                p {
                                    span { class: "check is-ready" }
                                    b { "Hot reload" }
                                    small { "Watching the real project directory" }
                                }
                                p {
                                    span { class: "check is-ready" }
                                    b { "Embedded play" }
                                    small { "No child game window" }
                                }
                            }
                        }
                    }

                    section {
                        class: if tool_tab() == ToolTab::Mods {
                            "tool-pane is-active"
                        } else {
                            "tool-pane"
                        },
                        div { class: "tool-heading",
                            span { "MODS" }
                            strong { "{mods_game_id}" }
                            p { "Changes load into the embedded game on the next reload." }
                        }
                        if mods_list().is_empty() {
                            div { class: "tool-empty",
                                strong { "Universal tools stay available" }
                                p {
                                    "Slow motion, visual filter, mute, zoom, and large cursor remain in the in-game F10 menu."
                                }
                            }
                        }
                        div { class: "mods-list",
                            for game_mod in mods_list().iter().cloned() {
                                label { class: "mod-option",
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
                                            status.set("Mod selection saved. Reload the game to apply it.".to_string());
                                        }
                                    }
                                    div {
                                        strong { "{game_mod.name}" }
                                        span { "{game_mod.desc}" }
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
                            div {
                                span { "DEV ROOM" }
                                strong { "Build together" }
                            }
                            button {
                                onclick: move |_| {
                                    api_online.set(None);
                                    spawn(async move {
                                        api_online.set(Some(check_api_health().await));
                                    });
                                },
                                "Reconnect"
                            }
                        }
                        div { class: "devroom-frame",
                            DevRoomFrame {}
                        }
                    }
                }
            }

            footer { class: "statusbar",
                span { class: "status-message", "{status}" }
                span { "Auto reload: on" }
                span {
                    if api_online() == Some(true) {
                        "Network: ready"
                    } else {
                        "Network: local API required"
                    }
                }
                span { "Root: {phantomplay_live_root().display()}" }
            }
        }
    }
}

const STUDIO_STYLE: &str = r#"
    :root {
        color-scheme: dark;
        font-family: Inter, "Segoe UI", system-ui, sans-serif;
        background: #030a08;
        color: #e9f4ef;
    }
    html, body, #main {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #030a08;
    }
    * { box-sizing: border-box; }
    button, input, textarea { font: inherit; }
    button { letter-spacing: 0; }
    .studio-shell {
        width: 100%;
        height: 100%;
        min-width: 1100px;
        min-height: 700px;
        display: grid;
        grid-template-rows: 58px minmax(0, 1fr) 28px;
        background: #030a08;
    }
    .topbar {
        display: flex;
        align-items: center;
        gap: 22px;
        padding: 0 16px;
        border-bottom: 1px solid #18332a;
        background: #06100d;
    }
    .brand-lockup {
        width: 252px;
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }
    .brand-mark {
        width: 30px;
        height: 30px;
        object-fit: contain;
        filter: drop-shadow(0 0 9px rgba(45, 255, 150, 0.35));
    }
    .brand-lockup div { min-width: 0; display: flex; flex-direction: column; }
    .brand-lockup strong { color: #67ffad; font-size: 17px; line-height: 1.05; }
    .brand-lockup span {
        color: #779288;
        font: 600 10px ui-monospace, "Cascadia Code", monospace;
        text-transform: uppercase;
    }
    .view-switcher {
        display: grid;
        grid-template-columns: repeat(3, 74px);
        height: 32px;
        border: 1px solid #24453a;
        border-radius: 6px;
        overflow: hidden;
        background: #081712;
    }
    .view-switcher button {
        border: 0;
        border-right: 1px solid #24453a;
        background: transparent;
        color: #88a198;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
    }
    .view-switcher button:last-child { border-right: 0; }
    .view-switcher button:hover { color: #d7e9e1; background: #10221c; }
    .view-switcher button.is-active {
        color: #06100d;
        background: #53f7a0;
    }
    .view-switcher button:disabled { opacity: 0.35; cursor: not-allowed; }
    .topbar-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .connection {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-right: 6px;
        color: #91a79e;
        font-size: 11px;
        white-space: nowrap;
    }
    .connection-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #708078;
    }
    .connection.is-online .connection-dot {
        background: #55f8a1;
        box-shadow: 0 0 9px rgba(85, 248, 161, 0.55);
    }
    .connection.is-offline { color: #ff9b8c; }
    .connection.is-offline .connection-dot { background: #ff715f; }
    .quiet-button, .secondary-button, .primary-button {
        min-height: 32px;
        border-radius: 6px;
        padding: 0 12px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 750;
    }
    .quiet-button, .secondary-button {
        border: 1px solid #2a493f;
        background: #0b1a15;
        color: #c6dbd2;
    }
    .quiet-button:hover, .secondary-button:hover { background: #132820; }
    .primary-button {
        border: 1px solid #53f7a0;
        background: #53f7a0;
        color: #03110a;
    }
    .primary-button:hover { background: #75ffb7; }
    button:disabled { opacity: 0.42; cursor: not-allowed; }
    .studio-layout {
        min-height: 0;
        display: grid;
        grid-template-columns: 292px minmax(0, 1fr) 340px;
    }
    .project-rail {
        min-height: 0;
        display: grid;
        grid-template-rows: auto minmax(180px, 1fr) minmax(180px, 38%);
        border-right: 1px solid #18332a;
        background: #06110d;
    }
    .rail-heading {
        padding: 12px;
        border-bottom: 1px solid #18332a;
    }
    .rail-heading > div,
    .file-browser-title {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 9px;
    }
    .rail-heading span,
    .file-browser-title span,
    .tool-heading > span,
    .network-heading span {
        color: #667f75;
        font: 800 10px ui-monospace, "Cascadia Code", monospace;
        text-transform: uppercase;
    }
    .rail-heading strong { color: #dcece5; font-size: 12px; }
    .project-search {
        width: 100%;
        height: 32px;
        border: 1px solid #24453a;
        border-radius: 6px;
        outline: 0;
        padding: 0 10px;
        background: #030b08;
        color: #e9f4ef;
        font-size: 12px;
    }
    .project-search:focus { border-color: #53f7a0; }
    .project-list {
        min-height: 0;
        overflow: auto;
        padding: 9px;
        scrollbar-color: #24453a transparent;
    }
    .project-card {
        margin-bottom: 7px;
        padding: 10px;
        border: 1px solid #18332a;
        border-radius: 7px;
        background: #081712;
        cursor: pointer;
    }
    .project-card:hover { border-color: #315b4c; background: #0b1d17; }
    .project-card.is-active {
        border-color: #48dd91;
        box-shadow: inset 3px 0 #48dd91;
    }
    .project-card-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .project-card-heading strong {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #edf8f3;
        font-size: 13px;
    }
    .project-card-heading span {
        flex: 0 0 auto;
        padding: 2px 6px;
        border: 1px solid #285346;
        border-radius: 4px;
        color: #65d8b2;
        font: 750 9px ui-monospace, "Cascadia Code", monospace;
    }
    .project-genre {
        margin: 5px 0 0;
        color: #7ba294;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
    }
    .project-summary {
        display: -webkit-box;
        margin: 5px 0 0;
        overflow: hidden;
        color: #91a79e;
        font-size: 11px;
        line-height: 1.35;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }
    .project-card-actions { display: flex; gap: 6px; margin-top: 8px; }
    .project-card-actions button {
        flex: 1;
        height: 27px;
        border: 1px solid #2a493f;
        border-radius: 5px;
        background: #0b1a15;
        color: #b8d0c6;
        cursor: pointer;
        font-size: 10px;
        font-weight: 750;
    }
    .project-card-actions button:first-child {
        border-color: #3dbb7d;
        color: #6bf6ad;
    }
    .file-browser {
        min-height: 0;
        display: flex;
        flex-direction: column;
        border-top: 1px solid #18332a;
    }
    .file-browser-title { margin: 0; padding: 10px 12px 7px; }
    .file-browser-title small { color: #71887f; font-size: 10px; }
    .file-list {
        min-height: 0;
        overflow: auto;
        padding: 0 8px 8px;
        scrollbar-color: #24453a transparent;
    }
    .file-row {
        display: block;
        width: 100%;
        height: 27px;
        overflow: hidden;
        border: 0;
        border-radius: 4px;
        padding: 0 8px;
        background: transparent;
        color: #a7bbb3;
        cursor: pointer;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 11px ui-monospace, "Cascadia Code", monospace;
    }
    .file-row:hover { background: #10221b; color: #dcece5; }
    .file-row.is-active { background: #183a2e; color: #6bf6ad; }
    .workspace {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: 49px minmax(0, 1fr);
        background: #020705;
    }
    .workspace-toolbar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 12px 0 15px;
        border-bottom: 1px solid #18332a;
        background: #07110e;
    }
    .workspace-title {
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .workspace-title strong {
        overflow: hidden;
        color: #edf8f3;
        font-size: 13px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .workspace-title span {
        overflow: hidden;
        color: #6f887e;
        font: 10px ui-monospace, "Cascadia Code", monospace;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .workspace-toolbar-actions { display: flex; gap: 7px; margin-left: auto; }
    .game-viewport, .split-game {
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: #020705;
    }
    .game-viewport > #main,
    .game-viewport iframe,
    .split-game > #main,
    .split-game iframe,
    .devroom-frame > #main,
    .devroom-frame iframe {
        width: 100%;
        height: 100%;
        border: 0;
    }
    .viewport-empty {
        width: 100%;
        height: 100%;
        display: grid;
        place-content: center;
        gap: 5px;
        text-align: center;
        background: #030a08;
    }
    .viewport-empty strong { font-size: 18px; color: #dcece5; }
    .viewport-empty span { font-size: 12px; color: #71887f; }
    .code-workspace, .split-code {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: 30px minmax(0, 1fr);
        background: #07100d;
    }
    .code-path {
        overflow: hidden;
        border-bottom: 1px solid #18332a;
        padding: 7px 11px;
        color: #739185;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 10px ui-monospace, "Cascadia Code", monospace;
    }
    .source-editor {
        width: 100%;
        height: 100%;
        min-height: 0;
        resize: none;
        border: 0;
        outline: 0;
        padding: 14px 16px 40px;
        background: #030b08;
        color: #e0eee8;
        caret-color: #62f7a9;
        tab-size: 2;
        font: 12px/1.55 "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    }
    .source-editor::selection { background: #1b5a42; }
    .split-workspace {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: minmax(280px, 58%) minmax(220px, 42%);
    }
    .split-game { border-bottom: 1px solid #285346; }
    .tool-dock {
        min-height: 0;
        display: grid;
        grid-template-rows: 42px minmax(0, 1fr);
        border-left: 1px solid #18332a;
        background: #08120f;
    }
    .tool-tabs {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        border-bottom: 1px solid #18332a;
    }
    .tool-tabs button {
        border: 0;
        border-right: 1px solid #18332a;
        background: #07110e;
        color: #789087;
        cursor: pointer;
        font-size: 11px;
        font-weight: 750;
    }
    .tool-tabs button:last-child { border-right: 0; }
    .tool-tabs button:hover { color: #dcece5; background: #10221b; }
    .tool-tabs button.is-active {
        color: #6bf6ad;
        box-shadow: inset 0 -2px #53f7a0;
    }
    .tool-pane {
        display: none;
        min-height: 0;
        overflow: auto;
        padding: 15px;
        scrollbar-color: #24453a transparent;
    }
    .tool-pane.is-active { display: block; }
    .tool-heading { margin-bottom: 15px; }
    .tool-heading strong {
        display: block;
        margin-top: 5px;
        color: #edf8f3;
        font-size: 15px;
    }
    .tool-heading p, .tool-empty p {
        margin: 6px 0 0;
        color: #849b92;
        font-size: 11px;
        line-height: 1.45;
    }
    .ai-presets {
        display: grid;
        grid-template-columns: 1fr;
        gap: 6px;
        margin-bottom: 10px;
    }
    .ai-presets button {
        min-height: 31px;
        border: 1px solid #355064;
        border-radius: 6px;
        background: #0d1921;
        color: #afd8f1;
        cursor: pointer;
        text-align: left;
        padding: 0 9px;
        font-size: 11px;
        font-weight: 700;
    }
    .ai-presets button:hover { background: #142735; }
    .ai-instruction {
        width: 100%;
        height: 150px;
        resize: vertical;
        border: 1px solid #43506b;
        border-radius: 7px;
        outline: 0;
        padding: 10px;
        background: #0b101b;
        color: #e8efff;
        font: 11px/1.45 ui-monospace, "Cascadia Code", monospace;
    }
    .ai-instruction:focus { border-color: #72aee6; }
    .ai-apply {
        width: 100%;
        height: 36px;
        margin-top: 8px;
        border: 1px solid #75bfff;
        border-radius: 6px;
        background: #2f8ed1;
        color: #f6fbff;
        cursor: pointer;
        font-size: 12px;
        font-weight: 800;
    }
    .ai-apply:hover { background: #3ca1e6; }
    .tool-note {
        overflow-wrap: anywhere;
        color: #698078;
        font: 10px/1.4 ui-monospace, "Cascadia Code", monospace;
    }
    .runtime-metrics {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1px;
        border: 1px solid #213c33;
        background: #213c33;
    }
    .runtime-metrics div {
        min-width: 0;
        padding: 10px;
        background: #091712;
    }
    .runtime-metrics span {
        display: block;
        color: #6e897e;
        font-size: 9px;
        text-transform: uppercase;
    }
    .runtime-metrics strong {
        display: block;
        overflow: hidden;
        margin-top: 3px;
        color: #dcece5;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
    }
    .runtime-checks { margin-top: 14px; }
    .runtime-checks p {
        display: grid;
        grid-template-columns: 9px 1fr;
        column-gap: 9px;
        margin: 0;
        padding: 9px 0;
        border-bottom: 1px solid #18332a;
    }
    .runtime-checks .check {
        grid-row: 1 / 3;
        width: 7px;
        height: 7px;
        margin-top: 5px;
        border-radius: 50%;
        background: #68776f;
    }
    .runtime-checks .check.is-ready { background: #53f7a0; }
    .runtime-checks b { color: #cfe1d9; font-size: 11px; }
    .runtime-checks small { color: #728a80; font-size: 10px; }
    .tool-empty {
        border-left: 2px solid #315b4c;
        padding: 9px 10px;
        background: #0a1813;
    }
    .tool-empty strong { color: #bfd5cc; font-size: 11px; }
    .mods-list { display: flex; flex-direction: column; }
    .mod-option {
        display: grid;
        grid-template-columns: 18px 1fr;
        gap: 8px;
        padding: 9px 0;
        border-bottom: 1px solid #18332a;
        cursor: pointer;
    }
    .mod-option input { accent-color: #53f7a0; margin-top: 2px; }
    .mod-option strong { display: block; color: #dcece5; font-size: 11px; }
    .mod-option span { display: block; margin-top: 2px; color: #788f86; font-size: 10px; }
    .network-pane { padding: 0; overflow: hidden; }
    .network-heading {
        height: 54px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 12px;
        border-bottom: 1px solid #18332a;
    }
    .network-heading div { min-width: 0; display: flex; flex-direction: column; }
    .network-heading strong { color: #dcece5; font-size: 12px; }
    .network-heading button {
        margin-left: auto;
        height: 28px;
        border: 1px solid #2a493f;
        border-radius: 5px;
        background: #0b1a15;
        color: #b8d0c6;
        cursor: pointer;
        font-size: 10px;
    }
    .devroom-frame { height: calc(100% - 54px); }
    .statusbar {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 18px;
        overflow: hidden;
        border-top: 1px solid #18332a;
        padding: 0 10px;
        background: #050e0b;
        color: #61786e;
        font: 9px ui-monospace, "Cascadia Code", monospace;
        white-space: nowrap;
    }
    .status-message {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        color: #8da69c;
        text-overflow: ellipsis;
    }
    .focus-mode .project-rail,
    .focus-mode .tool-dock { display: none; }
    .focus-mode .studio-layout { grid-template-columns: minmax(0, 1fr); }
    @media (max-width: 1280px) {
        .studio-layout { grid-template-columns: 250px minmax(0, 1fr) 300px; }
        .brand-lockup { width: 210px; }
        .connection { display: none; }
    }
"#;
