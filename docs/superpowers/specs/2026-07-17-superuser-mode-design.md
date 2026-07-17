# Superuser Mode — Design

Status: approved, implementing.

## Goal

Termina's basic wall (`/`) is deliberately simple: a handful of terminals,
2/3/4 columns, launch clean each session. That's the right default. But for
heavy sessions — many terminals running at once, needing to be found,
grouped, and acted on fast — the user wants a second, unapologetically
denser and more capable view built into the same program: **Superuser
mode**. No feature ceiling was requested; this spec is deliberately
maximalist rather than MVP-trimmed, per explicit direction ("do what I say,
I don't care how long it takes"). Build order (below, "Build sequencing")
is about dependency ordering only, never about cutting scope.

The concrete trigger for this spec: while investigating an unrelated bug,
we discovered that restarting Termina orphans every running terminal —
losing 4 live Claude Code sessions was one reload away from happening for
real. Fixing that (session reconnect) is bundled into this spec because
it's foundational to Superuser mode ever being trustworthy at high
terminal counts, and because it's a correctness fix that shouldn't be
gated behind a mode toggle.

Explicitly in scope: mode toggle, session reconnect (global), dense
auto-grid layout (up to ~10 tiles), number-key quick-jump, saved terminal
templates, bulk selection/actions, a live status strip, a command
palette, hover-to-focus terminals (global, on by default, toggleable),
and a Settings panel (replacing Connections) that houses that toggle.
Explicitly out of scope for this pass: freeform resizable/tiling
panes (a full layout engine — flagged during design as a much bigger build
than auto-grid, deferred), multi-window/multi-monitor support (a second
Electron `BrowserWindow` — deferred, current shape is "separate page, same
window"), and cross-machine template sync (templates are local
`localStorage`, matching how workspace/columns already persist).

## Architecture

### New page, same engine

Superuser is a new static page — `public/superuser.html` +
`public/superuser.js` + `public/superuser.css` — served by the existing
`serveStatic()` handler in `server.js` (no backend routing changes; it's
just another file in `public/`, gets the same `__TERMINA_TOKEN__`
substitution as `index.html`).

Both `/` and `/superuser.html` are thin views over the **same** engine:
same `TOKEN`, same `/api/*` endpoints, same WebSocket protocol, same
`sessions` Map in `server.js`. Switching modes is a same-origin
navigation:

- Basic mode's toolbar gets a `⚡ Superuser` button →
  `window.location.href = "/superuser.html?token=" + TOKEN`.
- Superuser's toolbar gets a `Basic Mode` button → back to `/`.

Because the session pool lives server-side and neither page owns it, a
terminal opened in one mode is immediately visible/reconnectable in the
other — flipping modes never duplicates or drops a running terminal.

### Shared reconnect module

Reconnect-on-boot (next section) is real product logic, not boilerplate,
so it lives once — a new `public/session-restore.js`, loaded by both
`app.js` and `superuser.js` — instead of being copy-pasted into two boot
sequences that will inevitably drift.

```js
// public/session-restore.js
export async function restoreSessions({ api, cards, addCard, attachExisting }) {
  const res = await api("/api/profiles");
  const data = await res.json();
  if (!data.ok) return [];
  const saved = loadWorkspace(); // existing localStorage read
  const restored = [];
  for (const s of data.sessions) {
    const savedCard = saved?.cards?.find((c) => c.sessionId === s.id);
    const card = addCard(
      { profileId: s.profile, name: savedCard?.name ?? "", color: savedCard?.color ?? null },
      { save: false },
    );
    attachExisting(card, s.id); // reattach WS with ?session=<id> instead of calling /start
    restored.push(card);
  }
  return restored;
}
```

`attachExisting` reuses the existing WebSocket-open + xterm-wire code path
already used after `/api/sessions/:id/start` today, just skipping the
`/start` POST and opening the socket with `?session=<id>` directly —
`attachSocket()` server-side already replays `session.buffer` (scrollback)
and `session.lastDetected` (status) on connect, so this is a client-side
gap only, nothing new needed in `server.js` for the reconnect mechanism
itself.

### Session identity

Today a card's `sessionId` is a client-generated uid, sent to `/start`,
and the server keys `sessions` by whatever id it's given — so session ids
are already stable, server-owned-once-created identifiers suitable for
reconnect matching. No change needed there.

## Components

### 1. Session reconnect (global — both `/` and `/superuser.html`)

- `boot()` in `app.js` and its equivalent in `superuser.js` both call
  `restoreSessions()` before falling back to "start clean." If
  `data.sessions` is non-empty, those become the initial cards instead of
  an empty wall.
- Naming/color recovery: cross-reference `data.sessions` against the
  browser's own `loadWorkspace()` by `sessionId` first (recovers name,
  color, column position for sessions this browser profile already knew
  about); sessions live but absent from local workspace (e.g. opened from
  a different window, or localStorage was cleared) fall back to the
  profile's label and the next color in the cycle.
