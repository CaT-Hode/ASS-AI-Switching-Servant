// Provider/model compatibility defaults.
// Explicit imported model settings always take precedence. See SOURCES.md.
const PROVIDER_PRESETS = [
  [
    "deepseek",
    "DeepSeek 官方",
    "https://api.deepseek.com",
    "openai-chat",
    "deepseek",
  ],
  [
    "zhipu-cn",
    "智谱 GLM 中国版",
    "https://open.bigmodel.cn/api/coding/paas/v4",
    "openai-chat",
    "zhipu",
  ],
  [
    "zhipu-intl",
    "智谱 GLM 国际版",
    "https://api.z.ai/api/coding/paas/v4",
    "openai-chat",
    "zhipu",
  ],
  [
    "kimi",
    "Moonshot Kimi",
    "https://api.moonshot.cn/v1",
    "openai-chat",
    "kimi",
  ],
  [
    "kimi-plan",
    "Kimi For Coding",
    "https://api.kimi.com/coding/v1",
    "openai-chat",
    "kimi",
  ],
  [
    "minimax-cn",
    "MiniMax 中国版",
    "https://api.minimaxi.com/v1",
    "openai-responses",
    "minimax",
  ],
  [
    "minimax-intl",
    "MiniMax 国际版",
    "https://api.minimax.io/v1",
    "openai-responses",
    "minimax",
  ],
  [
    "mimo",
    "小米 MiMo",
    "https://api.xiaomimimo.com/v1",
    "openai-responses",
    "xiaomi",
  ],
  [
    "mimo-plan",
    "小米 MiMo Plan",
    "https://token-plan-cn.xiaomimimo.com/v1",
    "openai-responses",
    "xiaomi",
  ],
  [
    "openrouter",
    "OpenRouter",
    "https://openrouter.ai/api/v1",
    "openai-chat",
    "openrouter",
  ],
  [
    "opencode-go",
    "OpenCode Go",
    "https://opencode.ai/zen/go/v1",
    "openai-chat",
    "opencode-go",
  ],
].map(([id, name, baseUrl, wireApi, brand]) => ({
  id,
  name,
  baseUrl,
  wireApi,
  brand,
  network: "system",
}));
function tail(model) {
  return model.trim().toLowerCase().split("/").at(-1);
}
function inferProtocol(provider, model) {
  const m = tail(model);
  let host = "";
  try {
    host = new URL(provider.baseUrl).hostname;
  } catch {}
  if (host === "api.deepseek.com" && m === "deepseek-v4-flash")
    return "openai-responses";
  if (m.startsWith("gpt")) return "openai-responses";
  if (m.startsWith("claude") || host === "api.anthropic.com")
    return "anthropic";
  if (
    [
      "api.minimaxi.com",
      "api.minimax.io",
      "api.xiaomimimo.com",
      "token-plan-cn.xiaomimimo.com",
    ].includes(host)
  )
    return "openai-responses";
  return provider.wireApi || "openai-chat";
}
function contextDefault(provider, model, wireApi) {
  const m = tail(model),
    brand = provider.brand;
  if (
    [
      "claude-opus-4-6",
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-opus-5",
      "claude-fable-5",
    ].some((x) => m === x || m.startsWith(x + "-"))
  )
    return 1000000;
  if (m === "gpt-5.6" || m.startsWith("gpt-5.6-")) return 372000;
  if (m === "deepseek-v4-flash") return 1048576;
  if (brand === "deepseek" || m.startsWith("deepseek")) return 1000000;
  if (brand === "zhipu" || m.startsWith("glm")) return 200000;
  if (brand === "kimi" || m.startsWith("kimi") || m.startsWith("moonshot"))
    return 262144;
  if (wireApi === "anthropic") return 200000;
  if (wireApi === "openai-responses" && m.startsWith("mimo")) return 1048576;
  if (wireApi === "openai-responses" && m === "minimax-m3") return 1000000;
  return 272000;
}
module.exports = { PROVIDER_PRESETS, tail, inferProtocol, contextDefault };
