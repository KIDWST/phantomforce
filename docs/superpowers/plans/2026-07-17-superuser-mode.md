# Superuser Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note for this run:** executed inline, by the same agent that
> wrote the spec and this plan, in the same session — full architectural
> context is already loaded. Task granularity below is therefore calibrated
> to "complete, reviewable chunk" rather than maximally atomized 2-5-minute
> steps; every step still contains real, complete code (no placeholders).

**Goal:** Ship Superuser mode — a denser, more capable second view of
Termina — plus the session-reconnect fix, hover-to-focus terminals, and
the Settings panel (replacing Connections), per
`docs/superpowers/specs/2026-07-17-superuser-mode-design.md`.

**Architecture:** Superuser is a new page (`public/superuser.html` +
`public/superuser.js` + `public/superuser.css`) that reuses **the exact
same terminal engine** as Basic mode by loading `app.js` unchanged and
keeping the same base toolbar/wall element IDs — this is the established
pattern already used by `mission.js`/`connections.js`/`timeline.js`, which
all layer extra UI on top of `app.js`'s globals (`cards`, `addCard`,
`openTerminal`, `setColumns`, ...) without any engine extraction. Session
reconnect, hover-focus, and Settings are additive changes shared by both
pages via two new small global-scope scripts (`session-restore.js`,
`settings.js`), loaded after `app.js` exactly like `mission.js` is today.

