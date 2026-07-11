# Interactive Worker Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Workers tab's "Web view" into a full-viewport, click-drag-pannable, scroll-to-zoom, searchable canvas instead of a small static 320px decorative box.

**Architecture:** Wrap the existing radial node layout in a "world" div; drive `transform: translate() scale()` on it imperatively from pointer/wheel listeners (not through the page's full `rerender()`, which rebuilds the whole page's `innerHTML` and is too slow per-frame). `.worker-mesh-stage` toggles to `position: fixed; inset: 0` for the fullscreen effect.

**Tech Stack:** Vanilla JS (ES modules, no bundler), plain CSS with custom properties. No new dependencies.

## Global Constraints

- No build step for `app/` - files are loaded directly via `<script type="module">` with manual `?v=phantom-live-YYYYMMDD-N` cache-busting. Any edit to `app/index.html`, `app/js/*.js`, or `app/phantom.css` requires bumping that build id everywhere it appears (see `AGENTS.md`).
- No frontend test framework exists for `app/` - verification is manual/agent-browser-driven, documented per task below instead of automated test code.
- Follow existing patterns: `data-act` delegated click handlers via `bindActions()`, module-level UI-state objects (like `workerUi`), imperative wiring functions called after `el.innerHTML = ...` (like `wirePostCards` in `contenthub.js`).

---

### Task 1: World wrapper + fullscreen stage CSS

**Files:**
- Modify: `app/js/workspaces.js:1792-1856` (`renderWorkerMesh`)
- Modify: `app/phantom.css:1362-1442` (`.worker-mesh*` rules)

**Interfaces:**
- Produces: `.worker-mesh-stage.is-web-active` (fullscreen state class), `.worker-web-world` (new transform target div wrapping `.worker-mesh-rings`, `.worker-node-field`, `.worker-core`), `.worker-web-exit` (exit button).

- [ ] **Step 1: Wrap the existing stage contents in a `.worker-web-world` div**

