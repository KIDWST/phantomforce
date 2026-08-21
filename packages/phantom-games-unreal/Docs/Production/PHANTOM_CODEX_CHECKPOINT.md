# CubeTown V23R1 vertical-slice candidate — 2026-08-20 15:41 CDT

## Outcome

- Accepted candidate: `D:\PhantomForceBuilds\V23R1\cubetown-pass14\Windows`.
- Packaged executable: `D:\PhantomForceBuilds\V23R1\cubetown-pass14\Windows\Cubetown.exe`.
- Package inventory: 32 files, 1,078,104,894 bytes.
- Candidate state: packaged and runtime-verified; **not promoted**.
- Live PhantomPlay install remains V22R24 at `%LOCALAPPDATA%\PhantomPlay\Games\Unreal\Windows`.
- Live manifest and CubeTown launcher hash were re-read after verification and remain unchanged.
- Existing rollback remains `D:\PhantomForceRollbacks\phantomplay-unreal-v18r1-to-v22r24-20260820-122046\Windows`.

## Implemented vertical slice

- Raised, zoomed-out diorama camera: 4,300-unit arm, -47 degree pitch, 46 degree FOV, and 950-unit forward composition.
- Deterministic packaged-proof camera lock, collision-safe proof framing, streamed-load reassertion, and a cold-start fade that hides world assembly.
- Authored V23 route from the starter area through town, bridge/gate, and Phantomite Lair.
- Aligned three-by-three warm-stone civic plaza; the prior mixed blue/tan overlapping composition was visually rejected and replaced.
- Dark authored lair floor, crystal/torch lighting, staged guardian and adds, lair-safe proof behavior, and the correct `DEFEAT LAIR GUARDIAN` objective.
- Existing playable continuity retained for resource collection/spending, build costs and persistence, forge tiers 1-3, Phantomite regeneration, combat, NPC/objective routing, HUD, minimap, tool belt, health/damage feedback, and save schema 23.
- Production world contains 212 actors, including 210 V23 actors, with zero Engine BasicShapes and zero rejected visual aliases.

## Runtime and build evidence

- Unreal Shipping compile/build/cook/stage/pak/IoStore/archive: PASS, 4,822 packages discovered, 4,815 packaged, zero errors.
- `Tools/ValidatePortfolioGameplayV14.py`: PASS, including camera, cold-load, fade, lair objective, and encounter-staging contracts.
- `Tools/ValidateProductionWorlds.py`: PASS.
- `git diff --check`: PASS.
- Opening packaged-runtime proof: `D:\PhantomForceProof\V23R1\cubetown-v23r1-pass14-opening.png`; SHA-256 `1A73FAF4705DE37E405B4B8551E42D0AB196A9D03A0F842C0E3DADBBF98D14F1`.
- Lair packaged-runtime proof: `D:\PhantomForceProof\V23R1\cubetown-v23r1-pass14-lair.png`; SHA-256 `123FF679F7464A215D42B4389F831E75FBD723EA13E7449B44785D865A5E164D`.

## Truthful remaining scope

V23R1 is a stronger playable vertical-slice foundation, not completion of every section in the Grezzo-like master specification. Still open are the full waking interior, enterable/furnished building network, named NPC schedules and household/family simulation, the complete multi-room dungeon run, premium icon/UI art, comprehensive automated playthrough coverage, and measured performance/soak profiling. Those remain release work and are not represented as complete.

---

# Phantom Codex Checkpoint — 2026-08-20 V22R24 installed release

## Current V22R24 state

- Branch: `agent/phantomplay-unreal-recovery-20260819`.
- Exact Unreal project: `packages/phantom-games-unreal/PhantomGames.uproject`.
- Engine: Unreal Engine 5.8.1 at `H:\UE_5.8`.
- Candidate: `D:\PhantomForceCandidates\V22R24`.
- Candidate gameplay evidence: `D:\PhantomForceProof\V22R24`.
- Installed gameplay evidence: `D:\PhantomForceProof\InstalledV22R24`.
- Fresh Phantom Legends build evidence: `D:\PhantomForceBuilds\V22R24`; CubeTown, Phantom Ages, and Phantom Strike retain their already-verified V22 Shipping packages.
- Live state: V22R24 is installed under `%LOCALAPPDATA%\PhantomPlay\Games\Unreal\Windows` after exact `PROMOTE` authorization.
- Rollback: the complete prior V18R1 installed set is preserved at `D:\PhantomForceRollbacks\phantomplay-unreal-v18r1-to-v22r24-20260820-122046\Windows`.
- Desktop state: the installed PhantomPlay shell was relaunched successfully after verification and left running for use.

