/* Termina — a wall of named terminals. Add as many as you want; each is its own
   independent, fully-interactive terminal (real PTY over WebSocket, xterm.js).
   Name them whatever you like. Your layout persists between launches. */

const TOKEN = window.TERMINA_TOKEN;
const STORAGE_KEY = "termina.workspace.v1";

const TERM_THEME = {
  background: "#05070a",
  foreground: "#c9f5d8",
  cursor: "#59d085",
  selectionBackground: "#1f3a2b",
  black: "#0b0f14",
  green: "#59d085",
  brightGreen: "#7fe09c",
  red: "#ec2f45",
  yellow: "#e5b54b",
  blue: "#6fa7ff",
  cyan: "#28c4d8",
  white: "#c8d1dd",
};

let profiles = [];
let columns = 3;
let uidCounter = 0;
let broadcastOn = false;
let activeCardUid = null;
let openTileMenu = null;

// ---- per-card identity color -------------------------------------------------
// Distinct from status-pill colors (which mean thinking/running/failed/etc. —
// see styles.css). This is purely "which pane is which" at a glance across a
// wall of many terminals. Cycles deterministically so it never depends on
// card order shifting after a remove.
const CARD_COLORS = [
  "#5fd58c", // signature Termina green
  "#6fa7ff", // blue
  "#f0a25f", // amber
  "#d88bf0", // violet
  "#28c4d8", // cyan
  "#f06f9c", // rose
  "#a3e05f", // lime
  "#8b9bf0", // periwinkle
];
let cardColorCounter = 0;
function nextCardColor() {
  return CARD_COLORS[cardColorCounter++ % CARD_COLORS.length];
}

// ---- provider identity + status language ------------------------------------

const PROVIDER_ICON = {
  claude: "✳",
  codex: "◆",
  pwsh: "❯",
  cmd: "❯",
  wsl: "🐧",
  python: "🐍",
  node: "⬢",
};

function providerIcon(profileId) {
  return PROVIDER_ICON[profileId] || "❯";
}

function projectLabel(profileId) {
  return profiles.find((p) => p.id === profileId)?.projectName ?? "";
}

// Icon + text always — never rely on color alone for status.
const STATUS_META = {
  unknown: { icon: "○", label: "Unknown" },
  thinking: { icon: "●", label: "Thinking" },
  running: { icon: "⚡", label: "Running" },
  complete: { icon: "✓", label: "Complete" },
  waiting: { icon: "⏸", label: "Waiting" },
  needs_approval: { icon: "👤", label: "Needs Approval" },
  failed: { icon: "❌", label: "Failed" },
};

function emptyStatus() {
  return { state: "unknown", confidence: 0, ruleId: null, label: null, why: null, match: null };
}

// States where the CLI is actively blocked on the user reading and
// answering something, as opposed to just being idle/thinking/done.
// "waiting" is deliberately excluded — every detector pack (see
// detect/packs/*.js) uses it for a harmless idle prompt with nothing to
// read ("idle input prompt caret, no spinner active"); only
// "needs_approval" represents a real question blocking on the user.
const QUESTION_STATES = new Set(["needs_approval"]);

// Scrolls a terminal so a just-appeared prompt is visible from where it
// starts, not just wherever xterm's default bottom-follow happened to
// land. Tries to find the detector's own matched trigger text in the
// buffer first (most precise); falls back to a fixed look-back if that
// text can't be found (e.g. it was ANSI-styled differently than its
// plain-text match, or truncated at the detector's 160-char cap).
function scrollToPromptStart(term, matchText) {
  const buf = term.buffer.active;
  const needle = (matchText || "").trim().slice(0, 40);
  const bottomLine = buf.length - 1;
  let foundLine = -1;
  if (needle) {
    const searchDepth = Math.min(bottomLine, 200);
    for (let y = bottomLine; y >= bottomLine - searchDepth; y -= 1) {
      const line = buf.getLine(y);
      if (line && line.translateToString(true).includes(needle)) {
        foundLine = y;
        break;
      }
    }
  }
  const contextLines = 3;
  const target = foundLine >= 0 ? foundLine - contextLines : bottomLine - 15;
  term.scrollToLine(Math.max(0, target));
}

