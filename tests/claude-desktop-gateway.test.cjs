const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { ClaudeDesktopGateway, readPolicy } = require("../core/claude-desktop-gateway.cjs");

test("Claude Desktop gateway applies and removes only its own Windows policy", { skip: process.platform !== "win32" }, t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "ass-claude-desktop-"));
  const policy = "HKCU\\SOFTWARE\\ASS-QA-Claude-" + crypto.randomBytes(8).toString("hex");
  const machine = policy + "-machine";
  const localMeta = path.join(data, "_meta.json");
  const reg = args => execFileSync("reg.exe", args, { stdio: "ignore", windowsHide: true });
  t.after(() => {
    for (const key of [policy, machine]) { try { reg(["delete", key, "/f"]); } catch {} }
    try { fs.unlinkSync(localMeta); } catch {}
    try { fs.rmdirSync(data); } catch {}
  });
  const bridge = new ClaudeDesktopGateway(data, policy, machine, localMeta), token = "a".repeat(64);
  assert.equal(bridge.status(token, 25819).configured, false);
  fs.writeFileSync(localMeta, JSON.stringify({ appliedId: "other-gateway" }));
  assert.equal(bridge.status(token, 25819).conflict, true);
  assert.throws(() => bridge.enable(token, 25819), /本地第三方配置/);
  fs.writeFileSync(localMeta, JSON.stringify({ appliedId: null }));
  bridge.enable(token, 25819);
  assert.deepEqual(bridge.status(token, 25819), { configured: true, owned: true, current: true, conflict: false });
  assert.equal(readPolicy(policy).inferenceGatewayBaseUrl.value, "http://127.0.0.1:25819/clients/claude/models");
  reg(["add", machine, "/v", "inferenceProvider", "/t", "REG_SZ", "/d", "anthropic", "/f"]);
  bridge.invalidate();
  assert.equal(bridge.status(token, 25819).current, false);
  assert.equal(bridge.status(token, 25819).conflict, true);
  assert.throws(() => bridge.enable(token, 25819), /设备管理策略/);
  reg(["delete", machine, "/f"]);
  bridge.invalidate();
  reg(["add", policy, "/v", "inferenceGatewayBaseUrl", "/t", "REG_SZ", "/d", "http://127.0.0.1:1/foreign", "/f"]);
  assert.throws(() => bridge.disable(), /配置已变化/);
  assert.equal(readPolicy(policy).inferenceGatewayBaseUrl.value, "http://127.0.0.1:1/foreign");
  reg(["add", policy, "/v", "inferenceGatewayBaseUrl", "/t", "REG_SZ", "/d", "http://127.0.0.1:25819/clients/claude/models", "/f"]);
  bridge.disable();
  assert.equal(bridge.status(token, 25819).configured, false);
  assert.equal(fs.existsSync(bridge.file), false);
  reg(["add", policy, "/v", "inferenceProvider", "/t", "REG_SZ", "/d", "anthropic", "/f"]);
  assert.throws(() => bridge.enable(token, 25819), /已有用户策略/);
  assert.equal(readPolicy(policy).inferenceProvider.value, "anthropic");
});
