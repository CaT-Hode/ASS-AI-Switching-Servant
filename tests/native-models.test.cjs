const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { nativeModels, modelSources } = require("../core/model-inventory.cjs");
const { nativeOfficialProvider } = require("../core/native-official.cjs");
const {
  parseRemote,
  adapter,
  apiProfile,
} = require("../core/account-info.cjs");
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ass-native-models-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const write = (f, d) => {
    const file = path.join(home, f);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof d === "string" ? d : JSON.stringify(d));
    return file;
  };
  return { home, write };
}
test("OpenCode merges logged-in provider cache with JSONC overrides, respects filters and never includes unrelated keys", (t) => {
  const { home, write } = fixture(t),
    account = {
      kind: "native",
      provider: "opencode",
      nativeDir: path.join(home, ".local/share/opencode"),
    };
  write(".cache/opencode/models.json", {
    opencode: {
      npm: "@ai-sdk/openai",
      models: {
        x: { id: "x", limit: { context: 128000 } },
        off: { id: "off" },
      },
    },
    other: { models: { private: { id: "private" } } },
  });
  write(
    ".config/opencode/opencode.jsonc",
    '{// config\n"provider":{"opencode":{"apiKey":"synthetic-secret","models":{"x":{"name":"Custom X"},"extra":{"name":"Extra"}},"blacklist":["off"]}},}',
  );
  let models = nativeModels({ id: "opencode" }, account, home, {});
  assert.deepEqual(
    models.map((m) => m.model),
    ["x", "extra"],
  );
  assert.equal(models[0].displayName, "Custom X");
  assert.equal(models[0].contextWindow, 128000);
  assert.equal(models[0].wireApi, "openai-responses");
  assert.ok(!JSON.stringify(models).includes("synthetic-secret"));
  write(
    ".config/opencode/opencode.jsonc",
    '{"disabled_providers":["opencode"]}',
  );
  assert.deepEqual(nativeModels({ id: "opencode" }, account, home, {}), []);
});
test("OpenCode honors custom XDG/cache/config paths and plural provider syntax", (t) => {
  const { home, write } = fixture(t),
    a = {
      kind: "native",
      provider: "opencode-go",
      nativeDir: path.join(home, "auth"),
    };
  write("cache/opencode/models.json", {
    "opencode-go": { models: { x: { id: "x" } } },
  });
  const custom = write(
    "custom.jsonc",
    '{"providers":{"opencode-go":{"models":{"x":{"name":"Override","limit":{"context":64000}}}}}}',
  );
  const m = nativeModels({ id: "opencode" }, a, home, {
    XDG_CACHE_HOME: path.join(home, "cache"),
    OPENCODE_CONFIG: custom,
  });
  assert.equal(m[0].displayName, "Override");
  assert.equal(m[0].contextWindow, 64000);
});
test("DSH official API credential gets labeled built-in models even with no explicit plugin model config", (t) => {
  const { home, write } = fixture(t),
    dir = path.join(home, ".dsh"),
    a = { provider: "DEEPSEEK_API_KEY", nativeDir: dir };
  write(".dsh/settings.yaml", "agent-default-model: {}\n");
  const builtin = nativeModels({ id: "dsh" }, a, home, {});
  assert.equal(builtin.length, 4);
  assert.ok(builtin.some((m) => m.model === "deepseek-flash"));
  assert.match(builtin[0].catalogSource, /预置/);
  write(".dsh/settings.yaml", "llm-deepseek:\n  models:\n    - id: selected\n");
  const overridden = nativeModels({ id: "dsh" }, a, home, {});
  assert.deepEqual(
    overridden.map((m) => m.model),
    ["selected"],
  );
  assert.equal(overridden[0].contextWindow, null);
  assert.deepEqual(
    nativeModels(
      { id: "dsh" },
      { ...a, provider: "UNRELATED_API_KEY" },
      home,
      {},
    ),
    [],
  );
});
test("online catalog is account-scoped, including authoritative empty lists and deleted accounts", (t) => {
  const { home } = fixture(t),
    a = {
      id: "one",
      provider: "DEEPSEEK_API_KEY",
      nativeDir: path.join(home, ".dsh"),
    };
  const store = { officialModels: [], providers: [] },
    clients = { clients: [{ id: "dsh", name: "DSH", accounts: [a] }] };
  const directories = {
    "native-dsh": {
      accounts: {
        one: { models: [] },
        deleted: { models: [{ model: "wrong" }] },
      },
    },
  };
  const source = modelSources(store, clients, { home, directories }).find(
    (s) => s.id === "native-dsh",
  );
  assert.deepEqual(source.models, []);
});
test("native official queries select only API key records and reject executable references, OAuth and unknown providers", (t) => {
  const { home, write } = fixture(t),
    file = write(
      ".dsh/.credentials.yaml",
      "version: 1\nrefs:\n  DEEPSEEK_API_KEY: fixture-secret\n",
    );
  const a = {
    id: "a",
    kind: "native",
    provider: "DEEPSEEK_API_KEY",
    authType: "api",
    ready: true,
    sourcePath: file,
  };
  const p = nativeOfficialProvider({ id: "dsh" }, a);
  assert.equal(p.baseUrl, "https://api.deepseek.com");
  assert.equal(p.apiKey, "fixture-secret");
  assert.equal(
    nativeOfficialProvider({ id: "dsh" }, { ...a, authType: "oauth" }),
    null,
  );
  assert.equal(
    nativeOfficialProvider({ id: "dsh" }, { ...a, provider: "anything" }),
    null,
  );
  write(
    ".dsh/.credentials.yaml",
    "version: 1\nrefs:\n  DEEPSEEK_API_KEY: '$COMMAND'\n",
  );
  assert.equal(nativeOfficialProvider({ id: "dsh" }, a), null);
});
test("OpenCode usage exposes three server windows; percentages are used not remaining and resets are dates", () => {
  const data = {
    usage: {
      rolling: { status: "ok", percent: 12, resetsAt: "2026-09-21T12:00:00Z" },
      weekly: { status: "rate-limited", percent: 105 },
      monthly: { status: "ok", percent: 0 },
    },
  };
  const fields = parseRemote("opencode-go", data);
  assert.deepEqual(
    fields.filter((f) => f.kind === "quota").map((f) => f.remainingPercent),
    [88, 0, 100],
  );
  assert.equal(fields[0].resetsAt, "2026-09-21T12:00:00.000Z");
  assert.throws(
    () =>
      parseRemote("opencode-go", {
        usage: { rolling: { status: "ok", percent: "unknown" } },
      }),
    /未返回/,
  );
  assert.equal(
    adapter({ baseUrl: "https://opencode.ai/zen/go/v1" }),
    "opencode-go",
  );
  assert.equal(
    adapter({ baseUrl: "https://opencode.ai.evil.test/zen/go/v1" }),
    null,
  );
  assert.equal(
    adapter({ baseUrl: "https://opencode.ai/zen/go/v1?token=secret" }),
    null,
  );
  assert.equal(
    apiProfile({ baseUrl: "https://opencode.ai/zen/v1", apiKey: "fixture" })
      .canRefresh,
    true,
  );
});
