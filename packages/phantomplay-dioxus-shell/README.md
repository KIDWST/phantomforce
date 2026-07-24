# PhantomPlay (native shell)

Branding note: this IS "PhantomPlay" to end users — no "Dioxus" name/logo anywhere in the product surface (window title, taskbar icon, in-app header all use the real ghost mark from `app/assets/brand-phantom.png`, embedded at compile time). Dioxus, Rust, and every other underlying technology get credit in posts/sponsorships/build credits, not in the app chrome — the directory/crate name (`phantomplay-dioxus-shell` / `phantomplay_dioxus_shell`) stays descriptive for developers only.

A native/cross-platform Rust shell for PhantomPlay, built additively per the 2026-07-23 mission and extended same-day into a real dev launcher/modifier. See the Phase 1 Preservation Map for the original evidence base:

`Documents\Obsidian\PhantomForce-Command-Center\01 Processes\2026-07-23 PhantomPlay Dioxus Mission - Phase 1 Preservation Map.md`

## Non-negotiable constraint

Nothing under `app/`, `server/`, or any existing `app/games/*` file's *gameplay logic* is modified without an explicit, additive reason (VesperGate's `VG.dev` test-hook object gained a few extra one-line hooks — `hp`, `maxHp`, `grantAllCosmetics`, `cosmeticIds` — purely to power its mod set; `VG.settings` gained `speedMul`/`damageDealtMul` the same accessibility-style way `damageTaken` already worked). This package is still purely additive — same rule the repo already applies to `phantomplay-v2.js` and `phantomplay-edge-worker`. It is also **not** wired into `scripts/ship-live-admin.mjs`'s test gates — a broken/incomplete Rust build here cannot block or affect the existing website's deploys.

## Status: full launcher + modifier (2026-07-23)

**Editor** — reads `app/games/` straight off disk, lists every file per game (not a fixed 3-slot subset), edits in a real textarea, saves straight back to the real file. No separate "dev override" layer.

**Player** — standalone gameplay, zero PhantomForce account/server dependency: a `phantomplay-game://` custom protocol now serves the *entire* `app/games/` root (not just the one game's folder), so a played game can reach `app/games/shared/modLoader.js` via an absolute `/shared/...` path. Both the played game and the shared mod loader are served from the real files on disk.

**Hot reload** — a `notify` file watcher starts on the selected game's directory (or single file) the moment you hit Play. The protocol handler serves the watcher's version counter at `/__pm_version`; an injected poll script in the served HTML reloads the page when it changes. Save in the editor while playing and the player window updates within ~1s.

**AI right inside the game** — an "✨ AI Assist" panel next to the editor. Type an instruction, it POSTs the open file + instruction to the local Fastify API's new `/api/phantomplay/ai-edit` route (spawns the same local Claude CLI already wired for Phantom Console, but with limits sized for real game files instead of that transport's 6-7K chat-reply caps), then writes the returned file straight to disk — hot reload picks it up in the open player automatically.

**Dev Rooms** — a "👥 Dev Room" header button opens a second native window (`phantomplay-devroom://`, a self-contained HTML/JS page) that joins a code-based WebSocket room on the local Fastify API (`/ws/phantomplay/devroom/:code`, no PhantomForce account needed — same trust model as sharing a Zoom link). Presence, text chat, and full-mesh WebRTC voice (browser-native `getUserMedia`/`RTCPeerConnection`, STUN-only, no TURN/media server) all run through it. File-sync broadcast messages are wired so saves show up in the room log — a live shared-view of what the host is editing is real follow-up work, not yet built.

**Mods quick-menu, separate from Dev Mode** — a 🧩 button per game row opens a native toggle list (reads `app/games/<id>/mods/manifest.json`, writes selection to `app/games/<id>/mods/.enabled.json`). The shared `app/games/shared/modLoader.js` loader (injected only through this shell's player, never on the public web app) ships **5 universal mods that work on every game with no cooperation required** (slow-mo, CRT filter, big cursor, mute, zoom) plus an F10 in-game overlay menu for live toggling. **VesperGate is the flagship with 13 real, working mods** (`app/games/vespergate/mods/`) built against its existing `VG.dev`/`__VespergateTest` hook object — God Mode, One-Hit Kill, Infinite Embers, Max Vesper Souls, All Cosmetics Unlocked, Speed Demon, Molasses Mode, Glass Cannon, Iron Hide, Beam Always Ready, Panic Button, Skip Cutscenes, Room Warp Menu. Scaling this to the other 39 games means giving each one a similar small hook object — the pattern and tooling are proven, the remaining authoring work is real and not yet done.

**Not yet done, honestly:**
- No account/session bridge to the HTTP API (no cross-device saves/leaderboards from this shell).
- Dev Room voice is STUN-only full mesh — works on the same network / most home NATs, will fail behind symmetric NAT without a TURN server (not set up).
- Dev Room's "shared file view" is chat-log breadcrumbs only, not a live synced read-only editor pane yet.
- No syntax highlighting, single-file-open-at-a-time in the editor.
- Mods exist in depth only for VesperGate; every other game currently only gets the 5 universal mods.
- Windows-only build/protocol-URL verified (macOS/Linux use a different custom-protocol URL form per wry's docs — code has the `#[cfg]` branch but is untested).
- No installer/distributable package built yet — see Packaging below.

## Requirements

- Rust (installed via `rustup`, MSVC toolchain on Windows — needs Visual Studio Build Tools' C++ workload for the linker).
- Dioxus CLI: `cargo install dioxus-cli`
- The local PhantomForce API running on `127.0.0.1:5190` (for AI Assist and Dev Rooms — the editor/player/mods-menu work fine without it).

## Commands

```
npm run build   # cargo build
npm run dev     # cargo run
npm run test    # cargo test
```

Or directly: `cargo run` / `cargo build` / `dx bundle` from this directory.

## Packaging (free download)

`dx bundle` produces a platform installer/executable from this same source — no separate distribution code path. Nothing has been published yet: building a release bundle and where to host it (GitHub Releases on the `KIDWST/phantomforce` repo is the natural free option, since the repo is already public) is a deliberate next step, not done silently by an agent, since publishing a binary is a more visible/public action than a normal commit.
