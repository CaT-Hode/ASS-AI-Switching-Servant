const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { Connections } = require("../core/connections.cjs");
const { InjectionFiles, hash } = require("../core/injection-files.cjs");
const { ConfigManager, atomic } = require("../core/config.cjs");
const { Router } = require("../core/router.cjs");
const { routeConfig } = require("../core/harnesses.cjs");
const { parseImport } = require("../core/models.cjs");

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ass-connections-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function connectionFixture(t, overrides = {}) {
  const dataDir = temp(t), configFile = path.join(dataDir, "config.toml");
  fs.writeFileSync(configFile, "");
  const router = {
    active: Object.create(null), starts: 0, stops: 0,
    clientActive(id) { return id ? (this.active[id] || 0) : Object.values(this.active).reduce((a, b) => a + b, 0); },
    async start() { this.starts++; }, async stop() { this.stops++; },
  };
  const config = {
    file: configFile, catalog: path.join(dataDir, "catalog.json"), baseUrl: "http://127.0.0.1:25819/clients/codex/v1",
    attached: false, managed: false, attachCalls: 0, detachCalls: 0, preflightCalls: 0,
    status() { return { attached: this.attached, managed: this.managed }; },
    attach() { this.attachCalls++; this.attached = this.managed = true; },
    preflightDetach() { this.preflightCalls++; },
    detach() { this.detachCalls++; this.attached = this.managed = false; },
  };
  const injections = {
    entries: [], error: "", restored: [], preflightCalls: [], version: 0,
    preflight(ids) { this.preflightCalls.push([...ids]); },
    list(ids) { return this.entries.filter((e) => ids.includes(e.harness)); },
    fingerprint(ids) { return hash(JSON.stringify([this.version, ids])); },
    restore(ids) { this.restored.push([...ids]); this.entries = this.entries.filter((e) => !ids.includes(e.harness)); },
  };
  const processes = {
    sessions: [], error: null, refreshCalls: 0, stopCalls: [],
    async refresh() { this.refreshCalls++; return this.snapshot(); },
    snapshot() { return { sessions: this.sessions.map((s) => ({ ...s })), error: this.error }; },
    async stop(ids) { this.stopCalls.push([...ids]); for (const s of this.sessions) if (ids.includes(s.id)) s.status = "gone"; return this.snapshot(); },
  };
  Object.assign(router, overrides.router); Object.assign(config, overrides.config);
  Object.assign(injections, overrides.injections); Object.assign(processes, overrides.processes);
  const connections = new Connections({ dataDir, router, config, injections, processes,
    nativeConfig: overrides.nativeConfig,
    extraActive: overrides.extraActive || (() => 0), restarter: overrides.restarter });
  return { dataDir, router, config, injections, processes, connections };
}

