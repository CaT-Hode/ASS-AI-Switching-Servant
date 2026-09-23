const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parseImport } = require("../core/models.cjs");
const { HarnessManager } = require("../core/harnesses.cjs");
const { NativeConfig, locations, providerId } = require("../core/native-config.cjs");
const { Connections } = require("../core/connections.cjs");
const { InjectionFiles } = require("../core/injection-files.cjs");
const { discoverLaunchers, resolveLauncher } = require("../core/client-launcher.cjs");
const zcode = require("../core/zcode-config.cjs");
const crypt = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
function put(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
}
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function fixture(t, existing = true) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "ass-zcode-")), home = path.join(data, "home");
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const dir = path.join(home, ".zcode/v2"), file = path.join(dir, "provider_config.json"), credentials = path.join(dir, "credentials.json");
  const baseline = zcode.empty();
  baseline.config.providerConfigRules.providerRules.push({ providerId: "account:zai", enabled: true, config: {} },
    { providerId: "custom", providerName: "User", config: { personalModelIds: ["user-model"],
      api: { type: "openai-chat-completions", baseUrl: "https://user.invalid/v1" }, access: { type: "api-key", apiKey: "user-key" } } });
  baseline.config.modelConfigRules.providerModelRules.push({ providerId: "custom", modelId: "user-model", config: { properties: { contextWindow: 64000 } } });
  baseline.config.providerOrder = ["custom", "account:zai"];
  baseline.config.defaultModelSelection = { providerId: "custom", modelId: "user-model", options: { reasoningLevel: "high" } };
  if (existing) put(file, baseline);
  put(credentials, { "oauth:zai:access_token": "synthetic-oauth", "oauth:zai:refresh_token": "synthetic-refresh" });
  const providers = parseImport({ providers: [{ id: "fixture", name: "Fixture", apiKey: "synthetic-api", baseUrl: "https://fixture.invalid/v1",
    extraHeaders: { "X-Test": "synthetic-header" }, models: ["openai-chat", "openai-responses", "anthropic"].map((wireApi) => ({
      model: wireApi + "/test", wireApi, contextWindow: 128000, maxOutputTokens: 8192,
      efforts: ["low", "medium", "high", "max"], defaultEffort: "high" })) }] });
  const options = { home, env: {}, launchEnv: {}, isConnected: () => false };
  const manager = new HarnessManager(data, () => ({ providers }), [], path.join(home, ".codex"), options);
  const native = new NativeConfig(data, crypt, manager); options.nativeConfig = native;
  return { data, home, dir, file, credentials, baseline, providers, options, manager, native };
}

test("ZCode writes separate protocol rules and retains OAuth, defaults and user metadata through synchronization and withdrawal", (t) => {
  const f = fixture(t), p = f.providers[0], token = fs.readFileSync(f.credentials, "utf8");
  f.native.sync("zcode");
  let result = read(f.file), rows = result.config.providerConfigRules.providerRules;
  assert.equal(rows.length, 5);
  for (const [wire, type] of [["openai-chat", "openai-chat-completions"], ["openai-responses", "openai-responses"], ["anthropic", "anthropic-messages"]]) {
    const id = providerId(p, wire), row = rows.find((r) => r.providerId === id);
    assert.equal(row.config.api.type, type); assert.equal(row.config.api.baseUrl, "https://fixture.invalid/v1");
    assert.equal(row.config.access.apiKey, "synthetic-api");
    const model = result.config.modelConfigRules.providerModelRules.find((r) => r.providerId === id);
    assert.deepEqual(model.config.optionSpecs.reasoningLevel.values, ["low", "medium", "high", "max"]);
    assert.equal(model.config.properties.contextWindow, 128000);
    assert.equal(model.config.optionSpecs.maxOutputTokens.max, 8192);
  }
  assert.deepEqual(result.config.defaultModelSelection, f.baseline.config.defaultModelSelection);
  const snapshot = f.manager.snapshot().clients.find((c) => c.id === "zcode");
  assert.equal(snapshot.accounts.length, 1); assert.equal(snapshot.injection.models.length, 3);
  assert.equal(snapshot.modelAccounts.flatMap((a) => a.declaredModels || []).length, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /synthetic-(?:api|oauth|refresh|header)/);
  // Model edits update the same identity rather than creating a second rule.
  p.models[0].contextWindow = 192000; f.native.sync("zcode");
  result = read(f.file);
  assert.equal(result.config.modelConfigRules.providerModelRules.find((r) => r.modelId === "openai-chat/test").config.properties.contextWindow, 192000);
  const restarted = new NativeConfig(f.data, crypt, f.manager); restarted.restore(["zcode"]);
  assert.deepEqual(read(f.file), f.baseline); assert.equal(fs.readFileSync(f.credentials, "utf8"), token);
});

