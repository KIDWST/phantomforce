# PhantomStrike V27R1 Blackridge realism production report

Date: 2026-08-21

Engine: Unreal Engine 5.8.1 (`H:\UE_5.8`)

Previous installed build set: `V25R9`

Current installed build set: `V25R9+PHANTOMSTRIKE-V27R1`

Disposition: **PROMOTED AND VERIFIED INSTALLED**

## Outcome

V27R1 replaces the toy-like primitive presentation in PhantomStrike's Blackridge combat path with properly licensed Unreal skeletal characters, authored weapons, animation, and physically based environment assets. The checked-in V26 Blackridge gameplay and breach images remain the binding visual direction; they were reused rather than replaced by a different style.

This is an in-engine runtime change, not a background-image treatment. The player, allies, enemies, weapons, wrecks, and key Blackridge structures now resolve through production assets and animation systems. The previous installed PhantomStrike is preserved as a rollback checkpoint.

## Binding visual targets

- `SourceArt/VisualTargets/phantom-strike-v26-blackridge-gameplay-target.png` — realistic wet coastal street, grounded military silhouettes, believable first-person weapon, practical light, restrained HUD.
- `SourceArt/VisualTargets/phantom-strike-v26-blackridge-breach-target.png` — realistic communications-center breach, concrete/server detail, atmospheric dust and rain light, grounded scale.
- `Docs/Production/PHANTOMSTRIKE_V26_VISUAL_TARGET_PROMPTS.md` — original PhantomStrike translation contract and exact target prompts.

The visual targets are quality and art-direction references. They are not copied franchise content and are not shipped as playable scenery.

## Runtime implementation

- The first-person player now resolves the Manny skeletal rig, Shooter rifle animation blueprint, and authored rifle/pistol assets. Legacy cylinder and sphere representations are hidden when the skeletal presentation loads.
- Hostile operators now resolve the Manny skeletal body, rifle locomotion, dark tactical material treatment, and a socketed authored rifle. The old primitive body and head remain only as hidden collision support where required.
- Friendly squad operators now resolve the Quinn skeletal body, rifle locomotion, and a socketed authored rifle instead of a static fallback silhouette.
- Skeletal death presentation is supported and animation ticking is disabled after the collapse completes.
- Four former low-detail vehicle wrecks now use the PBR ProductAssets car at world-correct scale.
- Four Blackridge street/command structures now use the PBR ProductAssets building and concrete material family at resolved scale.
- The V26 hero breach/server cube primitives were removed from the V27 hero construction path and replaced with authored industrial, street, rubble, warehouse, and communications-center elements.
- Runtime layer identity is `BuildV27BlackridgeRealism`.

## Asset provenance and scope

The new production content was imported from the installed Unreal Engine 5.8 First Person/Shooter templates and Epic AEC/MFG ProductAssets. The retained runtime subset contains the Manny/Quinn rigs, required rifle locomotion and hand-adjustment animation assets, rifle and pistol assets, one PBR building, one PBR car, and their required material dependencies. Unrelated template example maps, UI, grenade-launcher content, and first-person sample animation content were excluded from the runtime candidate.

The imported bodies have realistic human proportions and working locomotion, but they remain Unreal template mannequins rather than photo-scanned tactical uniforms. The Blackridge sample images continue to define the next material/wardrobe fidelity target.

## Verification

- `PhantomGamesEditor Win64 Development`: PASS after resolving the skeletal-animation API integration.
- `PhantomStrike Win64 Shipping`: PASS.
- Unreal realism asset load gate: PASS for Manny, Quinn, rifle, pistol, rifle AnimBP, PBR building, PBR car, and concrete/asphalt materials.
- Focused source regression: `PHANTOMSTRIKE_V27_REALISM_PASS`.
- Clean Shipping cook: PASS with 0 errors and 4 benign project-setting warnings.
- Cook volume: 4,980 packages / 4,973 cooked; IoStore assembled 9,161 PhantomGames chunks.
- Hidden unattended startup: the Shipping process stayed alive for the full 25-second null-render/no-audio window. Only that hidden harness process was stopped afterward.
- No visible app window, browser, mouse, keyboard, or active desktop session was controlled.

## Candidate and installed identity

- Candidate: `packages/phantom-games-unreal/CandidateBuilds/V27R1/phantom-strike` — 32 files / 1,066,285,162 bytes after manifest generation.
- Installed: `%LOCALAPPDATA%\PhantomPlay\Games\Unreal\Windows\phantom-strike` — 32 files / 1,066,285,223 bytes after the installed marker replacement.
- Launcher SHA-256: `5458645F838E1E9BA22CF5F8BA9EFFD34987F40B8A2AC73907056921F96B1EA0`.
- Shipping SHA-256: `3D7289846B5B09386B1DA2F1093DAFBAA23AD73D7195ED9A87965338D2C58DEE`.
- Pak SHA-256: `451DF5D7798315F53643945A1C98C5E2BA2D5BEE1FB187DB00E02E764FCA2D34`.
- Ucas SHA-256: `FB09680169A81E5E4A09205712B574DBA252D0505A222A9F6D0B894582BF5427`.
- Utoc SHA-256: `8303F0443DB0AB58A112F7AA4646BA5BB9202DA1DD2B68AC3E03ECB5591007D0`.
- Rollback: `C:\Users\jorda\Documents\Codex\backups\phantomplay-phantom-strike-v25r9-to-v27r1-20260821-090238\phantom-strike`.

Candidate and installed launcher, Shipping, pak, ucas, and utoc hashes match exactly. Retained Cubetown, Phantom Ages, and Phantom Legends launcher hashes were reverified before promotion. Promotion was transactional and rollback-ready.

## Truthful remaining acceptance work

A rendered-frame comparison against the two target images, real keyboard/mouse playthrough, and frame-time/soak capture were not performed because the owner explicitly prohibited visible desktop control while using the machine. V27R1 is therefore verified for source integration, asset resolution, compilation, cooking, package identity, hidden startup stability, and installed integrity—but this report does not claim a final photoreal rendered-frame match.