test("initial all-false connection state is persisted and restart stays closed without starting router", async (t) => {
  const f = connectionFixture(t);
  const expected = { codex: false, claude: false, opencode: false, pi: false, dsh: false, kimi: false, zcode: false };
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dataDir, "connections.json"), "utf8")), expected);

  const restarted = new Connections({
    dataDir: f.dataDir,
    router: f.router,
    config: f.config,
    injections: f.injections,
    processes: f.processes,
  });
  assert.deepEqual(restarted.enabled, expected);
  for (const id of Object.keys(expected)) assert.equal(restarted.allow(id), false);
  assert.equal(f.router.starts, 0);

  const plan = await restarted.preview("pi", false);
  await restarted.apply({ ticket: plan.ticket, mode: "safe", acknowledged: true });
  assert.equal(f.router.starts, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(restarted.file, "utf8")), expected);
});
function fakeRestarter() {
  return { calls: [], preview: async () => ({ available: true, applicable: true, names: ["Codex 桌面端"] }),
    public: (p) => p, async validate() { this.calls.push("validate"); }, async restart() { this.calls.push("restart"); return { ok: true }; } };
}
test("connection enable and disable restart only with explicit per-operation opt-in", async (t) => {
  const r = fakeRestarter(), f = connectionFixture(t, { restarter: r });
  const first = await f.connections.preview("codex", true);
  await f.connections.apply({ ticket: first.ticket, mode: "safe", acknowledged: true }); assert.deepEqual(r.calls, []);
  const off = await f.connections.preview("codex", false);
  await f.connections.apply({ ticket: off.ticket, mode: "safe", acknowledged: true, restart: true }); assert.deepEqual(r.calls, ["validate", "restart"]);
  r.calls = []; const on = await f.connections.preview("codex", true);
  await f.connections.apply({ ticket: on.ticket, mode: "safe", acknowledged: true, restart: true }); assert.deepEqual(r.calls, ["validate", "restart"]);
});
test("DSH native sync reports the browser catalog refresh boundary", async (t) => {
  const nativeConfig = {
    isDirect: (id) => id === "dsh",
    list: () => [],
    preflight() {},
    fingerprint: () => "native-dsh",
    sync() {},
    status: (id, enabled) => id === "dsh" ? {
      mode: "native",
      modelCount: 15,
      applied: enabled,
      runtimeStatus: enabled ? "client-refresh-required" : "inactive",
    } : {},
  };
  const f = connectionFixture(t, { nativeConfig });
  const plan = await f.connections.preview("dsh", true);
  const result = await f.connections.apply({ ticket: plan.ticket, mode: "safe", acknowledged: true });
  assert.match(result.message, /已打开页面需刷新/);
  assert.equal(f.connections.snapshot().clients.dsh.runtimeStatus, "client-refresh-required");
  assert.equal(f.connections.snapshot().clients.dsh.modelCount, 15);
});
test("restart rejects unsupported selection and changed processes before configuration writes", async (t) => {
  const f = connectionFixture(t); const p = await f.connections.preview("codex", true);
  await assert.rejects(f.connections.apply({ ticket: p.ticket, mode: "safe", acknowledged: true, restart: true }), /重启目标/);
  assert.equal(f.config.attachCalls, 0);
  const r = fakeRestarter(); r.validate = async () => { throw Error("process changed"); };
  const g = connectionFixture(t, { restarter: r }), q = await g.connections.preview("codex", true);
  await assert.rejects(g.connections.apply({ ticket: q.ticket, mode: "safe", acknowledged: true, restart: true }), /changed/);
  assert.equal(g.config.attachCalls, 0); assert.equal(g.router.starts, 0);
});
test("restart failure reports applied configuration separately; active requests never restart", async (t) => {
  const r = fakeRestarter(); r.restart = async () => { throw Error("failed"); };
  const f = connectionFixture(t, { restarter: r }), p = await f.connections.preview("codex", true);
  const result = await f.connections.apply({ ticket: p.ticket, mode: "safe", acknowledged: true, restart: true });
  assert.equal(result.restart.ok, false); assert.equal(f.connections.enabled.codex, true); assert.match(result.message, /配置已更新.*重启未完成/);
  f.router.active.codex = 1; const q = await f.connections.preview("codex", false);
  await assert.rejects(f.connections.apply({ ticket: q.ticket, mode: "safe", acknowledged: true, restart: true }), /请求正在进行/);
});

test("preview is read-only and tickets are one-use, missing, and expiry checked", async (t) => {
  const f = connectionFixture(t);
  const before = { enabled: { ...f.connections.enabled }, revision: f.connections.revision, starts: f.router.starts, stops: f.router.stops };
  const plan = await f.connections.preview("pi", true);
  assert.deepEqual({ enabled: f.connections.enabled, revision: f.connections.revision, starts: f.router.starts, stops: f.router.stops }, before);
  await f.connections.apply({ ticket: plan.ticket, mode: "safe", acknowledged: true });
  await assert.rejects(f.connections.apply({ ticket: plan.ticket, mode: "safe", acknowledged: true }), /过期/);
  await assert.rejects(f.connections.apply({ ticket: "missing", mode: "safe", acknowledged: true }), /过期/);
  const expired = await f.connections.preview("claude", true);
  f.connections.tickets.get(expired.ticket).expires = 0;
  await assert.rejects(f.connections.apply({ ticket: expired.ticket, mode: "safe", acknowledged: true }), /过期/);
});

test("apply requires explicit acknowledgement and enabling can never terminate", async (t) => {
  const f = connectionFixture(t), plan = await f.connections.preview("pi", true);
  await assert.rejects(f.connections.apply({ ticket: plan.ticket, mode: "safe" }), /确认/);
  await assert.rejects(f.connections.apply({ ticket: plan.ticket, mode: "terminate", acknowledged: true }), /不允许终止/);
  assert.equal(f.router.starts, 0);
});

test("safe off blocks active requests, running sessions, and unverifiable identities", async (t) => {
  for (const setup of [
    (f) => { f.router.active.pi = 1; },
    (f) => { f.processes.sessions = [{ id: "p", harness: "pi", status: "running" }]; },
    (f) => { f.processes.sessions = [{ id: "p", harness: "pi", status: "unverifiable" }]; },
  ]) {
    const f = connectionFixture(t); f.connections.enabled.pi = true; setup(f);
    const plan = await f.connections.preview("pi", false);
    await assert.rejects(f.connections.apply({ ticket: plan.ticket, mode: "safe", acknowledged: true }), /请求正在进行|仍有 ASS|身份无法确认/);
    assert.equal(f.connections.enabled.pi, true);
    assert.equal(f.injections.restored.length, 0);
  }
});

