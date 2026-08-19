# PhantomPlay Portfolio V13 Pass

Date: 2026-08-18

## Scope

This pass treats PhantomStrike, Phantom Ages, Phantom Legends, and CubeTown as four first-class PhantomPlay games. No game is allowed to skip the portfolio content gate.

## What changed

### Shared portfolio foundation

- `PhantomGameIds::IsFlagship` now includes all four games, including CubeTown.
- Graphics-quality selection now reads Unreal's persisted scalability level on startup and saves changes, so settings behave consistently across all four executables.
- The rejected `SM_CC0_Tree_B` semantic alias is no longer requested by runtime C++, required by the build gate, or required by the external CC0 importer.
- The verified harvested Legends pine-tree asset replaces the malformed/egg-like Legends tree path.

### Four-game V13 world pass

`Tools/PatchPortfolioWorldsV13.py` adds a new idempotent layer to every persistent world:

- **CubeTown:** road-verge material breakup, grounded foliage/rocks/benches/lanterns, and stronger village approach landmarks.
- **Phantom Ages:** irregular battlefield material islands, denser foreground ruins, siege debris, banners, camp props, and fires.
- **PhantomStrike:** close-range asphalt/concrete/cobble variation, additional lower-frame street props, and safe distant building silhouettes.
- **Phantom Legends:** 5x5 capital-biome material breakup, a safe forest/rock/bush ring, stronger capital landmarks, and removal of rejected tree aliases from the persistent world.

### Pipeline and gates

- The one-shot Unreal editor pipeline now runs V13 after the existing V11R7, V11R10, and CubeTown V12 layers.
- `Build-Flagships.ps1` requires the V13 report to PASS before the shared content gate can pass.
- Persistent-world validation now requires a minimum V13 actor contribution in all four games and fails if the rejected `SM_CC0_Tree_B` alias survives in a production world.

## Static verification completed in ChatGPT

- Python syntax check: PASS for the V13 patch, one-shot pipeline, and production-world validator.
- V13 referenced asset paths: present in the supplied full archive, except the V13 ground-patch asset which is intentionally created by the Unreal editor script.
- Runtime/tool source references to `SM_CC0_Tree_B`: removed.
- Four game targets and four persistent maps remain present.

## Verification that still must run in Unreal

- Unreal C++ compile.
- One-shot content pass and V13 report generation.
- Four persistent-world validation.
- Four candidate packages.
- 4/4 gameplay proof screenshots and the visual gate.
- Performance/soak/network/save-load testing before release promotion.

This pass is not marked release-ready until those Unreal-side checks pass.
