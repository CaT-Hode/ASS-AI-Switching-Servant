// Read a selected native API credential without executing helpers or refreshing
// OAuth. Secrets stay in the main process; destinations are pinned to official origins.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const YAML = require("yaml");
const { opencodeProvider } = require("./model-inventory.cjs");
const endpoints = {
  deepseek: "https://api.deepseek.com",
  opencode: "https://opencode.ai/zen/v1",
  "opencode-go": "https://opencode.ai/zen/go/v1",
};
const aliases = {
  DEEPSEEK_API_KEY: "deepseek",
  "deepseek-official": "deepseek",
  "opencode-zen": "opencode",
};
function endpoint(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash) return "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch { return ""; }
}
function configuredBase(client, account, rawId, id, options) {
  const dir = account.nativeDir || path.dirname(account.sourcePath || ""), env = options.env || process.env;
  if (client.id === "opencode") {
    try {
      const providers = [...new Set([rawId, id])].map((providerId) =>
        opencodeProvider(account, dir, providerId, options.home || os.homedir(), env));
      if (providers.some((provider) => !provider.enabled || Object.keys(provider.options?.headers || {}).length)) return "";
      const bases = providers.map((provider) => provider.options?.baseURL || provider.api).filter(Boolean);
      if (bases.some((base) => endpoint(base) !== endpoint(endpoints[id]))) return "";
      const custom = providers.flatMap((provider) => Object.values(provider.models || {}).map((m) => m?.provider?.api).filter(Boolean));
      if (custom.some((value) => endpoint(value) !== endpoint(endpoints[id]))) return "";
      if (providers.some((provider) => Object.values(provider.models || {}).some((m) => Object.keys(m?.headers || {}).length))) return "";
      const base = bases[0] || endpoints[id];
      return endpoint(base);
    } catch { return ""; }
  }
  if (client.id === "dsh" || client.id === "pi") {
    let provider = {};
    try {
      if (client.id === "dsh") {
        const dsh = require("./dsh-config.cjs");
        const settings = dsh.readSettings(dir, (file, format) => {
          let text;
          try { text = fs.readFileSync(file, "utf8"); }
          catch (error) { if (error.code === "ENOENT") return {}; throw error; }
          if (text.length > 8 * 1024 * 1024) throw Error();
          return format === "yaml" ? YAML.parse(text, { maxAliasCount: 20 }) : JSON.parse(text);
        }) || {};
        provider = rawId === "DEEPSEEK_API_KEY" ? settings["llm-deepseek"] || {}
          : settings["llm-pi-ai"]?.providers?.[rawId] || {};
      } else {
        const file = path.join(dir, "models.json");
        if (fs.existsSync(file)) {
          const data = JSON.parse(fs.readFileSync(file, "utf8"));
          provider = data.providers?.[rawId] || {};
        }
      }
    } catch { return ""; }
    if (Object.keys(provider.headers || {}).length ||
        Object.values(provider.models || {}).some((model) => Object.keys(model?.headers || {}).length)) return "";
    const base = provider.baseURL || provider.baseUrl || endpoints[id];
    const normalized = endpoint(base);
    if (id === "deepseek") {
      try {
        const url = new URL(normalized);
        return url.hostname === "api.deepseek.com" && ["/", "/v1"].includes(url.pathname) ? normalized : "";
      } catch { return ""; }
    }
    return normalized === endpoint(endpoints[id]) ? normalized : "";
  }
  return endpoint(endpoints[id]);
}
function nativeOfficialProvider(client, account, options = {}) {
  if (
    !account ||
    account.kind === "api" ||
    account.authType !== "api" ||
    !account.ready
  )
    return null;
  const rawId = account.provider || account.oauthProvider;
  const id = aliases[rawId] || rawId;
  if (
    !Object.hasOwn(endpoints, id) ||
    !["dsh", "opencode", "pi"].includes(client.id)
  )
    return null;
  const file = account.sourcePath;
  if (!file || !path.isAbsolute(file)) return null;
  try {
    if (fs.statSync(file).size > 2 * 1024 * 1024) return null;
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const data =
      client.id === "dsh"
        ? YAML.parse(text, { maxAliasCount: 20 })
        : JSON.parse(text);
    let key;
    if (client.id === "dsh") {
      if (rawId === "DEEPSEEK_API_KEY")
        key =
          data.refs?.DEEPSEEK_API_KEY ||
          (!data.version && data.DEEPSEEK_API_KEY);
      else if (data.records?.["llm-pi-ai/" + rawId]?.kind === "api-key")
        key = data.records["llm-pi-ai/" + rawId].key;
    } else if (["api", "api_key"].includes(data[rawId]?.type))
      key = data[rawId].key;
    const env = options.env || process.env;
    const resolve = (value) => {
      if (value && typeof value === "object" && typeof value.env === "string") value = env[value.env];
      if (typeof value !== "string") return "";
      const match = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value.trim());
      return match ? env[match[1]] || "" : value;
    };
    if (client.id === "opencode") {
      const dir = account.nativeDir || path.dirname(file);
      const p = opencodeProvider(account, dir, rawId, options.home || os.homedir(), env);
      if (p.options?.apiKey !== undefined) key = resolve(p.options.apiKey);
    }
    if (client.id === "dsh" && rawId === "DEEPSEEK_API_KEY") {
      const settings = require("./dsh-config.cjs").readSettings(account.nativeDir || path.dirname(file),
        (source) => { try { return YAML.parse(fs.readFileSync(source, "utf8"), { maxAliasCount: 20 }) || {}; }
          catch (error) { if (error.code === "ENOENT") return {}; throw error; } });
      const name = settings["llm-deepseek"]?.apiKeyEnv || "DEEPSEEK_API_KEY";
      const stored = data.refs?.[name] || (!data.version && data[name]);
      if (stored && env[name] && stored !== env[name]) return null;
      key = stored || env[name];
    }
    if (typeof key !== "string" || !key.trim() || /^[!$]/.test(key) || /\{(?:env|file):/.test(key))
      return null;
    const baseUrl = configuredBase(client, account, rawId, id, options);
    if (!baseUrl) return null;
    return {
      id: "native-info:" + client.id + ":" + account.id,
      nativeProvider: id,
      baseUrl,
      apiKey: key.trim(),
      network: "system",
      wireApi: "openai-chat",
      models: [],
    };
  } catch {
    return null;
  }
}
module.exports = { nativeOfficialProvider };
