# Phantom Empires: Sovereign 3D — 2026-11-06

Game version 2.0.0; application build phantom-live-20261106-249.

## Request and delivered scope

The owner requested REA on their installed Age of Empires IV and chose a standalone RTS in PhantomPlay. This release extends the existing original Phantom Empires simulation with a real Three.js WebGL battlefield. It is a playable single-player medieval RTS, not a full recreation of the commercial game's engine, art, civilizations, campaigns or multiplayer. Those are not completion claims.

Original authored geometry supplies timber/plaster houses, castle towers and battlements, flags, production buildings, villagers, infantry, archers, riders, catapults, ships, woodland, resource deposits and bridges. Units animate from simulation orders. Camera projection, mesh selection, ground picking, drag selection, minimap and cursor-anchored zoom share the same simulation coordinates. Static scenery is instanced. The opening scene measured 285 render calls rather than the initial unbatched 994; this is not a hardware frame-rate benchmark.

The existing economy, building construction, six unit types, ten buildings, four ages, AI attack parties, combat, weather, campaign objectives, skirmish and Architect modes, saves and host messages remain. The existing campaign is a guided conquest match, not a new historical multi-mission campaign. Compatibility rendering can be selected explicitly, and unavailable/lost WebGL is reported honestly. Older version-1 save records remain usable.

Placement now rechecks required workers, age and available resources at commit time. The new scene creates no orders, paid services, online matches or external asset requests.

## REA evidence and limits

Installed REA CLI 6.5.0 was actually used on the local installation. RelicCardinal.exe returned filesystem access_denied / EPERM. No protection or permissions were changed and game-engine source was not recovered.

Managed editor inspection succeeded using rea-dotnet-static:
- Essence.Editor.Core.dll evidence ev_5849ce1eb4b1afe8dbe02b09c015bdf5c7494c4f2309fbe3252b95d2e8888154; SHA256 93555adfa7b64122c15ad2d6e145ce5c70008999720d1e61b527b25c8c2f3028.
- Essence.Editor.Modding.dll evidence ev_1628413a89d78d75cc5b7f319965fba93051ecb8285f229d6599423fd7497a00.

These establish managed editor metadata, not gameplay mechanics. The standalone implementation uses existing project source and newly authored code/geometry, not decompiled editor code or extracted game assets. REA did not automatically generate the game.

## Verification and provenance

Actual disposable Chrome tests cover WebGL output, projection round trips, selection, gathering, completed construction, produced units, AI forces, save/restore, compatibility mode, 1440px/390px layouts, final-age advancement, cursor-anchored zoom, actual touch army orders, and combat ending in both victory and defeat. Controlled fixture states isolate combat endings; economy and construction use real game actions. WebGL testing uses SwiftShader, not a claim of native GPU performance. The complete application builds successfully. The complete release-critical suite passed 73/73, including the new actual-game browser test in the PhantomPlay release gate. Change-memory passed 594 checks. Canonical clean-main preflight passed before integration.

Three.js comes from the existing app/vendor files under its MIT license. All new scene geometry is original code-native artwork. No AoE IV textures, audio, models, branding or DLLs are redistributed.

Undo: revert the release commit and sync the dedicated deployment. Save schema is unchanged; do not delete existing saves. The fixed-lane Phantom Ages project and dirty concurrent native-game worktrees were left alone.
