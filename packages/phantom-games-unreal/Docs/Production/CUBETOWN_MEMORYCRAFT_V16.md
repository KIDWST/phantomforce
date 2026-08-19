# CubeTown V16 — Memorycraft Adventure Pass

## Objective

Turn CubeTown's existing third-person storybook adventure into a systemic, player-authored puzzle/combat sandbox without discarding CubeTown's own identity, town life, building mode, crimson canopy, friends, shrines, combat, or persistent world.

This pass intentionally uses **original CubeTown terminology, code, world assets, characters, regions, story, and visual language**. It does not ship Nintendo characters, locations, names, art, audio, maps, UI, or copied puzzle layouts.

## Player fantasy

The player explores CubeTown and **remembers useful patterns from the world**, recreates them as temporary Memorycraft creations, and then physically combines those creations with the world. A solution should feel authored by the player rather than selected from a single scripted answer.

Core loop:

1. DISCOVER a glowing Memorycraft example.
2. REMEMBER it with **C**.
3. Hold **Q** to choose a remembered pattern.
4. CREATE it into the world.
5. WEAVE it with **X**, or **RIDE-WEAVE** with **G**.
6. Combine creations, creatures, terrain, movement, and combat to solve the problem your own way.
7. Press **Backspace** to clear temporary creations and immediately experiment again.

## Memorycraft library

V16 grows the runtime library from three combat companions to nine distinct tools:

| Memory | Cost | Purpose |
|---|---:|---|
| Blade Memory | 2 | Close-range combat companion |
| Boulder Memory | 3 | Heavy combat / space control |
| Bloom Memory | 2 | Ranged combat companion |
| Wander Bridge | 2 | Gap crossing, stacking, movable route construction |
| Tide Spire | 2 | Vertical water-lift traversal |
| Sky Pad | 1 | Oscillating moving platform for vertical routes and Ride-Weave |
| Blast Bloom | 2 | Player-triggered area burst |
| Gale Totem | 2 | Player-triggered enemy displacement |
| Climbroot | 2 | Vertical route / climbable geometry |

The library is persisted through `CreationUnlockMask` while preserving the legacy three companion unlock booleans for old saves.

## Creation budget

Temporary creations use a world-load budget instead of consuming the old EchoEnergy pool. Base capacity is five points and grows with restored shrines. If a new creation would exceed capacity, the oldest temporary creation is released first. This makes experimentation quick while preventing unbounded actor growth.

## Weave

**Hand Weave (X):** move a valid creation, Memorycraft source, creature, or companion relative to the hero.

**Ride-Weave (G):** move the hero relative to a valid moving target. It allows creatures and moving creations to become traversal tools.

Weave is range-limited and uses collision-aware actor movement. Temporary Memorycraft static meshes are explicitly switched to Movable mobility when spawned so the feature is not defeated by Unreal's default static mesh actor mobility.

## Utility behavior

- Sky Pads float on a deterministic vertical cycle. Ride-Weave turns them into an improvised elevator.
- Tide Spires produce an upward lift when the hero enters their local column.
- Blast Blooms detonate when struck and damage nearby enemies.
- Gale Totems create a radial push pulse when struck.
- Wander Bridges and Climbroots remain physical construction/traversal tools and can be repositioned with Weave.
- Combat memories act immediately and can coexist subject to the same creation budget.

## World onboarding

`SpawnMemorycraftTrials()` places six discoverable source props around the early Heartstone route plus three compact traversal playgrounds. They use CubeTown's existing generated Dream assets. These are deliberately playgrounds, not one-solution copied puzzles.

The first-session flow now exposes:

- free third-person movement and combat
- creation discovery
- nine-slot Memorycraft selection
- creation budget
- object manipulation
- moving-platform traversal
- combat utility
- the existing village / friendship / shrine progression
- the existing architecture Build Mode

## Camera and presentation

Adventure camera is shifted toward elevated storybook readability while retaining the project's locked requirements:

- free third-person camera
- camera collision
- no fixed overhead camera
- Build Mode remains a distinct high-angle architecture workflow

Target adventure framing is approximately 720 cm spring-arm distance, -24° pitch and 63° FOV, still player-adjustable within a bounded range.

## Performance constraints

Memorycraft is deliberately budgeted. Runtime actor arrays are pruned, the oldest temporary creation is released when capacity is exceeded, and the player can clear the field instantly. This avoids turning player freedom into runaway actor/tick cost.

## Follow-up production work

V16 is a systemic code/content-composition pass. A full commercial content pass should add original authored dungeons, more Memory patterns, bespoke VFX/audio, elemental reactions, quest chains that use the system, animation polish, accessibility/key rebinding, and packaged performance profiling. Those should deepen Memorycraft rather than replace it with scripted one-answer puzzles.
