# PhantomPlay Dioxus Shell

A new native/cross-platform Rust shell for PhantomPlay, built additively per the 2026-07-23 mission. This does **not** wrap an existing native app — Phase 1 reconnaissance confirmed no native/Rust/WASM shell exists anywhere in `phantomforce-live` (the "desktop app" is a thin launcher that opens a browser to the live site). This package is a genuinely new native client that will bridge to the **existing, unmodified** Fastify/Postgres API and room system — see the Phase 1 Preservation Map for the full evidence:

`Documents\Obsidian\PhantomForce-Command-Center\01 Processes\2026-07-23 PhantomPlay Dioxus Mission - Phase 1 Preservation Map.md`

## Non-negotiable constraint

Nothing under `app/`, `server/`, or any existing `app/games/*` file is modified by this package. It is purely additive — same rule the repo already applies to `phantomplay-v2.js` and `phantomplay-edge-worker`. If this shell is ever promoted to primary, that is a separate, explicit, staged decision (mission Phase 13), not something this package does on its own. It is also **not** wired into `scripts/ship-live-admin.mjs`'s test gates — a broken/incomplete Rust build here cannot block or affect the existing website's deploys.

## Status: Phase 2 complete (2026-07-23)

- Cargo workspace scaffolded (`dioxus = "0.7.9"`, desktop feature), builds clean with zero warnings.
- Renders a branded startup surface (PhantomPlay dark/neon-green theme, matching the live product's actual CSS palette) in a real native desktop window (confirmed running — a live process with the correct rendered background was visually verified before this note was written).
- No bridge to the existing account/game/room system yet — that's Phase 3+.

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
