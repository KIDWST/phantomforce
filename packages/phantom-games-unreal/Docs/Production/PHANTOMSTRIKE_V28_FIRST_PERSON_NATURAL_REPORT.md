# PhantomStrike V28R7 — First-Person Natural Environment Release

Date: 2026-08-21
Status: built, visually verified, installed, and promoted to PhantomPlay

## Outcome

- Forced a true local first-person presentation and permanently hid the third-person mannequin from the owning camera.
- Restored player possession, game-only input capture, standard axis bindings, direct WASD/arrow/controller reads, and a collision-safe movement fallback.
- Raised the standing camera to a natural eye line and moved insertion to a clear road position.
- Replaced the persistent blockout-city render layer with a tiled PBR forest road, PBR dirt/grass shoulders, center and edge markings, rolling terrain, and restrained daylight.
- Shipped 1,400 production ArchVis trees, 700 matching saplings, 24 rolling PBR landforms, and 42 PBR boulders through deterministic runtime placement.
- Removed the faceted CC0 trees, neon shrubs, fake grass tufts, toy-like vehicles, terrain-shell horizon wall, and blocky opening landmarks from the active V28 path.
- Preserved the invisible traversal surface and mission systems while replacing all legacy rendered primitives.

## Verification

- `Test-PhantomStrikeV28Playability.ps1`: pass
- Unreal realism asset registry: pass
- Unreal Engine 5.8.1 Shipping compile: pass
- Full Windows cook: 5,095 packages, 0 errors
- Candidate manifest and five critical SHA-256 checks: pass
- Offscreen candidate gameplay render: pass
- Installed launcher/package hash verification: pass
- Hidden installed-build gameplay launch/capture: pass, exit code 0
- Installed build-set revision: `V25R12+PHANTOMSTRIKE-V28R7`

Shipping SHA-256: `80C5597787D62BA19AA1AAACDFF7E0FE2D00128F8F5760D40B0B4015A63BB51D`

## Recovery

The prior V25R12 PhantomStrike install is preserved at:

`C:\Users\jorda\Documents\Codex\backups\phantomplay-phantom-strike-v25r12-to-v28r7-20260821-120638\phantom-strike`

The final candidate and installed gameplay proofs are stored under `Saved/PhantomGameplayProofV28R7` and are intentionally not source-controlled.
