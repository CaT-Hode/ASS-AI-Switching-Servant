const fs = require("node:fs");
const path = require("node:path");
const { atomic } = require("./config.cjs");
const { hash } = require("./injection-files.cjs");
const { makeCatalog } = require("./models.cjs");
const { modelRef } = require("./client-policy.cjs");
const { safePath } = require("./native-fields.cjs");
const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual: equal } = require("node:util");
const claudeNative = require("./claude-native.cjs");
const routeOnly = (plan) => { if (!plan) return null; const { nativeClaude, ...route } = plan; return route; };
const IDS = ["codex", "claude"];
const read = (file) => fs.existsSync(file) ? fs.readFileSync(file) : null;

// A draft edit never changes the running route. Persist applied routing secrets
// with the same OS encryption as provider settings, not in a second plaintext DB.
class ProxyConfig {
  constructor(dataDir, crypto, manager, store, config, desktop) {
    Object.assign(this, { crypto, manager, store, config, desktop });
    this.file = path.join(dataDir, "proxy-applied.json");
    this.clients = {};
    this.modeTokens = {};
    this.pending = null;
    this.error = "";
    try {
      const saved = read(this.file);
      if (saved) {
        if (saved.length > 8 * 1024 * 1024) throw Error();
        const record = JSON.parse(saved);
        if (record.version !== 1 || typeof record.encrypted !== "string") throw Error();
        const payload = JSON.parse(crypto.decryptString(Buffer.from(record.encrypted, "base64")));
        const clients = payload.clients;
        if (!clients || typeof clients !== "object" || Array.isArray(clients) ||
            Object.entries(clients).some(([id, plan]) => !IDS.includes(id) || !Array.isArray(plan.providers) ||
              (plan.accountless !== undefined && typeof plan.accountless !== "boolean") ||
              (plan.accountless && (!/^[a-f0-9]{64}$/.test(plan.localToken || "") || !plan.providers.some((p) => p.models?.length))))) throw Error();
        this.clients = clients;
        claudeNative.validate(clients.claude?.nativeClaude);
        if (payload.pending) {
          const allowed = [config.file, config.record, config.catalog, ...Object.values(claudeNative.targets(manager)),
            ...Object.values(clients.claude?.nativeClaude?.targets || {})];
          if (!Array.isArray(payload.pending.files) || payload.pending.files.some((f) =>
            (!allowed.includes(f.file) && !desktop?.allowsFile(f.file)) || (f.before !== null && typeof f.before !== "string") ||
            (f.after !== null && typeof f.after !== "string"))) throw Error();
          this.pending = payload.pending;
        }
      }
      this.persistedHash = hash(saved || "");
    } catch {
      this.error = "已应用路由配置无法读取；没有覆盖，请检查数据目录";
    }
  }
  supports(id) { return IDS.includes(id); }
  desired(id, accountless = this.clients[id]?.accountless === true) {
    if (!this.supports(id)) return null;
    const injection = this.manager.injection(id);
    const refs = new Set(injection.models.filter((m) => m.included).map((m) => m.ref));
    const providers = (this.manager.effectiveProviders?.(id) || this.store.state.providers).flatMap((p) => {
      const models = p.models.filter((m) => refs.has(modelRef(p.id, m.model)));
      if (!models.length) return [];
      // Balance configuration is not a routing change.
      const { balance, ...provider } = p;
      return [{ ...provider, models }];
    });
    if (accountless && !providers.length) throw Error("无账号启动需要至少一个已接入的模型");
    const catalog = id === "codex" ? makeCatalog(this.store.officialModels, providers, this.store.state.officialOverrides) : null;
    if (accountless && catalog) catalog.models = catalog.models.filter((m) => m.slug.includes("::"));
    const first = providers[0]?.models[0];
    return {
      providers,
      defaultModel: accountless ? { model: providers[0].id + "::" + first.model, effort: first.defaultEffort } : null,
      ...(accountless ? { accountless: true, localToken: this.clients[id]?.localToken || (this.modeTokens[id] ||= require("node:crypto").randomBytes(32).toString("hex")) } : {}),
      ...(catalog ? { catalog } : {}),
    };
  }
  checkFiles(id) {
    if (this.error) throw Error(this.error);
    if (this.persistedHash !== hash(read(this.file) || "")) throw Error("已应用路由记录被外部修改，请重启并检查");
    if (this.pending) { this.recoveryCheck(); throw Error("路由配置事务待恢复，请点击重新同步"); }
    if (id === "codex" && this.clients.codex &&
        hash(read(this.config.catalog) || "") !== hash(JSON.stringify(this.clients.codex.catalog, null, 2)))
      throw Error("Codex 已应用模型目录被外部修改；未覆盖");
    if (id === "claude") claudeNative.check(this.clients.claude?.nativeClaude);
  }
  status(id, enabled) {
    if (!this.supports(id)) return {};
    let desired, error = "";
    let nativePending = false;
    try {
      this.checkFiles(id); desired = this.desired(id);
      if (id === "codex" && enabled) this.config.preflightDetach();
      if (id === "claude" && enabled && desired.accountless) {
        const native = claudeNative.plan(this.manager, desired, this.clients.claude?.nativeClaude);
        nativePending = !this.clients.claude?.nativeClaude || native.files.length > 0;
        if (this.desktop) {
          const desktop = this.desktop.status(desired.localToken, this.manager.options?.port || 25819);
          if (desktop.conflict) throw Error("Claude 桌面版配置存在冲突，请检查第三方推理设置");
          nativePending ||= !desktop.current;
        }
      }
    }
    catch (e) { error = e.message; }
    const pending = !!enabled && (nativePending || !equal(desired || null, routeOnly(this.clients[id])) ||
      (id === "codex" && !this.config.status().attached));
    const count = (desired?.providers || []).reduce((n, p) => n + p.models.length, 0);
    const files = id === "codex" && this.config.status().managed ? [this.config.file, this.config.catalog].filter(fs.existsSync)
      : this.clients[id] ? [this.file, ...Object.values(this.clients[id].nativeClaude?.targets || {})] : [];
    return { mode: "proxy", error, pending, modelCount: count, files,
      applied: !!enabled && !error && !pending,
      runtimeStatus: enabled ? (id === "codex" ? "reload-required" : this.clients[id]?.nativeClaude ? "terminal-ready" : "new-window-only") : "inactive" };
  }
  fingerprint(ids, enabled) {
    return hash(JSON.stringify([read(this.file)?.toString("base64"), ids.filter((id) => this.supports(id)).map((id) =>
      [id, enabled ? this.desired(id) : null, id === "codex" ? [read(this.config.catalog)?.toString("base64"), read(this.config.record)?.toString("base64")]
        : [claudeNative.fingerprint(this.manager, this.clients.claude?.nativeClaude), this.desktop?.fingerprint()]])]));
  }
  preflight(ids, enabled, accountless) {
    if (!enabled) {
      if (this.pending && ids.some(id => this.supports(id))) throw Error("路由配置事务待恢复，请先重新同步");
      if (ids.includes("claude") && this.clients.claude?.nativeClaude) {
        this.checkFiles("claude");
        claudeNative.plan(this.manager, null, this.clients.claude.nativeClaude);
      }
      if (ids.includes("claude")) this.desktop?.plan();
      return;
    }
    for (const id of ids.filter((id) => this.supports(id))) {
      if (this.pending) { this.recoveryCheck(); continue; }
      this.checkFiles(id);
      const plan = this.desired(id, accountless);
      if (!plan.providers.length && !this.clients[id]) throw Error("没有可接入的兼容模型，请先配置供应商与模型");
      if (id === "codex") this.config.prepareAttach(plan.defaultModel, plan.localToken);
      if (id === "claude") {
        claudeNative.plan(this.manager, plan, this.clients.claude?.nativeClaude);
        this.desktop?.plan(plan.accountless ? plan.localToken : null, this.manager.options?.port || 25819);
      }
    }
  }
  persist(clients, pending = null) {
    if (!this.crypto.isEncryptionAvailable()) throw Error("Windows 凭据加密不可用，未应用路由配置");
    safePath(this.file);
    const value = JSON.stringify({ version: 1, encrypted: this.crypto.encryptString(JSON.stringify({ clients, pending })).toString("base64") });
    if (Buffer.byteLength(value) > 8 * 1024 * 1024) throw Error("路由恢复记录超过 8 MiB，未写入");
    atomic(this.file, value);
    this.persistedHash = hash(value);
    this.clients = structuredClone(clients);
    this.pending = structuredClone(pending);
  }
  recoveryCheck() {
    if (this.error) throw Error(this.error);
    for (const f of this.pending?.files || []) {
      safePath(f.file);
      const current = read(f.file)?.toString() ?? null;
      if (current !== f.before && current !== f.after) throw Error("路由恢复遇到外部修改，未覆盖；请检查备份与配置");
    }
  }
  recover() {
    this.recoveryCheck();
    if (!this.pending) return;
    for (const f of [...this.pending.files].reverse()) {
      const current = read(f.file)?.toString() ?? null;
      if (current === f.before) continue;
      if (current !== f.after) throw Error("路由恢复期间配置发生变化，已停止");
      if (f.before !== null) atomic(f.file, f.before);
      else fs.unlinkSync(f.file);
    }
    this.persist(this.clients);
  }
  sync(id, accountless) {
    if (!this.supports(id)) return;
    this.recover();
    this.preflight([id], true, accountless);
    const plan = this.desired(id, accountless);
    const files = [];
    if (id === "claude") {
      const native = claudeNative.plan(this.manager, plan, this.clients.claude?.nativeClaude);
      if (native.record) plan.nativeClaude = native.record;
      files.push(...native.files);
      files.push(...(this.desktop?.plan(plan.accountless ? plan.localToken : null, this.manager.options?.port || 25819) || []));
    }
    if (id === "codex") {
      const attachment = this.config.prepareAttach(plan.defaultModel, plan.localToken);
      const backup = path.join(this.config.dataDir, "backups", "config-" + Date.now() + "-proxy.toml");
      safePath(backup); atomic(backup, attachment.old);
      const values = [
        [this.config.catalog, JSON.stringify(plan.catalog, null, 2)],
        [this.config.record, JSON.stringify({ backup, replaced: attachment.replaced, blocks: attachment.text.match(/# >>> ass managed start[\s\S]*?# <<< ass managed end/g) })],
        [this.config.file, attachment.text],
      ];
      for (const [file, after] of values) { safePath(file); files.push({ file, before: read(file)?.toString() ?? null, after }); }
      if ((files.at(-1).before ?? "") !== attachment.old) throw Error("Codex 配置同时被修改，请重新确认");
    }
    this.commit({ ...this.clients, [id]: plan }, files);
  }
  commit(clients, files) {
    try {
      this.persist(this.clients, { files });
      for (const f of files) {
        if ((read(f.file)?.toString() ?? null) !== f.before) throw Error("接入配置在写入前被修改，已停止");
        if (f.after === null) fs.unlinkSync(f.file);
        else atomic(f.file, f.after);
      }
      this.persist(clients);
    } catch (error) {
      try {
        this.recover();
      } catch { throw Error(error.message + "；恢复接入配置失败，请检查备份"); }
      throw error;
    }
  }
  restore(ids) {
    if (!ids.some((id) => this.supports(id))) return;
    if (this.error) throw Error(this.error);
    if (this.pending) throw Error("路由配置事务待恢复，请先重新同步");
    const clients = { ...this.clients };
    const files = ids.includes("claude") ? claudeNative.plan(this.manager, null, this.clients.claude?.nativeClaude).files : [];
    if (ids.includes("claude")) files.push(...(this.desktop?.plan() || []));
    for (const id of ids) delete clients[id];
    this.commit(clients, files);
  }
  repairPlan(id) {
    if (!this.supports(id) || !this.clients[id]) throw Error("没有可信的已应用路由配置可供修复");
    if (this.error) throw Error(this.error);
    if (this.pending) throw Error("路由事务尚未完成，请先重新同步恢复");
    safePath(this.file);
    const saved = read(this.file), files = [];
    if (hash(saved || "") !== this.persistedHash) {
      // Recover this client from its trusted in-memory applied snapshot, but
      // never undo a concurrent edit to another client's route in the same file.
      try {
        const envelope = JSON.parse(saved);
        if (envelope.version !== 1) throw Error();
        const actual = JSON.parse(this.crypto.decryptString(Buffer.from(envelope.encrypted, "base64")));
        if (actual.pending || !actual.clients || Object.keys(actual.clients).some((k) => !IDS.includes(k)) ||
            IDS.filter((k) => k !== id).some((k) => !equal(actual.clients[k], this.clients[k]))) throw Error();
      } catch { throw Error("路由记录无法安全归属到此客户端，未覆盖"); }
      files.push({ file: this.file, before: saved.toString(), after: null });
    }
    if (id === "codex") {
      for (const file of [this.config.file, this.config.record, this.config.catalog]) safePath(file);
      const attachment = this.config.prepareRepair();
      if (attachment.before !== attachment.after) files.push(attachment);
      const before = read(this.config.catalog)?.toString() ?? null, after = JSON.stringify(this.clients.codex.catalog, null, 2);
      if (before !== after) files.push({ file: this.config.catalog, before, after });
    }
    let nativeClaude;
    if (id === "claude") {
      const native = claudeNative.plan(this.manager, this.clients.claude, this.clients.claude.nativeClaude, { repair: true });
      nativeClaude = native.record;
      files.push(...native.files);
      files.push(...(this.desktop?.plan(this.clients.claude.accountless ? this.clients.claude.localToken : null, this.manager.options?.port || 25819) || []));
    }
    return { files, routeOnly: !files.length, nativeClaude };
  }
  repair(id) {
    const plan = this.repairPlan(id);
    if (!this.crypto.isEncryptionAvailable()) throw Error("系统凭据加密不可用，未修复配置");
    const backup = path.join(path.dirname(this.file), "backups", `proxy-repair-${id}-${Date.now()}-${randomUUID()}.enc.json`);
    const saved = read(this.file)?.toString() ?? null;
    const payload = JSON.stringify({ kind: "proxy-repair", client: id, createdAt: new Date().toISOString(),
      files: [...plan.files.filter((f) => f.file !== this.file).map(({ file, before }) => ({ file, before })), { file: this.file, before: saved }] });
    const encoded = JSON.stringify({ version: 1, encrypted: this.crypto.encryptString(payload).toString("base64") });
    if (Buffer.byteLength(encoded) > 32 * 1024 * 1024) throw Error("修复备份超过 32 MiB，未改动配置");
    safePath(backup); atomic(backup, encoded);
    for (const f of plan.files) if ((read(f.file)?.toString() ?? null) !== f.before) throw Error("修复前配置已变化，未覆盖");
    if ((read(this.file)?.toString() ?? null) !== saved) throw Error("修复前路由记录已变化，未覆盖");
    const files = plan.files.filter((f) => f.file !== this.file);
    try {
      this.persist(this.clients, { files });
      for (const f of files) {
        if ((read(f.file)?.toString() ?? null) !== f.before) throw Error("修复期间配置已变化，已停止");
        if (f.after === null) fs.unlinkSync(f.file);
        else atomic(f.file, f.after);
      }
      this.persist(plan.nativeClaude ? { ...this.clients, claude: { ...this.clients.claude, nativeClaude: plan.nativeClaude } } : this.clients);
    } catch (error) {
      try { this.recover(); }
      catch { throw Error("修复未完成，已保留加密备份与事务恢复记录"); }
      throw error;
    }
    return { backup, files: plan.files.length };
  }
  routingState(id) {
    if (!this.supports(id)) return { ...this.store.state, providers: this.manager.effectiveProviders?.(id) || this.store.state.providers }; // Diagnostics use drafts.
    const plan = this.clients[id];
    return { providers: this.error ? [] : (plan?.providers || []), accountless: plan?.accountless === true, localToken: this.error ? undefined : plan?.localToken };
  }
  requireApplied(id) {
    if (!this.status(id, true).applied) throw Error("模型接入配置尚未同步，请先在接入控制中同步后再启动");
  }
}
module.exports = { ProxyConfig };
