# Phantom Games — 2026 Gameplay-First Research Notes

V6 is a correction to the failed "map size = progress" loop. The canonical footprints stay large where they are supposed to be large. The work now spends that space on routes, threats, settlements, resources, cover, formations, encounters, landmarks, authored art, environmental storytelling and spectacle.

## Engine / architecture research

- Unreal Engine 5.8 is the current installed target for this project. Epic's 5.8 release notes emphasize continued world-building/PCG work and a major Mass Framework overhaul. V6 does not downgrade the project to match an old sample or plugin.
- Epic's World Partition guidance remains the right direction for a truly large authored RTS world. V6 does not shrink Phantom Legends to avoid world-building work.
- HISM is used now for connective vegetation/rocks/urban furniture because it is built-in, deterministic and low-risk. Individually important actors remain real Actors. Build concurrency is capped at 8 by default so the 16-core workstation remains usable during long compiles; Epic documents `MaxParallelActions` as the supported UBT control.
- Mass Entity is the next simulation layer for truly enormous independently simulated armies. Public references reviewed include Megafunk/MassSample, Ji-Rath/MassAIExample and HaywireInteractive/OnAllFronts-Public. We use their architecture lessons but do not inject an engine-version-sensitive dependency into this recovery package.
- yoreei/crowd_pathfinder is reviewed as a useful flow-field reference for many-units/same-destination RTS movement. The repo is a reference, not a blind dependency.

## Current creator / GitHub asset research applied

- Kenney Fantasy Town Kit is on its current 2.0 complete-remake line and remains CC0; V6 resolves Kenney download URLs from the creator page at install time instead of freezing an old content-hash URL.
- Kenney Castle Kit is currently a 2.0 complete remake with 75 CC0 files and is now opportunistically staged for Ages/Legends.
- KayKit Medieval Hexagon and Dungeon Remastered stay in the required library, and V6 now also pulls the current `main` branch of KayKit City Builder Bits for additional town/RTS/urban silhouettes.
- The KayKit City Builder repository explicitly ships OBJ/FBX/glTF and is CC0, so it is safe to use as a real cross-engine source rather than a screenshot-only reference.
- Owned/imported Fab/Quixel/Marketplace assets are rescored at build time into semantic aliases; medieval barracks/markets/mines/windmills, Ages siege, Strike street props, and stylized CubeTown bridges/rocks are now included in the harvest vocabulary.

## Reddit/community design research applied

- Open-world developers repeatedly distinguish *visual emptiness* from *functional emptiness*: even sparse landscapes need visible goals, direction, choices and points of interest. Bigger terrain is allowed; meaningless travel is not.
- Community discussion also warns that simply placing a collectible every 50–100 meters can feel artificial. V6 therefore adds actual hamlets, enemy pressure, resources, landmark clusters and route silhouettes rather than just more pickups.
- Recent open-world map-design discussions recommend breaking sightlines and using signposting so nearby places still feel like distinct discoveries. CubeTown's additional hamlets and biome landmarks use this logic.
- Beyond All Reason players repeatedly praise right-click-drag line movement / frontage control. Phantom Legends already has RMB-drag formation ordering; V6 explicitly preserves it rather than replacing it with point-click blob movement.
- Large RTS control should reduce tedious per-unit babysitting. V6 increases the opening economy/army and brings a real enemy patrol into the opening play space so the player has something to command immediately.

## Existing Phantom baseline research

The old Unity implementation is treated as source material, not discarded history. At build time V6 searches the real repository for:

- `packages/phantom-games-unity/Assets/PhantomForge/Scripts/Strike/PhantomStrikeGame.cs`
- `packages/phantom-games-unity/Assets/PhantomForge/Scripts/Ages/PhantomAgesGame.cs`
- `packages/phantom-games-unity/Assets/PhantomForge/Scripts/Legends/PhantomLegendsGame.cs`
- the Unity Resources / model / texture / audio trees
- the long-lived CubeTown web baseline where present

Compatible Unity source art is imported into `/Game/Phantom/UnityHarvest` and promoted into stable semantic aliases. A machine-readable inventory is written to `Saved/PhantomUnityBaselineInventory.json`, so future Unreal changes can compare against what existed instead of guessing.

## Per-game V6 decisions

### Phantom Ages
- Keep the 360m × 110m one-screen battlefield.
- Increase the opening battle from 14v14 to 20v20 real combatants.
- Prefer owned/imported Fab fortress art, then recovered Unity art, then curated creator art, only then emergency generated shells.
- Add hundreds of instanced battlefield dressing pieces without enabling camera travel.
- Preserve giant/dragon/siege spectacle and age/tower progression.

### CubeTown
- Keep the full 960m × 960m world.
- Fill connective space with thousands of instanced trees/rocks/flowers while retaining collision/interaction on authored POIs.
- Add eight satellite hamlets rather than turning the larger map into grass.
- Bring opening enemy waves into the Heartstone play space and increase the encounter count.
- Keep red-tree / four-seasons dream identity, quests, Echoes, friends, shrines and life-sim building.

### Phantom Legends
- Keep the full 4,096m × 4,096m RTS world.
- Add roughly two thousand instanced forest/rock elements plus satellite settlement silhouettes across the whole realm.
- Open with 10 workers + 12 combat units and a six-unit Rift patrol near the player frontier, rather than placing the first threat over a kilometer away.
- Preserve RMB-drag formations, contextual orders, resources, production, bases and the 300-unit/player architecture.

### PhantomStrike
- Keep the 480m × 360m authored Blackridge district.
- Preserve the recovered original rifle, pistol, streets, buildings and materials as primary art.
- Increase wave-one pressure to 15 hostiles (`12 + Wave*3`) and scale later waves to a 30-unit cap.
- Add instanced original traffic/street furniture while keeping the existing 144-cover / micro-cover / street-dressing pass.

## Build / QA correction

The user explicitly rejected repeatedly opening Unreal and generating resolution-matrix screenshots. V6 therefore uses:

1. creator asset refresh in PowerShell;
2. Unity baseline harvest in PowerShell;
3. one editor-module compile;
4. **one** `UnrealEditor-Cmd` content session running generated import → creator import → Unity import → owned Fab harvest;
5. four headless package cooks, because there are four independent Windows executables;
6. each packaged game auto-enters gameplay, waits, captures **one 1920×1080 gameplay frame**, then exits.

`Run-PhantomVisualQA.ps1` is intentionally not called by the V6 build path.

## Public references reviewed

- Epic — Unreal Engine 5.8 release notes
- Epic — World Building / World Partition guidance
- Reddit / r/gamedev — open-world density, empty-world syndrome, sightline/signposting discussions
- Reddit / r/beyondallreason and related RTS discussions — drag formations / line movement controls
- GitHub — Megafunk/MassSample
- GitHub — Ji-Rath/MassAIExample
- GitHub — HaywireInteractive/OnAllFronts-Public
- GitHub — yoreei/crowd_pathfinder
- GitHub — KayKit City Builder Bits / Medieval Hexagon / Dungeon repositories
- Kenney — current Fantasy Town, Nature, City and Castle Kit creator pages

These sources inform the design and performance decisions. They are not copied wholesale and do not become hard dependencies unless they are proven compatible with the project's current UE 5.8 branch.
