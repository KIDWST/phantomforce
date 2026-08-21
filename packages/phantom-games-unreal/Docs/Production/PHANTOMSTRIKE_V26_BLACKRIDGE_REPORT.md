# PhantomStrike V26R1 Blackridge production report

Date: 2026-08-21
Engine: Unreal Engine 5.8.1 (`H:\UE_5.8`)
Release floor: installed PhantomStrike V25R3 inside the mixed `V25R3+CUBETOWN-V19R1` PhantomPlay set
Disposition: **ISOLATED REVIEW CANDIDATE — NOT PROMOTED**

## Outcome

V26R1 is a compiled, cooked, packaged successor candidate that translates the approved Blackridge sample-photo language into original PhantomStrike runtime systems. It preserves the installed V25R3 build as the no-regression floor and does not touch the live install.

The pass removes a concrete cross-game regression: PhantomStrike enemies previously attempted to resolve the shared fantasy Rogue, Knight, and Barbarian production bodies before the military operator family. V26 makes the generated Helix modern-military silhouettes authoritative for hostile and friendly operators.

## Visual targets

- `SourceArt/VisualTargets/phantom-strike-v26-blackridge-gameplay-target.png` — 1672 × 941; SHA-256 `CE54A2F5B3CB2E21D01D309EE3A733D9E0541F73696FA60812EEE1A8FA8C1728`.
- `SourceArt/VisualTargets/phantom-strike-v26-blackridge-breach-target.png` — 1672 × 941; SHA-256 `02497C2A6D714A8DE715EE8DEBA951EE1AE5A0391775ED6CE361B3904EB8CA53`.
- Exact prompts and the original-design/runtime translation contract are preserved in `PHANTOMSTRIKE_V26_VISUAL_TARGET_PROMPTS.md`.

## Runtime implementation

- First-person tactical forearms and gloves now follow weapon bob, ADS, sprint, recoil, reload, inspect, sidearm, and camera-inertia states.
- Weapon presentation adds view inertia, shot impulse, recoil recovery, warm short-lived muzzle bloom/light, restrained warm tracers, and physical casing ejection.
- Friendly and hostile operators use the PhantomStrike Helix military family instead of shared fantasy bodies.
- Static operator presentation gains speed-responsive stride/bob, tactical lean, weapon recoil, hit reaction, and a timed collapse instead of instant disappearance.
- Friendly operators keep formation spacing and suppression behavior without finishing encounters for the player; their former neon status lights are disabled.
- The HUD is rebuilt around a thin compass, compact objective card, minimal hostiles count, quiet health/armor meters, minimal ammunition, and contextual relay interaction. The always-visible minimap, large top banners, saturated cyan panels, and arcade-style combat clutter are removed.
- Blackridge lighting now uses cool storm ambience, denser fog, warm practical pools, disabled vehicles, rubble, sandbag/barricade beats, relay-room server silhouettes, and a readable breached security aperture.
- The V26 atmosphere is additive and runtime-owned; it does not mutate the persistent `.umap` or overwrite prior production assets.

## Verification

Development compile:

```text
Build.bat PhantomStrike Win64 Development -Project=<worktree>/packages/phantom-games-unreal/PhantomGames.uproject -WaitMutex -NoHotReloadFromIDE
Result: Succeeded
```

Focused and portfolio safety tests:

```text
node scripts/test-phantomstrike-v26-blackridge.mjs
PHANTOMSTRIKE_V26_BLACKRIDGE_PASS

node scripts/test-phantomplay.mjs
PhantomPlay frontend and game safety checks passed.
```

Shipping package:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File packages/phantom-games-unreal/Tools/PackagePhantomStrikeV26R1.ps1
BUILD SUCCESSFUL
PHANTOMSTRIKE_V26R1_PACKAGE_PASS
```

- Candidate: `packages/phantom-games-unreal/CandidateBuilds/V26R1/phantom-strike`.
- Files: 31.
- Bytes: 1,043,281,311.
- Shipping SHA-256: `38226D4F896569CAB17708C159A0DAFE3100526D05CE724AEF8AB6717E773E2B`.
- Pak SHA-256: `184BBD33EF1942D2619BBFEDC6186896C12FC981DA52E5E650601163D3ADBCAC`.
- Ucas SHA-256: `18D41EECD1950390A6E36E33EBD6AA823DBC8B76E5CBED8463C9E7B91709130D`.
- Utoc SHA-256: `A25CB0003452F5066E884640D3D6A0FE539FF8A048B9943186069A3762F97006`.
- Candidate marker SHA-256: `FA2C6F4BF1384B28B1378BA0A3E68405648719765CDF8C98248DE5A079A9B829`.

Hidden startup evidence:

- The launcher did not honor the automation `quit` hook within 30 seconds and was stopped; this is recorded as a harness-exit failure, not a game crash.
- The direct Shipping binary remained alive for the complete hidden 15-second null-render/no-audio window and was then stopped cleanly by the harness.
- This Shipping configuration did not emit the requested external log, so no log-backed visual/startup claim is made.
- No visible window, mouse, keyboard, browser, or active PhantomPlay session was controlled.

Installed-floor verification after packaging:

- Installed PhantomStrike remains 30 files / 1,055,309,662 bytes.
- Installed Shipping SHA-256 remains `C99FD4E5D42F189E7FB7912FC378D1AFA48DA5DDF7014102D705F2A193485458`.
- Candidate Shipping SHA-256 is distinct: `38226D4F896569CAB17708C159A0DAFE3100526D05CE724AEF8AB6717E773E2B`.

## Open acceptance gates

- Real rendered-frame comparison against both V26 visual targets.
- Full keyboard/mouse playthrough through insertion, street advance, breach, relay, and extraction.
- Frame-time, hitch, GPU, and long-session soak evidence.
- Any visual defects found in those reviews require a new candidate revision.

Promotion remains blocked until the owner supplies a new exact literal `PROMOTE` authorization after reviewing the candidate evidence. The current request to upgrade/build is not treated as promotion authority.
