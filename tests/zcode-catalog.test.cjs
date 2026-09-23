const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createHash } = require("node:crypto");
const { inspect } = require("../core/additional-harnesses.cjs");
const { resolve } = require("../core/zcode-catalog.cjs");
const { HarnessManager } = require("../core/harnesses.cjs");
const { modelSources } = require("../core/model-inventory.cjs");
function nativeRelease(revision = 1) {
  return { schemaVersion: 1, revision, config: {
    providerConfigRules: { templateRules: [{ templateId: "sample", config: {
      api: { type: "openai-responses", baseUrl: "https://api.example/v1" }, access: { type: "api-key" },
      builtinModelIds: ["M-1", "M-2"] } }], providerRules: [] },
    modelConfigRules: {
      modelRules: [{ modelMatch: ".*", config: { enabled: true, properties: { contextWindow: 200000,
        inputFormat: { supportsImage: false }, supportsToolCall: true }, optionSpecs: {
        maxOutputTokens: { max: 32000 }, reasoningLevel: { values: ["low", "high", "max"] } } } }],
      modelApiRules: [], providerSiteRules: [], templateModelRules: [], builtinProviderModelRules: [],
    },
  } };
}
function personal(rows = [], models = []) {
  return { schemaVersion: 1, config: { providerConfigRules: { providerRules: rows },
    modelConfigRules: { providerModelRules: models, manualProviderModelRules: [] } } };
}
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ass-zcode-catalog-")), dir = path.join(home, ".zcode/v2");
  t.after(() => { assert.equal(path.dirname(home), os.tmpdir()); fs.rmSync(home, { recursive: true, force: true }); });
  const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data)); return file; };
  const baseline = path.join(dir, "runtime/provider/bundled/zcode-builtin.json");
  const config = path.join(dir, "provider_config.json");
  const check = (options = {}) => inspect("zcode", { home, env: {}, ...options });
  return { home, dir, baseline, config, put, check };
}
const models = (snapshot) => snapshot.modelAccounts.flatMap((a) => a.declaredModels);
const api = (extra = {}) => ({ providerId: "custom", templateId: "sample", config: { access: { apiKey: "fixture-only-secret" }, ...extra } });

test("native template, regex, site, exact and personal layers merge in native order", (t) => {
  const f = fixture(t), b = nativeRelease(), m = b.config.modelConfigRules;
  m.modelRules.push({ modelMatch: "m-1", config: { properties: { contextWindow: 250000 } } });
  m.modelApiRules.push({ modelMatch: "m-1", apiTypeMatch: "openai-responses", config: { properties: { contextWindow: 300000 } } });
  m.providerSiteRules.push({ modelMatch: "M-1", baseUrlMatch: "https://api\\.example/v1", config: { properties: { contextWindow: 350000 } } });
  m.templateModelRules.push({ templateId: "sample", modelId: "M-1", config: { properties: { contextWindow: 400000 } } });
  m.builtinProviderModelRules.push({ providerId: "custom", modelId: "M-1", config: { properties: { contextWindow: 450000 } } });
  const p = personal([api({ api: { baseUrl: "https://API.EXAMPLE:443/v1/" }, personalModelIds: ["M-2", "M-3"], modelOrder: ["M-3", "M-1"] })],
    [{ providerId: "custom", modelId: "M-1", config: { properties: { contextWindow: 500000, inputFormat: { supportsImage: true } },
      optionSpecs: { reasoningLevel: { values: ["high", "max"] } } } }]);
  f.put(f.baseline, b); f.put(f.config, p);
  const result = f.check(), rows = models(result);
  assert.deepEqual(rows.map((r) => r.model), ["M-2", "M-3", "M-1"]);
  assert.equal(rows[2].contextWindow, 500000); assert.equal(rows[2].wireApi, "openai-responses");
  assert.equal(rows[2].maxOutputTokens, 32000); assert.deepEqual(rows[2].efforts, ["high", "max"]);
  assert.deepEqual(rows[2].declared, { vision: true, tools: true });
  assert.equal(result.accounts.length, 0); assert.ok(!JSON.stringify(result).includes("fixture-only-secret"));
  // Patterns only supply metadata. They never manufacture unlisted model IDs.
  assert.equal(rows.length, 3);
  p.config.modelConfigRules.providerModelRules = [];
  assert.equal(resolve(b.config, p.config, [])[0].models.find((r) => r.modelId === "M-1").config.properties.contextWindow, 450000);
});

