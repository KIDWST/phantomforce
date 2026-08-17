# Phantom Codex Checkpoint — 2026-08-17 V11R15

## State

- Repository release branch: `agent/finish-phantomplay-upgrades-release` (release commit pending at checkpoint write time).
- Exact Unreal project: `packages/phantom-games-unreal/PhantomGames.uproject`.
- Engine used for production work: Unreal Engine 5.8.1 at `H:\UE_5.8`.
- Status: four V11R15 Windows Shipping candidates passed the automated visual gate; the promoted installed build set also passed 4/4.
- Native PhantomPlay desktop shell: installed and launched at version `0.3.0`.
- Installed shell SHA-256: `C00B308E08801A224B86C4A48B82C1DB233330E22EB42D0C35B0736B56743E97`.
- Recoverable pre-promotion backup: `C:\Users\jorda\Documents\Codex\backups\phantomplay-v11r15-20260817-145647`.

## Completed work groups

Native PhantomPlay desktop shell and project history; Unreal, Unity, and Panda3D launch surfaces; four differentiated Unreal flagships; production registries and control plane; knowledge discovery; AI-assisted edit contracts; native and desktop mod loading; four-game Shipping packaging; candidate and installed-build gameplay capture; V11R15 automated visual acceptance; installer build, install, launch, and rollback capture.

Repository verification completed on this release candidate:

- `npm run verify`: passed, including 32/32 Rust shell tests and PhantomPlay identity, production, discovery, and AI-edit checks.
- `npm run test:release-critical`: 31/31 passed.
- PhantomPlay catalog: 37 built-in games verified.
- Desktop mods: 12 checks passed; native mods: 7 checks passed.
- Strict repository-history secret scan: passed with 0 verified and 0 unknown findings.

The canonical game bible remains a product specification and reference. Its full set of work packages and long-run dossiers is not individually certified complete by this checkpoint.

## Candidate builds

- `CandidateBuilds/V11R15/cubetown/Cubetown.exe` — 31 files, 911,160,190 bytes; launcher SHA-256 `693F901BF7B4F9DF9E2FF7954E66BF0443F431A16EE5F6E265351C430A6FF2D5`.
- `CandidateBuilds/V11R15/phantom-ages/PhantomAges.exe` — 31 files, 911,161,227 bytes; launcher SHA-256 `448E8C37DD4B0650D610303DD9FD22161E393DF0CFD4866858519E2C8319A588`.
- `CandidateBuilds/V11R15/phantom-legends/PhantomLegends.exe` — 31 files, 911,160,727 bytes; launcher SHA-256 `779EC14423CB1C05A4117285A60C174D95C42FD2B7D94B6CA0B7096C198F4E3D`.
- `CandidateBuilds/V11R15/phantom-strike/PhantomStrike.exe` — 30 files, 911,159,574 bytes; launcher SHA-256 `5458645F838E1E9BA22CF5F8BA9EFFD34987F40B8A2AC73907056921F96B1EA0`.

## Visual acceptance evidence

Candidate captures in `Saved/PhantomGameplayProofV11R15` passed 4/4 at 1920 × 1080:

- `cubetown-GAMEPLAY.png` — SHA-256 `159FF62526141F496D9F0D5AB08BB4AD1A3A4B4888282AB2A6DF03F4384F24DB`.
- `phantom-ages-GAMEPLAY.png` — SHA-256 `964C188AC23740B27098C0D445A12DA85698EE9E0F17601FD77D431E15F597CC`.
- `phantom-legends-GAMEPLAY.png` — SHA-256 `44DD0E4902F69B6F06FD05B68E9D3045687A04D349B1C2F408D42387DD486EEE`.
- `phantom-strike-GAMEPLAY.png` — SHA-256 `72C2DA9980D5AD5288DD12B3F3E03183CFAD5911EBE721B8A47BBB20991713C8`.
- Gate CSV SHA-256: `1E94D47D7C539E0E0875DECB4C2D83DAE32C0082B716AB80349B9D5E805E5090`.

Installed-build captures in `Saved/PhantomGameplayProofInstalledV11R15` also passed 4/4 at 1920 × 1080:

- `cubetown-GAMEPLAY.png` — SHA-256 `74709A4757C221FB2C56748AB8560D0A241FAE09486BD364AB4591F3631BBDDF`.
- `phantom-ages-GAMEPLAY.png` — SHA-256 `C8336849DC30BF149B94E02B9A4FB7BFAF40B1F8B03A6A6794C0B2BC035C4BF1`.
- `phantom-legends-GAMEPLAY.png` — SHA-256 `C4582319B7F4842085AF8F0926FEFED11FC60B7D4FC9D2D322168BA721230C34`.
- `phantom-strike-GAMEPLAY.png` — SHA-256 `56E276CCC45BBE5B719872FB10A465CB34234790DC2366C84C6848128B95B3B1`.
- Gate CSV SHA-256: `E0D59449FCEB5A6B0AB64DABB7F2D3911E4425FE9B6E0AF8298E666C90342BBE`.

## Open work and truthful limitations

- Complete performance and soak telemetry remains open.
- Full human playtest convergence and every canonical-bible dossier remain open.
- Editor-dependent Unreal/Unity authoring and PhantomFlow provider operations remain unavailable when their local editor or provider runtime is absent; the production report exposes these as blocked instead of simulating success.
- Production OAuth/accounting behavior still depends on the selected provider completing its normal browser authorization, but the product now initiates that work through a single `Connect` action rather than asking users to perform manual configuration.

## Recovery and next gates

If V11R15 must be rolled back, restore the installed build set and desktop shell from `C:\Users\jorda\Documents\Codex\backups\phantomplay-v11r15-20260817-145647`, then rerun installed-build capture and the 4/4 visual gate before relaunching.

Next production priorities are performance/soak telemetry, human playtesting, and continued game-bible dossier convergence. New revisions must package to a new candidate directory, pass all four visual gates, preserve a rollback snapshot, and only then replace the installed build set.
