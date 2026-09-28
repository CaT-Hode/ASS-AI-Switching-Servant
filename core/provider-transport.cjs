const { endpoint } = require("./models.cjs");
function messagesTransport(provider, model) {
  const url = new URL(provider.baseUrl);
  if (model.wireApi !== "anthropic" && url.protocol === "https:" && url.hostname === "api.deepseek.com" &&
      !url.port && ["", "/v1", "/beta"].includes(url.pathname.replace(/\/$/, "")))
    return { protocol: "anthropic", url: "https://api.deepseek.com/anthropic/v1/messages", adapted: false };
  return { protocol: model.wireApi, url: endpoint(provider.baseUrl, model.wireApi), adapted: model.wireApi !== "anthropic" };
}
function providerSessionHeaders(provider, incoming = {}) {
  if (new URL(provider.baseUrl).hostname !== "opencode.ai") return {};
  const headers = { "user-agent": incoming["user-agent"] || "ASS/agent-router" };
  for (const key of ["session_id", "conversation_id", "x-session-id", "x-opencode-session", "x-claude-code-session-id"])
    if (typeof incoming[key] === "string" && incoming[key].length <= 512 && !/[\r\n]/.test(incoming[key])) headers[key] = incoming[key];
  headers["x-opencode-session"] ||= headers.session_id || headers["x-session-id"] || headers["x-claude-code-session-id"] || headers.conversation_id;
  if (!headers["x-opencode-session"]) delete headers["x-opencode-session"];
  return headers;
}
module.exports = { messagesTransport, providerSessionHeaders };
