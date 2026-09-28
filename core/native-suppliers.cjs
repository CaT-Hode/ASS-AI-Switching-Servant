const { createHash } = require("node:crypto");
const { nativeOfficialProvider } = require("./native-official.cjs");
const { nativeModels } = require("./model-inventory.cjs");
const { resolveNativeApiTarget } = require("./native-model-diagnostics.cjs");
const { normalizeModel } = require("./models.cjs");
const { inferProtocol } = require("./presets.cjs");
const { safeBaseUrl, canonicalEndpoint, supplierHeaders, apiIdentity, sameApi } = require("./native-api-identity.cjs");
const { withReadScope } = require("./read-scope.cjs");
const names = { deepseek: "DeepSeek", opencode: "OpenCode Zen", "opencode-go": "OpenCode Go" };
const assOwnedProvider = (value) => /^(?:ass-(?:api|[a-f0-9]{16}-(?:chat|responses|messages))|ass_(?:api|official))$/i.test(String(value || ""));
const trimEndpoint = canonicalEndpoint;
function displayName(target, client) {
  const byHost = { "api.deepseek.com": "DeepSeek", "opencode.ai": "OpenCode", "api.openai.com": "OpenAI",
    "api.anthropic.com": "Anthropic", "api.kimi.com": "Kimi", "api.moonshot.cn": "Moonshot", "api.z.ai": "Z.ai",
    "open.bigmodel.cn": "智谱 BigModel" };
  try {
    const host = new URL(target.baseUrl).hostname;
    const fallback = byHost[host] || host;
    const label = typeof target.nativeProviderName === "string" && !/[\x00-\x1f\x7f]/.test(target.nativeProviderName) &&
      target.nativeProviderName.trim() && (!target.apiKey || !target.nativeProviderName.includes(target.apiKey))
      ? target.nativeProviderName.trim().slice(0, 80) : fallback;
    const brandValue = byHost[host] || target.nativeProvider || host;
    const brand = typeof brandValue === "string" && !/[\x00-\x1f\x7f]/.test(brandValue) &&
      (!target.apiKey || !brandValue.includes(target.apiKey)) ? brandValue.slice(0, 80) : fallback;
    return { name: label, brand };
  } catch { return { name: target.nativeProviderName || client.name, brand: target.nativeProvider || "generic" }; }
}

// A credential is discoverable even without a model catalog. Empty model rows
// below are resolution probes only: they never become invented model entries.
function nativeApiProfiles(clients, { home, env = {} } = {}) {
  return withReadScope(() => discoverApiProfiles(clients, { home, env }));
}
function discoverApiProfiles(clients, { home, env }) {
  const groups = new Map();
  let visited = 0;
  for (const client of clients || []) for (const account of client.modelAccounts || client.accounts || []) {
    if (account.kind === "api" || account.authType === "oauth" || assOwnedProvider(account.provider || account.oauthProvider)) continue;
    let rows = [];
    try { rows = account.declaredModels || nativeModels(client, account, home || "", env); } catch { continue; }
    const provider = account.provider || account.oauthProvider || account.providers?.[0];
    const probes = provider && !rows.length ? [{ model: "", nativeProvider: provider }] : [];
    for (const model of [...rows, ...probes]) {
      if (++visited > 2000) return [...groups.values()];
      if (!model || model.enabled === false || assOwnedProvider(model.nativeProvider)) continue;
      let target;
      try { target = resolveNativeApiTarget(client, account, model, { home, env }); } catch { continue; }
      if (target.nativeAuthType !== "api" || !target.apiKey || !target.protocol ||
          !["openai-chat", "openai-responses", "anthropic"].includes(target.protocol)) continue;
      const baseUrl = safeBaseUrl(target.baseUrl);
      if (!baseUrl) continue;
      const url = new URL(baseUrl);
      if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
          /^\/(?:clients\/(?:ASS|codex|claude)|codex\/router|codex\/v1)(?:\/|$)/i.test(url.pathname)) continue;
      if (target.apiKey.length >= 8 && model.model.includes(target.apiKey)) continue;
      const extraHeaders = supplierHeaders(target.extraHeaders, target.apiKey);
      if (!extraHeaders) continue;
      const key = apiIdentity({ baseUrl, apiKey: target.apiKey, extraHeaders });
      if (!groups.has(key)) {
        const display = displayName(target, client);
        groups.set(key, { id: "native-profile:" + key.slice(0, 20),
          baseUrl, apiKey: target.apiKey, extraHeaders, wireApi: target.protocol,
          name: display.name, brand: display.brand, models: [], modelRefs: [], accountRefs: [], clients: [] });
      }
      const group = groups.get(key);
      if (model.model && !group.models.some((row) => row.model === model.model)) {
        const display = typeof model.displayName === "string" &&
          (!target.apiKey || !model.displayName.includes(target.apiKey)) ? model.displayName : model.model;
        group.models.push({ ...model, displayName: display, wireApi: target.protocol });
      }
      if (model.model && !group.modelRefs.some((row) => row.clientId === client.id && row.accountId === account.id &&
          row.nativeProvider === model.nativeProvider && row.model === model.model))
        group.modelRefs.push({ clientId: client.id, accountId: account.id, nativeProvider: model.nativeProvider || "", model: model.model });
      if (!group.accountRefs.some((row) => row.clientId === client.id && row.accountId === account.id))
        group.accountRefs.push({ clientId: client.id, accountId: account.id, nativeDir: account.nativeDir });
      if (!group.clients.includes(client.id)) group.clients.push(client.id);
      group.nativeProviders ||= [];
      if (!group.nativeProviders.some((row) => row.clientId === client.id && row.nativeProvider === model.nativeProvider))
        group.nativeProviders.push({ clientId: client.id, nativeProvider: model.nativeProvider || "" });
    }
  }
  return [...groups.values()];
}

