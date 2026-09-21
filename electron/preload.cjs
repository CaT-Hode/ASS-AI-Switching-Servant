const { contextBridge, ipcRenderer } = require("electron");
const allowed = [
  "snapshot",
  "import",
  "save-provider",
  "delete-provider",
  "save-model",
  "model-defaults",
  "service",
  "attach",
  "detach",
  "diagnose",
  "balance",
  "autostart",
  "open-data",
  "export",
  "account-add",
  "account-select",
  "client-refresh",
  "client-executable",
  "client-workspace",
  "client-launch",
  "pi-import-oauth",
];
contextBridge.exposeInMainWorld("ass", {
  call: (name, ...args) => {
    if (!allowed.includes(name)) throw new Error("Unsupported action");
    return ipcRenderer.invoke("ass:" + name, ...args);
  },
  subscribe: (callback) => {
    const handler = (_, value) => callback(value);
    ipcRenderer.on("ass:state", handler);
    return () => ipcRenderer.removeListener("ass:state", handler);
  },
});
