const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { normalizeOAuth, oauthTransferCompatibility, enumerateSources, piOAuthProviders } = require("../core/oauth-import.cjs");
const { HarnessManager } = require("../core/harnesses.cjs");

const CLIENT = "app_EMoamEEZ73f0CkXaXp7hrann";
const supported = [{ id: "openai-codex", name: "OpenAI Codex (legacy)" }, { id: "openai", name: "OpenAI" }, { id: "anthropic", name: "Anthropic" }];
const jwt = (claims) => "synthetic." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".signature";
const legacyAccess = (claims = {}) => jwt({ exp: 2000000000, iss: "https://auth.openai.com", client_id: CLIENT,
  aud: ["https://api.openai.com/v1"], "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-workspace" }, ...claims });
const codex = (tokens = {}, root = {}) => ({ auth_mode: "chatgpt", tokens: {
  access_token: legacyAccess(), refresh_token: "synthetic-refresh-secret", account_id: "synthetic-workspace", ...tokens }, ...root });
const opencode = (extra = {}) => ({ type: "oauth", access: legacyAccess(), refresh: "synthetic-refresh-secret",
  expires: 2000000000000, accountId: "synthetic-workspace", ...extra });
const planGrant = () => opencode({ clientId: "oaiapp_synthetic_pi", scopes: ["offline_access", "resource.invoke", "chatgpt.tokens.use.direct"],
  access: jwt({ exp: 2000000000, iss: "https://auth.openai.com", aud: "https://api.openai.com/v1", client_id: "oaiapp_synthetic_pi",
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    "https://api.openai.com/auth": { per_user_salt: "synthetic-salt", encrypted_auth_metadata: "synthetic-private-metadata" } }) });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ass-oauth-transfer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data)); return file; };
  return { root, put };
}

test("legacy Codex and OpenCode formats remain compatible only with pi openai-codex", () => {
  for (const [kind, data, provider] of [["codex", codex()], ["opencode", { openai: opencode() }, "openai"],
    ["opencode", { "openai-codex": opencode() }, "openai-codex"]]) {
    const normalized = normalizeOAuth(kind, data, provider, "openai-codex");
    assert.equal(normalized.provider, "openai-codex");
    assert.equal(normalized.record.refresh, "synthetic-refresh-secret");
    assert.equal(normalized.record.accountId, "synthetic-workspace");
    const status = oauthTransferCompatibility(kind, data, provider, { supported });
    assert.equal(status.compatible, true);
    assert.equal(status.grantType, "codex-legacy");
    assert.equal(status.verification, "format-only");
    assert.equal(status.refreshRotationRisk, true);
    assert.match(status.warning, /refresh grant/);
    assert.throws(() => normalizeOAuth(kind, data, provider, "openai"), { code: "provider_grant_mismatch" });
  }
});

test("historical Codex file evidence and historical OpenCode JWT evidence do not need newly added metadata", () => {
  const old = jwt({ exp: 2000000000, "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-workspace" } });
  assert.equal(normalizeOAuth("codex", codex({ access_token: old }, { auth_mode: undefined })).provider, "openai-codex");
  assert.equal(normalizeOAuth("opencode", { openai: opencode({ access: old, accountId: undefined }) }, "openai").record.accountId, "synthetic-workspace");
  assert.throws(() => normalizeOAuth("codex", codex({ access_token: jwt({ exp: 2000000000 }) })), { code: 'oauth_access_account_missing' });
});

