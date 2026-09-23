const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { inspect } = require("../core/additional-harnesses.cjs");
const { modelSources } = require("../core/model-inventory.cjs");
const { resolveNativeDiagnostic, checkNativeConnection } = require("../core/native-model-diagnostics.cjs");
const { DiagnosticHistory, diagnosticFingerprint } = require("../core/diagnostic-history.cjs");
const { modelKey } = require("../core/model-inspection.cjs");
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ass-native-check-")), env = {};
  t.after(() => { assert.equal(path.dirname(home), os.tmpdir()); fs.rmSync(home, { recursive: true, force: true }); });
  const put = (relative, data) => { const file = path.join(home, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data)); return file; };
  const client = (id) => { const state = inspect(id, { home, env }); return { id, name: id, accounts: state.accounts, modelAccounts: state.modelAccounts }; };
  const rows = (c) => modelSources({ officialModels: [], providers: [] }, { clients: [c] }, { home, env }).find((p) => p.id === "native-" + c.id).models;
  const resolve = (c, m) => resolveNativeDiagnostic(m.diagnosticProviderId, m.model, { clients: [c] }, { home, env });
  return { home, env, put, client, rows, resolve };
}
const kimi = (key = "fixture-kimi-key") => `[providers.direct]\ntype="kimi"\nbase_url="https://api.kimi.com/coding/v1"\napi_key="${key}"\n[models.sample]\nprovider="direct"\nmodel="k3-test"\n`;
const native = (id, dir, file, provider, extras = {}) => ({ id, name: id, accounts: [{ id: "credential-one", kind: "native", provider,
  authType: "api", ready: true, nativeDir: dir, sourcePath: file, ...extras }] });
const jwt = (payload) => "header." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".signature";

test("Kimi rows get isolated identities across homes, use native chat and never expose keys", (t) => {
  const f = fixture(t), file = f.put(".kimi-code/config.toml", kimi()), old = f.put(".kimi/config.toml", kimi("legacy-fixture-key"));
  const before = [file, old].map((p) => fs.readFileSync(p, "utf8")), c = f.client("kimi"), rows = f.rows(c);
  assert.equal(rows.length, 2); assert.notEqual(rows[0].diagnosticProviderId, rows[1].diagnosticProviderId);
  const contexts = rows.map((m) => f.resolve(c, m));
  assert.deepEqual(contexts.map((r) => r.provider.apiKey), ["fixture-kimi-key", "legacy-fixture-key"]);
  assert.equal(contexts[0].request.url, "https://api.kimi.com/coding/v1/chat/completions");
  assert.deepEqual(contexts[0].request.body.thinking, { type: "disabled" });
  assert.doesNotMatch(JSON.stringify(rows), /fixture.*key/);
  assert.deepEqual([file, old].map((p) => fs.readFileSync(p, "utf8")), before);
  assert.throws(() => f.resolve(c, { ...rows[0], diagnosticProviderId: "native-test:kimi:forged" }), /不存在/);
});

test("Kimi OAuth is region/file-bound, does not refresh expired tokens or follow custom origins", (t) => {
  const f = fixture(t), config = kimi().replace('api_key="fixture-kimi-key"', 'oauth={storage="file",key="oauth/kimi-code"}');
  f.put(".kimi-code/config.toml", config);
  f.put(".kimi-code/credentials/kimi-code.json", { access_token: "oauth-fixture-access", refresh_token: "fixture-refresh", expires_at: 2100000000 });
  const c = f.client("kimi"), m = f.rows(c)[0];
  assert.equal(f.resolve(c, m).request.headers.authorization, "Bearer oauth-fixture-access");
  f.env.KIMI_CODE_BASE_URL = "https://wrong.test/v1";
  assert.throws(() => f.resolve(c, m), /环境地址/); delete f.env.KIMI_CODE_BASE_URL;
  f.put(".kimi-code/credentials/kimi-code.json", { access_token: "expired", refresh_token: "fixture-refresh", expires_at: 1 });
  assert.throws(() => f.resolve(c, m), /已到期/);
  f.put(".kimi-code/config.toml", config.replace("api.kimi.com", "custom.test"));
  assert.throws(() => f.resolve(c, m), /区域/);
});

