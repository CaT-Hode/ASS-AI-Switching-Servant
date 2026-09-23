const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseImport } = require("../core/models.cjs");
const { HarnessManager, apiAccounts } = require("../core/harnesses.cjs");
const { compose, NativeConfig, locations, profileLocations } = require("../core/native-config.cjs");
const { acceptsApiAccount, modelRef } = require("../core/client-policy.cjs");
const { modelSources } = require("../core/model-inventory.cjs");
const crypt = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
function setup(t, saved) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ass-separated-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, "data"), home = path.join(root, "home");
  fs.mkdirSync(data); fs.mkdirSync(home);
  if (saved) fs.writeFileSync(path.join(data, "clients.json"), JSON.stringify(saved));
  const providers = parseImport({ providers: [
    { id: "relay", name: "OpenAI", brand: "openai", baseUrl: "https://relay.example/v1", apiKey: "synthetic-relay", models: [{ model: "one", wireApi: "openai-chat" }, { model: "two", wireApi: "anthropic" }] },
    { id: "deep", baseUrl: "https://api.deepseek.com", apiKey: "synthetic-deep", models: [] },
    { id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "synthetic-openai", models: [] },
  ] });
  const make = () => new HarnessManager(data, () => ({ providers }), [], path.join(home, ".codex"), { home, env: {}, launchEnv: { PATH: "" }, isConnected: () => true });
  const manager = make(), native = new NativeConfig(data, crypt, manager);
  manager.options.nativeConfig = native;
  return { root, data, home, providers, manager, native, make };
}
test("official account policy rejects brands, compatible relay protocols, foreign native grants and bypass calls", (t) => {
  const f = setup(t), p = f.providers[0];
  for (const id of ["codex", "claude", "dsh", "opencode", "pi"]) {
    assert.equal(acceptsApiAccount(id, p), false);
    assert.deepEqual(apiAccounts(id, [p]), []);
    assert.throws(() => f.manager.bindApi(id, p.id), /官方 API/);
    assert.throws(() => f.manager.select(id, "api:" + p.id), /账户不存在/);
  }
  assert.throws(() => f.manager.add("dsh", "fake OAuth"), /官方 API/);
  assert.throws(() => f.manager.add("codex", "fake OAuth", "openrouter"), /不支持/);
  assert.throws(() => f.manager.add("pi", "unknown", "unknown"), /已确认支持/);
  const cases = ["https://api.openai.com.evil.test/v1", "https://api.openai.com:444/v1", "https://api.openai.com/unrelated", "https://user:pass@api.openai.com/v1"];
  for (const baseUrl of cases) assert.equal(acceptsApiAccount("codex", { ...p, baseUrl }), false);
});
test("zero-model official API accounts remain ready and launch without model injection", (t) => {
  const f = setup(t);
  f.manager.options.isConnected = () => false;
  for (const [id, pid] of [["codex", "openai"], ["dsh", "deep"]]) {
    const row = apiAccounts(id, f.providers)[0];
    assert.equal(row.ready, true); assert.equal(row.models.length, 0);
    const plan = f.manager.plan(id, "api:" + pid);
    assert.equal(plan.routed, false);
    assert.equal(plan.nativeSelection, undefined);
    assert.ok(plan.files.some(([file]) => /auth.json|credentials.yaml/.test(file)));
    assert.equal(f.manager.injection(id).defaultModel, undefined);
  }
});
test("native injection uses all compatible models without accounts; selection cannot change its default", (t) => {
  const f = setup(t);
  for (const id of ["dsh", "opencode", "pi"]) {
    const plan = compose(id, f.manager);
    assert.equal(plan.modelCount, 2);
    assert.equal(plan.selected, undefined);
    assert.ok(plan.fields.length > 0);
  }
  assert.equal(f.manager.injection("claude").models.filter((m) => m.included).length, 1);
  f.manager.select("dsh", "api:deep");
  assert.equal(compose("dsh", f.manager).selected, undefined);
  f.manager.setInjection("dsh", { excludedProviders: ["relay"] });
  f.manager.bindApi("dsh", "deep", false);
  assert.equal(compose("dsh", f.manager).selected, undefined);
  assert.equal(compose("dsh", f.manager).modelCount, 0);
  assert.equal(f.make().injection("dsh").models.filter((m) => m.included).length, 0);
  f.manager.setInjection("dsh", { excludedProviders: [] });
  assert.equal(compose("dsh", f.manager).modelCount, 2);
});
test("one-time migration backs up metadata, retires model default, drops foreign account bindings, and never resurrects them", (t) => {
  const saved = { selected: { codex: "api:relay" }, apiBindings: { codex: ["relay"] }, modelSelections: { codex: { "api:relay": "one" } } };
  const f = setup(t, saved);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.data, "clients.before-account-separation.json"))), saved);
  assert.equal(f.manager.state.selected.codex, undefined);
  assert.equal(f.manager.injection("codex").defaultModel, undefined);
  assert.equal(f.manager.state.schemaVersion, 3);
  assert.equal(f.manager.state.apiBindings, undefined);
  assert.equal(f.manager.state.modelSelections, undefined);
  assert.deepEqual(f.make().state.accountBindings.codex, []);
  assert.equal(f.providers[0].apiKey, "synthetic-relay");
  assert.equal(fs.readdirSync(f.home).length, 0);
});
test("foreign native API models survive account-card filtering and empty injection cannot report success", (t) => {
  const f = setup(t), dir = path.join(f.home, ".pi", "agent");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ custom: { type: "api_key", key: "synthetic-native" } }));
  fs.writeFileSync(path.join(dir, "models.json"), JSON.stringify({ providers: { custom: { api: "openai-completions", models: [{ id: "native-only" }] } } }));
  const snapshot = f.manager.snapshot();
  assert.equal(snapshot.clients.find((c) => c.id === "pi").accounts.length, 0);
  const sources = modelSources({ officialModels: [], providers: f.providers }, snapshot);
  assert.ok(sources.find((p) => p.id === "native-pi").models.some((m) => m.model === "native-only"));
  for (const p of f.providers) p.models = [];
  f.manager.options.isConnected = () => false;
  assert.throws(() => f.native.sync("pi"), /没有可接入/);
  assert.equal(f.native.status("pi", true).applied, false);
});
test("native disconnect restores owned fields without touching official or foreign auth records", (t) => {
  const f = setup(t), target = locations("dsh", f.manager);
  fs.mkdirSync(path.dirname(target.auth), { recursive: true });
  const original = "version: 1\nrefs:\n  DEEPSEEK_API_KEY: synthetic-official\nrecords:\n  llm-pi-ai/openai-codex:\n    kind: grant\n    payload: { type: oauth, access: synthetic-access, refresh: synthetic-refresh }\n";
  fs.writeFileSync(target.auth, original);
  f.native.sync("dsh");
  f.native.restore(["dsh"]);
  const restored = require("yaml").parse(fs.readFileSync(target.auth, "utf8"));
  assert.equal(restored.refs.DEEPSEEK_API_KEY, "synthetic-official");
  assert.equal(restored.records["llm-pi-ai/openai-codex"].payload.refresh, "synthetic-refresh");
  assert.equal(Object.keys(restored.records).length, 1);
});
test("isolated official account homes inherit model injection without rewriting existing windows; disconnect keeps account keys", (t) => {
  const f = setup(t), yaml = require("yaml");
  f.native.sync("dsh");
  const globalFile = locations("dsh", f.manager).config;
  const globalBefore = fs.readFileSync(globalFile);
  const plan = f.manager.plan("dsh", "api:deep");
  f.manager.materialize(plan);
  const target = profileLocations("dsh", plan.dir);
  const first = fs.readFileSync(target.config);
  let auth = yaml.parse(fs.readFileSync(target.auth, "utf8"));
  assert.equal(auth.refs.DEEPSEEK_API_KEY, "synthetic-deep");
  assert.equal(Object.keys(auth.records).length, 2);
  f.manager.materialize(plan);
  assert.deepEqual(fs.readFileSync(target.config), first);
  assert.deepEqual(fs.readFileSync(globalFile), globalBefore);
  assert.equal(f.native.status("dsh", true).pending, false);
  f.providers[0].models[0].displayName = "pending edit";
  const next = { ...f.providers[1], id: "deep-two", apiKey: "synthetic-deep-two" };
  f.providers.push(next);
  const second = f.manager.plan("dsh", "api:deep-two");
  f.manager.materialize(second);
  assert.deepEqual(fs.readFileSync(profileLocations("dsh", second.dir).config), first);
  assert.deepEqual(fs.readFileSync(target.config), first);
  assert.deepEqual(fs.readFileSync(globalFile), globalBefore);
  assert.equal(f.native.status("dsh", true).pending, true);
  f.manager.materialize(plan);
  assert.deepEqual(fs.readFileSync(target.config), first);
  f.native.sync("dsh");
  assert.equal(f.native.status("dsh", true).pending, false);
  const restarted = f.make(), native = new NativeConfig(f.data, crypt, restarted);
  assert.equal(native.status("dsh", true).pending, false);
  native.restore(["dsh"]);
  auth = yaml.parse(fs.readFileSync(target.auth, "utf8"));
  assert.equal(auth.refs.DEEPSEEK_API_KEY, "synthetic-deep");
  assert.equal(auth.version, 1);
  assert.equal(Object.keys(auth.records || {}).length, 0);
  const auth2 = yaml.parse(fs.readFileSync(profileLocations("dsh", second.dir).auth, "utf8"));
  assert.equal(auth2.refs.DEEPSEEK_API_KEY, "synthetic-deep-two");
});
test("API-only Codex model windows cannot advertise subscription fallback or select an account", (t) => {
  const f = setup(t);
  f.manager.officialModels = [{ slug: "official-subscription", display_name: "Official" }];
  const plan = f.manager.modelPlan("codex", modelRef("relay", "one"), "synthetic-local-token");
  const catalog = JSON.parse(plan.files.find(([name]) => name === "catalog.json")[1]);
  assert.ok(catalog.models.every((m) => m.slug.includes("::")));
  assert.equal(f.manager.state.selected.codex, undefined);
  assert.equal(plan.env.OPENAI_API_KEY, undefined);
});
test("a reused official API home cannot silently launch with credentials changed by the client", (t) => {
  const f = setup(t);
  f.manager.options.isConnected = () => false;
  const plan = f.manager.plan("codex", "api:openai");
  f.manager.materialize(plan);
  const file = path.join(plan.dir, "auth.json");
  const changed = JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "synthetic-other-account" } });
  fs.writeFileSync(file, changed);
  assert.throws(() => f.manager.materialize(plan), /凭据已被客户端更改/);
  assert.equal(fs.readFileSync(file, "utf8"), changed);
  f.providers.push({ ...f.providers[1], id: "go", baseUrl: "https://opencode.ai/zen/go/v1", apiKey: "synthetic-go" });
  for (const [harness, account] of [["dsh", "api:deep"], ["opencode", "api:go"]]) {
    const plan = f.manager.plan(harness, account);
    f.manager.materialize(plan);
    const file = path.join(plan.dir, plan.credentialCheck.file), before = "{}";
    fs.writeFileSync(file, before);
    assert.throws(() => f.manager.materialize(plan), /凭据已被客户端更改/);
    assert.equal(fs.readFileSync(file, "utf8"), before);
  }
});

