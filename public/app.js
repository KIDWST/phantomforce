/* Termina — multi-terminal wall. Each tile is its own independent terminal
   (real PTY over WebSocket, rendered with xterm.js). Run several Codex CLIs and
   shells side by side. */

const TOKEN = window.TERMINA_TOKEN;
const LAYOUT_TILES = { "2x2": 4, "3x2": 6, "3x3": 9 };

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
let currentLayout = "3x3";
// Per-tile chosen profile id (or null). Persisted only for the session.
let tileProfiles = new Array(9).fill(null);
// A monotonic counter so each started terminal gets a unique session id.
let sessionCounter = 0;

// tileIndex -> { sessionId, profileId, term, fit, ws, ro, disposed }
const tiles = new Map();

const api = (path, options = {}) =>
  fetch(path, { ...options, headers: { "x-termina-token": TOKEN, ...(options.headers || {}) } });

async function loadProfiles() {
  const banner = document.getElementById("banner");
  const text = document.getElementById("banner-text");
  const dot = banner.querySelector(".dot");
  try {
    const res = await api("/api/profiles");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "unavailable");
    profiles = data.profiles;
    dot.className = "dot green";
    text.textContent = `Engine live · ${profiles.length} terminal types. Each tile is its own terminal.`;
    renderWall();
  } catch (err) {
    dot.className = "dot red";
    text.textContent = `Cannot reach the Termina engine (${err.message}).`;
  }
}

function renderWall() {
  const wall = document.getElementById("wall");
  const count = LAYOUT_TILES[currentLayout];
  wall.className = `wall layout-${currentLayout}`;

  for (const [index] of [...tiles.entries()]) {
    if (index >= count) disposeTile(index);
  }
  wall.innerHTML = "";
  for (let i = 0; i < count; i += 1) wall.appendChild(buildTile(i));

  // Re-open terminals that were live before a layout change.
  for (let i = 0; i < count; i += 1) {
    const tile = tiles.get(i);
    if (tile && tile.sessionId) reopenTerminal(i);
  }
}

function buildTile(index) {
  const el = document.createElement("article");
  el.className = "tile";
  el.dataset.index = String(index);

  const selectedId = tileProfiles[index] ?? "";

  const head = document.createElement("div");
  head.className = "tile-head";

  const select = document.createElement("select");
  select.className = "instance-select";
  select.setAttribute("aria-label", `Tile ${index + 1} terminal type`);
  select.innerHTML =
    `<option value="">Choose terminal…</option>` +
    profiles.map((p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join("");
  select.value = selectedId;
  select.addEventListener("change", () => selectProfile(index, select.value));

  const running = Boolean(tiles.get(index)?.sessionId);
  const status = document.createElement("span");
  status.className = `status ${running ? "green" : "gray"}`;
  status.innerHTML = `<i></i>${running ? "live" : "idle"}`;

  head.append(select, status);

  const meta = document.createElement("div");
  meta.className = "tile-meta";
  const label = profiles.find((p) => p.id === selectedId)?.label ?? "no terminal";
  meta.innerHTML = `<span class="cam">CAM ${String(index + 1).padStart(2, "0")}</span>
    <span class="src">${escapeHtml(label)}</span>`;

  const screen = document.createElement("div");
  screen.className = "screen";
  const termHost = document.createElement("div");
  termHost.className = "term-host";
  termHost.id = `term-${index}`;
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.innerHTML = selectedId
    ? `<p class="big">READY</p><p>Starting…</p>`
    : `<p class="big">EMPTY</p><p>Pick a terminal above to open one here.</p>`;
  screen.append(termHost, placeholder);

  const actions = document.createElement("div");
  actions.className = "tile-actions";
  actions.appendChild(button("Restart", "", () => restartTile(index)));
  actions.appendChild(button("Clear", "", () => tiles.get(index)?.term?.clear()));
  actions.appendChild(button("Kill", "danger", () => killTile(index)));
  actions.appendChild(button("Expand", "", () => expandTile(index)));

  el.append(head, meta, screen, actions);
  return el;
}

function button(label, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function selectProfile(index, profileId) {
  killTile(index);
  tileProfiles[index] = profileId || null;
  refreshTile(index);
  if (profileId) await startTerminal(index, profileId);
}

async function startTerminal(index, profileId) {
  sessionCounter += 1;
  const sessionId = `t${index}-${sessionCounter}`;
  try {
    const res = await api(`/api/sessions/${sessionId}/start`, {
      method: "POST",
      body: JSON.stringify({ profile: profileId, cols: 100, rows: 28 }),
    });
    const data = await res.json();
    if (!data.ok) {
      flashTile(index, data.error || "failed to start");
      return;
    }
    openTerminal(index, sessionId, profileId);
    updateTileChrome(index);
  } catch {
    flashTile(index, "start request failed");
  }
}

function openTerminal(index, sessionId, profileId) {
  const host = document.getElementById(`term-${index}`);
  if (!host) return;
  disposeTerm(index);

  const tileEl = host.closest(".tile");
  if (tileEl) tileEl.classList.add("live");

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
  const tile = { sessionId, profileId, term, fit, ws, ro: null, disposed: false };
  tiles.set(index, tile);

  ws.onopen = () => sendResize(tile);
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "output") term.write(msg.data);
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    if (!tile.disposed) term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n");
  };
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
  });
  const ro = new ResizeObserver(() => {
    try {
      fit.fit();
      sendResize(tile);
    } catch {
      /* ignore */
    }
  });
  ro.observe(host);
  tile.ro = ro;
  term.focus();
}

