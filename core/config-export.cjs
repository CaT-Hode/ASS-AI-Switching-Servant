const { normalizeProvider } = require("./models.cjs");

// Export the portable provider schema only, never account/session stores or caches.
function exportConfig(providers, options = {}) {
  const includeSecrets = options?.includeSecrets === true;
  if (includeSecrets && options.acknowledged !== true)
    throw new Error("包含密钥的配置为明文，请先确认泄露风险");
  return {
    schemaVersion: 1,
    providers: providers.filter((p) => !p.readOnly && p.id !== "official").map((raw) => {
      const p = normalizeProvider(raw);
      return { ...p, apiKey: includeSecrets ? p.apiKey : "",
        extraHeaders: includeSecrets ? { ...p.extraHeaders } : {} };
    }),
  };
}
module.exports = { exportConfig };
