# Shadowbearer: Dawn's Return reference manifest

## Canonical reference

- Product title: **Shadowbearer: Dawn's Return**
- Former public title: CubeTown
- Internal compatibility id: `cubetown`
- Unreal target/executable retained for update compatibility: `Cubetown` / `Cubetown.exe`
- User-provided visual target: `app/assets/phantomplay/shadowbearer-cover.png`
- SHA-256: `0C37C90FE0FD13ACA1820227F654662AFD236A4B1900D5249A62384BCAF92AE8`
- Original user source: `G:\+ PF +\Game Utils\Shadowbearer - Dawn of Light\Codex Image Aug 21, 2026, 12_30_53 PM.png`

## Canonical world map

- User-approved map: `Docs/Shadowbearer/ArtBible/Shadowbearer_WorldMap_Canonical.png`
- Runtime import source: `Docs/Shadowbearer/ArtBible/Shadowbearer_WorldMap_Canonical.png`
- Unreal texture: `/Game/Phantom/VisualTargets/Shadowbearer_WorldMap_Canonical`
- PhantomPlay asset: `app/assets/phantomplay/shadowbearer-world-map.png`
- SHA-256: `316F4351143C36886B350D7AEA41D66F2CDC38E836A05AD900ECC0A40DF30E1C`
- Original user source: `C:\Users\jorda\Downloads\Codex Image Aug 23, 2026, 06_07_03 AM.png`
- Canonical macro-regions: Velmor Keep, Ashenwold, The Sunken Court, Stonehelm Mountains, Duscreach Desert, The Shattered Coast, and The Black Spire.
- The map's four world bosses are optional overworld threats. They supplement rather than replace the five Returned guardians and Aktarus in the release-blocking campaign sequence.

## Visual laws

- Storybook fantasy with dense, readable environmental storytelling; no primitive debug art.
- Dawn palette: teal cloth, honey gold light, warm ivory stone, green village life.
- Shadowfall palette: charcoal silhouette, restrained violet corruption, sickly cyan edges.
- Dawn and Shadowfall occupy the same physical geography. Landmarks must remain recognizable.
- Violet is reserved for corruption, threat, and world-state change; it is not a general-purpose accent.
- The player silhouette is human, grounded, readable, and animated. The orbit camera must preserve spatial awareness.
- Every primary play frame needs foreground, midground, landmark, route, and an actionable point of interest.
- The M-key map must display the canonical illustrated map itself at readable aspect ratio. Placeholder text diagrams and invented legacy region names are not acceptable substitutes.

## Gameplay laws

- Light is projected from the Dawnlantern.
- Cast shadows can become tangible world geometry.
- The first hour must prove the mechanic through traversal, combat utility, restoration, and persistence.
- The opening establishes Bramblewick at Dawn before the Pale Warden causes the forced story defeat.
- Zane awakens at the same location in Shadowfall, returns through altered Bramblewick, solidifies the first shadow, and relights the Dawnlamp.

## Acceptance evidence

- Public title and description appear in PhantomPlay.
- Unreal title shell and HUD contain no public CubeTown identity.
- Dawn, Shadowfall, and Restored capture states can be launched deterministically with `-ShadowbearerCaptureState=`.
- The opening quest state persists in the existing save slot without invalidating prior player inventory or builds.
