const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ClientProcesses } = require("../core/client-processes.cjs");

const CREATED = "2026-09-21T01:02:03.0000000Z";
const MARKER = "ass-client-marker-0123456789";

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ass-processes-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

class FakeAdapter {
  constructor() {
    this.processes = new Map();
    this.terminateCalls = [];
    this.fail = new Set();
    this.keepAlive = new Set();
    this.inspectError = null;
    this.omitInventory = new Set();
    this.forgeDescendants = null;
    this.omitTerminateResult = new Set();
    this.omitVerifyResult = new Set();
  }
  add(pid, { parentPid = 0, creationDate = CREATED, marker = null } = {}) {
    this.processes.set(pid, { pid, parentPid, creationDate, marker });
  }
  async inspect(records) {
    if (this.inspectError) throw new Error(this.inspectError);
    return records.filter((record) => !this.omitInventory.has(record.id)).map((record) => {
      const root = this.processes.get(record.pid);
      const matched = !!root && root.marker === record.marker && (!record.creationDate || root.creationDate === record.creationDate);
      const descendants = [];
      if (matched) {
        const known = new Set([root.pid]);
        let changed;
        do {
          changed = false;
          for (const row of this.processes.values()) {
            const parent = this.processes.get(row.parentPid);
            if (!known.has(row.pid) && known.has(row.parentPid) &&
                Date.parse(row.creationDate) >= Date.parse(parent.creationDate)) {
              known.add(row.pid);
              descendants.push({ pid: row.pid, parentPid: row.parentPid, creationDate: row.creationDate });
              changed = true;
            }
          }
        } while (changed);
      }
      return {
        id: record.id,
        root: root ? { pid: root.pid, parentPid: root.parentPid, creationDate: root.creationDate, markerMatched: matched } : null,
        descendants: this.forgeDescendants || descendants,
        invalid: false,
      };
    });
  }
  async terminate(targets) {
    this.terminateCalls.push(targets.map((row) => ({ ...row })));
    return targets.flatMap((target) => {
      if (this.omitTerminateResult.has(target.pid)) return [];
      const root = this.processes.get(target.root.pid);
      let owned = !!root && root.creationDate === target.root.creationDate && root.marker === target.root.marker;
      for (let index = 0; owned && index < target.chain.length; index += 1) {
        const link = target.chain[index], row = this.processes.get(link.pid);
        if (index === 0 && !row && target.pid !== target.root.pid)
          return [{ ...target, stopped: true, error: null }];
        owned = !!row && row.creationDate === link.creationDate;
        if (owned && index + 1 < target.chain.length)
          owned = row.parentPid === target.chain[index + 1].pid;
      }
      if (!owned) return [{ ...target, stopped: false, error: "ownership-changed" }];
      const row = this.processes.get(target.pid);
      if (!row || row.creationDate !== target.creationDate)
        return [{ ...target, stopped: false, error: "identity-changed" }];
      if (this.fail.has(target.pid)) return [{ ...target, stopped: false, error: "stop-failed" }];
      const liveChild = [...this.processes.values()].some((candidate) =>
        candidate.parentPid === target.pid && Date.parse(candidate.creationDate) >= Date.parse(target.creationDate));
      if (liveChild) return [{ ...target, stopped: false, error: "child-still-running" }];
      if (!this.keepAlive.has(target.pid)) this.processes.delete(target.pid);
      return [{ ...target, stopped: true, error: null }];
    });
  }
  async verify(targets) {
    return targets.flatMap((target) => this.omitVerifyResult.has(target.pid) ? [] : [{
      pid: target.pid,
      creationDate: target.creationDate,
      alive: this.processes.get(target.pid)?.creationDate === target.creationDate,
    }]);
  }
}

async function registered(t, options = {}) {
  const dataDir = options.dataDir || temp(t);
  const adapter = options.adapter || new FakeAdapter();
  adapter.add(100, { marker: MARKER });
  const manager = new ClientProcesses({ dataDir, adapter, onChange: options.onChange });
  await manager.register({ id: "one", harness: "codex", account: "account-1", label: "Codex One", pid: 100, marker: MARKER });
  return { dataDir, adapter, manager };
}

test("register verifies marker, persists only minimal identification, and survives restart", async (t) => {
  const changes = [];
  const { dataDir, adapter, manager } = await registered(t, { onChange: (value) => changes.push(value) });
  assert.deepEqual(manager.snapshot().sessions, [{ id: "one", harness: "codex", label: "Codex One", pid: 100, status: "running" }]);
  const text = fs.readFileSync(path.join(dataDir, "client-processes.json"), "utf8");
  assert.match(text, /"creationDate"/);
  for (const secret of ["token", "env", "auth", "workspace", "commandLine", "EncodedCommand"])
    assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false);
  const restarted = new ClientProcesses({ dataDir, adapter });
  assert.equal((await restarted.refresh()).sessions[0].status, "running");
  assert.ok(changes.length >= 1);
});