test("ZCode native reordering and added user rules survive provider changes and disconnect", (t) => {
  const f = fixture(t); f.native.sync("zcode");
  let data = read(f.file);
  const added = { providerId: "user-new", providerName: "Added outside ASS", config: {} };
  data.config.providerConfigRules.providerRules.reverse(); data.config.providerConfigRules.providerRules.unshift(added);
  data.config.modelConfigRules.providerModelRules.reverse(); put(f.file, data);
  f.providers[0].models[0].contextWindow = 256000; f.native.sync("zcode");
  data = read(f.file); assert.deepEqual(data.config.providerConfigRules.providerRules[0], added);
  f.manager.setInjection("zcode", { excludedProviders: [f.providers[0].id] });
  f.native.sync("zcode"); f.native.restore(["zcode"]);
  data = read(f.file);
  assert.deepEqual(data.config.providerConfigRules.providerRules, [added, ...f.baseline.config.providerConfigRules.providerRules.toReversed()]);
  assert.deepEqual(data.config.modelConfigRules, f.baseline.config.modelConfigRules);
});

test("ZCode new configuration keeps a valid empty schema after withdrawing ASS rules", (t) => {
  const f = fixture(t, false);
  f.native.sync("zcode"); zcode.validate(read(f.file)); f.native.restore(["zcode"]);
  assert.deepEqual(read(f.file), zcode.empty());
});

test("ZCode refuses duplicate rules, external changes, unknown versions and removal of the selected default", (t) => {
  const f = fixture(t); f.native.sync("zcode"); const applied = read(f.file);
  const cases = [
    (d) => { d.schemaVersion = 2; },
    (d) => { d.config.providerConfigRules.providerRules.push(d.config.providerConfigRules.providerRules.at(-1)); },
    (d) => { d.config.providerConfigRules.providerRules.at(-1).config.access.apiKey = "external-key"; },
    (d) => { d.config.modelConfigRules.providerModelRules.push(d.config.modelConfigRules.providerModelRules.at(-1)); },
    (d) => { const row = d.config.providerConfigRules.providerRules.at(-1);
      d.config.defaultModelSelection = { providerId: row.providerId, modelId: row.config.personalModelIds[0] }; },
  ];
  for (const change of cases) {
    const data = structuredClone(applied); change(data); put(f.file, data);
    const before = fs.readFileSync(f.file, "utf8");
    assert.throws(() => f.native.restore(["zcode"]), /未覆盖|外部修改|切换模型/);
    assert.equal(fs.readFileSync(f.file, "utf8"), before);
  }
});