// "Jump to bottom" affordance: a terminal that's been scrolled up (to
// read a question, scrollback, whatever) shouldn't require hunting for
// where "the bottom" is again, especially useful once a scroll-to-prompt
// (above) has deliberately moved the view away from it.
function attachJumpToBottom(term, container) {
  container.querySelector(".jump-to-bottom")?.remove(); // openTerminal can re-run (restart) on the same container
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "jump-to-bottom hidden";
  btn.textContent = "↓ Jump to bottom";
  btn.addEventListener("click", () => term.scrollToBottom());
  container.appendChild(btn);
  term.onScroll(() => {
    const buf = term.buffer.active;
    btn.classList.toggle("hidden", buf.viewportY >= buf.baseY);
  });
  return btn;
}

function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// Each card: { uid, name, profileId, linked, sessionId, term, fit, ws, ro, disposed, lastAlert }
const cards = [];

// Attention patterns — windows watch their own output and flag when they need you.
const ALERT_ERROR = /\b(error|failed|failure|exception|fatal|panic|denied|refused)\b/i;
const ALERT_ATTN = /(\(y\/n\)|\[y\/n\]|password:|passphrase|are you sure|overwrite\?|press any key|do you want to|confirm|waiting for|\?\s*$)/i;

const api = (path, options = {}) =>
  fetch(path, { ...options, headers: { "x-termina-token": TOKEN, ...(options.headers || {}) } });