**Why not extract a shared "terminal engine" module first:** `app.js`'s
WebSocket/xterm/status-detection code is deeply load-bearing for the
user's 4 currently-live production Claude sessions, and is already
threaded through by `mission.js` (`window.onMissionActivity`), the token
tracker (`msg.type === "tokens"`), and Mission DVR. A clean extraction
touches all of that at once for no functional gain, since reuse-via-shared-
globals (the codebase's existing pattern) achieves the same goal — one
engine, two UIs — with a fraction of the blast radius. Superuser's own
denser grid/compact tiles/quick-jump/etc. are new code layered on top, not
a reimplementation of the engine.

**Tech Stack:** Vanilla JS (no build step, no framework — matches the rest
of `public/`), `xterm.js` + `addon-fit` (already vendored), Node `http`/`ws`
server (`server.js`, unchanged except one line for static-file token
substitution).

## Global Constraints

- No new npm dependencies — everything here is achievable with what's
  already in `public/` and `server.js`.
- Every new script is a plain global-scope `<script src="...">` file (no
  ES modules, no bundler) — matches every existing file in `public/`.
- `server.js`'s `sessions` Map remains the single source of truth; neither
  page may cache session state in a way that can drift from it.
- **Never test against the live instance (port 7420).** All verification
  in this plan runs a disposable second engine via `TERMINA_PORT=7421`
  and drives it with `agent-browser` against `http://127.0.0.1:7421/`.
  The live instance is only touched at the very end, by the user, once
  every task below is green on the scratch instance.
- Every new/changed keyboard shortcut uses the existing capture-phase
  `document.addEventListener("keydown", fn, true)` pattern (see Ctrl+N /
  Ctrl+A in `app.js`) so it works even while a terminal has focus.
- Status icon/label pairs always show icon **and** text (never color
  alone) — matches `STATUS_META` today.

---

## Task 1: Session reconnect (global — Basic mode first, Superuser reuses it)

**Files:**
- Create: `public/session-restore.js`
- Modify: `public/index.html:87-92` (script tag order)
- Modify: `public/app.js:855-872` (`boot()`)

**Interfaces:**
- Consumes (all already global in `app.js`, loaded before this script
  runs): `api(path, options)`, `addCard(init, opts)`, `openTerminal(card,
  sessionId)`, `loadWorkspace()`, `renderRuntime(card)`.
- Produces: `async function restoreSessions()` — global, returns the array
  of reconnected `card` objects (empty array if none or on any failure).
  Consumed by `app.js`'s `boot()` (this task) and by `superuser.js`'s boot
  path (Task 4).

- [ ] **Step 1: Write `public/session-restore.js`**

```js
/* session-restore.js — reconnects to still-running terminal sessions on
   boot instead of always starting clean, so a reload or app restart never
   orphans a live PTY. Shared by app.js (Basic mode) and superuser.js
   (Superuser mode); loaded after app.js so it can use its globals. */

async function restoreSessions() {
  let data;
  try {
    const res = await api("/api/profiles");
    data = await res.json();
  } catch {
    return [];
  }
  if (!data.ok || !Array.isArray(data.sessions)) return [];

  const saved = loadWorkspace();
  const restored = [];

  for (const s of data.sessions) {
    // Only reconnect sessions with a live process. "exited"/"error"
    // sessions linger in the server's map until explicitly stopped, but
    // there's nothing running to reattach to.
    if (s.status !== "running") continue;

    const savedCard = saved?.cards?.find((c) => c.sessionId === s.id);
    const card = addCard(
      {
        profileId: s.profileId,
        name: savedCard?.name ?? "",
        color: savedCard?.color ?? undefined,
      },
      { save: false },
    );
    card.startedAt = new Date(s.startedAt).getTime();
    renderRuntime(card);
    openTerminal(card, s.id);
    restored.push(card);
  }
  return restored;
}
```

- [ ] **Step 2: Load it in `index.html`, after `app.js`**

In `public/index.html`, change:

```html
    <script src="/vendor/xterm.js"></script>
    <script src="/vendor/addon-fit.js"></script>
    <script src="/app.js"></script>
    <script src="/timeline.js"></script>
    <script src="/mission.js"></script>
    <script src="/connections.js"></script>
```

to:

```html
    <script src="/vendor/xterm.js"></script>
    <script src="/vendor/addon-fit.js"></script>
    <script src="/app.js"></script>
    <script src="/session-restore.js"></script>
    <script src="/settings.js"></script>
    <script src="/timeline.js"></script>
    <script src="/mission.js"></script>
    <script src="/connections.js"></script>
```

(`settings.js` doesn't exist yet — created in Task 2 — but wiring the tag
now avoids a second `index.html` edit.)

- [ ] **Step 3: Call it from `boot()` in `app.js`**

In `public/app.js`, change:

```js
  // Launch clean — no terminals open, just the + tile. We remember your
  // column choice, but you open the terminals you want each session.
  const saved = loadWorkspace();
  setColumns(saved && saved.columns ? saved.columns : 3);
}
```

to:

```js
  // Reconnect to anything still running server-side (reload, app
  // restart) instead of always launching clean. Cards that were merely
  // *saved* but never started still don't come back — only live PTYs do.
  if (typeof restoreSessions === "function") await restoreSessions();

  const saved = loadWorkspace();
  setColumns(saved && saved.columns ? saved.columns : 3);
}
```

- [ ] **Step 4: Verify against the scratch instance**

```bash
cd /c/Users/jorda/Termina
TERMINA_PORT=7421 node server.js &
```

```bash
agent-browser open http://127.0.0.1:7421/
agent-browser snapshot -i
```

Add one terminal (any profile), let it start, then:

```bash
agent-browser eval "cards.length"          # expect 1
agent-browser reload
agent-browser eval "cards.length"          # expect 1 again (reconnected)
agent-browser eval "cards[0].sessionId"    # same id both times — confirm by comparing manually
```

Expected: after reload, the terminal tile reappears live (not empty),
same session id, with its prior scrollback visible (`term.buffer` has
content) and no duplicate process spawned server-side (check via
`Get-CimInstance Win32_Process` child-count under the `TERMINA_PORT=7421`
`node.exe` before/after reload — must be unchanged).

- [ ] **Step 5: Commit**

```bash
git add public/session-restore.js public/index.html public/app.js
git commit -m "Reconnect to live terminal sessions on boot instead of launching clean"
```

---

## Task 2: Settings module — hover-to-focus + Settings panel (replaces Connections)

**Files:**
- Create: `public/settings.js`
- Modify: `public/index.html` (rename Connections button/modal, add Terminal-behavior section)
- Modify: `public/app.js:326-334` (`buildCard`'s `screen` element)
- Modify: `public/styles.css` (small additions for the new section)

**Interfaces:**
- Produces: `TerminaSettings.get(key, fallback)`, `TerminaSettings.set(key, value)`
  (both global, `localStorage`-backed under key `termina.settings`);
  `hoverFocusEnabled()` — global, returns current boolean.
- Consumes: `escapeHtml` (from `app.js`, already global) for any dynamic text.

- [ ] **Step 1: Write `public/settings.js`**

```js
/* settings.js — shared app-wide preferences (localStorage-backed) plus
   the Settings panel UI (Connections section unchanged/relocated here,
   Terminal-behavior section new). Shared by app.js and superuser.js. */

const SETTINGS_KEY = "termina.settings";
const SETTINGS_DEFAULTS = { hoverFocus: true };

const TerminaSettings = {
  _read() {
    try {
      return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    } catch {
      return { ...SETTINGS_DEFAULTS };
    }
  },
  get(key) {
    return this._read()[key];
  },
  set(key, value) {
    const current = this._read();
    current[key] = value;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  },
};

function hoverFocusEnabled() {
  return TerminaSettings.get("hoverFocus") !== false;
}

function renderSettingsBehaviorSection() {
  const container = document.getElementById("settings-behavior");
  if (!container) return;
  container.innerHTML = `
    <label class="settings-toggle-row">
      <input type="checkbox" id="setting-hover-focus" ${hoverFocusEnabled() ? "checked" : ""} />
      <span>
        <b>Hover to focus terminals</b>
        <small>Moving the mouse over a terminal gives it keyboard focus automatically — no click
        needed. Off restores click-to-focus.</small>
      </span>
    </label>
  `;
  document.getElementById("setting-hover-focus").addEventListener("change", (e) => {
    TerminaSettings.set("hoverFocus", e.target.checked);
  });
}

document.getElementById("connections-btn").addEventListener("click", () => {
  document.getElementById("connections-modal").classList.remove("hidden");
  renderSettingsBehaviorSection();
  if (typeof renderConnections === "function") renderConnections();
});
```

Note: the click-to-open listener is intentionally redefined here (not
left in `connections.js`) so opening Settings always renders the new
Terminal-behavior section too. `connections.js`'s own `renderConnections`
function and its close/backdrop handlers are untouched — Step 2 below
just removes the now-duplicate open-listener from `connections.js`.

- [ ] **Step 2: Remove the now-duplicate listener from `connections.js`**

In `public/connections.js`, delete:

```js
document.getElementById("connections-btn").addEventListener("click", () => {
  document.getElementById("connections-modal").classList.remove("hidden");
  renderConnections();
});
```

(The close and backdrop-click listeners immediately below it are
untouched — Settings still closes the same way Connections did.)

- [ ] **Step 3: Rename the button and modal in `index.html`, add the Terminal-behavior section**

Change:

```html
        <button id="connections-btn" class="ghost" type="button" title="Connect your own API keys per provider">🔌 Connections</button>
```

to:

```html
        <button id="connections-btn" class="ghost" type="button" title="Settings — connections, terminal behavior">⚙ Settings</button>
```

Change:

```html
    <div id="connections-modal" class="overlay hidden" role="dialog" aria-modal="true" aria-label="Connections">
      <div class="overlay-panel mission-panel">
        <div class="overlay-head">
          <span>Connections</span>
          <button type="button" id="connections-close" class="ghost">Close</button>
        </div>
        <div id="connections-body" class="mission-body"></div>
      </div>
    </div>
```

to:

```html
    <div id="connections-modal" class="overlay hidden" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="overlay-panel mission-panel">
        <div class="overlay-head">
          <span>Settings</span>
          <button type="button" id="connections-close" class="ghost">Close</button>
        </div>
        <div class="settings-section">
          <h3>Terminal behavior</h3>
          <div id="settings-behavior"></div>
        </div>
        <div class="settings-section">
          <h3>Connections</h3>
          <div id="connections-body" class="mission-body"></div>
        </div>
      </div>
    </div>
```

(Element ids `connections-btn`/`connections-modal`/`connections-close`/
`connections-body` are kept as-is — only the visible label/title text and
structure change. Renaming the ids too would be pure churn across two
files for zero behavior change, and risks a missed reference.)

- [ ] **Step 4: Wire hover-focus into `buildCard` in `app.js`**

In `public/app.js`, change:

```js
  const screen = document.createElement("div");
  screen.className = "screen";
  const host = document.createElement("div");
  host.className = "term-host";
  host.id = `term-${card.uid}`;
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.innerHTML = `<p class="big">EMPTY</p><p>Pick a terminal type to open one here.</p>`;
  screen.append(host, placeholder);
```

to:

```js
  const screen = document.createElement("div");
  screen.className = "screen";
  const host = document.createElement("div");
  host.className = "term-host";
  host.id = `term-${card.uid}`;
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.innerHTML = `<p class="big">EMPTY</p><p>Pick a terminal type to open one here.</p>`;
  screen.append(host, placeholder);

  // Hover-to-focus: moving the mouse over a live terminal gives it
  // keyboard focus, so you never have to click into a pane that might be
  // mid-prompt (a stray click there could trigger the prompt itself).
  // Toggleable in Settings; defaults on. No-op on empty tiles (card.term
  // is null until a terminal is actually started).
  screen.addEventListener("mouseenter", () => {
    if (typeof hoverFocusEnabled === "function" && hoverFocusEnabled() && card.term) {
      card.term.focus();
    }
  });
```

- [ ] **Step 5: CSS for the new Settings sections**

Append to `public/styles.css` (near the existing `.mission-body`/modal
rules — exact insertion point doesn't matter, append at end of file is
fine and matches how prior features were added):

```css
/* ---- Settings panel -------------------------------------------------- */

.settings-section {
  margin-top: 18px;
}
.settings-section:first-of-type {
  margin-top: 0;
}
.settings-section h3 {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin: 0 0 10px;
}
.settings-toggle-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}
.settings-toggle-row input {
  margin-top: 3px;
}
.settings-toggle-row small {
  display: block;
  color: var(--muted);
  font-weight: 400;
  margin-top: 2px;
}
```

- [ ] **Step 6: Verify against the scratch instance**

```bash
agent-browser open http://127.0.0.1:7421/
agent-browser find text "⚙ Settings" click
agent-browser snapshot -i
```

Expected: modal titled "Settings" with a "Terminal behavior" section
(checkbox, checked by default) above a "Connections" section (unchanged
provider rows). Toggle the checkbox off, close, reopen — stays off
(persisted). Start a terminal, move the mouse over its tile without
clicking, type a character — confirm (via `agent-browser eval
"document.activeElement.tagName"` or by checking the xterm cursor/echoed
character) that the terminal received it. Toggle hover-focus off in
Settings, repeat — confirm typing without a click now does nothing until
the tile is clicked.

- [ ] **Step 7: Commit**

```bash
git add public/settings.js public/connections.js public/index.html public/app.js public/styles.css
git commit -m "Add Settings panel (replaces Connections) with hover-to-focus toggle"
```

---

## Task 3: Serve `superuser.html` with token substitution

**Files:**
- Modify: `server.js:521` (`serveStatic`)

**Interfaces:** none new — this is a one-line widening of an existing check.

- [ ] **Step 1: Update the token-substitution condition**

In `server.js`, change:

```js
  if (rel === "index.html") {
    import("node:fs/promises").then(async ({ readFile }) => {
      let html = await readFile(filePath, "utf8");
      html = html.replace("__TERMINA_TOKEN__", TOKEN);
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      res.end(html);
    });
    return;
  }
```

to:

```js
  if (rel === "index.html" || rel === "superuser.html") {
    import("node:fs/promises").then(async ({ readFile }) => {
      let html = await readFile(filePath, "utf8");
      html = html.replace("__TERMINA_TOKEN__", TOKEN);
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      res.end(html);
    });
    return;
  }
```

- [ ] **Step 2: Commit** (folded into Task 4's commit, since `superuser.html`
  doesn't exist until then and this change is untestable alone)

---

## Task 4: Superuser page scaffold + mode toggle

**Files:**
- Create: `public/superuser.html`
- Create: `public/superuser.css`
- Create: `public/superuser.js`
- Modify: `public/index.html` (add `⚡ Superuser` button)

**Interfaces:**
- `superuser.html` loads, in order: `vendor/xterm.js`, `vendor/addon-fit.js`,
  `app.js`, `session-restore.js`, `settings.js`, `superuser.js` — same
  base toolbar/wall element ids as `index.html` so `app.js` binds without
  modification (`wall`, `broadcast`, `broadcast-banner`, `rescan`,
  `new-term`, `new-menu*`, `overlay*`, `connections-btn`/`connections-modal`
  for Settings, `cols-switch` — kept but visually secondary to Superuser's
  own density controls).
- Produces (consumed by later tasks in this plan):
  `function applyAutoGrid()` — recomputes and applies grid layout for
  current `cards.length`. `function bootSuperuser()` — Superuser's
  boot sequence (mirrors `app.js`'s `boot()`, calls `restoreSessions()`).

- [ ] **Step 1: Create `public/superuser.html`**

Start from `public/index.html` and adapt: same `<head>` token bootstrap,
same modals (`new-menu`, `overlay`, `mission-modal`, `connections-modal`
→ now "Settings"), same script includes plus `superuser.js` at the end,
plus a `⚡ Basic Mode` toggle button and a status-strip container.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Termina — Superuser</title>
    <link rel="icon" href="/favicon.ico" />
    <link rel="stylesheet" href="/vendor/xterm.css" />
    <link rel="stylesheet" href="/styles.css" />
    <link rel="stylesheet" href="/superuser.css" />
    <script>
      window.TERMINA_TOKEN = "__TERMINA_TOKEN__";
    </script>
  </head>
  <body class="superuser">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">&gt;_</span>
        <div class="brand-text">
          <strong>TERMINA</strong>
          <span id="tagline">Superuser</span>
        </div>
      </div>
      <div class="controls">
        <button id="broadcast" class="ghost" type="button" aria-pressed="false" title="Link terminals so typing in one goes to all linked ones">⇄ Link</button>
        <div class="cols-switch" role="group" aria-label="Columns">
          <button type="button" data-cols="2">2</button>
          <button type="button" data-cols="3" class="active">3</button>
          <button type="button" data-cols="4">4</button>
        </div>
        <button id="su-compact-all" class="ghost" type="button" title="Toggle compact chrome on every tile">▦ Compact</button>
        <button id="su-templates-btn" class="ghost" type="button" title="Launch a saved group of terminals">▤ Templates</button>
        <button id="rescan" class="ghost" type="button" title="Rescan available terminal types">Re-scan</button>
        <button id="missions-btn" class="ghost" type="button" title="Mission Mode">Missions</button>
        <button id="connections-btn" class="ghost" type="button" title="Settings — connections, terminal behavior">⚙ Settings</button>
        <button id="mode-toggle" class="ghost" type="button" title="Back to Basic mode">Basic Mode</button>
        <button id="new-term" class="primary new-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="New terminal (Ctrl+N)" title="New terminal (Ctrl+N)">
          <span class="new-plus">+</span><span class="kbd">Ctrl N</span>
        </button>
      </div>
    </header>

    <div id="su-status-strip" class="su-status-strip"></div>

    <div id="broadcast-banner" class="broadcast-banner hidden">
      <span class="pulse"></span> Link on — <b>Shift-click</b> terminals to link them, or <b>Ctrl+A</b> to link them all. Typing in one linked terminal is sent to all linked terminals.
    </div>

    <div id="new-menu" class="popover hidden" role="dialog" aria-label="Add terminals">
      <div class="popover-row">
        <label for="new-menu-type">Type</label>
        <select id="new-menu-type"></select>
      </div>
      <div class="popover-row">
        <label for="new-menu-count">How many</label>
        <input id="new-menu-count" type="number" min="1" max="24" value="1" />
      </div>
      <button id="new-menu-add" class="primary" type="button">Add terminals</button>
    </div>

    <div id="su-templates-modal" class="overlay hidden" role="dialog" aria-modal="true" aria-label="Templates">
      <div class="overlay-panel mission-panel">
        <div class="overlay-head">
          <span>Templates</span>
          <button type="button" id="su-templates-close" class="ghost">Close</button>
        </div>
        <div id="su-templates-body" class="mission-body"></div>
      </div>
    </div>

    <main id="wall" class="wall cols-3"></main>

    <div id="overlay" class="overlay hidden" role="dialog" aria-modal="true" aria-label="Expanded terminal">
      <div class="overlay-panel">
        <div class="overlay-head">
          <span id="overlay-title">Terminal</span>
          <button type="button" id="overlay-close" class="ghost">Close</button>
        </div>
        <div id="overlay-term" class="overlay-term"></div>
      </div>
    </div>

    <div id="mission-modal" class="overlay hidden" role="dialog" aria-modal="true" aria-label="Mission Mode">
      <div class="overlay-panel mission-panel">
        <div class="overlay-head">
          <span id="mission-title">Missions</span>
          <button type="button" id="mission-close" class="ghost">Close</button>
        </div>
        <div id="mission-body" class="mission-body"></div>
      </div>
    </div>

    <div id="connections-modal" class="overlay hidden" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="overlay-panel mission-panel">
        <div class="overlay-head">
          <span>Settings</span>
          <button type="button" id="connections-close" class="ghost">Close</button>
        </div>
        <div class="settings-section">
          <h3>Terminal behavior</h3>
          <div id="settings-behavior"></div>
        </div>
        <div class="settings-section">
          <h3>Connections</h3>
          <div id="connections-body" class="mission-body"></div>
        </div>
      </div>
    </div>

    <div id="su-palette" class="su-palette hidden" role="dialog" aria-modal="true" aria-label="Command palette">
      <input id="su-palette-input" type="text" placeholder="Jump to a tile, run an action…" autocomplete="off" />
      <div id="su-palette-results"></div>
    </div>

    <script src="/vendor/xterm.js"></script>
    <script src="/vendor/addon-fit.js"></script>
    <script src="/app.js"></script>
    <script src="/session-restore.js"></script>
    <script src="/settings.js"></script>
    <script src="/timeline.js"></script>
    <script src="/mission.js"></script>
    <script src="/connections.js"></script>
    <script src="/superuser.js"></script>
  </body>
</html>
```

- [ ] **Step 2: `public/superuser.js` — boot override + mode-toggle wiring**

`app.js`'s own `boot();` call at its bottom still runs on this page too
(it's the same file) — that's fine and desired, since it does exactly the
right thing (`ensureAddCard`, `loadProfiles`, `restoreSessions`,
`setColumns`). `superuser.js` only needs to add what's genuinely new:

```js
/* superuser.js — the dense, power-user view. Loaded after app.js (whose
   boot() already runs the full engine boot sequence, including session
   reconnect via session-restore.js), settings.js, mission.js,
   connections.js. Everything here is additive on top of those globals:
   cards, addCard, buildCard, openTerminal, expandCard, setColumns,
   removeCard, restartCard, api, escapeHtml, TerminaSettings. */

document.getElementById("mode-toggle").addEventListener("click", () => {
  window.location.href = "/";
});
```

(Basic mode's own toggle button, added in Step 3 below, is the inverse
navigation.)

- [ ] **Step 3: `public/superuser.css` — placeholder for density work (Task 5 fills this in)**

```css
/* superuser.css — Superuser-mode-only visual density and chrome.
   Loaded after styles.css, so rules here only need to differ from base. */

body.superuser .topbar {
  background: color-mix(in srgb, var(--panel) 92%, var(--accent) 8%);
}
```

- [ ] **Step 4: Add the `⚡ Superuser` button to `index.html`**

Change:

```html
        <button id="connections-btn" class="ghost" type="button" title="Settings — connections, terminal behavior">⚙ Settings</button>
        <button id="new-term" class="primary new-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="New terminal (Ctrl+N)" title="New terminal (Ctrl+N)">
```

to:

```html
        <button id="connections-btn" class="ghost" type="button" title="Settings — connections, terminal behavior">⚙ Settings</button>
        <button id="mode-toggle" class="ghost" type="button" title="Switch to the dense, power-user view">⚡ Superuser</button>
        <button id="new-term" class="primary new-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="New terminal (Ctrl+N)" title="New terminal (Ctrl+N)">
```

- [ ] **Step 5: Wire Basic mode's toggle in `app.js`**

Append near the other toolbar listeners (after the `rescan`/`broadcast`/
`cols-switch` block):

```js
document.getElementById("mode-toggle")?.addEventListener("click", () => {
  window.location.href = "/superuser.html";
});
```

(`?.` guards this being a no-op on `superuser.html` itself, where a
different `mode-toggle` listener from `superuser.js` — Step 2 — is
already attached; both pages share the id, each page's own script attaches
its own single listener since they're never loaded together.)

- [ ] **Step 6: Verify against the scratch instance**

```bash
agent-browser open http://127.0.0.1:7421/
agent-browser find text "⚡ Superuser" click
agent-browser wait --url "**/superuser.html"
agent-browser snapshot -i
```

Expected: Superuser page loads, toolbar renders, `Basic Mode` button
present. Start a terminal here, click `Basic Mode`, confirm the same
terminal is visible back on `/` (shared session, via reconnect from
Task 1). Click `⚡ Superuser` again — same terminal still there, no
duplicate spawned.

- [ ] **Step 7: Commit**

```bash
git add public/superuser.html public/superuser.css public/superuser.js public/index.html public/app.js server.js
git commit -m "Add Superuser mode scaffold: new page, mode toggle, shared engine"
```

---

## Task 5: Auto-grid layout + compact density

**Files:**
- Modify: `public/superuser.js`
- Modify: `public/superuser.css`

**Interfaces:**
- Produces: `function applyAutoGrid()` (global) — reads `cards.length`,
  sets `#wall`'s inline `grid-template-columns`/`grid-template-rows` (via
  a CSS custom property, not a fixed `cols-N` class, since N now ranges
  freely rather than being one of 2/3/4). Called on every `addCard`/
  `removeCard` and on a debounced `resize` listener.
- Consumes: `cards` (global array from `app.js`).

- [ ] **Step 1: Grid math + apply function in `superuser.js`**

```js
// ---- auto grid ---------------------------------------------------------

function computeGrid(n) {
  if (n <= 0) return { cols: 1, rows: 1 };
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

function applyAutoGrid() {
  const wall = document.getElementById("wall");
  if (!wall) return;
  const n = cards.length || 1;
  const { cols } = computeGrid(n);
  wall.style.setProperty("--su-cols", cols);
  wall.classList.add("su-auto-grid");
  autoSuggestCompact(n);
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyAutoGrid, 150);
});
```

- [ ] **Step 2: Hook it into card add/remove without modifying `app.js`**

`app.js`'s `addCard`/`removeCard` don't currently emit an event, and this
plan avoids editing their bodies further (Task 1/2 already made two
surgical edits there — a third for a Superuser-only concern is worth
avoiding). Instead, poll on a short interval, which is simple, correct,
and cheap at this scale (never more than ~10-20 cards):

```js
let lastCardCount = -1;
setInterval(() => {
  if (cards.length !== lastCardCount) {
    lastCardCount = cards.length;
    applyAutoGrid();
  }
}, 300);
```

- [ ] **Step 3: Compact-chrome auto-suggest + manual toggles**

```js
// ---- compact chrome -----------------------------------------------------

const COMPACT_THRESHOLD = 8;

function autoSuggestCompact(n) {
  if (n < COMPACT_THRESHOLD) return;
  for (const card of cards) {
    if (!card.collapsed) setCollapsed(card, true);
  }
}

document.getElementById("su-compact-all").addEventListener("click", () => {
  const anyExpanded = cards.some((c) => !c.collapsed);
  for (const card of cards) setCollapsed(card, anyExpanded);
});
```

(`setCollapsed` is `app.js`'s existing per-tile compact toggle, reused
as-is — see spec section 3.)

- [ ] **Step 4: CSS — auto-grid + tighter compact chrome**

Append to `public/superuser.css`:

```css
#wall.su-auto-grid {
  grid-template-columns: repeat(var(--su-cols, 3), minmax(0, 1fr));
}

body.superuser .wall {
  gap: 8px;
  padding: 10px 14px 20px;
  grid-auto-rows: minmax(220px, 34vh);
}

body.superuser .tile.collapsed {
  min-height: unset;
}
```

- [ ] **Step 5: Verify against the scratch instance**

```bash
agent-browser open http://127.0.0.1:7421/superuser.html
```

Add 10 terminals (empty profile is fine — grid math only cares about
`cards.length`), then:

```bash
agent-browser eval "getComputedStyle(document.getElementById('wall')).gridTemplateColumns"
```

Expected: 4-5 columns (not 1 or 10) for 10 tiles, matching
`computeGrid(10)` → `cols = ceil(sqrt(16)) = 4`. Confirm visually with a
screenshot that tiles are legible, not sliver-thin. Confirm tiles auto-
collapse to compact chrome once past 8. Click `▦ Compact` — all tiles
toggle together.

- [ ] **Step 6: Commit**

```bash
git add public/superuser.js public/superuser.css
git commit -m "Add Superuser auto-grid layout and compact-chrome density"
```

---

## Task 6: Number-key quick-jump

**Files:**
- Modify: `public/superuser.js`
- Modify: `public/superuser.css`

**Interfaces:**
- Consumes: `cards` (creation order = jump order), `expandCard(card)`
  (from `app.js`).

- [ ] **Step 1: Numbered badges, added/refreshed alongside the grid poll**

```js
// ---- number-key quick-jump ----------------------------------------------

function renderQuickJumpBadges() {
  cards.forEach((card, i) => {
    const tile = document.querySelector(`.tile[data-uid="${card.uid}"]`);
    if (!tile) return;
    let badge = tile.querySelector(".su-jump-badge");
    if (i >= 10) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "su-jump-badge";
      tile.appendChild(badge);
    }
    badge.textContent = String((i + 1) % 10); // 1-9, then 0 for the 10th
  });
}
```

Call it from the same 300ms poll as `applyAutoGrid` (Task 5, Step 2):

```js
setInterval(() => {
  if (cards.length !== lastCardCount) {
    lastCardCount = cards.length;
    applyAutoGrid();
    renderQuickJumpBadges();
  }
}, 300);
```

- [ ] **Step 2: Keydown handler**

```js
document.addEventListener(
  "keydown",
  (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!/^[0-9]$/.test(e.key)) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (document.activeElement?.classList?.contains("xterm-helper-textarea")) return;
    const index = e.key === "0" ? 9 : Number(e.key) - 1;
    const card = cards[index];
    if (!card) return;
    e.preventDefault();
    expandCard(card);
  },
  true,
);
```

(The `xterm-helper-textarea` check matters: once hover-focus, Task 2, has
put keyboard focus inside a live terminal, bare digit keys must reach the
shell, not be hijacked as jump commands — quick-jump only fires when
nothing terminal-like has focus.)

- [ ] **Step 3: CSS for the badge**

```css
.su-jump-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--panel-3);
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 2;
}
```

- [ ] **Step 4: Verify against the scratch instance**

Add 3 terminals, focus nothing (click empty page area), press `2` →
confirm the overlay opens on the second tile. Start a terminal, hover
over it (focus goes to xterm per Task 2), type `2` → confirm the digit
`2` is sent to that terminal's shell, **not** interpreted as a jump.

- [ ] **Step 5: Commit**

```bash
git add public/superuser.js public/superuser.css
git commit -m "Add number-key quick-jump to Superuser mode"
```

---

## Task 7: Mission-control status strip

**Files:**
- Modify: `public/superuser.js`
- Modify: `public/superuser.css`

**Interfaces:**
- Consumes: `cards[].status.state`, `STATUS_META` (both from `app.js`),
  `expandCard(card)`.

- [ ] **Step 1: Render function, called from the same poll**

```js
// ---- status strip ---------------------------------------------------------

function renderStatusStrip() {
  const strip = document.getElementById("su-status-strip");
  if (!strip) return;
  const counts = {};
  for (const card of cards) {
    const state = card.status?.state || "unknown";
    counts[state] = (counts[state] || 0) + 1;
  }
  strip.innerHTML = Object.entries(counts)
    .filter(([state]) => state !== "unknown")
    .map(([state, count]) => {
      const meta = STATUS_META[state] || STATUS_META.unknown;
      return `<button type="button" class="su-status-chip" data-state="${state}">${meta.icon} ${meta.label} ×${count}</button>`;
    })
    .join("");
  strip.querySelectorAll(".su-status-chip").forEach((chip) => {
    chip.addEventListener("click", () => cycleToNextInState(chip.dataset.state));
  });
}
```

Add to the interval (Task 5/6's shared poll) — status changes aren't
covered by the `cards.length` guard, so give the strip its own always-run
tick:

```js
setInterval(renderStatusStrip, 1000); // piggybacks on app.js's existing 1s runtime timer cadence
```

- [ ] **Step 2: Click-to-cycle**

```js
let statusCycleIndex = {};

function cycleToNextInState(state) {
  const matches = cards.filter((c) => (c.status?.state || "unknown") === state);
  if (!matches.length) return;
  const i = (statusCycleIndex[state] || 0) % matches.length;
  statusCycleIndex[state] = i + 1;
  expandCard(matches[i]);
}
```

- [ ] **Step 3: CSS**

```css
.su-status-strip {
  display: flex;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  flex-wrap: wrap;
}
.su-status-strip:empty {
  display: none;
}
.su-status-chip {
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--soft);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.su-status-chip:hover {
  border-color: var(--accent);
  color: var(--text);
}
```

- [ ] **Step 4: Verify against the scratch instance**

Start 3 terminals against real profiles (e.g. `pwsh`) so status detection
has something to classify. Confirm the strip shows accurate counts.
Click a chip, confirm it expands a matching tile; click again, confirm it
cycles to the *next* matching tile rather than reopening the same one.

- [ ] **Step 5: Commit**

```bash
git add public/superuser.js public/superuser.css
git commit -m "Add mission-control status strip to Superuser mode"
```

---

## Task 8: Saved templates

**Files:**
- Modify: `public/superuser.js`
- Modify: `public/styles.css` (reuses `.mission-body`/`.connection-row`-style rules already present — only truly new bits below)

**Interfaces:**
- `localStorage` key: `termina.templates` — `Array<{id, name, entries: Array<{profileId, count}>}>`.
- Consumes: `profiles` (global from `app.js`), `addCard`, `startTerminal`.

- [ ] **Step 1: Storage helpers**

```js
// ---- saved templates -----------------------------------------------------

const TEMPLATES_KEY = "termina.templates";

function loadTemplates() {
  try {
    return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveTemplates(templates) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

function launchTemplate(template) {
  for (const entry of template.entries) {
    const profile = profiles.find((p) => p.id === entry.profileId);
    if (!profile) continue; // profile removed since the template was saved — skip, don't block the rest
    for (let i = 0; i < entry.count; i += 1) {
      const card = addCard({ profileId: entry.profileId }, { save: false });
      startTerminal(card);
    }
  }
}
```

- [ ] **Step 2: Panel rendering (list + a simple builder)**

```js
function renderTemplatesPanel() {
  const body = document.getElementById("su-templates-body");
  const templates = loadTemplates();
  body.innerHTML =
    templates
      .map(
        (t) => `
      <div class="connection-row" data-id="${t.id}">
        <div class="connection-row-head">
          <b>${escapeHtml(t.name)}</b>
          <span class="connection-status">${t.entries.map((e) => `${e.count}×${escapeHtml(e.profileId)}`).join(", ")}</span>
        </div>
        <div class="connection-row-actions">
          <button type="button" class="mw-btn su-template-launch">Launch</button>
          <button type="button" class="mw-btn su-template-delete">Delete</button>
        </div>
      </div>`,
      )
      .join("") +
    `<div class="connection-row">
      <div class="connection-row-head"><b>New template</b></div>
      <div class="connection-row-actions">
        <input type="text" id="su-template-name" placeholder="Name (e.g. My Usual 6)" />
        <select id="su-template-profile"></select>
        <input type="number" id="su-template-count" min="1" max="10" value="1" style="width:60px" />
        <button type="button" class="mw-btn" id="su-template-add-entry">Add</button>
      </div>
      <div id="su-template-draft-entries"></div>
      <button type="button" class="mw-btn primary" id="su-template-save">Save template</button>
    </div>`;

  document.getElementById("su-template-profile").innerHTML = profiles
    .map((p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`)
    .join("");

  body.querySelectorAll(".su-template-launch").forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = btn.closest(".connection-row").dataset.id;
      const t = templates.find((x) => x.id === id);
      if (t) launchTemplate(t);
    }),
  );
  body.querySelectorAll(".su-template-delete").forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = btn.closest(".connection-row").dataset.id;
      saveTemplates(templates.filter((x) => x.id !== id));
      renderTemplatesPanel();
    }),
  );

  let draftEntries = [];
  document.getElementById("su-template-add-entry").addEventListener("click", () => {
    const profileId = document.getElementById("su-template-profile").value;
    const count = Math.max(1, parseInt(document.getElementById("su-template-count").value, 10) || 1);
    draftEntries.push({ profileId, count });
    document.getElementById("su-template-draft-entries").textContent = draftEntries
      .map((e) => `${e.count}×${e.profileId}`)
      .join(", ");
  });
  document.getElementById("su-template-save").addEventListener("click", () => {
    const name = document.getElementById("su-template-name").value.trim();
    if (!name || !draftEntries.length) return;
    templates.push({ id: `t${Date.now().toString(36)}`, name, entries: draftEntries });
    saveTemplates(templates);
    renderTemplatesPanel();
  });
}

