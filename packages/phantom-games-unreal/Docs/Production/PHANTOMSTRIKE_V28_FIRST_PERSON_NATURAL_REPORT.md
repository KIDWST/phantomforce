# PhantomStrike V28R3 — First-Person Natural Environment Release

Date: 2026-08-21
Status: built, verified, and promoted to PhantomPlay

## Outcome

- Forced a true local first-person presentation and permanently hid the third-person mannequin from the owning camera.
- Restored player possession, game-only input capture, standard axis bindings, direct WASD/arrow/controller reads, and a collision-safe movement fallback.
- Raised the standing camera to a natural eye line and moved insertion to a clear road position.
- Replaced the persistent prototype city render layer with authored terrain, restrained daylight, a tiled PBR road, 240 licensed trees, 96 rocks, and 260 shrubs.
- Normalized vehicles to real-world scale and moved them off the playable lane.
- Removed the two low-detail opening landmarks and expanded legacy cleanup to every rendered primitive while preserving the sky and post process.

## Verification

- `Test-PhantomStrikeV28Playability.ps1`: pass
- Unreal realism asset registry: pass
- Unreal Engine 5.8.1 Shipping compile: pass
- Windows cook/package: pass, 0 errors
- Cook dependency scan: no missing ArchVis assets, input textures, or failed materials
- Candidate manifest/hash verification: pass
- Hidden installed-build gameplay capture: pass
- Installed revision: `V25R9+PHANTOMSTRIKE-V28R3`

Shipping SHA-256: `B9B7139C7A82136391318923CA31556C45801A346C1FB2FABF766304907A4F8B`

## Recovery

The prior V28R2 install is preserved at:

`C:\Users\jorda\Documents\Codex\backups\phantomplay-phantom-strike-v25r9-phantomstrike-v28r2-to-v28r3-20260821-102433\phantom-strike`

The final offscreen gameplay proof is stored under `Saved/PhantomGameplayProofV28R3` and is intentionally not source-controlled.
