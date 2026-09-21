const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DiagnosticBatch,
  diagnosticTargets,
} = require("../core/diagnostic-batch.cjs");
const { Router } = require("../core/router.cjs");
const targets = () =>
  Array.from({ length: 5 }, (_, i) => ({
    key: String(i),
    providerId: "p",
    model: String(i),
    skip: i === 4 ? "disabled" : "",
  }));
test("batch snapshots eligibility, continues after failures, caps concurrency and forbids duplicate start", async () => {
  let active = 0,
    peak = 0,
    calls = [];
  const batch = new DiagnosticBatch({
    targets,
    run: async (_, id) => {
      active++;
      peak = Math.max(active, peak);
      calls.push(id);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (id === "1") throw Error("private server error");
      return { ok: true, message: "complete", ms: 5 };
    },
  });
  batch.start();
  assert.throws(() => batch.start(), /正在进行/);
  await batch.finished;
  assert.equal(peak, 2);
  assert.equal(calls.length, 4);
  const s = batch.snapshot();
  assert.deepEqual(
    [s.total, s.completed, s.passed, s.failed, s.skipped, s.running],
    [5, 5, 3, 1, 1, false],
  );
  assert.ok(!JSON.stringify(s).includes("private server error"));
  s.entries[0].status = "modified";
  assert.notEqual(batch.snapshot().entries[0].status, "modified");
});
test("cancel aborts active requests and never schedules queued requests", async () => {
  const called = [];
  const batch = new DiagnosticBatch({
    targets,
    run: (_, id, signal) =>
      new Promise((resolve) => {
        called.push(id);
        signal.addEventListener("abort", () => resolve({ cancelled: true }), {
          once: true,
        });
      }),
  });
  batch.start();
  batch.cancel();
  await batch.finished;
  assert.deepEqual(called, ["0", "1"]);
  const s = batch.snapshot();
  assert.equal(s.cancelled, 4);
  assert.equal(s.skipped, 1);
  assert.equal(s.running, false);
  batch.cancel();
});
test("disabled models/providers and absent credentials skip without treating them as failed", () => {
  const t = diagnosticTargets(
    {
      officialModels: [{ model: "gpt" }],
      providers: [
        { id: "p", models: [{ model: "x" }] },
        { id: "q", enabled: false, hasKey: true, models: [{ model: "y" }] },
        {
          id: "r",
          hasKey: true,
          models: [{ model: "off", enabled: false }, { model: "on" }],
        },
      ],
    },
    false,
  );
  assert.equal(t.filter((t) => !t.skip).length, 1);
  assert.deepEqual(
    t.map((t) => t.skip),
    ["未检测到官方登录", "未配置 API Key", "供应商已停用", "模型已停用", ""],
  );
  assert.throws(
    () =>
      new DiagnosticBatch({
        targets: () => t.slice(0, 4),
        run: () => assert.fail(),
      }).start(),
    /没有/,
  );
});
test("parallel diagnostic startup creates only one loopback listener", async (t) => {
  const r = new Router({
    getState: () => ({ providers: [] }),
    fetchUpstream: () => assert.fail(),
  });
  t.after(() => r.stop());
  await Promise.all([r.start(0), r.start(0)]);
  assert.ok(r.server.listening);
  assert.equal(r.starting, null);
});