document.getElementById("su-templates-btn").addEventListener("click", () => {
  document.getElementById("su-templates-modal").classList.remove("hidden");
  renderTemplatesPanel();
});
document.getElementById("su-templates-close").addEventListener("click", () => {
  document.getElementById("su-templates-modal").classList.add("hidden");
});
document.getElementById("su-templates-modal").addEventListener("click", (e) => {
  if (e.target.id === "su-templates-modal") document.getElementById("su-templates-modal").classList.add("hidden");
});
```

- [ ] **Step 3: Verify against the scratch instance**

Open Templates, build a 2-entry template ("Test Pair": 2×`pwsh`), save
it, launch it — confirm 2 new terminals start. Reload the page — confirm
the template is still listed (localStorage persistence, independent of
session state). Delete it — confirm it's gone after reload too.

- [ ] **Step 4: Commit**

```bash
git add public/superuser.js
git commit -m "Add saved terminal templates to Superuser mode"
```

---

## Task 9: Bulk selection + actions

**Files:**
- Modify: `public/superuser.js`
- Modify: `public/superuser.css`

**Interfaces:**
- Consumes: `cards`, `removeCard(card)`, `restartCard(card)`, `linkAllCards`-style
  per-card linking (`card.linked`, toggling `.tile.linked`), all from `app.js`.

- [ ] **Step 1: Selection state + toggle UI (Ctrl+click a tile to select)**

```js
// ---- bulk selection --------------------------------------------------------

