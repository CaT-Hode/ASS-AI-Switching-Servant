const { test } = require("node:test"), assert = require("node:assert/strict");
const path = require("node:path"), os = require("node:os");
const { ClientRestart } = require("../core/client-restart.cjs");
const exe = path.join(os.tmpdir(), "restart-fixture", "ChatGPT.exe");
test('force close stops a verified desktop without any relaunch', async () => {
  const f = setup(), plan = await f.manager.preview(['codex']);
  await f.manager.close(plan); assert.equal(f.state.launches.length, 0); assert.deepEqual(f.state.rows.map((r) => r.pid), [900]);
  await assert.rejects(f.manager.launch(plan), /尚未确认/);
});

test('managed-only close refuses a desktop that appears after confirmation', async () => {
  const f = setup(), originalRows = structuredClone(f.state.rows); f.state.rows = [];
  let stopped = false;
  f.manager.processes = { refresh: async () => {}, snapshot: () => ({ sessions: [{ id: 'own', harness: 'codex', pid: 800, status: 'running' }] }),
    stop: async () => { stopped = true; } };
  const plan = await f.manager.preview(['codex']); assert.equal(plan.closeAvailable, true); assert.equal(plan.available, false);
  f.state.rows = originalRows;
  await assert.rejects(f.manager.close(plan), /主进程已变化/); assert.equal(stopped, false); assert.equal(f.state.stopped.length, 0);
});
test('Claude desktop uses its exact installation identity, not process names', async () => {
  const f = setup(); f.state.apps[0].id = 'claude'; f.state.apps[0].name = 'Claude 桌面端';
  const plan = await f.manager.preview(['claude']); assert.equal(plan.available, true);
  await f.manager.close(plan); assert.equal(f.state.launches.length, 0); assert.equal(f.state.rows[0].pid, 900);
});
test('CC managed-only close retains unrelated windows and rejects changed targets', async () => {
  const f = setup(); f.state.apps = []; f.state.rows = [];
  const sessions = [{ id: 'cc-owned', harness: 'claude', status: 'running', pid: 800 }, { id: 'other', harness: 'pi', status: 'running', pid: 900 }];
  f.manager.processes = { refresh: async () => {}, snapshot: () => ({ error: null, sessions: structuredClone(sessions) }),
    stop: async (ids) => { for (const s of sessions) if (ids.includes(s.id)) s.status = 'gone'; return f.manager.processes.snapshot(); } };
  const p = await f.manager.preview(['claude']); assert.equal(p.available, false); assert.equal(p.closeAvailable, true);
  sessions[0].pid = 801; await assert.rejects(f.manager.close(p), /变化/); assert.equal(sessions[0].status, 'running');
  const current = await f.manager.preview(['claude']); await f.manager.close(current);
  assert.equal(sessions[0].status, 'gone'); assert.equal(sessions[1].status, 'running'); assert.equal(f.state.launches.length, 0);
});
function setup() {
  const app = { id: "codex", name: "Codex 桌面端", exe, aumid: "OpenAI.Codex_fixture!App" };
  const root = { pid: 200, parentPid: 10, exe, created: "2026-09-23T02:00:00.000Z" };
  const child = { pid: 201, parentPid: 200, exe: path.join(path.dirname(exe), "backend.exe"), created: "2026-09-23T02:00:01.000Z" };
  const state = { apps: [app], rows: [root, child, { pid: 900, parentPid: 10, exe: "/unrelated", created: root.created }], stopped: [], launches: [], file: [100, 200] };
  const adapter = {
    inventory: async () => structuredClone(state),
    stop: async (rows) => { state.stopped.push(rows); state.rows = state.rows.filter((r) => !rows.some((t) => t.pid === r.pid)); return { stopped: true }; },
    launch: async (apps) => { state.launches.push(apps); state.rows.push({ ...root, pid: 300, created: "2026-09-23T03:00:00.000Z" }); return { launched: true }; },
  };
  const manager = new ClientRestart({ adapter, ownerPid: 999, fileInfo: () => state.file, wait: async () => {} });
  return { manager, state, adapter };
}
test("restart preview is read-only and public plan contains no process command lines", async () => {
  const f = setup(), plan = await f.manager.preview(["codex"]);
  assert.equal(plan.available, true); assert.deepEqual(f.state.stopped, []); assert.deepEqual(f.state.launches, []);
  assert.deepEqual(f.manager.public(plan), { applicable: true, available: true, closeAvailable: true, names: ["Codex 桌面端"], reason: "" });
});
test("restart targets only the verified desktop tree, leaving unrelated processes", async () => {
  const f = setup(), plan = await f.manager.preview(["codex"]);
  assert.equal((await f.manager.restart(plan)).ok, true);
  assert.deepEqual(f.state.stopped[0].map((p) => p.pid), [200, 201]); assert.equal(f.state.launches.length, 1);
  assert.ok(f.state.rows.some((r) => r.pid === 900));
});
test("restart rejects PID reuse, executable changes, new roots and installation updates before stopping", async () => {
  for (const change of [
    (s) => { s.rows[0].created = "2026-09-23T02:30:00.000Z"; },
    (s) => { s.rows[0].exe = path.join(os.tmpdir(), "another.exe"); },
    (s) => { s.rows.push({ ...s.rows[0], pid: 202 }); },
    (s) => { s.rows[1].created = "2026-09-23T02:30:00.000Z"; },
    (s) => { s.file = [101, 201]; },
  ]) {
    const f = setup(), plan = await f.manager.preview(["codex"]); change(f.state);
    await assert.rejects(f.manager.restart(plan)); assert.equal(f.state.stopped.length, 0); assert.equal(f.state.launches.length, 0);
  }
});
test("restart tolerates helper churn and stops the freshly captured tree", async () => {
  const f = setup(), plan = await f.manager.preview(["codex"]);
  f.state.rows = f.state.rows.filter((r) => r.pid !== 201);
  f.state.rows.push({ pid: 202, parentPid: 200, exe: path.join(path.dirname(exe), "backend.exe"), created: "2026-09-23T02:05:00.000Z" });
  await f.manager.restart(plan);
  assert.deepEqual(f.state.stopped[0].map(t => t.pid), [200, 202]);
  assert.ok(f.state.rows.some(r => r.pid === 900));
});
test("restart refuses a tree containing ASS, unreadable descendants and unsupported clients", async () => {
  const f = setup(); f.manager.ownerPid = 201; assert.equal((await f.manager.preview(["codex"])).available, false);
  f.manager.ownerPid = 999; f.state.rows[1].exe = ""; assert.equal((await f.manager.preview(["codex"])).available, false);
  assert.deepEqual(await f.manager.preview(["dsh"]), { applicable: false, available: false });
});
test("failed or partial stop never launches a duplicate desktop", async () => {
  const f = setup(), plan = await f.manager.preview(["codex"]);
  f.adapter.stop = async () => ({ stopped: true }); await assert.rejects(f.manager.restart(plan), /仍检测到/); assert.equal(f.state.launches.length, 0);
  f.adapter.stop = async () => ({ stopped: false }); await assert.rejects(f.manager.restart(plan), /未完整关闭/);
});
test("restart reports unconfirmed relaunch instead of claiming success", async () => {
  const f = setup(), plan = await f.manager.preview(["codex"]);
  f.adapter.launch = async () => ({ launched: true }); await assert.rejects(f.manager.restart(plan), /未确认新进程/);
});

test("split restart leaves a configuration window and refuses launch without a completed stop", async () => {
  const f = setup(), plan = await f.manager.preview(["codex"]);
  await assert.rejects(f.manager.launch(plan), /尚未确认/);
  await f.manager.stop(plan);
  assert.equal(f.state.launches.length, 0);
  assert.deepEqual(f.state.rows.map((r) => r.pid), [900]);
  let configured = false;
  const result = await f.manager.launch(plan, () => { configured = true; });
  assert.equal(configured, true); assert.equal(result.ok, true);
  await assert.rejects(f.manager.launch(plan), /尚未确认/);
});

test("split restart refuses a desktop that re-enters or updates during the configuration window", async () => {
  for (const change of [
    (s) => s.rows.push({ pid: 400, parentPid: 10, exe, created: "2026-09-23T04:00:00.000Z" }),
    (s) => { s.file = [500, 600]; },
  ]) {
    const f = setup(), plan = await f.manager.preview(["codex"]);
    await f.manager.stop(plan); change(f.state);
    await assert.rejects(f.manager.launch(plan), /仍检测到|安装已更新/);
    assert.equal(f.state.launches.length, 0);
  }
});
