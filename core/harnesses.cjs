const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { atomic } = require("./config.cjs");
const { legacyBaseline } = require("./injection-files.cjs");
const { DIRECT, locations, providerId } = require("./native-config.cjs");
const { makeCatalog } = require("./models.cjs");
const { apiProfile } = require("./account-info.cjs");
const {
  inspectCredentials,
  discoverNative,
  digest,
} = require("./credential-status.cjs");
const {
  findExecutable,
  resolveLauncher,
  discoverLaunchers,
} = require("./client-launcher.cjs");
const {
  normalizeOAuth,
  piOAuthProviders,
  enumerateSources,
  readJson,
} = require("./oauth-import.cjs");
const SPECS = [
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    oauth: true,
    description: "ChatGPT 授权账户 / API 账户；官方请求可经系统 CA 路由。",
  },
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    oauth: true,
    description: "Claude 授权账户 / Anthropic 协议 API 账户。",
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    oauth: true,
    description: "Go API 自动识别，其他 API 与原生登录账户独立切换。",
  },
  {
    id: "pi",
    name: "pi",
    command: "pi",
    oauth: true,
    description: "API 账户与原生 / 扩展 OAuth；实际登录选项由本机 pi 提供。",
  },
  {
    id: "dsh",
    name: "DeepSeek Harness",
    command: "dsh",
    oauth: true,
    description: "DeepSeek API、兼容 API 与原生 OAuth 记录。",
  },
];
const APIS = {
  "openai-responses": "openai-responses",
  "openai-chat": "openai-completions",
  anthropic: "anthropic-messages",
};
const json = (file, fallback = {}) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
function apiAccounts(harness, providers, includeUnavailable = false) {
  return providers
    .filter((p) => (includeUnavailable || p.enabled) && p.apiKey)
    .map((p) => {
      const models = p.models.filter(
        (m) => m.enabled && (harness !== "claude" || m.wireApi === "anthropic"),
      );
      const host = new URL(p.baseUrl).hostname;
      const deepseek = p.brand === "deepseek" || host === "api.deepseek.com";
      const go =
        p.brand === "opencode-go" ||
        (host === "opencode.ai" &&
          new URL(p.baseUrl).pathname.startsWith("/zen/go"));
      return {
        id: "api:" + p.id,
        providerId: p.id,
        label: p.name,
        kind: "api",
        profile: apiProfile(p, DIRECT.includes(harness)),
        badge:
          harness === "dsh" && deepseek
            ? "DeepSeek API"
            : harness === "opencode" && go
              ? "OpenCode Go API"
              : "API",
        ready: p.enabled !== false && !!models.length,
        models: models.map((m) => ({
          model: m.model,
          name: m.displayName,
          protocol: m.wireApi,
        })),
        message:
          p.enabled === false
            ? "供应商已停用"
            : models.length
              ? "API Key 已保存 · 未联网验证"
              : "没有兼容且已启用的模型",
      };
    })
    .filter(
      (a) =>
        includeUnavailable ||
        apiCompatible(
          harness,
          providers.find((p) => p.id === a.providerId),
        ),
    );
}
function apiCompatible(harness, provider) {
  return (
    harness !== "claude" ||
    provider?.wireApi === "anthropic" ||
    provider?.models.some((m) => m.wireApi === "anthropic")
  );
}
function automaticBinding(harness, provider) {
  try {
    const url = new URL(provider.baseUrl);
    return (
      (harness === "dsh" && url.hostname === "api.deepseek.com") ||
      (harness === "opencode" &&
        url.hostname === "opencode.ai" &&
        /^\/zen\/go(?:\/|$)/.test(url.pathname))
    );
  } catch {
    return false;
  }
}
function isolatedEnv(harness, dir, env = process.env) {
  const result = { ...env };
  for (const key of Object.keys(result))
    if (
      /^(ANTHROPIC_|CLAUDE_CODE_OAUTH|CLAUDE_CODE_USE_|CLAUDE_CONFIG_DIR|OPENAI_|CODEX_HOME|PI_CODING_AGENT_DIR|PI_CODING_AGENT_SESSION_DIR|OPENCODE_|DSH_HOME|DEEPSEEK_|ASS_LOCAL_TOKEN|ELECTRON_RUN_AS_NODE|NODE_TLS_REJECT_UNAUTHORIZED|XDG_(CONFIG|DATA|STATE|CACHE)_HOME$)/i.test(
        key,
      ) ||
      /^(GEMINI|GOOGLE|GROQ|MISTRAL|CEREBRAS|XAI|OPENROUTER|KIMI|MINIMAX|ZAI|SILICONFLOW)_API_KEY$/i.test(
        key,
      )
    )
      delete result[key];
  result.NODE_USE_SYSTEM_CA = "1";
  if (harness === "codex") result.CODEX_HOME = dir;
  if (harness === "claude") result.CLAUDE_CONFIG_DIR = dir;
  if (harness === "pi") result.PI_CODING_AGENT_DIR = dir;
  if (harness === "opencode")
    for (const name of ["DATA", "CONFIG", "STATE", "CACHE"])
      result["XDG_" + name + "_HOME"] = path.join(dir, name.toLowerCase());
  if (harness === "dsh") result.DSH_HOME = dir;
  return result;
}
function authSummary(harness, dir) {
  const result = inspectCredentials(harness, dir);
  return {
    ready: result.rows.some((r) => r.ready),
    providers: result.rows.map((r) => r.provider),
    message: result.rows.map((r) => r.message).join("；") || result.message,
  };
}
function routeConfig(harness, p, m, dir, token, catalog, port = 25819) {
  const clientBase = `http://127.0.0.1:${port}/clients/${harness}`;
  const base = clientBase + "/harness/" + p.id;
  const env = { ASS_LOCAL_TOKEN: token },
    files = [],
    args = [];
  const model = {
    id: m.model,
    name: m.displayName,
    api: APIS[m.wireApi],
    contextWindow: m.contextWindow,
    maxTokens: m.maxOutputTokens,
    reasoning: true,
    input: ["text"],
  };
  if (harness === "claude") {
    if (m.wireApi !== "anthropic")
      throw new Error("Claude Code 只能接入 Anthropic Messages 协议");
    Object.assign(env, {
      ANTHROPIC_BASE_URL: base,
      ANTHROPIC_AUTH_TOKEN: token,
      ANTHROPIC_MODEL: m.model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: m.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: m.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: m.model,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
    args.push("--model", m.model);
  }
  if (harness === "opencode") {
    const npm = {
      "openai-responses": "@ai-sdk/openai",
      "openai-chat": "@ai-sdk/openai-compatible",
      anthropic: "@ai-sdk/anthropic",
    }[m.wireApi];
    const id =
      p.brand === "opencode-go" ||
      new URL(p.baseUrl).pathname.startsWith("/zen/go")
        ? "opencode-go"
        : "ass";
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      model: id + "/" + m.model,
      provider: {
        [id]: {
          name: p.name,
          npm,
          options: { baseURL: base + "/v1", apiKey: "{env:ASS_LOCAL_TOKEN}" },
          models: {
            [m.model]: {
              name: m.displayName,
              limit: { context: m.contextWindow, output: m.maxOutputTokens },
              variants: Object.fromEntries(
                m.efforts.map((e) => [e, { reasoningEffort: e }]),
              ),
            },
          },
        },
      },
    });
    args.push("--model", id + "/" + m.model);
  }
  if (harness === "pi") {
    files.push([
      "models.json",
      JSON.stringify(
        {
          providers: {
            ass: {
              baseUrl: base + "/v1",
              api: APIS[m.wireApi],
              apiKey: "$ASS_LOCAL_TOKEN",
              models: [model],
            },
          },
        },
        null,
        2,
      ),
    ]);
    args.push("--provider", "ass", "--model", m.model);
  }
  if (harness === "dsh") {
    // JSON is valid YAML; only the ASS-owned per-account settings file is generated.
    const provider = "ass-api";
    files.push([
      "settings.yaml",
      JSON.stringify(
        {
          "llm-pi-ai": {
            providers: {
              [provider]: {
                displayName: p.name,
                apiKeyEnv: "ASS_LOCAL_TOKEN",
                baseURL: base + "/v1",
                api: APIS[m.wireApi],
                models: [
                  {
                    id: m.model,
                    name: m.displayName,
                    contextWindow: m.contextWindow,
                    maxTokens: m.maxOutputTokens,
                    reasoningEfforts: Object.fromEntries(
                      m.efforts.map((e) => [e, e]),
                    ),
                  },
                ],
              },
            },
          },
          "agent-default-model": {
            provider,
            model: m.model,
            reasoningEffort: m.defaultEffort,
          },
        },
        null,
        2,
      ),
    ]);
    args.push("--profile", "tui");
  }
  if (harness === "codex") {
    const name = p.id + "::" + m.model;
    files.push(["catalog.json", JSON.stringify(catalog)]);
    files.push([
      "config.toml",
      `model = ${JSON.stringify(name)}\nmodel_provider = "ass_api"\nmodel_reasoning_effort = ${JSON.stringify(m.defaultEffort)}\nmodel_catalog_json = ${JSON.stringify(path.join(dir, "catalog.json"))}\n[model_providers.ass_api]\nname = "ASS API"\nbase_url = ${JSON.stringify(clientBase + "/v1")}\nwire_api = "responses"\nenv_key = "ASS_LOCAL_TOKEN"\nsupports_websockets = false\n`,
    ]);
  }
  return { env, files, args };
}
class HarnessManager {
  constructor(
    dataDir,
    getState,
    officialModels,
    codexDir = path.join(os.homedir(), ".codex"),
    options = {},
  ) {
    this.dataDir = dataDir;
    this.codexDir = codexDir;
    this.getState = getState;
    this.officialModels = officialModels;
    this.options = options;
    this.piProviders = [];
    this.detected = {};
    this.discovery = {};
    this.file = path.join(dataDir, "clients.json");
    this.state = {
      profiles: [],
      selected: {},
      modelSelections: {},
      credentialHomes: {},
      executables: {},
      workspace: "",
      apiBindings: {},
      apiExclusions: {},
      ...json(this.file),
    };
    this.nativeHome = options.home || os.homedir();
    this.nativeEnv = options.env || process.env;
    this.launchEnv = options.launchEnv || process.env;
    this.state.apiBindings =
      this.state.apiBindings && typeof this.state.apiBindings === "object"
        ? this.state.apiBindings
        : {};
    this.state.apiExclusions =
      this.state.apiExclusions && typeof this.state.apiExclusions === "object"
        ? this.state.apiExclusions
        : {};
    for (const { id } of SPECS) {
      const bindings = new Set(
        Array.isArray(this.state.apiBindings[id])
          ? this.state.apiBindings[id]
          : [],
      );
      for (const account of [
        this.state.selected[id],
        ...Object.keys(this.state.modelSelections[id] || {}),
      ])
        if (account?.startsWith("api:")) bindings.add(account.slice(4));
      this.state.apiBindings[id] = [...bindings];
      this.state.apiExclusions[id] = Array.isArray(this.state.apiExclusions[id])
        ? this.state.apiExclusions[id]
        : [];
    }
  }
  async refreshOAuth() {
    for (const { id } of SPECS) {
      if (!this.state.executables[id] || id === "opencode") this.detect(id);
    }
    const pi = this.launcher("pi");
    this.piProviders = await piOAuthProviders(pi.ready ? pi.entryPoint : "");
  }
  launcher(harness) {
    this.spec(harness);
    const selected = this.state.executables[harness];
    const candidates = this.discovery[harness] || [];
    const ready = candidates.filter((c) => c.ready);
    if (!selected && (ready.length || candidates.length) > 1) {
      return {
        ...resolveLauncher(harness, ""),
        message: "检测到多套客户端，点击自动识别后选择要使用的一套",
      };
    }
    return resolveLauncher(
      harness,
      selected ||
        this.detected[harness] ||
        findExecutable(harness, this.launchEnv),
      this.launchEnv,
    );
  }
  detect(harness) {
    this.spec(harness);
    const candidates = discoverLaunchers(harness, this.launchEnv);
    this.discovery[harness] = candidates;
    const ready = candidates.filter((c) => c.ready);
    const preferred = ready.length ? ready : candidates;
    this.detected[harness] =
      preferred.length === 1 ? preferred[0].location : "";
    return candidates;
  }
  desktop(harness) {
    this.spec(harness);
    const selected = this.state.executables[harness];
    const candidates = [
      ...(selected ? [resolveLauncher(harness, selected, this.launchEnv)] : []),
      ...(this.discovery[harness] || []),
    ];
    const desktop = candidates.find((c) => c.kind === "desktop");
    // Recheck immediately before exposing/opening an executable; no stale paths.
    if (!desktop) return null;
    const current = resolveLauncher(
      harness,
      desktop.desktopExecutable,
      this.launchEnv,
    );
    return current.kind === "desktop" ? current.desktopExecutable : null;
  }
  oauthSources() {
    return enumerateSources(
      this.codexDir,
      this.nativeHome,
      this.state.profiles,
      (h, id) => this.root(h, id),
      this.piProviders,
      this.nativeEnv,
      this.state.credentialHomes,
    );
  }
  importOAuth(sourceId, label) {
    const source = this.oauthSources().find((s) => s.id === sourceId);
    if (!source || !source.compatible)
      throw new Error(
        "未检测到兼容的 pi OAuth。请先选择已安装的 pi 程序并刷新状态",
      );
    const { provider, record } = normalizeOAuth(
      source.kind,
      readJson(source.file),
      source.sourceProvider,
    );
    // Always import into a NEW profile; never overwrite a token that pi may be refreshing.
    const id = this.add("pi", label || source.label, provider);
    atomic(
      path.join(this.root("pi", id), "auth.json"),
      JSON.stringify({ [provider]: record }, null, 2),
    );
    const p = this.state.profiles.find((p) => p.id === id);
    p.importedFrom = source.label;
    p.importedAt = new Date().toISOString();
    this.save();
    return id;
  }
  save() {
    atomic(this.file, JSON.stringify(this.state, null, 2));
  }
  spec(id) {
    const spec = SPECS.find((s) => s.id === id);
    if (!spec) throw new Error("未知客户端");
    return spec;
  }
  root(harness, id) {
    this.spec(harness);
    if (!/^[a-f0-9]{24}$/.test(id)) throw new Error("账户 ID 无效");
    return path.join(this.dataDir, "clients", harness, id);
  }
  snapshot() {
    return {
      workspace: this.state.workspace,
      piOAuthProviders: this.piProviders,
      oauthSources: this.oauthSources().map(
        ({ file, sourceProvider, ...s }) => s,
      ),
      clients: SPECS.map((s) => {
        const native = discoverNative(s.id, {
          home: this.nativeHome,
          env: this.nativeEnv,
          override: this.state.credentialHomes[s.id],
          codexDir: this.codexDir,
        });
        const apiCandidates = apiAccounts(
          s.id,
          this.getState().providers,
          true,
        );
        const bound = new Set(this.state.apiBindings[s.id] || []);
        // Preserve API accounts actually selected/used by an earlier release.
        for (const id of [
          this.state.selected[s.id],
          ...Object.keys(this.state.modelSelections[s.id] || {}),
        ])
          if (id?.startsWith("api:")) bound.add(id.slice(4));
        const apiRows = apiCandidates.filter(
          (a) =>
            !(this.state.apiExclusions[s.id] || []).includes(a.providerId) &&
            (bound.has(a.providerId) ||
              automaticBinding(
                s.id,
                this.getState().providers.find((p) => p.id === a.providerId),
              )),
        );
        const accounts = [
          ...native
            .flatMap((source) => source.accounts)
            .filter(
              (account) =>
                !this.options.nativeConfig?.owns(
                  s.id,
                  account.sourcePath,
                  account.provider,
                ),
            ),
          ...this.state.profiles
            .filter((p) => p.harness === s.id)
            .flatMap((p) => {
              const status = inspectCredentials(s.id, this.root(s.id, p.id));
              const rows = status.rows.length
                ? status.rows
                : [
                    {
                      ready: false,
                      providers: [],
                      status: status.status,
                      message: status.message,
                    },
                  ];
              return rows.map((row) => ({
                ...p,
                ...row,
                id: row.provider ? p.id + ":" + digest(row.provider) : p.id,
                profileId: p.id,
                oauthProvider: row.provider || p.oauthProvider,
                kind: "auth",
                source: "独立账户",
                providers: row.provider ? [row.provider] : [],
                label:
                  rows.length > 1 ? p.label + " · " + row.provider : p.label,
                badge: row.authType === "api" ? "API Key" : "OAuth",
                sourcePath: status.file,
              }));
            }),
          ...apiRows,
        ];
        const saved = this.state.selected[s.id];
        const legacy = accounts.filter((a) => a.profileId === saved);
        return {
          ...s,
          executable: this.launcher(s.id).executable,
          launcher: this.launcher(s.id),
          desktop: this.desktop(s.id),
          selected: accounts.some((a) => a.id === saved)
            ? saved
            : legacy.length === 1
              ? legacy[0].id
              : "",
          modelSelections: this.state.modelSelections[s.id] || {},
          credentialHome: this.state.credentialHomes[s.id] || "",
          credentialSources: native.map(({ file, status, message }) => ({
            file,
            status,
            message,
          })),
          accounts,
          availableApiAccounts: apiCandidates.filter(
            (a) =>
              !apiRows.some((b) => b.id === a.id) &&
              apiCompatible(
                s.id,
                this.getState().providers.find((p) => p.id === a.providerId),
              ),
          ),
        };
      }),
    };
  }
  add(harness, label, oauthProvider = "") {
    const s = this.spec(harness);
    if (!s.oauth) throw new Error("此客户端直接使用 API 供应商作为账户");
    if (!label?.trim()) throw new Error("请输入账户名称");
    if (oauthProvider && !/^[a-z0-9-]{1,80}$/.test(oauthProvider))
      throw new Error("OAuth provider ID 格式无效");
    const p = {
      id: crypto.randomBytes(12).toString("hex"),
      harness,
      label: label.trim().slice(0, 60),
      oauthProvider,
    };
    fs.mkdirSync(this.root(harness, p.id), { recursive: true });
    this.state.profiles.push(p);
    this.state.selected[harness] = p.id;
    this.save();
    return p.id;
  }
  select(harness, id) {
    const row = this.snapshot().clients.find((s) => s.id === harness);
    if (row?.availableApiAccounts.some((a) => a.id === id))
      this.bindApi(harness, id.slice(4));
    if (
      !row ||
      ![...row.accounts, ...row.availableApiAccounts].some((p) => p.id === id)
    )
      throw new Error("账户不存在");
    this.state.selected[harness] = id;
    this.save();
  }
  selectModel(harness, accountId, model) {
    const client = this.snapshot().clients.find((s) => s.id === harness);
    const account =
      client &&
      [...client.accounts, ...client.availableApiAccounts].find(
        (a) => a.id === accountId,
      );
    if (!account?.models?.some((m) => m.model === model))
      throw Error("请选择此账户的兼容模型");
    this.state.modelSelections[harness] ||= {};
    this.state.modelSelections[harness][accountId] = model;
    this.save();
  }
  bindApi(harness, providerId, bound = true) {
    this.spec(harness);
    if (
      bound &&
      (!apiCompatible(
        harness,
        this.getState().providers.find((p) => p.id === providerId),
      ) ||
        !apiAccounts(harness, this.getState().providers, true).some(
          (a) => a.providerId === providerId,
        ))
    )
      throw Error("供应商缺少凭据或不兼容此客户端");
    const previous = structuredClone(this.state);
    const bindings = new Set(this.state.apiBindings[harness] || []);
    const excluded = new Set(this.state.apiExclusions[harness] || []);
    if (bound) {
      bindings.add(providerId);
      excluded.delete(providerId);
    } else {
      bindings.delete(providerId);
      excluded.add(providerId);
      if (this.state.selected[harness] === "api:" + providerId)
        delete this.state.selected[harness];
      if (this.state.modelSelections[harness])
        delete this.state.modelSelections[harness]["api:" + providerId];
    }
    this.state.apiBindings[harness] = [...bindings];
    this.state.apiExclusions[harness] = [...excluded];
    try {
      this.save();
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }
  reconcileModel(providerId, previousName, nextName) {
    const previous = structuredClone(this.state);
    for (const selections of Object.values(this.state.modelSelections)) {
      if (selections["api:" + providerId] !== previousName) continue;
      if (nextName) selections["api:" + providerId] = nextName;
      else delete selections["api:" + providerId];
    }
    try {
      this.save();
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }
  setCredentialHome(harness, dir) {
    this.spec(harness);
    if (DIRECT.includes(harness) && this.options.isConnected?.(harness))
      throw Error("请先断开此客户端接入，再切换原生配置目录");
    if (
      dir &&
      harness === "opencode" &&
      path.basename(dir).toLowerCase() !== "opencode"
    )
      throw Error("请选择 XDG 数据目录下包含 auth.json 的 opencode 文件夹");
    if (dir && (!path.isAbsolute(dir) || !fs.statSync(dir).isDirectory()))
      throw Error("请选择有效的凭据目录");
    this.state.credentialHomes[harness] = dir;
    this.save();
  }
  setExecutable(harness, file) {
    this.spec(harness);
    const launcher = resolveLauncher(harness, file, this.launchEnv);
    if (!launcher.ready && launcher.kind !== "desktop")
      throw new Error(launcher.message);
    this.state.executables[harness] = file;
    this.save();
  }
  plan(harness, accountId, action = "launch", modelName, token = "") {
    this.spec(harness);
    if (!["launch", "login", "logout"].includes(action))
      throw new Error("未知操作");
    const client = this.snapshot().clients.find((s) => s.id === harness);
    const account = [...client.accounts, ...client.availableApiAccounts].find(
      (p) => p.id === accountId,
    );
    if (!account) throw new Error("请选择账户");
    let dir,
      args = [],
      addEnv = {},
      files = [],
      hint = "",
      nativeSelection;
    if (account.kind === "api") {
      if (!account.ready) throw Error(account.message);
      if (this.options.isConnected && !this.options.isConnected(harness))
        throw Error(
          "请先在此客户端页面开启 ASS 接入；API 密钥不会注入到未接入的客户端",
        );
      if (action !== "launch")
        throw new Error(
          "API 账户直接使用供应商密钥，无需网页登录；在供应商页编辑或移除",
        );
      const p = this.getState().providers.find(
          (p) => p.id === account.providerId,
        ),
        m = p.models.find(
          (m) =>
            m.model ===
              (modelName ||
                this.state.modelSelections[harness]?.[accountId] ||
                account.models[0]?.model) && m.enabled,
        );
      if (!m || !account.models.some((item) => item.model === m.model))
        throw new Error("请选择此客户端兼容且已启用的模型");
      if (DIRECT.includes(harness)) {
        dir = locations(harness, this).dir;
        nativeSelection = { account: accountId, model: m.model };
        const id = providerId(p, m.wireApi);
        if (harness === "opencode") args = ["--model", id + "/" + m.model];
        if (harness === "pi")
          args = [
            "--provider",
            id,
            "--model",
            m.model,
            "--thinking",
            m.defaultEffort,
          ];
        if (harness === "dsh") args = ["--profile", "tui"];
        hint = "使用原生配置直连供应商，不经过 ASS 路由。";
      } else {
        // One immutable configuration directory per account/model; switching cannot affect running clients.
        const id = crypto
          .createHash("sha256")
          .update(p.id + "\0" + m.model)
          .digest("hex")
          .slice(0, 24);
        dir = this.root(harness, id);
        ({
          env: addEnv,
          files,
          args,
        } = routeConfig(
          harness,
          p,
          m,
          dir,
          token,
          makeCatalog(
            this.officialModels,
            this.getState().providers,
            this.getState().officialOverrides,
          ),
          this.options.port || 25819,
        ));
      }
    } else if (account.kind === "native") {
      // Existing native homes are read/used in place. Never inject config into
      // them or copy refresh tokens during a status check/account selection.
      dir = account.nativeDir;
      if (harness === "codex" && action !== "launch") args = [action];
      if (["claude", "opencode"].includes(harness) && action !== "launch")
        args = ["auth", action];
      if (harness === "pi" && action === "launch")
        args = ["--provider", account.provider];
      if (["pi", "dsh"].includes(harness) && action !== "launch")
        hint =
          harness === "pi"
            ? `请在 pi 窗口输入 /${action}，选择 ${account.provider}。`
            : "请在 DSH 的授权设置中管理此账户。";
      if (["opencode", "dsh"].includes(harness) && action === "launch")
        hint = `本机配置目录已选定；请在 ${this.spec(harness).name} 内选择供应商 ${account.provider}。`;
    } else {
      dir = this.root(harness, account.profileId || account.id);
      if (harness === "codex") {
        if (action !== "launch") args = [action];
        const routed =
          !this.options.isConnected || this.options.isConnected(harness);
        if (routed) {
          const existingFile = path.join(dir, "config.toml");
          const existing = fs.existsSync(existingFile)
            ? fs.readFileSync(existingFile, "utf8")
            : "";
          const own = this.options.injections?.entries.find(
            (e) =>
              e.relative ===
              path.relative(this.dataDir, existingFile).replaceAll("\\", "/"),
          );
          const original = own
            ? own.before || ""
            : legacyBaseline("codex", "config.toml", existing);
          if (
            original &&
            !/^cli_auth_credentials_store = "file"\s*$/.test(original)
          )
            throw Error(
              "此 Codex 授权账户含既有配置，请先检查其配置；ASS 不会直接覆盖",
            );
          files.push([
            "config.toml",
            `cli_auth_credentials_store = "file"\nmodel_provider = "ass_official"\n[model_providers.ass_official]\nname = "ASS Official"\nbase_url = "http://127.0.0.1:${this.options.port || 25819}/clients/codex/v1"\nwire_api = "responses"\nrequires_openai_auth = true\nsupports_websockets = false\n`,
          ]);
        } else if (!fs.existsSync(path.join(dir, "config.toml"))) {
          files.push(["config.toml", 'cli_auth_credentials_store = "file"\n']);
        }
      }
      if (harness === "claude" && action !== "launch") args = ["auth", action];
      if (harness === "opencode" && action !== "launch")
        args = ["auth", action];
      if (harness === "pi") {
        if (action === "launch" && account.oauthProvider)
          args = ["--provider", account.oauthProvider];
        if (action !== "launch")
          hint =
            "请在 pi 窗口输入 /" +
            action +
            (account.oauthProvider ? " " + account.oauthProvider : "") +
            "，由原生客户端完成授权。";
      }
      if (harness === "dsh") {
        args = ["--profile", "tui"];
        if (action !== "launch")
          hint =
            "请在 DSH 的授权设置中完成登录或退出；登录方式由已安装的插件提供。";
      }
    }
    const env =
      account.kind === "native" || nativeSelection
        ? isolatedEnv(harness, dir, this.nativeEnv)
        : { ...isolatedEnv(harness, dir), ...addEnv };
    if (account.kind === "native" || nativeSelection) {
      // An inherited API key must not silently override the selected OAuth.
      // Keep native data/config roots, but clear cross-account auth overrides.
      if (account.id === "native:claude-env")
        env.CLAUDE_CODE_OAUTH_TOKEN = this.nativeEnv.CLAUDE_CODE_OAUTH_TOKEN;
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.NODE_TLS_REJECT_UNAUTHORIZED;
      delete env.ASS_LOCAL_TOKEN;
      if (harness === "codex") env.CODEX_HOME = dir;
      if (harness === "claude") env.CLAUDE_CONFIG_DIR = dir;
      if (harness === "pi") env.PI_CODING_AGENT_DIR = dir;
      if (harness === "dsh") env.DSH_HOME = dir;
      if (harness === "opencode") {
        env.XDG_DATA_HOME = path.dirname(dir);
        for (const key of [
          "XDG_CONFIG_HOME",
          "XDG_STATE_HOME",
          "XDG_CACHE_HOME",
        ])
          if (this.nativeEnv[key]) env[key] = this.nativeEnv[key];
          else delete env[key];
        // The global/native config keeps its own precedence and plugins.
        for (const key of ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR"])
          if (this.nativeEnv[key]) env[key] = this.nativeEnv[key];
      }
    }
    return {
      dir,
      args,
      env,
      files,
      hint,
      accountKind: account.kind,
      harness,
      nativeSelection,
      routed:
        (account.kind === "api" && !nativeSelection) ||
        (account.kind === "auth" &&
          harness === "codex" &&
          (!this.options.isConnected || this.options.isConnected(harness))),
    };
  }
  materialize(plan) {
    if (plan.nativeSelection) {
      if (!this.options.nativeConfig) throw Error("原生接入管理未初始化");
      return this.options.nativeConfig.sync(plan.harness, plan.nativeSelection);
    }
    fs.mkdirSync(plan.dir, { recursive: true });
    if (plan.routed && this.options.injections)
      return this.options.injections.write(plan.harness, plan);
    for (const [name, content] of plan.files)
      atomic(path.join(plan.dir, name), content);
  }
  async launch(harness, account, action, model, token) {
    const launcher = this.launcher(harness);
    if (!launcher.ready) throw new Error(launcher.message);
    const plan = this.plan(harness, account, action, model, token);
    this.materialize(plan);
    const workspace =
      this.state.workspace || path.join(this.dataDir, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    // The terminal is deliberately visible: native login/TUI requires user interaction.
    const marker = crypto.randomBytes(16).toString("hex");
    const script =
      `# ASS session ${marker}\n` +
      `Set-Location -LiteralPath ${q(workspace)}\n` +
      (plan.hint ? `Write-Host ${q(plan.hint)}\n` : "") +
      `& ${q(launcher.executable)} ${[...launcher.args, ...plan.args].map(q).join(" ")}\n`;
    const terminal = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const child = spawn(
      terminal,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        env: plan.env,
        cwd: workspace,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      },
    );
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    let tracking = "";
    if (this.options.processes) {
      try {
        await this.options.processes.register({
          id: marker,
          harness,
          account,
          transport: plan.routed ? "proxy" : "native",
          label: this.spec(harness).name + " · " + action,
          pid: child.pid,
          marker,
        });
      } catch {
        tracking = "；窗口身份登记失败，请手动关闭该窗口后再断开接入";
      }
    }
    this.select(harness, account);
    if (plan.accountKind === "api" && model)
      this.selectModel(harness, account, model);
    return {
      ok: true,
      message:
        (plan.hint || "已打开独立客户端窗口；账户切换仅影响本次新启动。") +
        tracking,
    };
  }
}
module.exports = {
  HarnessManager,
  SPECS,
  apiAccounts,
  isolatedEnv,
  authSummary,
  routeConfig,
  findExecutable,
};
