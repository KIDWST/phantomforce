# VesperGate — The Presence System (eerie/dread pass)

## Context

VesperGate (`app/games/vespergate/`) is PhantomForce's top-down gothic
action-adventure: Duskhollow village, an open vale, two dungeons (the
Hollow Geometry, the Glass Ossuary), six quests, relics, and a boss fight
against Bellmother. It just shipped boss-phase FX (hit-stop, camera jolt,
shockwaves, mirror-ghost reflections, room mood lighting — `effects.js`,
`91361ae5`). The core loop (combat, portals/gates, quests, dialogue,
inventory) works and is not being rebuilt here.

Product decision: VesperGate becomes PhantomPlay's dedicated eerie/dread
game, deliberately contrasted with CubeTown's upbeat "do it all" identity.
Reference feel: **Majora's Mask** — not jump-scare horror, but a
persistent sense of wrongness and "you are not alone" that some kids and
teens will find too unsettling to keep playing, even though the game is
small in scope. Rating stays PG: no gore, no real threat added by this
system, no content-descriptor bump. The bar is atmosphere and dread as a
*system*, not a string of scripted scares.

## Goals

- A hidden, persistent unease that compounds over a playthrough rather
  than resetting per-room or per-encounter.
- NPCs, audio, visuals, and the HUD all react to the same underlying
  state, so the wrongness reads as one coherent world, not four
  disconnected feature adds.
- Never resolves into an actual threat: nothing in this system can kill
  the player, chase the player, or gate progress. It is pure atmosphere
  layered on the existing, unchanged combat/quest/portal systems.

## Non-goals

- No jump scares (sudden loud stings, "gotcha" pop-ins).
- No gore, no violence beyond what already exists, no content-rating
  change — stays PG / `contentRating: "teen"`.
- No new fail-state, no new enemy, no damage or death tied to dread.
- Does not touch CubeTown or any other PhantomPlay game.
- Does not rebuild combat, portals, quests, or dialogue plumbing — this
  layers on top of `game.js`/`world.js`/`rooms.js` as they exist today.
- The dread value is never shown to the player as a number, bar, or icon.
  The only feedback is the world reacting to it.

## Core mechanic — the Presence system

New module `app/games/vespergate/dread.js`, namespaced `VG.dread`,
architecturally mirroring `effects.js` (`VG.fx`): a `tick(dt)` called
from `simulate()` alongside the existing `VG.fx.tick(dt)` call
(`game.js:640`), plus hooks other systems call into.

```
VG.dread = {
  tick(dt),                    // advance decay/rise, tier transitions
  value(),                     // 0..1, internal only — never rendered as UI
  tier(),                      // 0 (calm) | 1 | 2 | 3 (max)
  notifyRoomEnter(roomId, tags), // called on room transition
  notifyStill(dt),             // called each frame player velocity ~0
  notifyBacktrack(roomId),     // called when entering an already-cleared room
  notifyQuestProgress(),       // pulls dread down
  notifyWarmth(),              // near hearth/village bell — pulls dread down
}
```

**Rise:** standing still >6s, being in a room tagged `watched` (new
per-room tag in `rooms.js`/`world.js` room defs — start with a handful
of dungeon rooms and a couple of empty village-at-night spots), and
backtracking into a cleared room, each add a small delta on a slow
ramp (dread should take real playtime to escalate — minutes, not
seconds).