## V22R24 camera, tools, and world-quality pass

- CubeTown now opens with a wider, flatter behind-character adventure camera: 1,420 cm arm, -9.5 degree pitch, 74-degree field of view, elevated aim point, and a 720–1,750 cm player zoom range. Build view expands to 2,050 cm without replacing the normal exploration camera.
- CubeTown exposes its usable actions in a two-line tool belt: combat, interaction, lock-on, sprint, jump, recenter, camera zoom, Create, Remember, Weave, Ride, Build, Kit, Map, and Journal.
- CubeTown gained a deliberately composed adventure lane; Phantom Ages gained a war-camp dressing pass; Phantom Strike gained tactical cover and landmarks. The additions are curated around readable play lanes instead of increasing asset count for its own sake.
- Phantom Legends gained a curated capital-life pass while preserving an open command lane. The known camera-blocking `LEG_Blue_Inner_0_1` actor and the experimental `LEG_V22_CapitalLife_Approach*` cluster are now removed and rejected by validation because actual cooked captures proved their legacy bounds could obstruct the camera.
- Phantom Legends uses a wider command camera and a readable late-morning lighting treatment.

## V22R24 verification

- Portfolio V14 static gameplay validation: PASS, including the CubeTown Zelda-distance, flatter-pitch, readable-FOV, objective-facing, streamed-capture, and camera-reset checks.
- Production world validation schema 22: PASS with zero failures. CubeTown: 489 actors / 21 V22 actors; Phantom Ages: 78 / 21; Phantom Legends: 523 / 17; Phantom Strike: 739 / 19. All four report zero basic shapes, rejected aliases, rejected composition actors, and oversized non-terrain actors; Strike also reports zero spawn blockers.
- Python syntax checks: PASS. Git whitespace/error check: PASS.
- Fresh Phantom Legends Windows Shipping cook/package after the final obstruction cleanup: PASS. All four V22R24 candidate executables exist and launched for capture.
- Actual packaged-executable gameplay capture: 4/4 at 1,920 x 1,080.
- Automated visual gate: 4/4 PASS. Detail/lower-frame ratios were CubeTown 0.861/0.944, Phantom Ages 0.861/0.889, Phantom Legends 0.840/0.785, and Phantom Strike 0.771/0.806.
- Human frame review: CubeTown shows the requested wide, flatter adventure view with long street/horizon visibility; Phantom Legends no longer has the giant foreground obstruction; Ages and Strike retain readable combat spaces and tool/HUD context.
- Installed tree verification: PASS. CubeTown 31 files / 1,047,770,975 bytes; Phantom Ages 31 / 1,047,779,180; Phantom Legends 30 / 1,047,774,796; Phantom Strike 31 / 1,047,779,188. All four launcher hashes match the reviewed manifest.
- Fresh installed-executable capture: 4/4 PASS. The installed visual metrics were CubeTown detail/lower 0.854/0.938, Phantom Ages 0.868/0.903, Phantom Legends 0.847/0.778, and Phantom Strike 0.771/0.806.

Evidence hashes:

- `cubetown-GAMEPLAY.png` — SHA-256 `BA0329FA2B726E00D54D2032AD7B3C186EBCA7AD17B51DAB5FD3DEF2E87E4B9C`.
- `phantom-ages-GAMEPLAY.png` — SHA-256 `4E779201D101DB38F5DF2F4C23ECED0F8CEE930DA206E376B491E72C8EF6D8AE`.
- `phantom-legends-GAMEPLAY.png` — SHA-256 `95A0C7E95F143076A08E2E878DF5420E03C0706741CD1921DBA27FC9BAE2CD8A`.
- `phantom-strike-GAMEPLAY.png` — SHA-256 `9ABDF5854EC4D8EBE4B7F9BFD9BD2B02A0C43DAFADBA0AACC46EB36CD3105EBF`.
- `V11_VISUAL_GATE.csv` — SHA-256 `6A7A8346846458BD564E3691C0BD356879B7A2DAE097E311F5EA37ABFB621B50`.