const uid = () => `c${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---- persistence ------------------------------------------------------------

function saveWorkspace() {
  try {
    // Column preference always persists. Per-card name/color are also
    // remembered, keyed by sessionId, purely so a *reconnected* live
    // session (see session-restore.js) can recover its name/color —
    // terminals that aren't currently running still don't come back on
    // their own; a card without a sessionId isn't worth persisting.
    const cardEntries = cards
      .filter((c) => c.sessionId)
      .map((c) => ({ sessionId: c.sessionId, name: c.name, color: c.color }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns, cards: cardEntries }));
  } catch {
    /* storage unavailable */
  }
}

function loadWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---- engine / profiles ------------------------------------------------------

async function loadProfiles() {
  const tagline = document.getElementById("tagline");
  try {
    const res = await api("/api/profiles");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "unavailable");
    profiles = data.profiles;
    tagline.textContent = "Workflow Manager";
    tagline.classList.remove("offline");
    // Refresh option lists in any existing cards.
    for (const card of cards) {
      const sel = document.querySelector(`.tile[data-uid="${card.uid}"] .instance-select`);
      if (sel) sel.innerHTML = optionHtml(card.profileId);
      renderProject(card);
    }
  } catch (err) {
    tagline.textContent = "engine offline";
    tagline.classList.add("offline");
  }
}

function profileLabel(id) {
  return profiles.find((p) => p.id === id)?.label ?? "";
}

function optionHtml(selectedId) {
  return (
    `<option value="">Choose terminal…</option>` +
    profiles.map((p) => `<option value="${p.id}"${p.id === selectedId ? " selected" : ""}>${escapeHtml(p.label)}</option>`).join("")
  );
}

// ---- card lifecycle ---------------------------------------------------------

function addCard(init = {}, { save = true, start = false } = {}) {
  const card = {
    uid: uid(),
    name: init.name ?? "",
    mission: init.mission ?? "",
    role: init.role ?? null,
    lastLedgerEvent: null,
    profileId: init.profileId ?? null,
    color: init.color ?? nextCardColor(),
    linked: Boolean(init.linked),
    sessionId: null,
    startedAt: null,
    status: emptyStatus(),
    collapsed: false,
    term: null,
    fit: null,
    ws: null,
    ro: null,
    disposed: false,
    lastAlert: 0,
  };
  cards.push(card);
  document.getElementById("wall").insertBefore(buildCard(card), document.getElementById("add-card"));
  updateWallEmptyState();
  if (save) saveWorkspace();
  if (start && card.profileId) startTerminal(card);
  return card;
}

// When there are no terminals, present just a friendly centered + instead of a
// full-size empty tile.
function updateWallEmptyState() {
  document.getElementById("wall").classList.toggle("wall-empty", cards.length === 0);
}

function removeCard(card) {
  if (openTileMenu?.card === card) closeTileMenu();
  disposeTerm(card);
  if (card.sessionId) api(`/api/sessions/${card.sessionId}/stop`, { method: "POST" }).catch(() => {});
  const idx = cards.indexOf(card);
  if (idx >= 0) cards.splice(idx, 1);
  document.querySelector(`.tile[data-uid="${card.uid}"]`)?.remove();
  updateWallEmptyState();
  saveWorkspace();
}

function buildCard(card) {
  const el = document.createElement("article");
  el.className = "tile";
  el.dataset.uid = card.uid;
  el.style.setProperty("--card-color", card.color);

  const head = document.createElement("div");
  head.className = "tile-head";

  const icon = document.createElement("span");
  icon.className = "tile-icon";
  icon.textContent = card.profileId ? providerIcon(card.profileId) : "❯";

  const name = document.createElement("input");
  name.className = "tile-name";
  name.value = card.name;
  name.placeholder = card.profileId ? profileLabel(card.profileId) : "Name this window";
  name.setAttribute("aria-label", "Window name");
  name.addEventListener("input", () => {
    card.name = name.value;
    saveWorkspace();
  });

  const select = document.createElement("select");
  select.className = "instance-select";
  select.setAttribute("aria-label", "Terminal type");
  select.innerHTML = optionHtml(card.profileId);
  select.addEventListener("change", () => setCardProfile(card, select.value));

  const pill = document.createElement("span");
  pill.className = "status-pill";
  pill.dataset.state = card.status.state;
  pill.textContent = `${STATUS_META.unknown.icon} ${STATUS_META.unknown.label}`;

  const menu = buildTileMenu(card);

  const remove = document.createElement("button");
  remove.className = "tile-remove";
  remove.type = "button";
  remove.title = "Remove window";
  remove.setAttribute("aria-label", "Remove window");
  remove.textContent = "×";
  remove.addEventListener("click", () => removeCard(card));

  head.append(icon, name, select, pill, menu.button, remove);

  const meta = document.createElement("div");
  meta.className = "tile-meta";

  const mission = document.createElement("input");
  mission.className = "tile-mission";
  mission.placeholder = "Mission (optional)";
  mission.value = card.mission;
  mission.setAttribute("aria-label", "Mission");
  mission.addEventListener("input", () => {
    card.mission = mission.value;
  });

  const metaRight = document.createElement("span");
  metaRight.className = "tile-meta-right";
  if (card.role) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "tile-mission-badge";
    badge.textContent = `▤ Worker ${card.role.index}`;
    badge.title = "Open Mission Command Center";
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      if (typeof window.openMissionCenter === "function") window.openMissionCenter(card.role.missionId);
    });
    metaRight.appendChild(badge);
  }
  const project = document.createElement("span");
  project.className = "tile-project";
  project.textContent = projectLabel(card.profileId);
  const model = document.createElement("span");
  model.className = "tile-model";
  const runtime = document.createElement("span");
  runtime.className = "tile-runtime";
  metaRight.append(project, model, runtime);

  meta.append(mission, metaRight);

  const alert = document.createElement("span");
  alert.className = "tile-alert";
  alert.title = "New activity";
  el.appendChild(alert);
  if (card.linked) el.classList.add("linked");

  // In Link mode, Shift+click a terminal to link/unlink it. Capture phase so
  // the terminal underneath doesn't swallow the gesture.
  el.addEventListener(
    "mousedown",
    (e) => {
      if (broadcastOn && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        card.linked = !card.linked;
        el.classList.toggle("linked", card.linked);
      }
    },
    true,
  );

  // A collapsed card re-expands on click anywhere except its own controls.
  el.addEventListener("click", (e) => {
    if (!card.collapsed) return;
    if (e.target.closest("input,select,button")) return;
    setCollapsed(card, false);
  });

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

  const inspector = document.createElement("div");
  inspector.className = "tile-inspector hidden";

  el.append(head, meta, screen, inspector, menu.list);
  return el;
}

// ---- overflow menu (Restart / Clear / Expand / Collapse / dev inspector) ----

function closeTileMenu() {
  if (!openTileMenu) return;
  openTileMenu.list.classList.add("hidden");
  openTileMenu.button.setAttribute("aria-expanded", "false");
  openTileMenu = null;
}

function buildTileMenu(card) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tile-menu-btn";
  button.textContent = "⋯";
  button.title = "More actions";
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");

  const list = document.createElement("div");
  list.className = "tile-menu-list hidden";

  const entry = { button, list, card };

  const addItem = (label, onClick) => {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    item.addEventListener("click", () => {
      closeTileMenu();
      onClick();
    });
    list.appendChild(item);
    return item;
  };

  addItem("Restart", () => restartCard(card));
  addItem("Clear", () => card.term?.clear());
  addItem("Expand", () => expandCard(card));
  const collapseItem = addItem("Collapse", () => setCollapsed(card, !card.collapsed));
  addItem("Inspect detection", () => toggleInspector(card));

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (openTileMenu === entry) {
      closeTileMenu();
      return;
    }
    closeTileMenu();
    // Collapse only makes sense once the card is already collapsed (to offer
    // "Expand" back) or has reached a finished state.
    collapseItem.textContent = card.collapsed ? "Expand" : "Collapse";
    collapseItem.disabled = !card.collapsed && !["complete", "failed"].includes(card.status.state);
    list.classList.remove("hidden");
    button.setAttribute("aria-expanded", "true");
    openTileMenu = entry;
  });

  return entry;
}

function setCollapsed(card, collapsed) {
  card.collapsed = collapsed;
  document.querySelector(`.tile[data-uid="${card.uid}"]`)?.classList.toggle("collapsed", collapsed);
}

function toggleInspector(card) {
  const el = document.querySelector(`.tile[data-uid="${card.uid}"] .tile-inspector`);
  if (!el) return;
  const willShow = el.classList.contains("hidden");
  el.classList.toggle("hidden", !willShow);
  if (willShow) renderInspector(card);
}

function renderInspector(card) {
  const el = document.querySelector(`.tile[data-uid="${card.uid}"] .tile-inspector`);
  if (!el || el.classList.contains("hidden")) return;
  const s = card.status;
  el.innerHTML =
    `<div><b>State</b> ${escapeHtml(s.state)}</div>` +
    `<div><b>Confidence</b> ${Math.round((s.confidence ?? 0) * 100)}%</div>` +
    `<div><b>Rule</b> ${escapeHtml(s.ruleId ?? "—")}</div>` +
    `<div><b>Why</b> ${escapeHtml(s.why ?? "—")}</div>` +
    `<div><b>Match</b> ${escapeHtml(s.match ?? "—")}</div>`;
}

// ---- status pill + project/runtime rendering --------------------------------

function renderStatus(card) {
  const pill = document.querySelector(`.tile[data-uid="${card.uid}"] .status-pill`);
  if (pill) {
    const meta = STATUS_META[card.status.state] || STATUS_META.unknown;
    pill.dataset.state = card.status.state;
    pill.textContent = `${meta.icon} ${meta.label}`;
    pill.title = card.status.why || "";
  }
  renderInspector(card);
}

function renderProject(card) {
  const el = document.querySelector(`.tile[data-uid="${card.uid}"] .tile-project`);
  if (el) el.textContent = projectLabel(card.profileId);
}

// Friendly names for the raw model ids the token tracker reports (see
// mission/tokens.js) — a worker's actual model isn't knowable from its
// provider alone (e.g. "claude" can run several models), so this is only
// ever populated once real usage data has been found for that worker.
const MODEL_LABELS = {
  "claude-fable-5": "Claude - Fable 5",
  "claude-sonnet-5": "Claude - Sonnet 5",
  "claude-opus-4-8": "Claude - Opus 4.8",
  "claude-haiku-4-5-20251001": "Claude - Haiku 4.5",
};

function modelLabel(modelId) {
  return MODEL_LABELS[modelId] || modelId;
}

function renderModel(card) {
  const el = document.querySelector(`.tile[data-uid="${card.uid}"] .tile-model`);
  if (!el) return;
  if (!card.tokenModel) {
    el.textContent = "";
    return;
  }
  el.textContent = card.tokenEstimated ? `~${modelLabel(card.tokenModel)}` : modelLabel(card.tokenModel);
  el.title = card.tokenEstimated
    ? "Estimated — no real usage data found yet for this worker"
    : "Model in use, from this worker's real session data";
}

function renderRuntime(card) {
  const el = document.querySelector(`.tile[data-uid="${card.uid}"] .tile-runtime`);
  if (!el) return;
  el.textContent = card.startedAt ? formatElapsed(Date.now() - card.startedAt) : "";
}

setInterval(() => {
  for (const card of cards) {
    if (card.startedAt) renderRuntime(card);
  }
}, 1000);

function setCardProfile(card, profileId) {
  card.profileId = profileId || null;
  // Update the name placeholder to the type if unnamed.
  const nameEl = document.querySelector(`.tile[data-uid="${card.uid}"] .tile-name`);
  if (nameEl) nameEl.placeholder = card.profileId ? profileLabel(card.profileId) : "Name this window";
  const iconEl = document.querySelector(`.tile[data-uid="${card.uid}"] .tile-icon`);
  if (iconEl) iconEl.textContent = card.profileId ? providerIcon(card.profileId) : "❯";
  renderProject(card);
  saveWorkspace();
  if (card.profileId) startTerminal(card);
  else {
    if (card.sessionId) api(`/api/sessions/${card.sessionId}/stop`, { method: "POST" }).catch(() => {});
    disposeTerm(card);
    setCardStatus(card, false);
    resetPlaceholder(card);
    card.startedAt = null;
    card.status = emptyStatus();
    renderStatus(card);
    renderRuntime(card);
  }
}

async function startTerminal(card) {
  const sessionId = `${card.uid}-${(uidCounter++).toString(36)}`;
  try {
    const res = await api(`/api/sessions/${sessionId}/start`, {
      method: "POST",
      body: JSON.stringify({ profile: card.profileId, cols: 100, rows: 28 }),
    });
    const data = await res.json();
    if (!data.ok) {
      flashCard(card, data.error || "failed to start");
      return;
    }
    card.startedAt = data.session?.startedAt ? new Date(data.session.startedAt).getTime() : Date.now();
    card.status = emptyStatus();
    renderStatus(card);
    renderRuntime(card);
    openTerminal(card, sessionId);
  } catch {
    flashCard(card, "start request failed");
  }
}

function openTerminal(card, sessionId) {
  const host = document.getElementById(`term-${card.uid}`);
  if (!host) return;
  disposeTerm(card);
  card.sessionId = sessionId;
  card.disposed = false;

  document.querySelector(`.tile[data-uid="${card.uid}"]`)?.classList.add("live");

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
    fontSize: 12,
    theme: TERM_THEME,
    scrollback: 5000,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  attachJumpToBottom(term, host.parentElement);
  try {
    fit.fit();
  } catch {
    /* not visible yet */
  }

  const ws = new WebSocket(`ws://${location.host}/pty?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(TOKEN)}`);
  card.term = term;
  card.fit = fit;
  card.ws = ws;

  ws.onopen = () => sendResize(card);
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "output") {
        term.write(msg.data);
        if (card.uid !== activeCardUid) markActivity(card, msg.data);
      } else if (msg.type === "status") {
        const prevState = card.status.state;
        card.status = {
          state: msg.state,
          confidence: msg.confidence,
          ruleId: msg.ruleId,
          label: msg.label,
          why: msg.why,
          match: msg.match,
        };
        renderStatus(card);
        // A prompt just appeared, not just another ping of an
        // already-known one: xterm's default "stick to bottom on new
        // output" often leaves only the tail of a multi-line question
        // visible, so you'd have to manually scroll up to see what's
        // actually being asked. Jump the view to where it starts instead.
        if (QUESTION_STATES.has(card.status.state) && !QUESTION_STATES.has(prevState)) {
          scrollToPromptStart(term, card.status.match);
        }
        if (card.role && typeof window.onMissionActivity === "function") window.onMissionActivity(card);
      } else if (msg.type === "ledger") {
        card.lastLedgerEvent = msg.event;
        if (card.role && typeof window.onMissionActivity === "function") window.onMissionActivity(card);
      } else if (msg.type === "tokens") {
        if (msg.model) {
          card.tokenModel = msg.model;
          card.tokenEstimated = Boolean(msg.estimated);
          renderModel(card);
        }
      }
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    if (!card.disposed) term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n");
  };
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    // Broadcast: fan the same keystrokes out to every other linked terminal.
    if (broadcastOn && card.linked) {
      for (const other of cards) {
        if (other !== card && other.linked && other.ws && other.ws.readyState === WebSocket.OPEN) {
          other.ws.send(JSON.stringify({ type: "input", data }));
        }
      }
    }
  });
  host.addEventListener("focusin", () => {
    activeCardUid = card.uid;
    clearActivity(card);
  });
  const ro = new ResizeObserver(() => {
    try {
      fit.fit();
      sendResize(card);
    } catch {
      /* ignore */
    }
  });
  ro.observe(host);
  card.ro = ro;
  setCardStatus(card, true);
  term.focus();
}

