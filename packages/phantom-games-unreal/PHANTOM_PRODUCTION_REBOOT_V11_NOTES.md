# Phantom Games — Production Reboot V11

V11 exists because the V10.1 Windows renders were objectively rejected. The four rejected frames are bundled under `Documentation/RejectedV10_1/` as anti-regression evidence.

## What V11 changes at the foundation

1. **Real skeletal gameplay characters.** KayKit Adventurers/Skeletons character sources are probed in both FBX and glTF form; a source only qualifies when Unreal actually produces a SkeletalMesh plus usable animation sequences. Gameplay actors use stable `/Game/Phantom/Characters/Production/` aliases instead of treating rigged creator characters as frozen StaticMeshes. The content gate requires multiple genuinely animated characters before cooking.
2. **Primary world art cannot silently come from generated fallback geometry.** Persistent-world architecture, trees, fortifications, villages and most props require imported Phantom/Unity/Fab/creator assets. Generated GLBs are restricted to terrain support and bespoke Phantom setpieces such as portals/dragons/siege accents.
3. **Semantic bounds normalization.** Every persistent imported StaticMesh is measured from its actual Unreal bounds, normalized to a human-scale semantic target and grounded again using final actor bounds. This directly targets the microscopic-house / giant-roof / buried-prop failures.
4. **Real PBR surface material pass.** V11 acquires a small current CC0 Poly Haven surface set and builds persistent grass, cobble, dirt, rock, asphalt, concrete and wood materials inside Unreal.
5. **Worlds are persistent `.umap` assets.** The four canonical maps are created editor-side and explicitly cooked. Runtime directors own gameplay, not an entire second duplicate environment.
6. **Hard world-validation pass before cooking.** The editor rejects insufficient density near the actual spawn/camera, generated-art dominance, giant non-terrain outliers, Engine BasicShape actors, or a blocked PhantomStrike spawn.
7. **One real gameplay screenshot per candidate.** No multi-resolution screenshot loop. Four isolated candidate executables each enter gameplay once and capture one 1920×1080 frame.
8. **The live games are NEVER auto-promoted.** Even after structural and frame gates pass, the build opens the four candidate screenshots and requires the human to type exact `PROMOTE`. Otherwise `Builds\Windows` remains unchanged.
9. **Unity remains a safety baseline.** `RUN_UNITY_BASELINE_SAFETY_BUILD.bat` can build the original Unity flagship implementations into a separate safety directory without touching Unreal or the live PhantomPlay executables.

## Canonical game contracts retained

- **CubeTown** — 960m × 960m, dense magical adventure/life-sim; red/orange/pink seasonal canopy; populated Heartstone opening; building/adventure/combat remain gameplay systems.
- **Phantom Ages** — 360m × 110m, one fixed fullscreen battlefield; no player camera movement; both fortresses, armies and spectacle visible together.
- **Phantom Legends** — 4096m × 4096m true RTS; giant navigable strategic world, but meaningful content is required around capitals, routes and contested settlements.
- **PhantomStrike** — 480m × 360m Blackridge Coast; original PhantomStrike weapon/city UAssets remain authoritative; bright playable lighting and a protected insertion area are mandatory.

## Candidate workflow

`source backup -> current creator assets -> PBR sources -> Unity harvest -> ONE UE editor compile -> ONE UnrealEditor-Cmd import/world-build/validation session -> four isolated cooks -> four actual gameplay captures -> strict frame gate -> HUMAN PROMOTE or keep candidates separate`

V11 deliberately makes no claim that the final local Windows render is good until the target PC executes that workflow and the user personally approves the four screenshots.
