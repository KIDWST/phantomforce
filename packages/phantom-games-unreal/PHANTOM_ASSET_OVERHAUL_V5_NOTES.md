# Phantom Games Asset Overhaul V5

This pass fixes the failure mode that made previous builds look essentially unchanged.

## What changed in the pipeline

1. Required external art is now a build gate, not an optional best-effort step.
2. Creator-first CC0 sources are downloaded from Kenney and public KayKit GitHub repositories; optional Quaternius packs add variety.
3. Unreal imports real meshes into stable compatibility aliases and separate per-game curated aliases.
4. Runtime world directors now reference those per-game curated aliases in visible architecture/prop placements.
5. Imported authored materials are preserved; the runtime no longer repaints external trees/rocks/buildings with the Engine BasicShapeMaterial.
6. Already-imported Fab/Quixel/Marketplace StaticMeshes are scanned and high-confidence semantic matches are duplicated into safe `/Game/Phantom/Curated/Fab` aliases. Runtime code prefers these stronger owned assets when present.
7. The package refuses to cook if the required curated aliases do not exist. Generated meshes remain fallback support, but they can no longer hide a failed art acquisition pass.
8. The UE 5.8 SkyAtmosphere component hotfix is already folded into this cumulative package.

## Per-game visible changes

- CubeTown: curated village homes, tavern, blacksmith, windmill, well, bridge, market, foliage and rock aliases are used throughout Heartstone and district dressing.
- Phantom Legends: curated keep, tower, wall, gate, barracks, market, mine, windmill and ruin aliases are used by capital and world-density placement.
- Phantom Ages: age towers/fortification paths route through curated medieval art, with owned Fab medieval meshes preferred when already imported.
- PhantomStrike: recovered original rifle/city UAssets remain primary; curated commercial/industrial/container/street props add dressing, and owned Fab/Quixel city/rubble assets are preferred when already imported.
