# PhantomPlay engine scoping — what "AAA-scale, Age of Empires-class" actually requires

## Why this doc exists instead of engine code

The ask was: PhantomPlay's users should be able to download and play something on the order of
a modern Age of Empires, with the same edge network and Dev Mode plugged in. That is not a
feature that gets built in a coding session — it is a genuine multi-month-to-multi-year
engineering program even for an experienced team, and the honest thing to do is say that plainly
and lay out what real work it actually decomposes into, rather than write code that gestures at
"engine" without doing any of the hard parts. This doc is that honest accounting.

## What "the PhantomPlay engine" actually is today

`PHANTOMPLAY_ENGINE` (`server/src/phantom-ai/phantomplay.ts`) is **capability metadata and a
shared postMessage protocol, not a rendering or simulation engine.** Concretely, today:

- Every one of the 34 built-in games is a **bespoke, single-file HTML document** with its own
  hand-written Canvas2D rendering loop and game logic (`app/games/*.html` — see e.g.
  `pixel-bloom.html`, read in full while building Dev Mode). There is no shared entity system,
  renderer, or physics/pathfinding code between games.
- The shared contract between a game and the host page is nine message types
  (`ready, score, progress, complete, paused, exit, settings, save-state, load-state`) over
  `postMessage` — a thin scoring/lifecycle protocol, not an engine API.
- `largeMap: { chunkSize: 1024, maxLoadedChunks: 64, streaming: true }` and
  `runtimeProfiles.developer_full.maxAssetPackGb: 250` are **declared capability numbers**, not
  a working chunk-streaming asset loader. No game in this repo actually streams a 250GB asset
  pack; nothing currently reads or enforces these fields at runtime beyond reporting them in the
  snapshot.
- "Multiplayer" today (`PhantomPlayRoom`) is server-polled match-state relay for small, mostly
  turn-based or loosely-synced local games (see `updatePhantomPlayRoomMatchState`) — not
  real-time lockstep simulation. This matters enormously for RTS-scale games specifically (next
  section).

None of this is a criticism of what exists — 34 real, working, tested browser games with a
consistent lifecycle protocol is a legitimate platform. It's just not an engine, and "add an
Age-of-Empires-scale game" is not a small increment on top of it.

## What an actual RTS-at-scale engine requires

Age of Empires-class means, roughly: hundreds of independently-pathfinding units per player,
several players, real-time combat resolution, large streamable maps, fog of war, and — critically
— synchronized real-time multiplayer. Each of these is its own hard problem:

1. **Rendering at scale.** Canvas2D cannot practically draw and hit-test thousands of animated
   sprites/units at 60fps. This needs WebGL or WebGPU, sprite batching, and camera-frustum
   culling — a real renderer, not a bigger `for` loop over `ctx.fillRect`.
2. **Entity management at scale.** An ECS (entity-component-system) or well-designed scene graph
   is needed once you're past a few dozen live objects — the ad hoc per-game object arrays that
   work fine for `pixel-bloom` or `reflex-grid` do not scale to hundreds of units with AI, combat
   state, and pathfinding all ticking every frame.
3. **Pathfinding at scale.** Naive A* per unit per frame collapses immediately past a few dozen
   agents. Real RTS engines use flow fields, hierarchical pathfinding, and spatial partitioning
   (quad-tree/grid) for both pathing and target/collision queries.
4. **Deterministic real-time multiplayer.** This is the single hardest item on this list.
   RTS-scale multiplayer is not "send position updates" — with hundreds of units per player,
   state-syncing every unit every tick doesn't scale on bandwidth. The standard approach is
   **lockstep**: every client simulates the full game from synchronized inputs, which requires the
   simulation to be **bit-for-bit deterministic** across machines (no floating-point drift, no
   unordered iteration, no platform-dependent timing) plus input-delay buffering and desync
   detection. This is notoriously difficult even for studios that do it full-time — it is its own
   dedicated engineering effort, not a subsystem you bolt on. PhantomPlay's current room/match
   model (server-polled match-state) is architecturally a different, much simpler thing and does
   not extend into this.
5. **Asset streaming pipeline.** A real chunked asset loader (load what's near the camera, evict
   what's far, prefetch along movement) for maps/textures/units at the scale the declared
   `maxAssetPackGb: 250` implies. The PhantomPlay edge network
   (`docs/architecture/PHANTOMPLAY_EDGE_NETWORK.md`) is a genuinely relevant building block here —
   it already does signed, hash-verified chunk distribution — but it currently only moves opaque
   asset bytes into a cache; it has no concept of "which chunks does the renderer need right now,"
   which is a client-engine integration that doesn't exist yet either.
6. **Authoring tooling.** Hundreds of units/buildings and large maps need real data-driven
   authoring (unit stat tables, map editors, trigger/scripting systems) — this is where Dev Mode
   (`docs/architecture/PHANTOMPLAY_DEV_MODE.md`) is a relevant but small starting piece: it proves
   the sandboxed hot-reload loop on one file, not a full content pipeline.

## Rough effort shape (not a committed estimate)

For calibration, not as a promise: items 1–3 (renderer, ECS, pathfinding) are the kind of thing
one strong engine engineer can get a working v1 of in weeks if scoped to one game, not the whole
catalog. Item 4 (deterministic lockstep netcode) is the kind of thing that takes specialized
netcode experience and typically months of dedicated work plus extensive desync-testing
infrastructure before it's trustworthy — this is the item most likely to blow up a naive
timeline, and is a bigger lift than 1–3 combined. Item 5 is moderate once the edge network exists
(it does) but needs real design work to connect chunk delivery to renderer demand. Item 6 scales
with how much content you actually want to author, independent of the engine work.

## A realistic incremental path, if this is pursued

Rather than "build an RTS engine," the tractable next step is: **pick one existing strategy-ish
game already in the catalog (Kingdom Breakers or Crown Circuit are the closest starting points —
both already have lanes/towers/unit-ish mechanics) and scale that one game up**, in order:

1. Move its renderer from Canvas2D to WebGL/WebGPU and prove it holds frame rate with an order of
   magnitude more on-screen units than today.
2. Add spatial partitioning for targeting/collision queries once unit counts grow.
3. Only after 1–2 are solid, prototype deterministic lockstep for that one game at small player
   counts (2 players) before ever considering 4–8.
4. Treat whatever renderer/ECS/pathfinding code comes out of that as the seed of a real shared
   `packages/phantomplay-engine`-style package other games could optionally adopt later — don't
   design the shared package first, in the abstract, before one real game has proven the
   approach.

This intentionally does not promise a timeline or claim any of it is started. It's the difference
between "here's the real shape of the work" and pretending a docstring is an engine.
