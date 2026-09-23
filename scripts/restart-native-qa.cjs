// Exercise Windows process termination only on child fixtures created here.
// No real client, installation, credentials or launch entry is modified.
const assert = require("node:assert/strict");
const { fork } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { DesktopRestartAdapter } = require("../core/client-restart.cjs");
const fixtureKind = process.argv[2];
if (["--fixture-root", "--fixture-leaf"].includes(fixtureKind)) {
  setTimeout(() => process.exit(0), 60000); // Bounded fallback even if the QA controller fails.
  setInterval(() => {}, 1000);
  if (fixtureKind === "--fixture-root") {
    const leaf = fork(__filename, ["--fixture-leaf", process.argv[3]], { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    leaf.once("message", () => process.send({ pid: process.pid, leaf: leaf.pid }));
  } else process.send({ pid: process.pid });
} else (async () => {
  assert.equal(process.platform, "win32");
  const adapter = new DesktopRestartAdapter(), started = Date.now(), owned = [], handles = [];
  const create = (kind) => new Promise((resolve, reject) => {
    const child = fork(__filename, [kind, randomUUID()], { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    handles.push(child);
    const timeout = setTimeout(() => reject(Error("fixture not ready")), 10000);
    child.once("error", (e) => { clearTimeout(timeout); reject(e); });
    child.once("message", (m) => { clearTimeout(timeout); resolve(m); });
  });
  const inspect = async () => (await adapter.inventory([], null)).rows;
  try {
    const root = await create("--fixture-root"), other = await create("--fixture-leaf");
    const rows = await inspect();
    for (const [pid, parentPid] of [[root.pid, process.pid], [root.leaf, root.pid], [other.pid, process.pid]]) {
      const row = rows.find((r) => r.pid === pid);
      assert.ok(row && row.parentPid === parentPid && row.exe.toLowerCase() === process.execPath.toLowerCase());
      assert.ok(Date.parse(row.created) >= started - 1000);
    }
    // Windows may also create a hidden console host for each Node fixture.
    const collect = (pid, depth = 0) => {
      const row = rows.find((r) => r.pid === pid);
      assert.ok(row && Date.parse(row.created) >= started - 1000 && depth < 10);
      const tree = [{ ...row, depth }];
      for (const child of rows.filter((r) => r.parentPid === pid)) tree.push(...collect(child.pid, depth + 1));
      return tree;
    };
    const tree = collect(root.pid), otherTree = collect(other.pid);
    owned.push(...tree, ...otherTree);
    // Stale identity and an unlisted child must fail before any termination.
    await assert.rejects(adapter.stop(tree.map((p, i) => i ? p : { ...p, created: "2000-01-01T00:00:00Z" })));
    await assert.rejects(adapter.stop([tree[0]]));
    const untouched = await inspect();
    assert.ok(owned.every((p) => untouched.some((r) => r.pid === p.pid && r.created === p.created)));
    assert.equal((await adapter.stop(tree)).stopped, true);
    const after = await inspect();
    assert.ok(!after.some((r) => tree.some((p) => p.pid === r.pid)));
    assert.ok(after.some((r) => r.pid === other.pid && r.created === otherTree[0].created));
    console.log(JSON.stringify({ passed: true, fixtureTreeStopped: tree.length, unrelatedFixturePreserved: true,
      staleIdentityRejected: true, unlistedChildRejected: true, realClientsTouched: false, desktopLaunchTested: false }));
  } finally {
    // Only this test's exact, still-matching identities are eligible for cleanup.
    const rows = await inspect();
    const remaining = owned.filter((p) => rows.some((r) => r.pid === p.pid && r.exe === p.exe && r.created === p.created));
    if (remaining.length) await adapter.stop(remaining);
    for (const child of handles) if (child.connected) child.disconnect();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
