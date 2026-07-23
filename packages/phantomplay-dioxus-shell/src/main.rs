// PhantomPlay Dioxus shell — Phase 2 (mission 2026-07-23): a minimal,
// branded startup surface proving the native shell builds and runs. This is
// a genuinely new native client, not a wrapper — Phase 1 reconnaissance
// confirmed no existing native/Rust shell exists to wrap in phantomforce-live
// (see the Phase 1 Preservation Map in the Obsidian vault). It does not read
// from, write to, or otherwise touch anything under the existing `app/` or
// `server/` trees.
use dioxus::prelude::*;

fn main() {
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    let mut heartbeat = use_signal(|| 0u32);

    use_future(move || async move {
        loop {
            gloo_timers_sleep(1000).await;
            heartbeat += 1;
        }
    });

    rsx! {
        style { {STYLE} }
        div { class: "shell",
            div { class: "badge", "PHASE 2 · NATIVE SHELL SCAFFOLD" }
            h1 { "PhantomPlay" }
            p { class: "sub", "Dioxus desktop shell — proves the workspace builds and runs." }
            p { class: "heartbeat", "Alive for {heartbeat()}s" }
            p { class: "note",
                "This window bridges to nothing yet. The existing web app, games, and server are untouched."
            }
        }
    }
}

async fn gloo_timers_sleep(ms: u64) {
    tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
}

const STYLE: &str = r#"
    html, body { margin: 0; height: 100%; }
    .shell {
        height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        font-family: system-ui, sans-serif;
        color: #eafff3;
        background: radial-gradient(circle at 50% 28%, #0c3f2d 0, #03110c 42%, #010403 80%);
        text-align: center;
    }
    .badge {
        padding: 6px 14px;
        border: 1px solid #2cff9b55;
        border-radius: 999px;
        background: #020b08dd;
        font: 900 11px ui-monospace, monospace;
        color: #7dffbd;
        letter-spacing: 0.08em;
    }
    h1 {
        font-size: 56px;
        margin: 0;
        color: #61ffb0;
        text-shadow: 0 0 28px #28ff8d55;
    }
    .sub { color: #b3cebf; margin: 0; }
    .heartbeat { color: #4bffa3; font: 900 13px ui-monospace, monospace; margin: 0; }
    .note { color: #6b8577; font-size: 12px; max-width: 420px; margin: 12px 0 0; }
"#;
