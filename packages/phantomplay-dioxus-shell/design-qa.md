# PhantomPlay Game Studio Design QA

Date: 2026-07-30

## Reference

Baseline:
`%LOCALAPPDATA%\Temp\codex-clipboard-0a70031d-4903-41e7-85bf-d5991c41c152.png`

Verified installed build:
`%LOCALAPPDATA%\Programs\PhantomPlay\PhantomPlay.exe`

Desktop viewport tested: 1707 x 960.

## Findings And Resolution

### P0

- The game opened in a second native window. Resolved by hosting the game in the central studio
  workspace and registering the game protocol on the main WebView.
- The player body did not fill its window, producing a large blank region. Resolved with stable
  full-height document, root, and iframe dimensions.
- The shipped product exposed the framework shell identity. Resolved across the executable,
  installer, shortcuts, title, icon, header, and accessibility document name.

### P1

- Source editing, AI tools, mods, runtime information, and collaboration were split across
  disconnected windows or launch controls. Resolved with one persistent three-column studio and
  Play, Code, and Split modes.
- Dev Room code creation failed because the embedded custom-protocol page attempted a cross-origin
  HTTP request. Resolved by generating collision-resistant local room codes and keeping the
  configured API origin for WebSocket signaling.
- Existing runtime labels overstated a shared engine. Resolved with source-backed renderer,
  runtime, file-count, size, host, network, hot-reload, and embedded-play facts.

### P2

- Dense tools could compete with gameplay space. Resolved with Focus mode and constrained,
  independently scrollable project, source, editor, and tool regions.
- The project list did not explain renderer differences. Resolved with per-project renderer badges.
- Mod controls were detached from the active project. Resolved with a selected-project mod panel
  beside the embedded game.

## Native Verification

- Installed application launches as one `PhantomPlay` window.
- No framework name appears in the active accessibility tree.
- VesperGate renders at full workspace height.
- `Begin the tale` transitions into the playable Maren's Cottage scene.
- Code mode displays the selected real source file.
- Split mode displays the live game and source editor together.
- Runtime reports `Game-specific engine`, `Canvas2D`, 22 files, and 217 KB for VesperGate.
- Mods display the VesperGate manifest entries.
- Dev Room creates a six-character room code and joins the local WebSocket room as `LocalTest`.
- The Room panel remains inside the main application.

Final result: passed. No unresolved P0, P1, or P2 visual issue was observed at the tested viewport.
