const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Router } = require("../core/router.cjs");
const { claudeModels, resolveClaudeModel } = require("../core/claude-models.cjs");
const { claudeModelSettings } = require("../core/accountless.cjs");
const providers = [{ id: "relay", name: "Relay", enabled: true, apiKey: "synthetic-key", baseUrl: "https://relay.test/v1", models: [
  { model: "kimi/messages", enabled: true, wireApi: "anthropic" },
  { model: "gpt-test", enabled: true, wireApi: "openai-responses" },
  { model: "deepseek-chat", enabled: true, wireApi: "openai-chat" },
  { model: "claude-opus", enabled: true, wireApi: "anthropic" },
  { model: "disabled", enabled: false, wireApi: "anthropic" },
] }];
test("native Messages and both converted protocols share the full picker and discovery catalog", () => {
  const rows = claudeModels(providers), settings = claudeModelSettings(providers, "relay::kimi/messages");
  assert.equal(rows.length, 4); assert.equal(settings.modelPicker.options.length, 4);
  assert.ok(rows.every(m => /claude|anthropic/i.test(m.discoveryId)));
  for (const m of rows) {
    assert.equal(resolveClaudeModel(providers, m.discoveryId), m.model);
    assert.equal(resolveClaudeModel(providers, m.model), m.model);
    assert.equal(resolveClaudeModel(providers, m.discoveryId + "[1m]"), m.model);
  }
  assert.equal(resolveClaudeModel(providers, "claude-ass/foreign::model"), "claude-ass/foreign::model");
  assert.equal(claudeModels([{ ...providers[0], enabled: false }]).length, 0);
});
test("discovery aliases really call the original model on its negotiated upstream protocol", async t => {
  const calls = [];
  const router = new Router({ getState: () => ({ providers }), fetchUpstream: async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, model: body.model });
    const events = url.endsWith("messages") ? [{ type: "content_block_start", index: 0, content_block: { type: "text", text: "OK" } }, { type: "message_stop" }]
      : url.endsWith("responses") ? [{ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }] } }]
      : [{ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }] }];
    return new Response(events.map(e => "data: " + JSON.stringify(e) + "\n\n").join(""));
  } });
  await router.start(0); t.after(() => router.stop());
  const base = `http://127.0.0.1:${router.port}/clients/claude/models/v1`, headers = { authorization: "Bearer " + router.clientToken };
  const directory = await (await fetch(base + "/models", { headers })).json();
  assert.equal(directory.data.length, 4);
  for (const m of directory.data) {
    const response = await fetch(base + "/messages?beta=true", { method: "POST", headers, body: JSON.stringify({
      model: m.id, messages: [{ role: "user", content: "OK" }], stream: true, max_tokens: 16,
    }) });
    assert.equal(response.status, 200); const text = await response.text(); assert.match(text, /OK/); assert.match(text, /message_stop/);
  }
  assert.deepEqual(calls.map(c => c.model), providers[0].models.filter(m => m.enabled).map(m => m.model));
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ["/v1/messages", "/v1/responses", "/v1/chat/completions", "/v1/messages"]);
});
