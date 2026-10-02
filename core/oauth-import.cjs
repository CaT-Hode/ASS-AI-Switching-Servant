const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { nativeLocations } = require("./credential-status.cjs");
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_RESOURCE = "https://api.openai.com/v1";
const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_SCOPES = new Set(['org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code', 'user:mcp_servers', 'user:file_upload']);
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const has = (v) => typeof v === "string" && !!v.trim();
const safeProvider = (v) => /^[a-z0-9-]{1,80}$/.test(v || "") ? v : undefined;
const ROTATION_WARNING = "复制会共享同一个 refresh grant；两端独立刷新或撤销可能使另一端失效。";
function readJson(file) {
  try {
    if (fs.statSync(file).size > 2 * 1024 * 1024) return {};
    const data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    return object(data) ? data : {};
  } catch {
    return {};
  }
}
function jwtPayload(token) {
  try {
    if (!has(token) || token.length > 65536 || token.split(".").length !== 3) return {};
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    return object(claims) ? claims : {};
  } catch {
    return {};
  }
}
function refuse(code, reason, provider, grantType = "unknown") {
  const error = new Error(reason);
  error.code = code;
  error.transfer = { provider: safeProvider(provider), grantType, reasonCode: code, reason };
  throw error;
}
function scopes(value) {
  return typeof value === "string" ? value.trim().split(/\s+/)
    : Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}