test("unused templates, disabled/hidden providers, missing templates and disabled models stay out", (t) => {
  const f = fixture(t), b = nativeRelease(); f.put(f.baseline, b);
  assert.deepEqual(models(f.check()), []);
  const p = personal([api(), { ...api(), providerId: "off", enabled: false },
    { ...api({ visibility: "hidden" }), providerId: "hidden" }, { ...api(), providerId: "missing", templateId: "absent" }],
    [{ providerId: "custom", modelId: "M-2", config: { enabled: false } }]);
  f.put(f.config, p);
  assert.deepEqual(models(f.check()).map((r) => r.nativeProvider + "/" + r.model), ["custom/M-1"]);
  p.config.providerConfigRules.providerRules[0].config.personalModelIds = ["no-limits"];
  p.config.modelConfigRules.providerModelRules.push({ providerId: "custom", modelId: "no-limits", config: {
    properties: null, optionSpecs: { reasoningLevel: null } } });
  f.put(f.config, p);
  const unknown = models(f.check()).find((r) => r.model === "no-limits");
  assert.equal(unknown.contextWindow, null); assert.deepEqual(unknown.efforts, []);
});

test("built-in OAuth catalogs match locally detected account family without inventing accounts or entitlement", (t) => {
  const f = fixture(t), b = nativeRelease();
  b.config.providerConfigRules.providerRules = ["zai", "bigmodel"].map((accountType) => ({
    providerId: "account:" + accountType + "-start-plan", config: { builtinModelIds: ["glm-fixture"],
      access: { type: "zhipu-account", accountType, mode: "start-plan" },
      api: { type: "anthropic-messages", baseUrl: "https://zcode.z.ai/api/v1/zcode-plan/anthropic" } } }));
  f.put(f.baseline, b); assert.equal(models(f.check()).length, 0);
  f.put(path.join(f.dir, "credentials.json"), { "oauth:active_provider": "zai", "oauth:zai:access_token": "synthetic-access" });
  f.put(f.config, personal([{ providerId: "account:zai-start-plan", enabled: false, config: {} }]));
  const result = f.check();
  assert.equal(result.accounts.length, 1); assert.equal(result.accounts[0].provider, "zai");
  assert.deepEqual(models(result).map((r) => r.nativeProvider), ["account:zai-start-plan"]);
  assert.ok(!JSON.stringify(result).includes("synthetic-access"));
  assert.equal(models(result)[0].wireApi, "anthropic");
  assert.equal(models(result)[0].entitled, undefined);
  assert.equal(models(result)[0].tested, undefined);
});

test("template-based official Anthropic API keys are recognized; third-party keys are not official accounts", (t) => {
  const f = fixture(t), b = nativeRelease(), template = b.config.providerConfigRules.templateRules[0];
  template.config.api = { type: "anthropic-messages", baseUrl: "https://api.z.ai/api/anthropic" };
  template.config.access.type = "zhipu-coding-plan-api-key";
  f.put(f.baseline, b); f.put(f.config, personal([api(), { ...api({ api: { baseUrl: "https://third.example/api/anthropic" } }), providerId: "third" }]));
  const result = f.check(); assert.deepEqual(result.accounts.map((a) => a.provider), ["custom"]);
  assert.equal(models(result).length, 4); assert.ok(!JSON.stringify(result).includes("fixture-only-secret"));
});

test("Desktop chooses only its current platform, version and endpoint cache; equal revisions prefer bundled", (t) => {
  const f = fixture(t), launcher = { desktopExecutable: path.join(f.home, "install/ZCode.exe") };
  const resources = path.join(f.home, "install/resources");
  f.put(path.join(resources, "app/out/metadata/build-meta.json"), { appVersion: "3.14.0" });
  const baseline = path.join(resources, "config/provider/zcode-builtin.json"), b = nativeRelease(2);
  f.put(baseline, b); f.put(f.config, personal([api()]));
  const platform = (process.platform === "win32" ? "windows" : process.platform) + "-" +
    (process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch);
  const active = (v, origin) => path.join(f.dir, "runtime/provider", platform, v,
    "endpoint-" + createHash("sha256").update(origin).digest("hex").slice(0, 32), "zcode-builtin.json");
  const fresh = nativeRelease(3); fresh.config.providerConfigRules.templateRules[0].config.builtinModelIds = ["fresh"];
  f.put(active("3.14.0", "https://zcode.z.ai"), fresh);
  const unrelated = nativeRelease(99); unrelated.config.providerConfigRules.templateRules[0].config.builtinModelIds = ["wrong-scope"];
  f.put(active("9.99.0", "https://zcode.z.ai"), unrelated); f.put(active("3.14.0", "https://other.example"), unrelated);
  assert.deepEqual(models(f.check({ launcher })).map((r) => r.model), ["fresh"]);
  assert.deepEqual(models(f.check({ launcher, env: { ZCODE_BASE_URL: "https://custom.example/path" } })).map((r) => r.model), ["M-1", "M-2"]);
  fresh.revision = 2; f.put(active("3.14.0", "https://zcode.z.ai"), fresh);
  assert.deepEqual(models(f.check({ launcher })).map((r) => r.model), ["M-1", "M-2"]);
  f.put(active("3.14.0", "https://zcode.z.ai"), { schemaVersion: 999 });
  assert.deepEqual(models(f.check({ launcher })).map((r) => r.model), ["M-1", "M-2"]);
  fresh.revision = 4; fresh.config.modelConfigRules.modelRules[0].modelMatch = "[";
  f.put(active("3.14.0", "https://zcode.z.ai"), fresh);
  assert.deepEqual(models(f.check({ launcher })).map((r) => r.model), ["M-1", "M-2"]);
});

