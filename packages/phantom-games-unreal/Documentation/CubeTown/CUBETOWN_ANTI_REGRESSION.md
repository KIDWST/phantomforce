# CubeTown Anti-Regression Gate

Before accepting a CubeTown gameplay/art change, verify:

1. Crimson/red tree family remains visible in Heartstone and Crimson Grove.
2. Adventure mode remains third-person and traversable with camera collision.
3. Player-facing voxel/block construction is not exposed.
4. B opens architecture Build Mode; prefab/wall/room/fence/garden/decor tools still work.
5. Ctrl+Z and Ctrl+Y operate against the transaction stacks.
6. Hold Q shows Creation selection and returns time dilation to 1.0 on release.
7. Tab/M/J overlays do not permanently steal gameplay input after closing.
8. World save/load reconstructs player build transforms/assets.
9. The opening area contains red foliage, village architecture, water/light accents, friends and a distant landmark.
10. No new dependency silently replaces the external CC0/Generated art with Engine BasicShapes as the normal visual path.

A packaged build should be rejected if any of the above is visibly broken.
