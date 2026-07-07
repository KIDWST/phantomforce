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
    // Only the column preference is remembered — terminals start fresh each launch.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ columns }));
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
    profileId: init.profileId ?? null,
    linked: init.linked !== false,
    sessionId: null,
    term: null,
    fit: null,
    ws: null,
    ro: null,
    disposed: false,
    lastAlert: 0,
  };
  cards.push(card);
  document.getElementById("wall").insertBefore(buildCard(card), document.getElementById("add-card"));
  if (save) saveWorkspace();
  if (start && card.profileId) startTerminal(card);
  return card;
}

function removeCard(card) {
  disposeTerm(card);
  if (card.sessionId) api(`/api/sessions/${card.sessionId}/stop`, { method: "POST" }).catch(() => {});
  const idx = cards.indexOf(card);
  if (idx >= 0) cards.splice(idx, 1);
  document.querySelector(`.tile[data-uid="${card.uid}"]`)?.remove();
  saveWorkspace();
}

function buildCard(card) {
  const el = document.createElement("article");
  el.className = "tile";
  el.dataset.uid = card.uid;

  const head = document.createElement("div");
  head.className = "tile-head";

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

  const link = document.createElement("button");
  link.className = `tile-link${card.linked ? " on" : ""}`;
  link.type = "button";
  link.title = "Link this terminal (typing goes to all linked terminals)";
  link.setAttribute("aria-label", "Link this terminal");
  link.textContent = "⇉";
  link.addEventListener("click", () => {
    card.linked = !card.linked;
    link.classList.toggle("on", card.linked);
    document.querySelector(`.tile[data-uid="${card.uid}"]`)?.classList.toggle("linked", card.linked);
    saveWorkspace();
  });

  const remove = document.createElement("button");
  remove.className = "tile-remove";
  remove.type = "button";
  remove.title = "Remove window";
  remove.setAttribute("aria-label", "Remove window");
  remove.textContent = "×";
  remove.addEventListener("click", () => removeCard(card));

  head.append(name, select, link, remove);

  const alert = document.createElement("span");
  alert.className = "tile-alert";
  alert.title = "New activity";
  el.appendChild(alert);
  if (card.linked) el.classList.add("linked");

  const screen = document.createElement("div");
  screen.className = "screen";
  const host = document.createElement("div");
  host.className = "term-host";
  host.id = `term-${card.uid}`;
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.innerHTML = `<p class="big">EMPTY</p><p>Pick a terminal type to open one here.</p>`;
  screen.append(host, placeholder);

  const actions = document.createElement("div");
  actions.className = "tile-actions";
  actions.appendChild(smallBtn("Restart", "", () => restartCard(card)));
  actions.appendChild(smallBtn("Clear", "", () => card.term?.clear()));
  actions.appendChild(smallBtn("Expand", "", () => expandCard(card)));

  el.append(head, screen, actions);
  return el;
}

