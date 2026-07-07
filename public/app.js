/* Termina wall — vanilla JS frontend. Each tile hosts a real xterm.js terminal
   bound to a local PTY session over WebSocket. */

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
let profilesById = new Map();
let openWindows = []; // live list of open programs on this PC (for every dropdown)
let currentLayout = "3x3";
// Default tile → source assignment (by index). A source is a profile id or
// "win:<pid>" for one of your open programs. Filled once profiles load.
let tileAssignments = [];

const tiles = new Map(); // tileIndex -> { term, fit, ws, profileId, disposed }

const api = (path, options = {}) =>
  fetch(path, {
    ...options,
    headers: { "x-termina-token": TOKEN, ...(options.headers || {}) },
  });

async function loadProfiles() {
  const banner = document.getElementById("banner");
  const text = document.getElementById("banner-text");
  const dot = banner.querySelector(".dot");
  try {
    const res = await api("/api/profiles");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "profiles unavailable");
    profiles = data.profiles;
    profilesById = new Map(profiles.map((p) => [p.id, p]));
    openWindows = await fetchWindows();
    dot.className = "dot green";
    text.textContent = `Engine live · ${openWindows.length} open programs on this PC. Pick one per tile.`;
    if (tileAssignments.length === 0) {
      // Start blank — every tile is chosen manually from its dropdown.
      tileAssignments = new Array(9).fill(null);
    }
    renderWall();
  } catch (err) {
    dot.className = "dot red";
    text.textContent = `Cannot reach the Termina engine (${err.message}).`;
  }
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Every dropdown lists terminals AND each open program on this PC.
function tileOptionsHtml(selectedId) {
  const winOpts = openWindows
    .map(
      (w) =>
        `<option value="win:${w.pid}">${escapeHtml(truncate(w.title, 42))} — ${escapeHtml(w.name)}</option>`,
    )
    .join("");
  return (
    `<option value="">Choose source…</option>` +
    (winOpts ? `<optgroup label="Open programs (${openWindows.length})">${winOpts}</optgroup>` : "")
  );
}

function statusTone(status) {
  if (status === "running" || status === "live") return "green";
  if (status === "idle") return "amber";
  if (status === "blocked" || status === "exited" || status === "error" || status === "closed") return "red";
  return "gray";
}

function renderWall() {
  const wall = document.getElementById("wall");
  const count = LAYOUT_TILES[currentLayout];
  wall.className = `wall layout-${currentLayout}`;

  // Dispose tiles beyond the new count.
  for (const [index, tile] of [...tiles.entries()]) {
    if (index >= count) {
      disposeTile(index);
    }
  }
  wall.innerHTML = "";

  for (let i = 0; i < count; i += 1) {
    wall.appendChild(buildTile(i));
  }
  // Re-attach live tiles after a (re)render.
  for (let i = 0; i < count; i += 1) {
    const sel = tileAssignments[i];
    if (!sel) continue;
    if (sel.startsWith("win:")) {
      attachProgram(i, Number(sel.slice(4)));
      continue;
    }
    const profile = profilesById.get(sel);
    if (!profile) continue;
    if (profile.monitor) {
      attachMonitor(i);
    } else if (profile.status === "running") {
      attachTerminal(i, profile.id);
    }
  }
}

