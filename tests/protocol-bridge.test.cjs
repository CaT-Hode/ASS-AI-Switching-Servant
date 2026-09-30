const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Router } = require("../core/router.cjs");
const { toolBridge } = require("../core/tool-bridge.cjs");
const { messagesRequest, messagesJSON, messagesEvents, normalizeMessages } = require("../core/messages-adapter.cjs");
const { convertRequest, translateStream } = require("../core/adapters.cjs");
const sse = events => new Response(events.map(e => "data: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
const m = { model: "test", maxOutputTokens: 2048 };
test("CC's additional system/developer turns are preserved across all upstream protocols", () => {
  const body = { system: [{ type: "text", text: "top" }], messages: [{ role: "user", content: "hello" }, { role: "system", content: [{ type: "text", text: "extra" }] }, { role: "developer", content: "developer" }], max_tokens: 1 };
  const native = normalizeMessages(body);
  assert.deepEqual(native.messages, [body.messages[0]]);
  assert.deepEqual(native.system.map(v => v.text), ["top", "extra", "developer"]);
  for (const protocol of ["openai-responses", "openai-chat"]) {
    const r = messagesRequest(body, m, protocol);
    assert.equal(protocol === "openai-responses" ? r.instructions : r.messages[0].content, "top\n\nextra\n\ndeveloper");
  }
});
test("image content is not silently stripped from Messages or Responses histories", () => {
  const body = { messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }] };
  const r = messagesRequest(body, m, "openai-responses");
  assert.equal(r.input[0].content[0].image_url, "data:image/png;base64,AAAA");
  assert.equal(messagesRequest(body, m, "openai-chat").messages[0].content[0].image_url.url, "data:image/png;base64,AAAA");
  assert.deepEqual(convertRequest(r, m, "anthropic").messages[0].content[0].source, body.messages[0].content[0].source);
});
test("namespace functions and custom raw tools round-trip identity, arguments, history and sequence", async () => {
  const body = { tools: [{ type: "namespace", name: "files", tools: [
    { type: "function", name: "read", parameters: { type: "object" } }, { type: "custom", name: "patch", description: "Apply a patch", format: { syntax: "lark", definition: "start: /.+/" } },
  ] }], input: [{ type: "custom_tool_call", namespace: "files", name: "patch", call_id: "old", input: "old text" }, { type: "custom_tool_call_output", call_id: "old", output: "done" }] };
  const bridge = toolBridge(body), name = bridge.request.tools[1].name;
  assert.equal(JSON.parse(bridge.request.input[0].arguments).input, "old text");
  assert.equal(bridge.request.input[0].namespace, undefined);
  assert.equal(bridge.request.input[1].type, "function_call_output");
  const raw = '{"input":"new\\npatch"}';
  const events = [];
  for await (const e of bridge.restore(translateStream(sse([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call1", function: { name, arguments: raw.slice(0, 10) } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: raw.slice(10) } }] }, finish_reason: "tool_calls" }] },
  ]).body, "openai-chat", "test"))) events.push(e);
  const result = events.at(-1).response.output[0];
  assert.equal(result.type, "custom_tool_call"); assert.equal(result.input, "new\npatch");
  assert.equal(result.name, "patch"); assert.equal(result.namespace, "files"); assert.equal(result.call_id, "call1");
  assert.equal(events.filter(e => e.type === "response.custom_tool_call_input.delta").length, 1);
  assert.deepEqual(events.map(e => e.sequence_number), events.map((_, i) => i));
  assert.ok(!events.some(e => e.type === "response.function_call_arguments.delta"));
});
test("complete tool arguments in Anthropic start events are retained", async () => {
  const body = sse([{ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "a", name: "echo", input: { marker: "ok" } } }, { type: "message_stop" }]);
  const events = []; for await (const e of translateStream(body.body, "anthropic", "test")) events.push(e);
  assert.equal(events.at(-1).response.output[0].arguments, '{"marker":"ok"}');
});
for (const client of ["codex", "claude"]) for (const wireApi of ["openai-responses", "anthropic", "openai-chat"]) {
  test(`${client} routes and completes via ${wireApi}, without forwarding official credentials`, async t => {
    const provider = { id: "p", name: "fixture", enabled: true, apiKey: "synthetic-upstream", baseUrl: "https://provider.test/v1", models: [{ ...m, enabled: true, wireApi, defaultEffort: "medium" }] };
    const calls = [];
    const router = new Router({ getState: () => ({ providers: [provider] }), fetchUpstream: async (url, init) => {
      calls.push({ url, init }); const body = JSON.parse(init.body);
      assert.equal(body.model, "test");
      assert.equal(init.headers["chatgpt-account-id"], undefined);
      assert.equal(init.redirect, "error");
      return wireApi === "anthropic" ? sse([{ type: "message_start", message: { usage: { input_tokens: 2 } } }, { type: "content_block_start", index: 0, content_block: { type: "text", text: "OK" } }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }, { type: "message_stop" }])
        : wireApi === "openai-chat" ? sse([{ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }] }])
        : sse([{ type: "response.completed", response: { status: "completed", output: [{ type: "message", id: "one", content: [{ type: "output_text", text: "OK" }] }] } }]);
    } });
    await router.start(0); t.after(() => router.stop());
    const url = `http://127.0.0.1:${router.port}/clients/${client === "codex" ? "ASS" : client}` + (client === "codex" ? "/v1/responses" : "/models/v1/messages");
    const model = client === "codex" ? require("../core/models.cjs").codexModelId("p", "test") : "p::test";
    const r = await fetch(url, { method: "POST", headers: { authorization: "Bearer " + router.clientToken, "content-type": "application/json", "chatgpt-account-id": "synthetic-official-id" }, body: JSON.stringify({ model, stream: true, input: "hello", messages: [{ role: "user", content: "hello" }], max_tokens: 32 }) });
    assert.equal(r.status, 200); const text = await r.text();
    assert.match(text, /OK/); assert.match(text, client === "codex" ? /response.completed/ : /message_stop/);
    assert.equal(calls.length, 1); assert.doesNotMatch(text, /synthetic/);
  });
}