function smallBtn(label, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function setCardProfile(card, profileId) {
  card.profileId = profileId || null;
  // Update the name placeholder to the type if unnamed.
  const nameEl = document.querySelector(`.tile[data-uid="${card.uid}"] .tile-name`);
  if (nameEl) nameEl.placeholder = card.profileId ? profileLabel(card.profileId) : "Name this window";
  saveWorkspace();
  if (card.profileId) startTerminal(card);
  else {
    if (card.sessionId) api(`/api/sessions/${card.sessionId}/stop`, { method: "POST" }).catch(() => {});
    disposeTerm(card);
    setCardStatus(card, false);
    resetPlaceholder(card);
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
  setTimeout(() => {
    try {
      fit.fit();
    } catch {
      /* ignore */
    }
  }, 30);

  const ws = new WebSocket(`ws://${location.host}/pty?session=${encodeURIComponent(card.sessionId)}&token=${encodeURIComponent(TOKEN)}`);
  overlayCard = { term, fit, ws };
  ws.onopen = () => ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
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
  }
}

// ---- columns ----------------------------------------------------------------

function setColumns(n) {
  columns = n;
  document.getElementById("wall").className = `wall cols-${n}`;
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
    add.innerHTML = `<span class="plus">+</span>`;
    add.addEventListener("click", () => addCard({}, { start: false }));
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

  // Launch clean — no terminals open, just the + tile. We remember your
  // column choice, but you open the terminals you want each session.
  const saved = loadWorkspace();
  setColumns(saved && saved.columns ? saved.columns : 3);
}

// ---- command palette --------------------------------------------------------

let paletteItems = [];
let paletteIndex = 0;

function paletteActions() {
  const acts = [];
  for (const p of profiles) {
    acts.push({
      label: `New ${p.label}`,
      hint: "terminal",
      run: () => {
        const c = addCard({ profileId: p.id }, { save: false });
        startTerminal(c);
        saveWorkspace();
      },
    });
  }
  acts.push({ label: "New empty window", hint: "terminal", run: () => addCard({}, { start: false }) });
  acts.push({ label: broadcastOn ? "Link: turn OFF" : "Link: turn ON", hint: "action", run: () => toggleBroadcast() });
  for (const n of [2, 3, 4]) acts.push({ label: `Columns: ${n}`, hint: "layout", run: () => setColumns(n) });
  acts.push({ label: "Clear all terminals", hint: "action", run: () => cards.forEach((c) => c.term?.clear()) });
  acts.push({ label: "Restart all terminals", hint: "action", run: () => cards.forEach((c) => c.profileId && restartCard(c)) });
  acts.push({ label: "Kill all terminals", hint: "action", run: () => [...cards].forEach(removeCard) });
  cards.forEach((c, i) => {
    const label = c.name || profileLabel(c.profileId) || `Window ${i + 1}`;
    if (c.sessionId) acts.push({ label: `Focus: ${label}`, hint: "jump", run: () => c.term?.focus() });
  });
  return acts;
}

function fuzzy(q, s) {
  q = q.toLowerCase();
  s = s.toLowerCase();
  if (!q) return true;
  let i = 0;
  for (const ch of s) if (ch === q[i]) i += 1;
  return i === q.length;
}

function renderPalette() {
  const q = document.getElementById("palette-input").value.trim();
  const all = paletteActions();
  paletteItems = all.filter((a) => fuzzy(q, a.label));
  paletteIndex = 0;
  const list = document.getElementById("palette-list");
  list.innerHTML = paletteItems
    .map(
      (a, i) =>
        `<li class="${i === 0 ? "sel" : ""}" data-i="${i}"><span>${escapeHtml(a.label)}</span><em>${a.hint}</em></li>`,
    )
    .join("");
  list.querySelectorAll("li").forEach((li) => {
    li.addEventListener("mouseenter", () => setPaletteIndex(Number(li.dataset.i)));
    li.addEventListener("click", () => runPalette());
  });
}

function setPaletteIndex(i) {
  paletteIndex = Math.max(0, Math.min(i, paletteItems.length - 1));
  document.querySelectorAll("#palette-list li").forEach((li, idx) => li.classList.toggle("sel", idx === paletteIndex));
}

function runPalette() {
  const item = paletteItems[paletteIndex];
  togglePalette(false);
  if (item) item.run();
}

function togglePalette(show) {
  const pal = document.getElementById("palette");
  const open = show ?? pal.classList.contains("hidden");
  pal.classList.toggle("hidden", !open);
  if (open) {
    const input = document.getElementById("palette-input");
    input.value = "";
    renderPalette();
    input.focus();
  }
}

// ---- new-terminal popover (add one or many at once) ------------------------

function populateNewMenu() {
  const sel = document.getElementById("new-menu-type");
  if (!sel) return;
  sel.innerHTML =
    `<option value="">Empty (choose later)</option>` +
    profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join("");
}

function toggleNewMenu(show) {
  const menu = document.getElementById("new-menu");
  const btn = document.getElementById("new-term");
  const open = show ?? menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !open);
  btn.setAttribute("aria-expanded", String(open));
  if (open) populateNewMenu();
}

document.getElementById("new-term").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleNewMenu();
});

document.getElementById("new-menu-add").addEventListener("click", () => {
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
  toggleNewMenu(false);
});

document.addEventListener("click", (e) => {
  const menu = document.getElementById("new-menu");
  if (!menu.classList.contains("hidden") && !menu.contains(e.target) && e.target.id !== "new-term") {
    toggleNewMenu(false);
  }
});

document.getElementById("rescan").addEventListener("click", loadProfiles);
document.getElementById("broadcast").addEventListener("click", () => toggleBroadcast());
document.querySelectorAll(".cols-switch button").forEach((btn) => {
  btn.addEventListener("click", () => setColumns(Number(btn.dataset.cols)));
});
document.getElementById("overlay-close").addEventListener("click", closeOverlay);
document.getElementById("overlay").addEventListener("click", (e) => {
  if (e.target.id === "overlay") closeOverlay();
});

// Command palette
document.getElementById("palette-open").addEventListener("click", () => togglePalette(true));
document.getElementById("palette").addEventListener("click", (e) => {
  if (e.target.id === "palette") togglePalette(false);
});
document.getElementById("palette-input").addEventListener("input", renderPalette);
document.getElementById("palette-input").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setPaletteIndex(paletteIndex + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setPaletteIndex(paletteIndex - 1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    runPalette();
  }
});

// Capture phase so Ctrl/Cmd+N works even while a terminal has focus (xterm
// would otherwise consume the keystroke).
document.addEventListener(
  "keydown",
  (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      e.stopPropagation();
      togglePalette();
    }
  },
  true,
);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!document.getElementById("palette").classList.contains("hidden")) togglePalette(false);
  else if (!document.getElementById("overlay").classList.contains("hidden")) closeOverlay();
  else if (!document.getElementById("new-menu").classList.contains("hidden")) toggleNewMenu(false);
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
