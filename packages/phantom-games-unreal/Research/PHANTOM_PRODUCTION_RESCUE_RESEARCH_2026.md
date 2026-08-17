# Phantom Production Rescue V10 — Research Decisions (August 2026)

This file records the engineering/design research behind the V9 pivot so later passes do not regress into “make the map bigger and scatter props.”

## Unreal Engine 5.8 world-building direction

Official Epic documentation used during this pass:

- UE 5.8 Release Notes: https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-8-release-notes
- PCG Overview: https://dev.epicgames.com/documentation/unreal-engine/procedural-content-generation-overview
- World Partition: https://dev.epicgames.com/documentation/unreal-engine/world-partition-in-unreal-engine
- World Partition HLOD Builder: https://dev.epicgames.com/documentation/unreal-engine/world-partition-builder-commandlet-reference
- Enhanced Input: https://dev.epicgames.com/documentation/unreal-engine/enhanced-input-in-unreal-engine
- Gameplay Ability System: https://dev.epicgames.com/documentation/unreal-engine/understanding-the-unreal-engine-gameplay-ability-system
- City Sample: https://dev.epicgames.com/documentation/unreal-engine/city-sample-project-unreal-engine-demonstration

Key conclusions:

- Large maps are not a reason to render a single flat plane. PCG, World Partition, Data Layers and HLOD are the production tools to use as the worlds mature.
- MassEntity is the correct research direction for very large crowds/armies because Epic uses it for data-oriented large-agent simulation in City Sample.
- Enhanced Input/Common Input is the current UE 5.8 input direction. Existing Phantom controls are preserved in this recovery pass, but future input refactoring should converge there rather than add more raw key polling.
- Lyra/GAS remain the architecture references for scalable weapons/abilities, not a source of copied game identity.

## Density research

Community design research reviewed:

- https://www.reddit.com/r/gamedev/comments/198f010/is_there_an_ideal_density_for_openworld_games/
- https://www.reddit.com/r/gamedev/comments/i58x79/why_is_it_difficult_to_create_an_open_world_game/
- https://www.reddit.com/r/gamedev/comments/1gk5li4/is_an_empty_open_world_automatically_a_bad_game/

The consistent useful takeaway is not “small maps are better.” It is that **time between meaningful interactions and visible reasons to move through the world matters more than raw square kilometers**. V10 therefore keeps the user-approved canonical map dimensions and spends the extra room on settlements, landmarks, enemies, resources, routes, armies and spectacle.

## Persistent world decision

Official Unreal Python editor APIs expose LevelEditorSubsystem level creation/loading/saving and EditorActorSubsystem actor spawning. V10 uses those editor-time APIs to create persistent `.umap` production worlds after asset import instead of making all four games visually depend on runtime construction code.

That does not finish the games by itself. It removes a recurring failure mode: imported assets can now be inspected as actual level content and the packaged game can no longer appear empty solely because one runtime environment-builder path failed.

## Asset research

Required/current legal sources in the automated pipeline:

- Kenney first-party CC0 asset pages.
- KayKit public CC0 GitHub repositories.
- Already-imported/owned Fab and Quixel content on the user’s machine.
- Existing Phantom and Unity-baseline source content.
- Quaternius CC0 packs when the creator page exposes a current downloadable archive.

Rigged character packs are not flattened into static meshes merely to make an import counter go up. Animation assets must enter a real SkeletalMesh/retarget workflow before becoming playable characters.

## Next production architecture after V10 proves the maps

The next large engineering milestones should be driven by the actual packaged gameplay captures, but the technical direction is:

- Phantom Legends: World Partition + HLOD + scalable Mass-based army representation where it materially improves unit count.
- CubeTown: authored landmark layer + PCG dressing layer; adventure interactions remain hand-authored enough to preserve discovery quality.
- PhantomStrike: Lyra-style modular input/weapon architecture and authored lane/navigation metrics; no generic open-world expansion.
- Phantom Ages: keep the fixed one-screen contract and spend performance budget on army simulation, animation, Niagara, audio and escalation—not camera travel.
