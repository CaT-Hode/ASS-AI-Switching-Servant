const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { HarnessManager } = require("../core/harnesses.cjs");
const { OAuthHistory } = require("../core/oauth-history.cjs");
const { NativeLogin, loginSpec } = require("../core/native-login.cjs");
const { ClientProcesses } = require("../core/client-processes.cjs");

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ass-native-login-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const put = (relative, value = "") => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    return file;
  };
  const env = { PATH: path.join(root, "bin"), USERPROFILE: root, NODE_USE_SYSTEM_CA: "1" };
  for (const name of ["kimi", "zcode", "node"]) put("bin/" + name + ".exe");
  const launches = [], children = [];
  const spawn = (file, args, options) => {
    const child = Object.assign(new EventEmitter(), { pid: 1000 + launches.length, unref() {} });
    launches.push({ file, args, options }); children.push(child);
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };
  const manager = new HarnessManager(root, () => ({ providers: [] }), [], path.join(root, ".codex"), { home: root, env, launchEnv: env, spawn });
  manager.state.executables = { kimi: path.join(root, "bin/kimi.exe"), zcode: path.join(root, "bin/zcode.exe") };
  manager.state.nativeVariants.kimi = "current";
  const key = crypto.randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv); const data = Buffer.concat([c.update(s), c.final()]); return Buffer.concat([iv, c.getAuthTag(), data]); },
    decryptString: (b) => { const c = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12)); c.setAuthTag(b.subarray(12, 28)); return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(); },
  };
  const history = new OAuthHistory({ dataDir: root, crypto: encryption, sources: () => manager.oauthHistorySources(),
    target: (id, provider) => manager.oauthHistoryTarget(id, provider), allows: (id, provider) => manager.oauthHistoryAllows(id, provider) });
  const login = new NativeLogin({ harnesses: manager, history });
  const kimi = (who = "alice", home = ".kimi-code") => {
    put(home + "/config.toml", '[providers."managed:kimi-code"]\ntype="kimi"\nbase_url="https://api.kimi.com/coding/v1"\noauth={storage="file", key="oauth/kimi-code"}\n');
    return put(home + "/credentials/kimi-code.json", { access_token: "synthetic-" + who, refresh_token: "refresh-" + who, expires_at: 2100000000 });
  };
  return { root, put, env, manager, history, login, launches, children, encryption, kimi };
}

