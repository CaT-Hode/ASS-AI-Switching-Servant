const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { scan, readJsonl } = require("../core/usage-readers.cjs");
const { readZCode, zcodeFiles } = require("../core/usage-extra.cjs");
const { UsageHistory } = require("../core/usage-history.cjs");
const now = new Date(2026, 8, 23, 14).getTime();
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ass-extra-usage-"));
  const cleanup = [];
  t.after(() => {
    for (const close of cleanup) close();
    assert.equal(path.dirname(home), os.tmpdir()); assert.ok(path.basename(home).startsWith("ass-extra-usage-"));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const put = (name, text) => {
    const f = path.join(home, name); fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof text === "string" ? text : JSON.stringify(text)); return f;
  };
  return { home, put, cleanup, options: { home, dataDir: home, env: {}, now } };
}
const lines = (xs) => xs.map((x) => JSON.stringify(x)).join("\n") + "\n";
const usage = (n = 10, extra = {}) => ({ type: "usage.record", model: "display-alias", agentId: "main", time: now,
  usage: { inputOther: n, inputCacheRead: 5, inputCacheCreation: 2, output: 4, raw: { private: "never-export" } }, ...extra });
const request = { type: "llm.request", agentId: "main", provider: "provider-a", model: "model-a", modelAlias: "display-alias", systemPrompt: "never-export" };
const legacy = (id, n = 8) => ({ timestamp: now / 1000, message: { type: "StatusUpdate", payload: {
  message_id: id, token_usage: { input_other: n, input_cache_read: 3, input_cache_creation: 1, output: 2 } } } });