// Re-attach to an existing session after a layout re-render.
function reopenTerminal(index) {
  const tile = tiles.get(index);
  if (!tile || !tile.sessionId) return;
  openTerminal(index, tile.sessionId, tile.profileId);
}

function sendResize(tile) {
  if (tile.ws && tile.ws.readyState === WebSocket.OPEN && tile.term) {
    tile.ws.send(JSON.stringify({ type: "resize", cols: tile.term.cols, rows: tile.term.rows }));
  }
}

async function restartTile(index) {
  const profileId = tiles.get(index)?.profileId ?? tileProfiles[index];
  if (!profileId) return;
  killTile(index);
  refreshTile(index);
  await startTerminal(index, profileId);
}

function killTile(index) {
  const tile = tiles.get(index);
  if (tile?.sessionId) {
    api(`/api/sessions/${tile.sessionId}/stop`, { method: "POST" }).catch(() => {});
  }
  disposeTile(index);
}

function disposeTerm(index) {
  const tile = tiles.get(index);
  if (!tile) return;
  tile.disposed = true;
  try {
    tile.ro?.disconnect();
  } catch {
    /* ignore */
  }
  try {
    tile.ws?.close();
  } catch {
    /* ignore */
  }
  try {
    tile.term?.dispose();
  } catch {
    /* ignore */
  }
}

function disposeTile(index) {
  disposeTerm(index);
  tiles.delete(index);
  const host = document.getElementById(`term-${index}`);
  const tileEl = host?.closest(".tile");
  if (tileEl) tileEl.classList.remove("live");
}

function refreshTile(index) {
  const wall = document.getElementById("wall");
  const old = wall.querySelector(`.tile[data-index="${index}"]`);
  if (old) old.replaceWith(buildTile(index));
}

function updateTileChrome(index) {
  const wall = document.getElementById("wall");
  const tileEl = wall.querySelector(`.tile[data-index="${index}"]`);
  if (!tileEl) return;
  const running = Boolean(tiles.get(index)?.sessionId);
  const status = tileEl.querySelector(".status");
  if (status) {
    status.className = `status ${running ? "green" : "gray"}`;
    status.innerHTML = `<i></i>${running ? "live" : "idle"}`;
  }
}

function flashTile(index, message) {
  const host = document.getElementById(`term-${index}`);
  const placeholder = host?.closest(".tile")?.querySelector(".placeholder");
  if (placeholder) placeholder.innerHTML = `<p class="big err">ERROR</p><p>${escapeHtml(message)}</p>`;
}

// ---- expand overlay ---------------------------------------------------------

let overlayTile = null;
function expandTile(index) {
  const tile = tiles.get(index);
  if (!tile || !tile.sessionId) return;
  const overlay = document.getElementById("overlay");
  const host = document.getElementById("overlay-term");
  const label = profiles.find((p) => p.id === tile.profileId)?.label ?? "Terminal";
  document.getElementById("overlay-title").textContent = label;
  overlay.classList.remove("hidden");
  host.innerHTML = "";
  host.className = "overlay-term";

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

  const ws = new WebSocket(`ws://${location.host}/pty?session=${encodeURIComponent(tile.sessionId)}&token=${encodeURIComponent(TOKEN)}`);
  overlayTile = { term, fit, ws };
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
  if (overlayTile) {
    try {
      overlayTile.ws?.close();
    } catch {
      /* ignore */
    }
    try {
      overlayTile.term?.dispose();
    } catch {
      /* ignore */
    }
    overlayTile = null;
  }
}

// ---- wiring -----------------------------------------------------------------

document.querySelectorAll(".layout-switch button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".layout-switch button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentLayout = btn.dataset.layout;
    renderWall();
  });
});
document.getElementById("rescan").addEventListener("click", loadProfiles);
document.getElementById("overlay-close").addEventListener("click", closeOverlay);
document.getElementById("overlay").addEventListener("click", (e) => {
  if (e.target.id === "overlay") closeOverlay();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("overlay").classList.contains("hidden")) closeOverlay();
});

window.addEventListener("beforeunload", () => {
  for (const [, tile] of tiles) {
    try {
      tile.ws?.close();
    } catch {
      /* ignore */
    }
  }
});

loadProfiles();
