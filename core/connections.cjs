const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomic, prepareConfig } = require("./config.cjs");
const { IDS, hash } = require("./injection-files.cjs");
const NAMES = { codex: "Codex", claude: "Claude Code", opencode: "OpenCode", pi: "pi", dsh: "DeepSeek Harness" };
class Connections {
  constructor({ dataDir, router, config, injections, processes, port = 25819, writeCatalog = () => {}, onChange = () => {}, extraActive = () => 0 }) {
    Object.assign(this, { router, config, injections, processes, port, writeCatalog, onChange, extraActive });
    this.file = path.join(dataDir, "connections.json");
    this.enabled = Object.fromEntries(IDS.map((id) => [id, (id === "codex" && !!config.status().managed) || injections.entries.some((e) => e.harness === id)]));
    this.busy = false;
    this.blocked = new Set();
    this.tickets = new Map();
    this.revision = 0;
    this.error = "";
    try {
      if (fs.existsSync(this.file)) {
        if (fs.statSync(this.file).size > 8192) throw Error();
        const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (IDS.some((id) => typeof saved[id] !== "boolean")) throw Error();
        this.enabled = Object.fromEntries(IDS.map((id) => [id, saved[id]]));
        // A crashed shutdown must not hide a still-injected Codex config.
        if (config.status().managed) this.enabled.codex = true;
      } else atomic(this.file, JSON.stringify(this.enabled));
    } catch { this.error = "接入状态文件损坏，请先检查数据目录；没有自动覆盖"; }
  }
  allow(id) {
    if (this.blocked.has(id) || this.error) return false;
    if (id === "diagnostics") return true;
    return IDS.includes(id) && this.enabled[id];
  }
  snapshot() {
    return {
      busy: this.busy, error: this.error || this.injections.error,
      clients: Object.fromEntries(IDS.map((id) => [id, {
        enabled: this.enabled[id], active: this.router.clientActive(id),
        files: this.injections.entries.filter((e) => e.harness === id).length,
        configAttached: id === "codex" ? this.config.status().attached : undefined,
      }])),
      processes: this.processes.snapshot(),
    };
  }
  ids(scope) {
    if (scope === "all") return IDS;
    if (!IDS.includes(scope)) throw Error("未知客户端接入");
    return [scope];
  }
  fingerprint(ids) {
    return hash(JSON.stringify([this.enabled, this.revision, this.injections.fingerprint(ids),
      ids.includes("codex") && fs.existsSync(this.config.file) ? hash(fs.readFileSync(this.config.file)) : null,
      this.processes.snapshot().sessions.filter((s) => ids.includes(s.harness)).map((s) => s.id).sort()]));
  }
  preflight(ids, enabled) {
    if (this.error) throw Error(this.error);
    this.injections.preflight(ids);
    if (ids.includes("codex")) {
      if (!enabled) this.config.preflightDetach();
      else if (!this.config.status().attached) {
        const text = fs.existsSync(this.config.file) ? fs.readFileSync(this.config.file, "utf8") : "";
        if (text.includes("# >>> ass managed start")) throw Error("Codex 存在不完整的接入配置，请先断开并恢复");
        prepareConfig(text, this.config.catalog, this.config.baseUrl);
      }
    }
  }
  async preview(scope, enabled, quit = false) {
    if (typeof enabled !== "boolean" || (scope === "all" && enabled) || (quit && scope !== "all"))
      throw Error("无效接入操作");
    if (this.busy) throw Error("正在切换或启动客户端，请稍后重试");
    const ids = this.ids(scope);
    await this.processes.refresh();
    this.preflight(ids, enabled);
    const snapshot = this.processes.snapshot();
    const ticket = crypto.randomBytes(24).toString("hex");
    for (const [key, p] of this.tickets) if (p.expires < Date.now()) this.tickets.delete(key);
    if (this.tickets.size > 20) this.tickets.clear();
    this.tickets.set(ticket, { scope, ids, enabled, quit, fingerprint: this.fingerprint(ids), expires: Date.now() + 180000 });
    return {
      ticket, scope, enabled, quit, names: ids.map((id) => NAMES[id]),
      active: scope === "all" ? this.router.clientActive() : this.router.clientActive(scope),
      sessions: snapshot.sessions.filter((s) => ids.includes(s.harness) && s.status !== "gone"),
      processError: snapshot.error,
      files: this.injections.list(ids).map((e) => e.relative),
      codexConfig: ids.includes("codex") ? this.config.file : "",
      stopService: !enabled && !IDS.some((id) => !ids.includes(id) && this.enabled[id]),
      retained: IDS.filter((id) => !ids.includes(id) && this.enabled[id]).map((id) => NAMES[id]),
    };
  }
  async apply({ ticket, mode, acknowledged } = {}) {
    const plan = this.tickets.get(ticket);
    if (!plan || plan.expires < Date.now()) throw Error("确认已过期，请重新打开接入菜单");
    if (this.busy) throw Error("已有接入操作正在执行");
    if (acknowledged !== true || !["safe", "terminate"].includes(mode)) throw Error("请先阅读影响范围并确认");
    if (plan.enabled && mode !== "safe") throw Error("开启接入不允许终止客户端");
    this.tickets.delete(ticket);
    this.busy = true;
    try {
      await this.processes.refresh();
      if (this.fingerprint(plan.ids) !== plan.fingerprint) throw Error("配置或窗口清单已变化，请重新预览后确认");
      this.preflight(plan.ids, plan.enabled);
      if (plan.enabled) {
        await this.router.start(this.port);
        if (plan.ids.includes("codex")) { this.writeCatalog(); this.config.attach(); }
        for (const id of plan.ids) this.enabled[id] = true;
      } else {
        const stopService = !IDS.some((id) => !plan.ids.includes(id) && this.enabled[id]);
        for (const id of plan.ids) this.blocked.add(id);
        if (stopService) this.blocked.add("diagnostics");
        const active = stopService ? this.router.clientActive() + this.extraActive() : plan.ids.reduce((n, id) => n + this.router.clientActive(id), 0);
        if (active) throw Error(`仍有 ${active} 条请求正在进行，未断开；请等待任务完成后重新确认`);
        const observed = this.processes.snapshot();
        if (observed.error) throw Error("进程身份检查失败，未停止服务或恢复注入：" + observed.error);
        const sessions = observed.sessions.filter((s) => plan.ids.includes(s.harness) && s.status !== "gone");
        if (sessions.some((s) => s.status !== "running")) throw Error("部分窗口身份无法确认，请手动关闭并刷新后再操作");
        if (sessions.length && mode === "safe") throw Error("仍有 ASS 启动的客户端窗口；请先自行退出，或明确选择结束这些窗口");
        if (sessions.length) {
          const result = await this.processes.stop(sessions.map((s) => s.id));
          if (result.error || result.sessions.some((s) => sessions.some((x) => x.id === s.id) && s.status !== "gone"))
            throw Error("未能确认所有选定窗口已结束，未继续清理注入；部分窗口可能已关闭，请刷新检查");
        }
        // Recheck after asynchronous process operations. Never overwrite concurrent user edits.
        this.preflight(plan.ids, false);
        if (plan.ids.includes("codex")) this.config.detach();
        this.injections.restore(plan.ids);
        for (const id of plan.ids) this.enabled[id] = false;
        if (stopService) await this.router.stop();
      }
      atomic(this.file, JSON.stringify(this.enabled));
      this.revision++;
      return { ok: true, quit: plan.quit, message: plan.enabled
        ? plan.ids.includes("codex") ? "已开启接入。Codex App 请在任务结束后手动重启。" : "已开启接入，从 ASS 新启动客户端时生效。"
        : "已断开所选客户端、恢复其注入文件；账户与会话数据保留。" };
    } finally {
      this.busy = false;
      this.blocked.clear();
      this.onChange();
    }
  }
  async launch(work) {
    if (this.busy) throw Error("正在切换接入，请稍后启动客户端");
    this.busy = true;
    this.revision++;
    try { return await work(); }
    finally { this.busy = false; this.onChange(); }
  }
}
module.exports = { Connections };
