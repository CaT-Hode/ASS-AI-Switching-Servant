const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  modelKey,
  declaredCapabilities,
  discoverModels,
  probeCapabilities,
  inspectStream,
} = require("../core/model-inspection.cjs");
const p = {
  id: "fixture",
  baseUrl: "https://example.com/v1",
  apiKey: "synthetic-secret",
  wireApi: "openai-responses",
  network: "system",
};
const m = {
  model: "fixture-model",
  wireApi: "openai-responses",
  efforts: ["low", "max"],
};
const stream = (events) =>
  new Response(
    events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
function success(body) {
  const marker = body.input.match(/marker ([a-f0-9]+)/)?.[1];
  return stream([
    {
      type: "response.completed",
      response: {
        status: "completed",
        output: body.tools
          ? [
              {
                type: "function_call",
                id: "call",
                name: "ass_probe_echo",
                arguments: JSON.stringify({ marker }),
              },
            ]
          : [
              {
                type: "message",
                content: [{ type: "output_text", text: "437" }],
              },
            ],
      },
    },
  ]);
}
test("per-model diagnostic identities cannot conflate providers or models", () => {
  assert.notEqual(modelKey("one", "model"), modelKey("two", "model"));
  assert.notEqual(modelKey("one", "a"), modelKey("one", "b"));
  assert.notEqual(modelKey("a::b", "c"), modelKey("a", "b::c"));
});
test("metadata preserves uncertainty and distinguishes statements from configured defaults", () => {
  assert.equal(declaredCapabilities({ id: "gpt-any" }).contextWindow, null);
  assert.equal(declaredCapabilities({}).tools, null);
  const value = declaredCapabilities({
    context_length: 65536,
    supported_parameters: ["tools", "reasoning"],
    architecture: { input_modalities: ["text", "image"] },
    supported_reasoning_levels: [{ effort: "low" }, "max", "imaginary"],
  });
  assert.equal(value.contextWindow, 65536);
  assert.equal(value.vision, true);
  assert.deepEqual(value.efforts, ["low", "max"]);
  assert.doesNotThrow(() =>
    declaredCapabilities({ supported_reasoning_levels: "malformed" }),
  );
});
test("discovery uses same-origin API credentials, bounded fields and no redirected auth", async () => {
  const report = await discoverModels(p, async (url, options) => {
    assert.equal(url, "https://example.com/v1/models");
    assert.equal(options.headers.authorization, "Bearer synthetic-secret");
    assert.equal(options.redirect, "error");
    return Response.json({
      data: [
        { id: "a", private_secret: "not-for-ui" },
        { id: "a" },
        { id: "b", context_window: 12345 },
      ],
    });
  });
  assert.equal(report.models.length, 2);
  assert.ok(!JSON.stringify(report).includes("not-for-ui"));
});
test("real tool structure is observed, effort acceptance requires an invalid-value control", async () => {
  const report = await probeCapabilities(p, m, async (_, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, m.model);
    assert.equal(body.max_output_tokens, 512);
    if (body.reasoning?.effort === "ass_invalid_effort")
      return Response.json(
        { error: { message: "invalid reasoning effort" } },
        { status: 400 },
      );
    return success(body);
  });
  assert.equal(report.tools.status, "observed");
  assert.equal(report.efforts.max.status, "validated");
  assert.equal(report.requestCount, 5);
  assert.ok(!JSON.stringify(report).includes(p.apiKey));
});
test("HTTP 200 for invalid effort does not prove intensity support", async () => {
  const report = await probeCapabilities(p, m, async (_, options) =>
    success(JSON.parse(options.body)),
  );
  assert.equal(report.efforts.low.status, "accepted-unverified");
  assert.equal(report.efforts.max.status, "accepted-unverified");
});
test("truncated responses are unknown; rate limits stop rather than causing more probes", async () => {
  const parsed = await inspectStream(
    stream([{ type: "response.output_text.delta", delta: "partial" }]).body,
    "openai-responses",
    "unused",
  );
  assert.equal(parsed.completed, false);
  const report = await probeCapabilities(p, m, async () =>
    Response.json({ error: "rate limit" }, { status: 429 }),
  );
  assert.equal(report.requestCount, 1);
  assert.deepEqual(report.efforts, {});
});
test("cancellation prevents additional requests", async () => {
  const controller = new AbortController();
  const report = await probeCapabilities(
    p,
    m,
    async (_, options) => {
      controller.abort();
      return success(JSON.parse(options.body));
    },
    { signal: controller.signal },
  );
  assert.equal(report.cancelled, true);
  assert.equal(report.requestCount, 1);
});
