const { contextBridge, ipcRenderer } = require("electron");
const allowed = [
  "snapshot",
  "ui-preferences",
  "usage-refresh",
  "supplier-refresh",
  "client-model",
  "client-credentials",
  "import",
  "save-provider",
  "delete-provider",
  "save-model",
  "delete-model",
  "account-bind-api",
  "account-save-api",
  "model-defaults",
  "connection-preview",
  "connection-apply",
  "diagnose",
  "diagnose-all",
  "diagnose-cancel",
  "models-discover",
  "capabilities-probe",
  "capabilities-cancel",
  "model-add-discovered",
  "balance",
  "autostart",
  "open-data",
  "export",
  "account-add",
  "account-select",
  "account-info",
  "account-info-doc",
  "client-refresh",
  "client-executable",
  "client-detect",
  "client-open-desktop",
  "client-location",
  "client-workspace",
  "client-launch",
  "pi-import-oauth",
  "official-open",
  "native-key-save",
  "native-key-remove",
  "native-key-copy",
  "openrouter-auth-start",
  "openrouter-auth-cancel",
  "update-check",
  "update-preferences",
  "update-dismiss",
  "update-open",
];
contextBridge.exposeInMainWorld("ass", {
  onManage: (callback) => {
    const handler = (_, value) => callback(value);
    ipcRenderer.on("ass:manage", handler);
    return () => ipcRenderer.removeListener("ass:manage", handler);
  },
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
