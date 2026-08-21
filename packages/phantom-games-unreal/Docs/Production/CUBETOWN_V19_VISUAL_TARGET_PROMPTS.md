# Cubetown V19 — Maker's Journey Visual Targets

These original visual targets define the V19 successor to the verified installed V18R1 floor. They are direction, not a claim that a generated 2D image is already a shippable 3D scene. Runtime work must reproduce the silhouette, palette, framing, information hierarchy, and gameplay storytelling with real Unreal assets and systems.

## Maker character reference

```text
Use case: stylized-concept.
Create an original premium real-time game character design sheet for “Cubetown: Echoes of the Maker,” an original third-person storybook action-adventure. Character name: THE MAKER.

Asset type: production-ready 3D character concept sheet for an Unreal Engine artist and programmer.
Composition: clean landscape character turnaround sheet, full body front view, back view, side view, three-quarter hero pose, plus three small action silhouettes for running, casting, and staff-combat. Keep every figure fully inside frame and on one ground line.
Character: a compact athletic young adult fantasy adventurer with expressive friendly face and determined eyes; layered deep-teal tunic; warm cream trousers; rugged dark boots; a short asymmetric crimson hooded mantle and split cloak with a distinctive leaf-shaped trailing point; leather/brass utility belt and cross-body maker satchel; one chunky rune gauntlet; a handcrafted echo rod/staff with a floating cyan crystalline core; small lavender stone charm. Strong readable silhouette at a distant diorama camera. Human proportions stylized about 6 heads tall, capable rather than cute, not a cube person, not a mannequin.
Materials: stylized PBR, carved wood, woven cloth, brushed brass, soft leather, faceted cyan crystal. Moderate detail suitable for a polished indie 3D game, clean riggable joints, clear hands and boots.
Palette: crimson canopy red, deep teal and turquoise, cream, warm brass, lavender stone, dark plum shadows. Neutral warm-gray studio background, soft three-point lighting.
Mood: adventurous, ingenious, warm, magical, confident.
Constraints: completely original IP; do not resemble or reference Nintendo, Minecraft, Zelda, Fortnite, Pixar, or any existing franchise; no logos, no captions, no labels, no UI, no watermark, no weapons resembling guns, no photorealism, no cropped limbs, no duplicate stray figures.
```

Output: `SourceArt/VisualTargets/cubetown-v19-maker-character-reference.png`

## Heartstone gameplay target

```text
Use case: stylized-concept.
Create a polished original gameplay visual target for “Cubetown: Echoes of the Maker,” an original third-person storybook action-adventure made in Unreal Engine.

Asset type: cinematic but believable in-engine 16:9 gameplay frame, production concept to be followed by level, lighting, VFX, UI, and gameplay teams.
Camera: elevated third-person diorama camera, hero in the lower-left foreground at readable full-body scale, looking into a living village valley; wide enough to show a clear playable path and three layers of depth, but close enough that outfit and staff are recognizable.
Hero: THE MAKER, compact athletic fantasy adventurer wearing a short asymmetric crimson hooded mantle and split cloak, deep-teal layered tunic, warm cream trousers, rugged boots, brass/leather utility belt and satchel, glowing rune gauntlet, holding a handcrafted echo rod with a floating cyan crystal core.
World: Heartstone village beneath huge crimson-leaf fantasy trees; winding cream-and-lavender stone path; turquoise streams and small waterfalls; warm timber cottages; garden plots; maker workbenches; friends gathered near a glowing cyan Heartstone shrine; distant broken sky-island fragments and a chain of floating traversal platforms leading toward a mysterious landmark. Seasonal plants mingle intentionally: red canopy, teal grass, amber flowers, pale lavender rock.
Gameplay action: the Maker is mid-stride with cloak motion, one small original thorn creature ahead, one friendly turquoise echo companion following, a buildable bridge ghost projected across a stream, subtle quest beacon at the shrine, tiny drifting magical motes, leaves, and birds. It must feel explorable and system-rich, not a static render.
Lighting: warm late-afternoon sun, cool turquoise ambient fill, soft volumetric shafts through red canopy, stable exposure, saturated but controlled colors, readable silhouettes and path.
Style: premium stylized 3D PBR, handcrafted storybook shapes, tactile materials, compact polished indie AAA presentation, original IP.
Minimal HUD: restrained bottom-left curved health/stamina bars in crimson and cyan; bottom-center three small echo-tool slots; top-right compact objective card “REKINDLE THE HEARTSTONE” and one distance marker. Use crisp modern UI with no purple or blue gradients; cyan/turquoise and crimson accents only.
Constraints: entirely original; do not resemble or reference Nintendo, Zelda, Minecraft, Fortnite, Genshin, Pixar, or any existing franchise; no franchise iconography, no logos, no watermark, no giant block towers, no default mannequin, no photorealism, no excessive UI, no illegible text beyond the single objective phrase.
```

Output: `SourceArt/VisualTargets/cubetown-v19-heartstone-gameplay-target.png`

## Runtime translation contract

- Hero: production `SK_Mage` modular silhouette plus Maker rod/crystal identity; never `SK_Rogue` and never idle-only.
- Motion: idle, walk, run/sprint/dash, airborne, attack, and hit states select real production animation assets.
- Readability: cyan orbit shards and a local echo light react to movement and combat.
- Opening world: crimson canopy, cyan lantern trail, crystals, flowers, an ancient gate, and a visible companion lead from spawn into Heartstone.
- HUD: near-black glass, cyan/crimson accents, bottom-left life/stamina, three bottom-center Maker tools, compact objective information.
- Originality: composition and mechanics may pursue the premium systemic-adventure feeling, but no protected characters, symbols, assets, layouts, or franchise-specific art may be copied.
