# PHANTOM GAMES — EMERGENCY VISUAL RECOVERY

This recovery pass exists because the previous packaged screenshots exposed structural failures, not polish issues.

## Root causes fixed
- Shared world code created fog + skylight but no SkyAtmosphere, producing black void backgrounds.
- Phantom Ages used a 360m vertical backdrop cube that could read as giant black walls.
- Phantom Ages fixed camera was too far/high for the battlefield to dominate the frame.
- CubeTown spawned looking away from Heartstone and could restore obsolete giant build transforms.
- Phantom Legends tagged spawned base actors with semantic names but relocation checked UObject GetName(), so the city stayed near origin while the camera moved ~1.2km away.
- PhantomStrike depended on prior /Game/Phantom/Strike content; this package re-bundles the known-good rifle, pistol, streets, buildings and materials from the user's earlier Content.zip.
- Packaging now uses a hard hero-asset gate and bCookAll so another primitive-only package is rejected instead of called successful.

## Acceptance
A build is NOT acceptable if:
- sky is black,
- CubeTown opens on an empty field,
- Ages shows a tiny strip,
- Legends opens on bare green ground,
- Strike falls back to a block rifle,
- required hero assets are missing.
