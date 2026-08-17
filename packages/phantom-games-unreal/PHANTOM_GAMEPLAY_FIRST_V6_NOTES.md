# Phantom Games — Gameplay-First Rebuild V6

V6 is a cumulative correction pass for Phantom Ages, CubeTown, PhantomStrike and Phantom Legends.

The acceptance test is no longer "did Unreal compile" or "did four resolution screenshots exist." The build must acquire/import real creator art, inspect the prior Unity baseline, preserve owned/imported Fab/Quixel candidates, package fresh executables, auto-enter actual gameplay, and capture one real gameplay frame per title.

## Build behavior

- Existing Unreal editor processes are closed once at the beginning to avoid file locks.
- The orchestrator runs BelowNormal priority by default and writes project-local UBT `MaxParallelActions=8` so the workstation remains usable. Use `-FullSpeed` only when desired.
- Current Kenney asset URLs are resolved from creator pages when possible; required KayKit packs pull current `main` archives.
- The prior Unity project is scanned for gameplay scripts and compatible source art instead of being ignored.
- Generated fallback assets, creator assets, Unity-compatible assets and already-imported owned Fab/Quixel assets are processed inside one headless Unreal content session.
- Four independent headless cooks are still required because PhantomPlay launches four independent Windows executables.
- Each package launches once with gameplay auto-start, waits for the actual game world, takes one 1920x1080 gameplay screenshot, then exits. The old multi-resolution screenshot matrix is not part of the V6 path.

## Game direction

**Phantom Ages:** fixed one-screen battlefield, no camera travel, 20v20 opening armies, dragons/titans/siege, dense battlefield dressing and real fortification aliases.

**CubeTown:** keeps the 960m x 960m world and fills it: red/four-season dream identity, Heartstone, eight satellite hamlets, dense foliage/rocks/flowers, nearby combat, existing quests/Echoes/shrines/friends/building systems.

**PhantomStrike:** keeps recovered authored rifle/pistol/Blackridge assets as primary content, increases combat pressure, retains dense cover/street dressing, and only uses creator/Fab assets as compatible secondary urban dressing.

**Phantom Legends:** keeps the 4.096km x 4.096km RTS world, corrects capital placement, increases opening army/economy, moves enemy pressure into the opening frontier, fills the realm with HISM forests/rocks/settlements, and preserves drag-line formations and RTS systems.

## Art priority

- PhantomStrike authored project assets remain authoritative for its core FPS art.
- CubeTown prefers compatible Unity continuity for signature stylized content, then strong owned Fab matches, then curated CC0.
- Ages/Legends prefer strong already-imported owned Fab semantic matches, then compatible Unity continuity, then curated CC0.
- Generated meshes are emergency fallback support, not the intended final visual layer.
