const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ModelDirectory } = require("../core/model-directory.cjs");
const provider = {
  id: "one",
  baseUrl: "https://example.com/v1",
  apiKey: "synthetic-only",
  wireApi: "openai-responses",
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { resolve, promise };
};
const response = (id) => Response.json({ data: [{ id }] });
function fixture(fetchUpstream, extra = {}) {
  return new ModelDirectory({
    getProvider: () => provider,
    readOfficial: () => ({ models: [] }),
    fetchUpstream,
    ...extra,
  });
}
test("automatic directory requests deduplicate and cache without inference requests", async () => {
  let calls = 0,
    clock = 1000;
  const gate = deferred();
  const directory = fixture(
    async (_, init) => {
      calls++;
      assert.equal(init.method, "GET");
      await gate.promise;
      return response("one");
    },
    { now: () => clock },
  );
  const a = directory.read("one"),
    b = directory.read("one", { refresh: true });
  assert.equal(a, b);
  assert.equal(directory.jobs().one, true);
  gate.resolve();
  await a;
  await directory.read("one");
  assert.equal(calls, 1);
  clock += 300001;
  await directory.read("one");
  assert.equal(calls, 2);
  await directory.read("one", { refresh: true });
  assert.equal(calls, 3);
  assert.deepEqual(directory.jobs(), {});
});
test("changing credentials aborts old requests and never publishes late results", async () => {
  const gate = deferred();
  let oldSignal,
    calls = 0;
  const directory = fixture(async (_, init) => {
    calls++;
    if (calls === 1) {
      oldSignal = init.signal;
      await gate.promise;
      return response("old-key-model");
    }
    return response("new-key-model");
  });
  const old = directory.read("one");
  await Promise.resolve();
  directory.invalidate("one");
  assert.equal(oldSignal.aborted, true);
  assert.equal(directory.revisions.one, 1);
  await directory.read("one");
  gate.resolve();
  assert.equal(await old, null);
  assert.equal(directory.results.one.models[0].model, "new-key-model");
});
test("removing all providers clears caches and blocks inflight publication", async () => {
  const gate = deferred();
  const directory = fixture(async () => {
    await gate.promise;
    return response("stale");
  });
  const old = directory.read("one");
  directory.invalidate();
  gate.resolve();
  assert.equal(await old, null);
  assert.deepEqual(Object.keys(directory.results), []);
  assert.deepEqual(directory.jobs(), {});
});
test("provider directories never cross scopes", async () => {
  const directory = fixture(async (url) => response(new URL(url).hostname), {
    getProvider: (id) => ({ ...provider, baseUrl: `https://${id}.example/v1` }),
  });
  await Promise.all([directory.read("one"), directory.read("two")]);
  assert.equal(directory.results.one.models[0].model, "one.example");
  assert.equal(directory.results.two.models[0].model, "two.example");
  directory.invalidate("one");
  assert.ok(directory.results.two);
});
test("errors are visible and cached briefly instead of automatically looping", async () => {
  let calls = 0,
    clock = 100;
  const directory = fixture(
    async () => {
      calls++;
      return Response.json({}, { status: 503 });
    },
    { now: () => clock },
  );
  const result = await directory.read("one");
  assert.match(result.error, /503/);
  await directory.read("one");
  assert.equal(calls, 1);
  clock += 30001;
  await directory.read("one");
  assert.equal(calls, 2);
  await directory.read("one", { refresh: true });
  assert.equal(calls, 3);
});
test("missing keys and empty directories have distinct non-destructive results", async () => {
  let calls = 0;
  const directory = fixture(
    async () => {
      calls++;
      return Response.json({ data: [] });
    },
    { getProvider: () => ({ ...provider, apiKey: "" }) },
  );
  assert.match((await directory.read("one")).error, /API Key/);
  assert.equal(calls, 0);
  const empty = fixture(async () => Response.json({ data: [] }));
  const result = await empty.read("one");
  assert.deepEqual(result.models, []);
  assert.equal(result.error, undefined);
});
test("official model declarations remain local and missing providers do not fetch", async () => {
  let calls = 0;
  const directory = fixture(
    async () => {
      calls++;
      return response("remote");
    },
    { getProvider: () => undefined },
  );
  assert.deepEqual(await directory.read("official"), { models: [] });
  await assert.rejects(directory.read("missing"), /供应商不存在/);
  assert.equal(calls, 0);
});