test("terminate stops only selected scope and rechecks files before cleanup", async (t) => {
  const f = connectionFixture(t);
  f.connections.enabled.pi = f.connections.enabled.claude = true;
  f.processes.sessions = [
    { id: "pi-1", harness: "pi", status: "running" },
    { id: "claude-1", harness: "claude", status: "running" },
  ];
  const plan = await f.connections.preview("pi", false);
  await f.connections.apply({ ticket: plan.ticket, mode: "terminate", acknowledged: true });
  assert.deepEqual(f.processes.stopCalls, [["pi-1"]]);
  assert.deepEqual(f.injections.preflightCalls, [["pi"], ["pi"], ["pi"]]);
  assert.equal(f.connections.enabled.pi, false);
  assert.equal(f.connections.enabled.claude, true);
  assert.equal(f.router.stops, 0);
});

test("external file edits discovered after termination block restore", async (t) => {
  const f = connectionFixture(t); f.connections.enabled.pi = true;
  f.processes.sessions = [{ id: "pi-1", harness: "pi", status: "running" }];
  let calls = 0;
  f.injections.preflight = () => { if (++calls === 3) throw Error("注入文件已被外部修改"); };
  const plan = await f.connections.preview("pi", false);
  await assert.rejects(f.connections.apply({ ticket: plan.ticket, mode: "terminate", acknowledged: true }), /外部修改/);
  assert.deepEqual(f.processes.stopCalls, [["pi-1"]]);
  assert.equal(f.injections.restored.length, 0);
  assert.equal(f.connections.enabled.pi, true);
});

test("stale config ticket is rejected and launch cannot overlap a transition", async (t) => {
  const f = connectionFixture(t), plan = await f.connections.preview("codex", true);
  fs.writeFileSync(f.config.file, "# concurrent user edit\n");
  await assert.rejects(f.connections.apply({ ticket: plan.ticket, mode: "safe", acknowledged: true }), /已变化/);
  f.connections.busy = true;
  await assert.rejects(f.connections.launch(async () => "never"), /切换/);
});

test("last disconnect stops shared router; retained clients leave it running", async (t) => {
  const retained = connectionFixture(t); retained.connections.enabled.pi = retained.connections.enabled.claude = true;
  let plan = await retained.connections.preview("pi", false);
  assert.deepEqual(plan.retained, ["Claude Code"]);
  await retained.connections.apply({ ticket: plan.ticket, mode: "safe", acknowledged: true });
  assert.equal(retained.router.stops, 0);
  const last = connectionFixture(t); last.connections.enabled.pi = true;
  plan = await last.connections.preview("pi", false);
  assert.equal(plan.stopService, true);
  await last.connections.apply({ ticket: plan.ticket, mode: "safe", acknowledged: true });
  assert.equal(last.router.stops, 1);
});

test("process inspection errors never become silent success; all/quit validates scope", async (t) => {
  const f = connectionFixture(t); f.connections.enabled.pi = true; f.processes.error = "inventory unavailable";
  const plan = await f.connections.preview("all", false, true);
  assert.equal(plan.quit, true); assert.equal(plan.processError, "inventory unavailable");
  await assert.rejects(f.connections.apply({ ticket: plan.ticket, mode: "safe", acknowledged: true }), /进程身份检查失败/);
  await assert.rejects(f.connections.preview("pi", false, true), /无效/);
  await assert.rejects(f.connections.preview("all", true), /无效/);
});

function accountDir(root, harness = "pi", id = "0123456789abcdef01234567") {
  const dir = path.join(root, "clients", harness, id); fs.mkdirSync(dir, { recursive: true }); return dir;
}

test("InjectionFiles restores originals and deletes only owned generated files", (t) => {
  const root = temp(t), dir = accountDir(root), auth = path.join(dir, "auth.json"), model = path.join(dir, "models.json");
  fs.writeFileSync(auth, '{"session":"keep"}'); fs.writeFileSync(model, '{"user":true}');
  const injections = new InjectionFiles(root);
  injections.write("pi", { dir, files: [["models.json", '{"ass":1}'], ["catalog.json", '{"owned":1}']] });
  injections.restore(["pi"]);
  assert.equal(fs.readFileSync(model, "utf8"), '{"user":true}');
  assert.equal(fs.readFileSync(auth, "utf8"), '{"session":"keep"}');
  assert.equal(fs.existsSync(path.join(dir, "catalog.json")), false);
});

