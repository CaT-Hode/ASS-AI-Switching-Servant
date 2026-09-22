// Private runtime plan. Never serialize this object to the renderer: it contains
// credentials, which are delivered only to the isolated native client process.
const { officialApiService, acceptsApiAccount } = require("./client-policy.cjs");
function officialAccountPlan(harness, provider) {
  if (!acceptsApiAccount(harness, provider) || !provider.apiKey)
    throw Error("此客户端不支持该官方 API 账户");
  const service = officialApiService(provider), key = provider.apiKey;
  const files = [], env = {}, args = [];
  let credentialCheck;
  if (harness === "codex") {
    files.push(["auth.json", JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: key })]);
    credentialCheck = { file: "auth.json", format: "json", path: ["OPENAI_API_KEY"], value: key };
    files.push(["config.toml", 'cli_auth_credentials_store = "file"\n']);
  } else if (harness === "claude") {
    env.ANTHROPIC_API_KEY = key;
  } else if (harness === "dsh") {
    files.push([".credentials.yaml", JSON.stringify({ version: 1, refs: { DEEPSEEK_API_KEY: key } })]);
    credentialCheck = { file: ".credentials.yaml", format: "yaml", path: ["refs", "DEEPSEEK_API_KEY"], value: key };
    args.push("--profile", "web");
  } else if (harness === "opencode") {
    files.push(["data/opencode/auth.json", JSON.stringify({ [service]: { type: "api", key } })]);
    credentialCheck = { file: "data/opencode/auth.json", format: "json", path: [service, "key"], value: key };
  }
  return { files, env, args, credentialCheck };
}
module.exports = { officialAccountPlan };
