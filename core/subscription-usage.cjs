const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

function tokenAccountId(access) {
  try {
    const parts = access.split(".");
    if (parts.length !== 3) return undefined;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))[
      "https://api.openai.com/auth"
    ]?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}

function nativeSubscriptionProvider(client, account) {
  if (
    !account ||
    account.kind === "api" ||
    account.authType !== "oauth" ||
    !account.ready
  )
    return null;
  const provider = account.provider || account.oauthProvider;
  const kind = ["openai", "openai-codex"].includes(provider)
    ? "openai"
    : provider === "anthropic"
      ? "anthropic"
      : null;
  if (!kind || !account.sourcePath || !path.isAbsolute(account.sourcePath))
    return null;
  try {
    if (fs.statSync(account.sourcePath).size > 2 * 1024 * 1024) return null;
    const text = fs
      .readFileSync(account.sourcePath, "utf8")
      .replace(/^\uFEFF/, "");
    const data =
      client.id === "dsh"
        ? YAML.parse(text, { maxAliasCount: 20 })
        : JSON.parse(text);
    const token =
      client.id === "codex"
        ? data.tokens
        : client.id === "claude"
          ? data.claudeAiOauth
          : client.id === "dsh"
            ? data.records?.["llm-pi-ai/" + provider]?.payload
            : data[provider];
    const access = token?.access_token || token?.accessToken || token?.access;
    if (typeof access !== "string" || !access || access.length > 65536)
      return null;
    const accountId =
      token.account_id ||
      token.accountId ||
      (kind === "openai" ? tokenAccountId(access) : undefined);
    return {
      id: "native-info:" + client.id + ":" + account.id,
      nativeProvider: kind,
      subscriptionKind: kind,
      baseUrl:
        kind === "openai"
          ? "https://chatgpt.com/backend-api"
          : "https://api.anthropic.com",
      apiKey: access,
      network: "system",
      models: [],
      extraHeaders:
        kind === "openai"
          ? {
              "user-agent": "codex-cli",
              ...(typeof accountId === "string" &&
              accountId.length <= 250 &&
              accountId &&
              !/[\x00-\x1f]/.test(accountId)
                ? { "chatgpt-account-id": accountId }
                : {}),
            }
          : { "anthropic-beta": "oauth-2025-04-20" },
    };
  } catch {
    return null;
  }
}
function resetTime(value) {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const ms = typeof value === "number" ? value * 1000 : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 && ms < 8.64e15
    ? new Date(ms).toISOString()
    : undefined;
}
function quota(id, label, used, resets) {
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0)
    return null;
  return {
    id: "quota-" + id,
    label,
    kind: "quota",
    value: String(used),
    usedPercent: used,
    remainingPercent: Math.max(0, Math.min(100, 100 - used)),
    resetsAt: resetTime(resets),
  };
}
function parseSubscription(kind, data) {
  if (kind === "anthropic") {
    const limits = data?.rate_limits || data;
    return [
      ["five_hour", "5h"],
      ["seven_day", "周"],
    ]
      .map(([key, label]) => {
        const w = limits?.[key];
        return quota(
          key,
          label,
          w?.utilization ?? w?.used_percentage,
          w?.resets_at,
        );
      })
      .filter(Boolean);
  }
  const limits =
    data?.rateLimitsByLimitId?.codex || data?.rateLimits || data?.rate_limit;
  return [
    limits?.primary_window || limits?.primary,
    limits?.secondary_window || limits?.secondary,
  ]
    .map((w, i) => {
      if (!w) return null;
      const mins =
        w.windowDurationMins ??
        (typeof w.limit_window_seconds === "number"
          ? w.limit_window_seconds / 60
          : null);
      const label =
        mins === 300
          ? "5h"
          : mins === 10080
            ? "周"
            : Number.isFinite(mins) && mins > 0
              ? mins % 60 === 0
                ? `${mins / 60}h`
                : `${mins} 分钟`
              : `窗口 ${i + 1}`;
      return quota(
        String(i),
        label,
        w.used_percent ?? w.usedPercent,
        w.reset_at ?? w.resetsAt,
      );
    })
    .filter(Boolean);
}
module.exports = { nativeSubscriptionProvider, parseSubscription };