test("multiple injection writes retain the first baseline", (t) => {
  const root = temp(t), dir = accountDir(root), file = path.join(dir, "models.json");
  fs.writeFileSync(file, "original");
  const injections = new InjectionFiles(root);
  injections.write("pi", { dir, files: [["models.json", "first"]] });
  injections.write("pi", { dir, files: [["models.json", "second"]] });
  assert.equal(injections.entries[0].before, "original");
  injections.restore(["pi"]);
  assert.equal(fs.readFileSync(file, "utf8"), "original");
});

test("malformed journals, traversal paths, and linked account trees fail closed", (t) => {
  const malformed = temp(t); fs.writeFileSync(path.join(malformed, "route-injections.json"), "{broken");
  const bad = new InjectionFiles(malformed);
  assert.ok(bad.error); assert.throws(() => bad.write("pi", { dir: accountDir(malformed), files: [["models.json", "x"]] }), /损坏/);
  const root = temp(t), injections = new InjectionFiles(root);
  assert.throws(() => injections.target("clients/pi/../../models.json", "pi"), /不在/);
  const outside = temp(t), clients = path.join(root, "clients"); fs.mkdirSync(clients);
  fs.symlinkSync(outside, path.join(clients, "pi"), "junction");
  assert.throws(() => injections.target("clients/pi/0123456789abcdef01234567/models.json", "pi"), /链接/);
});

test("external editing blocks restore and leaves both file and journal intact", (t) => {
  const root = temp(t), dir = accountDir(root), file = path.join(dir, "models.json"), injections = new InjectionFiles(root);
  injections.write("pi", { dir, files: [["models.json", "managed"]] });
  fs.writeFileSync(file, "user edit");
  assert.throws(() => injections.restore(["pi"]), /外部修改/);
  assert.equal(fs.readFileSync(file, "utf8"), "user edit");
  assert.equal(injections.entries.length, 1);
});

test("restore rechecks each target immediately before mutation and retains conflicted ledger entry", (t) => {
  const root = temp(t), dir = accountDir(root);
  const first = path.join(dir, "models.json"), second = path.join(dir, "catalog.json");
  fs.writeFileSync(first, "first original");
  fs.writeFileSync(second, "second original");
  const injections = new InjectionFiles(root);
  injections.write("pi", { dir, files: [["models.json", "first managed"], ["catalog.json", "second managed"]] });

  const renameSync = fs.renameSync;
  t.after(() => { fs.renameSync = renameSync; });
  let edited = false;
  fs.renameSync = function interceptedRename(oldPath, newPath) {
    const result = renameSync.call(fs, oldPath, newPath);
    if (!edited && path.resolve(newPath) === path.resolve(first)) {
      edited = true;
      fs.writeFileSync(second, "second external edit");
    }
    return result;
  };

  assert.throws(() => injections.restore(["pi"]), /恢复期间注入文件被修改/);
  assert.equal(edited, true);
  assert.equal(fs.readFileSync(first, "utf8"), "first original");
  assert.equal(fs.readFileSync(second, "utf8"), "second external edit");
  assert.deepEqual(injections.entries.map((entry) => entry.relative), [
    "clients/pi/0123456789abcdef01234567/catalog.json",
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(injections.file, "utf8")).map((entry) => entry.relative), [
    "clients/pi/0123456789abcdef01234567/catalog.json",
  ]);
});

test("known legacy injection is adopted with baseline and immutable recovery backup", (t) => {
  const root = temp(t), dir = accountDir(root), file = path.join(dir, "models.json");
  const legacy = JSON.stringify({ providers: { ass: { baseUrl: "http://127.0.0.1:25819/harness/deep/v1", apiKey: "$ASS_LOCAL_TOKEN" } } });
  fs.writeFileSync(file, legacy);
  const injections = new InjectionFiles(root); injections.adoptLegacy();
  assert.equal(injections.entries.length, 1); assert.equal(injections.entries[0].before, null);
  const backups = fs.readdirSync(path.join(root, "backups")); assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(root, "backups", backups[0]), "utf8"), legacy);
  injections.restore(["pi"]); assert.equal(fs.existsSync(file), false);
});

const providers = parseImport({ providers: [{ id: "deep", name: "Deep", baseUrl: "https://example.test", apiKey: "upstream-key", models: [{ model: "chat", wireApi: "openai-chat" }] }] });
function request(port, url, options = {}) {
  return fetch(`http://127.0.0.1:${port}${url}`, options);
}

