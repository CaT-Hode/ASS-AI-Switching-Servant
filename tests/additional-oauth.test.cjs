const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const TOML = require("@iarna/toml");
const { OAuthHistory } = require("../core/oauth-history.cjs");
const { HarnessManager } = require("../core/harnesses.cjs");
const { encryptZCode, decryptZCode, kimiSources, lock } = require("../core/additional-oauth.cjs");
const { parseStoredToken, historyFile } = require("../core/antigravity-status.cjs");
const jwt = (v) => "header." + Buffer.from(JSON.stringify(v)).toString("base64url") + ".signature";
const future = 2100000000;
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ass-extra-oauth-"));
  t.after(() => { assert.equal(path.dirname(home), os.tmpdir()); fs.rmSync(home, { recursive: true, force: true }); });
  const env = { ZCODE_CREDENTIAL_SECRET: "synthetic-local-cipher" }, cipherKey = crypto.randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", cipherKey, iv);
      const b = Buffer.concat([c.update(s), c.final()]); return Buffer.concat([iv, c.getAuthTag(), b]); },
    decryptString: (b) => { const c = crypto.createDecipheriv("aes-256-gcm", cipherKey, b.subarray(0, 12)); c.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(); },
  };
  const manager = new HarnessManager(home, () => ({ providers: [] }), [], path.join(home, ".codex"),
    { home, env, launchEnv: { PATH: "", USERPROFILE: home } });
  let time = Date.now();
  const options = { dataDir: home, crypto: encryption, now: () => time,
    sources: () => manager.oauthHistorySources(), target: (h, p) => manager.oauthHistoryTarget(h, p),
    allows: (h, p) => manager.oauthHistoryAllows(h, p) };
  const history = new OAuthHistory(options);
  const put = (relative, v) => { const file = path.join(home, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof v === "string" ? v : JSON.stringify(v)); return file; };
  return { home, env, manager, history, options, put, encryption, tick: () => { time += 2000; },
    scan: () => history.scan({ immediate: true }),
    client: (id) => { const c = manager.snapshot().clients.find((c) => c.id === id); history.decorate(c); return c; } };
}
const kimiConfig = (slot = "oauth/kimi-code", base = "https://api.kimi.com/coding/v1", host) => TOML.stringify({
  default_model: "native", providers: { official: { type: "kimi", base_url: base, oauth: { key: slot, ...(host ? { oauthHost: host } : {}) } } },
  models: { native: { provider: "official", model: "kimi-for-coding" } }, custom: { keep: true } });
const kimiGrant = (name, refresh = name) => ({ access_token: "synthetic-access-" + name, refresh_token: "synthetic-refresh-" + refresh,
  expires_at: future, expires_in: 3600, token_type: "Bearer", scope: "code", preference: "keep" });
const kfile = ".kimi-code/credentials/kimi-code.json", zfile = ".zcode/v2/credentials.json";
const antigravityGrant = (name, extra = {}) => ({
  token: { access_token: "synthetic-antigravity-access-" + name,
    refresh_token: "synthetic-antigravity-refresh-" + name,
    expiry: "2036-01-01T00:00:00.000Z", token_type: "Bearer" },
  id_token: jwt({ iss: "https://accounts.google.com", sub: name, email: name + "@example.test", name }),
  project_id: "project-" + name, region: "us-central1", tier_display_name: "Example Plan", ...extra,
});
function zgrant(f, name, provider = "zai", extra = {}) {
  const user = provider === "zai" ? { user_id: name, email: name + "@example.test", name }
    : { id: name, username: name, displayName: name };
  const values = { "oauth:active_provider": provider, zcodejwttoken: jwt({ sub: name, exp: future }),
    [`oauth:${provider}:access_token`]: jwt({ sub: name, exp: future }),
    [`oauth:${provider}:refresh_token`]: "synthetic-refresh-" + name,
    [`oauth:${provider}:user_info`]: JSON.stringify(user), "oauth:login_attribution": JSON.stringify({ channel_id: name }), ...extra };
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, encryptZCode(v, f.env)]));
}
const decode = (f) => Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(f.home, zfile)))).map(([k, v]) => [k, decryptZCode(v, f.env)]));

