/* superuser.js — the dense, power-user view. Loaded after app.js (whose
   boot() already runs the full engine boot sequence, including session
   reconnect via session-restore.js), settings.js, mission.js,
   connections.js. Everything here is additive on top of those globals:
   cards, addCard, buildCard, openTerminal, expandCard, setColumns,
   removeCard, restartCard, setCollapsed, api, escapeHtml, profiles,
   startTerminal, STATUS_META, toggleBroadcast, TerminaSettings. */

document.getElementById("mode-toggle").addEventListener("click", () => {
  window.location.href = "/";
});

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
  // Collapsed tiles shrink themselves (align-self: start), but the grid's
  // own row height (styles.css's minmax(320px,...) / superuser.css's
  // minmax(220px,...)) still reserves full-size rows regardless — without
  // this, "compact" wastes exactly the vertical space it's meant to
  // reclaim. Shrink rows to content whenever every card is collapsed.
  const allCollapsed = cards.length > 0 && cards.every((c) => c.collapsed);
  wall.classList.toggle("su-compact-grid", allCollapsed);
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyAutoGrid, 150);
});

// ---- compact chrome -----------------------------------------------------

const COMPACT_THRESHOLD = 8;
let autoCompactSuggested = false;

function autoSuggestCompact(n) {
  if (n < COMPACT_THRESHOLD) {
    autoCompactSuggested = false;
    return;
  }
  // Only auto-collapse once per crossing into "above threshold" — this
  // runs every poll tick (see setInterval below), so without a latch it
  // would re-collapse every tile the instant a manual "expand all"
  // un-compacts them, making the Compact button look broken.
  if (autoCompactSuggested) return;
  autoCompactSuggested = true;
  for (const card of cards) {
    if (!card.collapsed) setCollapsed(card, true);
  }
}

document.getElementById("su-compact-all").addEventListener("click", () => {
  const anyExpanded = cards.some((c) => !c.collapsed);
  for (const card of cards) setCollapsed(card, anyExpanded);
  applyAutoGrid();
});

let lastCardCount = -1;
setInterval(() => {
  // Grid/compact recheck runs every tick (cheap at this scale) since
  // collapse state can change without the card count changing. The
  // count-gated block below is for heavier per-card work (Task 6+).
  applyAutoGrid();
  if (cards.length !== lastCardCount) {
    lastCardCount = cards.length;
  }
}, 300);
