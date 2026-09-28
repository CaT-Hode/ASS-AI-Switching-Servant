const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { ProtocolNegotiation } = require("../core/protocol-negotiation.cjs");
const { nativeProbe } = require("../core/model-inspection.cjs");
const { HarnessManager } = require("../core/harnesses.cjs");
const { ProxyConfig } = require("../core/proxy-config.cjs");
const { Store } = require("../core/store.cjs");
const { ConfigManager } = require("../core/config.cjs");
const { compose } = require("../core/native-config.cjs");
const crypt = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() };
const sse = events => new Response(events.map(e => "data: " + JSON.stringify(e) + "\n\n").join(""));
function success(protocol) {
  return protocol === "anthropic" ? sse([{ type: "content_block_delta", delta: { type: "text_delta", text: "437" } }, { type: "message_stop" }])
    : protocol === "openai-chat" ? sse([{ choices: [{ delta: { content: "437" }, finish_reason: "stop" }] }])
    : sse([{ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "437" }] }] } }]);
}
function fixture(t, fetcher) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ass-protocol-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = new Store(dataDir, path.join(dataDir, "codex"), crypt);
  store.updateProvider({ id: "test", baseUrl: "https://example.test/v1", apiKey: "synthetic-private", models: [{ model: "alpha", wireApi: "openai-chat" }] });
  const p = store.state.providers[0], m = p.models[0], calls = [];
  const options = { dataDir, crypto: crypt, getProviders: () => store.state.providers,
    fetcher: async (url, init) => { calls.push(url); return fetcher ? fetcher(url, init) : success(url.endsWith("/messages") ? "anthropic" : "openai-responses"); } };
  const protocols = new ProtocolNegotiation(options);
  return { dataDir, store, p, m, options, protocols, calls };
}
test("checks both native protocols, selects per client, persists and avoids duplicate probes", async t => {
  const f = fixture(t);
  await Promise.all([f.protocols.ensure(f.p, f.m), f.protocols.ensure(f.p, f.m)]);
  assert.deepEqual(f.calls.map(u => u.split("/").at(-1)), ["responses", "messages"]);
  assert.equal(f.protocols.select(f.p, f.m, "claude"), "anthropic");
  for (const id of ["codex", "opencode", "pi", "dsh", "kimi", "zcode"]) assert.equal(f.protocols.select(f.p, f.m, id), "openai-responses");
  const reloaded = new ProtocolNegotiation(f.options);
  await reloaded.ensure(f.p, f.m); assert.equal(f.calls.length, 2);
  assert.equal(f.m.wireApi, "openai-chat", "initial hint is not permanently rewritten");
  assert.doesNotMatch(JSON.stringify(reloaded.public()), /synthetic-private|fingerprint/);
});
test("Chat is tested when neither native protocol works; 502 does not mean unsupported", async t => {
  const f = fixture(t, (url) => url.endsWith("completions") ? success("openai-chat") : Response.json({}, { status: url.endsWith("responses") ? 502 : 405 }));
  await f.protocols.ensure(f.p, f.m);
  assert.equal(f.calls.length, 3);
  const r = f.protocols.get(f.p, f.m);
  assert.equal(r.protocols["openai-responses"].status, "unknown");
  assert.equal(r.protocols.anthropic.status, "unsupported");
  assert.equal(f.protocols.select(f.p, f.m, "claude"), "openai-chat");
});
test("transient failures retain last success, explicit endpoint rejection invalidates it", async t => {
  const f = fixture(t); await f.protocols.ensure(f.p, f.m);
  f.protocols.fetcher = async () => Response.json({}, { status: 502 });
  await f.protocols.ensure(f.p, f.m, { force: true });
  assert.equal(f.protocols.select(f.p, f.m, "codex"), "openai-responses");
  assert.equal(f.protocols.get(f.p, f.m).protocols["openai-responses"].lastStatus, "unknown");
  f.protocols.fetcher = async url => url.endsWith("messages") ? success("anthropic") : Response.json({}, { status: 405 });
  await f.protocols.ensure(f.p, f.m, { force: true });
  assert.equal(f.protocols.select(f.p, f.m, "codex"), "anthropic");
});
test("identity, endpoint, model, network and header edits invalidate evidence; presentation edits do not", async t => {
  const f = fixture(t); await f.protocols.ensure(f.p, f.m);
  for (const changes of [{ apiKey: "new" }, { baseUrl: "https://other.test/v1" }, { network: "direct" }, { extraHeaders: { tag: "new" } }])
    assert.equal(f.protocols.get({ ...f.p, ...changes }, f.m), null);
  assert.equal(f.protocols.get(f.p, { ...f.m, model: "other" }), null);
  assert.ok(f.protocols.get({ ...f.p, name: "Renamed" }, { ...f.m, displayName: "Renamed", wireApi: "anthropic" }));
});
test("aborted probes and results from replaced credentials never get persisted", async t => {
  const f = fixture(t); const controller = new AbortController();
  f.protocols.fetcher = async () => { controller.abort(); return success("openai-responses"); };
  await assert.rejects(f.protocols.ensure(f.p, f.m, { signal: controller.signal }));
  assert.equal(f.protocols.get(f.p, f.m), null);
  const old = structuredClone(f.p); f.p.apiKey = "changed";
  assert.equal(f.protocols.record(old, f.m, { time: new Date().toISOString(), protocols: { anthropic: { status: "passed" } } }), false);
});
test("auth and rate limits stop extra chargeable probes; expiry checks again", async t => {
  const f = fixture(t, () => Response.json({}, { status: 429 }));
  await f.protocols.ensure(f.p, f.m); assert.equal(f.calls.length, 1);
  f.protocols.fetcher = async url => success(url.endsWith("messages") ? "anthropic" : "openai-responses");
  f.protocols.now = () => Date.now() + 25 * 3600000;
  await f.protocols.ensure(f.p, f.m); assert.equal(f.protocols.select(f.p, f.m, "codex"), "openai-responses");
});
test("DeepSeek probe and native injection share its actual Messages endpoint", async t => {
  const f = fixture(t); f.p.baseUrl = "https://api.deepseek.com/v1";
  await nativeProbe(f.p, f.m, "anthropic", async (url, init) => {
    assert.equal(url, "https://api.deepseek.com/anthropic/v1/messages");
    assert.equal(init.headers["x-api-key"], f.p.apiKey); return success("anthropic");
  });
});
test("effective protocol reaches native configs and applied proxy snapshots without mutating a running route", async t => {
  const f = fixture(t); await f.protocols.ensure(f.p, f.m);
  const manager = new HarnessManager(f.dataDir, () => f.store.state, [], f.store.codexDir,
    { home: path.join(f.dataDir, "home"), env: {}, protocols: f.protocols });
  const proxy = new ProxyConfig(f.dataDir, crypt, manager, f.store, new ConfigManager(f.store.codexDir, f.dataDir));
  assert.equal(proxy.desired("codex").providers[0].models[0].wireApi, "openai-responses");
  assert.equal(proxy.desired("claude").providers[0].models[0].wireApi, "anthropic");
  proxy.sync("claude");
  f.protocols.record(f.p, f.m, { time: new Date().toISOString(), protocols: { anthropic: { status: "rejected", unsupported: true } } });
  assert.equal(proxy.routingState("claude").providers[0].models[0].wireApi, "anthropic");
  assert.equal(proxy.desired("claude").providers[0].models[0].wireApi, "openai-responses");
  const native = compose("pi", manager);
  assert.ok(native.fields.some(f => f.value?.api === "openai-responses"));
});
