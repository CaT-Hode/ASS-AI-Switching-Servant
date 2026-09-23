const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { AccountInfo, text } = require("../core/account-info.cjs");
const extra = require("../core/oauth-info.cjs");
const { OAuthHistory } = require("../core/oauth-history.cjs");
const { HarnessManager } = require("../core/harnesses.cjs");
const now = Date.UTC(2026, 8, 24);
const parse = (kind, section, payload) => extra.parse(kind, section, payload, { safeText: (v) => text(v, ["synthetic-token"]), now });
const fields = (rows) => Object.fromEntries(rows.map((f) => [f.id, f]));
const kimi = { id: "kimi-a", subscriptionKind: "kimi-code", baseUrl: "https://api.kimi.com/coding/v1", apiKey: "synthetic-token", network: "system" };
const identity = { user_id: "user-a", nickname: "Alice", email: "alice@example.test", user_level_name: "Allegretto", region: "REGION_CN" };
const usage = { usages: { limit_5h: { used_ratio: .25, reset_time: "2026-09-24T20:00:00Z" }, limit_7d: { used_ratio: "0.5" },
  limit_month_code: { used_ratio: 0 } }, boosterWallet: { balance: { type: "BOOSTER", amount: 500000000, amountLeft: 125000000 },
  monthlyUsed: { currency: "CNY", priceInCents: 375 }, monthlyChargeLimitEnabled: false } };
const balance = { code: 0, data: { server_time: now / 1000, plans: [
  { plan_id: "zcode-v3-start-plan", user_plan_id: "start-1", name: "ZCode V3 Start Plan", status: "active", ends_at: now / 1000 + 86400 },
  { plan_id: "old", name: "Old", status: "active", ends_at: now / 1000 - 100 }], balances: [
  { plan_id: "zcode-v3-start-plan", user_plan_id: "start-1", show_name: "GLM", total_units: 100, used_units: 20, reserved_units: 30,
    capabilities: ["tool:web", "model:glm-5.3-flash", "model:GLM-5.2"],
    remaining_units: 80, available_units: 50, unit_type: "credits", expires_at: now / 1000 + 3600 },
  { plan_id: "old", remaining_units: 999, total_units: 1000 },
  { plan_id: "orphan", remaining_units: 444, total_units: 1000 } ] } };
