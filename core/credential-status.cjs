// Read-only credential inventory. Never refresh tokens, execute key helpers, or
// return credential values to the renderer. Native clients own authentication.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const TOML = require("@iarna/toml");
const YAML = require("yaml");
const has = (v) => typeof v === "string" && !!v.trim();
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
const digest = (v) =>
  crypto.createHash("sha256").update(v).digest("hex").slice(0, 20);
function read(file, format = "json") {
  try {
    if (fs.statSync(file).size > 2 * 1024 * 1024)
      return { error: "凭据文件过大，未读取" };
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const data =
      format === "yaml"
        ? YAML.parse(text, { maxAliasCount: 50 })
        : format === "toml"
          ? TOML.parse(text)
          : JSON.parse(text);
    return object(data) ? { data } : { error: "凭据格式无法识别" };
  } catch (e) {
    return e.code === "ENOENT"
      ? { missing: true }
      : { error: "凭据文件无法读取或格式损坏" };
  }
}
function expiry(token, explicit) {
  let value = Number(explicit);
  if (!(value > 0)) {
    try {
      value = Number(
        JSON.parse(Buffer.from(token.split(".")[1], "base64url")).exp,
      );
    } catch {}
  }
  if (!(value > 0) || !Number.isFinite(value)) return null;
  value = value < 1e12 ? value * 1000 : value;
  return value < 8.64e15 ? value : null;
}
function oauth(provider, access, refresh, expires, now) {
  const expiresAt = expiry(access || "", expires),
    expired = expiresAt !== null && expiresAt <= now;
  const refreshable = has(refresh),
    present = has(access);
  const status = !present
    ? "incomplete"
    : expired
      ? refreshable
        ? "refresh-required"
        : "expired"
      : "detected";
  return {
    provider,
    authType: "oauth",
    ready: present && (!expired || refreshable),
    status,
    expiresAt,
    message: !present
      ? "OAuth 凭据不完整"
      : expired
        ? refreshable
          ? "访问令牌已到期 · 由客户端刷新"
          : "授权已到期 · 需要重新登录"
        : "已检测 OAuth · 未联网验证",
  };
}
function api(provider, value) {
  const dynamic = has(value) && /^[!$]/.test(value);
  return {
    provider,
    authType: "api",
    ready: has(value) && !dynamic,
    status: dynamic ? "external" : has(value) ? "detected" : "incomplete",
    message: dynamic
      ? "外部密钥引用 · 未执行解析"
      : has(value)
        ? "已检测 API Key · 未联网验证"
        : "原生凭据链 · 由客户端确认",
  };
}
function parseRecords(harness, data, now = Date.now()) {
  if (harness === "codex") {
    if (
      data.auth_mode === "apikey" ||
      (!data.tokens?.access_token && has(data.OPENAI_API_KEY))
    )
      return [api("openai", data.OPENAI_API_KEY)];
    if (object(data.tokens))
      return [
        oauth(
          "openai",
          data.tokens.access_token,
          data.tokens.refresh_token,
          null,
          now,
        ),
      ];
    return [];
  }
  if (harness === "claude") {
    const t = data.claudeAiOauth;
    const rows = object(t)
      ? [oauth("anthropic", t.accessToken, t.refreshToken, t.expiresAt, now)]
      : [];
    if (has(data.primaryApiKey))
      rows.push(api("anthropic-api", data.primaryApiKey));
    return rows;
  }
  if (harness === "dsh") {
    const rows = [];
    for (const [id, value] of Object.entries(
      data.refs || (data.version ? {} : data),
    ))
      if (/^[A-Z][A-Z0-9_]*_API_KEY$/.test(id) && has(value))
        rows.push(api(id, value));
    for (const [key, record] of Object.entries(data.records || {})) {
      if (!key.startsWith("llm-pi-ai/") || !object(record)) continue;
      const id = key.slice(10),
        t = record.payload;
      if (record.kind === "grant" && t?.type === "oauth")
        rows.push(oauth(id, t.access, t.refresh, t.expires, now));
      else if (record.kind === "api-key") rows.push(api(id, record.key));
    }
    return rows;
  }
  return Object.entries(data).flatMap(([id, t]) => {
    if (!object(t)) return [];
    if (t.type === "oauth")
      return [oauth(id, t.access, t.refresh, t.expires, now)];
    if (["api", "api_key"].includes(t.type)) return [api(id, t.key)];
    if (has(t.type))
      return [
        {
          provider: id,
          authType: "unknown",
          ready: false,
          status: "external",
          message: "其他原生凭据类型 · 由客户端确认",
        },
      ];
    return [];
  });
}
function credentialFile(harness, dir, native = false) {
  return path.join(
    dir,
    harness === "claude"
      ? ".credentials.json"
      : harness === "dsh"
        ? ".credentials.yaml"
        : harness === "opencode" && !native
          ? "data/opencode/auth.json"
          : "auth.json",
  );
}
function inspectCredentials(
  harness,
  dir,
  { native = false, now = Date.now() } = {},
) {
  const file = credentialFile(harness, dir, native);
  if (harness === "codex") {
    const config = read(path.join(dir, "config.toml"), "toml");
    if (
      ["keyring", "ephemeral"].includes(config.data?.cli_auth_credentials_store)
    )
      return {
        file,
        rows: [],
        status: "external",
        message: "使用系统密钥库或临时凭据 · 请在原生客户端确认",
      };
  }
  const result = read(file, harness === "dsh" ? "yaml" : "json");
  if (result.error)
    return { file, rows: [], status: "unreadable", message: result.error };
  const rows = parseRecords(harness, result.data || {}, now);
  return {
    file,
    rows,
    status: rows.length ? "detected" : "missing",
    message: rows.length ? "已读取本地凭据" : "未检测到本地凭据",
  };
}
function nativeLocations(harness, home, env, override, codexDir) {
  const defaults = {
    codex: path.join(home, ".codex"),
    claude: path.join(home, ".claude"),
    opencode: path.join(home, ".local/share/opencode"),
    pi: path.join(home, ".pi/agent"),
    dsh: path.join(home, ".dsh"),
  };
  const custom = {
    codex: codexDir || env.CODEX_HOME,
    claude: env.CLAUDE_CONFIG_DIR,
    opencode: env.XDG_DATA_HOME && path.join(env.XDG_DATA_HOME, "opencode"),
    pi: env.PI_CODING_AGENT_DIR,
    dsh: env.DSH_HOME,
  };
  const seen = new Set();
  return [override, custom[harness], defaults[harness]]
    .filter(Boolean)
    .map((dir) => path.resolve(dir.replace(/^~(?=[/\\]|$)/, home)))
    .filter((dir) => {
      const key = process.platform === "win32" ? dir.toLowerCase() : dir;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
function discoverNative(
  harness,
  { home, env = {}, override, codexDir, now = Date.now() },
) {
  const dirs = nativeLocations(harness, home, env, override, codexDir);
  const sources = dirs.map((dir) => {
    const result = inspectCredentials(harness, dir, { native: true, now });
    const rows = result.rows.length
      ? result.rows
      : ["unreadable", "external"].includes(result.status)
        ? [
            {
              provider: "native",
              authType: "unknown",
              ready: false,
              status: result.status,
              message: result.message,
            },
          ]
        : [];
    return {
      ...result,
      dir,
      accounts: rows.map((row) => ({
        ...row,
        id: "native:" + digest(harness + "\0" + dir + "\0" + row.provider),
        kind: "native",
        label:
          row.provider === "openai" && row.authType === "oauth"
            ? "ChatGPT"
            : row.provider,
        badge:
          row.authType === "oauth"
            ? "OAuth"
            : row.authType === "api"
              ? "API Key"
              : "待确认",
        source: "本机账户",
        sourcePath: result.file,
        nativeDir: dir,
        providers: [row.provider],
      })),
    };
  });
  if (harness === "claude" && has(env.CLAUDE_CODE_OAUTH_TOKEN)) {
    const row = oauth("anthropic", env.CLAUDE_CODE_OAUTH_TOKEN, "", null, now);
    const file = "环境变量 CLAUDE_CODE_OAUTH_TOKEN";
    sources.unshift({
      file,
      dir: dirs[0],
      status: "detected",
      message: "检测到环境变量授权",
      rows: [row],
      accounts: [
        {
          ...row,
          id: "native:claude-env",
          kind: "native",
          label: "anthropic",
          badge: "OAuth",
          source: "环境变量",
          sourcePath: file,
          nativeDir: dirs[0],
          providers: ["anthropic"],
        },
      ],
    });
  }
  return sources;
}
module.exports = {
  parseRecords,
  inspectCredentials,
  credentialFile,
  nativeLocations,
  discoverNative,
  digest,
};
