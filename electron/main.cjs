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
  clipboard,
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
const {
  modelKey,
  declaredCapabilities,
  discoverModels,
  probeCapabilities,
  inspectStream,
} = require("../core/model-inspection.cjs");
const {
  OFFICIAL_SERVICES,
  serviceForProvider,
} = require("../core/official-services.cjs");
const { NativeKeyStore } = require("../core/native-key-store.cjs");
const { OpenRouterAuth } = require("../core/openrouter-auth.cjs");
const { UpdateChecker } = require("../core/updates.cjs");
const testMode = process.argv.includes("--qa");
const customData = process.env.ASS_TEST_DATA;
if (testMode && customData) app.setPath("userData", customData);
else
  app.setPath(
    "userData",
    path.join(app.getPath("appData"), "AI Switch Servant"),
  );
app.setName("ASS");
app.setAppUserModelId("local.ass.desktop");
let window,
  tray,
  store,
  config,
  router,
  harnesses,
  nativeKeys,
  openRouterAuth,
  updates,
  quitting = false;
let recent = [],
  diagnostics = {},
  balances = {};
let startupError = "";
const providerModels = Object.create(null),
  capabilities = Object.create(null),
  capabilityJobs = Object.create(null);
const probeControllers = new Map();
const iconPath = path.join(__dirname, "../public/ass-logo.png");
let systemSession, directSession, testFetch;
const servicePort =
  testMode && /^\d+$/.test(process.env.ASS_TEST_PORT || "")
    ? Number(process.env.ASS_TEST_PORT)
    : 25819;
