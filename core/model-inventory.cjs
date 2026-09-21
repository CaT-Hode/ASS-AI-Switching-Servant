const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const { EFFORTS } = require("./models.cjs");
const APIs = {
  "openai-completions": "openai-chat",
  "openai-responses": "openai-responses",
  "anthropic-messages": "anthropic",
};
function read(file) {
  try {
    if (fs.statSync(file).size > 8 * 1024 * 1024) return {};
    const content = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const parsed = file.endsWith(".yaml")
      ? YAML.parse(content, { maxAliasCount: 20 })
      : JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}
// Only allowlisted display metadata leaves this module. Never evaluate auth helpers or commands.
function model(raw, id, protocol) {
  const name = raw?.id || raw?.model || id;
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 250 ||
    /[\x00-\x1f]/.test(name)
  )
    return null;
  const context = Number(
    raw.contextWindow || raw.context_window || raw.limit?.context,
  );
  const api = APIs[raw.api] || APIs[protocol] || protocol;
  const efforts = (
    Array.isArray(raw.efforts)
      ? raw.efforts
      : Object.keys(raw.reasoningEfforts || raw.variants || {})
  ).filter((e) => EFFORTS.includes(e));
  return {
    model: name,
    displayName: String(raw.name || raw.displayName || name).slice(0, 250),
    wireApi: ["openai-responses", "openai-chat", "anthropic"].includes(api)
      ? api
      : "",
    contextWindow:
      Number.isSafeInteger(context) && context > 0 ? context : null,
    efforts,
    defaultEffort: efforts.includes(raw.defaultEffort)
      ? raw.defaultEffort
      : null,
    enabled: true,
    declared: {
      vision: Array.isArray(raw.input)
        ? raw.input.includes("image")
        : undefined,
    },
  };
}
function nativeModels(client, account, home, env) {
  const dir = account.nativeDir || path.dirname(account.sourcePath || "");
  if (!path.isAbsolute(dir)) return [];
  const provider =
    account.oauthProvider || account.provider || account.providers?.[0];
  let configured = {},
    flat = [];
  if (client.id === "pi")
    configured = read(path.join(dir, "models.json")).providers || {};
  if (client.id === "dsh")
    configured =
      read(path.join(dir, "settings.yaml"))["llm-pi-ai"]?.providers || {};
  if (client.id === "opencode") {
    const configDir =
      account.kind === "native"
        ? path.join(
            env.XDG_CONFIG_HOME || path.join(home, ".config"),
            "opencode",
          )
        : path.resolve(dir, "../../config/opencode");
    configured = read(path.join(configDir, "opencode.json")).provider || {};
  }
  if (client.id === "claude") {
    const selected = read(path.join(dir, "settings.json")).model;
    if (typeof selected === "string")
      flat.push(model({}, selected, "anthropic"));
  }
  // A logged-in provider's custom/native model declarations; unrelated providers are not attributed to it.
  for (const [id, p] of Object.entries(configured)) {
    if (provider !== id || !p || typeof p !== "object") continue;
    const protocol =
      p.api ||
      {
        "@ai-sdk/anthropic": "anthropic",
        "@ai-sdk/openai": "openai-responses",
        "@ai-sdk/openai-compatible": "openai-chat",
      }[p.npm];
    for (const [key, raw] of Object.entries(p.models || {})) {
      if (raw && typeof raw === "object")
        flat.push(
          model(raw, Array.isArray(p.models) ? undefined : key, protocol),
        );
    }
  }
  return flat.filter(Boolean);
}
function modelSources(store, harnesses, { home, env = {} } = {}) {
  const officialClient = harnesses.clients.find((c) => c.id === "codex");
  const sources = [
    {
      id: "official",
      name: "OpenAI 官方",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      kind: "subscription",
      enabled: true,
      models: store.officialModels,
      accountCount:
        officialClient?.accounts.filter(
          (a) => a.kind !== "api" && a.authType === "oauth",
        ).length || 0,
    },
    ...store.providers,
  ];
  for (const client of harnesses.clients.filter((c) => c.id !== "codex")) {
    const accounts = client.accounts.filter((a) => a.kind !== "api");
    if (!accounts.length) continue;
    const models = new Map();
    for (const a of accounts)
      for (const m of nativeModels(client, a, home || "", env))
        if (!models.has(m.model)) models.set(m.model, m);
    sources.push({
      id: "native-" + client.id,
      name: client.name + " · 原生账户",
      kind: "native",
      readOnly: true,
      enabled: true,
      accountCount: accounts.length,
      catalogSource: "本机配置声明",
      models: [...models.values()],
    });
  }
  return sources;
}
module.exports = { modelSources, nativeModels };
