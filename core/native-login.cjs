const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { isolatedEnv } = require("./harnesses.cjs");
const { target: kimiTarget } = require("./kimi-config.cjs");
const { kimiSources, readSource } = require("./additional-oauth.cjs");
const { read, document, safePath } = require("./native-fields.cjs");

const SUPPORTED = new Set(["kimi", "zcode"]);
const stamp = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function authLauncher(manager, harness) {
  const launcher = manager.launcher(harness);
  if (harness === "zcode" && launcher.kind === "desktop") {
    // The desktop's bundled CLI is run by its own Electron in Node mode.
    // Never send CLI auth flags to the existing desktop application instance.
    const entry = path.join(path.dirname(launcher.desktopExecutable), "resources/glm/zcode.cjs");
    if (!fs.existsSync(entry) || !fs.statSync(entry).isFile())
      throw Error("此 ZCode 桌面版没有内置登录 CLI，请选择 ZCode CLI 入口");
    return { ...launcher, ready: true, executable: launcher.desktopExecutable,
      entryPoint: entry, args: [entry], electronNode: true };
  }
  if (!launcher.ready) throw Error(launcher.message);
  return launcher;
}

function kimiPackage(launcher) {
  // A package manifest is evidence; an .exe filename alone is not a version.
  const roots = new Set();
  for (const entry of [launcher.entryPoint, launcher.location].filter(Boolean)) {
    let dir = fs.statSync(entry).isDirectory() ? entry : path.dirname(entry);
    roots.add(path.join(dir, "node_modules/@moonshot-ai/kimi-code"));
    for (let i = 0; i < 5; i++) { roots.add(dir); dir = path.dirname(dir); }
  }
  for (const dir of roots) {
    try {
      const p = JSON.parse(read(path.join(dir, "package.json")) || "{}");
      if (p.name === "@moonshot-ai/kimi-code") return "current";
    } catch { /* an unrelated ancestor is not a client manifest */ }
  }
  return null;
}

function loginSpec(manager, harness) {
  if (!SUPPORTED.has(harness)) throw Error("此客户端不支持这个原生登录入口");
  const launcher = authLauncher(manager, harness);
  let target, choices, selected, sources;
  if (harness === "kimi") {
    target = kimiTarget(manager);
    const detected = kimiPackage(launcher);
    if (detected && detected !== target.variant)
      throw Error("已选择新版 Kimi 程序，但配置为旧版；请在客户端设置中统一版本和入口");
    if (!detected && (manager.state.nativeVariants.kimi || "auto") === "auto")
      throw Error("无法确定此 Kimi 程序的版本，请在客户端设置中选择新版或旧版");
    const config = document(read(target.config), "toml").data;
    const providers = Object.values(config.providers || {});
    if (providers.some((p) => p.oauth && p.oauth.storage && p.oauth.storage !== "file"))
      throw Error("当前 Kimi 使用非文件 OAuth 存储，请在原生客户端中登录");
    sources = kimiSources({ dir: target.dir, legacy: target.variant === "legacy" }, manager.nativeEnv);
    choices = target.variant === "legacy" ? [{ id: "default", label: "Kimi 中国区（旧版）" }]
      : [{ id: "mainland-cn", label: "中国区" }, { id: "global", label: "Global" }];
    selected = target.variant === "legacy" ? "default"
      : config.providers?.["managed:kimi-code"]?.base_url?.includes("api.kimi.ai/") ? "global" : "mainland-cn";
  } else {
    const source = manager.oauthHistoryTarget("zcode", "zai");
    if (source.issue) throw Error(source.issue);
    const dir = source.dir, base = path.dirname(path.dirname(dir));
    if (!samePath(dir, path.join(base, ".zcode/v2")))
      throw Error("ZCode 登录目录须为 <数据根目录>/.zcode/v2，请重新选择凭据目录");
    const config = !manager.state.credentialHomes.zcode && manager.nativeEnv.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE?.trim()
      || path.join(dir, "provider_config.json");
    safePath(config);
    target = { dir, base, config };
    sources = [source];
    choices = [{ id: "zai", label: "Z.ai" }, { id: "bigmodel", label: "智谱" }];
    selected = readSource(source).grants[0]?.row.provider || "zai";
  }
  safePath(target.dir);
  const env = isolatedEnv(harness, target.dir, manager.nativeEnv);
  // Native OAuth must not inherit a third-party endpoint/API login or a Node
  // startup script. Keep system proxy and CA variables, never bypass TLS.
  const zcodeNetwork = new Set(["ZCODE_CREDENTIAL_SECRET", "ZCODE_HTTP_PROXY", "ZCODE_NO_PROXY", "ZCODE_AGENT_CA_CERT", "ZCODE_HTTP_TIMEOUT", "ZCODE_TIMEOUT"]);
  for (const name of Object.keys(env))
    if (/^(KIMI_|ZCODE_)/i.test(name) && !(harness === "zcode" && zcodeNetwork.has(name)) ||
        /^(NODE_OPTIONS|DOTENV_CONFIG_.+|PYTHONPATH|PYTHONSTARTUP)$/i.test(name)) delete env[name];
  env.NODE_USE_SYSTEM_CA = "1";
  if (harness === "kimi") env[target.variant === "legacy" ? "KIMI_SHARE_DIR" : "KIMI_CODE_HOME"] = target.dir;
  else {
    env.ZCODE_DATA_BASE_DIR = target.base;
    env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = target.config;
    env.ZCODE_ENV = "production";
    env.ZCODE_BASE_URL = "https://zcode.z.ai";
    env.ZCODE_ENDPOINT_ORIGIN = "https://zcode.z.ai";
  }
  if (launcher.electronNode) env.ELECTRON_RUN_AS_NODE = "1";
  const states = sources.map(readSource);
  // No environment, token, native config text or command is sent to renderer.
  const fingerprint = stamp([harness, target, choices, launcher, env, read(target.config),
    states.map((s) => [s.auth.file, s.fingerprint])]);
  return { harness, target, launcher, env, choices, selected, states, fingerprint };
}

