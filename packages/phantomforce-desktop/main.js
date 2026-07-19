import { app, BrowserWindow, ipcMain, Notification, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PHANTOMFORCE_DESKTOP_POLICY, liveUrlFromEnv, originAllowed } from "./runtime-policy.js";

const here = dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const liveUrl = liveUrlFromEnv();
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "PhantomForce",
    backgroundColor: "#02060a",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (originAllowed(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (originAllowed(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  win.loadURL(liveUrl).catch(() => {
    win.loadFile(join(here, "..", "..", "app", "index.html"));
  });
}

ipcMain.handle("phantom:runtime", () => ({
  available: true,
  policy: PHANTOMFORCE_DESKTOP_POLICY,
  loadedAt: new Date().toISOString()
}));

ipcMain.on("phantom:runtime-sync", (event) => {
  event.returnValue = {
    available: true,
    policy: PHANTOMFORCE_DESKTOP_POLICY,
    loadedAt: new Date().toISOString()
  };
});

ipcMain.handle("phantom:notify", (_event, payload = {}) => {
  const title = String(payload.title || "PhantomForce").slice(0, 80);
  const body = String(payload.body || "").slice(0, 220);
  if (Notification.isSupported()) new Notification({ title, body }).show();
  return { ok: true };
});

ipcMain.handle("phantom:open-external", async (_event, payload = {}) => {
  const url = String(payload.url || "");
  if (!originAllowed(url)) return { ok: false, error: "origin_not_allowed" };
  await shell.openExternal(url);
  return { ok: true };
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
