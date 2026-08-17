# Phantom Games Curated Asset Overhaul V5

This pass is intentionally different from the prior recovery builds: a build is not allowed to package merely because generated fallback geometry exists. Real external art has to be acquired, imported into stable aliases, and verified on disk before packaging continues.

## Deterministic required CC0 library

- Kenney Nature Kit (CC0): trees, foliage, rocks and nature dressing for CubeTown and RTS biomes.
- Kenney Fantasy Town Kit (CC0): houses, town architecture, wells and village props for CubeTown.
- Kenney City Kit Commercial (CC0): secondary city dressing for PhantomStrike.
- Kenney City Kit Industrial (CC0): secondary industrial/warehouse props for PhantomStrike.
- KayKit Medieval Hexagon Pack (CC0, public GitHub): medieval buildings, economy structures, walls, towers, mine, market, windmill and nature for Phantom Legends / Phantom Ages / CubeTown.
- KayKit Dungeon Remastered (CC0, public GitHub): modular walls, arches, stairs and dungeon/ruin dressing.
- KayKit Adventurers (CC0, public GitHub): rigged/animated fantasy character source library for later skeletal promotion; V5 may also use static silhouettes where compatible.
- KayKit Skeletons (CC0, public GitHub): enemy/undead character source library.

## Optional CC0 variety

Quaternius Medieval Village MegaKit, Stylized Nature MegaKit, Fantasy Props, animated characters and monsters are attempted as supplemental variety. They are not allowed to be the only source because mirror availability can change.

## Fab / Quixel / owned Marketplace content

V5 does not scrape browser cookies, tokens, or protected Fab CDN endpoints. Epic's supported Fab workflow is the Fab integration in Unreal Engine or Fab in Epic Games Launcher. `HarvestOwnedFabAssets.py` scans *already imported project content* and promotes high-confidence medieval, city, ruins, Quixel/Megascans and stylized-fantasy StaticMeshes into `/Game/Phantom/Curated/Fab/` aliases. Runtime code prefers those aliases where they match the art direction, then falls back to the deterministic CC0 aliases.

This means anything you have legitimately imported from Fab/Quixel can become the higher-fidelity layer without coupling the game to a fragile marketplace scraper.

## Per-game art policy

### CubeTown
Primary art direction is stylized and dreamy. Use Kenney Fantasy Town + Nature and KayKit/Quaternius stylized assets. Fab assets are promoted only if names/path strongly indicate stylized/fantasy content. Photoreal Megascans do not automatically overwrite the cozy town language.

### Phantom Legends
Use the strongest owned Fab/Quixel medieval/ruin assets when already imported. Otherwise use KayKit Medieval + Dungeon as real modular architecture rather than generated primitive stand-ins. Keep, tower, wall, gate, barracks, market, mine, windmill and ruins have stable curated aliases.

### Phantom Ages
Towers/walls/gates use owned Fab medieval assets when available, otherwise curated medieval CC0. Generated age-specific shapes remain fallback/spectacle support, not the primary visible fortification art.

### PhantomStrike
The recovered original `/Game/Phantom/Strike` rifle, pistol, streets, hospital, shops, bank and houses remain the primary FPS content because they are stronger than low-poly city kits. Owned Fab/Quixel city/rubble assets are preferred when already imported. Kenney city kits fill secondary street/industrial dressing and must not replace the firearm art.

## Anti-regression gates

Packaging fails when the required creator packs cannot be acquired, when the required compatibility aliases fail to import, or when the game-specific curated aliases do not exist. V5 deliberately refuses to hide these failures behind generated fallback content.
