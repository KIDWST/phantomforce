"use strict";

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell
} = require("electron");

const fs = require("node:fs");
const path = require("node:path");
const {
  RuntimeSupervisor,
  isHttpUrl,
  KIMI_CONTEXT_LENGTH,
  KIMI_ENDPOINT,
  KIMI_MODEL,
  KIMI_PROVIDER_ID,
  PHANTOM_V1_CONTEXT_LENGTH,
  PHANTOM_V1_MODEL,
  PHANTOM_V1_PROVIDER_ID,
  LOCAL_OLLAMA_ENDPOINT,
  probeUrl
} = require("./runtime.cjs");

const DEFAULT_APP_URL =
  "http://127.0.0.1:5190/app/index.html";

const DEFAULT_HEALTH_URL =
  "http://127.0.0.1:5190/health";

const REMOTE_APP_URL =
  "https://admin.phantomforce.online/app/index.html";

const APP_URL =
  String(
    process.env.PHANTOMFORCE_OS_APP_URL ||
    process.env.PHANTOMBOT_APP_URL ||
    DEFAULT_APP_URL
  ).trim();

const HEALTH_URL =
  String(
    process.env.PHANTOMFORCE_OS_HEALTH_URL ||
    process.env.PHANTOMBOT_HEALTH_URL ||
    DEFAULT_HEALTH_URL
  ).trim();

const ALLOW_REMOTE_FALLBACK =
  String(
    process.env.PHANTOMFORCE_OS_ALLOW_REMOTE_FALLBACK ||
    process.env.PHANTOMBOT_ALLOW_REMOTE_FALLBACK ||
    ""
  ).trim().toLowerCase() === "true";

const ENABLE_DEVTOOLS =
  String(
    process.env.PHANTOMFORCE_OS_DEVTOOLS ||
    process.env.PHANTOMBOT_DEVTOOLS ||
    ""
  ).trim().toLowerCase() === "true";

const CONNECTION_TIMEOUT_MS = 2500;

let mainWindow = null;
let runtimeSupervisor = null;
let lastConnectionStatus = {
  reachable: false,
  source: "unavailable",
  appUrl: APP_URL,
  healthUrl: HEALTH_URL,
  checkedAt: null,
  runtime: null
};

app.setName("PhantomForce OS");

if (process.platform === "win32") {
  app.setAppUserModelId(
    "online.phantomforce.os"
  );
}

const singleInstanceLock =
  app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
});

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function buildDesktopUrl(value) {
  const url = new URL(value);

  url.searchParams.set(
    "desktop_shell",
    "phantomforce-os"
  );

  url.searchParams.set(
    "desktop",
    "1"
  );

  return url.toString();
}

async function determineTarget() {
  const runtime = runtimeSupervisor
    ? await runtimeSupervisor.ensureStarted()
    : null;
  const localReachable = runtime
    ? runtime.app.reachable
    : await probeUrl(
      HEALTH_URL,
      CONNECTION_TIMEOUT_MS
    );

  if (localReachable) {
    lastConnectionStatus = {
      reachable: true,
      source: "local",
      appUrl: APP_URL,
      healthUrl: HEALTH_URL,
      checkedAt: new Date().toISOString(),
      runtime
    };

    return {
      reachable: true,
      source: "local",
      url: buildDesktopUrl(APP_URL)
    };
  }

  if (ALLOW_REMOTE_FALLBACK) {
    const remoteReachable =
      await probeUrl(REMOTE_APP_URL);

    if (remoteReachable) {
      lastConnectionStatus = {
        reachable: true,
        source: "remote",
        appUrl: REMOTE_APP_URL,
        healthUrl: HEALTH_URL,
        checkedAt: new Date().toISOString(),
        runtime
      };

      return {
        reachable: true,
        source: "remote",
        url: buildDesktopUrl(REMOTE_APP_URL)
      };
    }
  }

  lastConnectionStatus = {
    reachable: false,
    source: "unavailable",
    appUrl: APP_URL,
    healthUrl: HEALTH_URL,
    checkedAt: new Date().toISOString(),
    runtime
  };

  return {
    reachable: false,
    source: "unavailable",
    url: ""
  };
}

