const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { AccountInfo, text } = require("../core/account-info.cjs");
const oauth = require("../core/oauth-info.cjs"), zcode = require("../core/zcode-account-info.cjs");
const { readSource, publicGrant } = require("../core/additional-oauth.cjs");
const now = Date.UTC(2026, 8, 24);
const fields = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
const provider = (family = "zai", coding = [{ kind: "personal", apiKey: "native-coding-key" }]) => ({
  id: "saved-zcode-user", subscriptionKind: "zcode-account", family, coding,
  baseUrl: "https://zcode.z.ai", apiKey: "zcode-session-token", oauthAccess: "business-oauth-token", network: "system" });
const personalPlan = { code: 200, data: [{ productId: "coding-pro", productName: "Coding Pro", status: "VALID", inCurrentPeriod: true,
  autoRenew: true, nextRenewTime: "2026-10-01 12:00:00", billingCycle: "monthly" }] };
const teamPlan = { code: 200, data: { hasSubscription: true, status: "EFFECTIVE", memberGrantStatus: "VALID",
  productId: "team-pro", productName: "Team Pro", subscribeEndTime: "2026-10-01T00:00:00+08:00", subscribePeriod: "YEARLY" } };
const quota = { code: 200, data: { level: "PRO", limits: [
  { type: "CREDIT_LIMIT", unit: 3, number: 5, percentage: 25, remaining: 75, nextResetTime: now + 3600000 },
  { type: "TOKENS_LIMIT", unit: 6, percentage: 0 }, { type: "TIME_LIMIT", unit: 5, number: 1, percentage: 80, remaining: 2 } ] } };
const mcp = { code: 0, data: { server_time: now / 1000, next_refresh_at: now / 1000 + 60,
  total_usage: { used: 4, limit: 10, remaining: 6 } } };
