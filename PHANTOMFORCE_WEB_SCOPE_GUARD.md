# PhantomForce Web Scope Guard

Created: 2026-08-16
Baseline: `fb5814749ae20f184bd890a0ed5f14c4f76eb874` (`origin/main`)
Mission scope: PhantomForce customer app, internal admin app, and only the shared web/backend infrastructure required by those surfaces.

## Release-blocking boundary

PhantomPlay, every Phantom game, their assets, runtimes, registries, packages, candidate builds, and build scripts are frozen. This task must not edit, reformat, migrate, package, build, or delete them. No game build command may be introduced or invoked.

The existing PhantomPlay web navigation contract is also frozen. Shared shell files may change only around that contract; the guard verifies the exact label, route id, icon, feature mapping, optional visibility marker, mobile label, command shortcut, ordering, and renderer tuple.

Run the guard after each major milestone and before release:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify-web-scope-no-phantomplay.ps1
```

## Classification

### A — Frozen PhantomPlay/game-specific

- `app/assets/phantomplay/**`
- `app/games/**`
- `app/js/phantomplay*.js`
- `app/phantomplay*.css`
- `packages/phantomplay*/**` and `packages/phantom-games*/**`
- PhantomPlay-specific server modules and scripts
- PhantomPlay/game-specific tests, documentation, screenshots, registries, archives, and candidate builds
- Any path containing `.uproject`, Unreal, Unity, CubeTown, PhantomAges, PhantomStrike, PhantomLegends, or CandidateBuilds signatures

### B — Shared shell with a frozen PhantomPlay contract

- `app/js/main.js`
- `app/index.html`
- `app/js/command-os.js`
- shared entitlement, customization, workspace, navigation, package, and server entry files that mention PhantomPlay incidentally

These files are editable for PhantomForce web work only. Their PhantomPlay tuple and behavior must remain identical to the baseline.

### C — In-scope web product

- PhantomForce app/admin layouts, modules, styles, accessibility, route/state handling, and responsive behavior
- Shared web/backend contracts required by those surfaces, excluding PhantomPlay-specific branches
- Web tests, release evidence, and documentation for this mission

### D — Ambiguous, therefore frozen

Any matching path not proven to be shared web infrastructure is treated as frozen. Redesign the web change if it would require an ambiguous or PhantomPlay-specific edit.

## Pre-change fingerprint

`tools/phantomplay-scope-baseline.json` records Git object ids for the principal frozen roots and exact shared-shell contract fragments. The verifier compares all tracked and untracked changes against the baseline commit, then checks those contract fragments directly.

## Required release evidence

- scope guard passes;
- changed-file scan contains no class A or D path;
- all frozen fingerprints remain untouched;
- PhantomPlay navigation contract passes;
- no game build/package command was added or run.
