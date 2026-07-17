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

let statusCycleIndex = {};

function cycleToNextInState(state) {
  const matches = cards.filter((c) => (c.status?.state || "unknown") === state);
  if (!matches.length) return;
  const i = (statusCycleIndex[state] || 0) % matches.length;
  statusCycleIndex[state] = i + 1;
  expandCard(matches[i]);
}

setInterval(renderStatusStrip, 1000);

let lastCardCount = -1;
setInterval(() => {
  // Grid/compact recheck runs every tick (cheap at this scale) since
  // collapse state can change without the card count changing. The
  // count-gated block below is for heavier per-card work.
  applyAutoGrid();
  if (cards.length !== lastCardCount) {
    lastCardCount = cards.length;
    renderQuickJumpBadges();
  }
}, 300);
