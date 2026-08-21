# PhantomStrike V19R1 Production Report — Operation Nightglass

Date: 2026-08-20

Engine: Unreal Engine 5.8.1 (`H:\UE_5.8`)

Release floor: installed V18R1

Disposition: **REVIEW CANDIDATE — NOT PROMOTED**

## Implemented production slice

- Preserved the V18R1 release and recovered V13–V17 world/gameplay layers.
- Added a staged Operation Nightglass mission: insertion, Blackridge street advance, command-center breach, physical uplink interaction, marina extraction, and completion.
- Added two readable friendly operators. Their shots provide suppression tracers but deliberately apply no damage, so they cannot complete encounters for the player.
- Added tactical enemy decision windows for exposure, flank pressure, and repositioning while retaining Rifleman, Rusher, Heavy, and Marksman roles.
- Reworked the HUD around the active mission phase, compact compass, squad state, uplink prompt, extraction state, and restrained tactical color hierarchy.
- Increased readable exterior lighting and added bounded route light pools.
- Added an idempotent persistent-world pass with 122 tagged V19 actors: 41 route-surface details, 54 route-cover/details, three command-area landmarks, 18 uplink-cover actors, and six extraction-cover actors.
- Persisted Nanite material-usage state for asphalt, concrete, and cobble before Shipping cook.

## Source and content

- Runtime: `Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp`
- Public contract: `Source/PhantomGames/Public/Strike/PhantomStrikeDirector.h`
- Environment patch: `Tools/PatchPhantomStrikeV19.py`
- Generated surface asset: `/Game/Phantom/Generated/Strike/V19/SM_V19_SurfacePatch`
- Persistent map: `/Game/Phantom/Worlds/PhantomStrike_World`
- Reproducible production pipeline: `Tools/PhantomOneShotEditorPipeline.py`
- Candidate packager: `Tools/PackagePhantomStrikeV19R1.ps1`

## Verification receipts

- `PhantomStrike Win64 Development`: PASS.
- `PhantomGamesEditor Win64 Development`: PASS.
- V19 environment pass: PASS, 122/122 V19 actors.
- Production-world gate: PASS. PhantomStrike has 889 production actors, 551 authored-material real actors near start, 63 V13 actors, 122 V19 actors, zero basic-shape violations, zero rejected aliases, zero oversized non-terrain actors, and zero spawn blockers.
- `PhantomStrike Win64 Shipping`: PASS.
- Full Windows cook: PASS, 4,818 cooked packages, 0 errors.
- IoStore/package/archive: PASS, 4,811 packages and 8,959 container chunks.
- Hidden packaged startup: PASS; `PhantomStrike-Win64-Shipping.exe` remained healthy for 12 seconds with `-nullrhi -nosound -unattended -nosplash`.
- Focused PhantomPlay frontend/game safety contract: PASS.
- Full PhantomPlay server, edge-network, edge-storage, development-mode, mod, and edge-worker suite: PASS.
- Native PhantomPlay desktop shell: PASS, 38/38 tests.
- Repository `verify`: PASS.
- Release-critical suite: PASS, 33/33 checks.
- Change-memory guard: PASS, 374 checks.

## Candidate artifact

- Path: `CandidateBuilds/V19R1/phantom-strike`
- Files: 31
- Total bytes: 1,043,192,662
- Shipping runtime SHA-256: `29ADF7EBC8CE0E9FCBB03A34E32ACFEF5ADDB6B4000277C3D2156726894699D4`
- Main IoStore payload SHA-256: `18D41EECD1950390A6E36E33EBD6AA823DBC8B76E5CBED8463C9E7B91709130D`
- Main IoStore table SHA-256: `A25CB0003452F5066E884640D3D6A0FE539FF8A048B9943186069A3762F97006`
- Pak SHA-256: `184BBD33EF1942D2619BBFEDC6186896C12FC981DA52E5E650601163D3ADBCAC`

The small `PhantomStrike.exe` bootstrap hash remains identical to V18R1 because Unreal's bootstrap wrapper did not change. The Shipping runtime and cooked payload hashes above identify the V19R1 candidate.

## Open acceptance gates

- No visible gameplay window was launched because the owner was actively using the workstation and explicitly requested no UI control.
- Therefore packaged exterior, interior, ADS, HUD, and extraction screenshots have not been captured or compared against the three supplied visual targets.
- Real-input coverage for the complete move/aim/fire/damage/reload/swap/melee/grenade/tactical/slide/prone/mantle/uplink/checkpoint/extraction loop remains open.
- Packaged frame-time, GPU, memory, hitch, and soak evidence remains open.

V19R1 is a compiled, cooked, packaged, boot-verified candidate. It is not a visually accepted release and must not replace the installed V18R1 build without the exact literal `PROMOTE` authorization after the remaining gates pass.
