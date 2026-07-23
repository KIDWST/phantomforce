# PhantomPlay (native shell)

Branding note: this IS "PhantomPlay" to end users — no "Dioxus" name/logo anywhere in the product surface (window title, taskbar icon, in-app header all use the real ghost mark from `app/assets/brand-phantom.png`, embedded at compile time). Dioxus, Rust, and every other underlying technology get credit in posts/sponsorships/build credits, not in the app chrome — the directory/crate name (`phantomplay-dioxus-shell` / `phantomplay_dioxus_shell`) stays descriptive for developers only.

A new native/cross-platform Rust shell for PhantomPlay, built additively per the 2026-07-23 mission. This does **not** wrap an existing native app — Phase 1 reconnaissance confirmed no native/Rust/WASM shell exists anywhere in `phantomforce-live` (the "desktop app" is a thin launcher that opens a browser to the live site). This package is a genuinely new native client — see the Phase 1 Preservation Map for the full evidence:

`Documents\Obsidian\PhantomForce-Command-Center\01 Processes\2026-07-23 PhantomPlay Dioxus Mission - Phase 1 Preservation Map.md`

## Non-negotiable constraint

Nothing under `app/`, `server/`, or any existing `app/games/*` file is modified by this package. It is purely additive — same rule the repo already applies to `phantomplay-v2.js` and `phantomplay-edge-worker`. If this shell is ever promoted to primary, that is a separate, explicit, staged decision (mission Phase 13), not something this package does on its own. It is also **not** wired into `scripts/ship-live-admin.mjs`'s test gates — a broken/incomplete Rust build here cannot block or affect the existing website's deploys.

## Status: Phase 3 — real native code editor + standalone player (2026-07-23)

- Cargo workspace scaffolded (`dioxus = "0.7.9"`, desktop feature), builds clean with zero warnings.
- **Editor — genuinely functional, not a decorative splash screen.** Reads `app/games/` straight off the disk of whatever checkout `PHANTOMPLAY_LIVE_ROOT` points at (default: this repo's known live path), lists every game (single-file and multi-file), and for a selected game lists **every file in its directory** — not the existing web dev-workbench's fixed 3-slot (index.html/style.css/game.js) limitation that caused the original drag-drop bug report. Click any file, edit it in a real text area, click Save, and it writes straight back to the real file on disk. No separate "dev override" layer, so nothing to desync — the existing web server serves these files raw with no build step, so a save here is visible on the game's next page load.
- **Player — real standalone gameplay, zero PhantomForce dependency.** Each game row has a ▶ button that opens a second native window and actually plays the game: an `iframe` loads through a `phantomplay-game://` custom protocol (`http://phantomplay-game.localhost/…` on Windows — WebView2 requires that specific form, not `scheme://host/`) whose handler reads the game's real files straight off disk and serves them with correct MIME types. No HTTP call to the Fastify API, no login, no PhantomForce account, no tenant/org — verified with a real screenshot of `beat-strike` actually rendering and running inside the player window. This is what makes "PhantomPlay without joining PhantomForce" real rather than aspirational.
- Deliberately does **not** go through the HTTP `dev-mode/:id/override` API for editing — that system is a per-workspace draft mechanism for ordinary users; this tool edits the actual checked-out files directly, which only makes sense for someone (the owner) who already has the live repo open locally.
- 4 real unit tests (`cargo test`) run against the actual live `app/games/` directory: confirms 20+ real games are discovered, confirms `phantom-pizzeria` (a real multi-file game) exposes ALL of its files not just index.html, confirms a single-file game like `neon-drift.html` exposes exactly itself, and a save/reload round-trip test that writes a probe marker into the real `phantom-pizzeria/game.js`, reads it back, asserts it matches exactly, and restores the original content afterward (panic-safe via a `Drop` guard) — verified to leave zero diff in git.
- `PHANTOMPLAY_AUTOPLAY_TEST=1` env var auto-launches the first game's player on startup — a dev/screenshot-testing convenience, not user-facing behavior.
- **Not yet done, honestly:** no account/session bridge to the HTTP API (so no cross-device saves/leaderboards/rooms from this shell yet — those still require the web app), no room/multiplayer client (Phase 1 found the real multiplayer system is plain HTTP-polling REST, not P2P — a client for it hasn't been built), no syntax highlighting (plain textarea), single-file-open-at-a-time in the editor, Windows-only build/protocol-URL verified (macOS/Linux use a different custom-protocol URL form per wry's docs — code has the `#[cfg]` branch but is untested), no installer/distributable package yet (currently `cargo run` from source only), games with real save/multiplayer requirements will run but any network-dependent features inside them will simply fail since there's no backend involved in this launch path.

## Requirements

- Rust (installed via `rustup`, MSVC toolchain on Windows — needs Visual Studio Build Tools' C++ workload for the linker).
- Dioxus CLI: `cargo install dioxus-cli`

## Commands

```
npm run build   # cargo build
npm run dev     # cargo run
npm run test    # cargo test
```

Or directly: `cargo run` / `cargo build` / `dx serve` from this directory.