Installed evidence hashes:

- `cubetown-GAMEPLAY.png` — SHA-256 `A42D6C0336E7F287ED3FEE076AA678683A19FCABE00AB5EA9071C6BAFD2B6820`.
- `phantom-ages-GAMEPLAY.png` — SHA-256 `19CB5FD5926C78368254F16B92E9073CDCB53FB5185C1A7726D3B5A399C40E3A`.
- `phantom-legends-GAMEPLAY.png` — SHA-256 `FCA95CBD1B5E7DB7F341AEC58FA15F8D4E20B0EFD6E2C813E2E246681F47BEDE`.
- `phantom-strike-GAMEPLAY.png` — SHA-256 `A02B21EAB89354A025F9BE196DB83F802144C2D728B00377EE9053AB965A93D5`.
- `V11_VISUAL_GATE.csv` — SHA-256 `30789323C698C2E0253FEC82CF98CE7699D016A371061D612F0F8325AE4E3580`.

One incomplete generated V22R22 duplicate was moved intact to `D:\PhantomForceGeneratedArchive\2026-08-20-space-recovery\CandidateBuilds-V22R22-incomplete` to recover workspace capacity. No source, reviewed candidate, installed build, or live file was deleted.

## V22R24 release status

V22R24 is live and verified. Promotion first failed safely when C: lacked room for the second game; the tool automatically restored V18R1. The successful retry stored the rollback on D:, installed all four games atomically, and passed fresh installed capture and hash verification. `Tools/Promote-InstalledBuildSet.ps1` now reads versioned reviewed manifests from `Tools/PromotionManifests/` and can promote external candidate/proof roots without rewriting a release-pinned script. Exact destructive authorization remains enforced, but once supplied the workflow continues through installed verification instead of stopping at a candidate report.

---

# Prior checkpoint — 2026-08-20 V22R12 reviewed candidate

## State

- Branch: `agent/phantomplay-unreal-recovery-20260819`.
- Exact Unreal project: `packages/phantom-games-unreal/PhantomGames.uproject`.
- Engine: Unreal Engine 5.8.1 at `H:\UE_5.8`.
- Candidate: `BuildArtifacts/V22R12`; all four Windows Shipping packages completed successfully.
- Live state: unchanged at V18R1. V22R12 has not been installed because this project requires a separate exact `PROMOTE` authorization for live replacement.

## V22R12 completed repairs

- CubeTown now forces a readable opening gameplay view after world streaming completes: 940 cm spring arm, 76-degree field of view, centered town-lane focus, deterministic capture reassertion, and full streaming/async-load flush before the view is accepted.
- The reviewed CubeTown frame clearly shows the player, central road, objective NPC, town depth, HUD, and 62 m objective distance without camera obstruction.
- Phantom Legends removes the 16 contaminated grid actors whose `SM_Fab_Barracks` payload contained human-head geometry instead of architecture.
- Phantom Legends normalizes 22 oversized legacy tree slots and rejects the contaminated mesh/slot composition in both the editor patcher and production validator.
- Phantom Strike uses a less sky-heavy 82-degree combat view and a steeper insertion pitch so the road, weapon, enemies, and encounter space remain visible.
- Runtime sanitizers and static validation protect the repaired Legends composition from returning when older maps or aliases are loaded.

## Verification

- Editor C++ compile: passed.
- Production world validation schema 22: passed with zero failures.
- Portfolio static validation: passed, 26 checks, including the streamed-capture camera reassertion guard.
- Windows Shipping packaging: 4/4 passed, 30 files and approximately 1.047 GB per game.
- Actual executable gameplay capture: 4/4 passed at 1920 x 1080.
- Automated visual gate: 4/4 passed; CubeTown detail tile ratio 0.882 and lower-frame detail ratio 0.931.
- Human frame review: 4/4 passed. CubeTown camera/readability confirmed; Legends contaminated heads removed; Strike ground combat composition confirmed.

