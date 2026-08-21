# PhantomStrike V19 — Premium Tactical FPS Execution Prompt

You are the principal Unreal Engine gameplay, rendering, animation, UI, audio, and release engineer responsible for taking **PhantomStrike: Operation Nightglass** from its verified V18R1 release to a polished, original, premium modern military FPS benchmark.

## Source of truth

- Project: `packages/phantom-games-unreal/PhantomGames.uproject`
- Runtime identity: `phantom-strike` only
- Gameplay source: `Source/PhantomGames/Private/Strike/PhantomStrikeDirector.cpp`
- Public contract: `Source/PhantomGames/Public/Strike/PhantomStrikeDirector.h`
- Current production report: `Docs/Production/PHANTOMSTRIKE_PRODUCTION_REPORT.md`
- Exterior target: `SourceArt/VisualTargets/phantom-strike-v12-exterior-gameplay-target.png`
- Interior target: `SourceArt/VisualTargets/phantom-strike-v12-interior-breach-target.png`
- HUD/weapon target: `SourceArt/VisualTargets/phantom-strike-v12-hud-weapon-target.png`

Treat V18R1 as the minimum acceptable release floor. Preserve its recovered V13–V17 world work, V18 production gates, installed-build compatibility, and real first-person movement, ADS, automatic and semi-automatic fire, reload, weapon switching, melee, grenade, tactical, sprint, crouch, prone, slide, mantle, hitscan damage, headshots, enemy archetypes, mission flow, extraction, scoring, map, scoreboard, checkpoint recovery, and native standalone launch.

## Product target

Build an original PhantomStrike experience with the responsiveness, spectacle, readability, animation quality, sound impact, encounter pacing, and frame polish expected from a genre-leading contemporary AAA military shooter. The three supplied images are visual acceptance targets, not background art. Reproduce their measurable qualities in the actual playable Unreal map using original or properly licensed assets. Do not copy any existing franchise's characters, maps, weapons, UI layout, logos, audio, animation, or branding.

## Required execution

### 1. Repair the rendered frame first

- Eliminate the nearly black V11R6 gameplay result. Calibrate exposure, skylight, key lights, local practicals, reflection captures, fog, post process, and material values so both exterior and interior combat remain readable.
- Match the exterior target's dense lower-half detail: wet authored surfaces, debris, cover, vehicles, storefronts, open interiors, side alleys, rooflines, traversal landmarks, and clear left/center/right combat routes.
- Build a production interior breach space matching the second target's route clarity: operations room, server area, glass/concrete partitions, destructible dressing, a bright exterior connection, flank route, and layered cover.
- Use Lumen, Nanite where appropriate, virtual shadow maps, physically based materials, bounded volumetrics, and production collision. Do not solve lighting by flattening the image or adding unbounded bloom.
- No final visible actor may use `/Engine/BasicShapes` or a debug material. Primitive meshes may exist only as hidden collision or temporary development helpers.

### 2. Make weapon handling feel finished

- Replace transform-only weapon motion with a dedicated first-person arms/viewmodel presentation, animation blueprint, additive locomotion, ADS alignment, sprint pose, tactical sprint transition, crouch/prone offsets, slide response, mantle interruption, inspect, equip, holster, reload stages, fire-mode switch, melee, and grenade/tactical throws.
- Implement data-driven weapon definitions for the rifle and sidearm: damage, range falloff, fire rate, burst/auto mode, magazine, reserve ammunition, reload timings, recoil pattern, camera kick, spread, ADS multiplier, movement multiplier, penetration class, surface response, and audio/VFX references.
- Add deterministic recoil with recoverable vertical/horizontal curves, camera impulse, viewmodel impulse, subtle sway/bob, muzzle flash, smoke, shell ejection, tracer probability, impact decals, surface-specific particles, hit marker, headshot marker, kill confirmation, and controller/desktop haptics where supported.
- Keep the rifle below roughly 23 percent of a 16:9 frame outside sprint/inspect. Its pivot, bounds, optic, hands, and ADS sight picture must remain correct at every source scale.
- No visible ballistic trace may be an Engine cylinder and no visible impact may be an Engine sphere.

### 3. Upgrade combatants and encounters

- Use production skeletal characters, animation blueprints, locomotion blend spaces, aim offsets, turn-in-place, cover poses, reloads, flinch/hit reactions, stagger, death reactions, and role-readable silhouettes.
- Preserve Rifleman, Rusher, Heavy, and Marksman identities. Give each an explicit combat behavior: seek cover, expose to shoot, suppress, flank, push, retreat/reposition, respect line of sight, and avoid bunching.
- Add squad-level encounter direction so waves create authored pressure rather than spawning a line of targets. First contact must occur within 8–15 seconds and demonstrate cover, a flank, a push, and readable counterplay.
- Add friendly operators for the exterior and breach beats. They must navigate, aim, fire, announce contact, avoid blocking the player, and communicate route intent without completing the encounter for the player.
- Add fair telegraphs, damage direction, near-miss audio, suppression feedback, and short recovery windows. No unavoidable spawn damage.

### 4. Turn Blackridge into a real mission

