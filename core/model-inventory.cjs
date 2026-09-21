const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const { parse: parseJSONC } = require("jsonc-parser");
const { EFFORTS } = require("./models.cjs");
const APIs = {
  "openai-completions": "openai-chat",
  "openai-responses": "openai-responses",
  "anthropic-messages": "anthropic",
};
const cache = new Map();
function read(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 8 * 1024 * 1024) return {};
    const stamp = stat.mtimeMs + ":" + stat.ctimeMs + ":" + stat.size;
    if (cache.get(file)?.stamp === stamp) return cache.get(file).data;
    const content = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const errors = [];
    const parsed = file.endsWith(".yaml")
      ? YAML.parse(content, { maxAliasCount: 20 })
      : parseJSONC(content, errors, { allowTrailingComma: true });
    const data =
      !errors.length &&
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
        ? parsed
        : {};
    if (cache.size >= 32) cache.delete(cache.keys().next().value);
    cache.set(file, { stamp, data });
    return data;
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
      vision: Array.isArray(
        raw.input || raw.inputModalities || raw.modalities?.input,
      )
        ? (raw.input || raw.inputModalities || raw.modalities.input).includes(
            "image",
          )
        : undefined,
    },
  };
}
const packages = {
  "@ai-sdk/anthropic": "anthropic",
  "@ai-sdk/openai": "openai-responses",
  "@ai-sdk/openai-compatible": "openai-chat",
  "@opencode/ai/providers/anthropic": "anthropic",
  "@opencode/ai/providers/openai": "openai-responses",
  "@opencode/ai/providers/openai-compatible": "openai-chat",
};
// DSH llm-deepseek defaults, upstream aa8262ec. Advisory, not a live entitlement check.
const deepseekDefaults = [
  {
    id: "deepseek-flash",
    name: "DeepSeek-V41-Flash",
    input: ["text", "image"],
  },
  { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
  { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
  {
    id: "deepseek-v4-flash-vision-exp",
    name: "DeepSeek-V4-Flash-Vision-Exp",
    input: ["text", "image"],
  },
].map((m) => ({ ...m, contextWindow: 1000000 }));
function opencodeModels(account, dir, provider, home, env) {
  const native = account.kind === "native";
  const configDir = native
    ? path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "opencode")
    : path.resolve(dir, "../../config/opencode");
  const files = [
    path.join(configDir, "opencode.json"),
    path.join(configDir, "opencode.jsonc"),
  ];
  if (native && env.OPENCODE_CONFIG) files.push(env.OPENCODE_CONFIG);
  if (native && env.OPENCODE_CONFIG_DIR)
    files.push(
      ...["opencode.json", "opencode.jsonc"].map((f) =>
        path.join(env.OPENCODE_CONFIG_DIR, f),
      ),
    );
  const cacheFile = path.join(
    native
      ? env.XDG_CACHE_HOME || path.join(home, ".cache")
      : path.resolve(dir, "../../cache"),
    "opencode/models.json",
  );
  const builtin = read(cacheFile)[provider] || {};
  let p = { ...builtin, models: { ...builtin.models } },
    blocked = false;
  const custom = new Set();
  for (const file of files) {
    if (!path.isAbsolute(file)) continue;
    const c = read(file);
    if (
      Array.isArray(c.disabled_providers) &&
      c.disabled_providers.includes(provider)
    )
      blocked = true;
    if (
      Array.isArray(c.enabled_providers) &&
      !c.enabled_providers.includes(provider)
    )
      blocked = true;
    const next = c.providers?.[provider] || c.provider?.[provider];
    if (!next || typeof next !== "object") continue;
    const models = { ...p.models };
    for (const [id, raw] of Object.entries(next.models || {})) {
      if (!raw || typeof raw !== "object") continue;
      models[id] = { ...models[id], ...raw };
      custom.add(id);
    }
    p = { ...p, ...next, models };
  }
  if (blocked || p.enabled === false) return [];
  return Object.entries(p.models || {}).flatMap(([id, raw]) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      raw.enabled === false ||
      p.blacklist?.includes(id) ||
      (Array.isArray(p.whitelist) && !p.whitelist.includes(id))
    )
      return [];
    const m = model(raw, id, packages[raw.provider?.npm || p.npm || p.package]);
    return m
      ? [
          {
            ...m,
            nativeProvider: provider,
            catalogSource: custom.has(id)
              ? "OpenCode 本机配置"
              : "OpenCode 本机模型缓存（未联网验证）",
          },
        ]
      : [];
  });
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
  if (client.id === "dsh") {
    const settings = read(path.join(dir, "settings.yaml"));
    configured = settings["llm-pi-ai"]?.providers || {};
    const deep = settings["llm-deepseek"] || {};
    if (
      ["DEEPSEEK_API_KEY", "deepseek", "deepseek-official", deep.apiKeyEnv]
        .filter(Boolean)
        .includes(provider)
    ) {
      const entries = Array.isArray(deep.models)
        ? deep.models
        : deepseekDefaults;
      flat.push(
        ...entries
          .filter((m) => m && typeof m === "object")
          .map((raw) => {
            const m = model(raw, raw.id, "openai-chat");
            return (
              m && {
                ...m,
                nativeProvider: "deepseek-official",
                catalogSource: Array.isArray(deep.models)
                  ? "DSH 本机配置"
                  : "DSH 内置目录（预置，未联网验证）",
              }
            );
          }),
      );
    }
  }
  if (client.id === "opencode") {
    return opencodeModels(account, dir, provider, home, env);
  }
  if (client.id === "claude") {
    const selected = read(path.join(dir, "settings.json")).model;
    if (typeof selected === "string")
      flat.push(model({}, selected, "anthropic"));
  }
  // A logged-in provider's custom/native model declarations; unrelated providers are not attributed to it.
  for (const [id, p] of Object.entries(configured)) {
    if (provider !== id || !p || typeof p !== "object") continue;
    const protocol = p.api || packages[p.npm || p.package];
    for (const [key, raw] of Object.entries(p.models || {})) {
      if (raw && typeof raw === "object")
        flat.push(
          model(raw, Array.isArray(p.models) ? undefined : key, protocol),
        );
    }
  }
  return flat.filter(Boolean);
}
function modelSources(
  store,
  harnesses,
  { home, env = {}, directories = {} } = {},
) {
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
    const directory = directories["native-" + client.id];
    for (const a of accounts)
      for (const m of directory?.accounts?.[a.id]?.models ||
        nativeModels(client, a, home || "", env))
        if (!models.has((m.nativeProvider || "") + "::" + m.model))
          models.set((m.nativeProvider || "") + "::" + m.model, m);
    sources.push({
      id: "native-" + client.id,
      name: client.name + " · 原生账户",
      kind: "native",
      readOnly: true,
      enabled: true,
      accountCount: accounts.length,
      catalogError: directory?.error,
      catalogSource:
        [
          ...new Set(
            [...models.values()].map((m) => m.catalogSource || "本机配置声明"),
          ),
        ].join(" · ") || "本机目录未找到，可在原生客户端刷新模型后重试",
      models: [...models.values()],
    });
  }
  return sources;
}
module.exports = { modelSources, nativeModels };
