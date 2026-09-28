const { test } = require("node:test");
const assert = require("node:assert/strict");
const { exportConfig } = require("../core/config-export.cjs");
const { normalizeProvider, parseImport } = require("../core/models.cjs");

function fixture() {
  return normalizeProvider({ id: "fixture", name: "示例", baseUrl: "https://fixture.test/v1",
    apiKey: "synthetic-secret", extraHeaders: { "x-custom-token": "synthetic-header" }, network: "direct",
    balance: { preset: "deepseek" }, models: [{ model: "example", displayName: "显示名称", wireApi: "anthropic",
      contextWindow: 123456, efforts: ["low", "max"], defaultEffort: "max", enabled: false }] });
}

test("export defaults to no API key or custom headers and retains portable settings", () => {
  const source = fixture(), before = structuredClone(source);
  const result = exportConfig([source]);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.providers[0].apiKey, "");
  assert.deepEqual(result.providers[0].extraHeaders, {});
  assert.deepEqual(result.providers[0].models, source.models);
  assert.deepEqual(result.providers[0].balance, source.balance);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-secret|synthetic-header/);
  assert.deepEqual(source, before);
  assert.deepEqual(parseImport(JSON.parse(JSON.stringify(result))), result.providers);
});

test("secret export needs explicit boolean opt-in and warning acknowledgment", () => {
  for (const options of [{ includeSecrets: true }, { includeSecrets: true, acknowledged: false }])
    assert.throws(() => exportConfig([fixture()], options), /明文/);
  for (const options of [null, { includeSecrets: "true", acknowledged: true }, { acknowledged: true }])
    assert.equal(exportConfig([fixture()], options).providers[0].apiKey, "");
  const source = fixture(), result = exportConfig([source], { includeSecrets: true, acknowledged: true });
  assert.deepEqual(parseImport(JSON.parse(JSON.stringify(result))), [source]);
  result.providers[0].extraHeaders["x-custom-token"] = "changed";
  assert.equal(source.extraHeaders["x-custom-token"], "synthetic-header");
});

test("export excludes subscription and native sources and allowlists account-free fields", () => {
  const source = fixture();
  source.oauth = { access_token: "private-oauth" };
  source.localToken = "private-router";
  source.models[0].session = "private-session";
  source.balance.key = "private-balance-key";
  const result = exportConfig([source, { id: "official" }, { id: "native-pi", readOnly: true }],
    { includeSecrets: true, acknowledged: true });
  assert.equal(result.providers.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-|oauth|localToken|session/);
});