function sendResize(card) {
  if (card.ws && card.ws.readyState === WebSocket.OPEN && card.term) {
    card.ws.send(JSON.stringify({ type: "resize", cols: card.term.cols, rows: card.term.rows }));
  }
}

async function restartCard(card) {
  if (!card.profileId) return;
  if (card.sessionId) api(`/api/sessions/${card.sessionId}/stop`, { method: "POST" }).catch(() => {});
  disposeTerm(card);
  await startTerminal(card);
}

function disposeTerm(card) {
  card.disposed = true;
  try {
    card.ro?.disconnect();
  } catch {
    /* ignore */
  }
  try {
    card.ws?.close();
  } catch {
    /* ignore */
  }
  try {
    card.term?.dispose();
  } catch {
    /* ignore */
  }
  card.ro = null;
  card.ws = null;
  card.term = null;
  card.sessionId = null;
}

function setCardStatus(card, live) {
  document.querySelector(`.tile[data-uid="${card.uid}"]`)?.classList.toggle("live", live);
}

function resetPlaceholder(card) {
  const ph = document.querySelector(`.tile[data-uid="${card.uid}"] .placeholder`);
  if (ph) ph.innerHTML = `<p class="big">EMPTY</p><p>Pick a terminal type to open one here.</p>`;
}

