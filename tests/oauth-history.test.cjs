const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { OAuthHistory } = require("../core/oauth-history.cjs");
const { discoverNative } = require("../core/credential-status.cjs");
const jwt = (data) => "header." + Buffer.from(JSON.stringify(data)).toString("base64url") + ".signature";
const grant = (user = "alice", suffix = "1", workspace = "work") => ({
  auth_mode: "chatgpt", last_refresh: "2026-09-23T00:00:00Z", extra: { keep: true },
  tokens: { access_token: jwt({ exp: 2100000000, sub: user, "https://api.openai.com/auth": { chatgpt_account_id: workspace, chatgpt_user_id: user } }),
    id_token: jwt({ email: user + "@example.test", "https://api.openai.com/auth": { chatgpt_account_id: workspace, chatgpt_user_id: user } }),
    refresh_token: "synthetic-refresh-" + user + suffix, account_id: workspace },
});
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data)); }
function setup(t, harness = "codex") {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ass-oauth-history-"));
  t.after(() => fs.rmSync(dataDir, { force: true, recursive: true }));
  const dir = path.join(dataDir, "home", harness === "codex" ? ".codex" : harness === "claude" ? ".claude" : ".pi/agent");
  const file = path.join(dir, harness === "claude" ? ".credentials.json" : "auth.json");
  const encryptionKey = crypto.randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv); const body = Buffer.concat([cipher.update(s), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    decryptString: (b) => { const cipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, b.subarray(0, 12)); cipher.setAuthTag(b.subarray(12, 28)); return Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString(); },
  };
  let time = 1780000000000;
  const sources = [{ harness, dir, native: true }];
  const options = { dataDir, crypto: encryption, sources: () => sources, target: () => sources[0], now: () => time };
  const history = new OAuthHistory(options);
  return { history, options, file, dir, sources, encryption, tick: () => { time += 2000; },
    save: (v) => { write(file, v); history.scan({ immediate: true }); },
    scan: () => history.scan({ immediate: true }),
    native: () => JSON.parse(fs.readFileSync(file, "utf8")),
  };
}
test("OAuth: captures new Codex identity, refresh updates in place, same workspace users stay separate", (t) => {
  const f = setup(t); f.save(grant()); const id = f.history.entries[0].id;
  f.tick(); f.save(grant("alice", "2")); assert.equal(f.history.entries.length, 1); assert.equal(f.history.entries[0].id, id);
  assert.equal(f.history.entries[0].grant.refresh_token, "synthetic-refresh-alice2");
  f.save(grant("bob")); f.save(grant("alice", "3", "another-work")); assert.equal(f.history.entries.length, 3);
  const disk = fs.readFileSync(f.history.file, "utf8"); assert.ok(!disk.includes("alice") && !disk.includes("synthetic-refresh"));
  const reloaded = new OAuthHistory(f.options); assert.equal(reloaded.entries.length, 3); assert.equal(reloaded.error, "");
});
test("OAuth: native switch preserves unrelated fields and current login, ticket is one-use", (t) => {
  const f = setup(t); f.save(grant()); const alice = f.history.entries[0].id; f.save(grant("bob"));
  const before = fs.readFileSync(f.file, "utf8"), ticket = f.history.preview("codex", alice).ticket;
  assert.equal(fs.readFileSync(f.file, "utf8"), before);
  assert.equal(f.history.apply(ticket, true).ok, true); assert.equal(f.native().tokens.refresh_token, "synthetic-refresh-alice1");
  assert.deepEqual(f.native().extra, { keep: true }); assert.equal(f.history.entries.length, 2);
  assert.throws(() => f.history.apply(ticket, true), /失效/);
});
test("OAuth: cancelled, unconfirmed and expired switches never write", (t) => {
  const f = setup(t); f.save(grant()); const id = f.history.entries[0].id, before = fs.readFileSync(f.file, "utf8");
  assert.throws(() => f.history.apply(f.history.preview("codex", id).ticket, false), /失效/);
  const expired = f.history.preview("codex", id).ticket; for (let i = 0; i < 61; i++) f.tick();
  assert.throws(() => f.history.apply(expired, true), /失效/); assert.equal(fs.readFileSync(f.file, "utf8"), before);
});
test("OAuth: native token refresh while confirmation is open rejects stale switch", (t) => {
  const f = setup(t); f.save(grant()); const alice = f.history.entries[0].id; f.save(grant("bob"));
  const p = f.history.preview("codex", alice); write(f.file, grant("bob", "2"));
  assert.throws(() => f.history.apply(p.ticket, true), /变化/); assert.equal(f.native().tokens.refresh_token, "synthetic-refresh-bob2");
});
test("OAuth: preview records latest native refresh instead of reverting it", (t) => {
  const f = setup(t); f.save(grant()); const id = f.history.entries[0].id; write(f.file, grant("alice", "2"));
  f.history.apply(f.history.preview("codex", id).ticket, true); assert.equal(f.native().tokens.refresh_token, "synthetic-refresh-alice2");
});
test("OAuth: malformed and missing files do not erase history; watcher settles writes", (t) => {
  const f = setup(t); f.save(grant()); write(f.file, "{"); f.scan(); assert.equal(f.history.entries.length, 1);
  write(f.file, grant("bob")); f.history.scan(); assert.equal(f.history.entries.length, 1);
  f.tick(); f.history.scan(); assert.equal(f.history.entries.length, 2);
  fs.unlinkSync(f.file); f.scan(); assert.equal(f.history.entries.length, 2);
});
test("OAuth: API keys and non-OAuth harnesses are not recorded or switchable", (t) => {
  const f = setup(t); f.save(grant()); const id = f.history.entries[0].id;
  f.save({ auth_mode: "apikey", OPENAI_API_KEY: "synthetic-api-key" }); assert.equal(f.history.entries.length, 1);
  assert.throws(() => f.history.preview("codex", id), /不是|API Key/);
  assert.throws(() => f.history.preview("dsh", id), /不支持/);
  assert.throws(() => f.history.preview("opencode", id), /不支持/);
});
test("OAuth: unavailable encryption stops capture and preserves native credentials", (t) => {
  const f = setup(t); f.encryption.isEncryptionAvailable = () => false; f.save(grant());
  assert.equal(f.history.entries.length, 0); assert.ok(f.history.errors.codex); assert.ok(!fs.existsSync(f.history.file));
});
test("OAuth: corrupt encrypted history is not overwritten", (t) => {
  const f = setup(t); write(f.history.file, "broken"); const h = new OAuthHistory(f.options); write(f.file, grant()); h.scan({ immediate: true });
  assert.ok(h.error); assert.equal(fs.readFileSync(f.history.file, "utf8"), "broken");
});
test("OAuth: keyring, auto, ephemeral and environment overrides fail closed", (t) => {
  const f = setup(t); f.save(grant()); const id = f.history.entries[0].id;
  for (const mode of ["keyring", "auto", "ephemeral"]) {
    write(path.join(f.dir, "config.toml"), `cli_auth_credentials_store = "${mode}"`);
    assert.throws(() => f.history.preview("codex", id), /不能通过文件/);
  }
  write(path.join(f.dir, "config.toml"), "cli_auth_credentials_store = 'file'"); f.sources[0].blocked = "环境变量覆盖";
  assert.throws(() => f.history.preview("codex", id), /环境变量/);
});
test("OAuth: changed target and forced workspace restrictions are respected", (t) => {
  const f = setup(t); f.save(grant()); const id = f.history.entries[0].id;
  write(path.join(f.dir, "config.toml"), 'forced_chatgpt_workspace_id = "elsewhere"'); assert.throws(() => f.history.preview("codex", id), /工作区限制/);
  write(path.join(f.dir, "config.toml"), 'forced_login_method = "api"'); assert.throws(() => f.history.preview("codex", id), /限定/);
  write(path.join(f.dir, "config.toml"), 'forced_login_method = "chatgpt"'); const p = f.history.preview("codex", id);
  f.sources[0] = { harness: "codex", dir: path.join(f.dir, "other") };
  assert.throws(() => f.history.apply(p.ticket, true), /变化/);
});
test("OAuth: conflicting JWT account claims never overwrite saved identity", (t) => {
  const f = setup(t); f.save(grant()); const invalid = grant("bob"); invalid.tokens.account_id = "wrong"; f.save(invalid);
  assert.equal(f.history.entries.length, 1); assert.ok(f.history.errors.codex);
});
test("OAuth: contradictory user IDs in one workspace never merge", (t) => {
  const f = setup(t); f.save(grant()); const invalid = grant("bob"); invalid.tokens.id_token = grant("alice").tokens.id_token; f.save(invalid);
  assert.equal(f.history.entries.length, 1); assert.ok(f.history.errors.codex);
});
test("OAuth: old IPC snapshots cannot replace newer background login state", async () => {
  const { latestSnapshot } = await import("../src/state-snapshot.mjs");
  const current = { sequence: 12, account: "bob" }, stale = { sequence: 11, account: "alice" };
  assert.equal(latestSnapshot(current, stale), current); assert.equal(latestSnapshot(stale, current), current);
  assert.equal(latestSnapshot(null, current), current);
});
test("OAuth: pi switches only one OAuth grant and preserves other providers/API keys", (t) => {
  const f = setup(t, "pi"); const a = { type: "oauth", access: "a", refresh: "ra", expires: 2100000000000, email: "alice@example.test" };
  const b = { ...a, access: "b", refresh: "rb", email: "bob@example.test" };
  f.save({ anthropic: a }); const id = f.history.entries[0].id;
  f.save({ anthropic: b, other: { type: "api_key", key: "synthetic-pi-key" }, third: { type: "oauth", access: "c", refresh: "rc" } });
  const before = f.native(); f.history.apply(f.history.preview("pi", id).ticket, true);
  assert.deepEqual(f.native(), { ...before, anthropic: a });
  f.save({ ...before, anthropic: { type: "api_key", key: "keep" } }); assert.throws(() => f.history.preview("pi", id), /API Key/);
});
test("OAuth: Claude switches oauthAccount metadata but preserves preferences and API keys", (t) => {
  const f = setup(t, "claude"), meta = path.join(path.dirname(f.dir), ".claude.json");
  const a = { accessToken: "a", refreshToken: "ra", expiresAt: 2100000000000, accountId: "alice" };
  write(meta, { oauthAccount: { accountUuid: "alice", emailAddress: "alice@example.test" }, theme: "dark" }); f.save({ claudeAiOauth: a, primaryApiKey: "keep" }); const id = f.history.entries[0].id;
  write(meta, { oauthAccount: { accountUuid: "bob", emailAddress: "bob@example.test" }, theme: "light" }); f.save({ claudeAiOauth: { ...a, accountId: "bob", accessToken: "b", refreshToken: "rb" }, primaryApiKey: "keep" });
  f.history.apply(f.history.preview("claude", id).ticket, true);
  assert.equal(f.native().primaryApiKey, "keep"); assert.equal(f.native().claudeAiOauth.accountId, "alice");
  assert.equal(JSON.parse(fs.readFileSync(meta)).theme, "light"); assert.equal(JSON.parse(fs.readFileSync(meta)).oauthAccount.accountUuid, "alice");
});
test("OAuth: opaque refresh grants do not conflate unknown users", (t) => {
  const f = setup(t, "claude"); f.save({ claudeAiOauth: { accessToken: "a", refreshToken: "r1" } });
  f.save({ claudeAiOauth: { accessToken: "a2", refreshToken: "r1" } }); assert.equal(f.history.entries.length, 1);
  f.save({ claudeAiOauth: { accessToken: "b", refreshToken: "r2" } }); assert.equal(f.history.entries.length, 2);
});
test("OAuth: renderer metadata has no tokens and current record is not duplicated", (t) => {
  const f = setup(t); f.save(grant()); f.save(grant("bob"));
  const client = { id: "codex", accounts: discoverNative("codex", { home: path.dirname(f.dir), codexDir: f.dir }).flatMap((s) => s.accounts) };
  f.history.decorate(client); assert.equal(client.accounts.length, 2); assert.equal(client.accounts.filter((a) => a.oauthCurrent).length, 1);
  assert.ok(!JSON.stringify(client).includes("synthetic-refresh")); assert.ok(!JSON.stringify(client).includes("header."));
  assert.equal(client.accounts.find((a) => a.kind === "oauth-history").sourcePath, undefined);
});
test("OAuth: interrupted two-file switch rolls back exact before images on restart", (t) => {
  const f = setup(t); f.save(grant()); const before = fs.readFileSync(f.file, "utf8"), after = JSON.stringify(grant("bob"));
  f.history.persist(f.history.entries, [{ file: f.file, before, after }]); write(f.file, after);
  const h = new OAuthHistory(f.options); assert.equal(h.error, ""); assert.equal(fs.readFileSync(f.file, "utf8"), before);
});
test("OAuth: interrupted switch never overwrites a later native login", (t) => {
  const f = setup(t); f.save(grant()); const before = fs.readFileSync(f.file, "utf8"), after = JSON.stringify(grant("bob"));
  f.history.persist(f.history.entries, [{ file: f.file, before, after }]); write(f.file, grant("carol"));
  const h = new OAuthHistory(f.options); assert.ok(h.error); assert.equal(f.native().tokens.refresh_token, "synthetic-refresh-carol1");
});
test("OAuth: write-ahead encryption failure cannot change native credentials", (t) => {
  const f = setup(t); f.save(grant()); const alice = f.history.entries[0].id; f.save(grant("bob"));
  const p = f.history.preview("codex", alice), before = fs.readFileSync(f.file, "utf8");
  f.encryption.encryptString = () => { throw Error("synthetic persistence failure"); };
  assert.throws(() => f.history.apply(p.ticket, true)); assert.equal(fs.readFileSync(f.file, "utf8"), before);
});
test("OAuth: a changed saved grant invalidates an already-open switch confirmation", (t) => {
  const f = setup(t); f.save(grant()); const alice = f.history.entries[0].id; f.save(grant("bob"));
  const p = f.history.preview("codex", alice), entry = f.history.entries.find((e) => e.id === alice);
  entry.fingerprint = "changed"; assert.throws(() => f.history.apply(p.ticket, true), /变化/);
  assert.equal(f.native().tokens.refresh_token, "synthetic-refresh-bob1");
});
test("OAuth: history source whitelist is enforced for capture and direct switch calls", (t) => {
  const f = setup(t, "pi"); f.history.allows = (_, provider) => provider === "anthropic";
  f.save({ anthropic: { type: "oauth", access: "a", refresh: "ra" }, arbitrary: { type: "oauth", access: "b", refresh: "rb" } });
  assert.equal(f.history.entries.length, 1); const id = f.history.entries[0].id;
  f.history.allows = () => false; assert.throws(() => f.history.preview("pi", id), /不支持/);
});
test("OAuth: discovering pi capabilities later records the unchanged native grant", (t) => {
  const f = setup(t, "pi"); f.history.allows = () => false;
  f.save({ anthropic: { type: "oauth", access: "a", refresh: "ra" } }); assert.equal(f.history.entries.length, 0);
  f.history.allows = () => true; f.scan(); assert.equal(f.history.entries.length, 1);
});
