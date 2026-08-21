# PhantomStrike V12 — Visual Target Generation Prompts

These are the exact prompts used with the built-in image generation workflow to create the three checked-in V12 visual targets. They define original PhantomStrike art direction and explicitly prohibit copying another franchise's protected characters, maps, weapons, UI, logos, audio, animation, or branding.

## Exterior gameplay target

Output: `SourceArt/VisualTargets/phantom-strike-v12-exterior-gameplay-target.png`

```text
Use case: stylized-concept
Asset type: PhantomStrike Unreal Engine visual target, exterior first-person gameplay frame
Primary request: Create a believable in-engine gameplay screenshot target for an original premium 2026 modern tactical military FPS. Preserve the coastal Blackridge identity, wet streets, storm-break sunlight, near-future tactical gear, and restrained cyan/red team accents from the reference, but make the result clearly playable rather than promotional key art.
Scene/backdrop: a dense coastal city combat lane with damaged concrete, storefront interiors, parked vehicles, waist-high cover, side alleys, rooftops, and a visible extraction landmark; every surface has authored material detail and the lower half of the frame is rich and readable.
Subject: first-person player holding a realistic original modular assault rifle with holographic sight; two friendly operators advancing; three readable hostile silhouettes using cover farther down the lane; one small surveillance drone overhead.
Style/medium: photorealistic AAA Unreal Engine gameplay capture, physically based materials, realistic weapon proportions, high-detail but optimized real-time rendering.
Composition/framing: 16:9, eye-level first-person camera, rifle occupies lower-right 22 percent, combat focus centered at medium range, strong traversal routes left/center/right, no cinematic letterbox.
Lighting/mood: bright overcast storm break with strong natural exposure, wet reflections, light smoke, sparks and localized fire; moody but never crushed black.
Color palette: graphite, weathered concrete, muted military olive, ocean gray, restrained cyan friendly accents and red hostile accents.
Constraints: original IP only; no copied characters, maps, logos, weapons, interface, or branding from any existing franchise; no title text; no watermark; no excessive sci-fi armor; no empty black regions; no blurred lower half; image must read as a practical implementation target for PhantomStrike.
Avoid: promotional poster layout, fisheye distortion, oversized gun, neon cyberpunk city, illegible silhouettes, gore, franchise logos.
```

## Interior breach target

Output: `SourceArt/VisualTargets/phantom-strike-v12-interior-breach-target.png`

```text
Use case: stylized-concept
Asset type: PhantomStrike Unreal Engine visual target, interior breach and gunfeel gameplay frame
Primary request: Create a practical in-engine first-person combat screenshot target for an original premium modern tactical FPS, emphasizing tactile gunfeel, enemy hit readability, destruction, and cinematic but playable interior lighting.
Scene/backdrop: Blackridge coastal command center interior during a breach: concrete operations room, glass partitions, server racks, tactical map wall, overturned desks, shell casings, sparks, drifting plaster dust, doorway into a brighter exterior lane.
Subject: first-person player firing an original compact assault rifle with a controlled muzzle flash and convincing recoil pose; one hostile at medium range visibly reacting to a non-gory impact behind cover; one friendly operator slicing the doorway; another hostile repositioning through a side corridor.
Style/medium: photorealistic AAA real-time Unreal Engine gameplay capture, original military equipment, physically based materials, high-frequency environment detail, excellent character animation silhouette.
Composition/framing: 16:9 first-person camera, weapon lower-right and no more than 25 percent of frame, clear central engagement, visible flank path at left, readable doorway and cover layers, no cinematic letterbox.
Lighting/mood: balanced warm emergency practicals against cool daylight and monitor glow, volumetric dust, strong local contrast while retaining shadow detail; never black or underexposed.
Color palette: gunmetal, concrete gray, muted sand, cold cyan team indicators, restrained hostile red, warm amber practical lights.
Constraints: original IP only; no copied franchise characters, logos, maps, weapons, interface, or branding; no title text; no watermark; no gore; no exaggerated sci-fi armor; make every tactical route and combatant readable; image must be achievable as an Unreal Engine vertical-slice target.
Avoid: promotional poster, oversized muzzle flash, impossible weapon, empty rooms, crushed blacks, excessive bloom, cyberpunk neon, clutter that hides enemies.
```

## HUD and weapon target

Output: `SourceArt/VisualTargets/phantom-strike-v12-hud-weapon-target.png`

```text
Use case: ui-mockup
Asset type: PhantomStrike first-person HUD and weapon presentation visual target
Primary request: Create a high-fidelity 16:9 gameplay screenshot mockup for an original premium modern tactical FPS, focused on a clean, highly readable combat HUD and excellent first-person weapon presentation.
Scene/backdrop: playable Blackridge coastal transit terminal at blue hour, damaged but well-lit, wet stone, concrete cover, open concourse, one friendly operator and two distant hostile silhouettes, realistic real-time rendering.
Subject: first-person player holding an original modular assault rifle with crisp hands, sensible scale, holographic optic and small visible laser module; the weapon must feel tactile and production-ready.
Style/medium: photorealistic AAA Unreal Engine gameplay capture with an original restrained tactical HUD overlay.
Composition/framing: 16:9; weapon lower-right under 23 percent of image; central sight picture unobstructed; HUD uses screen edges and leaves the combat view clear.
Lighting/mood: cool dusk daylight, warm interior practicals, readable shadow detail, atmospheric smoke only in the far background.
Color palette: graphite and smoke gray UI, white typography, cyan friendly/status accents, amber warnings, red only for hostile markers.
Text (verbatim): "PHANTOMSTRIKE"; "OPERATION NIGHTGLASS"; "SECURE THE UPLINK"; "32 | 160"; "TACTICAL READY".
HUD elements: thin compass at top center, compact objective panel upper-left, minimal squad status lower-left, small ammo and equipment cluster lower-right, subtle hit-marker center, no giant minimap, no arcade score banner.
Constraints: original interface and original IP only; no copied franchise layout, logos, characters, maps, weapons or branding; exact text only; no extra fake words; no watermark; UI must remain readable at 1080p and implementable in Unreal UMG.
Avoid: oversized HUD boxes, neon cyberpunk styling, clutter, giant crosshair, underexposure, promotional poster layout, gore, distorted hands or weapon.
```
