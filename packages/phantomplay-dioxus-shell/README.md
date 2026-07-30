# PhantomPlay Game Studio

PhantomPlay is the native game-development surface for the PhantomForce ecosystem. The installed
product, window, executable, shortcuts, icon, and accessibility tree all use the PhantomPlay
identity.

## Current Product

The studio runs in one native window:

- **Play** renders the selected game inside the main workspace. It does not open a child game
  window.
- **Code** edits the selected project's real source files.
- **Split** keeps the game and editor visible together.
- **Phantom AI** sends an edit request for the active file through
  `/api/phantomplay/ai-edit`, saves the returned source, and reloads the game.
- **Runtime** reports the renderer, shared runtime, source-file count, project size, host bridge,
  game-network hooks, hot-reload state, and embedded-play state from the selected project's files.
- **Mods** reads the selected game's mod manifest and persists enabled mods.
- **Room** embeds the existing PhantomPlay Dev Room in the same tool dock, including room codes,
  WebSocket presence/chat, file-sync events, and WebRTC voice controls.
- **Focus** hides the side rails without moving gameplay to another window.

The project catalog is read directly from `app/games`. The current catalog contains 39 games.
Games and shared files are served from disk through the restricted `phantomplay-game://` protocol,
and selected-project changes trigger automatic reload.

## Runtime Boundaries

The studio is a working host, editor, debugger, mod manager, and collaboration client. It does not
pretend that every catalog game already uses a shared AAA renderer:

- Most current games use bespoke Canvas2D or DOM runtimes.
- VesperGate has a game-specific Canvas2D engine.
- `app/games/shared/phantomGameKernel.js` is a shared lifecycle/UI kernel, not a 3D renderer,
  physics engine, pathfinding system, or deterministic simulation.
- Large binary assets are currently read as complete files by the custom protocol. Range requests,
  asset streaming, GPU resource scheduling, and package-level asset manifests are required before
  production-scale content packs are practical.
- Real-time rooms preserve the existing networking features, but game simulation does not yet use
  deterministic lockstep or authoritative rollback.

The implementation program for renderer, simulation, networking, and content-pipeline scale is in
`docs/architecture/PHANTOMPLAY_ENGINE_SCOPING.md`.

## Development

Requirements:

- Rust with the MSVC toolchain on Windows
- The desktop build CLI installed through Cargo
- The PhantomForce API on `127.0.0.1:5190` for Phantom AI and Dev Rooms

The API origin can be overridden with `PHANTOMPLAY_API_ORIGIN`.

```powershell
npm run build
npm run dev
npm run test
cargo clippy --all-targets -- -D warnings
dx bundle --release
```

## Release

The release installer is produced at:

```text
target\dx\PhantomPlay\bundle\windows\nsis\PhantomPlay_0.2.0_x64-setup.exe
```

The verified per-user installation is:

```text
%LOCALAPPDATA%\Programs\PhantomPlay\PhantomPlay.exe
```

The installer creates `PhantomPlay` shortcuts on the desktop and in the Start Menu. The previous
installed shell and its shortcuts were backed up before removal at:

```text
%USERPROFILE%\Documents\Codex\backups\phantomplay-shell-20260730-113126\installed-old
```

## Verification

Automated checks cover project discovery, multi-file loading, runtime classification, safe asset
resolution, hot-reload injection, mod manifests, source save/reload, Dev Room code generation, and
single-window branding. Native checks cover installed launch, embedded title-to-gameplay
transition, Code and Split views, Runtime facts, Mods, and a successful local WebSocket Dev Room
join.