function flashCard(card, message) {
  const ph = document.querySelector(`.tile[data-uid="${card.uid}"] .placeholder`);
  if (ph) ph.innerHTML = `<p class="big err">ERROR</p><p>${escapeHtml(message)}</p>`;
}

// ---- reactive attention -----------------------------------------------------

function markActivity(card, data) {
  const el = document.querySelector(`.tile[data-uid="${card.uid}"]`);
  if (!el) return;
  el.classList.add("has-activity");
  const text = String(data);
  let level = "info";
  if (ALERT_ERROR.test(text)) level = "error";
  else if (ALERT_ATTN.test(text)) level = "attn";
  if (level !== "info") {
    el.classList.remove("alert-info", "alert-error", "alert-attn");
    el.classList.add(`alert-${level}`);
    notifyAttention(card, level);
  } else if (!el.classList.contains("alert-error") && !el.classList.contains("alert-attn")) {
    el.classList.add("alert-info");
  }
}

function clearActivity(card) {
  const el = document.querySelector(`.tile[data-uid="${card.uid}"]`);
  if (el) el.classList.remove("has-activity", "alert-info", "alert-attn", "alert-error");
}

function notifyAttention(card, level) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const now = Date.now();
  if (now - (card.lastAlert || 0) < 8000) return; // cooldown so we don't spam
  card.lastAlert = now;
  const label = card.name || profileLabel(card.profileId) || "A terminal";
  try {
    const n = new Notification("Termina", {
      body: level === "error" ? `${label} reported an error.` : `${label} is waiting for you.`,
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      card.term?.focus();
    };
  } catch {
    /* notifications unavailable */
  }
}

