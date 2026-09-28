const { createHash } = require("node:crypto");
const { nativeOfficialProvider } = require("./native-official.cjs");
const { nativeModels } = require("./model-inventory.cjs");
const { normalizeModel } = require("./models.cjs");
const { inferProtocol } = require("./presets.cjs");
const names = { deepseek: "DeepSeek", opencode: "OpenCode Zen", "opencode-go": "OpenCode Go" };

// A verified API credential becomes an ordinary encrypted supplier. OAuth grants
// remain account-specific. Editing this supplier never rewrites its source file.
function promoteNativeSupplier({ store, client, account, verified, models, home, env = {} }) {
  const native = nativeOfficialProvider(client, account);
  if (!native || !verified) return null;
  const existing = store.state.providers.find((p) => p.apiKey === native.apiKey &&
    p.baseUrl.replace(/\/$/, "") === native.baseUrl.replace(/\/$/, ""));
  if (existing?.models.length || existing?.nativeCatalogInitialized) return existing.id;
  const id = "native_api_" + createHash("sha256").update(native.nativeProvider + "\0" + native.apiKey).digest("hex").slice(0, 20);
  if (store.state.nativeSupplierExclusions?.includes(id)) return null;
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
module.exports = { promoteNativeSupplier };