class NativeLogin {
  constructor({ harnesses, history, processes, now = Date.now }) {
    this.harnesses = harnesses;
    this.history = history;
    this.processes = processes;
    this.now = now;
    this.tickets = new Map();
    this.running = new Set();
  }
  async assertIdle(harness) {
    if (!SUPPORTED.has(harness)) return;
    if (this.running.has(harness)) throw Error("原生登录窗口仍在运行，请完成或关闭后再操作");
    if (this.processes?.sessions.some((s) => s.harness === harness && s.account.startsWith("native-login:"))) {
      await this.processes.refresh();
      if (this.processes.sessions.some((s) => s.harness === harness && s.account.startsWith("native-login:") && s.status !== "gone"))
        throw Error("原生登录窗口仍在运行或状态不明，请完成或关闭后再操作");
    }
  }
  async preview(harness) {
    await this.assertIdle(harness);
    const spec = loginSpec(this.harnesses, harness);
    for (const [key, value] of this.tickets) if (value.expires < this.now()) this.tickets.delete(key);
    if (this.tickets.size > 20) this.tickets.clear();
    const ticket = crypto.randomBytes(24).toString("hex");
    this.tickets.set(ticket, { harness, fingerprint: spec.fingerprint, expires: this.now() + 120000 });
    return { ticket, harness, clientName: this.harnesses.spec(harness).name,
      choices: spec.choices, selected: spec.selected, target: spec.target.dir };
  }
  async apply(ticket, choice, confirmed) {
    const record = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!record || confirmed !== true || record.expires < this.now()) throw Error("登录确认已失效，请重新打开");
    await this.assertIdle(record.harness);
    if (this.running.has(record.harness)) throw Error("原生登录窗口仍在运行，请完成或关闭后再操作");
    const spec = loginSpec(this.harnesses, record.harness);
    if (spec.fingerprint !== record.fingerprint) throw Error("客户端入口、配置或登录信息已变化，请重新确认");
    if (!spec.choices.some((c) => c.id === choice)) throw Error("请选择支持的登录区域或供应商");
    // Ensure encryption works even for a first login. Preserve existing supported
    // grants before the native client is allowed to replace its own login.
    for (const state of spec.states) this.history.capture(state);
    this.history.persist(this.history.entries);
    const root = path.join(this.harnesses.dataDir, "native-login");
    safePath(root);
    fs.mkdirSync(root, { recursive: true });
    const workspace = fs.mkdtempSync(path.join(root, record.harness + "-"));
    const cleanup = () => {
      this.running.delete(record.harness);
      // Only an empty login working directory is removable. Never recursively
      // delete files that a native client may have placed here.
      try { fs.rmdirSync(workspace); } catch {}
      this.history.scan({ immediate: true });
    };
    const args = record.harness === "zcode" ? ["login", choice]
      : spec.target.variant === "legacy" ? ["login"] : ["login", "--region", choice];
    this.running.add(record.harness);
    try {
      return await this.harnesses.launchPlan(record.harness, {
        harness: record.harness, dir: workspace, workspace, files: [], args, env: spec.env,
        routed: false, accountKind: "native-login", pauseOnFailure: true,
        hint: "请在浏览器或此窗口完成登录。成功后 ASS 会自动记录账户。",
        onSpawn: (child) => child.once("exit", cleanup),
      }, "native-login:" + choice, "login", spec.launcher);
    } catch (error) { cleanup(); throw error; }
  }
}
module.exports = { NativeLogin, loginSpec, authLauncher };