function checkCodexGrant(kind, data, token) {
  // Decoded claims are local format evidence, never signature/entitlement validation.
  const metadata = kind === "codex" ? data : {};
  const extra = object(token.metadata) ? token.metadata : {};
  const access = jwtPayload(token.access_token || token.access);
  const identity = jwtPayload(token.id_token || token.idToken);
  const clients = [metadata.client_id, metadata.clientId, extra.client_id, extra.clientId, token.client_id, token.clientId,
    access.client_id, access.clientId, ...scopes(identity.aud)].filter((v) => v !== undefined);
  const granted = [metadata.scope, metadata.scopes, extra.scope, extra.scopes, token.scope, token.scopes, access.scope, access.scopes].flatMap(scopes);
  const plan = clients.some((v) => v === "dynamic_agent_client" || (typeof v === "string" && v.startsWith("oaiapp_"))) ||
    granted.some((v) => ["chatgpt.tokens.use.direct", "resource.invoke"].includes(v)) ||
    has(metadata.ext_agent_host_id) || has(extra.ext_agent_host_id) || has(token.ext_agent_host_id) ||
    has(access["https://api.openai.com/auth"]?.encrypted_auth_metadata);
  if (plan) refuse("chatgpt_plan_login_required",
    "检测到 Sign in with ChatGPT 的客户端或 plan scopes 元数据，不能复制为 pi openai-codex；请在目标客户端重新登录 openai。",
    "openai", "chatgpt-plan");
  if (clients.some((v) => v !== CODEX_CLIENT_ID)) refuse("oauth_client_mismatch",
    "OAuth client 与 legacy Codex 不一致，不能共享刷新授权；请在目标客户端重新登录。", "openai-codex");
  const issuers = [metadata.issuer, extra.issuer, extra.iss, token.issuer, access.iss, identity.iss].filter((v) => v !== undefined);
  if (issuers.some((v) => v !== "https://auth.openai.com")) refuse("oauth_issuer_mismatch",
    "OAuth issuer 与已核对的 OpenAI 授权不一致，不能导入。", "openai-codex");
  const audience = access.aud === undefined ? [] : Array.isArray(access.aud) ? access.aud : [access.aud];
  // Legacy Codex access tokens may also have this audience. Audience alone does
  // not distinguish SIWC from Codex; client and granted scopes do.
  if ((audience.length && !audience.includes(OPENAI_RESOURCE)) ||
      [metadata.resource, extra.resource, token.resource].some((v) => v !== undefined && v !== OPENAI_RESOURCE))
    refuse("oauth_resource_mismatch", "OAuth resource 与已核对的 OpenAI 授权不一致，不能导入。", "openai-codex");
  const accountIds = [token.account_id, token.accountId, extra.accountID, extra.accountId, extra.account_id, access["https://api.openai.com/auth"]?.chatgpt_account_id,
    identity["https://api.openai.com/auth"]?.chatgpt_account_id, identity.chatgpt_account_id].filter(has);
  if (new Set(accountIds).size > 1) refuse("oauth_account_mismatch",
    "OAuth 工作区与令牌记录不一致，不能导入。", "openai-codex", "codex-legacy");
  if (kind !== "codex" && !clients.length && !has(access["https://api.openai.com/auth"]?.chatgpt_account_id))
    refuse("oauth_grant_unknown", "未确认这是 legacy Codex grant；仅凭 openai provider 名称不能导入。", "openai-codex");
  const jwtAccount = access["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (!has(jwtAccount)) refuse("oauth_access_account_missing",
    "目标 pi 从 access JWT 读取账户 ID；来源令牌缺少该字段，不能用存储账户 ID 替代，请在 pi 重新登录。", "openai-codex", "codex-legacy");
  return jwtAccount;
}
function checkAnthropicGrant(metadata, token) {
  const sources = [metadata, token, ...(object(token.metadata) ? [token.metadata] : [])];
  if (sources.some(s => [s.clientId, s.client_id].some(v => v !== undefined && v !== ANTHROPIC_CLIENT_ID)))
    refuse('oauth_client_mismatch', '来源 OAuth client 与 pi 的 Anthropic 刷新客户端不一致，请在 pi 重新登录。', 'anthropic');
  if (sources.some(s => s.provider !== undefined && s.provider !== 'anthropic'))
    refuse('oauth_provider_mismatch', '来源授权的 provider 与 Anthropic 不一致，不能导入。', 'anthropic');
  for (const source of sources) {
    for (const key of ['scope', 'scopes']) if (source[key] !== undefined) {
      const value = source[key], granted = scopes(value);
      if (!(typeof value === 'string' || Array.isArray(value) && value.every(v => typeof v === 'string')) ||
          !granted.includes('user:inference') || granted.some(s => !ANTHROPIC_SCOPES.has(s)))
        refuse('oauth_scope_mismatch', '显式授权 scopes 不满足已核对的 pi Anthropic 范围，请在 pi 重新登录。', 'anthropic');
    }
    // The consumer does not enforce these fields; their meaning has not been
    // established by the native contract. Do not silently discard constraints.
    if (Object.keys(source).some(k => /^(issuer|iss|aud|audience|resource|extensions?|ext_.+)$/.test(k)))
      refuse('oauth_metadata_unverified', '来源带有尚未核对的 issuer、resource 或授权扩展约束，请在 pi 重新登录。', 'anthropic');
  }
}
function normalizeOAuth(kind, data, provider, targetProvider) {
  if (!object(data)) refuse("oauth_record_invalid", "OAuth 记录格式无法识别。", provider);
  let record,
    id = provider;
  if (kind === "codex") {
    if (data.auth_mode && data.auth_mode !== "chatgpt")
      refuse("oauth_auth_mode_mismatch", "来源不是可转移的 Codex ChatGPT 登录授权。", "openai-codex");
    const t = data.tokens || {},
      claims = jwtPayload(t.access_token || "");
    const accountId = checkCodexGrant(kind, data, t);
    id = "openai-codex";
    record = {
      type: "oauth",
      access: t.access_token,
      refresh: t.refresh_token,
      expires: Number(claims.exp) * 1000,
      accountId,
    };
    if (!record.accountId) throw new Error("Codex 授权缺少账户 ID，不能导入");
  } else if (kind === "claude") {
    const t = data.claudeAiOauth || {};
    id = "anthropic";
    checkAnthropicGrant(data, t);
    record = {
      ...t,
      type: "oauth",
      access: t.accessToken,
      refresh: t.refreshToken,
      expires: Number(t.expiresAt),
    };
  } else if (kind === "opencode") {
    const t = data[provider] || {};
    if (t.type !== "oauth") throw new Error("来源不是 OAuth 授权");
    id = provider === "openai" ? "openai-codex" : provider;
    const accountId = id === "openai-codex" ? checkCodexGrant(kind, data, t) : undefined;
    if (id === 'anthropic') checkAnthropicGrant({}, t);
    record = {
      ...t,
      type: "oauth",
      access: t.access,
      refresh: t.refresh,
      expires: Number(t.expires),
      ...(accountId || t.accountId ? { accountId: accountId || t.accountId } : {}),
    };
  } else throw new Error("未支持的授权来源");
  if (
    !safeProvider(id) ||
    !has(record.access) ||
    !has(record.refresh) ||
    !Number.isFinite(record.expires) ||
    record.expires < 1e12 || record.expires > 8.64e15
  )
    throw new Error("授权缺少 access / refresh / expires，不能按 OAuth 导入");
  if (id === "openai-codex" && !record.accountId)
    throw new Error("授权缺少账户 ID");
  if (targetProvider !== undefined && targetProvider !== id)
    refuse("provider_grant_mismatch", id === "openai-codex"
      ? "目标 provider 与来源 grant 类型不兼容；旧 Codex 授权只能导入 openai-codex。"
      : "目标 provider 与来源 OAuth grant 不匹配，不能改写为其他 provider。",
      id, id === "openai-codex" ? "codex-legacy" : "provider-oauth");
  return { provider: id, record };
}
function oauthTransferCompatibility(kind, data, provider, { supported, targetProvider } = {}) {
  try {
    const result = normalizeOAuth(kind, data, provider, targetProvider);
    const compatible = !supported || supported.some((p) => p.id === result.provider);
    return {
      provider: result.provider,
      grantType: result.provider === "openai-codex" ? "codex-legacy" : "provider-oauth",
      compatible,
      reasonCode: compatible ? "compatible_format" : "provider_not_supported",
      reason: compatible ? "凭据格式与目标 provider 匹配；尚未验证刷新、推理或订阅权益。缺少授权元数据的旧记录也只代表格式兼容。"
        : "本机 pi 未确认支持来源 grant 对应的 provider；不能改写为其他 provider。",
      requiresLogin: false,
      expired: result.record.expires <= Date.now(),
      ...(result.record.expires <= Date.now() ? { refreshGuidance: '令牌已过期；需由原生 pi 刷新或重新登录，ASS 未尝试刷新。' } : {}),
      verification: "format-only",
      refreshRotationRisk: compatible,
      ...(compatible ? { warning: ROTATION_WARNING } : {}),
    };
  } catch (error) {
    return {
      ...(error.transfer || { provider: safeProvider(provider || (kind === "codex" ? "openai-codex" : kind === "claude" ? "anthropic" : "")),
        grantType: "unknown", reasonCode: "oauth_record_invalid", reason: "OAuth 凭据缺少可转移字段或格式无法识别。" }),
      compatible: false,
      requiresLogin: true,
      verification: "format-only",
      refreshRotationRisk: false,
    };
  }
}
async function packageExport(base, manifest, subpath) {
  const exported = manifest.exports?.[subpath] ||
    (subpath.startsWith("./providers/") ? manifest.exports?.["./providers/*"] : undefined);
  let entry = typeof exported === "string" ? exported : exported?.import;
  if (typeof entry !== "string") return;
  if (subpath.startsWith("./providers/")) entry = entry.replace("*", subpath.slice("./providers/".length));
  const file = path.resolve(base, entry);
  if (!file.startsWith(base + path.sep)) return;
  return import(pathToFileURL(file).href);
}
async function piOAuthProviders(executable) {
  if (!executable) return [];
  const requireFrom = createRequire(path.resolve(executable));
  for (const pkg of ["@earendil-works/pi-ai", "@mariozechner/pi-ai"]) {
    for (const dir of requireFrom.resolve.paths(pkg) || [])
      try {
        const base = path.join(dir, pkg),
          manifest = readJson(path.join(base, "package.json"));
        const mod = await packageExport(base, manifest, "./oauth");
        if (typeof mod?.getOAuthProviders === "function")
          return mod.getOAuthProviders().map((p) => ({ id: p.id, name: p.name }));
        // pi 0.99: ./oauth is type-only. Read lazy OAuth declarations, without
        // calling login, refresh, toAuth, getAuth, or refreshing model catalogs.
        const providers = await packageExport(base, manifest, "./providers/all");
        if (typeof providers?.builtinProviders !== "function") continue;
        return providers.builtinProviders().filter((p) => p.auth?.oauth && safeProvider(p.id))
          .map((p) => ({ id: p.id, name: p.name }));
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
    if (c.kind === 'opencode') {
      let rows, major;
      try { major = require('./opencode-version.cjs').version(null, path.dirname(c.file)); rows = major === 2 ? require('./opencode-version.cjs').credentials(path.dirname(c.file)) : null; }
      catch { sources.push({ ...c, compatible: false, requiresLogin: false, reasonCode: 'oauth_storage_unreadable',
        reason: 'OpenCode 授权数据库无法读取或版本不受支持；未回退到旧 auth.json。', verification: 'format-only' }); continue; }
      if (major === 2) {
        for (const row of (rows || []).filter(r => r.value?.type === 'oauth')) {
          const provider = safeProvider(row.integrationID); if (!provider) continue;
          const selector = require('node:crypto').createHash('sha256').update(String(row.id)).digest('hex').slice(0, 24);
          const label = require('./account-info.cjs').text(row.label, [row.value.access, row.value.refresh]) || selector.slice(0, 6);
          sources.push({ ...c, file: path.join(path.dirname(c.file), 'opencode.db'), credentialId: row.id,
            id: c.id + ':credential:' + selector, label: c.label + ' · v2 · ' + provider + ' · ' + label + (row.active ? ' · 当前' : ''),
            sourceProvider: provider, ...oauthTransferCompatibility(c.kind, { [provider]: row.value }, provider, { supported }) });
        }
        continue;
      }
    }
    const data = readJson(c.file);
    const ids =
      c.kind === "opencode"
        ? Object.entries(data)
            .filter(([, v]) => v?.type === "oauth")
            .map(([id]) => id)
        : [undefined];
    if (c.kind === "codex" && !object(data.tokens)) continue;
    if (c.kind === "claude" && !object(data.claudeAiOauth)) continue;
    for (const id of ids) {
      const compatibility = oauthTransferCompatibility(c.kind, data, id, { supported });
      sources.push({ ...c, id: c.id + (id ? ":" + id : ""), sourceProvider: id, ...compatibility });
    }
  }
  return sources;
}
module.exports = {
  normalizeOAuth,
  piOAuthProviders,
  enumerateSources,
  oauthTransferCompatibility,
  readJson,
  sourceData(source) {
    if (source.credentialId !== undefined) {
      const row = require('./opencode-version.cjs').credentials(path.dirname(source.file))?.find(r =>
        r.id === source.credentialId && r.integrationID === source.sourceProvider);
      if (!row || row.value?.type !== 'oauth') throw Error('OpenCode 原生授权已变化，请刷新后重新选择');
      return { [source.sourceProvider]: row.value };
    }
    return readJson(source.file);
  },
};