- A session that ended between the `/api/profiles` call and the WebSocket
  attach attempt (race, however small) renders the tile in the existing
  "session ended" placeholder state rather than hanging — `attachSocket`
  already sends `{type:"error", data:"no_live_session"}` in that case,
  which the client already has a handler path for (dead-session tiles
  exist today, just needs to be reachable from this new path too).

### 2. Mode toggle

- `⚡ Superuser` / `Basic Mode` buttons as described above. Plain
  navigation, not a JS state flag — keeps the two UIs fully isolated in
  separate files, so Superuser can be as different and dense as it needs
  to be with zero risk to basic mode's simplicity.

### 3. Auto-grid layout

- Given N live tiles, compute `cols = ceil(sqrt(N * 1.6))` (wide bias, since
  terminal text reads left-to-right) and `rows = ceil(N / cols)`,
  recomputed on add/remove/window-resize (resize debounced ~150ms).
- Each tile supports a **compact** chrome variant — reusing the existing
  `.collapsed` treatment from `app.js` (header shrinks to icon + status
  pill only) — auto-suggested once tile count passes a legibility
  threshold (~8 at the current default window size), with a per-tile
  override and a global "Compact all" toolbar toggle.
- No hard cap at 10 — "within graphical reason" is enforced by the
  legibility-driven auto-compact, not an artificial ceiling on count.

### 4. Number-key quick-jump

- Tiles are numbered 1-9, 0 (=10th) in creation order; a small corner
  badge shows each tile's number.
