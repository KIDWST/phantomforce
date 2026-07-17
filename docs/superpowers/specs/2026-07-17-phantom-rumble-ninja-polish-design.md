# Phantom Rumble — Ninja Chicken Polish — Design

## Problem

`app/games/phantom-rumble.html` currently has an **uncommitted, in-progress
working-tree diff** (verified via `git diff` in this worktree) that reworked
the arena from an open ring-out void into a walled "coop" (fences, no
ledge-grabbing, crack-on-slam KOs) and gave the fighters a chicken body
(comb, beak, wing, tail feathers) in place of the old plain blob shape. That
diff never added any ninja styling — the fighters just look like chickens,
which is the exact complaint: the game lost the "cute ninja chicken" bit
that made it distinct and charming. Separately, the mode list (Duel/
Versus/Rumble/Bot Brawl) is all same-device local play, the pickup pool has
only three kinds (heart/spark/bomb), and the setup/HUD/results UI hasn't
had a visual pass to match a more polished character.

This spec covers finishing that redesign properly, adding new pickups, a
GUI pass, and consolidating the mode list — including new networked modes,
which depend on the PhantomPlay Realtime Channel spec (built first).

This phase makes **no changes to core brawl physics or balance** — percent
scaling, knockback formulas, and the fence-crack KO mechanic from the
in-progress diff are kept exactly as they land. Scope here is art, pickups,
GUI, and mode wiring only.

## A. Visual redesign — full ninja gear

Extends `drawFighter()` in `app/games/phantom-rumble.html`, building on top
of the existing (uncommitted) chicken-body drawing rather than replacing
it. All additions are procedural canvas drawing — no image assets, per the
page's existing CSP (`img-src data:` only, no external sprites).

Added elements, in neutral ninja black/charcoal with each fighter's
existing `PALETTE` accent color (`EMBER`/`CIPHER`/`HEX`/`VOLT`) as a thin
trim/stripe — the squad reads as a unit while staying tell-apart-able
mid-combat:

- **Headband**: a band across the head, with two trailing cloth tails that
  flutter — reuse the existing `sway` sine calculation, amplified during
  dash/attack/dodge frames so it visibly whips during fast action.
- **Eye mask**: a dark band across the eyes, replacing the current bare
  dot-eye.
- **Wrapped wing-tips**: a couple of contrasting stripe lines at the wing
  edge, reading as taped ninja gloves.
- **Sash**: a thin diagonal or waist band across the body ellipse.
- **Back-scarf**: a small flowing strip behind the body, whipping out
  during dash/dodge/attack for extra juice (same sway/trail technique
  already used for the existing motion trail).

## B. New power-ups — ninja arsenal

Extends the existing pickup system (`spawnPickup()`, `grabPickups()`,
`tickBombs()`, `drawPickup()`) from 3 kinds to 6. Available in every brawl
mode (Solo 1v1, Local FFA, and the three networked modes below) — not in
Race to the Top, which has its own separate pickup set (see that spec).

- **Shuriken**: on pickup, arms the next light-attack press to throw a
  fast projectile in the fighter's current facing direction instead of a
  melee swing — same damage/knockback as a normal light hit, but at range.
  Single use (consumed on throw, or expires after a timeout if unused).
- **Smoke Bomb**: instant-use on pickup (not stored/armed) — a short
  blink-dash in the held/facing direction with a smoke particle burst and
  brief invulnerability. Longer range than the existing `dodge()`, on its
  own cooldown so it's a distinct tool rather than a dodge replacement.
- **Speed Scroll**: temporary buff on pickup (~6s) — mild boost to movement
  acceleration and a mild reduction to attack cooldown. Shows a small
  icon + shrinking ring on the fighter's HUD card for the duration so
  everyone can see who's buffed.

Same spawn pacing as today (~7-12s timer, max 3 pickups on the ground at
once), same floater-text/SFX pattern as the existing heart/spark/bomb
kinds.

## C. GUI overhaul

- **Mode-select menu** (`.overlay[data-setup] .modes`): restructured into
  two labeled groups instead of one flat row — "SOLO / LOCAL" and
  "ONLINE" — matching the consolidated mode list below.
- **Local FFA slot picker**: replaces the separate Versus/Rumble/Bot Brawl
  tiles with one tile that opens a small picker for human count (0-2, via
  the existing P1/P2 keyboard split) with the remaining of 4 slots filled
  by bots, plus the existing difficulty radio group.
- **Online tiles**: open the existing generic PhantomPlay "Together" room
  flow (create/join code, ready-check, host controls) already built in
  `phantomplay.js` — no new room-UI chrome needed in the game page itself,
  since that's shared platform UI. Phantom Rumble's job is declaring
  itself room-capable and handling `match-state`/`match-action` messages,
  riding the faster transport from the Realtime Channel spec underneath.
- **In-match HUD** (`.hud .fighter-card`): add a small row of active
  power-up icons (shuriken armed / speed-buff ring / etc.) next to the
  existing percent/stocks display.
- **Results screen** (`[data-end]`): visual polish only — winner's
  color/glow accenting the title, existing stat line (KOs / session
  record) restyled to match the sharper art, no functional changes.

## D. Mode consolidation

Final local + networked menu (5 tiles; Race to the Top is a 6th, added in
its own phase/spec, not part of this one):

1. **SOLO 1v1** — you vs. 1 bot, difficulty picker. (Was: Duel.)
2. **LOCAL FFA** — up to 4 slots on one device; 0-2 humans via keyboard
   split, bots fill the rest; difficulty picker. (Merges: Versus, Rumble,
   Bot Brawl — those three retire as separate tiles. "Bot Brawl" becomes
   "pick 1 human" in this picker; "Rumble" becomes "pick 2 humans.")
3. **NET 1v1** — 2 players via a PhantomPlay game room, no bots.
4. **NET 2v2** — 4 players via a game room, in 2 teams. **Design note:**
   hits still land on anyone (no friendly-fire immunity added to the
   physics — that's a deliberate scope call, not an oversight, to avoid
   touching brawl combat rules in this phase); the win condition becomes
   "last team standing" instead of "last fighter standing," with team
   pairing shown via matched HUD border accents.
5. **NET FFA** — 4 players via a game room, standard free-for-all rules
   (identical to today's Rumble mode, just cross-device).

Networked modes 3-5 depend on the PhantomPlay Realtime Channel spec being
built first — without it they'd work but feel laggy (up to ~3.5s action
round-trip on the old polling transport), which isn't an acceptable
networked-fighter experience.

## Non-goals

- No core physics/balance changes (percent scaling, knockback, fence-crack
  KO thresholds all untouched).
- No in-game currency, cosmetic unlocks, or persistent progression beyond
  the existing per-session stats.
- No voice/chat.
- No changes to the Race to the Top mode (separate spec, separate phase).
