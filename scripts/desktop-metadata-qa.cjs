// Windows-only archive-handle QA. All installations, profiles and archives are
// synthetic; only the exact Electron children started here are stopped.
const assert = require("node:assert/strict");
const fs = process.versions.electron ? require("original-fs") : require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

// ASAR's two Chromium Pickles: uint32 header length, then a JSON string.
// Kept dependency-free so malformed framing can also be exercised in tests.
function archiveBuffer(header, data = Buffer.alloc(0)) {
  const json = Buffer.from(JSON.stringify(header));
  const payloadSize = 4 + Math.ceil(json.length / 4) * 4;
  const headerPickle = Buffer.alloc(4 + payloadSize);
  headerPickle.writeUInt32LE(payloadSize, 0);
  headerPickle.writeUInt32LE(json.length, 4);
  json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  return Buffer.concat([sizePickle, headerPickle, data]);
}

function fixture(root, mode) {
  const harness = mode.includes("claude") ? "claude" : mode.includes("antigravity") ? "antigravity"
    : mode.includes("zcode") ? "zcode" : "opencode";
  const name = { claude: "claude", antigravity: "Antigravity", zcode: "ZCode", opencode: "OpenCode" }[harness];
  const manifest = { name: { claude: "opaque-shell", antigravity: "antigravity", zcode: "@zcode/desktop",
    opencode: "@opencode-ai/desktop" }[harness], productName: name, version: "3.14.0" };
  const pkg = Buffer.from(JSON.stringify(manifest)), build = Buffer.from('{"appVersion":"3.15.0"}');
  const archive = path.join(root, "resources", "app.asar"), executable = path.join(root, name + ".exe");
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.writeFileSync(executable, ""); // Never executed.
  const header = { files: { "package.json": { size: pkg.length, offset: "0" },
    out: { files: { metadata: { files: { "build-meta.json": { size: build.length, offset: String(pkg.length) } } } } } } };
  if (mode === "new-unpacked") {
    header.files["package.json"] = { size: pkg.length, unpacked: true };
    fs.mkdirSync(archive + ".unpacked");
    fs.writeFileSync(path.join(archive + ".unpacked", "package.json"), pkg);
  }
  fs.writeFileSync(archive, mode === "new-malformed" ? Buffer.from("bad archive")
    : archiveBuffer(header, Buffer.concat([pkg, build])));
  return { archive, executable, harness };
}

async function electronFixture(mode, root) {
  const { app } = require("electron");
  // Electron clears global module search paths at startup. Allow NODE_PATH to
  // supply an existing checkout's dependencies for QA in an isolated worktree.
  if (process.env.NODE_PATH) require("node:module")._initPaths();
  app.setPath("userData", path.join(root, "profile"));
  app.setPath("sessionData", path.join(root, "profile"));
  const watchdog = setTimeout(() => app.exit(2), 45000);
  process.on("disconnect", () => app.exit(0));
  process.on("message", (m) => {
    if (m === "ping") process.send({ type: "alive", pid: process.pid });
    if (m === "stop") { clearTimeout(watchdog); app.exit(0); }
  });
  await app.whenReady();
  const noAsarBefore = process.noAsar;
  const { archive, executable, harness } = fixture(root, mode);
  if (mode === "old-stat") {
    // Exact former hasElectronArchive() path: stat alone caches the archive.
    const patchedFs = require("node:fs");
    assert.equal(patchedFs.statSync(archive).isDirectory(), true);
    assert.equal(patchedFs.statSync(path.join(archive, "package.json")).isFile(), true);
  } else if (mode === "old-read") {
    const patchedFs = require("node:fs");
    assert.equal(JSON.parse(patchedFs.readFileSync(path.join(archive, "package.json"), "utf8")).version, "3.14.0");
  } else if (mode === "new-zcode-version") {
    const { zcodeVersion } = require("../core/oauth-info.cjs");
    for (let i = 0; i < 3; i++) assert.equal(zcodeVersion({ launcher: () => ({ desktopExecutable: executable }) }), "3.15.0");
  } else if (["new-malformed", "new-unpacked"].includes(mode)) {
    const { readDesktopJson } = require("../core/desktop-metadata.cjs");
    for (let i = 0; i < 3; i++) {
      const value = readDesktopJson(path.join(archive, "package.json"));
      assert.deepEqual(value, mode === "new-malformed" ? {} : {
        name: "@opencode-ai/desktop", productName: "OpenCode", version: "3.14.0",
      });
    }
  } else {
    const { resolveLauncher, discoverLaunchers } = require("../core/client-launcher.cjs");
    const env = { PATH: "", USERPROFILE: root };
    for (let i = 0; i < 3; i++) {
      assert.equal(resolveLauncher(harness, executable, env).kind, "desktop");
      assert.equal(discoverLaunchers(harness, env, [executable, executable]).length, 1);
    }
  }
  assert.equal(process.noAsar, noAsarBefore);
  // No window is needed: keep the actual Electron browser/main process alive.
  process.send({ type: "ready", mode, pid: process.pid, electron: process.versions.electron, archive });
}

