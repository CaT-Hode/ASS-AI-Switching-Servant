// Main-process identity only: never expose the fingerprint input or API keys.
const { createHash } = require("node:crypto");
function safeBaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash ||
        !(url.protocol === "https:" || url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) return "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch { return ""; }
}
function canonicalEndpoint(value) {
  const base = safeBaseUrl(value);
  if (!base) return "";
  const url = new URL(base);
  // Only known service aliases. Never collapse /v1 on an arbitrary gateway.
  if (url.origin === "https://api.deepseek.com" && ["/", "/v1"].includes(url.pathname))
    return url.origin;
  return base;
}
function supplierHeaders(raw, apiKey) {
  const result = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const name = key.toLowerCase();
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) return null;
    if (name === "authorization" || name === "x-api-key") {
      if (value === apiKey || value === "Bearer " + apiKey) continue;
      return null;
    }
    if (name === "user-agent" && ["ASS/native-model-check", "ASS native-model-check"].includes(value)) continue;
    if (Object.hasOwn(result, name) && result[name] !== value) return null;
    result[name] = value;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
function apiIdentity(provider) {
  const base = canonicalEndpoint(provider?.baseUrl), key = provider?.apiKey;
  if (!base || typeof key !== "string" || !key.trim()) return "";
  const headers = supplierHeaders(provider.extraHeaders, key);
  if (!headers) return "";
  return createHash("sha256").update(JSON.stringify([base, key, headers])).digest("hex");
}
function sameApi(a, b) {
  const id = apiIdentity(a);
  return !!id && id === apiIdentity(b);
}
module.exports = { safeBaseUrl, canonicalEndpoint, supplierHeaders, apiIdentity, sameApi };
