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
