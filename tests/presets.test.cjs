const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeModel,
  parseImport,
  makeCatalog,
  endpoint,
} = require("../core/models.cjs");
const {
  BALANCE_PRESETS,
  parseBalance,
  queryBalance,
  normalizeBalance,
  detect,
} = require("../core/balance.cjs");
const { PROVIDER_PRESETS } = require("../core/presets.cjs");
test("compatible model context defaults and protocol priority", () => {
  for (const [model, wireApi, expected] of [
    ["claude-opus-5", "anthropic", 1000000],
    ["gpt-5.6-sol", "openai-responses", 372000],
    ["deepseek-v4-flash", "openai-responses", 1048576],
    ["deepseek-v4.1-flash", "openai-responses", 1000000],
    ["glm-5.3", "openai-chat", 200000],
    ["kimi-k3", "openai-chat", 262144],
    ["mimo-x-pro-preview", "openai-responses", 1048576],
    ["minimax-m3", "openai-responses", 1000000],
  ])
    assert.equal(
      normalizeModel({ model, wireApi }, { name: "test" }).contextWindow,
      expected,
      model,
    );
  assert.equal(
    normalizeModel({ model: "unknown" }, { brand: "kimi" }).contextWindow,
    262144,
  );
  assert.equal(
    normalizeModel(
      {
        model: "xiaomi/mimo-x-pro-preview",
        contextWindow: 555555,
        wireApi: "openai-responses",
      },
      {},
    ).contextWindow,
    555555,
  );
  assert.equal(
    normalizeModel({ model: "claude-opus-5" }, { wireApi: "openai-chat" })
      .wireApi,
    "anthropic",
  );
  assert.equal(
    endpoint(PROVIDER_PRESETS[1].baseUrl, "openai-chat"),
    "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
  );
});
test("non-GPT defaults end at max; explicit ultra remains opt-in; official cache wins", () => {
  const m = normalizeModel({ model: "deepseek-test" }, {});
  assert.equal(m.efforts.at(-1), "max");
  assert.ok(!m.efforts.includes("ultra"));
  assert.ok(
    normalizeModel(
      { model: "deepseek-test", efforts: ["max", "ultra"] },
      {},
    ).efforts.includes("ultra"),
  );
  const cached = [
    {
      slug: "gpt-5.6-sol",
      context_window: 999999,
      supported_reasoning_levels: [{ effort: "high" }],
    },
  ];
  assert.equal(
    normalizeModel({ model: "gpt-5.6-sol" }, { id: "official" }, cached)
      .contextWindow,
    999999,
  );
  assert.equal(
    normalizeModel({ model: "gpt-5.6-sol" }, { id: "vendor" }, cached)
      .contextWindow,
    372000,
  );
});
test("third-party catalog does not inherit code-mode-only or freeform-only tools", () => {
  const p = parseImport({
    providers: [
      {
        name: "test",
        baseUrl: "https://example.com",
        models: [{ model: "claude-opus-5" }],
      },
    ],
  });
  const catalog = makeCatalog(
    [
      {
        slug: "gpt",
        tool_mode: "code_mode_only",
        apply_patch_tool_type: "freeform",
      },
    ],
    p,
  );
  assert.equal(catalog.models[1].tool_mode, "direct");
  assert.equal(catalog.models[1].apply_patch_tool_type, null);
});
test("all built-in cash-balance adapters parse fixtures with correct units", () => {
  const cases = [
    ["newapi", { data: { total_available: 0 } }, 0, "USD"],
    ["sub2api", { quota: { remaining: "123", unit: "tokens" } }, 123, "tokens"],
    [
      "deepseek",
      { balance_infos: [{ total_balance: "45.6", currency: "CNY" }] },
      45.6,
      "CNY",
    ],
    ["stepfun", { balance: "3" }, 3, "CNY"],
    ["siliconflow", { data: { totalBalance: "8" } }, 8, "CNY"],
    ["openrouter", { data: { total_credits: 20, total_usage: 3 } }, 17, "USD"],
    ["novita", { availableBalance: 25000 }, 2.5, "USD"],
    ["kimi", { data: { available_balance: 7 } }, 7, "CNY"],
  ];
  for (const [id, body, value, unit] of cases) {
    const result = parseBalance(id, body, {});
    assert.equal(result.value, value, id);
    assert.equal(result.unit, unit, id);
  }
  const multi = parseBalance(
    "deepseek",
    {
      balance_infos: [
        { total_balance: "5", currency: "USD" },
        { total_balance: "30", currency: "CNY" },
      ],
    },
    {},
  );
  assert.equal(multi.rows.length, 2);
});
test("plan usage is not presented as money; missing fields never become zero", () => {
  assert.equal(
    parseBalance(
      "minimax-plan",
      {
        model_remains: [
          { model_name: "M3", current_interval_remaining_percent: 82 },
        ],
        current_weekly_status: { current_weekly_remaining_percent: 70 },
      },
      {},
    ).rows.length,
    2,
  );
  const kimi = parseBalance(
    "kimi-plan",
    {
      usage: { limit: 200, remaining: 150 },
      limits: [
        {
          window: { duration: 5, timeUnit: "HOUR" },
          detail: { limit: 100, remaining: 25 },
        },
      ],
    },
    {},
  );
  assert.equal(kimi.value, 75);
  assert.equal(kimi.rows[1].value, 25);
  assert.equal(kimi.unit, "%");
  for (const p of BALANCE_PRESETS.filter(
    (p) => !["auto", "custom"].includes(p.id),
  ))
    assert.throws(() => parseBalance(p.id, {}, {}), p.id);
  assert.throws(() =>
    parseBalance("custom", { value: "" }, { field: "value", scale: 1 }),
  );
});
test("automatic queries use same-origin bearer only; alternate fallback remains same origin", async () => {
  const provider = {
    baseUrl: "https://example.com/v1",
    apiKey: "synthetic",
    extraHeaders: {},
    balance: { preset: "auto" },
  };
  const seen = [];
  const result = await queryBalance(provider, async (url, init) => {
    seen.push({ url, init });
    return seen.length === 1
      ? new Response("", { status: 404 })
      : Response.json({ remaining: 7 });
  });
  assert.equal(result.value, 7);
  assert.equal(seen[0].init.headers.authorization, "Bearer synthetic");
  assert.equal(seen[1].url, "https://example.com/v1/usage");
  assert.equal(seen[0].init.redirect, "error");
  assert.deepEqual(
    detect({ baseUrl: "https://api.deepseek.com.evil.example" }),
    ["newapi", "sub2api"],
  );
  assert.throws(() =>
    normalizeBalance({ preset: "custom", path: "//evil.example" }),
  );
});
