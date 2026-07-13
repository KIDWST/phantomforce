// electron-main.cjs — Termina's native app shell.
//
// This is only a window + process manager: it starts the real engine
// (server.js, unchanged, run under a real system Node.js so node-pty keeps
// working without an Electron-specific native rebuild) and shows it in a
// plain, chrome-free window with Termina's own icon. No console ever shows —
// child_process.spawn's windowsHide is a real OS-level flag, not a hint.

const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");

const PORT = Number(process.env.TERMINA_PORT || 7420);
const appRoot = __dirname;

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

    win = new BrowserWindow({
      width: 1500,
      height: 950,
      icon: path.join(appRoot, "assets", "termina.ico"),
      autoHideMenuBar: true,
      backgroundColor: "#0b0b0f",
      show: false,
    });
    win.removeMenu();

    if (ready) {
      win.loadURL(`http://127.0.0.1:${PORT}/`);
    } else {
      win.loadURL(
        "data:text/html,<body style=\"background:#0b0b0f;color:#eee;font-family:sans-serif;padding:2rem\">" +
          "<h2>Termina engine failed to start</h2><p>Is Node.js 20+ installed and on PATH?</p></body>",
      );
    }
    win.once("ready-to-show", () => win.show());
  });

  app.on("window-all-closed", () => {
    stopEngineIfOwned();
    app.quit();
  });

  app.on("before-quit", stopEngineIfOwned);
}
