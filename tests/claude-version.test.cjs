const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { assertClaudePicker, claudeVersionCommand } = require("../core/accountless.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ass-cc-version-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return (name, text) => {
    const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
    return { ready: true, executable: file, args: [] };
  };
}
test("native executables keep argument arrays, Windows scripts use a hidden host with literal paths", t => {
  const put = fixture(t), native = { ready: true, executable: process.execPath, args: ["entry with spaces.js"] };
  assert.deepEqual(claudeVersionCommand(native), { executable: native.executable, args: [...native.args, "--version"] });
  for (const ext of ["cmd", "bat", "ps1"]) {
    const launcher = put(`folder & (test)'/claude.${ext}`, ""), command = claudeVersionCommand(launcher, "win32");
    assert.match(command.executable, /powershell\.exe$/);
    assert.ok(command.args.includes("-NonInteractive"));
    const script = Buffer.from(command.args.at(-1), "base64").toString("utf16le");
    assert.ok(script.includes("& '" + launcher.executable.replace(/'/g, "''") + "' '--version'"));
  }
});
test("version detection executes Node entries and keeps the minimum-version gate", async t => {
  const put = fixture(t);
  for (const [text, expected] of [["2.1.283 (Claude Code)", null], ["2.1.242", null], ["2.1.223", /请先升级/], ["no version", /未返回可识别/]]) {
    const launcher = put("version.cjs", `console.log(${JSON.stringify(text)})`);
    const operation = assertClaudePicker({ ...launcher, executable: process.execPath, args: [launcher.executable] });
    if (expected) await assert.rejects(operation, expected); else await operation;
  }
});
test("synchronous invalid launchers and asynchronous spawn failures have actionable errors", async t => {
  const put = fixture(t), launcher = put("missing.exe", ""); fs.unlinkSync(launcher.executable);
  await assert.rejects(assertClaudePicker(launcher), /无法确认 Claude Code 版本（ENOENT）/);
  await assert.rejects(assertClaudePicker({ ...launcher, executable: "bad\0path" }), /启动入口无效/);
});
test("Windows cmd and PowerShell shims run from paths with spaces, ampersands and apostrophes", { skip: process.platform !== "win32" }, async t => {
  const put = fixture(t);
  const cmd = put("folder & (test)'/claude.cmd", '@echo off\r\nif not "%~1"=="--version" exit /b 9\r\necho 2.1.283 ^(Claude Code^)\r\n');
  const ps = put("folder & (test)'/claude.ps1", "if ($args[0] -ne '--version') { exit 9 }; Write-Output '2.1.283 (Claude Code)'\n");
  await assertClaudePicker(cmd); await assertClaudePicker(ps);
  const bad = put("bad.cmd", '@echo off\r\necho 2.1.283\r\nexit /b 7\r\n');
  await assert.rejects(assertClaudePicker(bad), /无法确认 Claude Code 版本/);
});
