const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { inspect } = require("../core/additional-harnesses.cjs");
const { HarnessManager } = require("../core/harnesses.cjs");
const { parseStoredToken, readKeyring, shouldReadKeyring } = require("../core/antigravity-status.cjs");
const now = Date.UTC(2026, 8, 23);
const expiry = new Date(now + 3600000).toISOString();
const token = (extra = {}) => ({ token: { access_token: "synthetic-access-secret", refresh_token: "synthetic-refresh-secret", expiry },
  id_token: "header." + Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", sub: "sample-user-id", email: "user@example.test", name: "Test User" })).toString("base64url") + ".signature",
  project_id: "project-example", region: "us-central1", user_tier: "tier-example", tier_display_name: "Example Plan", ...extra });
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ass-antigravity-"));
  t.after(() => { assert.equal(path.dirname(home), os.tmpdir()); fs.rmSync(home, { recursive: true, force: true }); });
  const put = (name, data) => {
    const file = path.join(home, name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data)); return file;
  };
  return { home, put, check: (extra = {}) => inspect("antigravity", { home, env: {}, now, ...extra }) };
}

test("Antigravity reads the native shared fallback once and only exposes account metadata", (t) => {
  const f = fixture(t), raw = token(), file = f.put(".gemini/jetski-standalone-oauth-token", raw);
  for (const folder of ["antigravity", "antigravity-ide", "antigravity-cli"])
    f.put(`.gemini/${folder}/settings.json`, {});
  const result = f.check(), [a] = result.accounts;
  assert.equal(result.accounts.length, 1);
  assert.equal(a.authType, "oauth"); assert.equal(a.ready, true); assert.equal(a.expiresAt, now + 3600000);
  const fields = Object.fromEntries(a.profile.fields.map((v) => [v.id, v.value]));
  assert.equal(fields.email, "user@example.test"); assert.equal(fields.plan, "Example Plan");
  assert.equal(fields.projectId, "project-example"); assert.match(fields.clientSurface, /Antigravity 2.0.*IDE/);
  assert.equal(a.sourcePath, file); assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify(raw));
  for (const secret of [raw.token.access_token, raw.token.refresh_token, raw.id_token]) assert.ok(!JSON.stringify(result).includes(secret));
});

test("legacy, expired, refresh-required, incomplete and tombstone grants are distinguished", () => {
  assert.equal(parseStoredToken({ access_token: "legacy", expiry }, now).account.ready, true);
  const expired = { access_token: "expired", expiry: new Date(now - 1).toISOString() };
  assert.equal(parseStoredToken({ token: expired }, now).account.status, "expired");
  assert.equal(parseStoredToken({ token: { ...expired, refresh_token: "refresh" } }, now).account.status, "refresh-required");
  assert.equal(parseStoredToken({ token: { refresh_token: "refresh" } }, now).account.status, "incomplete");
  assert.equal(parseStoredToken({ token: {} }, now).account, null);
  assert.equal(parseStoredToken({ token: null, project_id: "metadata-is-not-login" }, now).account, null);
  assert.equal(parseStoredToken({ token: { access_token: {} } }, now).invalid, true);
});

test("Windows keyring is preferred; empty current grants do not revive an old file login", (t) => {
  const f = fixture(t); f.put(".gemini/jetski-standalone-oauth-token", token());
  const keyring = { status: "detected", file: "Windows 凭据管理器 · gemini:antigravity",
    account: parseStoredToken(token({ project_id: "keyring-project" }), now).account };
  assert.equal(f.check({ keyring }).accounts[0].profile.fields.find((v) => v.id === "projectId").value, "keyring-project");
  assert.equal(f.check({ keyring: { ...keyring, account: null } }).accounts.length, 0);
  assert.equal(f.check({ keyring: { status: "missing" } }).accounts.length, 1);
  const marker = f.put(".gemini/cache/antigravity-keyring-unavailable", "");
  fs.utimesSync(marker, now / 1000, now / 1000);
  assert.equal(f.check({ keyring }).accounts[0].profile.fields.find((v) => v.id === "projectId").value, "project-example");
  fs.utimesSync(marker, (now - 3600001) / 1000, (now - 3600001) / 1000);
  assert.equal(f.check({ keyring }).accounts[0].profile.fields.find((v) => v.id === "projectId").value, "keyring-project");
});

test("CLI API mode does not mislabel cached OAuth as its login; desktop still has the shared OAuth", (t) => {
  const f = fixture(t); f.put(".gemini/antigravity-cli/settings.json", { modelProvider: "gemini" });
  f.put(".gemini/jetski-standalone-oauth-token", token());
  const env = { GEMINI_API_KEY: "sample-api-key" };
  assert.deepEqual(f.check({ env }).accounts.map((a) => a.authType), ["api"]);
  f.put(".gemini/antigravity/app.json", {});
  const result = f.check({ env });
  assert.deepEqual(result.accounts.map((a) => a.authType), ["api", "oauth"]);
  assert.equal(result.accounts[1].profile.fields.find((v) => v.id === "clientSurface").value, "Antigravity 2.0");
});

