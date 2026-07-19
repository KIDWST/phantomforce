import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("phantomDesktop", {
  runtime: () => ipcRenderer.sendSync("phantom:runtime-sync"),
  notify: (title, body) => ipcRenderer.invoke("phantom:notify", { title, body }),
  openExternal: (url) => ipcRenderer.invoke("phantom:open-external", { url })
});