test("Kimi: stable file changes save encrypted accounts, switch only referenced token fields and survive restart", (t) => {
  const f = fixture(t), config = f.put(".kimi-code/config.toml", kimiConfig());
  f.put(kfile, kimiGrant("alice")); f.scan(); const id = f.history.entries[0].id;
  f.put(kfile, kimiGrant("alice-refreshed", "alice")); f.scan(); assert.equal(f.history.entries.length, 1);
  f.put(kfile, kimiGrant("bob")); f.history.scan(); assert.equal(f.history.entries.length, 1);
  f.tick(); f.history.scan(); assert.equal(f.history.entries.length, 2);
  let client = f.client("kimi"); assert.equal(client.accounts.length, 2); assert.equal(client.accounts.filter((a) => a.oauthCurrent).length, 1);
  const preview = f.history.preview("kimi", id); f.history.apply(preview.ticket, true);
  const stored = JSON.parse(fs.readFileSync(path.join(f.home, kfile)));
  assert.deepEqual(stored, kimiGrant("alice-refreshed", "alice"));
  assert.equal(fs.readFileSync(config, "utf8"), kimiConfig());
  client = f.client("kimi"); assert.equal(client.accounts.find((a) => a.oauthCurrent).oauthRecordId, id);
  assert.doesNotMatch(JSON.stringify(client), /synthetic-(access|refresh)/);
  assert.doesNotMatch(fs.readFileSync(f.history.file, "utf8"), /synthetic-|Bearer|code/);
  const loaded = new OAuthHistory(f.options); assert.equal(loaded.entries.length, 2); assert.equal(loaded.error, "");
});
test("Kimi: region, slot, override and changed config cannot silently retarget a saved account", (t) => {
  const f = fixture(t); f.put(".kimi-code/config.toml", kimiConfig()); f.put(kfile, kimiGrant("alice")); f.scan();
  const id = f.history.entries[0].id, original = fs.readFileSync(path.join(f.home, kfile), "utf8");
  f.env.KIMI_API_KEY = "synthetic-override"; assert.throws(() => f.history.preview("kimi", id), /环境变量/); delete f.env.KIMI_API_KEY;
  const p = f.history.preview("kimi", id);
  f.put(".kimi-code/config.toml", kimiConfig("oauth/global", "https://api.kimi.ai/coding/v1", "https://auth.kimi.ai"));
  f.put(".kimi-code/credentials/global.json", kimiGrant("global")); f.scan();
  assert.equal(f.history.entries.length, 2); assert.throws(() => f.history.apply(p.ticket, true), /对应区域/);
  assert.equal(fs.readFileSync(path.join(f.home, kfile), "utf8"), original);
  f.put(".kimi-code/config.toml", kimiConfig("oauth/kimi-code", "https://api.kimi.ai/coding/v1"));
  assert.deepEqual(kimiSources({ dir: path.join(f.home, ".kimi-code") }), []);
});
test("Kimi: legacy/current ambiguity requires explicit selection; unsafe and keyring slots never enter history", (t) => {
  const f = fixture(t);
  for (const dir of [".kimi", ".kimi-code"]) { f.put(dir + "/config.toml", kimiConfig()); f.put(dir + "/credentials/kimi-code.json", kimiGrant(dir)); }
  f.scan(); assert.equal(f.history.entries.length, 2);
  assert.throws(() => f.history.preview("kimi", f.history.entries[0].id), /新旧两套/);
  f.manager.state.nativeVariants.kimi = "legacy";
  assert.equal(f.client("kimi").accounts.filter((a) => a.oauthCurrent).length, 1);
  for (const ref of [{ key: "../escape" }, { key: "x", storage: "keyring" }]) {
    const c = TOML.parse(kimiConfig()); c.providers.official.oauth = ref;
    f.put(".kimi-code/config.toml", TOML.stringify(c));
    assert.deepEqual(kimiSources({ dir: path.join(f.home, ".kimi-code") }), []);
  }
});
test("ZCode: capture whole active session, switch identity domains coherently, preserve API/MCP keys", (t) => {
  const f = fixture(t); f.put(zfile, zgrant(f, "alice")); f.scan(); const id = f.history.entries[0].id;
  f.put(zfile, zgrant(f, "alice", "zai", { "oauth:zai:access_token": "synthetic-refreshed" })); f.scan();
  assert.equal(f.history.entries.length, 1);
  f.put(zfile, zgrant(f, "bob", "bigmodel", { "provider:custom:key": "synthetic-api", "mcp:server": "synthetic-mcp" })); f.scan();
  assert.equal(f.history.entries.length, 2);
  const client = f.client("zcode"); assert.equal(client.accounts.filter((a) => a.oauthCurrent).length, 1);
  assert.equal(client.accounts.find((a) => a.oauthCurrent).provider, "bigmodel");
  const ticket = f.history.preview("zcode", id).ticket; f.history.apply(ticket, true);
  const result = decode(f);
  assert.equal(result["oauth:active_provider"], "zai"); assert.equal(result["oauth:zai:access_token"], "synthetic-refreshed");
  assert.equal(JSON.parse(result["oauth:zai:user_info"]).user_id, "alice");
  assert.equal(JSON.parse(Buffer.from(result.zcodejwttoken.split(".")[1], "base64url")).sub, "alice");
  assert.equal(JSON.parse(result["oauth:login_attribution"]).channel_id, "alice");
  assert.equal(result["oauth:bigmodel:access_token"], undefined);
  assert.equal(result["provider:custom:key"], "synthetic-api"); assert.equal(result["mcp:server"], "synthetic-mcp");
  assert.equal(f.client("zcode").accounts.find((a) => a.oauthCurrent).oauthRecordId, id);
  assert.doesNotMatch(JSON.stringify(f.client("zcode")), /synthetic-|enc:v1:|header\./);
  assert.doesNotMatch(fs.readFileSync(path.join(f.home, zfile), "utf8"), /synthetic-|alice|header\./);
  assert.equal(fs.existsSync(path.join(f.home, zfile) + ".lock"), false);
});
test("ZCode: foreign lock is respected, stale confirmation fails and owned locks are always released", (t) => {
  const f = fixture(t); f.put(zfile, zgrant(f, "alice")); f.scan(); const id = f.history.entries[0].id;
  f.put(zfile, zgrant(f, "bob")); f.scan(); const file = path.join(f.home, zfile), before = fs.readFileSync(file, "utf8");
  const busy = f.history.preview("zcode", id), release = lock(file);
  assert.throws(() => f.history.apply(busy.ticket, true), /正在更新/); assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.ok(fs.existsSync(file + ".lock")); release();
  const stale = f.history.preview("zcode", id); f.put(zfile, zgrant(f, "carol"));
  assert.throws(() => f.history.apply(stale.ticket, true), /变化/);
  assert.equal(fs.existsSync(file + ".lock"), false); assert.equal(JSON.parse(decode(f)["oauth:zai:user_info"]).user_id, "carol");
});
test("ZCode: inactive/partial sessions are not mixed with shared JWT; expired sessions cannot be restored", (t) => {
  const f = fixture(t), partial = zgrant(f, "alice"); delete partial["oauth:active_provider"];
  f.put(zfile, partial); f.scan(); assert.equal(f.history.entries.length, 0);
  const missing = zgrant(f, "alice"); delete missing.zcodejwttoken; f.put(zfile, missing); f.scan();
  assert.equal(f.history.entries.length, 0); assert.equal(f.client("zcode").accounts[0].ready, false);
  f.put(zfile, zgrant(f, "alice", "zai", { zcodejwttoken: jwt({ sub: "alice", exp: 1 }) })); f.scan();
  assert.equal(f.history.entries.length, 1); assert.equal(f.client("zcode").accounts[0].ready, false);
  assert.throws(() => f.history.preview("zcode", f.history.entries[0].id), /到期/);
});
test("ZCode: encryption failure leaves login unchanged; recovery cooperates with native lock", (t) => {
  const f = fixture(t); f.put(zfile, zgrant(f, "alice")); f.scan(); const id = f.history.entries[0].id;
  f.put(zfile, zgrant(f, "bob")); f.scan(); const file = path.join(f.home, zfile), before = fs.readFileSync(file, "utf8");
  const ticket = f.history.preview("zcode", id), encrypt = f.encryption.encryptString;
  f.encryption.encryptString = () => { throw Error("synthetic failure"); };
  assert.throws(() => f.history.apply(ticket.ticket, true)); f.encryption.encryptString = encrypt;
  assert.equal(fs.readFileSync(file, "utf8"), before); assert.equal(fs.existsSync(file + ".lock"), false);
  const after = JSON.stringify(zgrant(f, "alice"));
  f.history.persist(f.history.entries, [{ file, before, after, lock: "zcode" }]); f.put(zfile, after);
  const loaded = new OAuthHistory(f.options); assert.equal(loaded.error, "");
  assert.equal(fs.readFileSync(file, "utf8"), before); assert.equal(fs.existsSync(file + ".lock"), false);
});
test("ZCode: multiple data directories never choose an arbitrary OAuth switch target", (t) => {
  const f = fixture(t), custom = path.join(f.home, "custom");
  f.put(".zcode/v2/setting.json", { dataBaseDir: custom });
  f.put(zfile, zgrant(f, "alice")); f.put("custom/" + zfile, zgrant(f, "bob")); f.scan();
  assert.equal(f.history.entries.length, 2);
  assert.throws(() => f.history.preview("zcode", f.history.entries[0].id), /多个 ZCode 登录目录/);
  f.manager.state.credentialHomes.zcode = path.join(custom, ".zcode/v2");
  assert.equal(f.client("zcode").accounts.filter((a) => a.oauthCurrent).length, 1);
});