function buildTile(index) {
  const el = document.createElement("article");
  el.className = "tile";
  el.dataset.index = String(index);

  const selectedId = tileAssignments[index] ?? "";
  const isProgram = typeof selectedId === "string" && selectedId.startsWith("win:");
  const winPid = isProgram ? Number(selectedId.slice(4)) : null;
  const profile = !isProgram ? profilesById.get(selectedId) || null : null;
  const winInfo = isProgram ? openWindows.find((w) => w.pid === winPid) : null;

  const head = document.createElement("div");
  head.className = "tile-head";

  const select = document.createElement("select");
  select.className = "instance-select";
  select.setAttribute("aria-label", `Tile ${index + 1} source`);
  select.innerHTML = tileOptionsHtml(selectedId);
  select.value = selectedId;
  select.addEventListener("change", () => selectProfile(index, select.value));

  const status = document.createElement("span");
  const chipLabel = isProgram ? (winInfo ? "program" : "closed") : profile ? profile.status : "empty";
  status.className = `status ${isProgram ? (winInfo ? "green" : "red") : profile ? statusTone(profile.status) : "gray"}`;
  status.innerHTML = `<i></i>${chipLabel}`;

  head.append(select, status);

  const meta = document.createElement("div");
  meta.className = "tile-meta";
  if (isProgram) {
    meta.innerHTML = `<span class="cam">CAM ${String(index + 1).padStart(2, "0")}</span>
       <span class="src" title="${escapeHtml(winInfo ? winInfo.title : "")}">${escapeHtml(winInfo ? winInfo.title : "program closed")}</span>
       <span class="ttype">${escapeHtml(winInfo ? winInfo.name : "")}</span>`;
  } else {
    meta.innerHTML = profile
      ? `<span class="cam">CAM ${String(index + 1).padStart(2, "0")}</span>
       <span class="src" title="${profile.description}">${profile.cwd}</span>
       <span class="ttype">${profile.type}</span>`
      : `<span class="cam">CAM ${String(index + 1).padStart(2, "0")}</span><span class="src">no source</span>`;
  }

  const screen = document.createElement("div");
  screen.className = "screen";
  const actions = document.createElement("div");
  actions.className = "tile-actions";

  if (isProgram) {
    // Live camera of one open program.
    const shot = document.createElement("div");
    shot.className = "cam-shot";
    shot.id = `shot-${index}`;
    shot.innerHTML = `<img class="cam-img" id="shotimg-${index}" alt="live view of ${escapeHtml(winInfo ? winInfo.title : "program")}" />
      <div class="cam-none" id="shotnone-${index}">Connecting…</div>`;
    screen.append(shot);
    actions.appendChild(button("Focus", "", () => programAction(index, "focus")));
    actions.appendChild(button("Min", "", () => programAction(index, "minimize")));
    actions.appendChild(button("Restore", "", () => programAction(index, "restore")));
    actions.appendChild(button("Max", "", () => programAction(index, "maximize")));
    actions.appendChild(button("Close", "danger", () => programAction(index, "close")));
    actions.appendChild(button("Expand", "", () => expandTile(index)));
    el.append(head, meta, screen, actions);
    return el;
  }

  if (profile && profile.monitor) {
    // Live open-programs monitor instead of a terminal.
    const programs = document.createElement("div");
    programs.className = "programs";
    programs.id = `programs-${index}`;
    programs.innerHTML = `<div class="prog-loading">Scanning open programs…</div>`;
    screen.append(programs);
    actions.appendChild(button("Refresh", "", () => tiles.get(index)?.refresh?.()));
    actions.appendChild(button("Expand", "", () => expandTile(index)));
  } else {
    const term = document.createElement("div");
    term.className = "term-host";
    term.id = `term-${index}`;
    const placeholder = document.createElement("div");
    placeholder.className = "placeholder";
    placeholder.innerHTML = profile
      ? `<p class="big">${profile.blocked ? "BLOCKED" : "READY"}</p><p>${profile.note}</p>`
      : `<p class="big">UNASSIGNED</p><p>Pick a program above to put it on this monitor.</p>`;
    screen.append(term, placeholder);

    if (profile && !profile.blocked) {
      const running = profile.status === "running";
      actions.appendChild(
        button(running ? "Stop" : "Start", running ? "danger" : "", () =>
          running ? stopProfile(index) : startProfile(index),
        ),
      );
    } else if (profile && profile.blocked) {
      actions.appendChild(button("Blocked", "disabled", () => {}, true));
    }
    actions.appendChild(button("Clear", "", () => tiles.get(index)?.term?.clear()));
    actions.appendChild(button("Expand", "", () => expandTile(index)));
    actions.appendChild(button("Focus", "", () => tiles.get(index)?.term?.focus()));
  }

  el.append(head, meta, screen, actions);
  return el;
}

// ---- open-programs monitor tile --------------------------------------------