// ---- broadcast --------------------------------------------------------------

function toggleBroadcast(force) {
  broadcastOn = typeof force === "boolean" ? force : !broadcastOn;
  document.body.classList.toggle("broadcast-mode", broadcastOn);
  document.getElementById("broadcast-banner").classList.toggle("hidden", !broadcastOn);
  const btn = document.getElementById("broadcast");
  btn.classList.toggle("active", broadcastOn);
  btn.setAttribute("aria-pressed", String(broadcastOn));
  saveWorkspace();
}

// Ctrl/Cmd+A while Link mode is on links every terminal at once — the
// select-all equivalent of Shift-clicking each tile individually.
function linkAllCards() {
  for (const card of cards) {
    card.linked = true;
    document.querySelector(`.tile[data-uid="${card.uid}"]`)?.classList.add("linked");
  }
}

// ---- expand overlay ---------------------------------------------------------

let overlayCard = null;
function expandCard(card) {
  if (!card.sessionId) return;
  const overlay = document.getElementById("overlay");
  const host = document.getElementById("overlay-term");
  document.getElementById("overlay-title").textContent = card.name || profileLabel(card.profileId) || "Terminal";
  overlay.classList.remove("hidden");
  host.innerHTML = "";

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
    fontSize: 14,
    theme: TERM_THEME,
    scrollback: 8000,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  attachJumpToBottom(term, host);

  const ws = new WebSocket(`ws://${location.host}/pty?session=${encodeURIComponent(card.sessionId)}&token=${encodeURIComponent(TOKEN)}`);
  overlayCard = { card, term, fit, ws };

  // Fit-then-resize, always in that order: fit.fit() is what actually
  // measures the (now-visible) overlay and sets term.cols/rows to match
  // it. Sending the resize from ws.onopen alone — before fit had ever
  // run — sent xterm's untouched default size (80x24) to the real PTY,
  // so the shell kept rendering for a tiny terminal inside a huge empty
  // box. Called from both onopen and the deferred fit below since either
  // can legitimately run first; both branches always fit right before
  // sending, so whichever fires last is the one that sticks.
  function syncOverlaySize() {
    try {
      fit.fit();
    } catch {
      /* not laid out yet */
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  }
  ws.onopen = syncOverlaySize;
  setTimeout(syncOverlaySize, 30);

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "output") term.write(msg.data);
    } catch {
      /* ignore */
    }
  };
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
  });
  term.focus();
}

