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
const additional = require("./additional-harnesses.cjs");
const { officialAccountPlan } = require("./official-account-plan.cjs");
const { assertClaudeAccount } = require("./claude-launch-policy.cjs");
const { safePath, read: readNative, document: nativeDocument } = require("./native-fields.cjs");
const { ACCOUNT_SERVICES, officialApiService, acceptsApiAccount, acceptsNativeAccount,
  modelRef, injectionCatalog } = require("./client-policy.cjs");
const {
  inspectCredentials,
  discoverNative,
  nativeLocations,
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
    description: "Claude 授权账户 / Anthropic 官方 API 账户。",
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    oauth: false,
    description: "OpenCode Go / Zen 官方 API 账户。",
  },
  {
    id: "pi",
    name: "pi",
    command: "pi",
    oauth: true,
    description: "原生支持的 OAuth 账户；自定义 API 通过模型接入管理。",
  },
  {
    id: "dsh",
    name: "DeepSeek Harness",
    command: "dsh",
    oauth: false,
    description: "DeepSeek 官方 API 账户。",
  },
  ...additional.SPECS,
];
const APIS = {
  "openai-responses": "openai-responses",
  "openai-chat": "openai-completions",
  anthropic: "anthropic-messages",
};
const json = (file) => {
  try {
    if (!fs.existsSync(file)) return {};
    if (fs.statSync(file).size > 4 * 1024 * 1024) throw Error();
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    const object = (v) => v && typeof v === "object" && !Array.isArray(v);
    const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === "string");
    if (!object(value) || (value.schemaVersion !== undefined && ![1, 2, 3].includes(value.schemaVersion))) throw Error();
    for (const key of ["selected", "credentialHomes", "executables", "accountBindings", "accountExclusions", "apiBindings", "apiExclusions", "injections", "nativeProfileTargets", "modelSelections", "nativeVariants"])
      if (value[key] !== undefined && !object(value[key])) throw Error();
    for (const key of ["selected", "credentialHomes", "executables"])
      if (Object.values(value[key] || {}).some((v) => typeof v !== "string")) throw Error();
    if (Object.entries(value.nativeVariants || {}).some(([id, v]) => id !== "kimi" || !["auto", "current", "legacy"].includes(v))) throw Error();
    for (const key of ["accountBindings", "accountExclusions", "apiBindings", "apiExclusions", "nativeProfileTargets"])
      if (Object.values(value[key] || {}).some((v) => !strings(v))) throw Error();
    for (const config of Object.values(value.injections || {}))
      if (!object(config) || (value.schemaVersion === 3 ? !strings(config.excludedProviders) :
          !strings(config.excluded) || (config.defaultModel !== null && typeof config.defaultModel !== "string"))) throw Error();
    if (value.profiles !== undefined && (!Array.isArray(value.profiles) || value.profiles.some((p) => !p || !/^[a-f0-9]{24}$/.test(p.id) || !SPECS.some((s) => s.id === p.harness)))) throw Error();
    return value;
  } catch {
    throw Error("客户端账户配置损坏或版本不兼容，未覆盖 clients.json；请检查数据目录和备份");
  }
};
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
function apiAccounts(harness, providers, includeUnavailable = false) {
  return providers
    .filter((p) => p.apiKey && acceptsApiAccount(harness, p))
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
        // A saved credential is not made invalid by disabling catalog models.
        ready: true,
        authType: "api",
        provider: officialApiService(p),
        source: "官方 API",
        models: models.map((m) => ({
          model: m.model,
          name: m.displayName,
          protocol: m.wireApi,
        })),
        message: "API Key 已保存",
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
  return !!provider && acceptsApiAccount(harness, provider);
}
function automaticBinding(harness, provider) {
  return ["dsh", "opencode"].includes(harness) && acceptsApiAccount(harness, provider);
}
function isolatedEnv(harness, dir, env = process.env) {
  const result = { ...env };
  for (const key of Object.keys(result))
    if (
      /^(ANTHROPIC_|CLAUDE_CODE_OAUTH|CLAUDE_CODE_USE_|CLAUDE_CONFIG_DIR|OPENAI_|CODEX_HOME|PI_CODING_AGENT_DIR|PI_CODING_AGENT_SESSION_DIR|OPENCODE_|DSH_HOME|DEEPSEEK_|ASS_LOCAL_TOKEN|ASS_PI_AUTH_REQUIRED|ELECTRON_RUN_AS_NODE|NODE_TLS_REJECT_UNAUTHORIZED|XDG_(CONFIG|DATA|STATE|CACHE)_HOME$)/i.test(
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
    args.push("--profile", "web");
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
      nativeVariants: {},
      executables: {},
      workspace: "",
      accountBindings: {},
      accountExclusions: {},
      injections: {},
      ...json(this.file),
    };
    this.nativeHome = options.home || os.homedir();
    this.nativeEnv = options.env || process.env;
    this.launchEnv = options.launchEnv || process.env;
    // One-time metadata migration. Never touch native config or credentials here.
    const legacy = !this.state.schemaVersion || this.state.schemaVersion === 1;
    const providerMigration = this.state.schemaVersion !== 3;
    if (legacy && fs.existsSync(this.file)) {
      const backup = path.join(dataDir, "clients.before-account-separation.json");
      if (!fs.existsSync(backup)) atomic(backup, fs.readFileSync(this.file, "utf8"));
    }
    if (providerMigration && fs.existsSync(this.file)) {
      const backup = path.join(dataDir, "clients.before-provider-injection.json");
      if (!fs.existsSync(backup)) atomic(backup, fs.readFileSync(this.file, "utf8"));
    }
    for (const { id } of SPECS) {
      const providers = this.getState().providers;
      const bindings = this.state.accountBindings[id] || (legacy ? this.state.apiBindings?.[id] : []) || [];
      this.state.accountBindings[id] = bindings.filter((pid) =>
        apiCompatible(id, providers.find((p) => p.id === pid)));
      this.state.accountExclusions[id] ||= (legacy ? this.state.apiExclusions?.[id] : []) || [];
      this.state.injections[id] ||= { excludedProviders: [] };
      const selected = this.state.selected[id];
      if (legacy && selected?.startsWith("api:")) {
        const p = providers.find((p) => p.id === selected.slice(4));
        const name = this.state.modelSelections[id]?.[selected] ||
          injectionCatalog(id, p ? [p] : []).find((m) => m.included)?.model;
        if (p && name && p.models.some((m) => m.model === name))
          this.state.injections[id].defaultModel = modelRef(p.id, name);
        if (p && acceptsApiAccount(id, p)) {
          if (!this.state.accountBindings[id].includes(p.id)) this.state.accountBindings[id].push(p.id);
        } else delete this.state.selected[id];
      }
    }
    if (providerMigration) for (const { id } of SPECS) {
      const old = this.state.injections[id];
      // A partially excluded provider migrates OFF: never broaden access to a
      // previously excluded model. Applied native/proxy configuration is untouched.
      const excludedProviders = new Set(old.excludedProviders || []);
      for (const ref of old.excluded || []) {
        try { const [provider] = JSON.parse(ref); if (typeof provider === "string") excludedProviders.add(provider); } catch {}
      }
      this.state.injections[id] = { excludedProviders: [...excludedProviders] };
    }
    this.state.schemaVersion = 3;
    delete this.state.apiBindings;
    delete this.state.apiExclusions;
    delete this.state.modelSelections;
    if (providerMigration && fs.existsSync(this.file)) this.save();
  }
  async refreshOAuth() {
    for (const { id } of SPECS) {
      if (!this.state.executables[id] || id === "opencode") this.detect(id);
    }
    const pi = this.launcher("pi");
    this.piProviders = await piOAuthProviders(pi.ready ? pi.entryPoint : "");
  }
  oauthHistorySources() {
    return SPECS.filter((s) => s.oauth).flatMap(({ id }) => [
      ...nativeLocations(id, this.nativeHome, this.nativeEnv, this.state.credentialHomes[id], this.codexDir)
        .map((dir) => ({ harness: id, dir, native: true })),
      ...this.state.profiles.filter((p) => p.harness === id)
        .map((p) => ({ harness: id, dir: this.root(id, p.id), native: false })),
    ]);
  }
  oauthHistoryAllows(id, provider) {
    return this.spec(id).oauth && (id === "pi" ? this.piProviders.some((p) => p.id === provider)
      : ACCOUNT_SERVICES[id].includes(provider));
  }
  oauthHistoryTarget(id) {
    if (!this.spec(id).oauth) throw Error("此客户端不支持 OAuth 账户切换");
    const source = this.oauthHistorySources().find((s) => s.harness === id);
    const envKeys = id === "codex" ? ["CODEX_API_KEY", "OPENAI_API_KEY", "CODEX_ACCESS_TOKEN", "OPENAI_IDENTITY_TOKEN_FILE", "OPENAI_CLIENT_ID"]
      : id === "claude" ? ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"] : [];
    return { ...source, blocked: envKeys.some((k) => this.nativeEnv[k])
      ? "当前环境变量覆盖原生登录，请先在客户端清除覆盖后再切换 OAuth" : "" };
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
        findExecutable(this.spec(harness).command, this.launchEnv),
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
  assertManaged(id) {
    if (this.spec(id).nativeLoginOnly)
      throw Error("此客户端账户目前仅支持原生识别；请在原生客户端管理登录");
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
        if (s.nativeLoginOnly) {
          const native = additional.inspect(s.id, { home: this.nativeHome, env: this.nativeEnv,
            override: this.state.credentialHomes[s.id] });
          const launcher = this.launcher(s.id);
          const ownedCache = new Map();
          const owned = (file, provider) => {
            const key = JSON.stringify([file, provider]);
            if (!ownedCache.has(key)) ownedCache.set(key, !!this.options.nativeConfig?.owns(s.id, file, provider));
            return ownedCache.get(key);
          };
          const accounts = native.accounts.filter((a) => !owned(a.sourcePath, a.provider));
          const modelAccounts = native.modelAccounts.map((a) => ({ ...a,
            declaredModels: a.declaredModels.filter((m) => !owned(a.sourcePath, m.nativeProvider)) }));
          return { ...s, detected: !!(launcher.ready || launcher.installed ||
              this.discovery[s.id]?.some((c) => resolveLauncher(s.id, c.location, this.launchEnv).ready) ||
              native.sources.some((source) => source.status !== "missing")),
            executable: launcher.executable, launcher, selected: "", desktop: null,
            accountServices: [], oauthProviders: [], availableApiAccounts: [],
            credentialHome: this.state.credentialHomes[s.id] || "", credentialSources: native.sources,
            nativeVariant: s.id === "kimi" ? this.state.nativeVariants.kimi || "auto" : undefined,
            accounts, modelAccounts: [...accounts, ...modelAccounts],
            injection: s.injectionUnsupported ? { models: [], excludedProviders: [] } : this.injection(s.id) };
        }
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
        const bound = new Set(this.state.accountBindings[s.id] || []);
        const apiRows = apiCandidates.filter(
          (a) =>
            !(this.state.accountExclusions[s.id] || []).includes(a.providerId) &&
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
        // Native model discovery is independent of which account cards we show.
        const modelAccounts = accounts.filter((a) => a.kind !== "api");
        const visible = accounts.filter((a) => a.kind === "api" ||
          acceptsNativeAccount(s.id, a, this.piProviders) ||
          (a.kind === "auth" && !a.provider && s.oauth &&
            (!a.oauthProvider || (s.id === "pi" ? this.piProviders.some((p) => p.id === a.oauthProvider)
              : ACCOUNT_SERVICES[s.id].includes(a.oauthProvider)))));
        const saved = this.state.selected[s.id];
        const legacy = visible.filter((a) => a.profileId === saved);
        const launcher = this.launcher(s.id), desktop = this.desktop(s.id);
        return {
          ...s,
          detected: !!(launcher.ready || launcher.installed ||
            desktop || this.discovery[s.id]?.some((c) => {
              const current = resolveLauncher(s.id, c.location, this.launchEnv);
              return current.ready || current.installed;
            }) ||
            native.some((source) => source.status !== "missing")),
          executable: launcher.executable,
          launcher,
          desktop,
          selected: visible.some((a) => a.id === saved)
            ? saved
            : legacy.length === 1
              ? legacy[0].id
              : "",
          accountServices: ACCOUNT_SERVICES[s.id],
          oauthProviders: s.id === "pi" ? this.piProviders : [],
          injection: this.injection(s.id),
          modelAccounts,
          credentialHome: this.state.credentialHomes[s.id] || "",
          credentialSources: native.map(({ file, status, message }) => ({
            file,
            status,
            message,
          })),
          accounts: visible,
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
    this.assertManaged(harness);
    if (!s.oauth) throw new Error("此客户端只管理对应官方 API 账户");
    if (!label?.trim()) throw new Error("请输入账户名称");
    if (oauthProvider && !/^[a-z0-9-]{1,80}$/.test(oauthProvider))
      throw new Error("OAuth provider ID 格式无效");
    if (harness === "pi" && !this.piProviders.some((p) => p.id === oauthProvider))
      throw Error("请选择本机 pi 已确认支持的 OAuth 服务");
    if (harness !== "pi" && oauthProvider && !ACCOUNT_SERVICES[harness].includes(oauthProvider))
      throw Error("此客户端不支持该官方账户");
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
    this.assertManaged(harness);
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
    throw Error("请在客户端内选择模型；ASS 接入范围已改为供应商开关");
  }
  injection(harness) {
    this.spec(harness);
    const settings = this.state.injections[harness];
    return { ...settings, models: injectionCatalog(harness, this.getState().providers, settings) };
  }
  setInjection(harness, changes) {
    if (this.spec(harness).injectionUnsupported) throw Error("此客户端尚未支持供应商接入");
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).some((k) => k !== "excludedProviders"))
      throw Error("接入范围请按供应商设置");
    const next = { ...this.state.injections[harness], ...changes };
    if (!Array.isArray(next.excludedProviders) || next.excludedProviders.length > 5000 ||
        next.excludedProviders.some((r) => typeof r !== "string" || !r || r.length > 250 || /[\x00-\x1f]/.test(r)))
      throw Error("无效供应商排除列表");
    next.excludedProviders = [...new Set(next.excludedProviders)];
    const previous = this.state.injections[harness];
    this.state.injections[harness] = next;
    try { this.save(); } catch (e) { this.state.injections[harness] = previous; throw e; }
    return this.injection(harness);
  }
  bindApi(harness, providerId, bound = true) {
    this.assertManaged(harness);
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
      throw Error("只能添加此客户端对应的官方 API 账户；第三方模型请通过模型接入管理");
    const previous = structuredClone(this.state);
    const bindings = new Set(this.state.accountBindings[harness] || []);
    const excluded = new Set(this.state.accountExclusions[harness] || []);
    if (bound) {
      bindings.add(providerId);
      excluded.delete(providerId);
    } else {
      bindings.delete(providerId);
      excluded.add(providerId);
      if (this.state.selected[harness] === "api:" + providerId)
        delete this.state.selected[harness];
    }
    this.state.accountBindings[harness] = [...bindings];
    this.state.accountExclusions[harness] = [...excluded];
    try {
      this.save();
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }
  reconcileModel(providerId, previousName, nextName) {
    const previous = structuredClone(this.state);
    const previousRef = modelRef(providerId, previousName);
    const nextRef = nextName ? modelRef(providerId, nextName) : null;
    for (const settings of Object.values(this.state.injections)) {
      if (settings.defaultModel === previousRef) settings.defaultModel = nextRef;
      if (settings.excluded) settings.excluded = settings.excluded.flatMap((ref) => ref !== previousRef ? [ref] : nextRef ? [nextRef] : []);
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
  setNativeVariant(harness, variant) {
    if (harness !== "kimi" || !["auto", "current", "legacy"].includes(variant))
      throw Error("无效的客户端配置版本");
    if (this.options.isConnected?.(harness) || this.options.nativeConfig?.list([harness]).length)
      throw Error("请先断开 Kimi 接入，再切换配置版本");
    const previous = this.state.nativeVariants.kimi;
    this.state.nativeVariants.kimi = variant;
    try { this.save(); } catch (error) { this.state.nativeVariants.kimi = previous; throw error; }
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
    this.assertManaged(harness);
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
      nativeSelection,
      credentialCheck;
    if (account.kind === "api") {
      if (!account.ready) throw Error(account.message);
      if (action !== "launch")
        throw new Error(
          "API 账户直接使用供应商密钥，无需网页登录；在供应商页编辑或移除",
        );
      const p = this.getState().providers.find((p) => p.id === account.providerId);
      // Key rotation creates a new runtime home, never overwriting another window.
      const id = crypto.createHash("sha256").update("official\0" + p.id + "\0" + p.apiKey).digest("hex").slice(0, 24);
      dir = this.root(harness, id);
      ({ env: addEnv, files, args, credentialCheck } = officialAccountPlan(harness, p));
      hint = "官方 API 账户仅用于本次新启动；已有窗口和模型接入设置不变。";
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
          const applied = this.options.proxyConfig?.clients.codex;
          const catalog = applied ? `model_catalog_json = ${JSON.stringify(this.options.proxyConfig.config.catalog)}\n` : "";
          const defaultModel = applied?.defaultModel ? `model = ${JSON.stringify(applied.defaultModel.model)}\nmodel_reasoning_effort = ${JSON.stringify(applied.defaultModel.effort)}\n` : "";
          files.push([
            "config.toml",
            `cli_auth_credentials_store = "file"\n${catalog}${defaultModel}model_provider = "ass_official"\n[model_providers.ass_official]\nname = "ASS Official"\nbase_url = "http://127.0.0.1:${this.options.port || 25819}/clients/codex/v1"\nwire_api = "responses"\nrequires_openai_auth = true\nsupports_websockets = false\n`,
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
        args = ["--profile", "web"];
        if (action !== "launch")
          hint =
            "请在 DSH 的授权设置中完成登录或退出；登录方式由已安装的插件提供。";
      }
    }
    // Current DSH ships web/headless/ACP profiles, not a built-in "tui".
    // Native-account launches need the launcher flag too (bare dsh errors).
    if (harness === "dsh" && !args.includes("--profile")) args.unshift("--profile", "web");
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
      authType: account.authType || (account.kind === "api" ? "api" : "oauth"),
      harness,
      nativeSelection,
      nativeProfile: DIRECT.includes(harness) && account.kind !== "native" && action === "launch" && !!this.options.isConnected?.(harness),
      initializeOnly: account.kind === "api",
      credentialCheck,
      routed:
        (account.kind === "native" && harness === "codex" &&
          path.join(dir, "config.toml") === this.options.proxyConfig?.config.file &&
          this.options.proxyConfig.config.status().attached) ||
        (account.kind === "auth" &&
          harness === "codex" &&
          (!this.options.isConnected || this.options.isConnected(harness))),
    };
  }
  materialize(plan) {
    assertClaudeAccount(plan, this.state.workspace || path.join(this.dataDir, "workspace"));
    if (plan.requiresNativeInjection) {
      const status = this.options.nativeConfig?.status(plan.harness, true);
      if (!status?.applied) throw Error("模型接入配置尚未同步，请先在接入控制中同步后再启动");
      for (const [file, content] of plan.launchFiles || []) {
        safePath(file);
        atomic(file, content);
      }
      return;
    }
    if (plan.nativeSelection) {
      if (!this.options.nativeConfig) throw Error("原生接入管理未初始化");
      return this.options.nativeConfig.sync(plan.harness, plan.nativeSelection);
    }
    safePath(plan.dir);
    for (const [name] of plan.files) safePath(path.join(plan.dir, name));
    if (plan.credentialCheck) {
      const check = plan.credentialCheck;
      const current = readNative(path.join(plan.dir, check.file));
      if (current !== null) {
        const data = nativeDocument(current, check.format).data;
        const value = check.path.reduce((object, key) => object?.[key], data);
        if (value !== check.value || (plan.harness === "codex" && data.tokens?.access_token))
          throw Error("此独立窗口的登录凭据已被客户端更改；未覆盖，请先确认该账户身份");
      }
    }
    fs.mkdirSync(plan.dir, { recursive: true });
    if (plan.routed && plan.files.length && this.options.injections)
      return this.options.injections.write(plan.harness, plan);
    for (const [name, content] of plan.files) {
      const file = path.join(plan.dir, name);
      // Immutable API runtime home: do not erase fields added by the client or
      // model injector on the next launch. Key rotation uses a different home.
      if (!plan.initializeOnly || !fs.existsSync(file)) atomic(file, content);
    }
    if (plan.nativeProfile) {
      if (!this.options.nativeConfig) throw Error("原生接入管理未初始化");
      this.options.nativeConfig.syncProfile(plan.harness, plan.dir);
    }
  }
  async launch(harness, account, action, model, token) {
    const launcher = this.launcher(harness);
    if (!launcher.ready) throw new Error(launcher.message);
    const plan = this.plan(harness, account, action, model, token);
    const result = await this.launchPlan(harness, plan, account, action, launcher);
    this.select(harness, account);
    return result;
  }
  modelPlan(harness, ref, token = "") {
    this.assertManaged(harness);
    if (!this.options.isConnected?.(harness)) throw Error("请先开启此客户端的模型接入");
    const row = this.injection(harness).models.find((m) => m.ref === ref && m.included);
    if (!row) throw Error("请选择已纳入接入的兼容模型");
    const p = this.getState().providers.find((p) => p.id === row.providerId);
    const m = p.models.find((m) => m.model === row.model);
    if (DIRECT.includes(harness)) {
      if (harness !== "opencode" && !["low", "medium", "high", "xhigh", "max"].includes(m.defaultEffort))
        throw Error("此客户端原生思维强度不支持所选模型的默认档位，请先调整模型配置");
      const dir = locations(harness, this).dir, id = providerId(p, m.wireApi);
      const env = isolatedEnv(harness, dir, this.nativeEnv);
      if (harness === "opencode") {
        env.XDG_DATA_HOME = path.dirname(dir);
        for (const k of ["XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR"])
          if (this.nativeEnv[k]) env[k] = this.nativeEnv[k]; else delete env[k];
      }
      const launchFiles = [], dshArgs = ["--profile", "web"];
      if (harness === "dsh") {
        // DSH's settings user layer overrides agent-default-model composition
        // config. Use its documented --patch settings-path override with a
        // per-launch snapshot, rather than editing the shared default live.
        const runtime = this.root(harness, crypto.randomBytes(12).toString("hex"));
        const settingsFile = path.join(runtime, "launch-settings.yaml"), patchFile = path.join(runtime, "launch.patch.yml");
        const settings = nativeDocument(readNative(locations(harness, this).config), "yaml").data;
        settings["agent-default-model"] = { provider: id, model: m.model, reasoningEffort: m.defaultEffort };
        launchFiles.push([settingsFile, JSON.stringify(settings, null, 2)],
          [patchFile, JSON.stringify([{ id: "settings", config: { path: settingsFile, watch: false } }])]);
        dshArgs.push("--patch", patchFile);
      }
      return { harness, dir, env, files: [], launchFiles, routed: false, accountKind: "model",
        requiresNativeInjection: true,
        args: harness === "pi" ? ["--provider", id, "--model", m.model, "--thinking", m.defaultEffort]
          : harness === "opencode" ? ["--model", id + "/" + m.model] : dshArgs,
        hint: "使用模型所属供应商的凭据；不切换官方登录账户。" };
    }
    this.options.proxyConfig?.requireApplied(harness);
    const id = crypto.createHash("sha256").update("model\0" + ref).digest("hex").slice(0, 24);
    const dir = this.root(harness, id);
    const config = routeConfig(harness, p, m, dir, token,
      // An API-only model window must not advertise subscription models: its
      // local route token is not a ChatGPT credential and must never fall back.
      makeCatalog([], this.getState().providers.map((provider) => ({ ...provider,
        models: provider.models.filter((model) => this.injection(harness).models.some((row) => row.included && row.ref === modelRef(provider.id, model.model))),
      })), {}), this.options.port || 25819);
    if (harness === "codex") {
      const entry = config.files.find(([name]) => name === "catalog.json");
      const catalog = JSON.parse(entry[1]);
      // makeCatalog supplies an official template when its source cache is
      // empty; retain that only as a template, never as an API-window choice.
      entry[1] = JSON.stringify({ ...catalog, models: catalog.models.filter((m) => m.slug.includes("::")) });
    }
    if (harness === "claude") {
      const name = p.id + "::" + m.model;
      config.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${this.options.port || 25819}/clients/claude/models`;
      for (const key of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"])
        config.env[key] = name;
      config.args = ["--model", name];
    }
    return { ...config, harness, dir, env: { ...isolatedEnv(harness, dir), ...config.env },
      routed: true, accountKind: "model", hint: "使用模型所属供应商的凭据；官方订阅账户不变。" };
  }
  async launchModel(harness, ref, token) {
    const launcher = this.launcher(harness);
    if (!launcher.ready) throw Error(launcher.message);
    return this.launchPlan(harness, this.modelPlan(harness, ref, token), "model:" + ref, "launch", launcher);
  }
  async launchPlan(harness, plan, account, action, launcher) {
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