function isAllowedInternalNavigation(value) {
  if (!isHttpUrl(value)) {
    return false;
  }

  const targetOrigin = originOf(value);

  const allowedOrigins = new Set([
    originOf(APP_URL),
    originOf(REMOTE_APP_URL)
  ]);

  return allowedOrigins.has(targetOrigin);
}

function installNavigationPolicy(window) {
  window.webContents.setWindowOpenHandler(
    ({ url }) => {
      if (isAllowedInternalNavigation(url)) {
        return {
          action: "allow"
        };
      }

      if (isHttpUrl(url)) {
        void shell.openExternal(url);
      }

      return {
        action: "deny"
      };
    }
  );

  window.webContents.on(
    "will-navigate",
    (event, url) => {
      if (isAllowedInternalNavigation(url)) {
        return;
      }

      event.preventDefault();

      if (isHttpUrl(url)) {
        void shell.openExternal(url);
      }
    }
  );
}

function installPermissionPolicy() {
  const desktopSession =
    session.fromPartition(
      "persist:phantombot"
    );

  desktopSession.setPermissionCheckHandler(
    (
      _webContents,
      permission
    ) => {
      return permission === "media";
    }
  );

  desktopSession.setPermissionRequestHandler(
    (
      _webContents,
      permission,
      callback
    ) => {
      if (permission !== "media") {
        callback(false);
        return;
      }

      dialog.showMessageBox({
        type: "question",
        title: "PhantomForce OS permission",
        message:
          "Allow PhantomForce OS to use the microphone or camera?",
        detail:
          "This permission applies only to the current desktop session.",
        buttons: [
          "Deny",
          "Allow"
        ],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      }).then((result) => {
        callback(result.response === 1);
      }).catch(() => {
        callback(false);
      });
    }
  );

  desktopSession.webRequest.onBeforeSendHeaders(
    (details, callback) => {
      details.requestHeaders[
        "X-PhantomBot-Desktop"
      ] = "1";

      details.requestHeaders[
        "X-PhantomBot-Shell-Version"
      ] = app.getVersion();

      callback({
        requestHeaders:
          details.requestHeaders
      });
    }
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "PhantomForce OS",
    width: 1440,
    height: 930,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#090a10",
    autoHideMenuBar: true,

    webPreferences: {
      preload:
        path.join(
          __dirname,
          "preload.cjs"
        ),

      partition:
        "persist:phantombot",

      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true
    }
  });

  Menu.setApplicationMenu(null);

  installNavigationPolicy(mainWindow);

  mainWindow.once(
    "ready-to-show",
    () => {
      mainWindow?.show();
      mainWindow?.focus();
    }
  );

  mainWindow.on(
    "closed",
    () => {
      mainWindow = null;
    }
  );

  mainWindow.webContents.on(
    "before-input-event",
    (event, input) => {
      const key =
        String(input.key || "")
          .toLowerCase();

      const ctrlOrCommand =
        input.control ||
        input.meta;

      if (
        key === "f5" ||
        (
          ctrlOrCommand &&
          key === "r"
        )
      ) {
        event.preventDefault();
        mainWindow?.webContents.reload();
        return;
      }

      if (
        key === "f12" ||
        (
          ctrlOrCommand &&
          input.shift &&
          key === "i"
        )
      ) {
        event.preventDefault();

        if (ENABLE_DEVTOOLS) {
          mainWindow?.webContents.toggleDevTools();
        }
      }
    }
  );

  mainWindow.webContents.on(
    "did-finish-load",
    () => {
      void mainWindow?.webContents
        .executeJavaScript(
          `
            document.documentElement.dataset.phantombotDesktop = "true";
            document.documentElement.dataset.phantomforceOs = "true";
            document.documentElement.dataset.desktopShell = "phantomforce-os";

            if (
              document.title &&
              document.title.toLowerCase().includes("phantomforce")
            ) {
              document.title = "PhantomForce OS";
            }

            try {
              const model = String(localStorage.getItem("hermes.desktop.composer.model") || "").trim().toLowerCase();
              const provider = String(localStorage.getItem("hermes.desktop.composer.provider") || "").trim();
              const isPhantomV1 = model === "phantom-v1" || model === ${JSON.stringify(PHANTOM_V1_MODEL)} || model.startsWith("phantom-v1:") || provider === ${JSON.stringify(PHANTOM_V1_PROVIDER_ID)};
              if (isPhantomV1) {
                localStorage.setItem("hermes.desktop.composer.model", ${JSON.stringify(PHANTOM_V1_MODEL)});
                localStorage.setItem("hermes.desktop.composer.provider", ${JSON.stringify(PHANTOM_V1_PROVIDER_ID)});
                localStorage.setItem("hermes.desktop.composer.model-source", "default");
                localStorage.setItem("hermes.desktop.composer.reasoning_effort", "none");
                localStorage.setItem("hermes.desktop.composer.reasoning", "none");
                localStorage.setItem("hermes.desktop.composer.thinking", "false");
                localStorage.setItem("hermes.desktop.composer.thinking.enabled", "false");
                localStorage.setItem("hermes.desktop.composer.reasoning.enabled", "false");
                console.info("[PhantomBot Phantom V1] provider_id=${PHANTOM_V1_PROVIDER_ID} endpoint=${LOCAL_OLLAMA_ENDPOINT} model=${PHANTOM_V1_MODEL} context_length=${PHANTOM_V1_CONTEXT_LENGTH} reasoning_effort=none metadata_source=phantombot_desktop_storage_migration");
              }
              const isKimi = model === "kimi-k3-hf" || model === "kimi-k3-hf:latest" || model.startsWith("kimi-k3-hf:") || provider === ${JSON.stringify(KIMI_PROVIDER_ID)};
              if (isKimi) {
                localStorage.setItem("hermes.desktop.composer.model", ${JSON.stringify(KIMI_MODEL)});
                localStorage.setItem("hermes.desktop.composer.provider", ${JSON.stringify(KIMI_PROVIDER_ID)});
                localStorage.setItem("hermes.desktop.composer.model-source", "default");
                console.info("[PhantomBot Kimi] provider_id=${KIMI_PROVIDER_ID} endpoint=${KIMI_ENDPOINT} model=${KIMI_MODEL} context_length=${KIMI_CONTEXT_LENGTH} metadata_source=phantombot_desktop_storage_migration");
              }
            } catch {}
          `,
          true
        )
        .catch(() => {});
    }
  );

  return mainWindow;
}

