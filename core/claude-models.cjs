const crypto = require("node:crypto");
// Claude Desktop checks the entire gateway route, including provider and model
// segments, for non-Anthropic vendor names. Keep the picker ID opaque; the
// visible label and the upstream model remain the actual provider/model.
const PREFIX = "claude-ass-";
const qualified = (provider, model) => provider.id + "::" + model.model;
const alias = model => PREFIX + crypto.createHash("sha256").update(model).digest("hex").slice(0, 32);
function claudeModels(providers) {
  return providers.filter(p => p.enabled && p.apiKey).flatMap(p => p.models
    .filter(m => m.enabled && ["anthropic", "openai-responses", "openai-chat"].includes(m.wireApi))
    .map(m => {
      const model = qualified(p, m);
      return { model, discoveryId: alias(model),
        label: p.name + " · " + (m.displayName || m.model), description: m.model };
    }));
}
function resolveClaudeModel(providers, value) {
  if (typeof value !== "string") return value;
  const rows = claudeModels(providers);
  // An exact real ID wins; never strip arbitrary text and silently pick a model.
  if (rows.some(m => m.model === value)) return value;
  const entry = rows.find(m => m.discoveryId === value);
  if (entry) return entry.model;
  if (/\[1m\]$/i.test(value)) {
    const base = value.slice(0, -4), row = rows.find(m => m.model === base || m.discoveryId === base);
    if (row) return row.model;
  }
  return value;
}
module.exports = { claudeModels, resolveClaudeModel };