- A capture-phase `keydown` listener (same pattern as the existing Ctrl+N
  and Ctrl+A handlers) maps bare `1`-`0` keypresses (no modifier, and only
  when no terminal/input has focus — checked via `document.activeElement`)
  to expanding that tile via the existing `expandCard()` overlay path.
  Beyond the 10th tile, quick-jump is unavailable (matches the compact
  grid's own practical ceiling) — command palette (below) covers jumping
  to any tile by name/number regardless of count.

### 5. Saved templates

- A "Templates" panel: name a set of `{profileId, count}` entries (e.g.
  "My Usual 6" = 2×claude, 1×codex, 1×pwsh, 2×shell) and launch the whole
  group in one action, reusing the existing multi-add path
  (`addCard` + `startTerminal`) already used by the new-terminal popover's
  "how many" field.
- Persisted in `localStorage` under a new key (`termina.templates`),
  mirroring how `columns`/workspace already persist — no server-side
  storage needed, consistent with today's local-only, no-accounts model.

### 6. Bulk selection + actions

- A selection mode (checkbox per tile, or shift-click range select — details
  finalized during implementation) distinct from Link mode's own
  click-to-link gesture, so the two don't collide.
- Actions on the selection: Close Selected, Restart Selected, Link
  Selected (folds selected tiles into Link mode's linked set), Compact
  Selected.

### 7. Mission-control status strip

- A thin bar pinned under the Superuser toolbar, built directly from the
  existing `STATUS_META` states (`thinking`, `running`, `complete`,
  `waiting`, `needs_approval`, `failed`) and each card's
  `card.status.state` — no new classification logic, purely an aggregate
  view of data every tile already computes today.
- Format: `⚡ Running ×3   👤 Needs Approval ×1   ✓ Complete ×2   ...`
  Clicking a count cycles focus (via `expandCard()`) through tiles
  currently in that state.

### 8. Command palette (Ctrl+K)

- `Ctrl+K` (confirmed free — a prior commit moved the old palette shortcut
  off Ctrl+K onto Ctrl+N) opens a fuzzy-search action list: jump to any
  tile by name/number, run a bulk action, launch a saved template, toggle
  compact/global states, toggle Link mode. This is the "a bit smarter"
  piece — one keyboard-driven entry point for every power action instead
  of hunting toolbar buttons once the wall is dense.
- Same capture-phase keydown pattern as existing shortcuts; closes on
  Escape (already a global handler, extended to also close the palette).

### 9. Hover-to-focus terminals

- Today, typing into a tile requires clicking it first to give the
  underlying xterm instance DOM focus. That's actively risky when a
  terminal is sitting at an interactive prompt (a CLI menu, a y/n
  confirmation) — the click needed just to "select the tab" can land on
  and trigger the prompt itself.
- Fix: whenever the mouse is over a tile's terminal area, that tile's
  xterm instance gets focus automatically (`term.focus()` on
  `mouseenter`), same as classic "focus follows mouse" window managers.
  Keyboard input goes wherever the cursor physically is, with no click
  required — so moving the mouse to read a different pane doesn't require
  a click that could hit something live.
- This is a genuine behavior change to something that works today, so it
  ships as a **setting, on by default**: "Hover to focus terminals" in the
  new Settings panel (below). Turning it off restores today's
  click-to-focus behavior exactly. Applies in both Basic and Superuser
  mode — it's a safety fix, not a power-user-only feature — implemented
  once in the shared module described below and consumed by both
  `app.js` and `superuser.js`.
- Interaction with existing click handlers: the current
  "click anywhere on a collapsed card to re-expand it" and tile-menu
  button clicks are unaffected — hover-focus only changes *keyboard*
  routing (`term.focus()`), it doesn't intercept or suppress clicks.

### 10. Settings panel (replaces Connections)

- The existing `🔌 Connections` toolbar button + `#connections-modal`
  become `⚙ Settings` — a panel with two sections: **Connections** (today's
  per-provider API key UI, unchanged, just relocated) and **Terminal
  behavior** (new: the "Hover to focus terminals" toggle from above, plus
  a home for any future app-wide preference instead of one-off toggles
  scattered across toolbars).
- Settings persist in `localStorage` under a new `termina.settings` key
  (same persistence pattern as `termina.templates`/workspace), read once
  at boot by the shared hover-focus module so both pages agree on the
  current value without a page reload.
- Superuser mode gets its own `⚙ Settings` button opening the identical
  panel (shared markup/logic, not a second implementation) — one settings
  surface, reachable from either mode, since it governs behavior in both.

## Data flow

```
server.js
  sessions: Map<id, {proc, buffer, lastDetected, sockets, ...}>   <- single source of truth
      ^                              ^
      | /api/profiles (list)        | WS ?session=<id> (attach/reattach)
      |                              |
   public/index.html            public/superuser.html
   (app.js)                     (superuser.js)
      \______________  ______________/
                     \/
        public/session-restore.js  (shared boot-time reconnect)
```

Neither page holds authoritative state — reloading, restarting, or
switching modes always re-derives the current card set from
`/api/profiles` + reconnecting sockets, never from something cached
client-side that could drift from reality.

## Error handling

- Engine unreachable (`/api/profiles` fails): same "engine offline"
  tagline treatment both pages already use today.
- Reconnect race (session dies between list and attach): "session ended"
  placeholder tile, not a hang or silent drop.
- Template launch where a profile no longer exists (e.g. profile removed
  since the template was saved): skip that entry, launch the rest, surface
  a small inline notice — never block the whole template on one stale
  entry.

## Testing

All manual (no existing automated UI test harness for this app; matches
how columns/link/etc. were verified in the prior fix):

1. Reload `/` mid-session with several live terminals (including a real
   `claude` session) → confirm every terminal reappears with correct
   scrollback and status, reattached to its still-running process (not a
   fresh one).
2. Flip Basic → Superuser → Basic repeatedly with live sessions open →
   confirm no duplicate PTYs spawn and no session is dropped.
3. Fill Superuser to 10 tiles at the real window size (~1097px, current
   actual usage) → confirm auto-grid + auto-compact stays legible, not
   just "technically fits."
4. Number-key jump, command palette jump, and status-strip click-to-jump
   all land on the correct tile.
5. Save a template, relaunch Termina fully (engine restart, not just page
   reload), launch the template → confirms templates survive real restarts
   since they're localStorage-backed, independent of session state.
6. Hover the mouse over a tile without clicking, type — input lands in
   that tile. Move to another tile, type again — input follows. Turn the
   setting off in Settings → same actions now require a click, matching
   today's behavior exactly.
7. Rename sanity check: existing Connections functionality (save/view/
   remove a provider key) still works identically from inside the new
   Settings panel.

All of the above gets exercised against a disposable second engine
instance (`TERMINA_PORT` override), never the user's live, in-use
instance — see "Verification strategy" below.

## Verification strategy (do not touch the live instance)

The user has real, live terminal sessions running in production Termina
right now (confirmed: 4 active `claude` sessions under the running
`server.js`). None of this work is verified against that instance until
the user explicitly chooses to restart it. Instead:

- Run a second `server.js` on a scratch port (`TERMINA_PORT=7421`) for
  all iterative testing — a fully independent engine and `sessions` Map,
  zero shared state with the live instance on 7420.
- Drive it with `agent-browser` (plain Chrome tab against
  `http://127.0.0.1:7421/`), the same approach already used to find and
  verify the column-breakpoint bug.
- Only once every item in Testing above passes against the scratch
  instance do we tell the user it's safe to restart their real instance
  (at which point session reconnect — item 1 in Build sequencing — is
  exactly what makes that restart safe for their 4 live sessions).

## Build sequencing

Dependency order only — no scope is cut, everything above ships:

1. Session reconnect (`session-restore.js` + server-side is already
   ready) — this is the correctness fix and everything else depends on
   trusting that switching/reloading is safe.
2. Superuser page scaffold + mode toggle + auto-grid — the container
   everything else lives in.
3. Number-key jump, status strip, compact mode — read-only/low-risk
   layers on top of the grid.
4. Bulk select/actions, templates, command palette — the remaining power
   features, in whatever order implementation finds most natural given
   what's already wired up by step 3.
5. Hover-to-focus + Settings panel (Connections rename) — independent of
   1-4, can land in parallel; sequenced last only because it touches
   existing, currently-working Connections code and benefits from the
   rest of the surface (toolbar layout, shared modules) already settling
   first.
