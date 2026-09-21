const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const TOML = require("@iarna/toml");
const {
  HarnessManager,
  apiAccounts,
  isolatedEnv,
  routeConfig,
  authSummary,
} = require("../core/harnesses.cjs");
const {
  normalizeOAuth,
  enumerateSources,
} = require("../core/oauth-import.cjs");
const { parseImport } = require("../core/models.cjs");
const { Router } = require("../core/router.cjs");
const providers = parseImport({
  providers: [
    {
      id: "deep",
      name: "DeepSeek",
      brand: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "synthetic-deep-key",
      wireApi: "openai-chat",
      models: [{ model: "deepseek-chat", wireApi: "openai-chat" }],
    },
    {
      id: "go",
      name: "Go",
      brand: "opencode-go",
      baseUrl: "https://opencode.ai/zen/go/v1",
      apiKey: "synthetic-go-key",
      wireApi: "openai-chat",
      models: [{ model: "qwen", wireApi: "openai-chat" }],
    },
    {
      id: "ant",
      name: "Claude API",
      baseUrl: "https://api.anthropic.com",
      apiKey: "synthetic-ant-key",
      models: [{ model: "claude-test", wireApi: "anthropic" }],
    },
  ],
});
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ass-clients-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("DeepSeek and Go are API accounts; Claude filters incompatible models", () => {
  assert.equal(apiAccounts("dsh", providers)[0].badge, "DeepSeek API");
  assert.equal(apiAccounts("opencode", providers)[1].badge, "OpenCode Go API");
  assert.equal(apiAccounts("claude", providers)[0].ready, false);
  assert.equal(apiAccounts("claude", providers)[2].models.length, 1);
  assert.ok(
    !JSON.stringify(apiAccounts("pi", providers)).includes(
      "synthetic-deep-key",
    ),
  );
});
test("five harness config generators never embed upstream keys", () => {
  for (const id of ["codex", "claude", "opencode", "pi", "dsh"]) {
    const p = providers[id === "claude" ? 2 : 0];
    const plan = routeConfig(id, p, p.models[0], "C:\\temp", "local-token", {
      models: [],
    });
    assert.ok(!JSON.stringify(plan).includes(p.apiKey));
    if (id === "codex")
      assert.equal(
        TOML.parse(plan.files.find(([f]) => f === "config.toml")[1])
          .model_providers.ass_api.env_key,
        "ASS_LOCAL_TOKEN",
      );
    if (id === "dsh")
      assert.equal(
        JSON.parse(plan.files[0][1])["llm-pi-ai"].providers["ass-api"]
          .apiKeyEnv,
        "ASS_LOCAL_TOKEN",
      );
    if (id === "opencode")
      assert.ok(JSON.parse(plan.env.OPENCODE_CONFIG_CONTENT).provider.ass);
  }
});
test("native profiles are isolated; official launch clears third-party auth environment", (t) => {
  const dir = temp(t);
  const env = isolatedEnv("pi", dir, {
    ANTHROPIC_AUTH_TOKEN: "bad",
    OPENAI_BASE_URL: "https://other",
    PI_CODING_AGENT_DIR: "old",
    NODE_EXTRA_CA_CERTS: "trusted.pem",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    PATH: "safe",
  });
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.OPENAI_BASE_URL, undefined);
  assert.equal(env.NODE_EXTRA_CA_CERTS, "trusted.pem");
  assert.equal(env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
  assert.equal(env.PI_CODING_AGENT_DIR, dir);
  assert.equal(env.NODE_USE_SYSTEM_CA, "1");
});
test("account switches do not rewrite other profile files; API launch does not use OAuth dir", (t) => {
  const dir = temp(t),
    manager = new HarnessManager(dir, () => ({ providers }), []);
  const one = manager.add("claude", "one"),
    two = manager.add("claude", "two");
  assert.notEqual(manager.root("claude", one), manager.root("claude", two));
  fs.writeFileSync(
    path.join(manager.root("claude", one), ".credentials.json"),
    '{"claudeAiOauth":{"accessToken":"synthetic"}}',
  );
  manager.select("claude", two);
  assert.equal(authSummary("claude", manager.root("claude", one)).ready, true);
  const route = manager.plan("claude", "api:ant", "launch", null, "token");
  assert.notEqual(route.dir, manager.root("claude", two));
  assert.equal(route.env.ANTHROPIC_AUTH_TOKEN, "token");
  assert.throws(() => manager.root("claude", "../escape"));
});
test("OAuth import converts exact formats and rejects API keys / incomplete credentials", () => {
  const jwt =
    "header." +
    Buffer.from(
      JSON.stringify({
        exp: 2000000000,
        "https://api.openai.com/auth": { chatgpt_account_id: "acc" },
      }),
    ).toString("base64url") +
    ".signature";
  const c = normalizeOAuth("codex", {
    tokens: { access_token: jwt, refresh_token: "synthetic-refresh" },
  });
  assert.equal(c.provider, "openai-codex");
  assert.equal(c.record.expires, 2000000000000);
  assert.equal(c.record.accountId, "acc");
  assert.equal(
    normalizeOAuth("claude", {
      claudeAiOauth: {
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: 2000000000000,
      },
    }).provider,
    "anthropic",
  );
  assert.throws(() => normalizeOAuth("codex", { OPENAI_API_KEY: "not-oauth" }));
  assert.throws(() =>
    normalizeOAuth(
      "opencode",
      { openai: { type: "api", key: "key" } },
      "openai",
    ),
  );
});
test("pi import always creates a new account, keeps source immutable and renderer secret-free", (t) => {
  const dir = temp(t),
    codexDir = path.join(dir, "codex");
  fs.mkdirSync(codexDir);
  const manager = new HarnessManager(
    path.join(dir, "app"),
    () => ({ providers }),
    [],
    codexDir,
  );
  const original = JSON.stringify({
    tokens: {
      access_token:
        "h." + Buffer.from('{"exp":2000000000}').toString("base64url") + ".s",
      refresh_token: "secret-refresh",
      account_id: "acc",
    },
  });
  fs.writeFileSync(path.join(codexDir, "auth.json"), original);
  assert.throws(() => manager.importOAuth("local-codex", "first"));
  manager.piProviders = [{ id: "openai-codex", name: "Codex" }];
  const a = manager.importOAuth("local-codex", "first"),
    b = manager.importOAuth("local-codex", "second");
  assert.notEqual(a, b);
  assert.equal(
    fs.readFileSync(path.join(codexDir, "auth.json"), "utf8"),
    original,
  );
  const snapshot = JSON.stringify(manager.snapshot());
  assert.ok(!snapshot.includes("secret-refresh"));
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(manager.root("pi", a), "auth.json"), "utf8"),
    )["openai-codex"].type,
    "oauth",
  );
});
test("native protocol relay authenticates, never forwards OAuth, rejects mismatched protocols", async (t) => {
  const calls = [];
  const router = new Router({
    getState: () => ({ providers }),
    fetchUpstream: async (url, init) => {
      calls.push({ url, headers: init.headers });
      return new Response(
        'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  router.port = 0;
  await router.start();
  router.port = router.server.address().port;
  t.after(() => router.stop());
  const base = "http://127.0.0.1:" + router.port + "/harness/deep/v1/";
  const send = (suffix, auth) =>
    fetch(base + suffix, {
      method: "POST",
      headers: {
        authorization: "Bearer " + auth,
        "chatgpt-account-id": "secret-account",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        stream: true,
        messages: [{ role: "user", content: "OK" }],
      }),
    });
  assert.equal((await send("chat/completions", "wrong")).status, 401);
  assert.equal((await send("responses", router.clientToken)).status, 400);
  const r = await send("chat/completions", router.clientToken);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /DONE/);
  assert.equal(calls[0].headers.authorization, "Bearer synthetic-deep-key");
  assert.equal(calls[0].headers["chatgpt-account-id"], undefined);
});