test("new SIWC grants are refused rather than losing issued client, scopes or host metadata", () => {
  const grant = planGrant();
  const original = JSON.stringify(grant);
  for (const provider of ["openai", "openai-codex"]) {
    assert.throws(() => normalizeOAuth("opencode", { [provider]: grant }, provider), { code: "chatgpt_plan_login_required" });
    const status = oauthTransferCompatibility("opencode", { [provider]: grant }, provider, { supported });
    assert.equal(status.compatible, false);
    assert.equal(status.grantType, "chatgpt-plan");
    assert.equal(status.requiresLogin, true);
    assert.match(status.reason, /重新登录 openai/);
    assert.equal(status.provider, "openai");
    for (const secret of [grant.access, grant.refresh, "synthetic-private-metadata", "oaiapp_synthetic_pi", "synthetic-workspace"])
      assert.ok(!JSON.stringify(status).includes(secret));
  }
  assert.equal(JSON.stringify(grant), original);
  assert.throws(() => normalizeOAuth("codex", codex({ access_token: grant.access })), { code: "chatgpt_plan_login_required" });
});

test("individual new-flow markers cannot be stripped to force a legacy copy", () => {
  for (const marker of [{ clientId: "oaiapp_synthetic" }, { client_id: "dynamic_agent_client" },
    { scope: "openid chatgpt.tokens.use.direct" }, { scopes: ["resource.invoke"] }, { ext_agent_host_id: "urn:uuid:synthetic-host" },
    { access: legacyAccess({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-workspace", encrypted_auth_metadata: "synthetic-encrypted" } }) }]) {
    assert.throws(() => normalizeOAuth("opencode", { openai: opencode(marker) }, "openai"), { code: "chatgpt_plan_login_required" });
  }
});

test("foreign clients, issuers, resources, inconsistent accounts and unproven OpenCode grants fail closed", () => {
  for (const [grant, code] of [[opencode({ clientId: "app_other_client" }), "oauth_client_mismatch"],
    [opencode({ id_token: jwt({ aud: "app_other_client" }) }), "oauth_client_mismatch"],
    [opencode({ access: legacyAccess({ client_id: "app_other_client" }) }), "oauth_client_mismatch"],
    [opencode({ access: legacyAccess({ iss: "https://other.test" }) }), "oauth_issuer_mismatch"],
    [opencode({ access: legacyAccess({ aud: "https://other.test/v1" }) }), "oauth_resource_mismatch"],
    [opencode({ resource: "https://other.test/v1" }), "oauth_resource_mismatch"],
    [opencode({ accountId: "different-workspace" }), "oauth_account_mismatch"],
    [opencode({ access: "opaque-or-invalid" }), "oauth_grant_unknown"]]) {
    assert.throws(() => normalizeOAuth("opencode", { openai: grant }, "openai"), { code });
    assert.equal(oauthTransferCompatibility("opencode", { openai: grant }, "openai").reasonCode, code);
  }
  assert.throws(() => normalizeOAuth("codex", codex({}, { auth_mode: "apikey", OPENAI_API_KEY: "synthetic-api-key" })), { code: "oauth_auth_mode_mismatch" });
  assert.throws(() => normalizeOAuth("codex", codex({}, { auth_mode: "chatgptAuthTokens" })), { code: "oauth_auth_mode_mismatch" });
  for (const input of [{ OPENAI_API_KEY: "synthetic-api-key" }, null, [], codex({ refresh_token: " " }), codex({ access_token: "malformed" })])
    assert.equal(oauthTransferCompatibility("codex", input).compatible, false);
  for (const expires of [NaN, Infinity, 9e15, 100])
    assert.throws(() => normalizeOAuth("opencode", { openai: opencode({ expires }) }, "openai"));
});

test("pi supporting only new openai does not make legacy Codex transferable; expired copies never trigger refresh", () => {
  const status = oauthTransferCompatibility("codex", codex(), undefined, { supported: [{ id: "openai" }] });
  assert.equal(status.compatible, false);
  assert.equal(status.reasonCode, "provider_not_supported");
  const unknown = oauthTransferCompatibility("opencode", { openai: opencode({ access: jwt({ exp: 2000000000 }) }) }, "openai",
    { supported: [{ id: "openai" }] });
  assert.equal(unknown.compatible, false);
  assert.equal(unknown.reasonCode, "oauth_grant_unknown");
  assert.throws(() => normalizeOAuth("opencode", { openai: opencode({ access: "opaque-legacy", clientId: CLIENT }) }, "openai"), { code: 'oauth_access_account_missing' });
  const expired = oauthTransferCompatibility("codex", codex({ access_token: legacyAccess({ exp: 1500000000 }) }), undefined, { supported });
  assert.equal(expired.compatible, true);
  assert.equal(expired.expired, true);
  assert.equal(expired.verification, "format-only");
});

test("source inventory retains blocked reasons and unrelated providers without modifying credentials", (t) => {
  const f = fixture(t), codexDir = path.join(f.root, ".codex"), file = f.put(path.join(f.root, ".local/share/opencode/auth.json"), {
    openai: planGrant(), anthropic: { type: "oauth", access: "synthetic-claude-access", refresh: "synthetic-claude-refresh", expires: 2000000000000 },
    "unrelated-api": { type: "api", key: "synthetic-unrelated-secret" },
  });
  f.put(path.join(codexDir, "auth.json"), codex());
  const before = fs.readFileSync(file, "utf8");
  const rows = enumerateSources(codexDir, f.root, [], () => { throw Error("unexpected profile read"); }, supported);
  const blocked = rows.find((s) => s.id === "local-opencode:openai");
  assert.equal(blocked.reasonCode, "chatgpt_plan_login_required");
  assert.equal(blocked.compatible, false);
  assert.equal(rows.find((s) => s.id === "local-opencode:anthropic").compatible, true);
  assert.equal(rows.find((s) => s.id === "local-codex").compatible, true);
  assert.equal(rows.some((s) => s.sourceProvider === "unrelated-api"), false);
  for (const secret of ["synthetic-refresh-secret", "synthetic-unrelated-secret", "synthetic-private-metadata", "synthetic-claude-refresh"])
    assert.ok(!JSON.stringify(rows).includes(secret));
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("existing import method rejects new grants before creating profiles and preserves all native accounts", (t) => {
  const f = fixture(t), codexDir = path.join(f.root, ".codex"), source = f.put(path.join(codexDir, "auth.json"), codex());
  const piFile = f.put(path.join(f.root, ".pi/agent/auth.json"), { openai: planGrant(), unrelated: { type: "api_key", key: "synthetic-native-key" } });
  const ocFile = f.put(path.join(f.root, ".local/share/opencode/auth.json"), { openai: planGrant(), unrelated: { type: "api", key: "synthetic-oc-key" } });
  const configs = [f.put(path.join(codexDir, "config.toml"), '# user config\nmodel_provider = "custom"\n'),
    f.put(path.join(f.root, ".pi/agent/settings.json"), '{"defaultProvider":"openai","deviceId":"synthetic-original-device"}'),
    f.put(path.join(f.root, ".config/opencode/opencode.json"), '{"plugin":["user-plugin"],"model":"openai/user-model"}')];
  const manager = new HarnessManager(path.join(f.root, "ass"), () => ({ providers: [] }), [], codexDir,
    { home: f.root, env: {}, launchEnv: { PATH: "", USERPROFILE: f.root, LOCALAPPDATA: path.join(f.root, "local") } });
  manager.piProviders = supported;
  const originals = [source, piFile, ocFile, ...configs].map((p) => fs.readFileSync(p, "utf8"));
  assert.throws(() => manager.importOAuth("local-opencode:openai", "blocked"));
  assert.equal(manager.state.profiles.length, 0);
  assert.equal(fs.existsSync(path.join(manager.dataDir, "clients")), false);
  const first = manager.importOAuth("local-codex", "legacy one"), second = manager.importOAuth("local-codex", "legacy two");
  assert.notEqual(first, second);
  assert.equal(manager.state.profiles.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(manager.root("pi", first), "auth.json")))["openai-codex"].refresh, "synthetic-refresh-secret");
  const snapshot = JSON.stringify(manager.snapshot());
  assert.match(snapshot, /chatgpt_plan_login_required/);
  for (const secret of ["synthetic-refresh-secret", "synthetic-native-key", "synthetic-oc-key", "synthetic-private-metadata"])
    assert.ok(!snapshot.includes(secret));
  [source, piFile, ocFile, ...configs].forEach((p, i) => assert.equal(fs.readFileSync(p, "utf8"), originals[i]));
});

test("changed source grants are rechecked at import time and do not overwrite an existing managed profile", (t) => {
  const f = fixture(t), codexDir = path.join(f.root, ".codex"), file = f.put(path.join(codexDir, "auth.json"), codex());
  const manager = new HarnessManager(path.join(f.root, "ass"), () => ({ providers: [] }), [], codexDir, { home: f.root, env: {}, launchEnv: { PATH: "" } });
  manager.piProviders = supported;
  const id = manager.importOAuth("local-codex", "keep"), imported = path.join(manager.root("pi", id), "auth.json"), before = fs.readFileSync(imported, "utf8");
  assert.equal(manager.oauthSources().find((s) => s.id === "local-codex").compatible, true);
  const originalSources = manager.oauthSources.bind(manager);
  manager.oauthSources = () => {
    const sources = originalSources();
    // Simulate native login/refresh replacing the file after enumeration, before
    // importOAuth's second read; the stale compatible snapshot must not suffice.
    f.put(file, codex({ access_token: planGrant().access }));
    return sources;
  };
  assert.throws(() => manager.importOAuth("local-codex", "changed"), { code: "chatgpt_plan_login_required" });
  assert.equal(manager.state.profiles.length, 1);
  assert.equal(fs.readFileSync(imported, "utf8"), before);
});

function piPackage(f, pkg, exports, files) {
  const base = path.join(f.root, "node_modules", pkg);
  f.put(path.join(base, "package.json"), { name: pkg, type: "module", exports });
  for (const [file, content] of Object.entries(files)) f.put(path.join(base, file), content);
  return path.join(f.root, "cli.cjs");
}
test("pi capability discovery handles the historical runtime OAuth export", async (t) => {
  const f = fixture(t), entry = piPackage(f, "@mariozechner/pi-ai", { "./oauth": { import: "./dist/oauth.js" } }, {
    "dist/oauth.js": 'export function getOAuthProviders() { return [{id:"openai-codex",name:"Legacy",access:"synthetic-must-not-leak"}]; }',
  });
  assert.deepEqual(await piOAuthProviders(entry), [{ id: "openai-codex", name: "Legacy" }]);
});
test("pi 0.99 capability discovery uses provider declarations without invoking auth or network methods", async (t) => {
  const f = fixture(t), entry = piPackage(f, "@earendil-works/pi-ai", { "./oauth": { import: "./dist/oauth.js" }, "./providers/*": { import: "./dist/providers/*.js" } }, {
    "dist/oauth.js": "export {};",
    "dist/providers/all.js": `const fail = () => { throw Error("login/refresh/toAuth/network must never run during inventory"); };
      export function builtinProviders() { return [
        {id:"openai",name:"OpenAI",auth:{oauth:{login:fail,refresh:fail,toAuth:fail}}},
        {id:"openai-codex",name:"OpenAI Codex (legacy)",auth:{oauth:{login:fail,refresh:fail,toAuth:fail}}},
        {id:"unrelated-api",name:"API",auth:{apiKey:{resolve:fail}},refreshModels:fail}
      ]; }`,
  });
  assert.deepEqual(await piOAuthProviders(entry), [{ id: "openai", name: "OpenAI" }, { id: "openai-codex", name: "OpenAI Codex (legacy)" }]);
});
test("missing, malformed and escaping pi package exports never imply OAuth support", async (t) => {
  assert.deepEqual(await piOAuthProviders(""), []);
  for (const exports of [{}, { "./oauth": { import: "../../../outside.js" } }, { "./oauth": { import: "./missing.js" } }]) {
    const f = fixture(t), entry = piPackage(f, "@earendil-works/pi-ai", exports, {});
    assert.deepEqual(await piOAuthProviders(entry), []);
  }
});
