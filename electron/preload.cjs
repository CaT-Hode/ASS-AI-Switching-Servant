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
  "client-refresh",
  "client-executable",
  "client-detect",
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
