const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto");
const {
  localProfile,
  adapter,
  parseRemote,
  AccountInfo,
} = require("../core/account-info.cjs");
const {
  parseRecords,
  inspectCredentials,
} = require("../core/credential-status.cjs");
const jwt = (payload) =>
  "header." +
  Buffer.from(JSON.stringify(payload)).toString("base64url") +
  ".signature";
const fields = (p) => Object.fromEntries(p.fields.map((f) => [f.id, f.value]));
const idToken = jwt({
  email: "test@example.test",
  name: "Not an allowlisted Codex claim",
  "https://api.openai.com/auth": {
    chatgpt_account_id: "workspace-fixture",
    chatgpt_user_id: "user-fixture",
    chatgpt_plan_type: "pro",
  },
  other: "do-not-expose",
});
const access = jwt({
  exp: 2100000000,
  "https://api.openai.com/profile": { email: "test@example.test" },
  "https://api.openai.com/auth": {
    chatgpt_account_id: "workspace-fixture",
    chatgpt_plan_type: "pro",
  },
});
const grant = {
  type: "oauth",
  access,
  refresh: "refresh-fixture-secret",
  expires: 2100000000000,
  accountId: "workspace-fixture",
};
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
};
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ass-info-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("ChatGPT allowlisted identity follows its own native account in all compatible harnesses", () => {
  const records = {
    codex: {
      tokens: {
        access_token: access,
        refresh_token: grant.refresh,
        id_token: idToken,
        account_id: grant.accountId,
      },
    },
    opencode: { openai: grant },
    pi: { "openai-codex": grant },
    dsh: {
      records: { "llm-pi-ai/openai-codex": { kind: "grant", payload: grant } },
    },
  };
  for (const [harness, data] of Object.entries(records)) {
    const row = parseRecords(harness, data)[0],
      f = fields(row.profile);
    assert.equal(f.email, "test@example.test", harness);
    assert.equal(f.plan, "pro");
    assert.equal(f.accountId, "workspace-fixture");
    assert.equal(row.profile.source, "本地登录令牌");
    for (const secret of [
      access,
      idToken,
      grant.refresh,
      "do-not-expose",
      "Not an allowlisted",
    ])
      assert.ok(!JSON.stringify(row).includes(secret));
  }
});
test("a selected workspace conflict does not inherit another workspace's identity or plan", () => {
  const p = localProfile("codex", "openai", {
    id_token: idToken,
    access_token: access,
    account_id: "different",
  });
  assert.equal(fields(p).accountId, "different");
  assert.equal(fields(p).plan, undefined);
  assert.equal(fields(p).email, undefined);
});
test("malformed/oversized/unknown JWTs and API keys do not become profile claims", () => {
  for (const token of [
    "bad",
    "h.e30=.s",
    "h." + "x".repeat(70000) + ".s",
    "h.bnVsbA.s",
  ])
    assert.equal(
      fields(localProfile("codex", "openai", { id_token: token })).email,
      undefined,
    );
  assert.equal(
    fields(localProfile("pi", "unrecognized", { access: idToken })).plan,
    undefined,
  );
  assert.equal(
    fields(
      localProfile("pi", "openai", { access: idToken }, { authType: "api" }),
    ).email,
    undefined,
  );
});
test("native optional metadata is bounded, secret-safe and never infers a plan", () => {
  const p = localProfile("pi", "google-gemini-cli", {
    access: "never-display",
    email: "test@example.test",
    name: "never-display",
    projectId: "sample-project",
    plan: "ultra",
    scope: "openid email",
    scopes: ["email", "never-display", {}],
  });
  assert.equal(fields(p).name, undefined);
  assert.equal(fields(p).plan, undefined);
  assert.equal(fields(p).scopes, "email");
  assert.equal(fields(p).projectId, "sample-project");
  assert.equal(
    fields(
      localProfile("pi", "custom", {
        name: "a".repeat(241),
        email: "bad\nvalue",
      }),
    ).name,
    undefined,
  );
});
test("Claude identity is read only from its own session cache and is cleared with credentials", (t) => {
  const home = temp(t),
    dir = path.join(home, ".claude"),
    isolated = path.join(home, "profile");
  const credentials = {
    claudeAiOauth: {
      accessToken: "access-fixture",
      refreshToken: "refresh-fixture",
      expiresAt: 2100000000000,
      subscriptionType: "max",
      rateLimitTier: "default_claude_max_5x",
      scopes: ["user:profile"],
    },
  };
  write(path.join(dir, ".credentials.json"), credentials);
  write(path.join(home, ".claude.json"), {
    oauthAccount: {
      emailAddress: "claude@example.test",
      accountUuid: "uuid-fixture",
      organizationUuid: "org-fixture",
      displayName: "测试账户",
    },
    otherSecret: "hidden",
  });
  const p = inspectCredentials("claude", dir, { native: true }).rows[0].profile;
  assert.equal(fields(p).email, "claude@example.test");
  assert.equal(fields(p).plan, "max");
  assert.equal(fields(p).organizationId, "org-fixture");
  write(path.join(isolated, ".credentials.json"), credentials);
  assert.equal(
    fields(inspectCredentials("claude", isolated).rows[0].profile).email,
    undefined,
  );
  write(path.join(isolated, ".claude.json"), {
    oauthAccount: {
      emailAddress: "other@example.test",
      accountUuid: "other-id",
    },
  });
  assert.equal(
    fields(inspectCredentials("claude", isolated).rows[0].profile).email,
    "other@example.test",
  );
  write(path.join(isolated, ".credentials.json"), {});
  assert.equal(inspectCredentials("claude", isolated).rows.length, 0);
});
test("known Claude account mismatch cannot borrow a cached identity", () => {
  const p = localProfile("claude", "anthropic", {
    accountId: "current",
    cachedIdentity: {
      accountUuid: "previous",
      emailAddress: "wrong@example.test",
    },
  });
  assert.equal(fields(p).email, undefined);
});
test("profile reads do not modify credential bytes and preserve file update timestamps", (t) => {
  const dir = temp(t),
    file = path.join(dir, "auth.json");
  write(file, { "openai-codex": grant });
  const before = fs.readFileSync(file),
    stat = fs.statSync(file),
    a = inspectCredentials("pi", dir),
    b = inspectCredentials("pi", dir);
  assert.deepEqual(a, b);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(a.rows[0].profile.updatedAt, stat.mtime.toISOString());
});
test("only exact official HTTPS API entry points can query identity metadata", () => {
  assert.equal(adapter({ baseUrl: "https://api.deepseek.com/v1" }), "deepseek");
  assert.equal(
    adapter({ baseUrl: "https://openrouter.ai/api/v1/" }),
    "openrouter",
  );
  for (const baseUrl of [
    "http://api.deepseek.com",
    "https://api.deepseek.com.evil.test",
    "https://api.deepseek.com:8443",
    "https://api.deepseek.com/other",
    "https://user:secret@api.deepseek.com",
    "https://api.deepseek.com/?secret=x",
    "https://relay.test",
    "https://openrouter.ai/other",
    "invalid",
  ])
    assert.equal(adapter({ baseUrl, brand: "deepseek" }), null, baseUrl);
});
test("DeepSeek balances retain currency and zero, omit missing amounts and do not invent email", () => {
  const rows = parseRemote("deepseek", {
    is_available: false,
    balance_infos: [
      {
        currency: "CNY",
        total_balance: "0.00",
        granted_balance: "0.00",
        topped_up_balance: "0.00",
      },
      { currency: "USD", total_balance: "1.20", granted_balance: null },
    ],
  });
  assert.deepEqual(
    rows
      .filter((r) => r.id.startsWith("balance"))
      .map((r) => [r.value, r.unit]),
    [
      ["0.00", "CNY"],
      ["1.20", "USD"],
    ],
  );
  assert.equal(fields({ fields: rows }).available, "否");
  assert.ok(!rows.some((r) => r.id === "email" || r.id === "granted-1"));
  assert.throws(() =>
    parseRemote("deepseek", {
      balance_infos: [{ currency: "CNY", total_balance: null }],
    }),
  );
});
test("OpenRouter Key limits are not account cash and null does not mean zero", () => {
  const f = fields({
    fields: parseRemote("openrouter", {
      data: {
        label: "工作 Key",
        limit: null,
        limit_remaining: null,
        usage: 0,
        usage_daily: 0,
        is_free_tier: false,
        creator_user_id: "user-test",
        workspace_id: "workspace-test",
        expires_at: "2027-01-01T00:00:00Z",
      },
    }),
  });
  assert.match(f.limit, /未设置/);
  assert.equal(f.remaining, undefined);
  assert.equal(f.usage, "0");
  assert.equal(f.keyLabel, "工作 Key");
  assert.equal(f.tier, "付费级别");
  const privateRow = parseRemote(
    "openrouter",
    {
      data: {
        label: "sk-or-abc...123",
        creator_user_id: "secret-key",
        usage: 1,
      },
    },
    ["secret-key"],
  );
  assert.deepEqual(
    privateRow.map((r) => r.id),
    ["usage"],
  );
});
function setup(t, fetcher) {
  const dir = temp(t),
    key = crypto.randomBytes(32),
    vault = {
      isEncryptionAvailable: () => true,
      encryptString: (s) => {
        const iv = crypto.randomBytes(12),
          c = crypto.createCipheriv("aes-256-gcm", key, iv);
        return Buffer.concat([
          iv,
          c.update(s, "utf8"),
          c.final(),
          c.getAuthTag(),
        ]);
      },
      decryptString: (b) => {
        const c = crypto.createDecipheriv(
          "aes-256-gcm",
          key,
          b.subarray(0, 12),
        );
        c.setAuthTag(b.subarray(-16));
        return Buffer.concat([
          c.update(b.subarray(12, -16)),
          c.final(),
        ]).toString();
      },
    };
  const providers = [
    {
      id: "test",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "test-secret-key",
      network: "system",
    },
  ];
  let now = 2100000000000;
  const options = {
    dataDir: dir,
    crypto: vault,
    getProvider: (id) => providers.find((p) => p.id === id),
    fetcher,
    now: () => now,
  };
  return {
    info: new AccountInfo(options),
    options,
    providers,
    advance: () => {
      now += 16 * 60000;
    },
  };
}
test("query uses a single fixed read-only route, no redirects or extra credential headers", async (t) => {
  const s = setup(t, async (url, init, network) => {
    assert.equal(url, "https://openrouter.ai/api/v1/key");
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.deepEqual(Object.keys(init.headers), ["accept", "authorization"]);
    assert.equal(network, "system");
    return Response.json({ data: { usage: 0, label: "test-account" } });
  });
  assert.equal((await s.info.refresh("test")).ok, true);
  const contents = fs.readFileSync(s.info.file, "utf8");
  assert.ok(!contents.includes("test-account"));
  assert.ok(!contents.includes("test-secret-key"));
  assert.ok(
    !JSON.stringify(s.info.public(s.providers[0])).includes("test-secret-key"),
  );
  assert.equal(
    fields(new AccountInfo(s.options).public(s.providers[0])).keyLabel,
    "test-account",
  );
  s.advance();
  assert.equal(s.info.public(s.providers[0]).stale, true);
  s.providers[0].apiKey = "replacement-secret";
  assert.equal(fields(s.info.public(s.providers[0])).keyLabel, undefined);
});
test("query errors retain last success without exposing an exception or raw body", async (t) => {
  let failure = false;
  const s = setup(t, async () => {
    if (failure) throw Error("test-secret-key https://secret.test");
    return Response.json({ data: { usage: 1 } });
  });
  await s.info.refresh("test");
  const time = s.info.public(s.providers[0]).updatedAt;
  failure = true;
  const r = await s.info.refresh("test");
  assert.equal(r.ok, false);
  const p = s.info.public(s.providers[0]);
  assert.equal(p.updatedAt, time);
  assert.equal(fields(p).usage, "1");
  assert.ok(p.error);
  assert.ok(!JSON.stringify(p).includes("secret.test"));
  assert.ok(!JSON.stringify(r).includes("test-secret-key"));
});
test("in-flight deduplication and credential replacement cannot attach old results to a new account", async (t) => {
  let finish,
    calls = 0;
  const s = setup(t, () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const a = s.info.refresh("test"),
    b = s.info.refresh("test");
  assert.equal(calls, 1);
  s.providers[0].apiKey = "new-key";
  finish(Response.json({ data: { label: "previous", usage: 5 } }));
  assert.equal((await a).ok, false);
  await b;
  assert.equal(fields(s.info.public(s.providers[0])).keyLabel, undefined);
});
test("oversized, malformed, denied and missing responses never become verified profile data", async (t) => {
  for (const response of [
    new Response("secret", { status: 401 }),
    new Response("invalid-json-secret"),
    new Response("0".repeat(300000)),
    new Response(null),
    Response.json({ unknown: 1 }),
  ]) {
    const s = setup(t, async () => response);
    assert.equal((await s.info.refresh("test")).ok, false);
    assert.equal(s.info.public(s.providers[0]).updatedAt, undefined);
    assert.ok(
      !JSON.stringify(s.info.public(s.providers[0])).includes(
        "invalid-json-secret",
      ),
    );
  }
});
