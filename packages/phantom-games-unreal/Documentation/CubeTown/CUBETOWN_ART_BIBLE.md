# CubeTown Art & Product Lock — Dreamworld Cumulative Build

This package treats CubeTown as an original premium storybook adventure world, not a voxel survival game and not a generic Unreal sample.

## Non-negotiable visual identity
- Signature crimson/red fantasy canopy remains a core world identifier.
- Forest palette is deliberately varied across crimson, berry, coral, rose, burgundy, orange-red and rare lavender-red.
- The world mixes spring blossoms, summer grass/water, autumn-red forests and localized frost/snow language as one impossible fantasy ecology.
- Player-facing giant block construction is retired.
- Adventure mode is third person. Build Mode uses life-sim-style prefab/architecture tools.
- The opening area must show the identity immediately: red-tree parks, village, water, friends, lighting, landmarks and interactive systems.

## Lighting / world language
- Warm directional sunlight + cool ambient mood.
- Stable exposure; no crushed black exploration spaces.
- Turquoise/cyan water, warm/cream/lavender stone, painted/varied buildings.
- Environmental composition is foreground / midground / background with visible landmarks rather than flat terrain + trees.

## Construction lock
Player-facing construction consists of:
1. complete prefabs;
2. wall tool;
3. room tool;
4. fences;
5. gardens;
6. decoration placement;
7. transactional undo/redo with at least 50 operations retained per session.

Legacy block save data remains readable for compatibility, but the old block-placement entry point is intentionally retired from normal gameplay.

## Anti-regression
A future change fails review if it:
- converts the signature red canopy to a normal green forest;
- reintroduces Minecraft-style giant block building;
- restores a fixed overhead exploration camera;
- removes Build Mode undo/redo;
- makes the main menu a generic dark sci-fi Phantom console;
- removes world traversal or camera collision;
- replaces the authored/CC0 art pipeline with primitive-only fallback as the normal path.
