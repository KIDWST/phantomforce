# Phantom Games — Production Rescue V10

V10 is a structural rescue pass, not another prop-count patch.

## Root causes fixed

1. **Double world generation:** CubeTown, Phantom Ages and Phantom Legends were loading persistent V9 maps and then rebuilding most of their old runtime environment again from `BeginPlay`. V10 gives the persistent `.umap` ownership of visible world composition and restricts runtime directors to gameplay simulation, invisible collision/support actors, lighting and interactive state.
2. **Imported art scale mismatch:** persistent-map placement previously used raw asset scale. V10 measures Unreal StaticMesh bounds, applies semantic target sizes, then grounds the transformed actor from its final bounds. Imported meters/centimeters/arbitrary kit units can no longer silently become microscopic scenery.
3. **Asset quality routing:** V10 prefers already-imported owned Fab/Quixel aliases, compatible Unity baseline assets and curated creator assets before local deterministic fallbacks. Missing important semantic art is an error; it is never replaced by an Unreal Engine cube/cylinder.
4. **Bad approval criteria:** successful compilation is not approval. V10 builds isolated candidates, requires four production-world reports to clear game-specific actor-density minimums, captures one actual packaged 1080p gameplay frame per game, runs the visual flat/empty-frame gate, and only then promotes the candidates over PhantomPlay's live builds.

## CubeTown

- Canonical **960m × 960m** world remains.
- Persistent 3×3 terrain grid; no second giant runtime visual world on top.
- Heartstone starts immediately in front of the player instead of behind/away from the camera.
- Continuous stone-road approach, stream, bridge, market pavilion, Dream Portal and Heart Tree.
- Dense close-range houses and outer buildings begin near spawn.
- Crimson, amber and rose canopy tunnel is deliberately visible in the opening frame.
- Gardens and lantern arches break up the foreground instead of flat grass.
- Crown Castle, waterfall/cliff, Mushroom Grove and ancient ruins become major destinations.
- Eight populated hamlets distribute architecture and foliage throughout the larger world.
- Owned/imported stylized Fab house/bridge/castle/market/flower/ruin/cliff assets are preferred when present and scale-compatible.

## Phantom Ages

- Canonical **360m × 110m**, fixed one-screen battlefield remains non-negotiable.
- Persistent map owns the visible battlefield, fortresses, rear ranks and spectacle.
- 144 rear-rank soldiers plus live combat simulation.
- Both faction fortresses, banners, battlefield ruins, siege engines, titans and dragons are in the fixed composition.
- Runtime gameplay tower actors remain authoritative but their duplicate placeholder visuals are hidden in production-world mode.
- No world navigation/panning is reintroduced.

## Phantom Legends

- Canonical **4096m × 4096m** fantasy RTS remains.
- Persistent 4×4 terrain regions, macro road network, river and five bridges.
- Two fortified capitals with keep, gates, towers, walls, barracks and economy ring.
- Seven neutral settlements, ruins, crystal landmarks and surrounding defenses.
- Large forest clusters and giant fantasy units make travel lanes visually/strategically legible.
- Runtime director retains unit selection, economy, combat, production and RTS simulation without rebuilding a second visible world.
- Owned/imported Fab keep/tower/gate/wall/barracks/bridge/ruin/crystal assets are preferred where present.

## PhantomStrike

- Canonical **480m × 360m** Blackridge Coast remains.
- Original recovered PhantomStrike rifle, pistol, streets, houses, flats, shops, hospital and bank remain authoritative.
- Persistent Blackridge map owns the urban environment.
- Dense street grid, authored source buildings, 210 cover/detail placements and checkpoint setpieces.
- Already-imported owned Fab urban building/hotel/shop/rubble/barrier/street props are preferred where they improve the scene.
- Runtime director does not rebuild a duplicate city on production-world launch.

## Build / promotion safety

- Default build throttle: BelowNormal orchestrator priority and 8 UBT parallel actions.
- One UnrealEditor-Cmd content session for generated/creator/Unity/Fab import + persistent world creation.
- Four independent candidate cooks because the products ship as four executables.
- Live games are never deleted first.
- Rollback copy is created immediately before promotion.
- Candidate promotion requires all four:
  - `.umap` files present;
  - production world report `PASS`;
  - game-specific minimum persistent actor counts;
  - actual packaged gameplay screenshot captured;
  - visual gate passed.

V10 deliberately does **not** claim the final Windows result is good until the user's local UE 5.8 build executes the compile/import/cook/playtest gate.
