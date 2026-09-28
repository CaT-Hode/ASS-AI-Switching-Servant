const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { atomic } = require("./config.cjs");

const POLICY = "HKCU\\SOFTWARE\\Policies\\Claude";
const MACHINE_POLICY = "HKLM\\SOFTWARE\\Policies\\Claude";
const names = ["inferenceProvider", "inferenceCredentialKind", "inferenceGatewayBaseUrl", "inferenceGatewayApiKey"];
const hash = values => crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex");

function reg(args) {
  return execFileSync("reg.exe", args, { encoding: "utf8", windowsHide: true, maxBuffer: 32768, stdio: ["ignore", "pipe", "pipe"] });
}
function readPolicy(key) {
  let output;
  try { output = reg(["query", key]); }
  catch (error) {
    if (error.status === 1) return {};
    throw Error("无法读取 Claude 桌面版系统配置", { cause: error });
  }
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+(REG_\w+)\s+(.*)$/.exec(line);
    if (match) values[match[1]] = { type: match[2], value: match[3].trim() };
  }
  return values;
}
function desired(token, port) {
  if (!/^[a-f0-9]{64}$/.test(token || "") || !Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Claude 桌面版接入凭据尚未就绪");
  return {
    inferenceProvider: "gateway",
    inferenceCredentialKind: "static",
    inferenceGatewayBaseUrl: `http://127.0.0.1:${port}/clients/claude/models`,
    inferenceGatewayApiKey: token,
  };
}
function restore(policy, previous) {
  for (const name of names) {
    const value = previous[name];
    if (value) reg(["add", policy, "/v", name, "/t", value.type, "/d", value.value, "/f"]);
    else {
      try { reg(["delete", policy, "/v", name, "/f"]); } catch {}
    }
  }
}
class ClaudeDesktopGateway {
  constructor(dataDir, policy = POLICY, machinePolicy = MACHINE_POLICY,
    localMeta = path.join(process.env.LOCALAPPDATA || "", "Claude-3p", "configLibrary", "_meta.json")) {
    this.file = path.join(dataDir, "claude-desktop-gateway.json");
    this.policy = policy;
    this.machinePolicy = machinePolicy;
    this.localMeta = localMeta;
    this.cache = null;
  }
  owner() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return value.version === 1 && /^[a-f0-9]{64}$/.test(value.hash) ? value : null;
    } catch { return null; }
  }
  policies() {
    if (this.cache && Date.now() - this.cache.at < 3000) return this.cache;
    this.cache = { at: Date.now(), user: readPolicy(this.policy), machine: readPolicy(this.machinePolicy) };
    return this.cache;
  }
  invalidate() { this.cache = null; }
  localActive() {
    if (!fs.existsSync(this.localMeta)) return false;
    try { return !!JSON.parse(fs.readFileSync(this.localMeta, "utf8")).appliedId; }
    catch { return true; }
  }
  status(token, port) {
    const { user: values, machine } = this.policies(), owner = this.owner();
    const configured = names.every(name => values[name]?.type === "REG_SZ") &&
      values.inferenceProvider?.value === "gateway" && values.inferenceCredentialKind?.value === "static";
    const owned = !!owner && configured && owner.hash === hash(Object.fromEntries(names.map(name => [name, values[name].value])));
    const machineManaged = Object.keys(machine).length > 0;
    const current = owned && !machineManaged && token ? Object.entries(desired(token, port)).every(([name, value]) => values[name]?.value === value) : false;
    return { configured, owned, current, conflict: machineManaged || (!owned && (Object.keys(values).length > 0 || this.localActive())) };
  }
  enable(token, port) {
    const expected = desired(token, port), current = readPolicy(this.policy), owner = this.owner();
    if (Object.keys(readPolicy(this.machinePolicy)).length)
      throw Error("Claude 桌面版已有设备管理策略，请先由管理员调整其第三方推理配置");
    if (!owner && this.localActive())
      throw Error("Claude 桌面版已有生效的本地第三方配置，请先在桌面版中切换或移除该配置");
    if (!owner && Object.keys(current).length)
      throw Error("Claude 桌面版已有用户策略，ASS 未覆盖；请在 Claude 桌面版中检查现有配置");
    if (owner && Object.keys(current).length &&
        owner.hash !== hash(Object.fromEntries(names.map(name => [name, current[name]?.value]))))
      throw Error("Claude 桌面版配置已被其他程序修改，ASS 未覆盖");
    try {
      for (const [name, value] of Object.entries(expected))
        reg(["add", this.policy, "/v", name, "/t", "REG_SZ", "/d", value, "/f"]);
      const written = readPolicy(this.policy);
      if (!names.every(name => written[name]?.type === "REG_SZ" && written[name]?.value === expected[name]))
        throw Error("写入后检查失败");
      atomic(this.file, JSON.stringify({ version: 1, hash: hash(expected) }));
    } catch (error) {
      try { restore(this.policy, current); } catch {}
      this.invalidate();
      throw Error("Claude 桌面版配置未能完整写入，已尝试恢复原设置", { cause: error });
    }
    this.invalidate();
    return { ok: true, message: "Claude 桌面版已配置第三方推理。重新打开 Claude，在登录页选择第三方推理；ASS 需保持运行。" };
  }
  disable() {
    const owner = this.owner();
    if (!owner) return { ok: true, message: "Claude 桌面版没有 ASS 管理的接入" };
    const current = readPolicy(this.policy);
    if (owner.hash !== hash(Object.fromEntries(names.map(name => [name, current[name]?.value]))))
      throw Error("Claude 桌面版配置已变化，ASS 未删除其他程序的设置");
    try {
      for (const name of names) reg(["delete", this.policy, "/v", name, "/f"]);
      fs.unlinkSync(this.file);
    } catch (error) {
      try { restore(this.policy, current); } catch {}
      this.invalidate();
      throw Error("Claude 桌面版接入未能完整关闭，已尝试恢复原设置", { cause: error });
    }
    this.invalidate();
    return { ok: true, message: "已关闭 ASS 对 Claude 桌面版的接入。重新打开 Claude 后恢复原生登录。" };
  }
}
module.exports = { ClaudeDesktopGateway, desired, readPolicy };
