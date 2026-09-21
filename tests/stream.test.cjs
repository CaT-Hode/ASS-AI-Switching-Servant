const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SseMonitor } = require("../core/sse-monitor.cjs");
const { Router } = require("../core/router.cjs");
test("SSE monitor handles split UTF8/CRLF and rejects truncated or failed streams", () => {
  const monitor = new SseMonitor(),
    bytes = Buffer.from(
      'data: {"type":"response.output_text.delta","delta":"你好"}\r\n\r\ndata: {"type":"response.completed"}\r\n\r\n',
    );
  for (const byte of bytes) monitor.feed(Uint8Array.of(byte));
  monitor.feed(null, true);
  assert.equal(monitor.ended, true);
  assert.throws(() => new SseMonitor().feed(null, true));
  assert.throws(() =>
    new SseMonitor().feed(Buffer.from('data: {"type":"response.failed"}\n\n')),
  );
});
test("official Responses missing Content-Type is sniffed safely, HTML is rejected", async (t) => {
  let html = false;
  const router = new Router({
    getState: () => ({ providers: [] }),
    fetchUpstream: async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              Buffer.from(
                html
                  ? "<html>blocked</html>"
                  : 'event: response.completed\ndata: {"type":"response.completed"}\n\n',
              ),
            );
            c.close();
          },
        }),
      ),
  });
  router.port = 0;
  await router.start();
  router.port = router.server.address().port;
  t.after(() => router.stop());
  const request = () =>
    fetch("http://127.0.0.1:" + router.port + "/v1/responses", {
      method: "POST",
      headers: {
        authorization: "Bearer synthetic",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-test", stream: true, input: "hi" }),
    });
  const success = await request();
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("content-type"), "text/event-stream");
  assert.match(await success.text(), /response.completed/);
  html = true;
  const error = await request();
  assert.equal(error.status, 502);
  assert.match(await error.text(), /SSE/);
});
