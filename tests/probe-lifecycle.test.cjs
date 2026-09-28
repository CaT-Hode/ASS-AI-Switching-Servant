const { test } = require("node:test");
const assert = require("node:assert/strict");
const { nativeProbe } = require("../core/model-inspection.cjs");
const { Router } = require("../core/router.cjs");
const { prepareConfig } = require("../core/config.cjs");
const { routeConfig } = require("../core/harnesses.cjs");
const p = { id: "fixture", enabled: true, apiKey: "fixture-only", baseUrl: "https://example.test/v1" };
const m = { model: "fixture", enabled: true, wireApi: "openai-responses", defaultEffort: "medium", efforts: ["medium"] };
for (const protocol of ["openai-responses", "anthropic", "openai-chat"]) test(`${protocol} completion does not wait for a keep-alive connection to close`, async () => {
  let cancelled = false;
  const events = protocol === "anthropic" ? [{ type: "content_block_delta", delta: { type: "text_delta", text: "437" } }, { type: "message_stop" }]
    : protocol === "openai-chat" ? [{ choices: [{ delta: { content: "437" }, finish_reason: "stop" }] }]
    : [{ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "437" }] }] } }];
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(events.map(e => "data: " + JSON.stringify(e) + "\n\n").join(""))); }, cancel() { cancelled = true; } });
  const result = await nativeProbe(p, m, protocol, async () => new Response(body), { timeoutMs: 150 });
  assert.equal(result.status, "passed"); assert.equal(cancelled, true);
});
test("a fetch ignoring abort cannot hold the caller past the hard deadline", async () => {
  let signal;
  const result = await nativeProbe(p, m, m.wireApi, async (_url, init) => { signal = init.signal; return new Promise(() => {}); }, { timeoutMs: 25 });
  assert.equal(result.status, "unknown"); assert.equal(signal.aborted, true);
  assert.ok(result.ms < 1000);
});
test("stalled success/error bodies are cancelled and never marked unsupported", async () => {
  for (const status of [200, 405]) {
    let cancelled = false;
    const result = await nativeProbe(p, m, m.wireApi, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status }), { timeoutMs: 25 });
    assert.equal(result.status, "unknown"); assert.equal(cancelled, true); assert.equal(result.unsupported, undefined);
  }
});
test("clients/ASS is a Codex alias with identical credential, switch and applied-snapshot boundaries", async t => {
  let enabled = true; const clients = [], calls = [];
  const router = new Router({ getState: id => { clients.push(id); return { providers: [{ ...p, models: [m] }] }; }, allowClient: id => id === "codex" && enabled,
    fetchUpstream: async (url, init) => { calls.push({ url, init }); return new Response('data: {"type":"response.completed"}\n\n', { headers: { "content-type": "text/event-stream" } }); } });
  await router.start(0); t.after(() => router.stop());
  const send = route => fetch(`http://127.0.0.1:${router.port}/clients/${route}/v1/responses`, { method: "POST", headers: { authorization: "Bearer " + router.clientToken }, body: JSON.stringify({ model: "fixture::fixture", stream: true }) });
  for (const route of ["ASS", "codex"]) { const r = await send(route); assert.equal(r.status, 200); await r.text(); }
  assert.deepEqual(clients, ["codex", "codex"]); assert.equal(calls.length, 2);
  enabled = false;
  assert.equal((await send("ASS")).status, 503); assert.equal(calls.length, 2);
  assert.match(prepareConfig("", "catalog.json").text, /clients\/ASS\/v1/);
  const plan = routeConfig("codex", p, m, "C:/fixture", "local", { models: [] }, 12345);
  assert.match(plan.files.find(([name]) => name === "config.toml")[1], /12345\/clients\/ASS\/v1/);
});