function promoteNativeApiProfile({ store, profile }) {
  if (!profile?.apiKey || !profile.baseUrl) return null;
  const baseUrl = safeBaseUrl(profile.baseUrl);
  if (!baseUrl) return null;
  const identity = apiIdentity(profile);
  if (!identity) return null;
  const existing = store.state.providers.find((provider) => sameApi(provider, profile));
  const id = existing?.id || "native_api_" + identity.slice(0, 20);
  const legacy = Object.keys(names).map((name) => "native_api_" + createHash("sha256").update(name + "\0" + profile.apiKey).digest("hex").slice(0, 20));
  if (!existing && (store.state.nativeApiExclusions?.includes(identity) ||
      [id, ...legacy].some((entry) => store.state.nativeSupplierExclusions?.includes(entry)))) return null;
  const originName = profile.clients?.includes("dsh") && new URL(baseUrl).hostname === "api.deepseek.com"
    ? "DeepSeek · DSH 原生" : profile.name;
  const provider = { id, name: existing?.name || originName || "原生 API", brand: existing?.brand || profile.brand || "generic",
    baseUrl: existing?.baseUrl || baseUrl, apiKey: profile.apiKey, network: existing?.network || "system", wireApi: existing?.wireApi || profile.wireApi || "openai-chat",
    extraHeaders: existing?.extraHeaders || profile.extraHeaders || {}, enabled: existing?.enabled !== false,
    balance: existing?.balance || { preset: "auto" } };
  const seen = new Set();
  const imported = new Set(existing?.nativeImportedModels || []);
  const incoming = (profile.models || []).filter((raw) => !imported.has(raw.model));
  const rows = [...(existing?.models || []), ...incoming].flatMap((raw) => {
    if (!raw?.model || seen.has(raw.model)) return [];
    try {
      const model = normalizeModel({ ...raw, wireApi: raw.wireApi || inferProtocol(provider, raw.model),
        efforts: raw.efforts?.length ? raw.efforts : undefined,
        contextWindow: raw.contextWindow >= 4096 ? raw.contextWindow : undefined }, provider, store.officialModels);
      seen.add(raw.model); return [model];
    } catch { return []; }
  });
  for (const row of profile.models || []) imported.add(row.model);
  const nativeImportedModels = [...imported];
  if (existing && rows.length === existing.models.length &&
      JSON.stringify(existing.nativeImportedModels || []) === JSON.stringify(nativeImportedModels)) return existing.id;
  return store.updateProvider({ ...provider, models: rows, nativeImportedModels,
    nativeCatalogInitialized: existing?.nativeCatalogInitialized || rows.length > 0 });
}

// Kept for the verified official catalog path and its stable supplier IDs.
function promoteNativeSupplier({ store, client, account, verified, models, home, env = {} }) {
  const native = nativeOfficialProvider(client, account, { home, env });
  if (!native || !verified) return null;
  const existing = store.state.providers.find((p) => sameApi(p, native));
  if (existing?.models.length || existing?.nativeCatalogInitialized) return existing.id;
  const id = "native_api_" + createHash("sha256").update(native.nativeProvider + "\0" + native.apiKey).digest("hex").slice(0, 20);
  if (store.state.nativeSupplierExclusions?.includes(id) || store.state.nativeApiExclusions?.includes(apiIdentity(native))) return null;
  const provider = { id: existing?.id || id, name: names[native.nativeProvider], brand: native.nativeProvider,
    baseUrl: native.baseUrl, apiKey: native.apiKey, network: "system", wireApi: native.wireApi,
    enabled: true, balance: { preset: "auto" } };
  const rows = models || nativeModels(client, account, home, env);
  const seen = new Set();
  provider.models = rows.flatMap((raw) => {
    if (!raw?.model || seen.has(raw.model)) return [];
    try {
      const model = normalizeModel({ ...raw, wireApi: raw.wireApi || inferProtocol(provider, raw.model),
        efforts: raw.efforts?.length ? raw.efforts : undefined,
        contextWindow: raw.contextWindow >= 4096 ? raw.contextWindow : undefined }, provider, store.officialModels);
      seen.add(raw.model); return [model];
    } catch { return []; }
  });
  if (!provider.models.length) return null;
  return store.updateProvider({ ...provider, ...existing, models: provider.models, nativeCatalogInitialized: true });
}
module.exports = { nativeApiProfiles, promoteNativeApiProfile, promoteNativeSupplier, safeBaseUrl, trimEndpoint, sameApi };
