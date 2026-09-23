// Read-only native adapters. Credentials never leave this module; neither
// discovery nor snapshot collection runs clients, key helpers, or token refresh.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, createDecipheriv } = require("node:crypto");
const TOML = require("@iarna/toml");
const { safePath } = require("./native-fields.cjs");
const { text, claims } = require("./account-info.cjs");
const { EFFORTS } = require("./models.cjs");

const SPECS = [
  { id: "kimi", name: "Kimi Code", command: "kimi" },
  { id: "zcode", name: "ZCode", command: "zcode" },
  { id: "antigravity", name: "Antigravity", command: "agy" },
].map((s) => ({ ...s, oauth: false, nativeLoginOnly: true,
  injectionUnsupported: s.id === "antigravity"
    ? "此版本识别 agy CLI 配置。OAuth 由系统密钥库管理；IDE 账户与配置接入尚未适配。"
    : "此版本仅识别原生账户与模型；账户切换与配置接入尚未适配。" }));
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const has = (v) => typeof v === "string" && !!v.trim();
const hash = (v) => createHash("sha256").update(v).digest("hex").slice(0, 20);
const protocols = { openai: "openai-chat", openai_legacy: "openai-chat",
  openai_responses: "openai-responses", anthropic: "anthropic",
  "openai-chat-completions": "openai-chat", "openai-responses": "openai-responses",
  "anthropic-messages": "anthropic" };

function read(file, format = "json") {
  try {
    safePath(file);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error();
    const source = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const data = format === "toml" ? TOML.parse(source) : JSON.parse(source);
    if (!object(data)) throw Error();
    return { file, data, status: "detected", updatedAt: stat.mtimeMs };
  } catch (e) {
    return { file, status: e.code === "ENOENT" ? "missing" : "unreadable",
      message: e.code === "ENOENT" ? "" : "本机配置或凭据无法读取，未修改原文件" };
  }
}
const resolved = (dir, home) => path.resolve(dir.replace(/^~(?=[/\\]|$)/, home));
function locations(id, { home, env = {}, override }) {
  if (override) {
    const dir = resolved(override, home), same = (p) => p && resolved(p, home).toLowerCase() === dir.toLowerCase();
    const legacy = path.basename(dir) === ".kimi" || same(env.KIMI_SHARE_DIR) ? true :
      path.basename(dir) === ".kimi-code" || same(env.KIMI_CODE_HOME) ? false : null;
    return [{ dir, legacy }];
  }
  if (id === "kimi") return [
    { dir: resolved(env.KIMI_CODE_HOME || path.join(home, ".kimi-code"), home), legacy: false },
    { dir: resolved(env.KIMI_SHARE_DIR || path.join(home, ".kimi"), home), legacy: true },
  ].filter((v, i, a) => a.findIndex((w) => w.dir.toLowerCase() === v.dir.toLowerCase()) === i);
  if (id === "zcode") return [{ dir: path.join(resolved(env.ZCODE_DATA_BASE_DIR || home, home), ".zcode", "v2") }];
  if (id === "antigravity") return [{ dir: path.join(home, ".gemini", "antigravity-cli") }];
  throw Error("未知原生客户端");
}
function official(base, service) {
  try {
    const u = new URL(base), p = u.pathname.replace(/\/+$/, "");
    if (u.protocol !== "https:" || u.port || u.username || u.password || u.search || u.hash) return false;
    if (service === "kimi") return (u.hostname === "api.kimi.com" && p === "/coding/v1") ||
      (["api.moonshot.cn", "api.moonshot.ai"].includes(u.hostname) && p === "/v1");
    if (service === "zcode") return ["open.bigmodel.cn", "api.z.ai"].includes(u.hostname) &&
      ["/api/paas/v4", "/api/coding/paas/v4"].includes(p);
    return u.hostname === "generativelanguage.googleapis.com";
  } catch { return false; }
}
function authorization(access, refresh, seconds, now) {
  const n = Number(seconds), expiresAt = Number.isFinite(n) && n > 0 && n < 8.64e12 ? n * 1000 : null;
  const expired = expiresAt !== null && expiresAt <= now;
  return { authType: "oauth", ready: has(access) && (!expired || has(refresh)), expiresAt,
    status: !has(access) ? "incomplete" : expired ? has(refresh) ? "refresh-required" : "expired" : "detected",
    message: !has(access) ? "OAuth 凭据不完整" : expired ? has(refresh) ? "访问令牌已到期 · 由客户端刷新" : "授权已到期 · 需要重新登录" : "OAuth" };
}
function account(harness, dir, file, provider, label, auth, fields = [], secrets = []) {
  if (!text(provider, secrets)) return null;
  return { ...auth, id: "native:" + hash([harness, dir, provider, file].join("\0")),
    kind: "native", provider, providers: [provider], label: text(label, secrets) || harness,
    badge: auth.authType === "oauth" ? "OAuth" : "API Key", source: "本机账户",
    nativeDir: dir, sourcePath: file,
    profile: { source: "local", docs: [harness], fields: fields.flatMap(([id, label, v]) => {
      const value = text(v, secrets); return value ? [{ id, label, value }] : [];
    }) } };
}
const apiAuth = { authType: "api", ready: true, status: "detected", message: "API Key" };
function model(id, provider, raw, protocol, secrets) {
  const name = text(id, secrets), nativeProvider = text(provider, secrets);
  if (!name || !nativeProvider) return null;
  const positive = (n) => Number.isSafeInteger(n) && n > 0 ? n : null;
  const efforts = Array.isArray(raw.efforts) ? [...new Set(raw.efforts.filter((e) => EFFORTS.includes(e)))] : [];
  return { model: name, nativeProvider, displayName: text(raw.name, secrets) || name,
    wireApi: protocols[protocol] || "", contextWindow: positive(raw.context),
    maxOutputTokens: positive(raw.output), efforts,
    defaultEffort: efforts.includes(raw.defaultEffort) ? raw.defaultEffort : null,
    enabled: true, declared: { vision: typeof raw.vision === "boolean" ? raw.vision : null },
    catalogSource: "本机配置声明" };
}
function catalog(harness, dir, file, models) {
  return { id: "catalog:" + hash(harness + dir + file), kind: "native", catalogOnly: true,
    nativeDir: dir, sourcePath: file, declaredModels: models };
}