function database(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE model_usage (id TEXT PRIMARY KEY, session_id TEXT, provider_id TEXT, model_id TEXT,
    started_at INTEGER, status TEXT, input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
    cache_creation_input_tokens INTEGER, cache_read_input_tokens INTEGER, provider_total_tokens INTEGER,
    computed_total_tokens INTEGER, raw_usage_json TEXT, error_message TEXT)`);
  const add = (id, overrides = {}) => {
    const r = { id, session_id: "private-session", provider_id: "provider-z", model_id: "model-z", started_at: now,
      status: "completed", input_tokens: 100, output_tokens: 20, reasoning_tokens: 8,
      cache_creation_input_tokens: 10, cache_read_input_tokens: 60, provider_total_tokens: 120,
      computed_total_tokens: 120, raw_usage_json: "private-prompt", error_message: "private-secret", ...overrides };
    db.prepare("INSERT OR REPLACE INTO model_usage VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(...Object.values(r));
  };
  return { db, add };
}

test("Kimi current wire normalizes cache, preserves same-millisecond calls, ignores cumulative views and message copies", async (t) => {
  const f = fixture(t), file = f.put("wire.jsonl", lines([request, usage(), request, usage(20),
    { type: "agent.status.updated", usage: { total: { inputOther: 9999, output: 1000 } } },
    { type: "agent.message.appended", message: { meta: { usage: usage().usage } } }]));
  const r = await readJsonl(file, "kimi", "file", { session: "session-a" });
  assert.equal(r.rows.length, 2); assert.deepEqual(r.rows.map((r) => r.input), [17, 27]);
  assert.ok(r.rows.every((r) => r.provider === "provider-a" && r.model === "model-a"));
  assert.equal(r.rows[0].hour, new Date(now).getHours());
  assert.doesNotMatch(JSON.stringify(r), /never-export|systemPrompt|session-a/);
});

test("Kimi fork marker discards inherited usage; compaction and subagents retain actual spend", async (t) => {
  const f = fixture(t), base = ".kimi-code/sessions/work/session-fork/agents/";
  f.put(base + "main/wire.jsonl", lines([request, usage(900), { type: "forked", time: now }, request, usage(10),
    { ...request, kind: "compaction", model: "small-model", modelAlias: "compact" }, usage(4, { model: "compact" })]));
  f.put(base + "agent-0/wire.jsonl", lines([{ ...request, agentId: "agent-0" }, usage(5, { agentId: "agent-0" })]));
  const r = await scan(f.options), rows = r.snapshot.rows;
  assert.equal(rows.reduce((s, r) => s + r.input, 0), 40);
  assert.equal(rows.reduce((s, r) => s + r.calls, 0), 3);
  assert.equal(new Set(rows.flatMap((r) => r.sessions)).size, 1);
});

test("Kimi legacy StatusUpdate deduplicates message revisions and copies without guessing model/provider", async (t) => {
  const f = fixture(t), content = lines([legacy("msg-1", 2), legacy("msg-1", 8),
    { timestamp: now / 1000, message: { type: "StatusUpdate", payload: { context_tokens: 10000 } } }]);
  f.put(".kimi/sessions/work/session-a/wire.jsonl", content);
  f.put(".kimi/sessions/work/session-b/wire.jsonl", content);
  const r = await scan(f.options);
  assert.equal(r.snapshot.rows.length, 1);
  assert.equal(r.snapshot.rows[0].input, 12); assert.equal(r.snapshot.rows[0].calls, 1);
  assert.equal(r.snapshot.rows[0].model, "未标注"); assert.equal(r.snapshot.rows[0].provider, "未标注");
});

test("Kimi discovery honors custom roots, ignores other JSONL/imported sessions, and updates when sidecar changes", async (t) => {
  const f = fixture(t), base = "custom/sessions/work/session-a/";
  f.put(base + "agents/main/wire.jsonl", lines([request, usage()]));
  f.put(base + "context.jsonl", lines([usage(900)]));
  const opts = { ...f.options, env: { KIMI_CODE_HOME: path.join(f.home, "custom") } };
  let r = await scan(opts); assert.equal(r.snapshot.rows[0].input, 17);
  f.put(base + "state.json", { custom: { imported_from_kimi_cli: true } });
  r = await scan(opts, r.cache); assert.equal(r.snapshot.rows.length, 0);
  f.put(base + "state.json", "broken"); r = await scan(opts, r.cache);
  assert.equal(r.snapshot.sources.find((s) => s.client === "kimi").status, "partial");
});

test("ZCode current and legacy cache semantics match native totals; reasoning is a subset and unfinished rows are excluded", (t) => {
  const f = fixture(t), file = path.join(f.home, "z.db"), { db, add } = database(file);
  add("current"); add("legacy", { input_tokens: 30, provider_total_tokens: 120 });
  add("cached-only", { input_tokens: 0, provider_total_tokens: 90 });
  add("failed", { status: "error", input_tokens: 5, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, provider_total_tokens: 5 });
  add("in-progress", { status: "running", input_tokens: 9999 }); db.close();
  const bytes = fs.readFileSync(file), r = readZCode(file);
  assert.deepEqual(r.rows.map((r) => r.input), [100, 100, 70, 5]);
  assert.equal(r.rows[0].output, 20); assert.equal(r.rows[0].reasoning, 8);
  assert.equal(r.rows[3].reasoning, 0); assert.deepEqual(fs.readFileSync(file), bytes);
  assert.doesNotMatch(JSON.stringify(r), /private-prompt|private-secret|private-session/);
});

test("ZCode environment DB path is independent of credentials, respects aliases, and refuses relative paths", (t) => {
  const f = fixture(t), source = {};
  const file = path.join(f.home, "custom/data.db");
  assert.deepEqual(zcodeFiles({ ...f.options, overrides: { zcode: path.join(f.home, "other/.zcode/v2") } }, source),
    [path.join(f.home, ".zcode/cli/db/db.sqlite")]);
  assert.deepEqual(zcodeFiles({ ...f.options, env: { ZCODE_SESSION_DB: "~/one.db", ZCODE_SESSION_DB_PATH: file } }, source), [file]);
  assert.deepEqual(zcodeFiles({ ...f.options, env: { ZCODE_SESSION_DB_PATH: "project.db" } }, source), []);
  assert.equal(source.partial, true);
});

test("ZCode WAL invalidates cache and previously observed pruned history remains in annual totals", async (t) => {
  const f = fixture(t), file = path.join(f.home, ".zcode/cli/db/db.sqlite"), { db, add } = database(file);
  f.cleanup.push(() => db.close()); db.exec("PRAGMA journal_mode=WAL");
  const old = now - 40 * 86400000;
  add("old", { started_at: old }); add("recent");
  let r = await scan(f.options); assert.equal(r.snapshot.rows.reduce((s, r) => s + r.calls, 0), 2);
  db.prepare("DELETE FROM model_usage WHERE id=?").run("old");
  add("recent", { output_tokens: 40, provider_total_tokens: 140 });
  r = await scan(f.options, r.cache);
  assert.equal(r.snapshot.rows.reduce((s, r) => s + r.calls, 0), 2);
  assert.equal(r.snapshot.rows.reduce((s, r) => s + r.output, 0), 60);
  const { summarize } = await import("../src/usage-view.mjs");
  const year = summarize(r.snapshot.rows, { range: "year", client: "zcode", group: "model" }, new Date(now));
  const month = summarize(r.snapshot.rows, { range: "month", client: "zcode", group: "model" }, new Date(now));
  assert.equal(year.total.calls, 2); assert.equal(month.total.calls, 1);
});

test("both harnesses flow through worker, persistent cache and existing weekly/monthly/client grouping", async (t) => {
  const f = fixture(t); f.put(".kimi-code/sessions/work/session-a/agents/main/wire.jsonl", lines([request, usage()]));
  const { db, add } = database(path.join(f.home, ".zcode/cli/db/db.sqlite")); add("one"); db.close();
  const options = { dataDir: f.home, crypto: { isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() }, getOptions: () => f.options };
  const history = new UsageHistory(options); await history.refresh();
  assert.equal(history.public().error, undefined); assert.equal(history.public().rows.length, 2);
  assert.deepEqual(new UsageHistory(options).public(), history.public());
  const { summarize } = await import("../src/usage-view.mjs");
  for (const range of ["week", "month", "year"]) {
    const all = summarize(history.public().rows, { range, client: "all", group: "client" }, new Date(now));
    assert.equal(all.total.input, 117); assert.equal(all.total.output, 24); assert.equal(all.groups.length, 2);
    const kimi = summarize(history.public().rows, { range, client: "kimi", group: "model" }, new Date(now));
    assert.equal(kimi.total.input, 17); assert.equal(kimi.total.calls, 1);
  }
});

test("unreadable ZCode database retains observed metadata and retries after repair", async (t) => {
  const f = fixture(t), file = path.join(f.home, ".zcode/cli/db/db.sqlite"), { db, add } = database(file);
  add("one"); db.close();
  const bytes = fs.readFileSync(file), first = await scan(f.options);
  fs.writeFileSync(file, "not-a-database");
  const partial = await scan(f.options, first.cache);
  assert.equal(partial.snapshot.sources.find((s) => s.client === "zcode").status, "partial");
  assert.deepEqual(partial.snapshot.rows, first.snapshot.rows);
  fs.writeFileSync(file, bytes);
  const restored = await scan(f.options, partial.cache);
  assert.equal(restored.snapshot.sources.find((s) => s.client === "zcode").status, "ready");
});