const selectedUids = new Set();

document.addEventListener(
  "mousedown",
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const tile = e.target.closest(".tile");
    if (!tile) return;
    e.preventDefault();
    e.stopPropagation();
    const uid = tile.dataset.uid;
    if (selectedUids.has(uid)) {
      selectedUids.delete(uid);
      tile.classList.remove("su-selected");
    } else {
      selectedUids.add(uid);
      tile.classList.add("su-selected");
    }
    renderBulkBar();
  },
  true,
);

function selectedCards() {
  return cards.filter((c) => selectedUids.has(c.uid));
}

function renderBulkBar() {
  let bar = document.getElementById("su-bulk-bar");
  if (selectedUids.size === 0) {
    bar?.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "su-bulk-bar";
    bar.className = "su-bulk-bar";
    document.body.appendChild(bar);
  }
  bar.innerHTML = `
    <span>${selectedUids.size} selected</span>
    <button type="button" class="mw-btn" id="su-bulk-close">Close</button>
    <button type="button" class="mw-btn" id="su-bulk-restart">Restart</button>
    <button type="button" class="mw-btn" id="su-bulk-link">Link</button>
    <button type="button" class="mw-btn" id="su-bulk-compact">Compact</button>
    <button type="button" class="mw-btn" id="su-bulk-clear">Clear selection</button>
  `;
  document.getElementById("su-bulk-close").addEventListener("click", () => {
    for (const card of selectedCards()) removeCard(card);
    clearSelection();
  });
  document.getElementById("su-bulk-restart").addEventListener("click", () => {
    for (const card of selectedCards()) restartCard(card);
  });
  document.getElementById("su-bulk-link").addEventListener("click", () => {
    for (const card of selectedCards()) {
      card.linked = true;
      document.querySelector(`.tile[data-uid="${card.uid}"]`)?.classList.add("linked");
    }
  });
  document.getElementById("su-bulk-compact").addEventListener("click", () => {
    for (const card of selectedCards()) setCollapsed(card, true);
  });
  document.getElementById("su-bulk-clear").addEventListener("click", clearSelection);
}

