# PhantomPlay Gamepad Support

## Goal

Add controller support (DualShock/DualSense/Xbox — anything the browser normalizes
to the W3C "standard" Gamepad layout) to PhantomPlay, PhantomForce's mini-games
platform. 20 of the 30 registered games get real gamepad input; 10 are excluded
because they have no natural button mapping (dense grid/number-click puzzles,
free-form typing).

## Why this architecture

Three approaches were considered:

- **Host relays live gamepad state into every iframe via postMessage.** Rejected:
  adds per-frame message-passing latency to fast games (Grand Prix, BeatStrike),
  and doesn't reduce code since each game still has to interpret raw axes/buttons.
- **Widen the iframe's permission grant, let each game poll the hardware directly
  (chosen).** One host-side change (`allow="fullscreen; gamepad"`), zero latency,
  matches how every game already reads keyboard input locally.
- **Share a real JS module across games via `<script src>`.** Rejected: every
  game's CSP is `default-src 'none'`, which blocks external script includes
  outright. Loosening that breaks the deliberate "each game is a fully sandboxed
  standalone document" security model. The codebase already inlines small shared
  helpers per game instead of sharing files (e.g. `ObjectPool` is duplicated
  verbatim in both `beat-strike/game.js` and `phantom-grand-prix/game.js`) — this
  follows that existing convention rather than fighting it.

## Platform layer (`app/js/phantomplay.js`)

### 1. Iframe permission grant

```html
<iframe ... allow="fullscreen; gamepad" ...>
```

One-attribute change. Without this, `navigator.getGamepads()` inside any game
iframe returns nothing — the Permissions-Policy for `gamepad` defaults to
`'self'`, and a `sandbox="allow-scripts"` iframe (no `allow-same-origin`) never
satisfies `'self'` on its own. This is a hard prerequisite for everything below.

### 2. Detection + opt-in prompt

The host page (not sandboxed, same-origin) listens globally for
`gamepadconnected`. On the **first-ever** connection (checked via
`localStorage['pf.phantomplay.gamepadPromptSeen']`), show a small non-blocking
toast:

> 🎮 Controller detected — enable it for PhantomPlay?  **[Enable]** **[Not now]**

The choice is stored in `localStorage['pf.phantomplay.gamepad']` (`"1"`/`"0"`).
The prompt does not reappear once seen.

### 3. Persistent toggle

A small 🎮 button is added to the player header (`.pp-player-actions`, alongside
Restart/Pause/Fullscreen) whenever a gamepad has ever been detected in this
browser. Click toggles the stored preference and immediately re-sends `settings`
to the currently mounted game (if any).

### 4. Protocol extension

The existing `settings` message (already carries `sound`, `reducedMotion`,
`engine`) gains one field:

```js
postToGame("settings", { sound, reducedMotion, gamepad: gamepadEnabled, engine });
```

Sent on every `ready` handshake (as today) and re-sent whenever the header
toggle flips mid-play. Games that don't understand `gamepad` simply ignore the
extra field — no protocol version bump needed.

## Standard mapping convention

Every opted-in game inlines the same small polling snippet (~40–60 lines,
copy-once per file, following the `ObjectPool` precedent) built on the W3C
Standard Gamepad layout, which DualSense/DualShock/Xbox controllers all
normalize to identically via the browser:

| Input | Standard index | Default role |
|---|---|---|
| Left stick / D-pad | axes[0..1], buttons[12-15] | Movement / steer |
| A / Cross | buttons[0] | Primary action (jump/select/interact) |
| B / Circle | buttons[1] | Secondary / cancel / back |
| X / Square | buttons[2] | Item / special |
| Y / Triangle | buttons[3] | Alt action |
| LB/RB, LT/RT | buttons[4-7] | Drift / brake / boost (game-specific) |
| Start | buttons[9] | Pause |

