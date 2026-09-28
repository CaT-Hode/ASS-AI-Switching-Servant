const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { Store } = require("../core/store.cjs");
const { HarnessManager } = require("../core/harnesses.cjs");
const { promoteNativeApiProfile } = require("../core/native-suppliers.cjs");
const { apiIdentity } = require("../core/native-api-identity.cjs");
const { modelSources } = require("../core/model-inventory.cjs");
const crypt = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ass-catalog-refresh-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root, root, crypt);
  return { root, store };
}
test("external DSH migration reloads into both client lists; stale memory cannot overwrite it", t => {
  const { root, store } = fixture(t);
  store.updateProvider({ id: "first", baseUrl: "https://first.test", apiKey: "synthetic-first", models: [{ model: "a" }] });
  const originalState = store.state;
  assert.equal(store.reload(), false); assert.equal(store.state, originalState);
  const external = new Store(root, root, crypt);
  external.updateProvider({ id: "deepseek", name: "DeepSeek · DSH 原生", baseUrl: "https://api.deepseek.com", apiKey: "synthetic-dsh",
    models: [{ model: "deepseek-flash", wireApi: "openai-chat" }] });
  assert.throws(() => store.updateProvider({ ...store.state.providers[0], name: "stale" }), /外部更新/);
  assert.equal(store.reload(), true);
  const manager = new HarnessManager(root, () => store.state, [], root, { home: root, env: {}, launchEnv: { PATH: "" } });
  for (const id of ["codex", "claude"]) {
    const row = manager.injection(id).models.find(m => m.providerId === "deepseek");
    assert.equal(row.included, true); assert.equal(row.issue, "");
    if (id === "claude") assert.equal(row.adapter, "Messages 原生接入");
  }
  assert.equal(store.state.providers[0].name, "first");
});
test("corrupt or removed external settings retain the last good state and cannot be overwritten", t => {
  const { store } = fixture(t);
  store.save(); const old = store.state;
  fs.writeFileSync(store.file, "{");
  assert.throws(() => store.reload()); assert.equal(store.state, old);
  assert.throws(() => store.save(), /外部更新/);
  fs.unlinkSync(store.file); assert.throws(() => store.reload(), /外部移除/);
});
test("an excluded unfunded Zen key remains excluded after reload; another Zen key still imports", t => {
  const { root, store } = fixture(t);
  const profile = { name: "OpenCode Zen", baseUrl: "https://opencode.ai/zen/v1", apiKey: "synthetic-zen-zero", wireApi: "anthropic", models: [{ model: "claude-fixture" }] };
  store.state.nativeApiExclusions = [apiIdentity(profile)]; store.save();
  const loaded = new Store(root, root, crypt);
  assert.equal(promoteNativeApiProfile({ store: loaded, profile }), null);
  assert.ok(promoteNativeApiProfile({ store: loaded, profile: { ...profile, apiKey: "synthetic-zen-other" } }));
  const sources = modelSources({ providers: [], officialModels: [] }, { clients: [{ id: "opencode", accounts: [{ id: "native-zen", kind: "native", declaredModels: profile.models }] }] },
    { directories: { "native-opencode": { accounts: { "native-zen": { models: [{ model: "claude-fixture", nativeProvider: "opencode" }] } } } },
      nativeApiModels: [{ clientId: "opencode", accountId: "native-zen", nativeProvider: "opencode", model: "claude-fixture", excluded: true }] });
  assert.ok(!sources.some(s => s.id === "native-opencode"));
});