async function loadExistingApplication() {
  if (!mainWindow) {
    return lastConnectionStatus;
  }

  const target =
    await determineTarget();

  if (target.reachable) {
    await mainWindow.loadURL(target.url);

    return lastConnectionStatus;
  }

  const offlinePath =
    path.join(
      __dirname,
      "unavailable.html"
    );

  if (!fs.existsSync(offlinePath)) {
    throw new Error(
      `Missing offline page: ${offlinePath}`
    );
  }

  await mainWindow.loadFile(offlinePath);

  return lastConnectionStatus;
}

ipcMain.handle(
  "phantombot:get-connection-status",
  async () => {
    return {
      ...lastConnectionStatus
    };
  }
);

ipcMain.handle(
  "phantombot:get-runtime-status",
  async () => {
    if (!runtimeSupervisor) {
      return null;
    }
    return runtimeSupervisor.inspect();
  }
);

ipcMain.handle(
  "phantombot:retry-connection",
  async () => {
    return loadExistingApplication();
  }
);

ipcMain.handle(
  "phantombot:open-external",
  async (_event, value) => {
    const url =
      String(value || "").trim();

    if (!isHttpUrl(url)) {
      return {
        ok: false,
        error: "Only HTTP and HTTPS links are allowed."
      };
    }

    await shell.openExternal(url);

    return {
      ok: true
    };
  }
);

app.whenReady().then(async () => {
  runtimeSupervisor = new RuntimeSupervisor({
    healthUrl: HEALTH_URL,
    packageDirectory: __dirname,
    resourcesPath: process.resourcesPath,
    logsDirectory: app.getPath("logs")
  });

  installPermissionPolicy();

  createWindow();

  try {
    await loadExistingApplication();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    await dialog.showMessageBox({
      type: "error",
      title: "PhantomForce OS",
      message:
        "PhantomForce OS could not open the workspace.",
      detail: message
    });
  }

  app.on("activate", async () => {
    if (
      BrowserWindow.getAllWindows().length === 0
    ) {
      createWindow();
      await loadExistingApplication();
    }
  });
});

app.on(
  "before-quit",
  () => {
    runtimeSupervisor?.stop();
  }
);

app.on(
  "window-all-closed",
  () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  }
);
