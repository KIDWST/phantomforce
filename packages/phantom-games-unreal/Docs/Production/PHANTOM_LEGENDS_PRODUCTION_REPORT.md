# Phantom Legends Production Report — V11R6

- Map: `/Game/Phantom/Worlds/PhantomLegends_World`; canonical extent: 409,600 × 409,600 cm.
- Camera: RTS perspective, 9,800 cm boom, `(-58,-45,0)` degrees, 50° FOV; zoom contract 3,200–12,000 cm in normal gameplay.
- V11R6 fixes: generated storybook tree preferred over a malformed external alias; capture-only `PhantomGameplayCapture` flag disables edge scrolling so proof frames are deterministic. Normal gameplay edge scrolling is preserved.
- World validation: PASS; 598 actors, 98 authored-material real actors near start, no basic shapes or oversize non-terrain actors.
- Packaged gameplay: PASS. Stronghold, settlement ring, units, and HUD appear stably.
- Visual gate: FAIL — largest-color ratio 0.651, detail-tile and lower-detail ratios 0.368. Flat blue terrain and egg-like translucent silhouettes remain obvious.
- Disposition: retain as a V11R6 review candidate; do not promote.
