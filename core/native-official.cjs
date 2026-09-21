// Read a selected native API credential without executing helpers or refreshing
// OAuth. Secrets stay in the main process; destinations are pinned to official origins.
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const endpoints = {
  deepseek: "https://api.deepseek.com",
  opencode: "https://opencode.ai/zen/v1",
  "opencode-go": "https://opencode.ai/zen/go/v1",
};
function nativeOfficialProvider(client, account) {
  if (
    !account ||
    account.kind === "api" ||
    account.authType !== "api" ||
    !account.ready
  )
    return null;
  const rawId = account.provider || account.oauthProvider;
  const id = rawId === "DEEPSEEK_API_KEY" ? "deepseek" : rawId;
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
    if (typeof key !== "string" || !key.trim() || /^[!$]/.test(key))
      return null;
    return {
      id: "native-info:" + client.id + ":" + account.id,
      nativeProvider: id,
      baseUrl: endpoints[id],
      apiKey: key,
      network: "system",
      wireApi: "openai-chat",
      models: [],
    };
  } catch {
    return null;
  }
}
module.exports = { nativeOfficialProvider };