const team = { kind: "team", productId: "team-pro", organizationId: "org-one", projectId: "project-one" };
function fixture(t, p, fetcher) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ass-zcode-info-")), key = crypto.randomBytes(32);
  t.after(() => { assert.equal(path.dirname(dir), os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true }); });
  const vault = { isEncryptionAvailable: () => true,
    encryptString(s) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(s), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    decryptString(b) { const cipher = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12)); cipher.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString(); } };
  const state = { p, time: now }, calls = [];
  const options = { dataDir: dir, crypto: vault, getProvider: (id) => id === state.p.id ? state.p : null,
    now: () => state.time, fetcher: async (url, init, network) => {
      assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.equal(network, "system");
      calls.push({ url, headers: init.headers }); return fetcher(url, init);
    } };
  const put = (file, data) => { const target = path.join(dir, file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(data)); return target; };
  return { dir, state, options, calls, put, info: new AccountInfo(options) };
}
test("CLI Coding Plan uses API-key quota, MaaS+session MCP, correct percentages/time units and encrypted cache", async (t) => {
  const p = provider(), f = fixture(t, p, async (url, init) => {
    if (url.endsWith("/subscription/list")) { assert.equal(init.headers.authorization, "native-coding-key"); return Response.json(personalPlan); }
    if (url.endsWith("/quota/limit")) { assert.equal(init.headers.authorization, "native-coding-key"); return Response.json(quota); }
    assert.equal(url, "https://zcode.z.ai/api/v1/mcp/usage");
    assert.equal(init.headers.authorization, "Bearer zcode-session-token");
    assert.equal(init.headers["x-bigmodel-authorization"], "Bearer business-oauth-token");
    assert.equal(init.headers["bigmodel-target-type"], "PERSONAL"); return Response.json(mcp);
  });
  assert.equal(oauth.profile(p).canRefresh, true);
  assert.equal((await f.info.refresh(p.id)).ok, true); assert.equal(f.calls.length, 3);
  const result = fields(f.info.public(p).fields);
  assert.equal(result["coding-personal-quota-0"].remainingPercent, 75);
  assert.equal(result["coding-personal-quota-0"].resetsAt, new Date(now + 3600000).toISOString());
  assert.equal(result["coding-personal-quota-1"].remainingPercent, 100);
  assert.equal(result["coding-personal-quota-mcp"].remainingPercent, 60);
  assert.equal(result["coding-personal-quota-mcp"].resetsAt, new Date(now + 60000).toISOString());
  assert.equal(result["coding-personal-remaining-1"], undefined); // Missing count != zero.
  assert.equal(result["coding-personal-renew-at"].value, "2026-10-01 12:00:00");
  assert.equal(result["coding-personal-expiry"], undefined);
  assert.doesNotMatch(fs.readFileSync(f.info.file, "utf8"), /Coding Pro|business-oauth-token|native-coding-key/);
  assert.equal(fields(new AccountInfo(f.options).public(p).fields)["coding-personal-plan"].value, "Coding Pro");
});
for (const family of ["zai", "bigmodel"]) test(family + " Team quota remains scoped and only reads existing project keys", async (t) => {
  const p = provider(family, [team]), host = family === "zai" ? "https://api.z.ai" : "https://bigmodel.cn";
  const f = fixture(t, p, async (url, init) => {
    const h = init.headers;
    if (url.endsWith("/mcp/usage")) {
      assert.equal(h["bigmodel-target-type"], family === "bigmodel" ? "TEAM" : undefined);
      assert.equal(h["bigmodel-project"], family === "bigmodel" ? team.projectId : undefined);
      assert.equal(h["x-bigmodel-authorization"], "Bearer business-oauth-token"); return Response.json(mcp);
    }
    assert.ok(url.startsWith(host + "/"));
    if (url.endsWith("/quota/limit?type=2")) { assert.equal(h.authorization, "key-id.key-secret");
      assert.equal(h["bigmodel-project"], team.projectId); return Response.json(quota); }
    assert.equal(h.authorization, family === "zai" ? "Bearer business-oauth-token" : "business-oauth-token");
    if (url.endsWith("/getCustomerInfo")) return Response.json({ data: { organizations: [{ organizationId: team.organizationId,
      projects: [{ projectId: team.projectId, projectType: 2 }] }] } });
    assert.equal(h["bigmodel-organization"], team.organizationId); assert.equal(h["bigmodel-project"], team.projectId);
    if (url.endsWith("/querySubscribeDetail")) return Response.json(teamPlan);
    if (url.endsWith("/api_keys")) return Response.json({ code: 200, data: [{ name: "zcode-api-key", keyType: 1, apiKey: "wrong-personal" },
      { name: "zcode-team-api-key", keyType: 2, apiKey: "key-id" }] });
    assert.ok(url.endsWith("/api_keys/copy/key-id")); return Response.json({ data: { secretKey: "key-secret" } });
  });
  assert.equal((await f.info.refresh(p.id)).ok, true); assert.equal(f.calls.length, 6);
  const result = fields(f.info.public(p).fields);
  assert.equal(result["coding-team-organization"].value, team.organizationId);
  assert.equal(result["coding-team-expiry"].value, "2026-09-30T16:00:00.000Z");
  assert.equal(result["coding-team-quota-0"].remainingPercent, 75);
  assert.doesNotMatch(JSON.stringify(f.info.public(p)), /key-id|key-secret|wrong-personal|oauth-token|session-token/);
});
test("missing Team key does not create one and does not hide valid subscription/MCP results", async (t) => {
  const p = provider("bigmodel", [team]), f = fixture(t, p, async (url) => {
    if (url.endsWith("querySubscribeDetail")) return Response.json(teamPlan);
    if (url.endsWith("/mcp/usage")) return Response.json(mcp);
    if (url.endsWith("getCustomerInfo")) return Response.json({ data: { organizations: [{ organizationId: team.organizationId,
      projects: [{ projectId: team.projectId, projectType: 2 }] }] } });
    assert.ok(url.endsWith("/api_keys")); return Response.json({ data: [] });
  });
  const result = await f.info.refresh(p.id); assert.equal(result.partial, true); assert.equal(result.ok, false);
  const rows = fields(f.info.public(p).fields); assert.equal(rows["coding-team-plan"].value, "Team Pro");
  assert.equal(rows["coding-team-quota-mcp"].remainingPercent, 60); assert.equal(rows["coding-team-quota-0"], undefined);
});
test("personal key discovery excludes Team projects and shares one read-only key lookup across queries", async (t) => {
  const p = provider("zai", [{ kind: "personal" }]), f = fixture(t, p, async (url, init) => {
    if (url.endsWith("/getCustomerInfo")) return Response.json({ data: { organizations: [
      { organizationId: "team-org", projects: [{ projectId: "team-p", projectType: 2 }] },
      { organizationId: "personal-org", organizationName: "默认机构", projects: [{ projectId: "personal-p", projectName: "默认项目" }] } ] } });
    if (url.endsWith("/api_keys")) {
      assert.match(url, /organization\/personal-org\/projects\/personal-p\/api_keys$/);
      return Response.json({ data: [{ name: "zcode-api-key", apiKey: "personal-id" }] });
    }
    if (url.endsWith("/copy/personal-id")) return Response.json({ data: { secretKey: "personal-secret" } });
    if (url.endsWith("/mcp/usage")) return Response.json(mcp);
    assert.equal(init.headers.authorization, "personal-id.personal-secret");
    return Response.json(url.endsWith("/subscription/list") ? personalPlan : quota);
  });
  assert.equal((await f.info.refresh(p.id)).ok, true);
  assert.equal(f.calls.filter((c) => c.url.endsWith("/getCustomerInfo")).length, 1);
  assert.equal(f.calls.length, 6);
  assert.deepEqual(zcode.capture("zai", "u", { providerFamilyConnectionSelections: { zai: { ...team, kind: "team-coding-plan", apiKey: "not-native" } } }, () => ""), [team]);
});
test("partial failures retain old quota age; explicit unavailable entitlement clears obsolete quota without zero-filling", async (t) => {
  let mode = "ok"; const p = provider(), f = fixture(t, p, async (url) => {
    if (url.endsWith("/subscription/list")) return Response.json(mode === "ended" ? { data: [] } : personalPlan);
    if (url.endsWith("/quota/limit")) return mode === "fail" ? new Response("sensitive-detail", { status: 503 }) : Response.json(quota);
    return Response.json(mcp);
  });
  await f.info.refresh(p.id); const initial = f.info.public(p).updatedAt;
  mode = "fail"; f.state.time += 16 * 60000; assert.equal((await f.info.refresh(p.id)).partial, true);
  assert.equal(f.info.public(p).updatedAt, initial); assert.match(f.info.public(p).error, /Coding Plan.*503/);
  mode = "ended"; f.state.time += 60000; const count = f.calls.length;
  assert.equal((await f.info.refresh(p.id)).ok, true); assert.equal(f.calls.length - count, 1);
  const result = fields(f.info.public(p).fields); assert.equal(result["coding-personal-status"].value, "无有效套餐");
  assert.equal(result["coding-personal-quota-0"], undefined); assert.equal(result["coding-personal-quota-mcp"], undefined);
});
test("source capture scopes cached keys to OAuth identity and history queries never borrow active credentials", (t) => {
  const f = fixture(t, provider(), async () => { throw Error("No network expected"); });
  const key = "account-provider:coding-plan:account:zai-individual-coding-plan:account:user-a:api-key";
  const auth = { "oauth:active_provider": "zai", "oauth:zai:access_token": "business-a", "oauth:zai:user_info": JSON.stringify({ user_id: "user-a" }),
    zcodejwttoken: "session-a", [key]: "cached-a", [key.replace("user-a", "user-b")]: "cached-b", "unrelated-key": "must-not-read" };
  f.put("native/credentials.json", auth); f.put("native/setting.json", { providerFamilyConnectionSelections: { zai: { kind: "individual-coding-plan" } } });
  const source = { harness: "zcode", dir: path.join(f.dir, "native"), env: {} }, state = readSource(source), captured = state.grants[0];
  assert.deepEqual(captured.grant.coding, [{ kind: "personal", apiKey: "cached-a" }]);
  assert.doesNotMatch(JSON.stringify(publicGrant("zcode", "zai", captured.grant)), /cached-|session-a|business-a/);
  const history = { lookup: () => ({ ...captured, provider: "zai" }) }, manager = { launcher: () => ({}) };
  const p = oauth.historyProvider(history, manager, "zcode", "saved");
  assert.equal(p.queryBlocked, ""); assert.equal(p.coding[0].apiKey, "cached-a");
  f.put("native/credentials.json", { ...auth, "oauth:zai:access_token": "business-b", zcodejwttoken: "session-b" });
  assert.equal(oauth.historyProvider(history, manager, "zcode", "saved").oauthAccess, "business-a");
  const foreign = readSource({ ...source, env: { ZAI_BUSINESS_BASE_URL: "https://custom.example" } }).grants[0];
  assert.equal(foreign.query.kind, "zcode-start"); assert.equal(foreign.grant.coding, undefined);
  assert.equal(zcode.official({ BIGMODEL_API_BASE_URL: "https://bigmodel.cn.evil.test" }, "bigmodel"), false);
});
test("changing scope or OAuth token discards in-flight results and never mixes credential generations", async (t) => {
  let release; const pending = new Promise((r) => { release = r; }), p = provider();
  const f = fixture(t, p, async (url, init) => {
    if (url.endsWith("/subscription/list")) { await pending; return Response.json(personalPlan); }
    if (url.endsWith("/mcp/usage")) { assert.equal(init.headers["x-bigmodel-authorization"], "Bearer business-oauth-token"); return Response.json(mcp); }
    return Response.json(quota);
  });
  const job = f.info.refresh(p.id); p.oauthAccess = "new-generation-token"; release();
  assert.equal((await job).ok, false); assert.equal(f.info.public(p).remote, undefined);
  assert.equal(zcode.requests(provider("bigmodel", [{ ...team, projectId: "bad\nheader" }])).length, 0);
  assert.equal(zcode.requests({ ...provider("bigmodel"), oauthAccess: "zcode-session-token" }).length, 0);
});
test("invalid team product or missing percentages cannot be presented as known available quota", () => {
  const parse = (part, data, extra = {}) => zcode.parse({ context: team, part }, { data, ...extra }, { safeText: text });
  assert.throws(() => parse("plan", { ...teamPlan, data: { ...teamPlan.data, productId: "different-team" } }));
  assert.throws(() => parse("mcp", { code: 0, data: { buckets: [] } }));
  const rows = fields(parse("usage", { data: { limits: [{ type: "TOKENS_LIMIT", unit: 6, remaining: 15 }] } }));
  assert.equal(rows["coding-team-quota-0"], undefined); assert.equal(rows["coding-team-remaining-0"].value, "15");
  const empty = parse("usage", null, { empty: true }); assert.deepEqual(empty, []);
});