- Author a 12–18 minute Operation Nightglass slice with an insertion beat, exterior advance, interior breach, uplink interaction, escalation, and extraction holdout.
- Use objective states and checkpoints instead of a single wave counter. The player must always know the current objective, next landmark, and whether interaction is available.
- Build at least three connected combat arenas with two or more traversal choices each. Include mantle routes, interior/exterior transitions, short sightlines, one controlled long lane for the Marksman, Heavy counterplay, and grenade/tactical opportunities.
- Keep the canonical PhantomStrike map and identity. Do not bootstrap Phantom Ages, Phantom Legends, web, Unity, Panda3D, or a generic demo map.

### 5. Implement the V12 HUD in Unreal UMG

- Use the HUD target as the information-density and placement reference: compact objective upper-left, thin compass top-center, small squad status lower-left, restrained ammo/equipment lower-right, unobstructed center sight picture.
- Required readable states: `PHANTOMSTRIKE`, `OPERATION NIGHTGLASS`, current objective, interaction prompt, health/armor, squad state, ammo/reserve, fire mode, grenade/tactical counts and cooldown, damage direction, hit/headshot/kill confirmation, extraction timer, pause, map, and scoreboard.
- Use original PhantomStrike visual language: graphite/smoke surfaces, white type, cyan friendly/status, amber warning, red hostile only. Do not imitate another game's HUD.
- The HUD must scale cleanly from 1280×720 through 4K, survive ultrawide safe zones, remain legible at 100 percent Windows scaling, and avoid giant opaque panels.

### 6. Audio and tactile feedback

- Add original or properly licensed close, medium, and distant weapon layers; indoor/outdoor tails; mechanical layers; suppressed/unsuppressed variants; shell and impact sounds; enemy barks; squad callouts; objective cues; ambience; and extraction music states.
- Use spatial audio, obstruction/occlusion, surface sends, concurrency, attenuation, and dynamic mix ducking. The rifle must communicate power without clipping or masking threat information.
- Wire PhantomFlow-approved music into exploration, contact, escalation, and extraction states. Unreal owns adaptive playback and mix transitions, not music generation.

### 7. Performance and engineering quality

- Split monolithic responsibilities into production components/subsystems where it improves testability: weapon, damage, encounter director, objective flow, HUD, feedback, and save/checkpoint state.
- Use Enhanced Input and data assets. Do not add new hard-coded keys to the director.
- Avoid per-frame actor scans, uncontrolled dynamic material creation, unpooled short-lived actors, unbounded lights, and tick-heavy AI. Pool repeat VFX/decals where practical.
- Target a stable 60 FPS at 1920×1080 on the established Windows test machine with a 16.67 ms frame budget. Measure Game, Render, GPU, draw calls, memory, hitches, and shader compilation behavior in a packaged Development build.
- Preserve standalone resizable-window play and PhantomPlay launch routing.

## Validation loop — mandatory

1. Inspect the current map, source, assets, input mappings, build targets, and V11R6 report before editing.
2. Make changes in small verifiable slices; compile after each risky system change.
3. Build `PhantomStrikeEditor` and the exact `PhantomStrike` target. Resolve every compiler, linker, cook, missing asset, redirector, and runtime error.
4. Launch through PhantomPlay and directly through the packaged executable.
5. Perform real input smoke tests for movement, aim, fire, damage, reload, weapon swap, melee, grenade, tactical, slide, prone, mantle, interaction, map, pause, objective progression, checkpoint, and extraction.
6. Capture packaged 1920×1080 frames for exterior combat, interior breach, ADS/fire feedback, HUD, and extraction. Compare them side-by-side with all three V12 visual targets.
7. Run Unreal Insights or equivalent packaged profiling and record evidence. Fix the largest measured frame, render, memory, and hitch problems before polishing smaller ones.
8. Update automated source/identity tests and add gameplay automation for the new components.
9. Write `Docs/Production/PHANTOMSTRIKE_V19_PRODUCTION_REPORT.md` with exact commands, build paths, test results, profiling metrics, screenshots, known issues, and a truthful pass/fail disposition.

## Visual acceptance gates

- No black, missing-world, default-map, or debug-material frame.
- Exterior and interior screenshots visibly approach the supplied targets in exposure, lower-frame detail, cover density, route readability, weapon scale, character silhouettes, effects, and HUD restraint.
- The player sees authored world detail in at least 70 percent of sampled lower-half tiles and at least 65 percent of the full-frame detail sample used by the existing visual gate.
- First contact is visible within 8–15 seconds from insertion.
- The weapon, enemies, objective, route options, and current combat state are readable without opening a menu.
- No visible placeholder primitives, broken pivots, floating actors, spawn blockers, collision traps, stretched materials, duplicated HUD, or cross-game controller.
- Packaged input, damage, objective completion, checkpoint recovery, and extraction all work after a clean launch.
- Performance evidence supports the 60 FPS target; do not claim it from editor feel.

## Completion rule

Do not report completion because source was edited, assets were imported, or an editor build opened. Completion requires a clean compile and cook, exact PhantomStrike packaged launch, real input and gameplay validation, visual proof against the three targets, performance evidence, updated tests, and the V19 production report. If any gate fails, keep the disposition as **REVIEW CANDIDATE — NOT PROMOTED** and state the exact blocker.
