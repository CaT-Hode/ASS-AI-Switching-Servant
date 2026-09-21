const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  session,
  Tray,
  Menu,
  nativeImage,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { Router } = require("../core/router.cjs");
const { Store } = require("../core/store.cjs");
const { ConfigManager, atomic } = require("../core/config.cjs");
const { normalizeModel } = require("../core/models.cjs");
const { BALANCE_PRESETS, queryBalance } = require("../core/balance.cjs");
const { PROVIDER_PRESETS } = require("../core/presets.cjs");
const { HarnessManager } = require("../core/harnesses.cjs");
const testMode = process.argv.includes("--qa");
const customData = process.env.ASS_TEST_DATA;
if (testMode && customData) app.setPath("userData", customData);
else
  app.setPath(
    "userData",
    path.join(app.getPath("appData"), "AI Switch Servant"),
  );
app.setName("AI Switch Servant");
app.setAppUserModelId("local.ass.desktop");
let window,
  tray,
  store,
  config,
  router,
  harnesses,
  quitting = false;
let recent = [],
  diagnostics = {},
  balances = {};
let startupError = "";
const iconPath = path.join(__dirname, "../public/ass-logo.png");
let systemSession, directSession;
async function upstream(url, init, network = "system") {
  return (network === "direct" ? directSession : systemSession).fetch(url, {
    ...init,
    credentials: "omit",
    redirect: "error",
  });
}
function readAuth() {
  const auth = JSON.parse(
    fs.readFileSync(path.join(store.codexDir, "auth.json"), "utf8"),
  );
  if (!auth.tokens?.access_token)
    throw new Error("未找到 ChatGPT 登录，请先在 Codex 登录");
  return {
    authorization: "Bearer " + auth.tokens.access_token,
    "chatgpt-account-id": auth.tokens.account_id || "",
  };
}
function authReady() {
  try {
    return !!readAuth().authorization;
  } catch {
    return false;
  }
}
function log(record) {
  recent.unshift(record);
  recent = recent.slice(0, 100);
  try {
    const p = path.join(store.dataDir, "requests.jsonl");
    if (fs.existsSync(p) && fs.statSync(p).size > 2 * 1024 * 1024)
      fs.renameSync(p, p + ".previous");
    fs.appendFileSync(p, JSON.stringify(record) + "\n");
  } catch {}
  push();
}
function snapshot() {
  return {
    ...store.public(),
    harnesses: harnesses.snapshot(),
    providerPresets: PROVIDER_PRESETS,
    balancePresets: BALANCE_PRESETS,
    service: {
      running: !!router.server,
      port: router.port,
      active: router.active,
    },
    codex: config.status(),
    authReady: authReady(),
    encrypted: safeStorage.isEncryptionAvailable(),
    recent,
    diagnostics,
    balances,
    startupError,
    version: app.getVersion(),
    dataDir: store.dataDir,
  };
}
function push() {
  if (window && !window.isDestroyed())
    window.webContents.send("ass:state", snapshot());
}
function register(name, handler) {
  ipcMain.handle("ass:" + name, async (event, ...args) => {
    const url = event.senderFrame?.url || "";
    if (
      !window ||
      event.sender !== window.webContents ||
      !url.startsWith("file://")
    )
      throw new Error("Invalid caller");
    try {
      return await handler(...args);
    } finally {
      push();
    }
  });
}
async function diagnose(providerId, modelName) {
  if (!router.server) throw new Error("请先启动路由服务");
  const start = Date.now();
  const official = providerId === "official";
  const p = store.state.providers.find((p) => p.id === providerId);
  const name = official
    ? modelName || "gpt-6-astra"
    : modelName || p?.models.find((m) => m.enabled)?.model;
  if (!name) throw new Error("此供应商没有启用的模型");
  const model = official ? name : providerId + "::" + name;
  let headers;
  try {
    headers = readAuth();
  } catch (e) {
    if (official) throw e;
    headers = { authorization: "Bearer ass-local-diagnostic" };
  }
  const body = {
    model,
    instructions: "Reply concisely.",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: "Reply exactly OK." }],
      },
    ],
    stream: true,
    store: false,
    reasoning: {
      effort: official
        ? "low"
        : p.models.find((m) => m.model === name)?.defaultEffort || "medium",
    },
  };
  try {
    const r = await fetch("http://127.0.0.1:25819/v1/responses", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    const content = await r.text();
    let message;
    if (!r.ok) {
      try {
        message = JSON.parse(content).error?.message;
      } catch {}
      throw new Error(message || "HTTP " + r.status);
    }
    if (!content.includes("response.completed"))
      throw new Error("未收到完整结束事件");
    diagnostics[providerId] = {
      ok: true,
      ms: Date.now() - start,
      time: new Date().toISOString(),
      model: name,
      message: "HTTP 200 · response.completed",
    };
  } catch (error) {
    diagnostics[providerId] = {
      ok: false,
      ms: Date.now() - start,
      time: new Date().toISOString(),
      model: name,
      message: error.message,
    };
  }
  push();
  return diagnostics[providerId];
}
async function balance(id) {
  const p = store.state.providers.find((p) => p.id === id);
  if (!p) throw new Error("供应商不存在");
  try {
    balances[id] = await queryBalance(p, upstream);
  } catch (error) {
    balances[id] = {
      ok: false,
      message: error.message,
      time: new Date().toISOString(),
    };
  }
  push();
  return balances[id];
}
function showWindow() {
  if (window) {
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    width: 1380,
    height: 930,
    minWidth: 1100,
    minHeight: 740,
    title: "AI Switch Servant · ASS",
    icon: iconPath,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.loadFile(path.join(__dirname, "../dist/index.html"));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => {
    window = null;
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", showWindow);
  app
    .whenReady()
    .then(async () => {
      const dataDir = app.getPath("userData");
      const codexDir =
        testMode && process.env.ASS_TEST_CODEX
          ? process.env.ASS_TEST_CODEX
          : path.join(os.homedir(), ".codex");
      fs.mkdirSync(dataDir, { recursive: true });
      systemSession = session.fromPartition("ass-system");
      directSession = session.fromPartition("ass-direct");
      await systemSession.setProxy({ mode: "system" });
      await directSession.setProxy({ mode: "direct" });
      store = new Store(dataDir, codexDir, safeStorage);
      config = new ConfigManager(codexDir, dataDir);
      harnesses = new HarnessManager(
        dataDir,
        () => store.state,
        store.officialModels,
        codexDir,
      );
      await harnesses.refreshOAuth();
      router = new Router({
        getState: () => store.state,
        fetchUpstream: upstream,
        log,
      });
      try {
        await router.start();
      } catch (error) {
        startupError = "端口 25819 无法启动：" + error.message;
      }
      register("snapshot", () => snapshot());
      register("account-add", (id, label, oauthProvider) =>
        harnesses.add(id, label, oauthProvider),
      );
      register("client-refresh", async () => {
        await harnesses.refreshOAuth();
        return snapshot();
      });
      register("pi-import-oauth", async (sourceId, label) => {
        const source = harnesses.oauthSources().find((s) => s.id === sourceId);
        if (!source) throw new Error("授权来源已变化，请刷新");
        const r = await dialog.showMessageBox(window, {
          type: "warning",
          message: "将 " + source.label + " 的授权导入新的 pi 账户？",
          detail:
            "来源凭据不修改。导入后两端各自刷新令牌，刷新或撤销可能使另一端失效。授权的可用性、权益与计费由供应商决定。",
          buttons: ["取消", "导入到 pi"],
          defaultId: 0,
          cancelId: 0,
        });
        if (r.response !== 1) return null;
        return harnesses.importOAuth(sourceId, label);
      });
      register("account-select", (id, account) =>
        harnesses.select(id, account),
      );
      register("client-executable", async (id) => {
        const r = await dialog.showOpenDialog(window, {
          title: "选择客户端可执行文件",
          properties: ["openFile"],
          filters: [{ name: "客户端", extensions: ["exe", "cmd", "ps1"] }],
        });
        if (!r.canceled) {
          harnesses.setExecutable(id, r.filePaths[0]);
          await harnesses.refreshOAuth();
        }
      });
      register("client-workspace", async () => {
        const r = await dialog.showOpenDialog(window, {
          title: "选择客户端工作目录",
          properties: ["openDirectory"],
        });
        if (!r.canceled) {
          harnesses.state.workspace = r.filePaths[0];
          harnesses.save();
        }
      });
      register("client-launch", async (id, account, action, model) => {
        if (action === "logout") {
          const r = await dialog.showMessageBox(window, {
            type: "warning",
            message: "打开此账户的原生退出流程？",
            detail: "仅作用于 ASS 中选定的独立账户。正在运行的会话可能受影响。",
            buttons: ["取消", "继续"],
            defaultId: 0,
            cancelId: 0,
          });
          if (r.response !== 1) return { ok: true, message: "已取消" };
        }
        if (action === "launch" && !router.server)
          throw new Error("请先启动路由服务");
        return harnesses.launch(id, account, action, model, router.clientToken);
      });
      register("import", async () => {
        const chosen = await dialog.showOpenDialog(window, {
          title: "导入供应商配置",
          properties: ["openFile"],
          filters: [{ name: "路由配置", extensions: ["json"] }],
        });
        if (chosen.canceled) return null;
        const file = chosen.filePaths[0];
        if (fs.statSync(file).size > 5 * 1024 * 1024)
          throw new Error("配置文件超过 5 MiB");
        return store.import(JSON.parse(fs.readFileSync(file, "utf8")));
      });
      register("save-provider", (input) => store.updateProvider(input));
      register("delete-provider", async (id) => {
        const r = await dialog.showMessageBox(window, {
          type: "warning",
          message: "移除此供应商和它的模型？",
          detail: "已保存的 API Key 也将从本应用移除。",
          buttons: ["取消", "移除"],
          defaultId: 0,
          cancelId: 0,
        });
        if (r.response === 1) {
          store.state.providers = store.state.providers.filter(
            (p) => p.id !== id,
          );
          store.save();
        }
      });
      register("save-model", (provider, model, originalName) =>
        store.model(provider, model, originalName),
      );
      register("model-defaults", (provider, model) =>
        normalizeModel({ model }, provider, store.officialModels),
      );
      register("service", async (enabled) => {
        if (enabled) await router.start();
        else {
          if (config.status().attached) {
            const r = await dialog.showMessageBox(window, {
              type: "warning",
              message: "停止路由会中断正在使用 AI Switch Servant 的请求。",
              buttons: ["取消", "停止服务"],
              defaultId: 0,
              cancelId: 0,
            });
            if (!r.response) return;
          }
          await router.stop();
        }
      });
      register("attach", async () => {
        if (!router.server) await router.start();
        store.writeCatalog();
        return config.attach();
      });
      register("detach", () => config.detach());
      register("diagnose", diagnose);
      register("balance", balance);
      register("autostart", (enabled) => {
        app.setLoginItemSettings({
          openAtLogin: !!enabled,
          path: process.execPath,
          args: app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"],
        });
        store.state.autoStart = !!enabled;
        store.save();
      });
      register("open-data", () => shell.openPath(dataDir));
      register("export", async () => {
        const result = await dialog.showSaveDialog(window, {
          title: "导出配置（不含密钥）",
          defaultPath: "ass-config.json",
        });
        if (result.canceled) return;
        atomic(
          result.filePath,
          JSON.stringify(
            {
              schemaVersion: 1,
              providers: store.state.providers.map(
                ({ apiKey, extraHeaders, ...p }) => ({
                  ...p,
                  apiKey: "",
                  extraHeaders: {},
                }),
              ),
            },
            null,
            2,
          ),
        );
      });
      const image = nativeImage.createFromPath(iconPath);
      tray = new Tray(image.resize({ width: 24, height: 24 }));
      tray.setToolTip("AI Switch Servant · 本地模型路由");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "打开 AI Switch Servant", click: showWindow },
          { type: "separator" },
          {
            label: "退出（停止路由）",
            click: () => {
              quitting = true;
              app.quit();
            },
          },
        ]),
      );
      tray.on("double-click", showWindow);
      if (!process.argv.includes("--hidden")) showWindow();
      const importArg = process.argv.find((x) =>
        x.startsWith("--import-config="),
      );
      if (importArg) {
        store.import(JSON.parse(fs.readFileSync(importArg.slice(16), "utf8")));
      }
      if (testMode)
        global.assTest = {
          store,
          router,
          config,
          harnesses,
          diagnose,
          balance,
          snapshot,
          upstream,
          readAuth,
          routeFor: require("../core/router.cjs").routeFor,
          quit: () => {
            quitting = true;
            app.quit();
          },
        };
    })
    .catch((error) => {
      dialog.showErrorBox("AI Switch Servant 启动失败", error.message);
      app.exit(1);
    });
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => {
    quitting = true;
    router?.stop();
  });
}
