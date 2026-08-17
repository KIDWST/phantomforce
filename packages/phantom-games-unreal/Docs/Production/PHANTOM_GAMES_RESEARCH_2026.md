# Phantom Games Research 2026

Date: 2026-08-16
Scope: Unreal Engine 5.8 production choices, owned/free asset sourcing, and the four-game visual rebuild.

## Adopted findings

- Unreal Engine 5.8.1 is the installed production engine. The project favors persistent authored maps and ordinary runtime gameplay over capture-only scenes. See [Unreal Engine 5.8 release notes](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-8-release-notes).
- The 4096 m Legends map is large enough to benefit from World Partition concepts, but the present candidate remains a conventional persistent map until streaming and traversal are validated. See [World Partition](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine).
- Fab/Quixel assets may be used only through official entitlement/import workflows. Local discovery is not proof of semantic fitness. See [Fab window](https://dev.epicgames.com/documentation/unreal-engine/fab-window-in-unreal-engine?lang=en-US) and [free Epic content](https://dev.epicgames.com/documentation/unreal-engine/free-epic-games-content-for-unreal-engine?lang=en-US).
- Current creator sources used or evaluated: [KayKit Adventurers](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0), [Kenney Fantasy Town Kit](https://kenney.nl/assets/fantasy-town-kit?part=d3371052-f2b7-4dbd-85ac-4c5eab909878), and [Quaternius Ultimate Fantasy RTS](https://quaternius.com/packs/ultimatefantasyrts.html).
- Seven PBR material roles were acquired from Poly Haven under its CC0 policy: grass, cobble, dirt, rock, asphalt, concrete, and wood. See [Poly Haven license](https://polyhaven.com/license).
- Unity was treated as a baseline rather than discarded: 51 source assets and 6 gameplay scripts were inventoried for compatible art/mechanic reuse.

## Rejected findings/assets

- Two locally discovered “owned Fab” aliases resolved to `/ConcertSyncClient/HeadMesh`; their names suggested barracks/crystal but the geometry was semantically wrong. They are rejected as production evidence and must not be trusted merely because discovery scored them.
- Optional Quaternius variety was not required to unblock this build and remained optional when creator downloads were unavailable.
- Engine primitive geometry is not accepted as final presentation art. The current persistent-map validator finds no basic-shape actors in the authored worlds, but dormant code fallbacks are still a release risk.
- Community sentiment was not used as a licensing or technical authority. Official documentation and first-party creator/license pages govern acquisition decisions.

## Production conclusion

The project has a legally safer, deterministic local art pipeline and four launchable Windows candidates. It does not yet have four premium-ready first frames; the V11R6 visual gate rejects every game. Research therefore supports continued targeted art direction, not promotion.