test("corrupt or future client settings fail closed without migration or overwriting", (t) => {
  const f = setup(t), file = path.join(f.data, "clients.json");
  for (const value of ["{broken", JSON.stringify({ schemaVersion: 8 }), JSON.stringify({ accountBindings: { codex: {} } }), JSON.stringify({ profiles: [{ harness: "pi", id: "../escape" }] })]) {
    fs.writeFileSync(file, value);
    assert.throws(f.make, /配置损坏或版本不兼容/);
    assert.equal(fs.readFileSync(file, "utf8"), value);
    assert.equal(fs.existsSync(path.join(f.data, "clients.before-account-separation.json")), false);
  }
});

test("v2 ignores leftover legacy bindings, and unsupported native reasoning never launches silently", (t) => {
  const f = setup(t, { schemaVersion: 2, apiBindings: { codex: ["openai"] } });
  assert.deepEqual(f.manager.state.accountBindings.codex, []);
  f.providers[0].models[0].defaultEffort = "ultra";
  for (const id of ["dsh", "pi"])
    assert.throws(() => f.manager.modelPlan(id, modelRef("relay", "one")), /原生思维强度/);
});

test("Claude account launches fail on conflicting settings without running helpers or overwriting credentials", (t) => {
  const f = setup(t), account = f.manager.add("claude", "Official Claude");
  const plan = f.manager.plan("claude", account);
  const file = path.join(plan.dir, "settings.json");
  const text = JSON.stringify({ apiKeyHelper: "never execute this" });
  fs.writeFileSync(file, text);
  assert.throws(() => f.manager.materialize(plan), /覆盖项/);
  assert.equal(fs.readFileSync(file, "utf8"), text);
  fs.writeFileSync(file, "{}");
  fs.writeFileSync(path.join(plan.dir, ".credentials.json"), JSON.stringify({ primaryApiKey: "synthetic-conflicting-key" }));
  assert.throws(() => f.manager.materialize(plan), /同时存在 OAuth/);
});
test("model launch preserves shared defaults and refuses to implicitly apply a pending catalog", (t) => {
  const f = setup(t);
  for (const id of ["pi", "opencode", "dsh"]) {
    f.native.sync(id);
    const target = locations(id, f.manager), before = fs.readFileSync(target.config);
    const plan = f.manager.modelPlan(id, modelRef("relay", "one"));
    f.manager.materialize(plan);
    assert.deepEqual(fs.readFileSync(target.config), before);
    assert.equal(f.manager.injection(id).defaultModel, undefined);
    if (id === "dsh") {
      assert.ok(plan.args.includes("--patch"));
      const patch = JSON.parse(fs.readFileSync(plan.args.at(-1)));
      assert.equal(patch[0].id, "settings");
      assert.equal(JSON.parse(fs.readFileSync(patch[0].config.path))["agent-default-model"].model, "one");
      assert.equal(plan.env.DSH_HOME, target.dir);
    }
    f.providers[0].models[0].displayName += " changed";
    assert.throws(() => f.manager.materialize(plan), /尚未同步/);
    assert.deepEqual(fs.readFileSync(target.config), before);
  }
});