test("ZCode resolves explicit runtime paths and pins an applied target until disconnection", (t) => {
  const f = fixture(t);
  f.options.env.ZCODE_DATA_BASE_DIR = path.join(f.home, "custom-home");
  f.options.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = path.join(f.home, "custom-config/providers.json");
  const target = locations("zcode", f.manager); assert.equal(target.config, f.options.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE);
  f.native.sync("zcode");
  assert.throws(() => f.manager.setCredentialHome("zcode", f.home), /先断开/);
  f.options.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = path.join(f.home, "changed.json");
  assert.throws(() => f.native.sync("zcode"), /目标目录已变化/);
  f.native.restore(["zcode"]); assert.deepEqual(read(target.config), zcode.empty());
  f.manager.setCredentialHome("zcode", f.dir); assert.equal(locations("zcode", f.manager).config, f.file);
});

test("ZCode explicit connection remains native without starting the shared router", async (t) => {
  const f = fixture(t);
  put(path.join(f.data, "connections.json"), { codex: false, claude: false, opencode: false, pi: false, dsh: false, kimi: false });
  const connections = new Connections({ dataDir: f.data, nativeConfig: f.native,
    config: { status: () => ({}), file: path.join(f.home, "unused.toml") }, injections: new InjectionFiles(f.data),
    router: { clientActive: () => 0, start: async () => assert.fail("must use native config"), stop: async () => {} },
    processes: { refresh: async () => {}, snapshot: () => ({ sessions: [] }) } });
  assert.equal(connections.error, ""); assert.equal(connections.enabled.zcode, false);
  let plan = await connections.preview("zcode", true);
  await connections.apply({ ticket: plan.ticket, mode: "safe", acknowledged: true });
  assert.equal(connections.snapshot().clients.zcode.applied, true); assert.equal(connections.routerEnabled(), false);
  plan = await connections.preview("zcode", false);
  await connections.apply({ ticket: plan.ticket, mode: "safe", acknowledged: true });
  assert.equal(connections.enabled.zcode, false); assert.deepEqual(read(f.file), f.baseline);
});

test("ZCode Desktop is discovered independently from CLI without executing either", (t) => {
  const f = fixture(t), local = path.join(f.home, "AppData/Local"), folder = path.join(local, "Programs/ZCode");
  put(path.join(folder, "ZCode.exe"), "synthetic executable"); put(path.join(folder, "resources/app.asar"), "synthetic asar");
  const env = { USERPROFILE: f.home, LOCALAPPDATA: local, PATH: "" };
  const found = discoverLaunchers("zcode", env);
  assert.equal(found.length, 1); assert.equal(found[0].kind, "desktop"); assert.equal(found[0].ready, false); assert.equal(found[0].installed, true);
  assert.equal(resolveLauncher("zcode", folder, env).desktopExecutable, path.join(folder, "ZCode.exe"));
  put(path.join(f.home, "bin/zcode.exe"), "synthetic CLI");
  assert.equal(resolveLauncher("zcode", path.join(f.home, "bin/zcode.exe"), env).kind, "executable");
});

test("ZCode desktop custom data directory is discovered; distinct CLI and desktop configs require choosing a directory", (t) => {
  const f = fixture(t, false), custom = path.join(f.home, "desktop-data"), dir = path.join(custom, ".zcode/v2");
  put(path.join(f.dir, "setting.json"), { dataBaseDir: custom });
  const config = path.join(dir, "provider_config.json"); put(config, f.baseline);
  put(path.join(dir, "credentials.json"), { "oauth:bigmodel:access_token": "desktop-oauth" });
  assert.equal(locations("zcode", f.manager).config, config);
  const snapshot = f.manager.snapshot().clients.find((c) => c.id === "zcode");
  assert.ok(snapshot.accounts.some((a) => a.nativeDir === dir && a.provider === "bigmodel"));
  f.native.sync("zcode"); f.native.restore(["zcode"]); assert.deepEqual(read(config), f.baseline);
  put(f.file, f.baseline);
  assert.throws(() => f.native.sync("zcode"), /多个 ZCode 配置位置/);
  f.manager.setCredentialHome("zcode", dir); f.native.sync("zcode"); f.native.restore(["zcode"]);
  assert.deepEqual(read(f.file), f.baseline);
});
