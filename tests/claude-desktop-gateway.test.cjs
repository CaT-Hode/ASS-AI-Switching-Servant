const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { ClaudeDesktopGateway, desired, readPolicy } = require("../core/claude-desktop-gateway.cjs");
const { atomic } = require("../core/native-fields.cjs");
const token = "a".repeat(64), otherId = "00000000-0000-4000-8000-000000000001";
const parse = file => JSON.parse(fs.readFileSync(file, "utf8"));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ass-claude-desktop-"));
  const data = path.join(root, "ASS"), directory = path.join(root, "Claude-3p");
  const options = { directory, policyReader: () => ({}) };
  const bridge = new ClaudeDesktopGateway(data, options);
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith("ass-claude-desktop-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, data, options, bridge };
}
test("local desktop setup persists without registry writes and restores a fresh user's files", t => {
  const { bridge, data, options } = fixture(t);
  assert.deepEqual(bridge.status(token, 25819), { configured: false, owned: false, current: false, conflict: false });
  bridge.enable(token, 25819);
  const owner = parse(bridge.file), meta = parse(bridge.metaFile);
  assert.equal(owner.version, 2);
  assert.equal(meta.appliedId, owner.id);
  assert.deepEqual(meta.entries, [{ id: owner.id, name: "ASS" }]);
  assert.equal(parse(bridge.settingsFile).deploymentMode, "3p");
  assert.deepEqual(parse(bridge.profileFile(owner.id)), desired(token, 25819));
  assert.ok(!fs.readFileSync(bridge.file, "utf8").includes(token));
  const restarted = new ClaudeDesktopGateway(data, options);
  assert.deepEqual(restarted.status(token, 25819), { configured: true, owned: true, current: true, conflict: false });
  restarted.enable("b".repeat(64), 25821);
  assert.equal(parse(bridge.metaFile).entries.length, 1);
  assert.equal(restarted.status("b".repeat(64), 25821).current, true);
  restarted.disable();
  for (const file of [bridge.file, bridge.metaFile, bridge.settingsFile, bridge.profileFile(owner.id)]) assert.equal(fs.existsSync(file), false);
});
test("disable preserves saved configurations and later preferences while restoring the old selection and mode", t => {
  const { bridge } = fixture(t);
  atomic(bridge.metaFile, JSON.stringify({ appliedId: "", entries: [{ id: otherId, name: "Other" }], custom: true }));
  atomic(bridge.settingsFile, JSON.stringify({ deploymentMode: "1p", preferences: { theme: "dark" }, mcpServers: { sample: {} } }));
  bridge.enable(token, 25819);
  const settings = parse(bridge.settingsFile); settings.preferences.theme = "light";
  atomic(bridge.settingsFile, JSON.stringify(settings));
  const meta = parse(bridge.metaFile); meta.custom = "new";
  atomic(bridge.metaFile, JSON.stringify(meta));
  bridge.disable();
  assert.deepEqual(parse(bridge.settingsFile), { deploymentMode: "1p", preferences: { theme: "light" }, mcpServers: { sample: {} } });
  assert.deepEqual(parse(bridge.metaFile), { appliedId: "", entries: [{ id: otherId, name: "Other" }], custom: "new" });
});
test("another selected configuration is left active when removing the stored ASS entry", t => {
  const { bridge } = fixture(t);
  bridge.enable(token, 25819);
  const meta = parse(bridge.metaFile); meta.entries.push({ id: otherId, name: "Other" }); meta.appliedId = otherId;
  atomic(bridge.metaFile, JSON.stringify(meta));
  assert.equal(bridge.status(token, 25819).conflict, true);
  bridge.disable();
  assert.deepEqual(parse(bridge.metaFile), { entries: [{ id: otherId, name: "Other" }], appliedId: otherId });
  assert.equal(parse(bridge.settingsFile).deploymentMode, "3p");
});
test("existing management or a foreign local configuration prevents takeover", t => {
  const { bridge } = fixture(t);
  bridge.policyReader = key => key === bridge.machinePolicy ? { inferenceProvider: { type: "REG_SZ", value: "anthropic" } } : {};
  assert.throws(() => bridge.enable(token, 25819), /系统管理策略/);
  assert.equal(fs.existsSync(bridge.file), false);
  bridge.policyReader = () => ({});
  atomic(bridge.metaFile, JSON.stringify({ appliedId: otherId, entries: [{ id: otherId, name: "Other" }] }));
  assert.throws(() => bridge.enable(token, 25819), /本地第三方配置/);
  assert.equal(parse(bridge.metaFile).appliedId, otherId);
});
test("externally edited ASS profile is never overwritten or deleted", t => {
  const { bridge } = fixture(t);
  bridge.enable(token, 25819);
  const file = bridge.profileFile(parse(bridge.file).id), profile = parse(file);
  profile.inferenceGatewayBaseUrl = "https://other.example";
  atomic(file, JSON.stringify(profile));
  assert.equal(bridge.status(token, 25819).owned, false);
  assert.throws(() => bridge.preflightDisable(), /配置已变化/);
  assert.throws(() => bridge.enable(token, 25819), /已被其他程序修改/);
  assert.throws(() => bridge.disable(), /配置已变化/);
  assert.equal(parse(file).inferenceGatewayBaseUrl, "https://other.example");
});
test("a local permission failure rolls back every completed write and reports a secret-free error code", t => {
  const { bridge } = fixture(t);
  const original = '{"deploymentMode":"1p","preferences":{"theme":"dark"}}';
  atomic(bridge.settingsFile, original);
  bridge.writer = (file, value) => {
    if (file === bridge.metaFile) throw Object.assign(Error("synthetic detail " + token), { code: "EACCES" });
    atomic(file, value);
  };
  assert.throws(() => bridge.enable(token, 25819), error => {
    assert.match(error.message, /EACCES/); assert.match(error.message, /原设置已恢复/); assert.ok(!error.message.includes(token)); return true;
  });
  assert.equal(fs.readFileSync(bridge.settingsFile, "utf8"), original);
  assert.equal(fs.existsSync(bridge.file), false);
  assert.deepEqual(fs.readdirSync(path.dirname(bridge.metaFile)), []);
});
test("0.1.32 owned registry settings remain removable without deleting unrelated policy", { skip: process.platform !== "win32" }, t => {
  const { bridge } = fixture(t);
  const policy = "HKCU\\SOFTWARE\\ASS-QA-Claude-" + crypto.randomBytes(8).toString("hex");
  bridge.policy = policy; bridge.machinePolicy = policy + "-machine"; bridge.policyReader = readPolicy;
  const reg = args => execFileSync("reg.exe", args, { stdio: "ignore", windowsHide: true });
  t.after(() => { try { reg(["delete", policy, "/f"]); } catch {} });
  const values = desired(token, 25819);
  for (const [name, value] of Object.entries(values)) reg(["add", policy, "/v", name, "/t", "REG_SZ", "/d", value, "/f"]);
  reg(["add", policy, "/v", "disableAutoUpdates", "/t", "REG_SZ", "/d", "false", "/f"]);
  atomic(bridge.file, JSON.stringify({ version: 1, hash: crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex") }));
  assert.equal(bridge.status(token, 25819).owned, true);
  bridge.disable();
  assert.deepEqual(Object.keys(readPolicy(policy)), ["disableAutoUpdates"]);
});