function zcode(f, providers) {
  const dir = ".zcode/v2/";
  f.put(dir + "provider_config.json", { schemaVersion: 1, config: { providerConfigRules: { providerRules: [] },
    modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] } } });
  f.put(dir + "runtime/provider/bundled/zcode-builtin.json", { schemaVersion: 1, revision: 1, config: {
    providerConfigRules: { templateRules: [], providerRules: providers.map(([id, access, baseUrl]) => ({ providerId: id,
      config: { access, api: { type: "anthropic-messages", baseUrl }, builtinModelIds: ["glm-check"] } })) },
    modelConfigRules: Object.fromEntries(["modelRules", "modelApiRules", "providerSiteRules", "templateModelRules", "builtinProviderModelRules"].map((k) => [k, []])) } });
}
test("ZCode API and OAuth Start/Coding use different native keys and correct Messages URL", (t) => {
  const f = fixture(t), api = "https://api.z.ai/api/anthropic";
  zcode(f, [["personal-api", { type: "api-key", apiKey: "api-fixture-key" }, api],
    ["account:zai-start-plan", { type: "zhipu-account", accountType: "zai", mode: "start-plan" }, "https://zcode.z.ai/api/v1/zcode-plan/anthropic"],
    ["account:zai-individual-coding-plan", { type: "zhipu-account", accountType: "zai", mode: "individual-coding-plan" }, api]]);
  const auth = { "oauth:active_provider": "zai", "oauth:zai:access_token": "oauth-business-fixture",
    "oauth:zai:user_info": JSON.stringify({ user_id: "user-one" }), zcodejwttoken: jwt({ exp: 2100000000 }),
    "account-provider:coding-plan:account:zai-individual-coding-plan:account:user-one:api-key": "coding-fixture-key" };
  f.put(".zcode/v2/credentials.json", auth);
  const c = f.client("zcode"), models = f.rows(c), targets = models.map((m) => f.resolve(c, m));
  assert.equal(models.length, 3);
  assert.deepEqual(targets.map((p) => p.provider.apiKey), ["api-fixture-key", auth.zcodejwttoken, "coding-fixture-key"]);
  assert.equal(targets[1].request.url, "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages");
  assert.equal(targets[2].request.headers["x-api-key"], "coding-fixture-key");
  assert.equal(targets[2].request.headers.authorization, "Bearer coding-fixture-key");
  delete auth["account-provider:coding-plan:account:zai-individual-coding-plan:account:user-one:api-key"];
  f.put(".zcode/v2/credentials.json", auth);
  assert.throws(() => f.resolve(c, models[2]), /当前账户/);
  auth["oauth:active_provider"] = "bigmodel"; f.put(".zcode/v2/credentials.json", auth);
  assert.throws(() => f.resolve(c, models[1]), /已变化/);
});

test("DSH reads official ref and custom provider record, pi prefers its auth record over placeholder", (t) => {
  const f = fixture(t), d = path.join(f.home, ".dsh"), file = f.put(".dsh/.credentials.yaml", "version: 1\nrefs:\n  DEEPSEEK_API_KEY: fixture-dsh\nrecords:\n  llm-pi-ai/custom:\n    kind: api-key\n    key: custom-fixture\n");
  f.put(".dsh/settings.yaml", 'llm-deepseek:\n  baseURL: https://api.deepseek.com/v1\n  models:\n    - id: deepseek-check\nllm-pi-ai:\n  providers:\n    custom:\n      baseURL: https://custom.test/v1\n      api: openai-completions\n      models:\n        - id: custom-check\n');
  const c = native("dsh", d, file, "DEEPSEEK_API_KEY");
  c.accounts.push({ ...c.accounts[0], id: "two", provider: "custom" });
  assert.deepEqual(f.rows(c).map((m) => f.resolve(c, m).provider.apiKey), ["fixture-dsh", "custom-fixture"]);
  assert.deepEqual(f.rows(c).map((m) => f.resolve(c, m).request.url), ["https://api.deepseek.com/v1/chat/completions", "https://custom.test/v1/chat/completions"]);
  const pf = f.put(".pi/agent/auth.json", { custom: { type: "api_key", key: "pi-fixture-key" } });
  f.put(".pi/agent/models.json", { providers: { custom: { baseUrl: "https://pi.test/v1", api: "openai-responses", apiKey: "$ASS_PI_AUTH_REQUIRED", models: [{ id: "pi-check" }] } } });
  const pi = native("pi", path.dirname(pf), pf, "custom"), m = f.rows(pi)[0];
  assert.equal(f.resolve(pi, m).provider.apiKey, "pi-fixture-key");
  f.put(".pi/agent/auth.json", {});
  assert.throws(() => f.resolve(pi, m), /有效原生凭据/);
});

