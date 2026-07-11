# Interactive Worker Web (Workers tab, "Web view")

## Problem

The Workers tab's "Web view" (`renderWorkerMesh` in `app/js/workspaces.js`, styled by
`.worker-mesh*` in `app/phantom.css`) renders workers as nodes radiating from a
"Phantom" core, but:

- The stage is a small fixed box (`.worker-mesh-stage { min-height: 320px }`)
  sitting inside the normal page layout.
- Node positions use fixed pixel radii (118px core ring / 208px outer ring) via
  `--node-radius`/`--node-angle` CSS custom properties - they don't scale with
  the container.
- There is no pan, zoom, or drag interaction at all. It's a static, decorative
  layout with only a floating idle animation.

Jordan wants this to become a real, explorable canvas: full-screen, click-drag
to pan, scroll-to-zoom toward the cursor, and a way to search for a specific
worker and jump to it.

## Approach

Wrap the existing node layout (core + rings + nodes) in a new "world" element
and drive `transform: translate(...) scale(...)` on it from vanilla JS pointer
and wheel handlers. This keeps the existing angle/radius node-positioning CSS
untouched - we're only transforming the layer it lives in.

Rejected alternatives:

- **Rewrite as SVG.** Common for graph visualizations, but the nodes are real
  `<button>` elements for click handling and accessibility; that's awkward
  inside SVG. Full rewrite for no real benefit here.
- **Vendor a pan/zoom library.** `app/` has no bundler/npm build for browser
  code (plain `<script type="module">`, manual `?v=` cache-busting) - adding a
  third-party library means hand-vendoring files, disproportionate to the task.

## Behavior

- **Entering Web view** switches the Workers page into a full-viewport
  immersive mode: `.worker-mesh-stage` becomes `position: fixed; inset: 0`
  with a high z-index, visually covering the sidebar/topbar (they stay in the
  DOM - no state loss). List view stays in the normal in-page layout.
- **Auto-fit on open**: JS computes the bounding box of all rendered nodes and
  sets an initial `scale`/`pan` so the whole web is centered and sized to
  comfortably fill the viewport, instead of sitting small in a big empty box.
- **Drag to pan**: mousedown + move over empty canvas updates pan. A small
  drag-distance threshold (~4px) distinguishes a pan-drag from a plain click,
  so clicking a node still selects it.
- **Wheel to zoom**: zooms toward the cursor position (the point under the
  cursor stays visually fixed), clamped to 0.4x-2.5x of the auto-fit scale.
  Trackpad pinch (wheel + ctrlKey) works the same way.
- **Floating overlay chrome**: search box, legend, stats readout, filter
  chips, and an explicit Exit button become fixed-position panels docked to
  the canvas edges, rendered *outside* the transformed world so they never
  pan/zoom themselves.
- **Search**: typing in the search box dims non-matching nodes and highlights
  matches; picking a result animates pan+zoom to center that node at a
  comfortable zoom level.
- **Exit**: the Exit button and the `Escape` key return to the normal page
  layout. Selecting a worker still opens the existing detail drawer/expansion,
  now as a floating overlay panel so the user stays immersed instead of
  bouncing out of fullscreen.

## Data flow / state

New transient UI state (not persisted, resets on exit), alongside the existing
`workerUi` object in `workspaces.js`:

```js
const workerWebUi = {
  active: false,       // fullscreen engaged
  pan: { x: 0, y: 0 },
  zoom: 1,
  search: "",
  highlightId: "",
};
```

- Entering Web view (`workerUi.view = "map"`) does not by itself engage
  fullscreen; a first render computes auto-fit `pan`/`zoom` into
  `workerWebUi` and sets `active = true`. This keeps "Web view" as the toggle
  name but makes the immersive canvas the actual behavior, matching what
  Jordan asked for.
- Drag/wheel handlers mutate `workerWebUi.pan`/`workerWebUi.zoom` directly and
  apply the CSS transform imperatively (not through a full `rerender()` per
  mouse-move frame - re-running the whole page render on every pointer move
  would be too slow). Only search, selection, and exit go through the normal
  `rerender()` path.

## Out of scope

Existing mobile breakpoints already replace the radial layout with a simpler
grid below certain widths (`.worker-node-field { grid-template-columns:
repeat(3, ...) }` etc.). This spec targets the desktop radial "web" and does
not change that mobile fallback.

## Testing / verification

No test framework covers this app's UI (`app/` is not wired into
`server/scripts/test-*` suites - it's a hand-verified frontend). Verification
plan:

- `agent-browser`-driven manual pass: open Workers tab, switch to Web view,
  confirm fullscreen engages, drag pans, wheel zooms toward cursor, search
  highlights and centers a match, Escape/Exit returns to normal layout,
  clicking a node still opens its detail drawer.
- Confirm List view and the existing filter chips still work unchanged.
- Confirm no regression to the CSS/JS assets already fixed in the prior
  scaling pass (dashboard header pills, Content Hub photo lightbox).