test("registration fails closed when the decoded command marker cannot be verified", async (t) => {
  const dataDir = temp(t), adapter = new FakeAdapter();
  adapter.add(100, { marker: "different-marker-0123456789" });
  const manager = new ClientProcesses({ dataDir, adapter });
  await assert.rejects(manager.register({ id: "one", harness: "codex", account: "a", label: "One", pid: 100, marker: MARKER }), /无法验证/);
  assert.equal(fs.existsSync(path.join(dataDir, "client-processes.json")), false);
});

test("PID reuse and changed command are unverifiable and are never terminated", async (t) => {
  for (const mutation of [
    (adapter) => adapter.add(100, { marker: MARKER, creationDate: "2026-09-21T02:00:00.0000000Z" }),
    (adapter) => adapter.add(100, { marker: "changed-command-marker-1234" }),
  ]) {
    const adapter = new FakeAdapter();
    const { manager } = await registered(t, { adapter });
    mutation(adapter);
    assert.equal((await manager.refresh()).sessions[0].status, "unverifiable");
    await manager.stop(["one"]);
    assert.equal(adapter.terminateCalls.length, 0);
    assert.equal(adapter.processes.has(100), true);
  }
});

test("stop targets only the registered root and its descendants, descendants first", async (t) => {
  const adapter = new FakeAdapter();
  const { manager } = await registered(t, { adapter });
  adapter.add(101, { parentPid: 100, creationDate: "2026-09-21T01:02:04.0000000Z" });
  adapter.add(102, { parentPid: 101, creationDate: "2026-09-21T01:02:05.0000000Z" });
  adapter.add(999, { parentPid: 0, marker: "real-user-process-marker" });
  const result = await manager.stop(["one"]);
  assert.deepEqual(adapter.terminateCalls.flat().map((row) => row.pid), [102, 101, 100]);
  assert.equal(adapter.processes.has(999), true);
  assert.equal(result.sessions[0].status, "gone");
  assert.equal(result.error, null);
});

test("partial and falsely reported termination remain visible as errors", async (t) => {
  const adapter = new FakeAdapter();
  const { manager } = await registered(t, { adapter });
  adapter.add(101, { parentPid: 100, creationDate: "2026-09-21T01:02:04.0000000Z" });
  adapter.fail.add(101);
  let result = await manager.stop("one");
  assert.match(result.error, /未能完整终止/);
  assert.equal(adapter.processes.has(101), true);
  assert.equal(adapter.processes.has(100), true);
  assert.deepEqual(adapter.terminateCalls.flat().map((row) => row.pid), [101]);

  const second = new FakeAdapter();
  const setup = await registered(t, { adapter: second });
  second.keepAlive.add(100);
  result = await setup.manager.stop(["one"]);
  assert.match(result.error, /仍存活 1/);
  assert.equal(result.sessions[0].status, "unverifiable");
});

test("missing roots become gone and adapter failures become unverifiable", async (t) => {
  const { adapter, manager } = await registered(t);
  adapter.processes.delete(100);
  assert.equal((await manager.refresh()).sessions[0].status, "gone");
  assert.deepEqual((await manager.refresh()).sessions, []);

  const failing = await registered(t);
  failing.adapter.inspectError = "inventory unavailable";
  const result = await failing.manager.refresh();
  assert.equal(result.sessions[0].status, "unverifiable");
  assert.equal(result.error, "inventory unavailable");
});

test("misidentified roots and missing inventory can never be reported gone", async (t) => {
  const first = await registered(t);
  first.adapter.add(100, { marker: "changed-command-marker-1234" });
  let result = await first.manager.stop(["one"]);
  assert.equal(result.sessions[0].status, "unverifiable");
  assert.ok(result.error);
  assert.equal(first.adapter.terminateCalls.length, 0);

  const second = await registered(t);
  second.adapter.omitInventory.add("one");
  result = await second.manager.stop(["one"]);
  assert.equal(result.sessions[0].status, "unverifiable");
  assert.match(result.error, /清单缺失/);
  assert.equal(second.adapter.terminateCalls.length, 0);
});

test("forged or stale descendant chains fail closed before termination", async (t) => {
  const { adapter, manager } = await registered(t);
  adapter.add(101, { parentPid: 999, creationDate: "2026-09-21T01:02:04.0000000Z" });
  adapter.forgeDescendants = [{ pid: 101, parentPid: 999, creationDate: "2026-09-21T01:02:04.0000000Z" }];
  const result = await manager.stop(["one"]);
  assert.equal(result.sessions[0].status, "unverifiable");
  assert.match(result.error, /后代链/);
  assert.equal(adapter.terminateCalls.length, 0);
  assert.equal(adapter.processes.has(101), true);
});