test("OpenCode JSONC overrides cache endpoint; commands and malformed/untrusted destinations fail closed", (t) => {
  const f = fixture(t), file = f.put(".local/share/opencode/auth.json", { relay: { type: "api", key: "opencode-fixture-key" } });
  f.put(".cache/opencode/models.json", { relay: { api: "https://cache.test/v1", npm: "@ai-sdk/openai-compatible", models: { check: { id: "check", provider: { api: "https://model-cache.test/v1" } } } } });
  f.put(".config/opencode/opencode.jsonc", '{// override\n"provider":{"relay":{"options":{"baseURL":"https://config.test/v1"}}}}');
  const c = native("opencode", path.dirname(file), file, "relay"), m = f.rows(c)[0];
  assert.equal(f.resolve(c, m).request.url, "https://config.test/v1/chat/completions");
  f.put(".local/share/opencode/auth.json", { relay: { type: "api", key: "!do-not-run" } });
  assert.throws(() => f.resolve(c, m), /外部命令/);
  f.put(".local/share/opencode/auth.json", { relay: { type: "api", key: "opencode-fixture-key" } });
  f.put(".config/opencode/opencode.jsonc", { provider: { relay: { options: { baseURL: "http://remote.test/v1" } } } });
  assert.throws(() => f.resolve(c, m), /HTTPS/);
  f.put(".config/opencode/opencode.jsonc", '{"provider": broken-json');
  assert.throws(() => f.resolve(c, m), /无法读取/);
});

test("native direct checks require visible text plus protocol terminal event, keep system CA and no tools", async () => {
  for (const [protocol, events] of [
    ["openai-chat", [{ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }] }]],
    ["openai-responses", [{ type: "response.output_text.delta", delta: "OK" }, { type: "response.completed" }]],
    ["anthropic", [{ type: "content_block_delta", delta: { type: "text_delta", text: "OK" } }, { type: "message_stop" }]],
  ]) {
    const context = { request: { protocol, url: "https://unit.test/v1/check", headers: { authorization: "Bearer fixture-only" },
      body: { model: "specified-model", stream: true, messages: [{ role: "user", content: "OK" }] } } };
    const fetch = async (url, options, network) => {
      assert.equal(network, "system"); assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
      assert.equal(JSON.parse(options.body).model, "specified-model"); assert.ok(!JSON.parse(options.body).tools);
      return new Response(events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""));
    };
    assert.deepEqual(await checkNativeConnection(context, fetch), { message: "连接成功 · 完整流式响应", protocol });
    await assert.rejects(checkNativeConnection(context, async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')), /完整结束/);
    await assert.rejects(checkNativeConnection(context, async () => new Response("private-upstream-body", { status: 502 })), /^Error: HTTP 502$/);
  }
});

test("native successful result and time persist; config/key changes discard stale/in-flight results", (t) => {
  const f = fixture(t); f.put(".kimi-code/config.toml", kimi()); const c = f.client("kimi"), m = f.rows(c)[0];
  const crypto = { isEncryptionAvailable: () => true, encryptString: (v) => Buffer.from(v), decryptString: (v) => v.toString() };
  const options = { dataDir: f.home, crypto, getContext: () => f.resolve(c, m) }, history = new DiagnosticHistory(options);
  const context = f.resolve(c, m), fingerprint = diagnosticFingerprint(context);
  const result = { providerId: m.diagnosticProviderId, model: m.model, ok: true, ms: 25, time: "2026-09-23T00:00:00Z", protocol: "openai-chat" };
  assert.equal(history.record(result, fingerprint), true);
  const restored = new DiagnosticHistory(options), saved = restored.public()[modelKey(result.providerId, result.model)];
  assert.equal(saved.protocol, "openai-chat"); assert.equal(saved.message, "连接成功 · 完整流式响应");
  assert.equal(saved.time, "2026-09-23T00:00:00.000Z"); assert.doesNotMatch(JSON.stringify(saved), /fixture/);
  f.put(".kimi-code/config.toml", kimi("changed-fixture-key"));
  assert.equal(restored.record(result, fingerprint), false); assert.deepEqual(restored.public(), {});
});