function inspectKimi(location, { env, now }) {
  const { dir, legacy } = location, file = path.join(dir, "config.toml"), config = read(file, "toml");
  const sources = [config], accounts = [], models = [], providers = object(config.data?.providers) ? config.data.providers : {};
  const loaded = [], secrets = [];
  for (const [id, p] of Object.entries(providers)) {
    if (!object(p)) continue;
    const envName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.api_key_env || "") ? p.api_key_env : "";
    const key = has(p.api_key) ? p.api_key : envName ? env[envName] : "";
    if (has(key)) secrets.push(key);
    if (has(p.api_key) + has(p.api_key_env) + !!p.oauth > 1) {
      sources.push({ file, status: "unreadable", message: "Kimi 同一供应商声明了多种凭据，未推断登录状态" });
      continue;
    }
    let auth, source = file;
    if (p.oauth) {
      const ref = p.oauth;
      if (ref.storage !== "file") {
        sources.push({ file, status: "external", message: "Kimi OAuth 使用系统密钥库；未读取文件凭据" });
        continue;
      }
      // Both clients map logical oauth/<slot> refs to credentials/<slot>.json.
      // Kimi Code's toolkit normalizes the ref before its basename-only storage.
      const key = typeof ref.key === "string" && ref.key.startsWith("oauth/") ? ref.key.slice(6) : ref.key;
      if (!has(key) || key.startsWith(".") || /[/\\:\x00-\x1f]/.test(key) || key.length > 160) {
        sources.push({ file, status: "unreadable", message: "Kimi OAuth 存储名称无效" });
        continue;
      }
      source = path.join(dir, "credentials", key + ".json");
      const token = read(source); sources.push(token);
      if (!token.data) continue;
      const t = token.data;
      secrets.push(t.access_token, t.refresh_token);
      // Revoked tombstones deliberately retain a file with empty token fields.
      if (!has(t.access_token) && !has(t.refresh_token)) continue;
      auth = authorization(t.access_token, t.refresh_token, t.expires_at, now);
    } else if (has(key)) auth = apiAuth;
    if (auth && official(p.base_url, "kimi")) loaded.push({ id, auth, source, envName });
  }
  for (const row of loaded) accounts.push(account("kimi", dir, row.source, row.id,
    legacy ? "Kimi CLI（旧版）" : legacy === null ? "Kimi Code（自定义目录）" : "Kimi Code", row.auth,
    [["provider", "供应商", row.id], ["version", "配置版本", legacy ? "旧版 .kimi" : legacy === null ? "自定义目录" : "新版 .kimi-code"],
      ["keyEnvironment", "密钥变量", row.envName]], secrets));
  for (const raw of Object.values(object(config.data?.models) ? config.data.models : {})) {
    if (!object(raw) || !Object.hasOwn(providers, raw.provider) || !object(providers[raw.provider])) continue;
    // Routing identity cannot be changed through model metadata overrides.
    const o = object(raw.overrides) ? raw.overrides : {}, v = { ...raw, ...o };
    const m = model(raw.model, raw.provider, { name: v.display_name, context: v.max_context_size,
      output: v.max_output_size, efforts: v.support_efforts, defaultEffort: v.default_effort,
      vision: Array.isArray(v.capabilities) ? v.capabilities.includes("image_in") : null },
    raw.protocol || providers[raw.provider].type, secrets);
    if (m) models.push(m);
  }
  return { sources, accounts, modelAccounts: models.length ? [catalog("kimi", dir, file, models)] : [] };
}