function fixture(t, fetcher) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ass-oauth-info-")), key = crypto.randomBytes(32);
  t.after(() => { assert.equal(path.dirname(dir), os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true }); });
  const vault = { isEncryptionAvailable: () => true,
    encryptString: (s) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv), body = Buffer.concat([c.update(s), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]); },
    decryptString: (b) => { const c = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12)); c.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(); } };
  const providers = [{ ...kimi }]; let time = now;
  const options = { dataDir: dir, crypto: vault, getProvider: (id) => providers.find((p) => p.id === id), fetcher, now: () => time };
  const put = (relative, v) => { const file = path.join(dir, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof v === "string" ? v : JSON.stringify(v)); return file; };
  return { dir, put, vault, options, providers, info: new AccountInfo(options), tick: () => { time += 16 * 60000; } };
}
test("Kimi percentages are ratios, reset timestamps and monetary units stay faithful to the wire", () => {
  const f = fields(parse("kimi-code", "usage", usage));
  assert.equal(f["quota-limit_5h"].remainingPercent, 75); assert.equal(f["quota-limit_7d"].remainingPercent, 50);
  assert.equal(f["quota-limit_month_code"].remainingPercent, 100);
  assert.equal(f["quota-limit_5h"].resetsAt, "2026-09-24T20:00:00.000Z");
  assert.equal(f["balance-booster"].value, "1.25"); assert.equal(f["balance-booster"].unit, "CNY");
  assert.equal(f["booster-used"].value, "3.75"); assert.equal(f["quota-limit_month_total"], undefined);
  assert.throws(() => parse("kimi-code", "usage", { usages: { limit_5h: { used_ratio: null } } }));
  const missing = structuredClone(usage); delete missing.boosterWallet.balance.amountLeft;
  assert.equal(fields(parse("kimi-code", "usage", missing))["balance-booster"], undefined);
});
test("remote identity exposes only documented safe fields, never arbitrary payload or secrets", () => {
  const result = fields(parse("kimi-code", "identity", { ...identity, nickname: "synthetic-token", phone: { number: "private-phone" },
    arbitrary: "private-content", avatar: "https://untrusted.example" }));
  assert.equal(result.accountId.value, "user-a"); assert.equal(result.name, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private-|untrusted|synthetic/);
  assert.throws(() => parse("kimi-code", "identity", { nickname: "Unknown" }));
});
test("ZCode uses remaining, not available, and never sums unmatched, expired or distinct quota buckets", () => {
  const f = fields(parse("zcode-start", "usage", balance));
  assert.equal(f["balance-bucket-0"].value, "80"); assert.equal(f["balance-bucket-0"].unit, "credits");
  assert.equal(f["quota-bucket-0"].remainingPercent, 80); assert.equal(f["quota-bucket-0"].resetsAt, new Date(now + 3600000).toISOString());
  assert.equal(f["balance-bucket-1"], undefined); assert.equal(f["balance-bucket-2"], undefined);
  const missing = structuredClone(balance); delete missing.data.balances[0].remaining_units;
  const result = fields(parse("zcode-start", "usage", missing));
  assert.equal(result["balance-bucket-0"], undefined); assert.equal(result["quota-bucket-0"], undefined);
  assert.equal(f["start-model-count"].value, "2 个");
  assert.equal(f["start-models"].value, "GLM-5.3-Flash · GLM-5.2");
  assert.throws(() => parse("zcode-start", "usage", { ...balance, code: 500 }));
});
test("ZCode Start Plan model entitlement follows runtime whitelist and preserves no-whitelist semantics", () => {
  assert.deepEqual(extra.startPlanEntitlement(balance, { now }), {
    status: "available", models: ["GLM-5.3-Flash", "GLM-5.2"],
  });
  const fallback = structuredClone(balance);
  fallback.data.balances[0].capabilities = ["tool:web"];
  fallback.data.balances[0].show_name = "glm-4.7-flashx";
  assert.deepEqual(extra.startPlanEntitlement(fallback, { now }).models, ["GLM-4.7-FlashX"]);
  const open = structuredClone(balance); open.data.balances = [];
  assert.deepEqual(extra.startPlanEntitlement(open, { now }), { status: "available" });
  open.data.plans[0].entitlements = [{ effective_at: now / 1000 + 3600 }];
  assert.equal(extra.startPlanEntitlement(open, { now }).status, "pending");
  open.data.plans[0].status = "expired";
  assert.deepEqual(extra.startPlanEntitlement(open, { now }), { status: "unavailable", models: [] });
  const success200 = structuredClone(balance); success200.code = 200;
  assert.equal(extra.startPlanEntitlement(success200, { now }).status, "available");
  success200.success = false;
  assert.throws(() => extra.startPlanEntitlement(success200, { now }));
});
test("only exact official HTTPS URLs qualify and ZCode requires a real detected version", () => {
  for (const baseUrl of ["https://api.kimi.com.evil.test/coding/v1", "http://api.kimi.com/coding/v1", "https://api.kimi.com/coding/v1?token=x"])
    assert.equal(extra.adapter({ ...kimi, baseUrl }), null);
  assert.deepEqual(extra.requests(kimi).map((r) => r.url), [kimi.baseUrl + "/me", kimi.baseUrl + "/usages"]);
  assert.equal(extra.requests({ ...kimi, baseUrl: "https://api.kimi.ai/coding/v1" })[0].url, "https://api.kimi.ai/coding/v1/me");
  const p = { ...kimi, subscriptionKind: "zcode-start", baseUrl: "https://zcode.z.ai" };
  assert.equal(extra.profile(p).canRefresh, false); assert.throws(() => extra.requests(p));
  assert.match(extra.requests({ ...p, appVersion: "3.14.0" })[0].url, /app_version=3\.14\.0$/);
});
test("identity and usage query concurrently, retain partial failures separately, persist encrypted, throttle auto-refresh", async (t) => {
  let failure = false; const calls = [];
  const f = fixture(t, async (url, init, network) => {
    calls.push(url); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.equal(network, "system");
    assert.equal(init.headers.authorization, "Bearer synthetic-token");
    if (failure && url.endsWith("/usages")) return new Response("synthetic-token-private", { status: 503 });
    return Response.json(url.endsWith("/me") ? identity : usage);
  });
  assert.equal((await f.info.refresh(kimi.id)).ok, true); assert.equal(calls.length, 2);
  const initial = f.info.public(kimi); assert.equal(fields(initial.fields)["balance-booster"].value, "1.25");
  await f.info.refresh(kimi.id, { automatic: true }); assert.equal(calls.length, 2);
  f.tick(); failure = true; const result = await f.info.refresh(kimi.id);
  assert.equal(result.partial, true); assert.equal(result.ok, false);
  const partial = f.info.public(kimi); assert.equal(partial.updatedAt, initial.updatedAt); assert.equal(partial.stale, true);
  assert.equal(fields(partial.fields)["quota-limit_5h"].remainingPercent, 75); assert.match(partial.error, /503/);
  assert.doesNotMatch(partial.error, /synthetic/);
  assert.doesNotMatch(fs.readFileSync(f.info.file, "utf8"), /Alice|example|synthetic/);
  const restored = new AccountInfo(f.options); assert.equal(fields(restored.public(kimi).fields).email.value, "alice@example.test");
});
test("ZCode runtime model entitlement persists per credential and failed refresh retains the last successful result", async (t) => {
  let failure = false;
  const f = fixture(t, async () => failure
    ? new Response("private", { status: 503 })
    : Response.json(balance, { headers: { date: new Date(now).toUTCString() } }));
  const provider = { id: "zcode-a", subscriptionKind: "zcode-start", baseUrl: "https://zcode.z.ai",
    apiKey: "synthetic-zcode-session", network: "system", models: [], appVersion: "3.14.0" };
  f.providers.push(provider);
  assert.equal((await f.info.refresh(provider.id)).ok, true);
  let profile = f.info.public(provider);
  assert.deepEqual(profile.modelEntitlement.models, ["GLM-5.3-Flash", "GLM-5.2"]);
  assert.equal(profile.modelEntitlement.status, "available");
  const restored = new AccountInfo(f.options);
  assert.deepEqual(restored.public(provider).modelEntitlement.models, profile.modelEntitlement.models);
  f.tick(); failure = true;
  assert.equal((await f.info.refresh(provider.id)).ok, false);
  profile = f.info.public(provider);
  assert.deepEqual(profile.modelEntitlement.models, ["GLM-5.3-Flash", "GLM-5.2"]);
  assert.match(profile.error, /503/);
  provider.apiKey = "synthetic-zcode-session-changed";
  assert.equal(f.info.public(provider).modelEntitlement, undefined);
});
test("query result cannot overwrite a changed account, and switching tokens never borrows cached identity", async (t) => {
  let release; const waiting = new Promise((r) => { release = r; });
  const f = fixture(t, async (url) => { await waiting; return Response.json(url.endsWith("/me") ? identity : usage); });
  const request = f.info.refresh(kimi.id); f.providers[0].apiKey = "synthetic-other"; release();
  assert.equal((await request).ok, false); assert.equal(f.info.public(f.providers[0]).remote, undefined);
});
test("query bounds body size, sanitizes errors, and does not follow redirects", async (t) => {
  const f = fixture(t, async (_, init) => { assert.equal(init.redirect, "error"); return new Response("private", { headers: { "content-length": "999999999" } }); });
  const result = await f.info.refresh(kimi.id); assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /private/);
});
test("saved Codex/Kimi grants query their own token without switching the active login or reading another file", (t) => {
  const f = fixture(t), manager = new HarnessManager(f.dir, () => ({ providers: [] }), [], path.join(f.dir, ".codex"),
    { home: f.dir, env: {}, launchEnv: { PATH: "", USERPROFILE: f.dir } });
  const history = new OAuthHistory({ dataDir: f.dir, crypto: f.vault, sources: () => manager.oauthHistorySources(),
    target: (h, p) => manager.oauthHistoryTarget(h, p), allows: (h, p) => manager.oauthHistoryAllows(h, p) });
  f.put(".kimi-code/config.toml", '[providers.kimi]\ntype="kimi"\nbase_url="https://api.kimi.com/coding/v1"\n[providers.kimi.oauth]\nkey="oauth/kimi-code"\n');
  f.put(".kimi-code/credentials/kimi-code.json", { access_token: "synthetic-kimi-a", refresh_token: "synthetic-refresh-a" });
  f.put(".codex/auth.json", { auth_mode: "chatgpt", tokens: { access_token: "synthetic-codex-a", account_id: "work-a", refresh_token: "codex-refresh-a" } });
  history.scan({ immediate: true }); const records = history.entries.slice();
  f.put(".kimi-code/credentials/kimi-code.json", { access_token: "synthetic-kimi-b", refresh_token: "synthetic-refresh-b" });
  const native = f.put(".codex/auth.json", { auth_mode: "chatgpt", tokens: { access_token: "synthetic-codex-b", account_id: "work-b", refresh_token: "codex-refresh-b" } });
  history.scan({ immediate: true }); const before = fs.readFileSync(native, "utf8");
  for (const e of records) {
    const p = extra.historyProvider(history, manager, e.harness, e.id);
    assert.equal(p.apiKey, "synthetic-" + e.harness + "-a");
    if (e.harness === "codex") assert.equal(p.extraHeaders["chatgpt-account-id"], "work-a");
  }
  assert.equal(fs.readFileSync(native, "utf8"), before);
});
test("ZCode version is read from a trusted native package or desktop metadata", (t) => {
  assert.equal(extra.zcodeVersion({ launcher: () => ({ version: "3.13.0" }) }), "3.13.0");
  assert.equal(extra.zcodeVersion({ launcher: () => ({ version: "bad-version-token" }) }), null);
  const f = fixture(t), exe = f.put("desktop/ZCode.exe", "synthetic-executable");
  const manager = { launcher: () => ({ desktopExecutable: exe }) };
  assert.equal(extra.zcodeVersion(manager), null);
  f.put("desktop/resources/app/out/metadata/build-meta.json", { appVersion: "3.14.0" });
  assert.equal(extra.zcodeVersion(manager), "3.14.0");
  f.put("desktop/resources/app/out/metadata/build-meta.json", { appVersion: "bad-version-token" });
  assert.equal(extra.zcodeVersion(manager), null);
});
test("custom native auth environments are never relabelled as official query credentials", (t) => {
  const f = fixture(t), { kimiSources, readSource } = require("../core/additional-oauth.cjs");
  f.put("kimi/config.toml", '[providers.kimi]\ntype="kimi"\nbase_url="https://api.kimi.com/coding/v1"\n[providers.kimi.oauth]\nkey="oauth/kimi-code"\n');
  f.put("kimi/credentials/kimi-code.json", { access_token: "synthetic-custom" });
  const sources = kimiSources({ dir: path.join(f.dir, "kimi") }, { KIMI_CODE_OAUTH_HOST: "https://custom.example" });
  assert.equal(readSource(sources[0]).grants[0].query, null);
  f.put("zcode/credentials.json", { "oauth:active_provider": "zai", "oauth:zai:access_token": "synthetic-custom",
    "oauth:zai:user_info": JSON.stringify({ user_id: "custom-user" }), zcodejwttoken: "synthetic-session" });
  assert.equal(readSource({ harness: "zcode", dir: path.join(f.dir, "zcode"), env: { ZCODE_ENV: "test" } }).grants[0].query, null);
});
