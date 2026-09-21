const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { atomic } = require("./config.cjs");
const { makeCatalog } = require("./models.cjs");
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
    oauth: false,
    description: "DeepSeek API 自动成为账户，同时支持其他兼容 API。",
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
function apiAccounts(harness, providers) {
  return providers
    .filter((p) => p.enabled && p.apiKey)
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
        badge:
          harness === "dsh" && deepseek
            ? "DeepSeek API"
            : harness === "opencode" && go
              ? "OpenCode Go API"
              : "API",
        ready: !!models.length,
        models: models.map((m) => ({
          model: m.model,
          name: m.displayName,
          protocol: m.wireApi,
        })),
        message: models.length
          ? "复用加密保存的 API Key"
          : "没有兼容且已启用的模型",
      };
    });
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
  const file = path.join(
    dir,
    harness === "claude"
      ? ".credentials.json"
      : harness === "opencode"
        ? "data/opencode/auth.json"
        : "auth.json",
  );
  const data = json(file);
  let ready = false,
    providers = [];
  if (harness === "codex") ready = !!data.tokens?.access_token;
  else if (harness === "claude") ready = !!data.claudeAiOauth?.accessToken;
  else {
    providers = Object.entries(data)
      .filter(
        ([, v]) =>
          v?.type === "oauth" || v?.type === "api" || v?.type === "api_key",
      )
      .map(([id]) => id);
    ready = providers.length > 0;
  }
  return {
    ready,
    providers,
    message: ready
      ? "已检测本地凭据 · 有效性由原生客户端确认"
      : "尚未检测到凭据",
  };
}
function routeConfig(harness, p, m, dir, token, catalog) {
  const base = "http://127.0.0.1:25819/harness/" + p.id;
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
      `model = ${JSON.stringify(name)}\nmodel_provider = "ass_api"\nmodel_reasoning_effort = ${JSON.stringify(m.defaultEffort)}\nmodel_catalog_json = ${JSON.stringify(path.join(dir, "catalog.json"))}\n[model_providers.ass_api]\nname = "ASS API"\nbase_url = "http://127.0.0.1:25819/v1"\nwire_api = "responses"\nenv_key = "ASS_LOCAL_TOKEN"\nsupports_websockets = false\n`,
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
  ) {
    this.dataDir = dataDir;
    this.codexDir = codexDir;
    this.getState = getState;
    this.officialModels = officialModels;
    this.piProviders = [];
    this.detected = {};
    this.discovery = {};
    this.file = path.join(dataDir, "clients.json");
    this.state = json(this.file, {
      profiles: [],
      selected: {},
      executables: {},
      workspace: "",
    });
  }
  async refreshOAuth() {
    for (const { id } of SPECS) {
      if (!this.state.executables[id]) {
        const candidates = discoverLaunchers(id);
        this.discovery[id] = candidates;
        this.detected[id] =
          candidates.length === 1 ? candidates[0].location : "";
      }
    }
    const pi = this.launcher("pi");
    this.piProviders = await piOAuthProviders(pi.ready ? pi.entryPoint : "");
  }
  launcher(harness) {
    this.spec(harness);
    const selected = this.state.executables[harness];
    if (!selected && this.discovery[harness]?.length > 1) {
      return {
        ...resolveLauncher(harness, ""),
        message: "检测到多套客户端，点击自动识别后选择要使用的一套",
      };
    }
    return resolveLauncher(
      harness,
      selected || this.detected[harness] || findExecutable(harness),
    );
  }
  detect(harness) {
    this.spec(harness);
    return discoverLaunchers(harness);
  }
  oauthSources() {
    return enumerateSources(
      this.codexDir,
      os.homedir(),
      this.state.profiles,
      (h, id) => this.root(h, id),
      this.piProviders,
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
      clients: SPECS.map((s) => ({
        ...s,
        executable: this.launcher(s.id).executable,
        launcher: this.launcher(s.id),
        selected: this.state.selected[s.id] || "",
        accounts: [
          ...apiAccounts(s.id, this.getState().providers),
          ...this.state.profiles
            .filter((p) => p.harness === s.id)
            .map((p) => ({
              ...p,
              kind: "auth",
              badge: "原生授权",
              ...authSummary(s.id, this.root(s.id, p.id)),
            })),
        ],
      })),
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
    if (!row?.accounts.some((p) => p.id === id)) throw new Error("账户不存在");
    this.state.selected[harness] = id;
    this.save();
  }
  setExecutable(harness, file) {
    this.spec(harness);
    const launcher = resolveLauncher(harness, file);
    if (!launcher.ready) throw new Error(launcher.message);
    this.state.executables[harness] = file;
    this.save();
  }
  plan(harness, accountId, action = "launch", modelName, token = "") {
    this.spec(harness);
    if (!["launch", "login", "logout"].includes(action))
      throw new Error("未知操作");
    const account = this.snapshot()
      .clients.find((s) => s.id === harness)
      .accounts.find((p) => p.id === accountId);
    if (!account) throw new Error("请选择账户");
    let dir,
      args = [],
      addEnv = {},
      files = [],
      hint = "";
    if (account.kind === "api") {
      if (action !== "launch")
        throw new Error(
          "API 账户直接使用供应商密钥，无需网页登录；在供应商页编辑或移除",
        );
      const p = this.getState().providers.find(
          (p) => p.id === account.providerId,
        ),
        m = p.models.find(
          (m) =>
            m.model === (modelName || account.models[0]?.model) && m.enabled,
        );
      if (!m) throw new Error("请选择已启用模型");
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
      ));
    } else {
      dir = this.root(harness, account.id);
      if (harness === "codex") {
        if (action !== "launch") args = [action];
        if (!fs.existsSync(path.join(dir, "config.toml")))
          files.push([
            "config.toml",
            'cli_auth_credentials_store = "file"\nmodel_provider = "ass_official"\n[model_providers.ass_official]\nname = "ASS Official"\nbase_url = "http://127.0.0.1:25819/v1"\nwire_api = "responses"\nrequires_openai_auth = true\nsupports_websockets = false\n',
          ]);
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
    }
    return {
      dir,
      args,
      env: { ...isolatedEnv(harness, dir), ...addEnv },
      files,
      hint,
      accountKind: account.kind,
    };
  }
  materialize(plan) {
    fs.mkdirSync(plan.dir, { recursive: true });
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
    const script =
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
        "-NoExit",
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
    this.select(harness, account);
    return {
      ok: true,
      message: plan.hint || "已打开独立客户端窗口；账户切换仅影响本次新启动。",
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