In `renderWorkerMesh`, change the returned markup so `.worker-mesh-rings`, `.worker-node-field`, and `.worker-core` are nested inside a new `<div class="worker-web-world" data-worker-web-world>` inside `.worker-mesh-stage`, and add an exit button and search input as direct children of `.worker-mesh-stage` (siblings of the world div, so they don't get transformed):

```js
return `
    <section class="worker-mesh" aria-label="Worker operations web">
      <div class="worker-mesh-stage" data-worker-web-stage>
        <div class="worker-web-world" data-worker-web-world>
          <div class="worker-mesh-rings" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <div class="worker-node-field">
            ${coreRingNodes}
            ${outerRingNodes}
          </div>
          <div class="worker-core">
            <span>PF</span>
            <b>Phantom</b>
            <i>master router</i>
          </div>
        </div>
        <button class="worker-web-exit" type="button" data-act="worker-web-exit" aria-label="Exit fullscreen web view">${svgIc("close")} Exit</button>
        <label class="worker-web-search">
          <input type="search" data-worker-web-search placeholder="Search workers…" value="${esc(workerWebUi.search)}" aria-label="Search workers" />
        </label>
      </div>
      <div class="worker-mesh-foot">
        <div class="worker-web-legend" aria-label="Legend">
          <span><i class="worker-legend-dot worker-legend-live"></i>Active</span>
          <span><i class="worker-legend-dot worker-legend-approval"></i>Waiting on you</span>
          <span><i class="worker-legend-dot worker-legend-ready"></i>Mapped</span>
          <span><i class="worker-legend-dot worker-legend-blocked"></i>Offline</span>
          ${overflowSubagents > 0 ? `<span class="worker-legend-more">+${overflowSubagents} more subagents</span>` : ""}
        </div>
        <div class="worker-mesh-readout">
          <span><b>${mapped}</b> workers mapped</span>
          <span><b>${observed}</b> live signals</span>
          <span><b>${waiting}</b> waiting on you</span>
          <span><b>${departments}</b> departments</span>
        </div>
      </div>
    </section>`;
```

`svgIc` is already imported/used elsewhere in this file (check top-of-file imports; if not present for this scope, use a literal `✕` character instead - simpler, no new import needed).

- [ ] **Step 2: Add fullscreen + world CSS**

Add to `phantom.css` near the existing `.worker-mesh-stage` rule (~line 1366):

```css
.worker-mesh-stage.is-web-active {
  position: fixed; inset: 0; z-index: 400; border-radius: 0; min-height: 0;
}
.worker-web-world {
  position: absolute; inset: 0; transform-origin: 0 0; will-change: transform;
}
.worker-web-exit {
  position: absolute; top: 20px; right: 20px; z-index: 10; display: none;
  align-items: center; gap: 6px; padding: 9px 16px; border-radius: 999px;
  border: 1px solid rgba(65,255,161,0.3); background: rgba(3,12,9,0.88);
  color: #dfffee; font: 700 12px "Space Grotesk", sans-serif; cursor: pointer;
}
.worker-mesh-stage.is-web-active .worker-web-exit { display: flex; }
.worker-web-search {
  position: absolute; top: 20px; left: 20px; z-index: 10; display: none;
}
.worker-mesh-stage.is-web-active .worker-web-search { display: block; }
.worker-web-search input {
  width: 280px; padding: 10px 14px; border-radius: 999px;
  border: 1px solid rgba(65,255,161,0.3); background: rgba(3,12,9,0.88);
  color: #dfffee; font: 500 13px "Space Grotesk", sans-serif;
}
.worker-mesh-stage.is-web-active .worker-mesh-rings { inset: 0; }
```

Note `.worker-mesh-rings`, `.worker-node-field`, `.worker-core`, `.worker-node`, `.worker-thread` all already use `position: absolute` relative to their nearest positioned ancestor - since `.worker-web-world` is now that ancestor (`position: absolute` itself, relative to `.worker-mesh-stage`), this nesting doesn't change their existing positioning math, only adds one more transform layer on top.

- [ ] **Step 3: Manual verification**

Run `node ops/admin-live/admin-static-server.mjs --root . --port 5177` (or confirm it's already running), open `http://127.0.0.1:5177/app/`, log in, go to Workers, confirm Web view still renders the same as before (no visible change yet - `is-web-active` isn't toggled on by anything yet). Confirm no console errors.

---

### Correction after Task 1 drafting

Dropped the separate `workerWebUi.active` boolean: `workerUi.view === "map"`
already means "Web view is showing," and the page defaults to map view on
load - so gating fullscreen behind a second flag either leaves the default
landing state non-fullscreen (inconsistent with "Web view = fullscreen") or
requires special-casing the initial load. Simpler: fullscreen state is just
`isMap` (already computed in `renderWorkforce`). `workerWebUi` only tracks
pan/zoom/search/the one-shot fit flag. Also: `.worker-mesh-foot` (legend +
readout stats) moves inside `.worker-mesh-stage` as a floating overlay
docked to the bottom, per the approved "float them over the canvas" design -
it was a sibling block below the stage before, which didn't match.

### Task 2: Module-level `workerWebUi` state + auto-fit on entering Web view

**Files:**
- Modify: `app/js/workspaces.js` (near `const workerUi = ...` at line 21; inside `renderWorkforce`)

**Interfaces:**
- Consumes: `workerUi.view` (existing, from Task in `renderWorkforce`)
- Produces: `workerWebUi` object with shape `{ active, pan: {x,y}, zoom, search, highlightId }`, `computeAutoFit(stageEl, worldEl)` returning `{ x, y, zoom }`.

- [ ] **Step 1: Add the state object**

Near line 21 (`const workerUi = { ... };`), add:

```js
const workerWebUi = { active: false, pan: { x: 0, y: 0 }, zoom: 1, search: "", highlightId: "" };
```

- [ ] **Step 2: Add auto-fit calculation**

Add a new function near `renderWorkerMesh`:

```js
function computeWorkerWebAutoFit(stageEl, worldEl) {
  const stageRect = stageEl.getBoundingClientRect();
  const nodes = worldEl.querySelectorAll(".worker-node");
  if (!nodes.length || !stageRect.width || !stageRect.height) return { x: stageRect.width / 2, y: stageRect.height / 2, zoom: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((node) => {
    const r = node.getBoundingClientRect();
    minX = Math.min(minX, r.left); maxX = Math.max(maxX, r.right);
    minY = Math.min(minY, r.top); maxY = Math.max(maxY, r.bottom);
  });
  const contentW = maxX - minX || 1;
  const contentH = maxY - minY || 1;
  const padding = 0.82; // leave breathing room around the edges
  const zoom = Math.min((stageRect.width * padding) / contentW, (stageRect.height * padding) / contentH, 1.6);
  const contentCenterX = (minX + maxX) / 2 - stageRect.left;
  const contentCenterY = (minY + maxY) / 2 - stageRect.top;
  return {
    x: stageRect.width / 2 - contentCenterX * zoom,
    y: stageRect.height / 2 - contentCenterY * zoom,
    zoom,
  };
}
```

This measures actual rendered node positions (post-layout, at zoom=1) via `getBoundingClientRect()`, so it works regardless of node count or the fixed 118/208px radii - it fits whatever the current layout produces into the stage.

- [ ] **Step 3: Trigger auto-fit when entering Web view**

In `renderWorkforce`'s `"worker-view"` handler (line ~2454), when switching TO map view, mark that auto-fit is needed:

```js
"worker-view": (_id, button) => {
  const nextView = button.dataset.view === "list" ? "list" : "map";
  workerUi.view = nextView;
  workerUi.selectedId = "";
  if (nextView === "map") { workerWebUi.active = true; workerWebUi._needsFit = true; }
  else { workerWebUi.active = false; }
  rerender();
},
```

(`_needsFit` is a private one-shot flag consumed by the wiring function in Task 3, since the actual fit measurement needs the DOM to exist post-render.)

- [ ] **Step 4: Apply `is-web-active` class and transform from state**

In `renderWorkerMesh`, read `workerWebUi.active` to add the class, and apply the current transform inline so it's correct even before any JS wiring runs on this render pass:

```js
return `
    <section class="worker-mesh" aria-label="Worker operations web">
      <div class="worker-mesh-stage ${workerWebUi.active ? "is-web-active" : ""}" data-worker-web-stage>
        <div class="worker-web-world" data-worker-web-world style="transform: translate(${workerWebUi.pan.x}px, ${workerWebUi.pan.y}px) scale(${workerWebUi.zoom})">
```

(keep the rest of Task 1's markup unchanged below this line)

- [ ] **Step 5: Manual verification**

Click "Web view" - confirm the stage becomes fullscreen (covers sidebar/topbar) but nodes are NOT yet auto-fit (still fixed-radius small cluster in a huge black canvas) - that's expected, auto-fit measurement + apply happens in Task 3's wiring function. Click "List view" - confirm it returns to normal in-page layout. No console errors.

---

### Task 3: Wiring function - auto-fit application, drag-to-pan, wheel-to-zoom

**Files:**
- Modify: `app/js/workspaces.js` (add `wireWorkerWeb`, call it from `renderWorkforce`)

**Interfaces:**
- Consumes: `workerWebUi` (Task 2), `computeWorkerWebAutoFit` (Task 2), DOM markers `[data-worker-web-stage]`, `[data-worker-web-world]` (Task 1).
- Produces: `wireWorkerWeb(el, rerender)` function.

- [ ] **Step 1: Write the wiring function**

Add near the bottom of the worker-related functions, before `renderWorkforce`:

```js
function applyWorkerWebTransform(worldEl) {
  worldEl.style.transform = `translate(${workerWebUi.pan.x}px, ${workerWebUi.pan.y}px) scale(${workerWebUi.zoom})`;
}

function wireWorkerWeb(el, rerender) {
  const stage = el.querySelector("[data-worker-web-stage]");
  const world = el.querySelector("[data-worker-web-world]");
  if (!stage || !world) return;

  if (workerWebUi._needsFit) {
    workerWebUi._needsFit = false;
    const fit = computeWorkerWebAutoFit(stage, world);
    workerWebUi.pan = { x: fit.x, y: fit.y };
    workerWebUi.zoom = fit.zoom;
    applyWorkerWebTransform(world);
  }

  const MIN_ZOOM_FACTOR = 0.4, MAX_ZOOM_FACTOR = 2.5;
  const baseZoom = workerWebUi.zoom || 1; // treat zoom at fit-time as the 1.0x reference isn't tracked separately; clamp around current session's fit value instead
  let dragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0, dragMoved = false;

  stage.onpointerdown = (event) => {
    if (event.target.closest(".worker-node") || event.target.closest(".worker-web-exit") || event.target.closest(".worker-web-search")) return;
    dragging = true; dragMoved = false;
    dragStartX = event.clientX; dragStartY = event.clientY;
    panStartX = workerWebUi.pan.x; panStartY = workerWebUi.pan.y;
    stage.setPointerCapture(event.pointerId);
  };
  stage.onpointermove = (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragStartX, dy = event.clientY - dragStartY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
    workerWebUi.pan = { x: panStartX + dx, y: panStartY + dy };
    applyWorkerWebTransform(world);
  };
  stage.onpointerup = (event) => {
    dragging = false;
    stage.releasePointerCapture(event.pointerId);
  };
  stage.onclick = (event) => {
    // swallow the click that follows a real drag so it doesn't also select a node
    if (dragMoved) { event.stopPropagation(); dragMoved = false; }
  };

  stage.onwheel = (event) => {
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    const cursorX = event.clientX - rect.left, cursorY = event.clientY - rect.top;
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const nextZoom = Math.min(Math.max(workerWebUi.zoom * zoomFactor, MIN_ZOOM_FACTOR), MAX_ZOOM_FACTOR);
    // keep the point under the cursor fixed: solve for new pan given the zoom ratio actually applied
    const ratio = nextZoom / workerWebUi.zoom;
    workerWebUi.pan = {
      x: cursorX - (cursorX - workerWebUi.pan.x) * ratio,
      y: cursorY - (cursorY - workerWebUi.pan.y) * ratio,
    };
    workerWebUi.zoom = nextZoom;
    applyWorkerWebTransform(world);
  };
}
```

(`baseZoom`/`MIN_ZOOM_FACTOR`/`MAX_ZOOM_FACTOR`: the spec says "0.4x-2.5x of the auto-fit scale" - since `workerWebUi.zoom` already starts at the auto-fit value and these bounds multiply that starting value's neighborhood as the session progresses, using them directly as absolute clamps on `workerWebUi.zoom` satisfies that - no separate "base" tracking needed. Remove the unused `baseZoom` line since it's not read anywhere - dead code.)

Fix: delete the `const baseZoom = ...` line entirely, it's unused.

- [ ] **Step 2: Call the wiring function from `renderWorkforce`**

Right after the existing `bindActions(el, {...})` call in `renderWorkforce` (after line ~2480), add:

```js
if (isMap) wireWorkerWeb(el, rerender);
```

- [ ] **Step 3: Manual verification**

Open Workers > Web view. Confirm: the web now auto-fits to fill most of the fullscreen canvas (not a tiny cluster anymore). Click-drag on empty canvas pans smoothly. Scroll wheel zooms in/out, staying anchored under the cursor (test by zooming while cursor is over a specific node - that node should stay under the cursor, not drift). Clicking a node (no drag) still selects it (check the existing `worker-map-detail` panel updates). Dragging should NOT also select whatever node the drag ended on.

---

### Task 4: Search - highlight + center on a match

**Files:**
- Modify: `app/js/workspaces.js` (`wireWorkerWeb`, `renderWorkerMesh`)
- Modify: `app/phantom.css` (dim/highlight classes)

**Interfaces:**
- Consumes: `workerWebUi.search`, `.worker-node[data-id]` (existing markup).
- Produces: `.worker-node.is-web-dimmed`, `.worker-node.is-web-match` CSS classes; input handler updates `workerWebUi.search` and pans/zooms to the first match on Enter.

- [ ] **Step 1: Add dim/match CSS**

```css
.worker-mesh-stage.is-web-active .worker-node.is-web-dimmed { opacity: 0.15; }
.worker-mesh-stage.is-web-active .worker-node.is-web-match { border-color: var(--neon); box-shadow: 0 0 0 2px rgba(65,255,161,0.4), 0 0 34px var(--node-glow); }
```

- [ ] **Step 2: Wire the search input (imperative DOM class toggling, no rerender per keystroke)**

Inside `wireWorkerWeb`, after the existing pointer/wheel wiring:

```js
const searchInput = el.querySelector("[data-worker-web-search]");
if (searchInput) {
  searchInput.oninput = () => {
    workerWebUi.search = searchInput.value;
    const query = workerWebUi.search.trim().toLowerCase();
    const nodes = world.querySelectorAll(".worker-node");
    nodes.forEach((node) => {
      const label = (node.querySelector(".worker-node-label")?.textContent || "").toLowerCase();
      const isMatch = query.length > 0 && label.includes(query);
      node.classList.toggle("is-web-match", isMatch);
      node.classList.toggle("is-web-dimmed", query.length > 0 && !isMatch);
    });
  };
  searchInput.onkeydown = (event) => {
    if (event.key !== "Enter") return;
    const firstMatch = world.querySelector(".worker-node.is-web-match");
    if (!firstMatch) return;
    const stageRect = stage.getBoundingClientRect();
    const nodeRect = firstMatch.getBoundingClientRect();
    const targetZoom = 1.4;
    // where the node currently sits, in stage-local coords, undoing the current transform
    const nodeCenterX = (nodeRect.left + nodeRect.right) / 2 - stageRect.left;
    const nodeCenterY = (nodeRect.top + nodeRect.bottom) / 2 - stageRect.top;
    const worldCenterX = (nodeCenterX - workerWebUi.pan.x) / workerWebUi.zoom;
    const worldCenterY = (nodeCenterY - workerWebUi.pan.y) / workerWebUi.zoom;
    workerWebUi.zoom = targetZoom;
    workerWebUi.pan = {
      x: stageRect.width / 2 - worldCenterX * targetZoom,
      y: stageRect.height / 2 - worldCenterY * targetZoom,
    };
    applyWorkerWebTransform(world);
  };
}
```

- [ ] **Step 3: Manual verification**

Type a worker's name (e.g. "Theo") in the search box - confirm matching node(s) get a highlighted border and everything else dims. Press Enter - confirm the view pans/zooms to center that node. Clear the search box - confirm all nodes return to normal opacity.

---

### Task 5: Exit handling (button + Escape key)

**Files:**
- Modify: `app/js/workspaces.js` (`renderWorkforce`, `wireWorkerWeb`)

- [ ] **Step 1: Wire the exit button through the existing `bindActions` pattern**

Add to the `bindActions(el, {...})` call in `renderWorkforce`:

```js
"worker-web-exit": () => { workerWebUi.active = false; rerender(); },
```

- [ ] **Step 2: Add an Escape key handler, scoped to when the web is active**

In `wireWorkerWeb`, register a one-shot-safe document keydown handler that checks `workerWebUi.active` (guard against duplicate listeners across rerenders by keeping a module-level reference and removing the old one first, matching the pattern already used for `chLibraryKeyHandler` in `contenthub.js`):

```js
if (workerWebEscapeHandler) document.removeEventListener("keydown", workerWebEscapeHandler);
workerWebEscapeHandler = (event) => {
  if (event.key === "Escape" && workerWebUi.active) { workerWebUi.active = false; rerender(); }
};
document.addEventListener("keydown", workerWebEscapeHandler);
```

Add the module-level variable near `workerWebUi`:

```js
let workerWebEscapeHandler = null;
```

- [ ] **Step 3: Manual verification**

Click Exit - confirm return to normal page layout, sidebar/topbar visible again. Re-enter Web view, press Escape - same result. Confirm switching to List view via the toggle also exits (already handled in Task 2 Step 3).

---

### Task 6: Full pass verification + cache-bust bump

**Files:**
- Modify: `app/index.html`, all `app/js/*.js` files referencing the build id (bulk find/replace, matches the pattern used in the prior scaling-fix session)

- [ ] **Step 1: Bump the build id**

Find current id in `app/index.html` (`window.PHANTOM_BUILD = "phantom-live-YYYYMMDD-N"`), bump `N` by 1, and replace that exact string across `app/index.html` and every `app/js/*.js` file that references it (grep first to get the exact file list - don't blindly glob every file in `app/js/*.js`, since files that don't contain the string will get needless line-ending churn from a blind `sed`; the prior scaling-fix session hit this and had to revert ~10 falsely-touched files).

- [ ] **Step 2: Full agent-browser pass**

- Open Workers tab, switch to Web view: confirm fullscreen, auto-fit, drag-pan, cursor-anchored wheel-zoom, search highlight+center, Exit button, Escape key.
- Switch to List view: confirm unchanged behavior, filter chips still work.
- Click a node in Web view: confirm the existing worker detail panel (`renderWorkerMapDetail`) still opens/updates correctly.
- Re-check the two fixes from the prior session still hold (dashboard header pills don't truncate; Content Hub photo lightbox scales portrait/landscape images correctly) - no regression from CSS changes in this pass.
- Check `git status`/`git diff --stat` only shows the files intentionally touched (repeat the `git checkout --` cleanup step from the prior session if the build-id bump touches unrelated files).

- [ ] **Step 3: Report git status to Jordan, do not push**

This repo auto-deploys on push to `main` (per `AGENTS.md`) - leave changes committed locally at most, never push without explicit approval, matching the standing rule from the prior session.
