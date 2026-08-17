# CubeTown Production Report — V11R6

- Map: `/Game/Phantom/Worlds/CubeTown_World`; canonical extent: 96,000 × 96,000 cm.
- Camera: third-person, 610 cm boom, 130 cm target lift, 34/12 cm socket offset, -14° pitch, 68° FOV.
- V11R6 fixes: player starts on the authored road at `(0,-10500,145)` cm; underworld recovery guard; collision proxy hidden while retaining collision.
- World validation: PASS; 478 actors, 173 authored-material real actors near start, no basic shapes or oversize non-terrain actors.
- Packaged gameplay: PASS. HUD, hero, road, houses, lamps, and pines are visible.
- Visual gate: FAIL — largest-color ratio 0.583, detail-tile ratio 0.458, lower detail 0.312. Ground is too flat; some set dressing reads as floating; the 960 m fantasy identity is not yet established.
- Disposition: retain as a V11R6 review candidate; do not promote.
