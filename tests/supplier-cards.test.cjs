const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Preferences } = require("../core/preferences.cjs");
const {
  parseSubscription,
  nativeSubscriptionProvider,
} = require("../core/subscription-usage.cjs");
const { AccountInfo, adapter } = require("../core/account-info.cjs");
const { orderProviders, moveVisible } = require("../src/provider-order.mjs");
const { providerBrand } = require("../src/provider-brand.mjs");
const jwt = (v) =>
  "header." +
  Buffer.from(JSON.stringify(v)).toString("base64url") +
  ".signature";
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ass-cards-"));
  t.after(() => {
    assert.ok(path.basename(dir).startsWith("ass-cards-"));
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
const vault = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
const descriptor = (id = "one") => ({
  id,
  subscriptionKind: "openai",
  baseUrl: "https://chatgpt.com/backend-api",
  apiKey: "synthetic-access-" + id,
  network: "system",
  extraHeaders: { "chatgpt-account-id": id },
});
const usage = (used = 54, id = "one") => ({
  account_id: id,
  rate_limit: {
    primary_window: {
      used_percent: used,
      limit_window_seconds: 604800,
      reset_at: 1790574680,
    },
    secondary_window: null,
  },
});

test("card order and quota display account persist, deduplicate and do not replace other choices", (t) => {
  const dir = temp(t),
    prefs = new Preferences(dir);
  prefs.update({
    providerOrder: ["b", "a", "b"],
    quotaAccounts: { official: "work", "native-pi": "personal" },
  });
  prefs.update({ quotaAccounts: { official: "personal" }, view: "providers" });
  const restored = new Preferences(dir).state;
  assert.deepEqual(restored.providerOrder, ["b", "a"]);
  assert.deepEqual(restored.quotaAccounts, {
    official: "personal",
    "native-pi": "personal",
  });
  assert.equal(restored.view, "providers");
  assert.throws(() => prefs.update({ providerOrder: ["\0"] }));
  assert.throws(() => prefs.update({ providerOrder: Array(5001).fill("x") }));
  assert.deepEqual(prefs.state.providerOrder, ["b", "a"]);
});
test("failed order persistence retains the last committed state", (t) => {
  const p = new Preferences(temp(t));
  p.update({ providerOrder: ["a", "b"] });
  const file = p.file;
  p.file = path.join(file, "not-a-directory");
  assert.throws(() => p.update({ providerOrder: ["b", "a"] }));
  assert.deepEqual(p.state.providerOrder, ["a", "b"]);
  assert.deepEqual(new Preferences(path.dirname(file)).state.providerOrder, [
    "a",
    "b",
  ]);
});
test("sorting appends new providers stably and filtered drag preserves hidden positions", () => {
  const rows = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  assert.deepEqual(
    orderProviders(rows, ["deleted", "c", "a"]).map((p) => p.id),
    ["c", "a", "b", "d", "e"],
  );
  assert.deepEqual(
    moveVisible(
      rows.map((p) => p.id),
      ["a", "c", "e"],
      "a",
      "e",
    ),
    ["c", "b", "e", "d", "a"],
  );
  assert.deepEqual(moveVisible(["a", "b", "c"], ["a", "b", "c"], "c", "a"), [
    "c",
    "a",
    "b",
  ]);
  assert.deepEqual(moveVisible(["a", "b"], ["a"], "a", "b"), ["a", "b"]);
  assert.deepEqual(
    rows.map((p) => p.id),
    ["a", "b", "c", "d", "e"],
  );
});
test("logos match official services or exact brand names, not a reseller's model IDs", () => {
  assert.equal(providerBrand({ id: "official" }), "openai");
  assert.equal(providerBrand({ id: "native-claude" }), "claude");
  for (const [service, icon] of [
    ["google", "gemini"],
    ["opencode-go", "opencode"],
    ["z-ai", "zai"],
    ["siliconflow", "siliconcloud"],
  ])
    assert.equal(providerBrand({ id: "x", name: "Personal" }, service), icon);
  assert.equal(providerBrand({ name: "DeepSeek 私人" }), "deepseek");
  assert.equal(
    providerBrand({ name: "Relay", models: [{ model: "gpt-6-astra" }] }),
    null,
  );
  assert.equal(providerBrand({ name: "openai-proxy" }), null);
});
test("OpenAI weekly-only primary is weekly 46 percent remaining, not 5h or zero", () => {
  const q = parseSubscription("openai", usage());
  assert.equal(q.length, 1);
  assert.equal(q[0].label, "周");
  assert.equal(q[0].usedPercent, 54);
  assert.equal(q[0].remainingPercent, 46);
  assert.equal(q[0].resetsAt, "2026-09-28T05:51:20.000Z");
});
test("OpenAI prefers codex bucket, uses actual durations and ignores other-model/credit balances", () => {
  const q = parseSubscription("openai", {
    rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300 } },
    rateLimitsByLimitId: {
      codex: {
        primary: {
          usedPercent: 0,
          windowDurationMins: 300,
          resetsAt: 1790574680,
        },
        secondary: { usedPercent: 100, windowDurationMins: 10080 },
      },
      other: { primary: { usedPercent: 15 } },
    },
    credits: { balance: "99" },
  });
  assert.deepEqual(
    q.map((w) => [w.label, w.remainingPercent]),
    [
      ["5h", 100],
      ["周", 0],
    ],
  );
  assert.equal(
    parseSubscription("openai", {
      rate_limit: {
        primary_window: { used_percent: 5, limit_window_seconds: 3600 },
      },
    })[0].label,
    "1h",
  );
});
test("missing/null/invalid subscription values stay unknown; percentages are bounded", () => {
  for (const used of [undefined, null, "54", -1, NaN, Infinity]) {
    const data = usage();
    data.rate_limit.primary_window.used_percent = used;
    assert.deepEqual(parseSubscription("openai", data), []);
  }
  assert.deepEqual(
    parseSubscription("openai", { rate_limit: { primary_window: {} } }),
    [],
  );
  assert.deepEqual(parseSubscription("openai", null), []);
  assert.equal(parseSubscription("openai", usage(105))[0].remainingPercent, 0);
  assert.equal(
    parseSubscription("openai", {
      rate_limit: { primary_window: { used_percent: 4 } },
    })[0].label,
    "窗口 1",
  );
});
test("Claude utilization and documented status-line used_percentage both mean consumed", () => {
  const q = parseSubscription("anthropic", {
    five_hour: { utilization: 80, resets_at: "2026-09-22T05:00:00Z" },
    seven_day: { utilization: 0 },
  });
  assert.deepEqual(
    q.map((w) => [w.label, w.remainingPercent]),
    [
      ["5h", 20],
      ["周", 100],
    ],
  );
  assert.equal(q[0].resetsAt, "2026-09-22T05:00:00.000Z");
  assert.deepEqual(
    parseSubscription("anthropic", {
      rate_limits: {
        five_hour: { used_percentage: null },
        seven_day: { used_percentage: 40 },
      },
    }).map((w) => w.remainingPercent),
    [60],
  );
});
test("all five harness credential formats remain read-only with first-party pinned endpoints", (t) => {
  const dir = temp(t),
    access = jwt({
      "https://api.openai.com/auth": { chatgpt_account_id: "from-claim" },
    });
  const grant = {
    access,
    refresh: "never-refresh",
    accountId: "explicit-workspace",
  };
  const fixtures = [
    [
      "codex",
      "openai",
      { tokens: { access_token: access, account_id: "explicit-workspace" } },
    ],
    [
      "claude",
      "anthropic",
      {
        claudeAiOauth: {
          accessToken: "fixture-access",
          refreshToken: "never-refresh",
        },
      },
    ],
    ["opencode", "openai", { openai: grant }],
    ["pi", "openai-codex", { "openai-codex": { access } }],
    [
      "dsh",
      "openai-codex",
      { records: { "llm-pi-ai/openai-codex": { payload: grant } } },
    ],
  ];
  for (const [id, provider, data] of fixtures) {
    const file = path.join(dir, id + ".json");
    fs.writeFileSync(file, JSON.stringify(data));
    const before = fs.readFileSync(file),
      account = {
        id: "a",
        provider,
        authType: "oauth",
        ready: true,
        sourcePath: file,
      };
    const p = nativeSubscriptionProvider({ id }, account);
    assert.equal(p.network, "system");
    assert.equal(p.id, "native-info:" + id + ":a");
    assert.match(
      p.baseUrl,
      /^https:\/\/(chatgpt.com\/backend-api|api.anthropic.com)$/,
    );
    if (id !== "claude")
      assert.equal(
        p.extraHeaders["chatgpt-account-id"],
        id === "pi" ? "from-claim" : "explicit-workspace",
      );
    assert.ok(!JSON.stringify(p).includes("never-refresh"));
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(
      nativeSubscriptionProvider({ id }, { ...account, kind: "api" }),
      null,
    );
    assert.equal(
      nativeSubscriptionProvider({ id }, { ...account, ready: false }),
      null,
    );
    assert.equal(
      nativeSubscriptionProvider(
        { id },
        { ...account, provider: "unsupported" },
      ),
      null,
    );
  }
});
test("subscription adapter never accepts an arbitrary host", () => {
  assert.equal(adapter(descriptor()), "openai-subscription");
  assert.equal(
    adapter({ ...descriptor(), baseUrl: "https://chatgpt.com.attacker.test" }),
    null,
  );
});
test("OpenAI query is a credential-isolated read-only GET; cache and automatic throttle survive restart", async (t) => {
  const dir = temp(t),
    providers = [descriptor("one"), descriptor("two")];
  let now = Date.now(),
    calls = [];
  const opts = {
    dataDir: dir,
    crypto: vault,
    now: () => now,
    getProvider: (id) => providers.find((p) => p.id === id),
    fetcher: async (url, init, network) => {
      calls.push({ url, init, network });
      const id = init.headers["chatgpt-account-id"];
      return Response.json(usage(id === "one" ? 54 : 10, id));
    },
  };
  const info = new AccountInfo(opts);
  assert.equal((await info.refresh("one")).ok, true);
  assert.equal((await info.refresh("two")).ok, true);
  assert.equal(calls[0].url, "https://chatgpt.com/backend-api/wham/usage");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].network, "system");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(
    calls[0].init.headers.authorization,
    "Bearer synthetic-access-one",
  );
  assert.equal(info.public(providers[0]).fields[0].remainingPercent, 46);
  assert.equal(info.public(providers[1]).fields[0].remainingPercent, 90);
  const restored = new AccountInfo(opts);
  assert.equal(
    (await restored.refresh("one", { automatic: true })).cached,
    true,
  );
  assert.equal(calls.length, 2);
  now += 300001;
  await restored.refresh("one", { automatic: true });
  assert.equal(calls.length, 3);
  providers[0] = { ...providers[0], apiKey: "new-key" };
  assert.equal(restored.public(providers[0]).fields.length, 0);
  await restored.refresh("one", { automatic: true });
  assert.equal(calls.length, 4);
  assert.ok(!JSON.stringify(restored.public(providers[0])).includes("new-key"));
});
test("mismatched OpenAI account or 401 does not replace previous good quota or refresh tokens", async (t) => {
  const p = descriptor(),
    dir = temp(t);
  let payload = usage(),
    status = 200,
    calls = 0;
  const info = new AccountInfo({
    dataDir: dir,
    crypto: vault,
    getProvider: () => p,
    fetcher: async () => {
      calls++;
      return Response.json(payload, { status });
    },
  });
  await info.refresh(p.id);
  const old = info.public(p);
  payload = usage(1, "different-account");
  assert.equal((await info.refresh(p.id)).ok, false);
  assert.match(info.public(p).error, /不属于所选账户/);
  assert.deepEqual(info.public(p).fields, old.fields);
  assert.equal(info.public(p).updatedAt, old.updatedAt);
  status = 401;
  payload = { secret: "do-not-output" };
  assert.equal((await info.refresh(p.id)).ok, false);
  assert.match(info.public(p).error, /HTTP 401/);
  assert.ok(!JSON.stringify(info.public(p)).includes("do-not-output"));
  await info.refresh(p.id, { automatic: true });
  assert.equal(calls, 3);
});