test("Antigravity: file fallback login changes are encrypted, displayed once and switchable", (t) => {
  const f = fixture(t), relative = ".gemini/jetski-standalone-oauth-token";
  f.put(".gemini/antigravity/app.json", {});
  f.put(relative, antigravityGrant("alice", { future_field: { keep: "alice" } })); f.scan();
  const alice = f.history.entries[0].id;
  f.put(relative, antigravityGrant("bob", { future_field: { keep: "bob" } })); f.tick(); f.scan();
  assert.equal(f.history.entries.length, 2);
  let client = f.client("antigravity");
  assert.equal(client.accounts.length, 2); assert.equal(client.accounts.filter((a) => a.oauthCurrent).length, 1);
  assert.equal(client.accounts.find((a) => a.oauthCurrent).profile.fields.find((v) => v.id === "email").value, "bob@example.test");
  f.history.apply(f.history.preview("antigravity", alice).ticket, true);
  const stored = JSON.parse(fs.readFileSync(path.join(f.home, relative)));
  assert.equal(stored.project_id, "project-alice"); assert.deepEqual(stored.future_field, { keep: "alice" });
  client = f.client("antigravity"); assert.equal(client.accounts.find((a) => a.oauthCurrent).oauthRecordId, alice);
  assert.doesNotMatch(JSON.stringify(client), /synthetic-antigravity-(access|refresh)/);
  assert.doesNotMatch(fs.readFileSync(f.history.file, "utf8"), /synthetic-antigravity|alice@example/);
});