test("custom and fixture homes cannot read host keyring or borrow default credentials", (t) => {
  const f = fixture(t); f.put(".gemini/jetski-standalone-oauth-token", token());
  const override = path.join(f.home, "custom");
  const keyring = { status: "detected", file: "keyring", account: parseStoredToken(token(), now).account };
  assert.equal(f.check({ override, keyring }).accounts.length, 0);
  assert.equal(shouldReadKeyring({ home: f.home, launcher: { installed: true } }), false);
  f.put("custom/jetski-standalone-oauth-token", token());
  assert.equal(f.check({ override, keyring }).accounts.length, 1);
});

test("the OS reader uses one fixed target, bounded hidden execution and returns no raw tokens", async () => {
  const raw = token(); let command;
  const result = await readKeyring({ platform: "win32", now, run: (exe, args, options, cb) => {
    command = Buffer.from(args.at(-1), "base64").toString("utf16le");
    assert.match(exe, /System32.*WindowsPowerShell/); assert.equal(options.windowsHide, true); assert.equal(options.timeout, 5000);
    assert.match(command, /CredRead\("gemini:antigravity", 1, 0/); assert.doesNotMatch(command, /CredEnumerate|CredWrite|CredDelete/);
    cb(null, JSON.stringify({ status: "detected", payload: JSON.stringify(raw) }));
  } });
  assert.equal(result.status, "detected"); assert.equal(result.account.ready, true);
  for (const secret of [raw.token.access_token, raw.token.refresh_token, raw.id_token]) assert.ok(!JSON.stringify(result).includes(secret));
  const failure = await readKeyring({ platform: "win32", run: (_e, _a, _o, cb) => cb(Error("secret-error"), "secret-output") });
  assert.equal(failure.status, "unreadable"); assert.ok(!JSON.stringify(failure).includes("secret"));
  assert.equal((await readKeyring({ platform: "linux", run: () => assert.fail("must not run") })).status, "external");
});

test("cached keyring expiry is updated on snapshots and corrupt files never disclose contents", (t) => {
  const f = fixture(t), keyring = { status: "detected", file: "keyring", account: parseStoredToken(token(), now).account };
  assert.equal(f.check({ keyring, now: now + 3600001 }).accounts[0].status, "refresh-required");
  const file = f.put(".gemini/jetski-standalone-oauth-token", '{"token":"synthetic-private-malformed');
  const result = f.check(); assert.equal(result.accounts.length, 0);
  assert.equal(result.sources.find((s) => s.file === file).status, "unreadable");
  assert.ok(!JSON.stringify(result).includes("synthetic-private"));
  const fakeIssuer = token({ id_token: "header." + Buffer.from(JSON.stringify({ iss: "https://third.example", email: "not-a-google-user" })).toString("base64url") + ".signature" });
  assert.ok(!parseStoredToken(fakeIssuer, now).account.profile.fields.some((f) => f.id === "email"));
});

test("multiple desktop installs are detected but require an explicit desktop choice", (t) => {
  const f = fixture(t), hub = "local/Programs/Antigravity", ide = "local/Programs/Antigravity IDE";
  const hubExe = f.put(hub + "/Antigravity.exe", "fixture-not-an-executable");
  f.put(hub + "/resources/app.asar/package.json", { name: "antigravity", productName: "Antigravity" });
  f.put(ide + "/Antigravity IDE.exe", "fixture-not-an-executable");
  f.put(ide + "/resources/app/product.json", { nameShort: "Antigravity IDE", applicationName: "antigravity-ide" });
  const manager = new HarnessManager(f.home, () => ({ providers: [] }), [], path.join(f.home, ".codex"),
    { home: f.home, env: {}, launchEnv: { PATH: "", USERPROFILE: f.home, LOCALAPPDATA: path.join(f.home, "local") } });
  manager.detect("antigravity");
  const row = manager.snapshot().clients.find((c) => c.id === "antigravity");
  assert.equal(row.detected, true); assert.equal(row.desktop, null);
  manager.setExecutable("antigravity", hubExe);
  assert.equal(manager.desktop("antigravity"), hubExe);
  const cli = f.put("local/agy/bin/agy.exe", "fixture-not-an-executable");
  manager.detect("antigravity"); manager.setExecutable("antigravity", cli);
  assert.equal(manager.desktop("antigravity"), null);
});
