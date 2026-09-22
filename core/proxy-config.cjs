const fs = require("node:fs");
const path = require("node:path");
const { atomic } = require("./config.cjs");
const { hash } = require("./injection-files.cjs");
const { makeCatalog } = require("./models.cjs");
const { modelRef } = require("./client-policy.cjs");
const { safePath } = require("./native-fields.cjs");
const IDS = ["codex", "claude"];
const read = (file) => fs.existsSync(file) ? fs.readFileSync(file) : null;

// A draft edit never changes the running route. Persist applied routing secrets
// with the same OS encryption as provider settings, not in a second plaintext DB.
class ProxyConfig {
  constructor(dataDir, crypto, manager, store, config) {
    Object.assign(this, { crypto, manager, store, config });
    this.file = path.join(dataDir, "proxy-applied.json");
    this.clients = {};
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
            Object.entries(clients).some(([id, plan]) => !IDS.includes(id) || !Array.isArray(plan.providers))) throw Error();
        this.clients = clients;
        if (payload.pending) {
          const allowed = [config.file, config.record, config.catalog];
          if (!Array.isArray(payload.pending.files) || payload.pending.files.some((f) =>
            !allowed.includes(f.file) || (f.before !== null && typeof f.before !== "string") || typeof f.after !== "string")) throw Error();
          this.pending = payload.pending;
        }
      }
      this.persistedHash = hash(saved || "");
    } catch {
      this.error = "已应用路由配置无法读取；没有覆盖，请检查数据目录";
    }
  }
  supports(id) { return IDS.includes(id); }
  desired(id) {
    if (!this.supports(id)) return null;
    const injection = this.manager.injection(id);
    const refs = new Set(injection.models.filter((m) => m.included).map((m) => m.ref));
    const providers = this.store.state.providers.flatMap((p) => {
      const models = p.models.filter((m) => refs.has(modelRef(p.id, m.model)));
      if (!models.length) return [];
      // Balance configuration is not a routing change.
      const { balance, ...provider } = p;
      return [{ ...provider, models }];
    });
    if (injection.defaultModel && !refs.has(injection.defaultModel))
      throw Error("默认接入模型不可用，请重新选择");
    const row = injection.models.find((m) => m.ref === injection.defaultModel);
    const model = row && providers.find((p) => p.id === row.providerId).models.find((m) => m.model === row.model);
    return {
      providers,
      defaultModel: row ? { model: row.providerId + "::" + row.model, effort: model.defaultEffort } : null,
      ...(id === "codex" ? { catalog: makeCatalog(this.store.officialModels, providers, this.store.state.officialOverrides) } : {}),
    };
  }
  checkFiles(id) {
    if (this.error) throw Error(this.error);
    if (this.persistedHash !== hash(read(this.file) || "")) throw Error("已应用路由记录被外部修改，请重启并检查");
    if (this.pending) { this.recoveryCheck(); throw Error("路由配置事务待恢复，请点击重新同步"); }
    if (id === "codex" && this.clients.codex &&
        hash(read(this.config.catalog) || "") !== hash(JSON.stringify(this.clients.codex.catalog, null, 2)))
      throw Error("Codex 已应用模型目录被外部修改；未覆盖");
  }
  status(id, enabled) {
    if (!this.supports(id)) return {};
    let desired, error = "";
    try { this.checkFiles(id); desired = this.desired(id); if (id === "codex" && enabled) this.config.preflightDetach(); }
    catch (e) { error = e.message; }
    const pending = !!enabled && (hash(JSON.stringify(desired || null)) !== hash(JSON.stringify(this.clients[id] || null)) ||
      (id === "codex" && !this.config.status().attached));
    const count = (desired?.providers || []).reduce((n, p) => n + p.models.length, 0);
    const files = id === "codex" && this.config.status().managed ? [this.config.file, this.config.catalog].filter(fs.existsSync)
      : this.clients[id] ? [this.file] : [];
    return { mode: "proxy", error, pending, modelCount: count, files,
      applied: !!enabled && !error && !pending && count > 0,
      runtimeStatus: enabled ? (id === "codex" ? "reload-required" : "new-window-only") : "inactive" };
  }
  fingerprint(ids, enabled) {
    return hash(JSON.stringify([read(this.file)?.toString("base64"), ids.filter((id) => this.supports(id)).map((id) =>
      [id, enabled ? this.desired(id) : null, id === "codex" ? read(this.config.catalog)?.toString("base64") : null])]));
  }
  preflight(ids, enabled) {
    if (!enabled) {
      if (this.pending && ids.includes("codex")) throw Error("路由配置事务待恢复，请先重新同步");
      return;
    }
    for (const id of ids.filter((id) => this.supports(id))) {
      if (this.pending) { this.recoveryCheck(); continue; }
      this.checkFiles(id);
      const plan = this.desired(id);
      if (!plan.providers.length) throw Error("没有可接入的兼容模型，请先配置供应商与模型");
      if (id === "codex") this.config.prepareAttach(plan.defaultModel);
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
  sync(id) {
    if (!this.supports(id)) return;
    this.recover();
    this.preflight([id], true);
    const plan = this.desired(id);
    const files = [];
    if (id === "codex") {
      const attachment = this.config.prepareAttach(plan.defaultModel);
      const backup = path.join(this.config.dataDir, "backups", "config-" + Date.now() + "-proxy.toml");
      safePath(backup); atomic(backup, attachment.old);
      const values = [
        [this.config.catalog, JSON.stringify(plan.catalog, null, 2)],
        [this.config.record, JSON.stringify({ backup, replaced: attachment.replaced, blocks: attachment.text.match(/# >>> ass managed start[\s\S]*?# <<< ass managed end/g) })],
        [this.config.file, attachment.text],
      ];
      for (const [file, after] of values) { safePath(file); files.push({ file, before: read(file)?.toString() ?? null, after }); }
      if (files.at(-1).before !== attachment.old) throw Error("Codex 配置同时被修改，请重新确认");
    }
    try {
      this.persist(this.clients, { files });
      for (const f of files) {
        if ((read(f.file)?.toString() ?? null) !== f.before) throw Error("接入配置在写入前被修改，已停止");
        atomic(f.file, f.after);
      }
      this.persist({ ...this.clients, [id]: plan });
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
    for (const id of ids) delete clients[id];
    this.persist(clients);
  }
  routingState(id) {
    if (!this.supports(id)) return this.store.state; // Diagnostics use drafts.
    return { providers: this.error ? [] : (this.clients[id]?.providers || []) };
  }
  requireApplied(id) {
    if (!this.status(id, true).applied) throw Error("模型接入配置尚未同步，请先在接入控制中同步后再启动");
  }
}
module.exports = { ProxyConfig };