test("native login: preview/cancel have no writes and reveal neither grants nor environment", async (t) => {
  const f = setup(t), file = f.kimi(), before = fs.readFileSync(file, "utf8");
  f.env.ZCODE_CREDENTIAL_SECRET = "synthetic-cipher-secret";
  const p = await f.login.preview("kimi");
  assert.deepEqual(p.choices.map((v) => v.id), ["mainland-cn", "global"]);
  assert.doesNotMatch(JSON.stringify(p), /synthetic|refresh-|environment|executable/);
  await assert.rejects(f.login.apply(p.ticket, "global", false), /失效/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(fs.existsSync(f.history.file), false);
  assert.equal(f.launches.length, 0);
});

test("native login: saves previous Kimi grant, dispatches native CLI, captures replacement on exit", async (t) => {
  const f = setup(t), file = f.kimi(), before = fs.readFileSync(file, "utf8");
  f.manager.state.workspace = f.put("project/.env", "ZCODE_BASE_URL=https://example.invalid").replace(/[/\\]\.env$/, "");
  const p = await f.login.preview("kimi");
  await f.login.apply(p.ticket, "global", true);
  assert.equal(f.history.entries[0].grant.access_token, "synthetic-alice");
  assert.doesNotMatch(fs.readFileSync(f.history.file, "utf8"), /synthetic-alice|refresh-alice/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  const launch = f.launches[0], script = Buffer.from(launch.args.at(-1), "base64").toString("utf16le");
  assert.match(script, /'login' '--region' 'global'/);
  assert.match(script, /Read-Host/);
  assert.ok(launch.options.cwd.startsWith(path.join(f.root, "native-login") + path.sep));
  assert.equal(launch.options.env.KIMI_CODE_HOME, path.join(f.root, ".kimi-code"));
  assert.equal(launch.options.windowsHide, false);
  await assert.rejects(f.login.preview("kimi"), /仍在运行/);
  f.kimi("bob"); f.children[0].emit("exit", 0);
  assert.equal(f.history.entries.length, 2);
  assert.equal(fs.existsSync(launch.options.cwd), false);
  await f.login.preview("kimi");
});

test("native login: legacy Kimi never receives unsupported region flag", async (t) => {
  const f = setup(t); f.manager.state.nativeVariants.kimi = "legacy"; f.kimi("alice", ".kimi");
  const p = await f.login.preview("kimi");
  assert.deepEqual(p.choices.map((v) => v.id), ["default"]);
  await f.login.apply(p.ticket, "default", true);
  const script = Buffer.from(f.launches[0].args.at(-1), "base64").toString("utf16le");
  assert.match(script, /'login'/); assert.doesNotMatch(script, /--region/);
  assert.equal(f.launches[0].options.env.KIMI_SHARE_DIR, path.join(f.root, ".kimi"));
  assert.equal(f.launches[0].options.env.KIMI_CODE_HOME, undefined);
});

test("native login: ambiguous Kimi launcher requires explicit version; known npm package is current", (t) => {
  const f = setup(t); f.manager.state.nativeVariants.kimi = "auto";
  assert.throws(() => loginSpec(f.manager, "kimi"), /无法确定/);
  f.put("kimi-package/package.json", { name: "@moonshot-ai/kimi-code", bin: { kimi: "cli.mjs" } });
  f.put("kimi-package/cli.mjs"); f.manager.state.executables.kimi = path.join(f.root, "kimi-package");
  assert.equal(loginSpec(f.manager, "kimi").target.variant, "current");
  f.manager.state.nativeVariants.kimi = "legacy";
  assert.throws(() => loginSpec(f.manager, "kimi"), /统一版本/);
});

test("native login: strips conflicting endpoints and TLS bypass, retains proxy/CA and ZCode cipher secret", (t) => {
  const f = setup(t);
  Object.assign(f.env, { KIMI_CODE_OAUTH_HOST: "https://example.invalid", KIMI_API_KEY: "synthetic-key",
    KIMI_CODE_HOME: path.join(f.root, "custom-kimi"), ZCODE_BASE_URL: "https://example.invalid",
    ZCODE_ENV: "test", ZCODE_CREDENTIAL_SECRET: "synthetic-cipher", NODE_OPTIONS: "--require untrusted.js",
    NODE_TLS_REJECT_UNAUTHORIZED: "0", HTTPS_PROXY: "http://127.0.0.1:1234", NODE_EXTRA_CA_CERTS: "custom-ca.pem",
    ZCODE_HTTP_PROXY: "http://127.0.0.1:1235", ZCODE_AGENT_CA_CERT: "zcode-ca.pem", ZCODE_NO_PROXY: "localhost" });
  const k = loginSpec(f.manager, "kimi"), z = loginSpec(f.manager, "zcode");
  assert.equal(k.env.KIMI_CODE_HOME, path.join(f.root, "custom-kimi"));
  for (const env of [k.env, z.env]) {
    for (const key of ["KIMI_CODE_OAUTH_HOST", "KIMI_API_KEY", "NODE_OPTIONS", "NODE_TLS_REJECT_UNAUTHORIZED"]) assert.equal(env[key], undefined);
    assert.equal(env.NODE_USE_SYSTEM_CA, "1"); assert.equal(env.HTTPS_PROXY, f.env.HTTPS_PROXY);
    assert.equal(env.NODE_EXTRA_CA_CERTS, "custom-ca.pem");
  }
  assert.equal(z.env.ZCODE_CREDENTIAL_SECRET, "synthetic-cipher");
  assert.equal(z.env.ZCODE_HTTP_PROXY, f.env.ZCODE_HTTP_PROXY); assert.equal(z.env.ZCODE_AGENT_CA_CERT, "zcode-ca.pem");
  assert.equal(z.env.ZCODE_NO_PROXY, "localhost");
  assert.equal(z.env.ZCODE_BASE_URL, "https://zcode.z.ai"); assert.equal(z.env.ZCODE_ENV, "production");
});

test("native login: ZCode desktop runs bundled CLI with its own Electron, not desktop UI flags", async (t) => {
  const f = setup(t);
  f.put("ZCode/ZCode.exe"); f.put("ZCode/resources/app.asar"); f.put("ZCode/resources/glm/zcode.cjs");
  f.manager.state.executables.zcode = path.join(f.root, "ZCode/ZCode.exe");
  const p = await f.login.preview("zcode");
  await f.login.apply(p.ticket, "bigmodel", true);
  const { options, args } = f.launches[0], script = Buffer.from(args.at(-1), "base64").toString("utf16le");
  assert.match(script, /resources[\\/]glm[\\/]zcode.cjs' 'login' 'bigmodel'/);
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(options.env.ZCODE_DATA_BASE_DIR, f.root);
  assert.equal(options.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, path.join(f.root, ".zcode/v2/provider_config.json"));
});

test("native login: ZCode missing bundle and non-representable credential directory fail without fallback", (t) => {
  const f = setup(t);
  f.put("ZCode/ZCode.exe"); f.put("ZCode/resources/app.asar");
  f.manager.state.executables.zcode = path.join(f.root, "ZCode/ZCode.exe");
  assert.throws(() => loginSpec(f.manager, "zcode"), /没有内置/);
  f.put("ZCode/resources/glm/zcode.cjs");
  f.manager.state.credentialHomes.zcode = path.join(f.root, "arbitrary");
  assert.throws(() => loginSpec(f.manager, "zcode"), /登录目录/);
  f.manager.state.credentialHomes.zcode = path.join(f.root, "custom/.zcode/v2");
  assert.equal(loginSpec(f.manager, "zcode").env.ZCODE_DATA_BASE_DIR, path.join(f.root, "custom"));
});

test("native login: changed credentials, settings, expired confirmation and unlisted choice cannot launch", async (t) => {
  const f = setup(t); f.kimi();
  let p = await f.login.preview("kimi"); f.kimi("bob");
  await assert.rejects(f.login.apply(p.ticket, "global", true), /变化/);
  p = await f.login.preview("kimi"); f.env.HTTPS_PROXY = "http://127.0.0.1:1234";
  await assert.rejects(f.login.apply(p.ticket, "global", true), /变化/);
  p = await f.login.preview("kimi");
  await assert.rejects(f.login.apply(p.ticket, "global; bad-command", true), /请选择/);
  p = await f.login.preview("kimi"); f.login.tickets.get(p.ticket).expires = 0;
  await assert.rejects(f.login.apply(p.ticket, "global", true), /失效/);
  await assert.rejects(f.login.preview("antigravity"), /不支持/);
  assert.equal(f.launches.length, 0);
});

test("native login: unavailable encrypted storage prevents replacing a current login", async (t) => {
  const f = setup(t), file = f.kimi(), before = fs.readFileSync(file, "utf8");
  const p = await f.login.preview("kimi"); f.encryption.isEncryptionAvailable = () => false;
  await assert.rejects(f.login.apply(p.ticket, "global", true), /加密/);
  assert.equal(f.launches.length, 0); assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("native login: rejects concurrent/recovered windows but never terminates any client", async (t) => {
  const f = setup(t);
  const session = { harness: "zcode", account: "native-login:zai", status: "running" };
  let refreshed = 0;
  f.login.processes = { sessions: [session], refresh: async () => { refreshed++; } };
  await assert.rejects(f.login.preview("zcode"), /仍在运行/);
  assert.equal(refreshed, 1);
  session.status = "gone"; await f.login.preview("zcode");
  assert.equal(f.launches.length, 0);
});

test("native login: spawn failure clears dispatch state and never removes client-created files", async (t) => {
  const f = setup(t);
  const spawn = f.manager.options.spawn;
  f.manager.options.spawn = () => { throw Error("synthetic spawn failure"); };
  const p = await f.login.preview("zcode");
  await assert.rejects(f.login.apply(p.ticket, "zai", true), /spawn failure/);
  assert.equal(f.login.running.size, 0);
  f.manager.options.spawn = spawn;
  const next = await f.login.preview("zcode"); await f.login.apply(next.ticket, "zai", true);
  const file = path.join(f.launches[0].options.cwd, "native-client-log.txt");
  fs.writeFileSync(file, "keep"); f.children[0].emit("exit", 1);
  assert.equal(fs.readFileSync(file, "utf8"), "keep");
});

test("native login: process journal accepts Kimi/ZCode and reloads native transport", async (t) => {
  const f = setup(t), adapter = { inspect: async (rows) => rows.map((r) => ({ id: r.id,
    root: { pid: r.pid, parentPid: 0, creationDate: "2026-09-23T00:00:00.000Z", markerMatched: true }, descendants: [] })) };
  const processes = new ClientProcesses({ dataDir: f.root, adapter });
  for (const [i, harness] of ["kimi", "zcode"].entries()) await processes.register({ id: harness + "-login",
    harness, account: "native-login:default", transport: "native", label: harness + " login", pid: 1000 + i,
    marker: harness + "-native-login-marker" });
  const reloaded = new ClientProcesses({ dataDir: f.root, adapter });
  assert.equal(reloaded.error, null); assert.equal(reloaded.sessions.length, 2);
  assert.ok(reloaded.sessions.every((s) => s.transport === "native"));
});
