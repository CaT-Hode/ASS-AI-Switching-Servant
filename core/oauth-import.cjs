const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { nativeLocations } = require("./credential-status.cjs");
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
function jwtPayload(token) {
  try {
    return JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
  } catch {
    return {};
  }
}
function normalizeOAuth(kind, data, provider) {
  let record,
    id = provider;
  if (kind === "codex") {
    const t = data.tokens || {},
      claims = jwtPayload(t.access_token || "");
    id = "openai-codex";
    record = {
      type: "oauth",
      access: t.access_token,
      refresh: t.refresh_token,
      expires: Number(claims.exp) * 1000,
      accountId:
        t.account_id ||
        claims["https://api.openai.com/auth"]?.chatgpt_account_id,
    };
    if (!record.accountId) throw new Error("Codex 授权缺少账户 ID，不能导入");
  } else if (kind === "claude") {
    const t = data.claudeAiOauth || {};
    id = "anthropic";
    record = {
      type: "oauth",
      access: t.accessToken,
      refresh: t.refreshToken,
      expires: Number(t.expiresAt),
    };
  } else if (kind === "opencode") {
    const t = data[provider] || {};
    if (t.type !== "oauth") throw new Error("来源不是 OAuth 授权");
    id = provider === "openai" ? "openai-codex" : provider;
    record = {
      type: "oauth",
      access: t.access,
      refresh: t.refresh,
      expires: Number(t.expires),
      ...(t.accountId ? { accountId: t.accountId } : {}),
    };
    if (id === "openai-codex" && !record.accountId)
      record.accountId = jwtPayload(t.access || "")[
        "https://api.openai.com/auth"
      ]?.chatgpt_account_id;
  } else throw new Error("未支持的授权来源");
  if (
    !/^[a-z0-9-]+$/.test(id || "") ||
    typeof record.access !== "string" ||
    !record.access ||
    typeof record.refresh !== "string" ||
    !record.refresh ||
    !Number.isFinite(record.expires) ||
    record.expires < 1e12
  )
    throw new Error("授权缺少 access / refresh / expires，不能按 OAuth 导入");
  if (id === "openai-codex" && !record.accountId)
    throw new Error("授权缺少账户 ID");
  return { provider: id, record };
}
async function piOAuthProviders(executable) {
  if (!executable) return [];
  const requireFrom = createRequire(path.resolve(executable));
  for (const pkg of ["@earendil-works/pi-ai", "@mariozechner/pi-ai"]) {
    for (const dir of requireFrom.resolve.paths(pkg) || [])
      try {
        const base = path.join(dir, pkg),
          manifest = readJson(path.join(base, "package.json"));
        const exported = manifest.exports?.["./oauth"];
        const entry =
          typeof exported === "string" ? exported : exported?.import;
        if (!entry) continue;
        const file = path.resolve(base, entry);
        if (!file.startsWith(base + path.sep)) continue;
        const mod = await import(pathToFileURL(file).href);
        return mod.getOAuthProviders().map((p) => ({ id: p.id, name: p.name }));
      } catch {}
  }
  return [];
}
function enumerateSources(
  codexDir,
  home,
  profiles,
  root,
  supported,
  env = {},
  overrides = {},
) {
  const candidates = ["codex", "claude", "opencode"].flatMap((kind) =>
    nativeLocations(kind, home, env, overrides[kind], codexDir).map(
      (dir, i) => ({
        id: "local-" + kind + (i ? "-" + i : ""),
        kind,
        label:
          "本机 " +
          { codex: "Codex", claude: "Claude Code", opencode: "OpenCode" }[kind],
        file: path.join(
          dir,
          kind === "claude" ? ".credentials.json" : "auth.json",
        ),
      }),
    ),
  );
  for (const p of profiles.filter((p) =>
    ["codex", "claude", "opencode"].includes(p.harness),
  ))
    candidates.push({
      id: "profile-" + p.id,
      kind: p.harness,
      label: p.label + " · " + p.harness,
      file: path.join(
        root(p.harness, p.id),
        p.harness === "claude"
          ? ".credentials.json"
          : p.harness === "opencode"
            ? "data/opencode/auth.json"
            : "auth.json",
      ),
    });
  const sources = [];
  for (const c of candidates) {
    const data = readJson(c.file);
    const ids =
      c.kind === "opencode"
        ? Object.entries(data)
            .filter(([, v]) => v?.type === "oauth")
            .map(([id]) => id)
        : [undefined];
    for (const id of ids)
      try {
        const { provider, record } = normalizeOAuth(c.kind, data, id);
        sources.push({
          ...c,
          id: c.id + (id ? ":" + id : ""),
          sourceProvider: id,
          provider,
          compatible: supported.some((p) => p.id === provider),
          expired: record.expires < Date.now(),
        });
      } catch {}
  }
  return sources;
}
module.exports = {
  normalizeOAuth,
  piOAuthProviders,
  enumerateSources,
  readJson,
};