function message(child, type, send) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(Error("Electron fixture timeout: " + type)), 15000);
    const onMessage = (m) => { if (m.type === type) finish(null, m); };
    const onExit = (code) => finish(Error("Electron fixture exited early: " + code));
    const onError = (e) => finish(e);
    function finish(error, value) {
      clearTimeout(timeout); child.off("message", onMessage); child.off("exit", onExit); child.off("error", onError);
      error ? reject(error) : resolve(value);
    }
    child.on("message", onMessage); child.once("exit", onExit); child.once("error", onError);
    if (send) child.send(send, (error) => { if (error) finish(error); });
  });
}

function probe(archive) {
  // An exclusive OS open detects lingering read handles even on a filesystem
  // where rename/delete sharing might be permitted.
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  const output = execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command",
    "$stream = $null; try { $stream = [IO.File]::Open($env:ASS_METADATA_QA_ARCHIVE, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None); @{ exclusiveOpen = $true } | ConvertTo-Json -Compress } catch { @{ exclusiveOpen = $false; hresult = $_.Exception.GetBaseException().HResult } | ConvertTo-Json -Compress } finally { if ($null -ne $stream) { $stream.Dispose() } }"],
  { encoding: "utf8", windowsHide: true, timeout: 10000, env: { ...process.env, ASS_METADATA_QA_ARCHIVE: archive } });
  const exclusive = JSON.parse(output);
  let renamed = false, deleted = false, renameCode, deleteCode;
  try { fs.renameSync(archive, archive + ".moved"); renamed = true; fs.renameSync(archive + ".moved", archive); }
  catch (e) { renameCode = e.code; }
  try { fs.unlinkSync(archive); deleted = true; } catch (e) { deleteCode = e.code; }
  return { ...exclusive, renamed, deleted, ...(renameCode ? { renameCode } : {}), ...(deleteCode ? { deleteCode } : {}) };
}

async function stop(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill(), 5000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    if (child.connected) child.send("stop", () => {}); else child.kill();
  });
}

async function run() {
  assert.equal(process.platform, "win32", "File sharing QA requires Windows");
  const index = process.argv.indexOf("--electron");
  const electron = index < 0 ? require("electron") : path.resolve(process.argv[index + 1]);
  assert.equal(fs.statSync(electron).isFile(), true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ass-desktop-metadata-qa-"));
  const modes = ["old-stat", "old-read", ...(process.argv.includes("--old-only") ? []
    : ["new-opencode", "new-claude", "new-zcode", "new-antigravity", "new-zcode-version", "new-malformed", "new-unpacked"])];
  const rows = [];
  try {
    for (const mode of modes) {
      const dir = path.join(root, mode);
      fs.mkdirSync(dir);
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_NO_ASAR;
      const child = spawn(electron, [__filename, "--fixture", mode, dir], {
        cwd: path.resolve(__dirname, ".."), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let errors = "";
      child.stdout.resume(); child.stderr.on("data", (b) => { errors = (errors + b).slice(-2000); });
      try {
        const ready = await message(child, "ready");
        assert.equal(ready.pid, child.pid);
        const result = probe(ready.archive);
        const alive = await message(child, "alive", "ping");
        assert.equal(alive.pid, child.pid); // All three probes occur before exit.
        const old = mode.startsWith("old-");
        assert.equal(result.exclusiveOpen, !old);
        assert.equal(result.renamed, !old);
        assert.equal(result.deleted, !old);
        if (old) {
          assert.equal(result.hresult & 0xffff, 32, "Expected Windows sharing violation");
          assert.ok(["EPERM", "EACCES", "EBUSY"].includes(result.renameCode));
          assert.ok(["EPERM", "EACCES", "EBUSY"].includes(result.deleteCode));
        }
        rows.push({ mode, electron: ready.electron, electronAliveDuringProbes: true, ...result });
      } catch (e) { throw Error(mode + ": " + e.message + (errors ? "\n" + errors : ""), { cause: e }); }
      finally { await stop(child); }
      if (mode.startsWith("old-")) {
        const released = probe(path.join(dir, "resources", "app.asar"));
        assert.equal(released.exclusiveOpen, true);
        assert.equal(released.renamed, true);
        assert.equal(released.deleted, true);
        rows[rows.length - 1].releasedAfterFixtureExit = true;
      }
    }
    console.log(JSON.stringify({ passed: true, realClientsTouched: false, rows }, null, 2));
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("ass-desktop-metadata-qa-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { archiveBuffer };
// Electron loads its entry through its bootstrap rather than require.main.
if (require.main === module || process.versions.electron && process.argv[2] === "--fixture") {
  const action = process.argv[2] === "--fixture" ? electronFixture(process.argv[3], process.argv[4]) : run();
  action.catch((e) => { console.error(e); if (process.versions.electron) require("electron").app.exit(1); else process.exitCode = 1; });
}
