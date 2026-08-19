# CubeTown Memorycraft — Design Contract

CubeTown is an original storybook action-adventure / town-life game. Memorycraft exists to make exploration playful and systemic.

## Non-negotiables

- Keep CubeTown's crimson fantasy canopy, Heartstone village, named friends, regions, shrines, home/building fantasy, and free third-person camera.
- Do not import or imitate another game's characters, brand names, map, story, UI art, sounds, dialogue, dungeon layouts, or signature props.
- Every Memory must have a clear function the player can remember.
- Prefer interactions that respond immediately to player input.
- Reuse a learned rule consistently across regions instead of arbitrarily disabling it for a puzzle.
- Allow multiple valid solutions where simulation supports them.
- Keep temporary creation counts bounded for performance.

## V16 control contract

- Q hold/release: Memorycraft selection / create
- Mouse wheel or R while selecting: cycle remembered Memory
- C: remember a targeted glowing world example
- X hold: Hand Weave
- G hold: Ride-Weave
- Backspace: clear temporary creations
- B: existing architecture Build Mode

## Puzzle grammar

Use combinations rather than keys:

- **reach**: bridge + sky pad + climbroot
- **elevation**: tide spire + sky pad + Ride-Weave
- **displacement**: gale totem + creature + ledge/hazard
- **timing**: moving sky pad + Weave release
- **combat space**: boulder + gale totem + ranged Bloom
- **burst**: Blast Bloom repositioned into a pack, then struck
- **escort / hitchhike**: Ride-Weave a moving companion or creature

New dungeons should use this grammar but never require a single exact sequence when another physically valid combination should work.