Evidence directory: `Saved/PhantomGameplayProofV22R12Candidates`.

- `cubetown-GAMEPLAY.png` — SHA-256 `0ED0543C6E104FD4E67695894ED8DA644C71050D033F2FF98E3DAE919AA29ACF`.
- `phantom-ages-GAMEPLAY.png` — SHA-256 `6FC5B19D656AF6DBB5FF08E88F603E284E23C785F18AE2E0A821982DAA8A7540`.
- `phantom-legends-GAMEPLAY.png` — SHA-256 `A6D7BCA06A0558C16FFB3A35710A8D12E4F8BABD009EF3CA2D6B831452D99698`.
- `phantom-strike-GAMEPLAY.png` — SHA-256 `F7B26795447503D5B311E58995C2AC2033F1A3344B7E766CF806FF97052AFFB2`.
- Visual gate CSV — SHA-256 `2BB85E83D9460ADAA1F721C05C5D1E5A45AB44D1700184677BE4C7267751EE8E`.

## Next release gate

V22R12 is a reviewed candidate, not an installed release. Promotion must preserve the current V18R1 build set as a rollback snapshot, atomically install all four V22R12 games, recapture the four games from the installed location, rerun the automated visual gate, and verify the installed hashes. Do not describe V22R12 as live until those installed-build checks pass.

---

# Phantom Codex Checkpoint — 2026-08-19 V18R1 installed release

## State

- Release branch: `agent/phantomplay-unreal-recovery-20260819`; final `main` commit is recorded by Git history.
- Exact Unreal project: `packages/phantom-games-unreal/PhantomGames.uproject`.
- Engine used for production work: Unreal Engine 5.8.1 at `H:\UE_5.8`.
- Status: the exact literal `PROMOTE` authorization was supplied. All four reviewed V18R1 Windows Shipping builds are now installed under `%LOCALAPPDATA%\PhantomPlay\Games\Unreal\Windows`, were launched from that installed location, and passed fresh 4/4 gameplay capture, automated visual acceptance, and human frame review.
- Native PhantomPlay desktop shell: installed, launched, and left ready at version `0.3.2`.
- Installed shell SHA-256: `1501D25DA79F005B81ED0AF93AA4A1CA590E614BC37D40E9CF57EF0497594F09`.
- Atomic V11R15 rollback checkpoint: `C:\Users\jorda\Documents\Codex\backups\phantomplay-unreal-v11r15-to-v18r1-20260819-065922\Windows`.

## Completed work groups

Native PhantomPlay desktop shell and project history; Unreal, Unity, and Panda3D launch surfaces; four differentiated Unreal flagships; production registries and control plane; knowledge discovery; AI-assisted edit contracts; native and desktop mod loading; recovered V13–V17 world and gameplay upgrades; CubeTown Memorycraft V16 and Diorama Adventure V17; PhantomPlay AI V18 provider routing; four-game V18R1 Shipping packaging; candidate and installed gameplay capture; automated and human visual acceptance; atomic installed-set promotion; and preserved V11R15 rollback state.

Repository verification completed on this release candidate:

- `npm run test:release-critical`: 32/32 passed on the rebased release.
- Responsive Chrome matrix: 66/66 passed across 11 surfaces and six viewports.
- Vespergate browser runtime: phone and desktop gameplay/map-state visual checks passed for version 3.0.
- PhantomPlay AI V18: four adapter/security tests and the V18 self-test passed.
- Unreal one-shot production validation: character, material, external-asset, world, V13, and CubeTown V17 gates passed.
- Unreal Shipping packaging: all four V18R1 archives passed with 4,810 runtime packages and 8,955 container chunks per game.
- PhantomPlay catalog: 37 built-in games verified.
- Native PhantomPlay desktop shell contract: 34/34 passed after promotion, including installed-build discovery, Unreal preference, Vespergate, engine detection, save/reload, and project-history recovery.
- Desktop mods: 12 checks passed; native mods: 7 checks passed.
- Filesystem and strict repository-history secret scans passed with 0 findings; the strict scan is rerun after the final rebase before push.

The canonical game bible remains a product specification and reference. Its full set of work packages and long-run dossiers is not individually certified complete by this checkpoint.