The snippet exposes `gp.axisX()/axisY()`, `gp.pressed(name)`,
`gp.justPressed(name)`, gated on `hostSettings.gamepad === true` **and** a live
`navigator.getGamepads()` entry actually being present — so it's always a safe
no-op when the preference is off or nothing is plugged in. Games wire its output
into the exact same internal input variables their keyboard handlers already
set (e.g. Phantom Dash's `jump()`, Grand Prix's `kart.inputSteer`), so gamepad
and keyboard/pointer coexist rather than compete, same as keyboard+pointer do
today.

## Game tiers

### Tier 1 — trivial (any face button = the existing single action)

Phantom Dash, Focus Stack, Court Vision, Breath Pacer, Pixel Bloom, Penalty
Kick. Near-zero risk: these already trigger their one action off a single key
(Space/click); gamepad wiring is `gp.justPressed('A') || keyIsDown(...)`.

### Tier 2 — natural fit (stick/d-pad + face buttons map 1:1 onto existing controls)

Phantom Grand Prix, Phantom Rumble, Rift Frenzy, Neon Drift, Circuit Serpent,
Serpent Surge, Neon Breaker, CubeTown, Tidefront Tactics, Kingdom Breakers,
Skyguard Arena.

**Local multiplayer assignment** (Rumble, Rift Frenzy, Grand Prix 2P): the
first connected gamepad takes over **P1's** slot, replacing keyboard input for
that player only; other player slots keep their existing keyboard clusters
(P2 Arrows, P3 IJKL, P4 TFGH, etc.) until/unless additional gamepads connect,
at which point they fill P2, then P3, then P4 in connection order. This lets
two people play on one keyboard-less setup, or mix keyboard + controller
players, without any UI for manual reassignment in this pass.

### Tier 3 — needs a real remap (keyset too large for a controller)

- **Color Rush** (already 4-lane A/S/D/F) and **Keyboardist On Tour** (already
  4-lane D/F/J/K): trivial 1:1 swap onto the four face buttons. No beatmap/logic
  changes needed.
- **BeatStrike**: currently spans the full 26-letter alphabet. Add a **separate
  8-lane beatmap generator** (mirroring `generateBeatmap`) mapped to
  A/B/X/Y + D-pad Up/Down/Left/Right, used only when gamepad mode is active;
  falling notes render as button glyphs instead of letters in that mode.
  Keyboard players keep the untouched 26-letter version. Chosen over filtering
  the existing beatmap down to 8 letters because a generator tuned for 8 lanes
  plays better than a 26-letter map with 18 lanes silently skipped.

### Excluded (no natural mapping, left keyboard/pointer-only)

Reflex Grid, Signal Match, Echo Sequence, Logic Lights, Tile Flow, Signal
Sweeper, Sudoku Signal, Tower Tactics (dense grid/number-click puzzles), Word
Weld, Type Storm (free-form typing).

## Testing / verification

Same method already validated for the Grand Prix/BeatStrike/Phantom Dash host-
protocol fixes: a standalone HTML harness embeds each game in a real
`sandbox="allow-scripts"` iframe with `allow="fullscreen; gamepad"`. Since no
physical controller can be attached to a headless/automated session, input is
simulated by overriding `navigator.getGamepads` inside the iframe (via an
injected `eval` script, same technique used to unit-test the Gamepad API
upstream) to return a fake connected-gamepad object with controllable
`axes`/`buttons` values, then asserting the game reacts correctly. Real
hardware (the DualSense already in hand) does a final manual pass per tier
before calling it done — automated stubbing covers breadth, a human confirms
feel.

## Rollout ordering (informs the implementation plan, not part of this spec's scope)

Platform layer (iframe permission, detection/prompt, toggle, protocol
extension) must land and be verified first — every game integration depends on
it. After that, tiers can proceed in parallel batches (Tier 1 batch, Tier 2
batch, Tier 3 batch) since games are independent files with no shared state.