function closeOverlay() {
  document.getElementById("overlay").classList.add("hidden");
  if (overlayCard) {
    const { card } = overlayCard;
    try {
      overlayCard.ws?.close();
    } catch {
      /* ignore */
    }
    try {
      overlayCard.term?.dispose();
    } catch {
      /* ignore */
    }
    overlayCard = null;
    // The overlay resized the PTY to fit its own (larger) viewport —
    // it's the same underlying process as the small tile, which the tile
    // never re-measures on its own since its own DOM size never changed.
    // Snap it back to the tile's actual size now that the overlay's gone.
    try {
      card.fit?.fit();
      sendResize(card);
    } catch {
      /* ignore */
    }
  }
}

// ---- columns ----------------------------------------------------------------

function setColumns(n, { fillEmpty = false } = {}) {
  columns = n;
  // Choosing a column count from the toolbar is also "show me N terminals
  // side by side" — top up empty (choose-type-later) tiles so the layout is
  // actually visible instead of silently doing nothing on a fresh, empty
  // wall. Never removes existing cards, never auto-starts a terminal
  // type/process, and only applies for the explicit toolbar click — not on
  // boot, which stays "launch clean, no terminals restored."
  if (fillEmpty) while (cards.length < n) addCard({}, { save: false });
  document.getElementById("wall").className = `wall cols-${n}`;
  updateWallEmptyState();
  document.querySelectorAll(".cols-switch button").forEach((b) => b.classList.toggle("active", Number(b.dataset.cols) === n));
  // Re-fit visible terminals.
  for (const card of cards) {
    try {
      card.fit?.fit();
      sendResize(card);
    } catch {
      /* ignore */
    }
  }
  saveWorkspace();
}

// ---- boot -------------------------------------------------------------------

function ensureAddCard() {
  const wall = document.getElementById("wall");
  let add = document.getElementById("add-card");
  if (!add) {
    add = document.createElement("button");
    add.id = "add-card";
    add.className = "add-card";
    add.type = "button";
    add.setAttribute("aria-label", "New terminal");
    add.title = "New terminal";
    add.innerHTML = `<span class="plus">+</span><span class="add-hint">Open a terminal · Ctrl N</span>`;
    add.addEventListener("click", (e) => {
      // First time (empty wall): offer to create several at once, right where
      // you clicked. After that, a quick single add.
      if (cards.length === 0) {
        e.stopPropagation();
        openNewMenuAt(e.clientX - 132, e.clientY - 16);
      } else {
        addCard({}, { start: false });
      }
    });
    wall.appendChild(add);
  }
}

async function boot() {
  ensureAddCard();
  await loadProfiles();

  // Ask once for permission so background terminals can ping you.
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    try {
      Notification.requestPermission();
    } catch {
      /* ignore */
    }
  }

  // Reconnect to anything still running server-side (reload, app
  // restart) instead of always launching clean. Cards that were merely
  // *saved* but never started still don't come back — only live PTYs do.
  if (typeof restoreSessions === "function") await restoreSessions();

  const saved = loadWorkspace();
  setColumns(saved && saved.columns ? saved.columns : 3);
}

// ---- new-terminal popover (add one or many at once) ------------------------

function populateNewMenu() {
  const sel = document.getElementById("new-menu-type");
  if (!sel) return;
  sel.innerHTML =
    `<option value="">Empty (choose later)</option>` +
    profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join("");
}