## V18R1 installed builds

- `%LOCALAPPDATA%/PhantomPlay/Games/Unreal/Windows/cubetown/Cubetown.exe` — 31 files, 1,043,014,022 bytes; launcher SHA-256 `693F901BF7B4F9DF9E2FF7954E66BF0443F431A16EE5F6E265351C430A6FF2D5`.
- `%LOCALAPPDATA%/PhantomPlay/Games/Unreal/Windows/phantom-ages/PhantomAges.exe` — 31 files, 1,043,014,035 bytes; launcher SHA-256 `448E8C37DD4B0650D610303DD9FD22161E393DF0CFD4866858519E2C8319A588`.
- `%LOCALAPPDATA%/PhantomPlay/Games/Unreal/Windows/phantom-legends/PhantomLegends.exe` — 31 files, 1,043,014,047 bytes; launcher SHA-256 `779EC14423CB1C05A4117285A60C174D95C42FD2B7D94B6CA0B7096C198F4E3D`.
- `%LOCALAPPDATA%/PhantomPlay/Games/Unreal/Windows/phantom-strike/PhantomStrike.exe` — 31 files, 1,043,014,043 bytes; launcher SHA-256 `5458645F838E1E9BA22CF5F8BA9EFFD34987F40B8A2AC73907056921F96B1EA0`.

The installed `PHANTOMPLAY_BUILDSET.json` reports revision `V18R1`, Unreal Engine 5.8.1, exact 4/4 installed hashes, and the rollback path above. `Tools/Promote-InstalledBuildSet.ps1` now fail-closes on any authorization other than exact `PROMOTE`, verifies candidate/package/evidence hashes before mutation, moves the prior set intact, restores it automatically on a failed install, and re-verifies the installed trees before writing the live marker.

## Visual acceptance evidence

Candidate captures in `Saved/PhantomGameplayProofV18R1Candidates` passed 4/4 at 1920 × 1080 and were individually reviewed:

- `cubetown-GAMEPLAY.png` — SHA-256 `CC7BDCA50C7E74EA4F4A7583F1365FDFD3B61908F976EDC381E8D21AD284702E`.
- `phantom-ages-GAMEPLAY.png` — SHA-256 `493F79D1D8D3BD94CCD1EFEEE0655523CBD2805263DBA72F83F17D3AF88CC180`.
- `phantom-legends-GAMEPLAY.png` — SHA-256 `9477D6342C6D1FACCAFBCD9828191A79B1A0A6A62191828FF702343D73415F2C`.
- `phantom-strike-GAMEPLAY.png` — SHA-256 `EC6FE73D6B5E9E2A2B0580E61A524A5B96ABD9F5F132A0570503566F528D8D16`.
- Gate CSV SHA-256: `C3137059E7D4D1E3C8195AE300180E5CDD136BCF7960E4A088D06990861D4066`.

Installed-build captures in `Saved/PhantomGameplayProofInstalledV11R15` also passed 4/4 at 1920 × 1080:

- `cubetown-GAMEPLAY.png` — SHA-256 `74709A4757C221FB2C56748AB8560D0A241FAE09486BD364AB4591F3631BBDDF`.
- `phantom-ages-GAMEPLAY.png` — SHA-256 `C8336849DC30BF149B94E02B9A4FB7BFAF40B1F8B03A6A6794C0B2BC035C4BF1`.
- `phantom-legends-GAMEPLAY.png` — SHA-256 `C4582319B7F4842085AF8F0926FEFED11FC60B7D4FC9D2D322168BA721230C34`.
- `phantom-strike-GAMEPLAY.png` — SHA-256 `56E276CCC45BBE5B719872FB10A465CB34234790DC2366C84C6848128B95B3B1`.
- Gate CSV SHA-256: `E0D59449FCEB5A6B0AB64DABB7F2D3911E4425FE9B6E0AF8298E666C90342BBE`.

Fresh post-promotion captures from the installed V18R1 executables in `Saved/PhantomGameplayProofInstalledV18R1` passed 4/4 at 1920 × 1080 and were individually reviewed:

- `cubetown-GAMEPLAY.png` — SHA-256 `FA113D13BCEDE70E2663401127D78380364CD563357582C72F2061C710E5D773`.
- `phantom-ages-GAMEPLAY.png` — SHA-256 `CB2782CC5DF81457C81DCCCC8571E34C942C4419400C4B4BB8E3CCAAE518EA1C`.
- `phantom-legends-GAMEPLAY.png` — SHA-256 `77B0AF8B4EA12A6C4495F10EFA0FF1805B041048046DD619FB779CA910076317`.
- `phantom-strike-GAMEPLAY.png` — SHA-256 `08E6D6BBC9E862EA40E26428363ED720A41DD5320CB4FF3BEC3D0A1E18EB343D`.
- Gate CSV SHA-256: `A2A3F70D53777BFF4267DD78F6F74A03F34EB13B899B9228F0A62B05AB023772`.

## Open work and truthful limitations

- Complete performance and soak telemetry remains open.
- Full human playtest convergence and every canonical-bible dossier remain open.
- Editor-dependent Unreal/Unity authoring and PhantomFlow provider operations remain unavailable when their local editor or provider runtime is absent; the production report exposes these as blocked instead of simulating success.
- Production OAuth/accounting behavior still depends on the selected provider completing its normal browser authorization, but the product now initiates that work through a single `Connect` action rather than asking users to perform manual configuration.

## Recovery and next gates

If V18R1 must be rolled back, close PhantomPlay and the four games, move the current installed `Windows` directory aside, restore `C:\Users\jorda\Documents\Codex\backups\phantomplay-unreal-v11r15-to-v18r1-20260819-065922\Windows` to `%LOCALAPPDATA%\PhantomPlay\Games\Unreal\Windows`, then rerun installed-build capture and the 4/4 visual gate before relaunching.

Next production priorities are performance/soak telemetry, human playtesting, and continued game-bible dossier convergence. New revisions must package to a new candidate directory, pass all four visual gates, preserve a rollback snapshot, and only then replace the installed build set.

---

# Phantom Codex Checkpoint — 2026-08-20 CubeTown V24R1 Echo World candidate

## Outcome

- Rebuilt CubeTown as one seamless 960 m × 960 m authored world with a 940 m × 940 m playable area (0.8836 km²).
- Populated the complete 10 × 10 world density grid. Every 100 m × 100 m cell contains at least six authored density anchors; there are no empty cells.
- Authored 2,237 V24 world actors, 567 connected road pieces, 15 landmarks, and eight differentiated regions: Heartstone, Moonmoss Marsh, Sunpetal Coast, Deep Forest, Starfall Quarry, Frostbloom Heights, Crimson Grove, and Emberbloom Phantomite.
- Rebuilt Starfall Quarry as a structured destination with three perimeter tiers, six extraction bays, an ore ring, 91 quarry-floor actors, a continuous service route, work shelters, carts, equipment, lights, safety edges, and a central extraction crystal.
- Added 20 m macro population, 10 m micro population, and approximately 6.5 m fine ground cover so traversal no longer exposes large undecorated world cells.
- Kept all V24 rotations explicit and added world-space surface materials so large terrain and district surfaces do not stretch or rotate incorrectly.
- Removed the Shipping-only black road failure by replacing extreme-aspect district ribbons with bounded tiled surfaces and a fail-closed stretched-surface validator.
- Updated CubeTown's adventure camera to a wider, shallower diorama composition with deterministic cold-load and capture reassertion.

## Verification

- CubeTown V24 authored-world validator: passed.
- World result: 2,237 authored actors; 567 road pieces; 15 landmarks; 100/100 density cells populated; minimum six anchors per cell; zero forbidden basic shapes; zero rejected legacy visuals; zero rejected road surfaces; zero stretched district surfaces.
- Portfolio gameplay static validation: passed.
- Four-game production-world gate: passed.
- Windows Shipping cook, stage, IoStore/Pak, and archive: passed (4,820 cooked runtime packages).
- Packaged CubeTown executable launched and produced seven fresh gameplay captures: opening, farm, coast, forest, quarry, Phantomite, and lair.
- The seven captures were individually reviewed; no Shipping-only black surface or missing-region load was present.
- Change-integrity check: passed.