function decryptZCode(value, env) {
  if (typeof value !== "string") return "";
  if (!value.startsWith("enc:v1:")) return value;
  let username = "unknown";
  try { username = os.userInfo().username; } catch {}
  const secret = env.ZCODE_CREDENTIAL_SECRET?.trim() || `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${username}`;
  const parts = value.slice(7).split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[\w-]+$/.test(p))) throw Error();
  const [iv, tag, encrypted] = parts.map((p) => Buffer.from(p, "base64url"));
  if (iv.length !== 12 || tag.length !== 16) throw Error();
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
function inspectZCode({ dir }, { env, now, override }) {
  const credentials = read(path.join(dir, "credentials.json")), accounts = [], models = [], sources = [credentials];
  if (credentials.data && Object.values(credentials.data).some((v) => typeof v !== "string")) {
    credentials.status = "unreadable"; credentials.message = "ZCode 凭据格式无法识别";
    delete credentials.data;
  }
  const secrets = [], tokens = [];
  for (const provider of ["zai", "bigmodel"]) {
    try {
      const value = (key) => decryptZCode(credentials.data?.[`oauth:${provider}:${key}`], env);
      const access = value("access_token"), refresh = value("refresh_token");
      secrets.push(access, refresh);
      if (!has(access) && !has(refresh)) continue;
      let user = {};
      try { user = JSON.parse(value("user_info") || "{}"); } catch {}
      tokens.push({ provider, user: object(user) ? user : {}, auth: authorization(access, refresh, claims(access).exp, now) });
    } catch {
      sources.push({ file: credentials.file, status: "unreadable", message: "ZCode 凭据无法解密；请确认当前系统账户与凭据密钥" });
    }
  }
  const file = !override && env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE
    ? path.resolve(env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE) : path.join(dir, "provider_config.json");
  const stored = read(file), config = stored.data?.config;
  const rules = config?.providerConfigRules?.providerRules;
  const modelRules = config?.modelConfigRules;
  sources.push(stored);
  if (stored.data && (stored.data.schemaVersion !== 1 || !object(config) || !Array.isArray(rules) ||
      !Array.isArray(modelRules?.providerModelRules) || !Array.isArray(modelRules?.manualProviderModelRules))) {
    stored.status = "unreadable"; stored.message = "ZCode 供应商配置版本或结构无法识别";
  } else if (stored.data) {
    for (const r of rules) if (has(r?.config?.access?.apiKey)) secrets.push(r.config.access.apiKey);
    for (const r of rules) {
      if (!object(r) || !object(r.config) || !has(r.providerId) || r.enabled === false ||
          (r.providerId.startsWith("account:") && r.config.access !== undefined)) continue;
      const p = r.config, access = p.access;
      if (["api-key", "zhipu-coding-plan-api-key"].includes(access?.type) && has(access.apiKey) && official(p.api?.baseUrl, "zcode"))
        accounts.push(account("zcode", dir, file, r.providerId, r.providerName || "ZCode API", apiAuth,
          [["provider", "供应商", r.providerName || r.providerId]], secrets));
      const exact = [...modelRules.providerModelRules, ...modelRules.manualProviderModelRules].filter((m) => m?.providerId === r.providerId);
      // Only explicitly listed personal models, not rule patterns, create models.
      for (const id of Array.isArray(p.personalModelIds) ? p.personalModelIds : []) {
        const entries = exact.filter((m) => m.modelId === id);
        if (entries.length > 1) continue; // conflicting smart/manual declaration
        const c = entries[0]?.config || {}, props = c.properties || {};
        if (c.enabled === false) continue;
        const m = model(id, r.providerId, { context: props.contextWindow, vision: props.inputFormat?.supportsImage }, p.api?.type, secrets);
        if (m) models.push(m);
      }
    }
  }
  for (const t of tokens) accounts.push(account("zcode", dir, credentials.file, t.provider,
    t.provider === "zai" ? "Z.ai" : "智谱 BigModel", t.auth,
    t.provider === "zai" && has(t.user.user_id) ? [["email", "邮箱", t.user.email], ["name", "名称", t.user.name], ["accountId", "用户 ID", t.user.user_id]] :
      [["name", "名称", t.user.displayName || t.user.username], ["accountId", "用户 ID", t.user.id]], secrets));
  return { sources, accounts, modelAccounts: models.length ? [catalog("zcode", dir, file, models)] : [] };
}
function inspectAntigravity({ dir }, { env }) {
  const config = read(path.join(dir, "settings.json")), sources = [config], accounts = [];
  if (config.data?.modelProvider === "gemini") {
    if (has(env.GEMINI_API_KEY) && (!env.GOOGLE_GEMINI_BASE_URL || official(env.GOOGLE_GEMINI_BASE_URL, "gemini")))
      accounts.push(account("antigravity", dir, "环境变量 GEMINI_API_KEY", "gemini", "Gemini API", apiAuth,
        [["keyEnvironment", "密钥变量", "GEMINI_API_KEY"]]));
  } else if (config.data) {
    sources.push({ file: "Windows 凭据管理器 / 系统密钥库", status: "external",
      message: "Antigravity OAuth 使用系统密钥库；未读取或推断登录身份" });
  }
  return { sources, accounts, modelAccounts: [] };
}
function inspect(id, options) {
  const input = { env: {}, now: Date.now(), ...options };
  const inspectOne = { kimi: inspectKimi, zcode: inspectZCode, antigravity: inspectAntigravity }[id];
  const results = locations(id, input).map((location) => inspectOne(location, input));
  // Do not return parsed files: they contain raw credentials and arbitrary fields.
  return { sources: results.flatMap((r) => r.sources).map(({ file, status, message = "" }) => ({ file, status, message })),
    accounts: results.flatMap((r) => r.accounts).filter(Boolean), modelAccounts: results.flatMap((r) => r.modelAccounts) };
}
module.exports = { SPECS, inspect, locations };
