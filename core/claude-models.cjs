// CC gateway discovery accepts only IDs containing "claude" or "anthropic".
// These are local aliases, not upstream model renames or capability claims.
const PREFIX = "claude-ass/";
const qualified = (provider, model) => provider.id + "::" + model.model;
function claudeModels(providers) {
  return providers.filter(p => p.enabled && p.apiKey).flatMap(p => p.models
    .filter(m => m.enabled && ["anthropic", "openai-responses", "openai-chat"].includes(m.wireApi))
    .map(m => {
      const model = qualified(p, m);
      return { model, discoveryId: /claude|anthropic/i.test(model) ? model : PREFIX + model,
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