Candidate archive: `D:\PhantomForceBuilds\V24R1\cubetown-pass8`

Packaged executable SHA-256: `768AB6A108C22A09D59FF2D0301ADEF03C3CE9F2873999CFDB6CA7197862EDD6`

Visual evidence: `D:\PhantomForceProof\V24R1-pass8`

## Release state

V24R1 pass 8 is a verified local CubeTown candidate. It has not been promoted. The installed four-game build set remains V22R24 under `%LOCALAPPDATA%\PhantomPlay\Games\Unreal\Windows`. Promotion requires explicit authorization and must preserve the existing V22R24 set as a new rollback before replacing the installed CubeTown package and re-running installed-location proof.

---

# Phantom Codex Checkpoint — 2026-08-21 V25R3 live portfolio promotion

## Outcome

- Promoted the complete four-game Unreal portfolio from V22R24 to V25R3 under `%LOCALAPPDATA%\PhantomPlay\Games\Unreal\Windows` after exact `PROMOTE` authorization.
- Replaced PhantomStrike block enemies with Epic Manny skeletal hostiles driven by the production unarmed animation blueprint while preserving role-specific weapons and behavior.
- Replaced Phantom Ages stick rigs with Epic Manny skeletal units and real idle, jog, and attack animation switching. Repaired the null authored-mesh bounds dereference that caused the first Shipping candidate to crash.
- Replaced Phantom Legends primitive troops with Epic Manny skeletal workers, guards, rangers, and brutes while continuing to suppress malformed legacy skeletal imports.
- Shipped CubeTown's V24R2 human locomotion, 360-degree orbit/look controls, wider adventure camera, and 2,237-actor seamless authored world in the same uniform build set.
- Added regression checks that fail if the production character gates are disabled or the Ages null-dereference pattern returns.

## Verification

- Portfolio gameplay validator: passed.
- Unreal Editor Development build: passed.
- Phantom Ages Development runtime reproduction: passed with exit code 0 after the crash repair.
- Unreal Engine 5.8.1 Shipping build, full cook, stage, IoStore/Pak, and archive: 4/4 passed with 4,872 cooked packages per title.
- Candidate packaged-game launch and gameplay capture: 4/4 passed at 1920 × 1080.
- Candidate automated visual gate: 4/4 passed; all four frames were also individually reviewed.
- Promotion-manifest candidate trees, executable hashes, proof hashes, and visual-gate verification: passed.
- Installed-location post-promotion launch and gameplay capture: 4/4 passed at 1920 × 1080.
- Installed-location automated visual gate: 4/4 passed.
- Installed `PHANTOMPLAY_BUILDSET.json`: revision V25R3 with exact 4/4 installed tree and launcher-hash verification.

Candidate set: `D:\PhantomForceCandidates\V25R3`

Candidate evidence: `D:\PhantomForceProof\V25R3`

Installed evidence: `D:\PhantomForceProof\V25R3-installed`

Rollback: `D:\PhantomForceRollbacks\phantomplay-unreal-v22r24-to-v25r3-20260821-000837\Windows`

## Installed gameplay evidence

- `cubetown-GAMEPLAY.png` — SHA-256 `3500579F7F365B9470D67B52DF746CFCB7ADCCE8AD1D1397F6944AB4A34B9DA5`.
- `phantom-ages-GAMEPLAY.png` — SHA-256 `A85903502B44748ED8BCBD12B99F49067A7D588A57DD794B4D7A2682B549849B`.
- `phantom-legends-GAMEPLAY.png` — SHA-256 `4A2F6CCE94E3DBFBBE2EA84BB54819D6233EBF010FCCC46A91C5FBBD4643C223`.
- `phantom-strike-GAMEPLAY.png` — SHA-256 `0565526AB847C03230CD875F6F528A802A362C02B132B6C3C4A6078E3A1E98EB`.
- Gate CSV — SHA-256 `256A71191B1EBE5372DE4C73DDCAF4D43C2C399C74F6C9DEB5A85891833316C8`.

## Release state

V25R3 is live locally and verified from the installed PhantomPlay location. V22R24 remains intact in the rollback checkpoint above. No commit or remote push is claimed by this checkpoint.