// Open the add panel anchored to where the user acted (a click point or an
// element), so it shows up right where they clicked — not off in a corner.
function openNewMenuAt(x, y) {
  const menu = document.getElementById("new-menu");
  const mw = 264;
  const mh = 210;
  const left = Math.min(Math.max(12, x), window.innerWidth - mw - 12);
  const top = Math.min(Math.max(64, y), window.innerHeight - mh - 12);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.right = "auto";
  menu.classList.remove("hidden");
  document.getElementById("new-term").setAttribute("aria-expanded", "true");
  populateNewMenu();
  setTimeout(() => document.getElementById("new-menu-count")?.focus(), 0);
}

function closeNewMenu() {
  document.getElementById("new-menu").classList.add("hidden");
  document.getElementById("new-term").setAttribute("aria-expanded", "false");
}

function toggleNewMenu(show) {
  const menu = document.getElementById("new-menu");
  const isHidden = menu.classList.contains("hidden");
  const open = show ?? isHidden;
  if (!open) {
    closeNewMenu();
    return;
  }
  // Default position: just under the top-right + button.
  const r = document.getElementById("new-term").getBoundingClientRect();
  openNewMenuAt(r.left - 200, r.bottom + 8);
}

document.getElementById("new-term").addEventListener("click", (e) => {
  e.stopPropagation();
  if (document.getElementById("new-menu").classList.contains("hidden")) {
    openNewMenuAt(e.clientX - 130, e.clientY + 10);
  } else {
    closeNewMenu();
  }
});

function submitNewMenu() {
  const type = document.getElementById("new-menu-type").value || null;
  let count = parseInt(document.getElementById("new-menu-count").value, 10);
  if (!Number.isFinite(count) || count < 1) count = 1;
  count = Math.min(count, 24);
  let delay = 0;
  for (let i = 0; i < count; i += 1) {
    const card = addCard({ profileId: type }, { save: false });
    if (type) {
      setTimeout(() => startTerminal(card), delay);
      delay += 160;
    }
  }
  saveWorkspace();
  closeNewMenu();
}

document.getElementById("new-menu-add").addEventListener("click", submitNewMenu);

// Enter anywhere in the add panel creates the terminal(s).
document.getElementById("new-menu").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitNewMenu();
  }
});

document.addEventListener("click", (e) => {
  const menu = document.getElementById("new-menu");
  const btn = document.getElementById("new-term");
  if (!menu.classList.contains("hidden") && !menu.contains(e.target) && !btn.contains(e.target)) {
    closeNewMenu();
  }
  if (openTileMenu && !openTileMenu.list.contains(e.target) && !openTileMenu.button.contains(e.target)) {
    closeTileMenu();
  }
});

document.getElementById("mode-toggle")?.addEventListener("click", () => {
  window.location.href = "/superuser.html";
});
document.getElementById("rescan").addEventListener("click", loadProfiles);
document.getElementById("broadcast").addEventListener("click", () => toggleBroadcast());
document.querySelectorAll(".cols-switch button").forEach((btn) => {
  btn.addEventListener("click", () => setColumns(Number(btn.dataset.cols), { fillEmpty: true }));
});
document.getElementById("overlay-close").addEventListener("click", closeOverlay);
document.getElementById("overlay").addEventListener("click", (e) => {
  if (e.target.id === "overlay") closeOverlay();
});

// Ctrl/Cmd+N opens the same add panel as the + button. Capture phase so it
// works even while a terminal has focus (xterm would otherwise eat the key).
document.addEventListener(
  "keydown",
  (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      e.stopPropagation();
      toggleNewMenu();
    }
  },
  true,
);

// Ctrl/Cmd+A links every terminal at once, but only while Link mode is on —
// otherwise it's just normal text selection. Capture phase so it works even
// while a terminal has focus (xterm would otherwise eat the key).
document.addEventListener(
  "keydown",
  (e) => {
    if (!broadcastOn) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      e.stopPropagation();
      linkAllCards();
    }
  },
  true,
);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!document.getElementById("overlay").classList.contains("hidden")) closeOverlay();
  else if (!document.getElementById("new-menu").classList.contains("hidden")) closeNewMenu();
  else if (openTileMenu) closeTileMenu();
});
window.addEventListener("beforeunload", () => {
  for (const card of cards) {
    try {
      card.ws?.close();
    } catch {
      /* ignore */
    }
  }
});

boot();
