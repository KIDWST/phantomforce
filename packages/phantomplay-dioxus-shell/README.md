# PhantomPlay Dioxus Shell

A new native/cross-platform Rust shell for PhantomPlay, built additively per the 2026-07-23 mission. This does **not** wrap an existing native app — Phase 1 reconnaissance confirmed no native/Rust/WASM shell exists anywhere in `phantomforce-live` (the "desktop app" is a thin launcher that opens a browser to the live site). This package is a genuinely new native client that will bridge to the **existing, unmodified** Fastify/Postgres API and room system — see the Phase 1 Preservation Map for the full evidence:

`Documents\Obsidian\PhantomForce-Command-Center\01 Processes\2026-07-23 PhantomPlay Dioxus Mission - Phase 1 Preservation Map.md`

## Non-negotiable constraint

Nothing under `app/`, `server/`, or any existing `app/games/*` file is modified by this package. It is purely additive — same rule the repo already applies to `phantomplay-v2.js` and `phantomplay-edge-worker`. If this shell is ever promoted to primary, that is a separate, explicit, staged decision (mission Phase 13), not something this package does on its own. It is also **not** wired into `scripts/ship-live-admin.mjs`'s test gates — a broken/incomplete Rust build here cannot block or affect the existing website's deploys.

## Status: Phase 3 — real native code editor (2026-07-23)

- Cargo workspace scaffolded (`dioxus = "0.7.9"`, desktop feature), builds clean with zero warnings.
- **This is a genuinely functional tool, not a decorative splash screen.** It reads `app/games/` straight off the disk of whatever checkout `PHANTOMPLAY_LIVE_ROOT` points at (default: this repo's known live path), lists every game (single-file and multi-file), and for a selected game lists **every file in its directory** — not the existing web dev-workbench's fixed 3-slot (index.html/style.css/game.js) limitation that caused the original drag-drop bug report. Click any file, edit it in a real text area, click Save, and it writes straight back to the real file on disk.
- Because the existing web server serves these files raw with no build step (confirmed in Phase 1 recon), a save here is visible on the game's next page load — no separate "dev override" layer to desync between dev mode and normal mode, because there is no separate layer at all for this tool.
- Deliberately does **not** go through the HTTP `dev-mode/:id/override` API — that system is a per-workspace draft mechanism for ordinary users; this tool edits the actual checked-out files directly, which only makes sense for someone (the owner) who already has the live repo open locally.
- 4 real unit tests (`cargo test`) run against the actual live `app/games/` directory: confirms 20+ real games are discovered, confirms `phantom-pizzeria` (a real multi-file game) exposes ALL of its files not just index.html, confirms a single-file game like `neon-drift.html` exposes exactly itself, and a save/reload round-trip test that writes a probe marker into the real `phantom-pizzeria/game.js`, reads it back, asserts it matches exactly, and restores the original content afterward (panic-safe via a `Drop` guard) — verified to leave zero diff in git.
- Not yet done: no account/session bridge to the HTTP API, no room/multiplayer surface, no syntax highlighting (plain textarea), single-window only (no multi-file tabs yet), Windows-only build verified (macOS/Linux/mobile untested).

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
