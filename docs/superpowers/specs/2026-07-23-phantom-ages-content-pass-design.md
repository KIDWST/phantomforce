# Phantom Ages — Content Pass Design

## Context

Phantom Ages (`app/games/phantom-ages/`) is a built-in PhantomPlay game: an Age-of-War-style lane battle where the player and an AI opponent push units down a shared lane toward each other's base, backed by a base turret and a per-side upgrade shop. It just shipped a v2.1 rework ("real soldiers, upgradeable tower, mobile-ready") and is fun but thin — one generic tower for the whole game, and only 2 units per era through most of the run.

PhantomForce is not building new games right now. The mandate is to take the games that already exist and make them genuinely excellent: something new PhantomForce users enjoy on day one, and something outside developers can measure their own PhantomPlay submissions against. Phantom Ages is the current target.

Reference feel: **Age of War** for the escalating tower/base weapon per era, **Age of Empires** for unit role depth and player agency. The explicit bar for this pass: unleash the full power of fun — lean into satisfying feedback, escalating power fantasy, and real strategic choice, not just bigger numbers.

## Current state (ground truth, `app/games/phantom-ages/game.js`)

- `LANE_LENGTH = 620` world units; player base at 0, enemy base at 620.
- `ERAS`: Stone Age → Bronze Age → Iron Age → Industrial Age → Future Age (5 entries), each with `advanceCost` and (for the first 3) a fixed `unitIds` pair.
- `BRANCH_ERA_INDEX = 3` — at Industrial, the player picks a `military` or `tech` path via `PATH_UNITS`, which supplies 2 units per era for Industrial and Future.
- One tower (`TURRET = { range, damage, cooldown }`) for the entire game. `fireTurret()` auto-fires on cooldown for both sides plus a manual "Overcharge" (Space / button) with no cooldown gate on the shot itself, just a separate `manualCd`.
- `UPGRADES`: 8 entries across 3 tracks — Cannon (Power/Rate/Range/Multi-Shot), Economy (Income/Bounty), Fortress (Walls/Auto-Repair) — flat for the whole game, `side.up` holds levels.
- Just fixed in this session: `turretRange()` now caps at `LANE_LENGTH / 2` (was overshooting to ~460-515 world units by upgrade level 3-4, letting the cannon reach nearly across the whole lane); `spawnProjectile()` no longer truncates a cannonball's visual flight before it reaches a long-range target.
- All art is procedural canvas drawing (`drawTower`, `drawCharacter`) — no image/sprite assets, so new visual content is code, not an asset pipeline.

## Era lineup

Stone Age → Bronze Age → **Medieval Age** → Industrial Age → Future Age (5 total). Medieval takes over Iron Age's slot — today's `knight`/`crossbow` units become Medieval's baseline and get expanded, since Iron Age currently has almost no distinct identity of its own.

## Tower: a real weapon per era

The tower stops being one constant object with generic stat upgrades. Each era gives it a distinct weapon with its own attack shape, visual, and upgrade track:

| Era | Weapon | Attack shape | Upgrade track (replaces generic Cannon track) |
|---|---|---|---|
| Stone | Catapult | Arcing single-target, high damage/slow rate | Power / Rate / Range / **Boulder Size** (splash radius on landing) |
| Bronze | Ballista | Fast single-target, armor-piercing (ignores a flat HP threshold) | Power / Rate / Range / **Piercing** (hits 1 extra unit behind the primary target) |
| Medieval | Boiling oil (poured from the tower, not thrown) | Splash — damages every enemy unit within range of the base, decaying with distance | Power / Rate / Range / **Splash Radius** |
| Industrial | Cannon (today's weapon, kept as-is) | Single-target with existing Multi-Shot | Power / Rate / Range / Multi-Shot (unchanged) |
| Future | Plasma beam | Piercing line — hits every enemy unit between the base and max range | Power / Rate / Range / **Beam Width** (extra parallel hit-lane) |

**Upgrade continuity:** advancing an era carries over roughly 40-50% of the prior weapon's level total (rounded, distributed across the new track) as a head start — investment isn't wiped, but the new weapon still needs real gold spent on it. `side.up` gains a small per-era remap function rather than one flat object reused verbatim.

**Manual Overcharge** stays as the one player-triggered ability slot, reskinned per weapon (e.g. a boiling-oil "full pour" that hits a wider splash once its cooldown is up) rather than a generic bonus-damage volley.

## Units: real roster depth per era

Every era gets **3-4 units** instead of 2, each with a clear role:

- A cheap/fast unit (early pressure, chip damage)
- A tanky melee unit (soaks hits, blocks the lane)
- A ranged/artillery unit (the current archetype)
- Medieval onward: one **specialist** with a unique ability trigger (see below)

Concretely, expanding what exists:
- **Stone:** `clubman` (tank), `rockThrower` (ranged) stay; add a fast/cheap unit (e.g. a sprinting scout that can't fight well but rushes gold-value damage to the base).
- **Bronze:** `swordsman` (tank), `archer` (ranged) stay; add a fast unit (skirmisher).
- **Medieval:** `knight` (tank), `crossbow` (ranged) stay; add a fast unit (squire/scout) and a specialist — an oil-thrower unit that briefly slows whatever it hits, echoing the tower's theme at unit scale.
- **Industrial/Future:** already branch into military/tech with 2 units each — extend each branch to 3 by adding one specialist per branch (e.g. military gets a shield-bearer that blocks the next hit on itself; tech gets a support drone that buffs a nearby unit's rate).

**Branch choice moves earlier:** instead of only forking at Industrial, Medieval introduces a first branch — e.g. "Knights" (heavier melee, tankier units) vs. "Longbow Company" (ranged-focused, faster/cheaper units) — carrying a build identity forward into Industrial/Future rather than a single late-game fork deciding everything.

**Player control ("more control," Age of Empires side):** each specialist unit gets one meaningful trigger — a shield-bearer's block, an oil-thrower's slow, a support drone's buff pulse — surfaced as a small always-visible cooldown icon on the unit, not a menu. This is the "Age of Empires" texture: units aren't just fire-and-forget spawns, they carry one decision each.

## Unleashing "full power of fun" — concrete design principles for implementation

- **Escalation must be felt, not just read.** Every era transition should change what a run of the game *looks and sounds like* at a glance — different projectile, different impact particles/color per weapon, a distinct tower silhouette per era (already free, since art is procedural).
- **No dead upgrade levels.** Every upgrade point should be individually noticeable in play (the range-cap bug just fixed is exactly the failure mode to avoid elsewhere — a stat that changes on paper but the player can't perceive).
- **Specialist abilities trigger automatically off cooldown, no menu, no interruption** — juice comes from watching the battlefield, not managing a UI.
- **AI opponent uses the same content** (it already buys from the same upgrade pool and unit pool) so the escalation is a real arms race, not player-only busywork.

## Explicit non-goals for this pass

- No new environment/background art per era (out of scope; tower + units carry the identity).
- No changes to the existing `military`/`tech` late-game branch mechanics beyond adding one specialist unit each.
- No changes to matchmaking, scoring, or the PhantomPlay platform shell (dev mode, saves, etc.) — this is entirely inside `app/games/phantom-ages/`.

## Phasing

**Phase 1 — Tower weapon system.** New per-era weapon definitions, splash and piercing attack-shape mechanics (new to the codebase — today only supports single-target and flat multi-target), per-era upgrade track + carry-over remap, visual rework of `drawTower` per era, Overcharge reskin per weapon. This is the larger engineering lift (two new attack shapes) and should land and be verified in-game before Phase 2 starts.

**Phase 2 — Unit roster expansion, era by era.** New unit definitions (stats + procedural art in `drawCharacter`), the Medieval branch fork, specialist trigger abilities, AI purchase-list updates so the opponent uses the new roster too.

Each phase gets verified in a real browser session (`node scripts/test-phantomplay.mjs` plus manual play) before moving on — this game has no existing automated balance/gameplay test beyond catalog/safety checks, so in-game verification is the real gate.

## Open risk

Two new attack shapes (area splash, line-piercing beam) don't exist in the current combat model (`stepUnits`/`fireTurret` only do single-target or flat N-nearest multi-target). This is a real code change to the hit-resolution loop, not just new content data — flagged here so the implementation plan sizes it correctly.