async function upstream(url, init, network = "system") {
  if (testMode && testFetch) return testFetch(url, init, network);
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
    officialServices: OFFICIAL_SERVICES,
    officialProviderIds: Object.fromEntries(
      store.state.providers.map((p) => [p.id, serviceForProvider(p)?.id || ""]),
    ),
    nativeAccounts: nativeKeys.public(),
    openRouterAuth: openRouterAuth.state,
    updates: updates.snapshot(),
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
    providerModels,
    capabilities,
    capabilityJobs,
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
  const selected = (
    official ? store.public().officialModels : p?.models || []
  ).find((m) => m.model === modelName && m.enabled !== false);
  if (!selected || (!official && !p.enabled))
    throw new Error("请选择具体的已启用模型进行检测");
  const name = selected.model,
    key = modelKey(providerId, name);
  const model = official ? name : providerId + "::" + name;
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
    const headers = official
      ? readAuth()
      : { authorization: "Bearer ass-local-diagnostic" };
    const r = await fetch(`http://127.0.0.1:${router.port}/v1/responses`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) {
      await r.body?.cancel();
      throw new Error(
        "HTTP " + r.status + "；请检查该模型的凭据、协议和网络出口",
      );
    }
    const inspected = await inspectStream(r.body, "openai-responses");
    if (!inspected.completed || !inspected.text)
      throw new Error("未收到完整结束事件");
    diagnostics[key] = {
      providerId,
      ok: true,
      ms: Date.now() - start,
      time: new Date().toISOString(),
      model: name,
      message: "HTTP 200 · response.completed",
    };
  } catch (error) {
    diagnostics[key] = {
      providerId,
      ok: false,
      ms: Date.now() - start,
      time: new Date().toISOString(),
      model: name,
      message: error.message,
    };
  }
  push();
  return diagnostics[key];
}
function invalidateReports(id) {
  for (const results of [diagnostics, capabilities])
    for (const key of Object.keys(results))
      if (!id || JSON.parse(key)[0] === id) delete results[key];
  for (const key of Object.keys(providerModels))
    if (!id || key === id) delete providerModels[key];
  for (const key of Object.keys(balances))
    if (!id || key === id) delete balances[key];
  for (const [key, controller] of probeControllers)
    if (!id || JSON.parse(key)[0] === id) controller.abort();
}
async function readModelMetadata(id) {
  if (id === "official") {
    providerModels[id] = {
      source: "Codex 本机目录声明（未实测）",
      time: new Date().toISOString(),
      models: store.officialModels.map((m) => ({
        model: m.slug,
        displayName: m.display_name,
        declared: declaredCapabilities(m),
      })),
    };
  } else {
    const provider = store.state.providers.find((p) => p.id === id);
    if (!provider) throw Error("供应商不存在");
    try {
      providerModels[id] = await discoverModels(provider, upstream);
    } catch (e) {
      providerModels[id] = {
        time: new Date().toISOString(),
        error: e.message,
        models: [],
        source: "供应商目录",
      };
    }
  }
  return providerModels[id];
}
async function probeModel(id, name) {
  const provider = store.state.providers.find((p) => p.id === id && p.enabled);
  const model = provider?.models.find((m) => m.model === name && m.enabled);
  if (!model || !provider.apiKey) throw Error("请先配置并启用该供应商和模型");
  if (probeControllers.size)
    throw Error("已有能力检测正在运行，请等待或先取消");
  const key = modelKey(id, name),
    controller = new AbortController();
  probeControllers.set(key, controller);
  const timer = setTimeout(() => controller.abort(), 240000);
  try {
    capabilityJobs[key] = "读取模型元数据";
    push();
    await readModelMetadata(id);
    const report = await probeCapabilities(provider, model, upstream, {
      signal: controller.signal,
      progress: (message) => {
        capabilityJobs[key] = message;
        push();
      },
    });
    if (!controller.signal.aborted) capabilities[key] = report;
    return report;
  } finally {
    clearTimeout(timer);
    delete capabilityJobs[key];
    probeControllers.delete(key);
    push();
  }
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
    title: "ASS · 模型随你切",
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
      updates = new UpdateChecker({
        dataDir,
        currentVersion: app.getVersion(),
        fetchRelease: (url, init) => upstream(url, init, "system"),
        onChange: push,
      });
      nativeKeys = new NativeKeyStore(dataDir, safeStorage);
      openRouterAuth = new OpenRouterAuth({
        fetchUpstream: upstream,
        openExternal: (url) => shell.openExternal(url),
        onChange: push,
        saveKey: (apiKey, name) =>
          store.updateProvider({
            ...OFFICIAL_SERVICES.find((s) => s.id === "openrouter").profiles[0],
            id: undefined,
            name,
            apiKey,
            models: [],
            enabled: true,
            balance: { preset: "auto" },
          }),
      });
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
        await router.start(servicePort);
      } catch (error) {
        startupError = "端口 " + servicePort + " 无法启动：" + error.message;
      }
      register("snapshot", () => snapshot());
      register("update-check", () => updates.check({ manual: true }));
      register("update-preferences", (input) => updates.preferences(input));
      register("update-dismiss", () => updates.dismiss());
      register("update-open", (kind) =>
        shell.openExternal(updates.openUrl(kind)),
      );
      register("official-open", (id, target) => {
        const service = OFFICIAL_SERVICES.find((s) => s.id === id);
        if (!service || !["console", "docs"].includes(target))
          throw Error("未知官方入口");
        return shell.openExternal(service[target]);
      });
      register("native-key-save", (input) => nativeKeys.save(input));
      register("native-key-remove", async (id) => {
        const result = await dialog.showMessageBox(window, {
          type: "warning",
          message: "从 ASS 移除此原生 API Key？",
          detail: "只删除本机加密副本，不会撤销供应商端的 Key。",
          buttons: ["取消", "移除"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 1) nativeKeys.remove(id);
      });
      register("native-key-copy", (id) => {
        const secret = nativeKeys.read(id);
        clipboard.writeText(secret);
        const timer = setTimeout(() => {
          if (clipboard.readText() === secret) clipboard.clear();
        }, 30000);
        timer.unref();
        return {
          ok: true,
          message:
            "已复制到系统剪贴板，30 秒后清理当前副本。剪贴板历史或其他应用可能保留副本。",
        };
      });
      register("openrouter-auth-start", (label) => openRouterAuth.start(label));
      register("openrouter-auth-cancel", () => openRouterAuth.cancel());
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
      register("client-detect", async (id) => {
        const candidates = harnesses.detect(id);
        if (candidates.length === 1) {
          harnesses.setExecutable(id, candidates[0].location);
          await harnesses.refreshOAuth();
        }
        return { candidates };
      });
      register("client-location", async (id, location) => {
        harnesses.setExecutable(id, location);
        await harnesses.refreshOAuth();
      });
      register("client-executable", async (id, directory = false) => {
        const r = await dialog.showOpenDialog(window, {
          title: directory ? "选择客户端安装或源码目录" : "选择客户端启动文件",
          properties: [directory ? "openDirectory" : "openFile"],
          ...(directory
            ? {}
            : {
                filters: [
                  {
                    name: "客户端",
                    extensions: ["exe", "cmd", "ps1", "js", "cjs", "mjs"],
                  },
                ],
              }),
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
        const result = store.import(JSON.parse(fs.readFileSync(file, "utf8")));
        invalidateReports();
        return result;
      });
      register("save-provider", (input) => {
        const id = store.updateProvider(input);
        invalidateReports(id);
        return id;
      });
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
          invalidateReports(id);
        }
      });
      register("save-model", (provider, model, originalName) => {
        store.model(provider, model, originalName);
        invalidateReports(provider);
      });
      register("model-defaults", (provider, model) =>
        normalizeModel({ model }, provider, store.officialModels),
      );
      register("service", async (enabled) => {
        if (enabled) await router.start(servicePort);
        else {
          if (config.status().attached) {
            const r = await dialog.showMessageBox(window, {
              type: "warning",
              message: "停止路由会中断正在使用 ASS 的请求。",
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
        if (!router.server) await router.start(servicePort);
        store.writeCatalog();
        return config.attach();
      });
      register("detach", () => config.detach());
      register("diagnose", diagnose);
      register("models-discover", readModelMetadata);
      register("capabilities-probe", async (id, name) => {
        const p = store.state.providers.find((p) => p.id === id),
          m = p?.models.find((m) => m.model === name);
        if (!m)
          throw Error(
            "请选择具体模型；官方订阅模型请读取本机目录并使用闪电检测连接",
          );
        const result = await dialog.showMessageBox(window, {
          type: "question",
          message: "实测 " + m.model + " 的上游能力？",
          detail:
            "最多 " +
            (5 + m.efforts.length) +
            " 条小请求，每条最多请求 512 输出 tokens，可能计费。检测协议、工具调用及已配置的思维档位；不执行工具，不盲测上下文上限，不修改模型配置。",
          buttons: ["取消", "开始实测"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) return null;
        return probeModel(id, name);
      });
      register("capabilities-cancel", (id, name) =>
        probeControllers.get(modelKey(id, name))?.abort(),
      );
      register("model-add-discovered", (id, name) => {
        const p = store.state.providers.find((p) => p.id === id);
        const found = providerModels[id]?.models.find((m) => m.model === name);
        if (!p || !found) throw Error("请先读取供应商模型目录");
        if (p.models.some((m) => m.model === name))
          throw Error("模型已在配置中");
        const d = found.declared;
        const efforts = d.efforts.filter(
          (e) =>
            e !== "ultra" ||
            name.split("/").at(-1).toLowerCase().startsWith("gpt"),
        );
        store.model(id, {
          model: name,
          displayName: found.displayName,
          ...(d.contextWindow >= 4096 && d.contextWindow <= 10000000
            ? {
                contextWindow: d.contextWindow,
                contextSource: "供应商 /models 声明（未实测）",
              }
            : {}),
          ...(d.maxOutputTokens ? { maxOutputTokens: d.maxOutputTokens } : {}),
          ...(efforts.length ? { efforts } : {}),
        });
      });
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
      tray.setToolTip("ASS · 模型随你切");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "打开 ASS", click: showWindow },
          {
            label: "检查 ASS 更新",
            click: () => {
              showWindow();
              void updates.check({ manual: true });
            },
          },
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
          nativeKeys,
          openRouterAuth,
          updates,
          setFetch: (value) => {
            testFetch = value;
          },
          diagnose,
          readModelMetadata,
          probeModel,
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
      if (!testMode) updates.start();
    })
    .catch((error) => {
      dialog.showErrorBox("ASS 启动失败", error.message);
      app.exit(1);
    });
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => {
    quitting = true;
    updates?.stop();
    for (const controller of probeControllers.values()) controller.abort();
    openRouterAuth?.cancel();
    router?.stop();
  });
}
