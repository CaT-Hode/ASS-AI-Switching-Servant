const fs = require("node:fs");
const path = require("node:path");
function read(file) {
  if (!fs.existsSync(file)) return {};
  try {
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw Error();
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    return value;
  } catch { throw Error("无法核对 Claude 登录覆盖项：" + path.basename(file)); }
}
function assertClaudeAccount(plan, workspace) {
  if (plan.harness !== "claude" || plan.accountKind === "model") return;
  const files = [path.join(plan.dir, "settings.json"), path.join(plan.dir, "settings.local.json"),
    ...["settings.json", "settings.local.json"].map((f) => path.join(workspace, ".claude", f))];
  for (const file of files) {
    const config = read(file);
    if (config.apiKeyHelper || Object.entries(config.env || {}).some(([key, value]) => value &&
        /^(ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)|CLAUDE_CODE_(OAUTH_TOKEN|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY))$/i.test(key)))
      throw Error("Claude 配置含其他登录或端点覆盖项：" + file + "；未启动，避免使用错误账户或计费方式");
  }
  if (plan.authType === "oauth" && read(path.join(plan.dir, ".credentials.json")).primaryApiKey)
    throw Error("Claude 目录同时存在 OAuth 与 API Key；请先在原生客户端确认登录方式，未替换凭据");
}
module.exports = { assertClaudeAccount };