test("explicit built-in paths, standalone bundled copies and packaged CLI catalogs work without guessed versions", (t) => {
  const f = fixture(t), b = nativeRelease(), external = path.join(f.home, "external.json");
  f.put(external, b); f.put(f.config, personal([api()]));
  assert.equal(models(f.check({ env: { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: external } })).length, 2);
  assert.equal(models(f.check({ override: f.dir, env: { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: external } })).length, 0);
  f.put(f.baseline, b); assert.equal(models(f.check()).length, 2);
  const cli = { entryPoint: path.join(f.home, "cli/dist/zcode.cjs") }, c = nativeRelease();
  c.config.providerConfigRules.templateRules[0].config.builtinModelIds = ["cli-model"];
  f.put(path.join(f.home, "cli/dist/provider/zcode-builtin.json"), c);
  assert.deepEqual(models(f.check({ launcher: cli })).map((r) => r.model), ["cli-model"]);
});

test("invalid or pathological regex falls back to personal models and never executes option maps", (t) => {
  const f = fixture(t), b = nativeRelease(), p = personal([{ providerId: "third", config: {
    personalModelIds: ["safe"], api: { type: "openai-responses" } } }]);
  b.config.modelConfigRules.modelRules[0].config.optionSpecs.reasoningLevel.map = "throw new Error('must not execute')";
  f.put(f.baseline, b); f.put(f.config, p);
  assert.equal(models(f.check())[0].contextWindow, 200000);
  b.config.modelConfigRules.modelRules.push({ modelMatch: "[", config: {} }); f.put(f.baseline, b);
  let result = f.check(); assert.equal(models(result)[0].contextWindow, null);
  assert.ok(result.sources.some((s) => s.message.includes("结构无法识别")));
  b.config.modelConfigRules.modelRules.at(-1).modelMatch = "(a+)+";
  p.config.providerConfigRules.providerRules[0].config.personalModelIds = ["a".repeat(50) + "!"];
  f.put(f.baseline, b); f.put(f.config, p); result = f.check();
  assert.equal(models(result).length, 1); assert.ok(result.sources.some((s) => s.message.includes("超时")));
  b.schemaVersion = 2; f.put(f.baseline, b);
  assert.equal(models(f.check())[0].contextWindow, null);
});

test("HarnessManager aggregates the new directory while excluding ASS-owned injected providers", (t) => {
  const f = fixture(t), b = nativeRelease(); f.put(f.baseline, b);
  f.put(f.config, personal([api(), { ...api(), providerId: "ass-owned" }]));
  const manager = new HarnessManager(f.home, () => ({ providers: [] }), [], path.join(f.home, ".codex"),
    { home: f.home, env: {}, launchEnv: { PATH: "", USERPROFILE: f.home },
      nativeConfig: { owns: (id, file, provider) => id === "zcode" && provider === "ass-owned" } });
  const snapshot = manager.snapshot(), client = snapshot.clients.find((c) => c.id === "zcode");
  const source = modelSources({ providers: [] }, snapshot, { home: f.home, env: {} }).find((p) => p.id === "native-zcode");
  assert.equal(client.detected, true); assert.equal(source.accountCount, 0);
  assert.deepEqual(source.models.map((m) => m.nativeProvider), ["custom", "custom"]);
  assert.equal(source.models[0].contextWindow, 200000);
});
