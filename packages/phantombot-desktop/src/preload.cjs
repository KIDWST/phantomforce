"use strict";

const {
  contextBridge,
  ipcRenderer
} = require("electron");

const desktopApi = Object.freeze({
  isDesktop: true,
  shell: "phantomforce-os",
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }),

  retryConnection: () =>
    ipcRenderer.invoke("phantombot:retry-connection"),

  getConnectionStatus: () =>
    ipcRenderer.invoke("phantombot:get-connection-status"),

  getRuntimeStatus: () =>
    ipcRenderer.invoke("phantombot:get-runtime-status"),

  openExternal: (url) =>
    ipcRenderer.invoke("phantombot:open-external", url)
});

contextBridge.exposeInMainWorld(
  "PhantomBotDesktop",
  desktopApi
);
contextBridge.exposeInMainWorld(
  "PhantomForceOS",
  desktopApi
);