test("Antigravity: keyring switching uses the fixed external transaction and crash recovery", (t) => {
  const f = fixture(t); f.put(".gemini/antigravity/app.json", {});
  let stored = JSON.stringify(antigravityGrant("alice"));
  const adapter = { read: () => stored, write: (value) => { stored = value; } };
  const cache = (raw) => { const parsed = parseStoredToken(JSON.parse(raw));
    f.manager.antigravityKeyring = { status: "detected", file: "Windows 凭据管理器 · gemini:antigravity",
      raw, grant: parsed.grant, account: parsed.account, checkedAt: Date.now(), adapter }; };
  cache(stored); f.history.external["antigravity-keyring"] = adapter; f.options.external = { "antigravity-keyring": adapter };
  f.scan(); const alice = f.history.entries[0].id;
  stored = JSON.stringify(antigravityGrant("bob")); cache(stored); f.tick(); f.scan();
  assert.equal(f.history.entries.length, 2);
  const bob = f.history.entries.find((entry) => entry.id !== alice).id;
  assert.equal(f.client("antigravity").accounts.filter((a) => a.oauthCurrent).length, 1);
  const preview = f.history.preview("antigravity", alice);
  assert.equal(preview.target, "Windows 凭据管理器 · gemini:antigravity");
  f.history.apply(preview.ticket, true);
  assert.equal(JSON.parse(stored).project_id, "project-alice");
  assert.equal(f.manager.antigravityKeyring.raw, stored);
  stored = null;
  f.manager.antigravityKeyring = { status: "missing", raw: null, checkedAt: Date.now(), adapter };
  f.history.apply(f.history.preview("antigravity", bob).ticket, true);
  assert.equal(JSON.parse(stored).project_id, "project-bob");
  const before = stored, after = JSON.stringify(antigravityGrant("carol"));
  const source = f.manager.oauthHistorySources().find((s) => s.harness === "antigravity");
  f.history.persist(f.history.entries, [{ file: historyFile(source), before, after, external: "antigravity-keyring" }]);
  stored = after;
  const loaded = new OAuthHistory(f.options);
  assert.equal(stored, before); assert.equal(loaded.error, "");
  assert.doesNotMatch(fs.readFileSync(f.history.file, "utf8"), /synthetic-antigravity|example\.test/);
});

test("Antigravity: native keyring fallback changes the active storage without duplicating one identity", (t) => {
  const f = fixture(t); f.put(".gemini/antigravity/app.json", {});
  const keyring = antigravityGrant("alice"), adapter = { read: () => JSON.stringify(keyring), write: () => {} };
  const parsed = parseStoredToken(keyring);
  f.manager.antigravityKeyring = { status: "detected", raw: JSON.stringify(keyring), grant: parsed.grant,
    account: parsed.account, checkedAt: Date.now() + 60000, adapter };
  f.history.external["antigravity-keyring"] = adapter;
  f.scan(); const id = f.history.entries[0].id;
  const fallback = antigravityGrant("alice"); fallback.token.refresh_token = "synthetic-file-refresh";
  f.put(".gemini/jetski-standalone-oauth-token", fallback);
  f.put(".gemini/cache/antigravity-keyring-unavailable", "");
  f.tick(); f.scan();
  assert.equal(f.history.entries.length, 1); assert.equal(f.history.entries[0].id, id);
  assert.equal(f.history.entries[0].grant.token.refresh_token, "synthetic-file-refresh");
  assert.match(f.history.preview("antigravity", id).target, /jetski-standalone-oauth-token$/);
});