function windowRowsHtml(windows) {
  if (!windows.length) return `<div class="prog-loading">No open windows found.</div>`;
  return windows
    .map(
      (w) => `
    <div class="prog-row" data-pid="${w.pid}">
      <div class="prog-info">
        <span class="prog-title" title="${escapeHtml(w.title)}">${escapeHtml(w.title)}</span>
        <span class="prog-sub">${escapeHtml(w.name)} · pid ${w.pid} · ${w.memMB} MB${w.responding ? "" : " · <b class='warn'>not responding</b>"}</span>
      </div>
      <div class="prog-actions">
        <button type="button" data-act="focus" title="Bring to front">Focus</button>
        <button type="button" data-act="minimize" title="Minimize">Min</button>
        <button type="button" data-act="restore" title="Restore">Restore</button>
        <button type="button" data-act="close" class="danger" title="Close window">Close</button>
      </div>
    </div>`,
    )
    .join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function fetchWindows() {
  try {
    const res = await api("/api/windows");
    const data = await res.json();
    return data.ok ? data.windows : [];
  } catch {
    return [];
  }
}

function wireProgramRows(container, onDone) {
  container.querySelectorAll(".prog-row").forEach((row) => {
    const pid = row.dataset.pid;
    row.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        await api(`/api/windows/${pid}/${btn.dataset.act}`, { method: "POST" }).catch(() => {});
        setTimeout(onDone, 350);
      });
    });
  });
}

function attachMonitor(index) {
  const container = document.getElementById(`programs-${index}`);
  if (!container) return;
  const prev = tiles.get(index);
  if (prev) disposeTile(index);

  const profileId = tileAssignments[index];
  const tile = { monitor: true, profileId, timer: null, refresh: null };

  const refresh = async () => {
    const windows = await fetchWindows();
    const live = document.getElementById(`programs-${index}`);
    if (!live) return;
    live.innerHTML =
      `<div class="prog-head">${windows.length} open ${windows.length === 1 ? "window" : "windows"}</div>` +
      windowRowsHtml(windows);
    wireProgramRows(live, refresh);
  };
  tile.refresh = refresh;
  tiles.set(index, tile);
  refresh();
  tile.timer = setInterval(refresh, 4000);
}

// ---- single-program camera tile --------------------------------------------

