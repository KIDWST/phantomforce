# PhantomPlay production control plane

This slice turns the permanent PhantomPlay game-development directive into auditable platform behavior without pretending specialist tools, engine builds, playtests, or visual proof exist when they do not.

## Engine policy

- `phantom-strike`, `phantom-ages`, and `phantom-legends` are assigned exclusively to the Unreal project at `packages/phantom-games-unreal`.
- PhantomPlay itself remains multi-engine. Unrelated uploads can use web/DOM/Canvas/WebGL/WebGPU, Godot, Unity, Panda3D, Unreal, or an explicit native executable manifest.
- Tool and provider selection follows each project's `engine_key`; a Unity upload selects Unity tools, while the three flagships select Unreal tools.
- The retained Unity flagship-era tree is migration evidence and a compatibility fixture, not a launch fallback for the three Unreal games.

## Implemented now

- Runtime-discovered multi-engine Tool Registry and Provider Registry.
- Generic Creative Bible schema with backward-compatible reading of earlier Unity-only field names.
- Central asset registry with path, ownership, commercial-use, and license-evidence checks.
- Engine-dispatched dependency audits for Unreal project descriptors/modules/plugins and Unity package manifests.
- Deterministic creative decomposition and engine-aware task planning.
- Mandatory PhantomFlow routing for primary music requests.
- Validation that reports missing specialists and blocked providers instead of fabricating completion.
- Tenant/project-scoped, atomic JSON audit receipts.
- Admin API endpoints for current status and persisted audits.
- Curated official-engine-first knowledge search, repository scoring, per-engine sample coverage, profiling readiness, and dependency-sandbox planning.

## Existing systems consumed

- Unreal flagship source under `packages/phantom-games-unreal`.
- PhantomPlay desktop engine adapters under `packages/phantomplay-dioxus-shell`.
- Unity migration and compatibility fixture under `packages/phantom-games-unity`.
- Existing PhantomFlow local-engine bridge under `server/src/phantom-ai/phantomflow.ts`.
- Existing PhantomPlay access/session boundary.

## Deliberately not claimed complete

- Unreal compilation, editor play, screenshots, profiling, and Windows packages require an installed Unreal Editor matching the project.
- Unity compilation and play-mode proof still require Unity Editor for Unity uploads.
- PhantomFlow music generation requires the local engine to be online.
- Creature Factory, destruction, authored advanced VFX/shaders, adaptive music, balance simulation, and final performance validation remain blocked until real implementations and evidence exist.
- GitHub Scout searches and scores the curated index only. Live refresh and Repository Integrator execution remain unconfigured; knowledge search downloads and executes nothing.

## API

- `GET /api/phantomplay/production/status?project_id=phantom-games-unreal&request=...`
- `POST /api/phantomplay/production/audits`
- `GET /api/phantomplay/knowledge`
- `GET /api/phantomplay/knowledge/search?project_id=phantom-games-unreal&q=...`
- `POST /api/phantomplay/knowledge/decisions`

The POST body accepts `project_id` and `request`. Both routes require an admin session. Passing `phantom-games-unity` continues to exercise the Unity compatibility route.

## Verification

Run:

```powershell
npm run verify
```

This verifies server contracts, exact flagship identity, Unreal/Unity control-plane routing, multi-engine desktop launch adapters, and the no-fabricated-completion boundary. It does not compile Unreal without an installed editor.
