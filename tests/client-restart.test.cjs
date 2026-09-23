const { test } = require("node:test"), assert = require("node:assert/strict");
const path = require("node:path"), os = require("node:os");
const { ClientRestart } = require("../core/client-restart.cjs");
const exe = path.join(os.tmpdir(), "restart-fixture", "ChatGPT.exe");
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
  assert.deepEqual(f.manager.public(plan), { applicable: true, available: true, names: ["Codex 桌面端"], reason: "" });
});
test("restart targets only the verified desktop tree, leaving unrelated processes", async () => {
  const f = setup(), plan = await f.manager.preview(["codex"]);
  assert.equal((await f.manager.restart(plan)).ok, true);
  assert.deepEqual(f.state.stopped[0].map((p) => p.pid), [200, 201]); assert.equal(f.state.launches.length, 1);
  assert.ok(f.state.rows.some((r) => r.pid === 900));
});
test("restart rejects PID reuse, executable changes, new children and installation updates before stopping", async () => {
  for (const change of [
    (s) => { s.rows[0].created = "2026-09-23T02:30:00.000Z"; },
    (s) => { s.rows[0].exe = path.join(os.tmpdir(), "another.exe"); },
    (s) => { s.rows.push({ ...s.rows[1], pid: 202 }); },
    (s) => { s.file = [101, 201]; },
  ]) {
    const f = setup(), plan = await f.manager.preview(["codex"]); change(f.state);
    await assert.rejects(f.manager.restart(plan)); assert.equal(f.state.stopped.length, 0); assert.equal(f.state.launches.length, 0);
  }
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
