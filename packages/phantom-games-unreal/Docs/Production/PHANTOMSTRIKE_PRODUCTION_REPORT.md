# PhantomStrike Production Report — V11R6

- Map: `/Game/Phantom/Worlds/PhantomStrike_World`; canonical extent: 48,000 × 36,000 cm.
- Camera: first-person, camera offset `(-10,0,64)` cm, 103° FOV.
- V11R6 fixes: imported rifle/pistol fit from mesh bounds and pivot centering; player recovery below Z -200; invisible collision plane raised to align with the authored road.
- World validation: PASS; 649 actors, 429 authored-material real actors near start, no basic shapes, oversize non-terrain actors, or spawn blockers.
- Packaged gameplay: PASS. Road, buildings, cover, enemies, HUD, and weapon appear in a normal gameplay frame.
- Visual gate: FAIL — detail-tile ratio 0.535 and lower detail 0.556 remain below the acceptance thresholds despite the strongest frame of the four.
- Disposition: retain as a V11R6 review candidate; do not promote.

## Current release lineage and V19 successor target

V11R6 is retained only as the historical checkpoint documented above. V18R1 is the verified installed release floor; V19 must preserve the recovered V13–V17 world/gameplay work and V18 gates. The next implementation pass is defined by:

- `PHANTOMSTRIKE_V12_IMPLEMENTATION_PROMPT.md`
- `PHANTOMSTRIKE_V12_VISUAL_TARGET_PROMPTS.md`
- `SourceArt/VisualTargets/phantom-strike-v12-exterior-gameplay-target.png`
- `SourceArt/VisualTargets/phantom-strike-v12-interior-breach-target.png`
- `SourceArt/VisualTargets/phantom-strike-v12-hud-weapon-target.png`

These references do not promote the build by themselves. The implemented V19R1 candidate compiles, cooks, packages, and passes a hidden startup smoke test; real-input visual acceptance and measured performance evidence remain mandatory before promotion. See `PHANTOMSTRIKE_V19_PRODUCTION_REPORT.md`.
