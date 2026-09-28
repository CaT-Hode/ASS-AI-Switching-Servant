// Packaged main-process integration, with disposable native homes and no network.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict");
const { version } = require("../package.json");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ass-native-api-qa-"));
const executablePath = path.resolve(__dirname, `../release/v${version}/ASS-win32-x64/ASS.exe`);
const launch = () => electron.launch({ executablePath, args: ["--qa"], env: { ...process.env,
  ASS_TEST_DATA: root, ASS_TEST_CODEX: path.join(root, "codex"), ASS_TEST_PORT: "25824" }, timeout: 60000 });
(async () => {
  let app;
  try {
    app = await launch(); await (await app.firstWindow()).waitForSelector("h1");
    const result = await app.evaluate(async () => {
      const fs = process.getBuiltinModule("fs"), path = process.getBuiltinModule("path"), { store, harnesses, nativeConfig } = global.assTest;
      const home = harnesses.nativeHome;
      if (!home.startsWith(process.env.ASS_TEST_DATA + path.sep)) throw Error("Non-test native home");
      const put = (relative, value) => { const file = path.join(home, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
      let requests = 0;
      global.assTest.setFetch(async () => { requests++; throw Error("Network prohibited in native discovery QA"); });
      put(".dsh/settings.yaml", { "llm-pi-ai": { providers: { relay: { baseURL: "https://native-qa.example/v1", api: "openai-completions", apiKey: "qa-synthetic-a", models: [{ id: "demo" }] } } } });
      put(".pi/agent/models.json", { providers: { relay: { baseUrl: "https://native-qa.example/v1", api: "openai-completions", apiKey: "qa-synthetic-a", models: [{ id: "demo" }] } } });
      put(".config/opencode/opencode.json", { provider: { relay: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://native-qa.example/v1", apiKey: "qa-synthetic-a" }, models: { demo: {} } } } });
      await global.assTest.syncNativeSuppliers();
      const first = store.state.providers[0];
      if (store.state.providers.length !== 1) throw Error("Shared native API did not merge");
      store.updateProvider({ ...first, id: "other-key", apiKey: "qa-synthetic-b" });
      const rows = [];
      for (const id of ["dsh", "opencode", "pi"]) {
        const models = harnesses.injection(id).models;
        rows.push({ id, nativeExcluded: models.some((m) => m.providerId === first.id && m.native && !m.included),
          otherIncluded: models.some((m) => m.providerId === "other-key" && m.included) });
        nativeConfig.sync(id);
      }
      await global.assTest.syncNativeSuppliers();
      const publicState = global.assTest.snapshot();
      return { rows, count: store.state.providers.length, requests,
        leaked: JSON.stringify(publicState).includes("qa-synthetic"),
        duplicateNativeCards: publicState.modelSources.filter((s) => ["native-dsh", "native-pi", "native-opencode"].includes(s.id)).length };
    });
    assert.equal(result.count, 2); assert.equal(result.requests, 0); assert.equal(result.leaked, false);
    assert.equal(result.duplicateNativeCards, 0);
    assert.ok(result.rows.every((r) => r.nativeExcluded && r.otherIncluded));
    await app.close(); app = await launch(); await (await app.firstWindow()).waitForSelector("h1");
    const persisted = await app.evaluate(() => ({ count: global.assTest.store.state.providers.length,
      injected: ["dsh", "opencode", "pi"].map((id) => global.assTest.harnesses.injection(id).models.filter((m) => m.included).length) }));
    assert.equal(persisted.count, 2); assert.deepEqual(persisted.injected, [1, 1, 1]);
    console.log(JSON.stringify({ version, aggregation: "passed", currentKeyDedup: "passed", otherKeys: "passed",
      actualNativeWrites: "passed", restartPersistence: "passed", networkRequests: result.requests }));
  } finally {
    if (app) await app.close();
    const target = fs.realpathSync(root), parent = fs.realpathSync(os.tmpdir());
    if (path.dirname(target).toLowerCase() !== parent.toLowerCase() || !path.basename(target).startsWith("ass-native-api-qa-")) throw Error("Invalid temporary QA path");
    fs.rmSync(target, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
