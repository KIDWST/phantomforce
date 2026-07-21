// electron-main.cjs — Termina's native app shell.
//
// This is only a window + process manager: it starts the real engine
// (server.js, unchanged, run under a real system Node.js so node-pty keeps
// working without an Electron-specific native rebuild) and shows it in a
// plain, chrome-free window with Termina's own icon. No console ever shows —
// child_process.spawn's windowsHide is a real OS-level flag, not a hint.
//
// Window sizing: BrowserWindow dimensions are in device-independent pixels
// (DIPs). On a 1920x1080 display at 125% Windows scaling the usable desktop
// is only ~1536x830 DIPs, so any hard-coded "big" size (the old 1500x950)
// hangs off the bottom of the screen. The window is therefore sized from
// the actual work area on first run, remembered across launches
// (.termina/window-state.json), and always clamped back on-screen in case
// the monitor setup changed since last time.

const { app, BrowserWindow, Menu, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");

const PORT = Number(process.env.TERMINA_PORT || 7420);
const appRoot = __dirname;
const stateFile = path.join(appRoot, ".termina", "window-state.json");

// Set TERMINA_DEBUG_LOG=1 to trace window sizing decisions to
// .termina/debug-launch.txt (work area, saved state, resolved bounds,
// what the OS actually gave us). Costs nothing when unset.
const debugLogFile = path.join(appRoot, ".termina", "debug-launch.txt");
function debugLog(label, value) {
  if (!process.env.TERMINA_DEBUG_LOG) return;
  try {
    fs.mkdirSync(path.dirname(debugLogFile), { recursive: true });
    fs.appendFileSync(debugLogFile, `${new Date().toISOString()} ${label}: ${JSON.stringify(value)}\n`);
  } catch {
    /* best-effort */
  }
}

let engineProc = null;
let startedEngine = false;
let win = null;

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Resolve a real system Node.js binary. The packaged app is just the shell;
// server.js's node-pty dependency stays built against system Node's ABI.
function findNode() {
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(finder, ["node"], { encoding: "utf8" });
    const first = out.split(/\r?\n/).find(Boolean);
    return first ? first.trim() : null;
  } catch {
    return null;
  }
}

async function ensureEngine() {
  if (await portOpen(PORT)) return true;
  const node = findNode();
  if (!node) return false;
  engineProc = spawn(node, ["server.js"], {
    cwd: appRoot,
    env: { ...process.env, TERMINA_PORT: String(PORT) },
    windowsHide: true,
    stdio: "ignore",
  });
  startedEngine = true;
  return waitForPort(PORT, 20000);
}

function stopEngineIfOwned() {
  if (startedEngine && engineProc && !engineProc.killed) {
    try {
      engineProc.kill();
    } catch {
      /* already gone */
    }
  }
}

// ---- window state (size/position/maximized/zoom) --------------------------

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  try {
    const state = {
      bounds: win.isMaximized() ? win.getNormalBounds() : win.getBounds(),
      maximized: win.isMaximized(),
      zoomLevel: win.webContents.getZoomLevel(),
    };
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch {
    /* best-effort */
  }
}

// First-run default and safety clamp: never hand back bounds that don't fit
// (or aren't visibly on) the current monitor layout.
function resolveWindowBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const defaults = {
    width: Math.min(1500, workArea.width - 24),
    height: Math.min(950, workArea.height - 24),
  };
  const saved = loadWindowState();

  let bounds = {
    width: defaults.width,
    height: defaults.height,
    x: workArea.x + Math.round((workArea.width - defaults.width) / 2),
    y: workArea.y + Math.round((workArea.height - defaults.height) / 2),
  };

  if (saved && saved.bounds && Number.isFinite(saved.bounds.width)) {
    bounds = { ...saved.bounds };
    // Clamp to whatever display the saved position lands on now.
    const display = screen.getDisplayMatching(bounds).workArea;
    bounds.width = Math.min(bounds.width, display.width);
    bounds.height = Math.min(bounds.height, display.height);
    bounds.x = Math.min(Math.max(bounds.x, display.x), display.x + display.width - bounds.width);
    bounds.y = Math.min(Math.max(bounds.y, display.y), display.y + display.height - bounds.height);
  }

  return { bounds, maximized: Boolean(saved && saved.maximized), zoomLevel: saved ? saved.zoomLevel : 0 };
}

// Hidden application menu: invisible chrome, but its accelerators keep
// working — this is what makes Ctrl+= / Ctrl+- / Ctrl+0 zoom the whole UI
// (and F11 fullscreen) without any visible menu bar.
function installMenu() {
  const template = [
    {
      label: "View",
      submenu: [
        { role: "zoomIn", accelerator: "CommandOrControl+=" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.setName("Termina");

  app.whenReady().then(async () => {
    const ready = await ensureEngine();
    installMenu();

    const { bounds, maximized, zoomLevel } = resolveWindowBounds();
    debugLog("workArea", screen.getPrimaryDisplay().workArea);
    debugLog("scaleFactor", screen.getPrimaryDisplay().scaleFactor);
    debugLog("savedState", loadWindowState());
    debugLog("resolvedBounds", { bounds, maximized, zoomLevel });

    win = new BrowserWindow({
      ...bounds,
      minWidth: 720,
      minHeight: 480,
      icon: path.join(appRoot, "assets", "termina.ico"),
      autoHideMenuBar: true,
      backgroundColor: "#0b0b0f",
      show: false,
    });

    if (ready) {
      win.loadURL(`http://127.0.0.1:${PORT}/`);
    } else {
      win.loadURL(
        "data:text/html,<body style=\"background:#0b0b0f;color:#eee;font-family:sans-serif;padding:2rem\">" +
          "<h2>Termina engine failed to start</h2><p>Is Node.js 20+ installed and on PATH?</p></body>",
      );
    }

    win.webContents.once("did-finish-load", () => {
      if (Number.isFinite(zoomLevel) && zoomLevel !== 0) win.webContents.setZoomLevel(zoomLevel);
    });

    win.once("ready-to-show", () => {
      if (maximized) win.maximize();
      win.show();
      debugLog("afterShow", { bounds: win.getBounds(), maximized: win.isMaximized(), zoom: win.webContents.getZoomFactor() });
      setTimeout(() => {
        if (win && !win.isDestroyed())
          debugLog("afterShow+2s", { bounds: win.getBounds(), maximized: win.isMaximized(), zoom: win.webContents.getZoomFactor() });
      }, 2000);
    });

    // Persist on meaningful changes (debounced) and on close.
    let saveTimer = null;
    const queueSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveWindowState, 400);
    };
    win.on("resize", queueSave);
    win.on("move", queueSave);
    win.on("maximize", queueSave);
    win.on("unmaximize", queueSave);
    win.on("close", saveWindowState);
  });

  app.on("window-all-closed", () => {
    stopEngineIfOwned();
    app.quit();
  });

  app.on("before-quit", stopEngineIfOwned);
}