test("ownership is rechecked before every kill and missing adapter results fail", async (t) => {
  const adapter = new FakeAdapter();
  const { manager } = await registered(t, { adapter });
  adapter.add(101, { parentPid: 100, creationDate: "2026-09-21T01:02:04.0000000Z" });
  const originalTerminate = adapter.terminate.bind(adapter);
  let calls = 0;
  adapter.terminate = async (targets) => {
    calls += 1;
    if (calls === 2) adapter.add(100, { marker: MARKER, creationDate: "2026-09-21T03:00:00.0000000Z" });
    return originalTerminate(targets);
  };
  let result = await manager.stop(["one"]);
  assert.equal(result.sessions[0].status, "unverifiable");
  assert.ok(result.error);

  const missing = new FakeAdapter();
  const setup = await registered(t, { adapter: missing });
  missing.omitTerminateResult.add(100);
  missing.omitVerifyResult.add(100);
  result = await setup.manager.stop(["one"]);
  assert.equal(result.sessions[0].status, "unverifiable");
  assert.match(result.error, /失败 1.*验证缺失 1/);
});

test("an exited child is safe success only while the registered root still verifies", async (t) => {
  const adapter = new FakeAdapter();
  const { manager } = await registered(t, { adapter });
  adapter.add(101, { parentPid: 100, creationDate: "2026-09-21T01:02:04.0000000Z" });
  const originalTerminate = adapter.terminate.bind(adapter);
  let calls = 0;
  adapter.terminate = async (targets) => {
    calls += 1;
    if (calls === 1) adapter.processes.delete(101);
    return originalTerminate(targets);
  };
  let result = await manager.stop(["one"]);
  assert.equal(result.error, null);
  assert.equal(result.sessions[0].status, "gone");
  assert.deepEqual(adapter.terminateCalls.flat().map((row) => row.pid), [101, 100]);

  const unsafe = new FakeAdapter();
  const setup = await registered(t, { adapter: unsafe });
  unsafe.add(101, { parentPid: 100, creationDate: "2026-09-21T01:02:04.0000000Z" });
  const unsafeTerminate = unsafe.terminate.bind(unsafe);
  unsafe.terminate = async (targets) => {
    unsafe.processes.delete(100);
    return unsafeTerminate(targets);
  };
  result = await setup.manager.stop(["one"]);
  assert.equal(result.sessions[0].status, "unverifiable");
  assert.ok(result.error);
  assert.equal(unsafe.processes.has(101), true);
});

test("malformed and oversized journals fail closed without invoking the adapter", async (t) => {
  for (const content of ["{broken", "x".repeat(256 * 1024 + 1)]) {
    const dataDir = temp(t), file = path.join(dataDir, "client-processes.json");
    fs.writeFileSync(file, content);
    const adapter = new FakeAdapter();
    adapter.inspect = async () => { throw new Error("must not inspect real processes"); };
    const manager = new ClientProcesses({ dataDir, adapter });
    const initial = manager.snapshot();
    assert.deepEqual(initial.sessions, []);
    assert.ok(initial.error);
    assert.deepEqual((await manager.refresh()).sessions, []);
    await assert.rejects(manager.register({ id: "one", harness: "codex", account: "a", label: "One", pid: 100, marker: MARKER }), /记录|过大|格式/);
    await assert.rejects(manager.stop(["one"]), /记录|过大|格式/);
  }
});

test("stored harnesses, short markers, and duplicate PID identities are rejected", async (t) => {
  const setup = await registered(t);
  const { dataDir, adapter, manager } = setup;
  adapter.add(200, { marker: "second-marker-0123456789", creationDate: CREATED });
  await assert.rejects(manager.register({ id: "two", harness: "unknown", account: "a", label: "Two", pid: 200, marker: "second-marker-0123456789" }), /客户端无效/);
  await assert.rejects(manager.register({ id: "two", harness: "codex", account: "a", label: "Two", pid: 200, marker: "short" }), /marker/);
  adapter.add(100, { marker: "duplicate-pid-marker-12345" });
  await assert.rejects(manager.register({ id: "two", harness: "codex", account: "a", label: "Two", pid: 100, marker: "duplicate-pid-marker-12345" }), /PID 和创建时间/);

  const journal = JSON.parse(fs.readFileSync(path.join(dataDir, "client-processes.json"), "utf8"));
  journal.sessions[0].harness = "unknown";
  fs.writeFileSync(path.join(dataDir, "client-processes.json"), JSON.stringify(journal));
  assert.ok(new ClientProcesses({ dataDir, adapter }).snapshot().error);
});

test("journal rejects invalid stored identities and register rejects duplicates", async (t) => {
  const { dataDir, adapter, manager } = await registered(t);
  await assert.rejects(manager.register({ id: "one", harness: "codex", account: "a", label: "dup", pid: 100, marker: "another-long-marker-123456" }), /会话 ID 已存在/);
  const journal = JSON.parse(fs.readFileSync(path.join(dataDir, "client-processes.json"), "utf8"));
  journal.sessions[0].pid = -1;
  fs.writeFileSync(path.join(dataDir, "client-processes.json"), JSON.stringify(journal));
  const restarted = new ClientProcesses({ dataDir, adapter });
  assert.deepEqual(restarted.snapshot().sessions, []);
  assert.ok(restarted.snapshot().error);
});
