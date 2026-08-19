# Phantom Codex Checkpoint — 2026-08-19 V18R1 candidates

## State

- Release branch: `agent/phantomplay-unreal-recovery-20260819`; final `main` commit is recorded by Git history.
- Exact Unreal project: `packages/phantom-games-unreal/PhantomGames.uproject`.
- Engine used for production work: Unreal Engine 5.8.1 at `H:\UE_5.8`.
- Status: four V18R1 Windows Shipping candidates passed packaging, automated visual acceptance, and human screenshot review. The installed four-game set intentionally remains V11R15 until the repository's literal `PROMOTE` authorization is supplied.
- Native PhantomPlay desktop shell: installed and launched at version `0.3.0`.
- Installed shell SHA-256: `C00B308E08801A224B86C4A48B82C1DB233330E22EB42D0C35B0736B56743E97`.
- Recoverable pre-promotion backup: `C:\Users\jorda\Documents\Codex\backups\phantomplay-v11r15-20260817-145647`.

## Completed work groups

Native PhantomPlay desktop shell and project history; Unreal, Unity, and Panda3D launch surfaces; four differentiated Unreal flagships; production registries and control plane; knowledge discovery; AI-assisted edit contracts; native and desktop mod loading; recovered V13–V17 world and gameplay upgrades; CubeTown Memorycraft V16 and Diorama Adventure V17; PhantomPlay AI V18 provider routing; four-game V18R1 Shipping packaging; candidate gameplay capture; automated and human visual acceptance; and preserved V11R15 rollback state.

Repository verification completed on this release candidate:

- `npm run test:release-critical`: 31/31 passed.
- Responsive Chrome matrix: 60/60 passed across 10 surfaces and six viewports.
- Vespergate browser runtime: phone and desktop gameplay/map-state visual checks passed for version 3.0.
- PhantomPlay AI V18: four adapter/security tests and the V18 self-test passed.
- Unreal one-shot production validation: character, material, external-asset, world, V13, and CubeTown V17 gates passed.
- Unreal Shipping packaging: all four V18R1 archives passed with 4,810 runtime packages and 8,955 container chunks per game.
- PhantomPlay catalog: 37 built-in games verified.
- Desktop mods: 12 checks passed; native mods: 7 checks passed.
- Filesystem and strict repository-history secret scans passed with 0 findings; the strict scan is rerun after the final rebase before push.

The canonical game bible remains a product specification and reference. Its full set of work packages and long-run dossiers is not individually certified complete by this checkpoint.

## V18R1 candidate builds

- `CandidateBuilds/V18R1/cubetown/Cubetown.exe` — 31 files, 1,043,014,022 bytes; launcher SHA-256 `693F901BF7B4F9DF9E2FF7954E66BF0443F431A16EE5F6E265351C430A6FF2D5`.
- `CandidateBuilds/V18R1/phantom-ages/PhantomAges.exe` — 31 files, 1,043,014,035 bytes; launcher SHA-256 `448E8C37DD4B0650D610303DD9FD22161E393DF0CFD4866858519E2C8319A588`.
- `CandidateBuilds/V18R1/phantom-legends/PhantomLegends.exe` — 31 files, 1,043,014,047 bytes; launcher SHA-256 `779EC14423CB1C05A4117285A60C174D95C42FD2B7D94B6CA0B7096C198F4E3D`.
- `CandidateBuilds/V18R1/phantom-strike/PhantomStrike.exe` — 31 files, 1,043,014,043 bytes; launcher SHA-256 `5458645F838E1E9BA22CF5F8BA9EFFD34987F40B8A2AC73907056921F96B1EA0`.

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

## Open work and truthful limitations

- Complete performance and soak telemetry remains open.
- Full human playtest convergence and every canonical-bible dossier remain open.
- V18R1 is a reviewed candidate set, not the installed set. Promotion requires the exact literal user authorization `PROMOTE`; until then, installed gameplay and rollback claims remain V11R15 only.
- Editor-dependent Unreal/Unity authoring and PhantomFlow provider operations remain unavailable when their local editor or provider runtime is absent; the production report exposes these as blocked instead of simulating success.
- Production OAuth/accounting behavior still depends on the selected provider completing its normal browser authorization, but the product now initiates that work through a single `Connect` action rather than asking users to perform manual configuration.

## Recovery and next gates

If V11R15 must be rolled back, restore the installed build set and desktop shell from `C:\Users\jorda\Documents\Codex\backups\phantomplay-v11r15-20260817-145647`, then rerun installed-build capture and the 4/4 visual gate before relaunching.

Next production priorities are performance/soak telemetry, human playtesting, and continued game-bible dossier convergence. New revisions must package to a new candidate directory, pass all four visual gates, preserve a rollback snapshot, and only then replace the installed build set.