test("scoped routeConfig paths isolate pi from disabled dsh", async (t) => {
  const allowed = new Set(["pi"]), calls = [];
  const router = new Router({ getState: () => ({ providers }), allowClient: (id) => allowed.has(id), fetchUpstream: async (url) => { calls.push(url); return new Response('{"ok":true}'); } });
  await router.start(0); router.port = router.server.address().port; t.after(() => router.stop());
  const p = providers[0], pi = routeConfig("pi", p, p.models[0], "C:\\fake", router.clientToken, {}, router.port);
  const piBase = JSON.parse(pi.files[0][1]).providers.ass.baseUrl;
  assert.match(piBase, new RegExp(`/clients/pi/harness/deep/v1$`));
  const body = JSON.stringify({ model: "chat", messages: [] });
  let response = await fetch(piBase + "/chat/completions", { method: "POST", headers: { authorization: `Bearer ${router.clientToken}`, "content-type": "application/json" }, body });
  assert.equal(response.status, 200); assert.equal(calls.length, 1);
  response = await request(router.port, "/clients/dsh/harness/deep/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${router.clientToken}`, "content-type": "application/json" }, body });
  assert.equal(response.status, 503); assert.equal(calls.length, 1);
});

test("request is counted at admission while body uploads; disable gate refuses the next request without cancelling current", async (t) => {
  let enabled = true, releaseUpstream;
  const router = new Router({ getState: () => ({ providers }), allowClient: (id) => id === "pi" && enabled, fetchUpstream: () => new Promise((resolve) => { releaseUpstream = () => resolve(new Response('{"ok":true}')); }) });
  await router.start(0); router.port = router.server.address().port; t.after(() => router.stop());
  let firstError, first;
  const firstDone = new Promise((resolve) => {
    first = http.request({ host: "127.0.0.1", port: router.port, path: "/clients/pi/harness/deep/v1/chat/completions", method: "POST", headers: { authorization: `Bearer ${router.clientToken}`, "content-type": "application/json" } });
    first.on("error", (error) => { firstError = error; resolve(); });
    first.on("response", (res) => { res.resume(); res.on("end", resolve); });
    first.write('{"model":"chat","messages":[');
  });
  for (let tries = 0; router.clientActive("pi") === 0 && tries < 50; tries++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(router.clientActive("pi"), 1);
  enabled = false;
  const blocked = await request(router.port, "/clients/pi/harness/deep/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${router.clientToken}`, "content-type": "application/json" }, body: '{"model":"chat"}' });
  assert.equal(blocked.status, 503); assert.equal(router.clientActive("pi"), 1);
  first.end(']}');
  while (!releaseUpstream) await new Promise((resolve) => setImmediate(resolve));
  releaseUpstream(); await firstDone; assert.equal(firstError, undefined);
});

test("diagnostics routes require the private local probe token", async (t) => {
  const router = new Router({ getState: () => ({ providers }), allowClient: () => true, fetchUpstream: async () => new Response('{"ok":true}') });
  await router.start(0); router.port = router.server.address().port; t.after(() => router.stop());
  const body = JSON.stringify({ model: "chat", messages: [] }), headers = { authorization: `Bearer ${router.clientToken}`, "content-type": "application/json" };
  assert.equal((await request(router.port, "/diagnostics/harness/deep/v1/chat/completions", { method: "POST", headers, body })).status, 401);
  assert.equal((await request(router.port, "/diagnostics/harness/deep/v1/chat/completions", { method: "POST", headers: { ...headers, "x-ass-probe-token": router.clientToken }, body })).status, 200);
});

test("ConfigManager detach rejects changed managed blocks but preserves later user edits", (t) => {
  const root = temp(t), codex = path.join(root, "codex"), data = path.join(root, "data"); fs.mkdirSync(codex);
  const file = path.join(codex, "config.toml"); fs.writeFileSync(file, 'model = "user"\n[features]\nfoo = true\n');
  const config = new ConfigManager(codex, data, 32123); config.attach();
  let attached = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, attached.replace('name = "ASS"', 'name = "tampered"'));
  assert.throws(() => config.preflightDetach(), /管理区段已被外部修改/);
  fs.writeFileSync(file, attached.replace("foo = true", "foo = false"));
  config.detach();
  const final = fs.readFileSync(file, "utf8");
  assert.match(final, /foo = false/); assert.match(final, /model = "user"/); assert.doesNotMatch(final, /ass managed|32123/);
});