function clearSelection() {
  for (const uid of selectedUids) {
    document.querySelector(`.tile[data-uid="${uid}"]`)?.classList.remove("su-selected");
  }
  selectedUids.clear();
  renderBulkBar();
}
```

(Ctrl/Cmd+click is chosen deliberately to avoid colliding with Link
mode's existing Shift+click-to-link gesture — see spec section 6.)

- [ ] **Step 2: CSS**

```css
.tile.su-selected {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.su-bulk-bar {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  align-items: center;
  background: var(--panel-2);
  border: 1px solid var(--accent);
  border-radius: 12px;
  padding: 10px 14px;
  box-shadow: var(--shadow);
  z-index: 50;
}
```

- [ ] **Step 3: Verify against the scratch instance**

Ctrl+click 3 tiles, confirm the bulk bar shows "3 selected" and each tile
gets the selection outline. Click Compact — all 3 collapse. Click Link —
all 3 get `.linked`. Click Close — all 3 removed, bar disappears.

- [ ] **Step 4: Commit**

```bash
git add public/superuser.js public/superuser.css
git commit -m "Add bulk tile selection and actions to Superuser mode"
```

---

## Task 10: Command palette (Ctrl+K)

**Files:**
- Modify: `public/superuser.js`

**Interfaces:**
- Consumes: `cards`, `expandCard`, `loadTemplates`/`launchTemplate` (Task 8),
  `document.getElementById("su-compact-all")` click (Task 5), `toggleBroadcast`
  (from `app.js`).

- [ ] **Step 1: Action registry + fuzzy filter**

```js
// ---- command palette ------------------------------------------------------

function paletteActions() {
  const actions = [];
  cards.forEach((card, i) => {
    actions.push({
      label: `Jump to: ${card.name || card.profileId || "Untitled " + (i + 1)}`,
      run: () => expandCard(card),
    });
  });
  for (const t of loadTemplates()) {
    actions.push({ label: `Launch template: ${t.name}`, run: () => launchTemplate(t) });
  }
  actions.push({ label: "Toggle compact chrome (all)", run: () => document.getElementById("su-compact-all").click() });
  actions.push({ label: "Toggle Link mode", run: () => toggleBroadcast() });
  actions.push({ label: "Basic Mode", run: () => (window.location.href = "/") });
  return actions;
}

function fuzzyMatch(query, text) {
  const q = query.toLowerCase();
  return text.toLowerCase().includes(q);
}
```

- [ ] **Step 2: Open/close + render + keyboard nav**

```js
let paletteSelectedIndex = 0;

function openPalette() {
  document.getElementById("su-palette").classList.remove("hidden");
  const input = document.getElementById("su-palette-input");
  input.value = "";
  paletteSelectedIndex = 0;
  renderPaletteResults("");
  input.focus();
}

function closePalette() {
  document.getElementById("su-palette").classList.add("hidden");
}

function renderPaletteResults(query) {
  const results = document.getElementById("su-palette-results");
  const matches = paletteActions().filter((a) => fuzzyMatch(query, a.label));
  results.innerHTML = matches
    .map((a, i) => `<div class="su-palette-item${i === paletteSelectedIndex ? " active" : ""}" data-i="${i}">${escapeHtml(a.label)}</div>`)
    .join("");
  results.querySelectorAll(".su-palette-item").forEach((el) => {
    el.addEventListener("click", () => {
      matches[Number(el.dataset.i)]?.run();
      closePalette();
    });
  });
  return matches;
}

document.getElementById("su-palette-input").addEventListener("input", (e) => {
  paletteSelectedIndex = 0;
  renderPaletteResults(e.target.value);
});
document.getElementById("su-palette-input").addEventListener("keydown", (e) => {
  const matches = paletteActions().filter((a) => fuzzyMatch(document.getElementById("su-palette-input").value, a.label));
  if (e.key === "ArrowDown") {
    e.preventDefault();
    paletteSelectedIndex = Math.min(paletteSelectedIndex + 1, matches.length - 1);
    renderPaletteResults(document.getElementById("su-palette-input").value);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    paletteSelectedIndex = Math.max(paletteSelectedIndex - 1, 0);
    renderPaletteResults(document.getElementById("su-palette-input").value);
  } else if (e.key === "Enter") {
    e.preventDefault();
    matches[paletteSelectedIndex]?.run();
    closePalette();
  } else if (e.key === "Escape") {
    closePalette();
  }
});

document.addEventListener(
  "keydown",
  (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      e.stopPropagation();
      openPalette();
    }
  },
  true,
);
```

- [ ] **Step 3: CSS**

```css
.su-palette {
  position: fixed;
  top: 15%;
  left: 50%;
  transform: translateX(-50%);
  width: 480px;
  max-width: 90vw;
  background: var(--panel-2);
  border: 1px solid var(--accent);
  border-radius: 12px;
  box-shadow: var(--shadow);
  z-index: 60;
  padding: 10px;
}
.su-palette.hidden {
  display: none;
}
#su-palette-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
  font-size: 14px;
}
#su-palette-results {
  margin-top: 8px;
  max-height: 320px;
  overflow-y: auto;
}
.su-palette-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--soft);
  font-size: 13px;
}
.su-palette-item.active,
.su-palette-item:hover {
  background: var(--panel-3);
  color: var(--text);
}
```

- [ ] **Step 4: Verify against the scratch instance**

Ctrl+K → confirm palette opens with tile/template/toggle actions listed.
Type a partial tile name → confirm it filters. Arrow down, Enter →
confirm the highlighted action runs (e.g. jumps to the right tile).
Escape → confirm it closes.

- [ ] **Step 5: Commit**

```bash
git add public/superuser.js public/superuser.css
git commit -m "Add Ctrl+K command palette to Superuser mode"
```

---

## Task 11: Full verification pass, then live-instance rollout

**Files:** none (verification only).

- [ ] **Step 1: Full scratch-instance regression pass**

Run every "Verify" step from Tasks 1-10 again, back to back, against the
same still-running `TERMINA_PORT=7421` instance, without restarting it —
confirms nothing in a later task broke an earlier one. Push to 10 real
(not empty) terminals (mixed profiles) and repeat Task 1's reload check
at that density: reload `/superuser.html`, confirm all 10 reconnect, no
duplicate processes (check child-process count under the port-7421
`node.exe` before/after).

- [ ] **Step 2: Cross-mode session-sharing check**

With several terminals open in Superuser, navigate to `/`, confirm they
all appear in Basic mode's simple wall too (shared engine, per
Architecture). Rename one from Basic mode, navigate back to Superuser,
confirm the name persisted (same `localStorage` workspace, same
`sessionId`-keyed lookup from Task 1).

- [ ] **Step 3: Shut down the scratch instance**

```bash
# find and stop the TERMINA_PORT=7421 node process, e.g.:
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -match 'server\.js' -and \$_.ProcessId -ne <live-pid> } | ForEach-Object { Stop-Process -Id \$_.ProcessId }"
```

(Substitute the actual scratch-instance PID; never target the live
instance's PID — identify it first with `Get-CimInstance Win32_Process |
Where-Object { $_.CommandLine -match 'server\.js' }` and cross-check
against the port each is bound to.)

- [ ] **Step 4: Report rollout readiness to the user**

Do not restart or reload the user's live instance (port 7420, the one
with their real sessions) as part of this plan. Instead, once Steps 1-2
pass cleanly, tell the user Superuser mode is verified and ready, and
that reloading/restarting their live Termina window is now safe — session
reconnect (Task 1) is exactly what makes that true — but let them choose
when to do it themselves.