async function fetchThumb(pid) {
  try {
    const res = await api(`/api/windows/${pid}/thumbnail`);
    return await res.json();
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

function renderShot(index, data) {
  const img = document.getElementById(`shotimg-${index}`);
  const none = document.getElementById(`shotnone-${index}`);
  if (!img || !none) return;
  if (data && data.ok && data.png) {
    img.src = `data:image/png;base64,${data.png}`;
    img.style.display = "block";
    none.style.display = "none";
  } else {
    img.style.display = "none";
    none.style.display = "flex";
    none.textContent =
      data && data.minimized
        ? "Program is minimized — click Restore to view it live."
        : data && data.error === "gone"
          ? "Program has closed."
          : "No preview available for this program.";
  }
  // Keep the header/meta title fresh from the capture meta.
  if (data && data.title) {
    const tileEl = document.querySelector(`.tile[data-index="${index}"]`);
    const src = tileEl?.querySelector(".tile-meta .src");
    if (src) {
      src.textContent = data.title;
      src.title = data.title;
    }
  }
}

function attachProgram(index, pid) {
  const shot = document.getElementById(`shot-${index}`);
  if (!shot) return;
  if (tiles.get(index)) disposeTile(index);

  const tileEl = shot.closest(".tile");
  if (tileEl) tileEl.classList.add("live");

  const tile = { program: true, pid, timer: null, refresh: null };
  const refresh = async () => {
    if (tile.disposed) return;
    const data = await fetchThumb(pid);
    renderShot(index, data);
  };
  tile.refresh = refresh;
  tiles.set(index, tile);
  // Un-minimize (without stealing focus) so the tile shows it live right away.
  api(`/api/windows/${pid}/reveal`, { method: "POST" }).catch(() => {});
  // Click the live view to bring the real program to the front and use it.
  shot.onclick = () => programAction(index, "focus");
  shot.title = "Click to bring this program to the front";
  setTimeout(refresh, 250);
  tile.timer = setInterval(refresh, 2000);
}

async function programAction(index, action) {
  const tile = tiles.get(index);
  const pid = tile?.pid ?? (String(tileAssignments[index]).startsWith("win:") ? Number(String(tileAssignments[index]).slice(4)) : null);
  if (!pid) return;
  await api(`/api/windows/${pid}/${action}`, { method: "POST" }).catch(() => {});
  // Give the window a beat to change, then refresh the view.
  setTimeout(() => tile?.refresh?.(), 400);
}

function button(label, cls, onClick, disabled = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (cls) b.className = cls;
  if (disabled) b.disabled = true;
  b.addEventListener("click", onClick);
  return b;
}

function selectProfile(index, value) {
  disposeTile(index);
  tileAssignments[index] = value || null;
  refreshTile(index);
  if (typeof value === "string" && value.startsWith("win:")) {
    attachProgram(index, Number(value.slice(4)));
    return;
  }
  const profile = profilesById.get(value);
  if (profile && profile.monitor) {
    attachMonitor(index);
  } else if (profile && profile.status === "running") {
    // Attach immediately if the chosen session is already running.
    attachTerminal(index, value);
  }
}

async function startProfile(index) {
  const profileId = tileAssignments[index];
  if (!profileId) return;
  try {
    const res = await api(`/api/sessions/${encodeURIComponent(profileId)}/start`, { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      flashTile(index, data.detail || data.error || "start failed");
      await loadProfilesQuiet();
      return;
    }
    attachTerminal(index, profileId);
    await loadProfilesQuiet();
  } catch (err) {
    flashTile(index, `start failed: ${err.message}`);
  }
}

async function stopProfile(index) {
  const profileId = tileAssignments[index];
  if (!profileId) return;
  try {
    await api(`/api/sessions/${encodeURIComponent(profileId)}/stop`, { method: "POST" });
  } catch {
    /* best effort */
  }
  await loadProfilesQuiet();
}

function attachTerminal(index, profileId) {
  const host = document.getElementById(`term-${index}`);
  if (!host) return;
  const existing = tiles.get(index);
  if (existing && existing.profileId === profileId && existing.term && !existing.disposed) {
    return; // already attached
  }
  disposeTile(index);

  const tileEl = host.closest(".tile");
  if (tileEl) tileEl.classList.add("live");

  const term = new Terminal({
    convertEol: false,
    cursorBlink: true,
    fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
    fontSize: 12,
    theme: TERM_THEME,
    scrollback: 4000,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  try {
    fit.fit();
  } catch {
    /* not visible yet */
  }

  const ws = new WebSocket(`ws://${location.host}/pty?session=${encodeURIComponent(profileId)}&token=${encodeURIComponent(TOKEN)}`);
  const tile = { term, fit, ws, profileId, disposed: false };
  tiles.set(index, tile);

  ws.onopen = () => {
    sendResize(tile);
  };
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
}

function sendResize(tile) {
  if (tile.ws.readyState === WebSocket.OPEN && tile.term) {
    tile.ws.send(JSON.stringify({ type: "resize", cols: tile.term.cols, rows: tile.term.rows }));
  }
}

function disposeTile(index) {
  const tile = tiles.get(index);
  if (!tile) return;
  tile.disposed = true;
  if (tile.timer) {
    clearInterval(tile.timer);
    tile.timer = null;
  }
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
  tiles.delete(index);
  const host = document.getElementById(`term-${index}`);
  const tileEl = host?.closest(".tile");
  if (tileEl) tileEl.classList.remove("live");
}

function refreshTile(index) {
  const wall = document.getElementById("wall");
  const old = wall.querySelector(`.tile[data-index="${index}"]`);
  if (old) {
    const fresh = buildTile(index);
    old.replaceWith(fresh);
  }
}

function flashTile(index, message) {
  const host = document.getElementById(`term-${index}`);
  const tileEl = host?.closest(".tile");
  const placeholder = tileEl?.querySelector(".placeholder");
  if (placeholder) {
    placeholder.innerHTML = `<p class="big err">ERROR</p><p>${message}</p>`;
  }
}

// Expand: open a large terminal (or programs list) in the overlay.
let overlayTile = null;
function expandTile(index) {
  const selectedId = tileAssignments[index];
  if (!selectedId) return;
  const overlay = document.getElementById("overlay");
  const host = document.getElementById("overlay-term");
  const isProgram = typeof selectedId === "string" && selectedId.startsWith("win:");
  const profile = !isProgram ? profilesById.get(selectedId) : null;
  overlay.classList.remove("hidden");
  host.innerHTML = "";

  if (isProgram) {
    const pid = Number(selectedId.slice(4));
    const info = openWindows.find((w) => w.pid === pid);
    document.getElementById("overlay-title").textContent = info ? info.title : "Program";
    host.className = "overlay-term overlay-cam";
    host.innerHTML = `<img class="cam-img-lg" id="overlay-cam-img" alt="live program view" /><div class="cam-none" id="overlay-cam-none">Connecting…</div>`;
    const refresh = async () => {
      if (overlay.classList.contains("hidden")) return;
      const data = await fetchThumb(pid);
      const img = document.getElementById("overlay-cam-img");
      const none = document.getElementById("overlay-cam-none");
      if (!img || !none) return;
      if (data.ok && data.png) {
        img.src = `data:image/png;base64,${data.png}`;
        img.style.display = "block";
        none.style.display = "none";
      } else {
        img.style.display = "none";
        none.style.display = "flex";
        none.textContent = data.minimized ? "Program is minimized." : "No preview available.";
      }
    };
    refresh();
    overlayTile = { timer: setInterval(refresh, 1500), program: true };
    return;
  }

  document.getElementById("overlay-title").textContent = profile ? profile.label : "Terminal";

  if (profile && profile.monitor) {
    host.className = "overlay-term programs overlay-programs";
    const refresh = async () => {
      const windows = await fetchWindows();
      if (overlay.classList.contains("hidden")) return;
      host.innerHTML =
        `<div class="prog-head">${windows.length} open ${windows.length === 1 ? "window" : "windows"}</div>` +
        windowRowsHtml(windows);
      wireProgramRows(host, refresh);
    };
    refresh();
    overlayTile = { timer: setInterval(refresh, 4000), monitor: true };
    return;
  }
  host.className = "overlay-term";

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
    fontSize: 14,
    theme: TERM_THEME,
    scrollback: 6000,
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

  const ws = new WebSocket(`ws://${location.host}/pty?session=${encodeURIComponent(profileId)}&token=${encodeURIComponent(TOKEN)}`);
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
  const overlay = document.getElementById("overlay");
  overlay.classList.add("hidden");
  if (overlayTile) {
    if (overlayTile.timer) clearInterval(overlayTile.timer);
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

async function loadProfilesQuiet() {
  try {
    const res = await api("/api/profiles");
    const data = await res.json();
    if (data.ok) {
      profiles = data.profiles;
      profilesById = new Map(profiles.map((p) => [p.id, p]));
      openWindows = await fetchWindows(); // keep dropdowns' program list fresh
      // Update only status chips without tearing down live tiles.
      for (let i = 0; i < LAYOUT_TILES[currentLayout]; i += 1) {
        const live = tiles.get(i);
        if (!live) refreshTile(i);
        else updateTileChrome(i);
      }
    }
  } catch {
    /* ignore */
  }
}

function updateTileChrome(index) {
  const sel = tileAssignments[index];
  if (typeof sel === "string" && sel.startsWith("win:")) return; // program cameras self-manage
  const wall = document.getElementById("wall");
  const tileEl = wall.querySelector(`.tile[data-index="${index}"]`);
  if (!tileEl) return;
  const profile = profilesById.get(sel);
  const status = tileEl.querySelector(".status");
  if (status && profile) {
    status.className = `status ${statusTone(profile.status)}`;
    status.innerHTML = `<i></i>${profile.status}`;
  }
  if (profile && profile.monitor) return; // monitor tiles manage their own chrome
  const actions = tileEl.querySelector(".tile-actions");
  if (actions && profile && !profile.blocked) {
    const running = profile.status === "running";
    const first = actions.querySelector("button");
    if (first) {
      first.textContent = running ? "Stop" : "Start";
      first.className = running ? "danger" : "";
      first.onclick = () => (running ? stopProfile(index) : startProfile(index));
    }
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
  if (e.key === "Escape") closeOverlay();
});

loadProfiles();
// Light status polling so chips stay honest (session exits, etc.).
setInterval(loadProfilesQuiet, 5000);
