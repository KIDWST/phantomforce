# Applying local AoE IV script findings to Phantom Empires

Game2.1.0; application build phantom-live-20261106-250.

## Evidence and implementation boundary

The owner requested applying the actual extracted AoE IV scripts to our standalone game. Three shipped script files were read locally. No extracted SCAR/Lua, API declarations, game binaries, art, or other proprietary files are included in this repository or deployed. Our engine is JavaScript, not the native SCAR runtime; the new code independently implements the relevant behavior rather than importing nonfunctional native bindings.

Source-to-behavior mapping:

- cardinal/scar/gathering_utility.scar, Gathering_AssignVillagersToGather: nearest-deposit assignment, optional distribution across deposits, completed drop-off filtering. Our implementation distributes selected workers within the clicked resource cluster, filters resource type, and uses nearest completed friendly drop-offs accepting that material.
- engine/config/destination_formation.lua: centered destination slots and travel-relative offsets. Our implementation creates centered non-overlapping slots, rotates them toward the movement destination, and gives melee/ranged/siege sensible ranks. Groups translate together at map edges instead of collapsing individual destinations onto a boundary.
- engine/scar/formation.scar, Formation_PlaceSquadGroupsInFormation: position/direction separation. Our existing command system now supplies the actual travel vector to the formation planner.

Native gathering internals are not exposed by the wrapper script. Automatic depleted-deposit retargeting, 24-unit carrying-capacity conservation, and correct handling of old cargo when switching resource types are our own simulation fixes, not claims of recovered native code.

## Delivered behavior

Mill accepts food; Lumber Camp accepts wood; Mining Camp accepts gold and stone. Citadels continue to accept all four resources. All three new buildings can be constructed from the normal command deck and have original 3D props. Unfinished, destroyed, wrong-resource and enemy buildings cannot be used as drop-offs. Mobile command grids scroll rather than hiding the additional construction choices.

Villagers retain their intended resource, return cargo to the nearest valid drop-off, and seek another matching deposit when exhausted. Changing a wood order to food deposits carried wood correctly before collecting food. Saves retain existing version1 compatibility; the additional gathering intent is inferred for old records where absent.

Army destinations use centered, direction-aware formations instead of the old offset square anchored above the click. Ground movement no longer treats a neutral resource node as an enemy attack target.

## Verification

Focused planner tests cover typed-resource assignment, worker distribution, completed/friendly drop-offs, missing-resource cases, and centered non-overlapping rotated formations for armies from1 to60 units. Actual Chrome tests add nearby camp deposit, depletion retargeting, carrying capacity, resource-switch cargo conservation and centered army commands to existing 3D, economy, building, training, AI, touch, save, age, victory and defeat coverage. Browser scenarios use seeded randomness to avoid scenery occluding the intended test target. Native mouse pixels have integer coordinates; exact planner tests use stricter numeric tolerances than pointer projection tests.

The complete release-critical suite passed73/73, including these planner and actual-game checks. Change-memory passed596 checks; canonical clean-main preflight passed.

The source reference hashes below identify the private local files studied; they are not an execution or equivalence claim.

[
  {
    "path": "engine/config/destination_formation.lua",
    "bytes": 1340,
    "sha256": "c249004f1209b87dc030e47146de5b5009f483bca3296105e5db1961b7d7f1f3",
    "archive": "engine/archives/Data.sga",
    "lua_bytecode": false
  },
  {
    "path": "engine/scar/formation.scar",
    "bytes": 823,
    "sha256": "2917a6e479a5dfc15b73c2f6127617dbc203e19f6988caf5fe172ddc96b6cbe4",
    "archive": "engine/archives/Data.sga",
    "lua_bytecode": false
  },
  {
    "path": "cardinal/scar/gathering_utility.scar",
    "bytes": 19152,
    "sha256": "60c8baf5a7cfd6edb2a0a6ea9d3510d7cbec6324cec03139588132ba2cc38a22",
    "archive": "cardinal/archives/Data.sga",
    "lua_bytecode": false
  }
]

Undo: revert this release commit and sync. Do not remove existing saves or the prior original 3D release. No game installation files or account data are changed.
