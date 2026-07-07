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

// Each card: { uid, name, profileId, sessionId, term, fit, ws, ro, disposed }
const cards = [];

const api = (path, options = {}) =>
  fetch(path, { ...options, headers: { "x-termina-token": TOKEN, ...(options.headers || {}) } });

const uid = () => `c${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---- persistence ------------------------------------------------------------

function saveWorkspace() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ columns, cards: cards.map((c) => ({ name: c.name, profileId: c.profileId })) }),
    );
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
    sessionId: null,
    term: null,
    fit: null,
    ws: null,
    ro: null,
    disposed: false,
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

  const remove = document.createElement("button");
  remove.className = "tile-remove";
  remove.type = "button";
  remove.title = "Remove window";
  remove.setAttribute("aria-label", "Remove window");
  remove.textContent = "×";
  remove.addEventListener("click", () => removeCard(card));

  head.append(name, select, remove);

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
      if (msg.type === "output") term.write(msg.data);
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    if (!card.disposed) term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n");
  };
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
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
    add.innerHTML = `<span class="plus">+</span><span>New terminal</span>`;
    add.addEventListener("click", () => addCard({}, { start: false }));
    wall.appendChild(add);
  }
}

async function boot() {
  ensureAddCard();
  await loadProfiles();

  const saved = loadWorkspace();
  if (saved && Array.isArray(saved.cards) && saved.cards.length) {
    setColumns(saved.columns || 3);
    let delay = 0;
    for (const c of saved.cards) {
      const card = addCard({ name: c.name, profileId: c.profileId }, { save: false });
      if (card.profileId) {
        // Stagger starts so a big workspace doesn't spawn everything at once.
        setTimeout(() => startTerminal(card), delay);
        delay += 180;
      }
    }
  } else {
    setColumns(3);
    addCard({}, { save: false });
    addCard({}, { save: false });
    saveWorkspace();
  }
}

document.getElementById("new-term").addEventListener("click", () => addCard({}, { start: false }));
document.getElementById("rescan").addEventListener("click", loadProfiles);
document.querySelectorAll(".cols-switch button").forEach((btn) => {
  btn.addEventListener("click", () => setColumns(Number(btn.dataset.cols)));
});
document.getElementById("overlay-close").addEventListener("click", closeOverlay);
document.getElementById("overlay").addEventListener("click", (e) => {
  if (e.target.id === "overlay") closeOverlay();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("overlay").classList.contains("hidden")) closeOverlay();
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