**Fall:** completing quest steps, standing near lit hearths or the
village bell, and simply time spent in "safe" tagged rooms (the shop,
Maren's house) pull dread back down. Net effect: dread rises during
exploration/dungeon time and eases in the village hub, so returning
home always feels like relief — reinforcing rather than fighting the
existing quest loop.

**Tiers (0.3 / 0.6 / 0.85 thresholds):** each tier gates which effects
below are eligible to trigger. Tier 3 effects are rare even once
unlocked — roll-gated, not constant, so they stay unsettling instead of
numbing.

## Pillar 1 — NPCs feel wrong

- NPC portraits (`drawNpc`, `game.js:1047`) get a flat, unblinking
  "mask" rendering: pale ellipse, two dark eye-slits, no mouth
  animation. Reuse the desync-jitter technique already implemented in
  `drawMirrorGhosts` (`game.js:871`) for a subtle, barely-perceptible
  positional jitter on idle NPCs.
- Gaze tracking: NPC eye offset subtly tracks the player's position even
  while the NPC is otherwise idle (small trig calc added to `drawNpc`).
- Dialogue wrongness: each NPC gains an optional `flatLines` pool in its
  data def (`rooms.js`/wherever NPC dialogue is authored today). At
  tier ≥2, dialogue selection has a small chance to substitute a flat,
  context-blind line (e.g. a line that doesn't track quest state) in
  place of the correct one — then never repeats it on the very next
  visit, so it reads as a glitch, not a bug.

## Pillar 2 — Audio dread

Built on the existing WebAudio synth (`VG.audio`, `VG.sfx*` in
`engine.js:180-260`):

- A layered detuned drone bed (2-3 oscillators, slow LFO detune),
  gain tied to `VG.dread.tier()`, fading in/out over several seconds —
  never a hard cut on the way in.
- Silence-cut: on a tier-up transition, ambient gain briefly ducks
  (150-250ms) before resuming louder — a "held breath" cue.
- Rare non-diegetic footstep/breath one-shots (short filtered-noise
  synth, same primitives as `VG.sfxCinder`) that can fire when the
  player is still and tier ≥2 — low probability per second, so it's
  memorable rather than a loop.

## Pillar 3 — Visual + UI overhaul

- `effects.js`'s darkness/lighting engine (`VG.fx`) gains a subliminal
  flash primitive: a silhouette rendered for a single frame (a figure
  in a doorway, a shape at a window) then gone — reuses the existing
  render-once-per-frame architecture, gated to tier 3 and low
  probability.
- Slow vignette intensity / very subtle chromatic drift tied to tier,
  layered into the existing `moodColorAlpha` overlay pass.
- `drawMirrorGhosts` reflections extend to more surfaces (windows,
  Glass Ossuary water) and desync harder (a full beat behind, or facing
  the wrong way) as tier rises.
- HUD rebuild (`drawHUD`, `game.js:1207`): hearts (`drawHeart`,
  `game.js:1201`) become guttering candle flames that visibly gutter
  harder as dread rises and relight with visible weight when healed.
  Flat `strokeRect`/`fillRect` panels become torn-parchment/bone-carved
  edges via a jittered path helper instead of clean rectangles. At
  tier 3, the quest-tracker text has a small chance to misrender one
  glyph for a single frame.
- Hard constraint carried from non-goals: none of this may reduce HUD
  legibility. HP, quest tracker, and boss bar stay readable at all
  times — dread is reinforcement, never obfuscation of real
  information.

## Pillar 4 — World that moves without you

- Per-room "wrongness" diffs on revisit: a small, deterministic set of
  possible diffs per room (door now closed that was open, a candle
  snuffed, a chair overturned), applied via `state.flags` the same way
  existing one-time pickups/flags work (`game.js:599`, `786`). Rolls
  once per room on backtrack, persists for the rest of the session.
- "Don't look back" beat: in a small set of corridor/room contexts,
  moving away from a spot can trigger a footstep/whisper cue behind the
  player; turning back shows nothing. Pure audio/timing trigger, no
  new entity, no damage, no fail-state — explicitly not a stealth or
  chase mechanic.

## Technical integration summary

| File | Change |
|---|---|
| `dread.js` (new) | `VG.dread` module: state, tiers, hooks, ticked from `simulate()`. |
| `engine.js` | Extend `VG.audio` with drone-bed + silence-cut + breath one-shot primitives. |
| `effects.js` | Add subliminal single-frame flash primitive to `VG.fx`. |
| `game.js` | `drawNpc` mask/gaze rendering, dialogue `flatLines` selection, `drawHUD`/`drawHeart` candle+parchment rebuild, `drawMirrorGhosts` surface expansion, `simulate()` wiring for `VG.dread.tick`/`notifyStill`/`notifyRoomEnter`/`notifyBacktrack`/`notifyQuestProgress`/`notifyWarmth`. |
| `rooms.js` / `world.js` | Per-room `watched`/`safe` tags; wrongness-diff pool per applicable room; NPC `flatLines` data. |
| `index.html` | Add `<script src="./dread.js?v=...">`, bump version query strings on changed files per existing convention. |

## Testing / verification

- No automated test harness currently covers VesperGate beyond the
  world-verification suite mentioned in commit `01472d3b`
  ("+world verification suite") — check `scripts/test-vespergate-world.mjs`
  and extend it if it covers room/world data shape, since `rooms.js`/
  `world.js` gain new tag/diff data.
- Manual verification: play a full loop (village → dungeon → backtrack
  → village) and confirm dread rises during exploration, falls in the
  village, and that tier-3 effects are rare enough to still land as
  unsettling on a second playthrough rather than constant/numbing.
- Confirm HUD stays legible at every tier (screenshot at tier 0 and
  tier 3 side by side).
- Ship through this checkout's normal gate: `npm run ship:live-admin --
  --commit "..."` (per this repo's `CLAUDE.md`) — not a manual
  commit+push.
