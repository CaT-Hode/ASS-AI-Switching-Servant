const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const { atomic, read, safePath } = require("./native-fields.cjs");
const { snapshotFile, signature } = require("./conversation-files.cjs");
const { historyStatus, inScope } = require('./conversation-status.cjs');
const SUPPORTED = new Set(["codex", "claude"]);
class ConversationLibrary {
  constructor({ dataDir, crypto: encryption, sources, now = Date.now }) {
    this.vault = path.join(dataDir, "conversation-library"); this.file = path.join(this.vault, "index.enc.json");
    this.encryption = encryption; this.sources = sources; this.now = now;
    this.entries = []; this.errors = []; this.secret = ""; this.updatedAt = 0; this.queue = Promise.resolve(); this.scanJob = null; this.pendingCleanup = []; this.persistedRaw = null;
    try {
      const raw = read(this.file);
      this.persistedRaw = raw;
      if (raw) {
        const data = JSON.parse(encryption.decryptString(Buffer.from(JSON.parse(raw).encrypted, "base64")));
        if (data.version !== 1 || !Array.isArray(data.entries) || Buffer.from(data.secret || "", "base64").length !== 32) throw Error();
        this.entries = data.entries; this.secret = data.secret; this.pendingCleanup = data.pendingCleanup || [];
      }
    } catch { this.error = "对话保留索引无法解密，未覆盖；请检查 ASS 数据目录"; }
  }
  serial(fn) { const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next; }
  run(action, args = {}) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "conversation-worker.cjs"), {
        workerData: { action, vault: this.vault, secret: this.secret, ...args },
      });
      let done = false;
      const finish = (err, result) => { if (done) return; done = true; clearTimeout(timer); if (err) reject(err); else resolve(result); };
      const timer = setTimeout(() => { worker.terminate(); finish(Error("会话读取超时，原数据未修改")); }, 120000);
      worker.once("message", (r) => finish(r.error ? Error(r.error) : null, r.result));
      worker.once("error", () => finish(Error("本地会话读取失败")));
      worker.once("exit", () => finish(Error("会话读取意外结束")));
    });
  }
  persist() {
    if (this.error) throw Error(this.error);
    if (!this.encryption.isEncryptionAvailable()) throw Error("本机加密不可用，未切换账户");
    this.secret ||= crypto.randomBytes(32).toString("base64");
    if (read(this.file) !== this.persistedRaw) throw Error('保留索引已被另一实例修改，请重新打开历史管理');
    const raw = JSON.stringify({ encrypted: this.encryption.encryptString(JSON.stringify({ version: 1, secret: this.secret, entries: this.entries, pendingCleanup: this.pendingCleanup })).toString("base64") });
    atomic(this.file, raw); this.persistedRaw = raw;
  }
  async refresh(force = false) {
    if (this.scanJob) return this.scanJob;
    if (!force && this.now() - this.updatedAt < 10000) return;
    this.scanJob = this.serial(async () => {
      const result = await this.run("scan", { sources: this.sources(), entries: this.entries });
      this.entries = result.entries; this.errors = result.errors; this.updatedAt = this.now();
    });
    try { await this.scanJob; } finally { this.scanJob = null; }
  }
  validateHarness(id) { if (!SUPPORTED.has(id)) throw Error("对话管理仅支持 Codex 和 Claude Code"); }
  lookup(id) {
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) throw Error("会话标识无效");
    const row = this.entries.find((r) => r.id === id); if (!row) throw Error("会话不存在，请刷新列表"); return row;
  }
  publicRow(row) {
    const counterpart = this.resumeRow(row.id);
    const { id, sessionId, harness, title, cwd, model, archived, updatedAt, createdAt, size, pinned, sourceLabel, projectless, projectExplicit, projectName } = row;
    return { id, sessionId, harness, title, cwd, model, archived, updatedAt, createdAt, size, pinned, sourceLabel,
      historyStatus: historyStatus(row), nativeIndexState: row.nativeIndexState,
      currentStatus: historyStatus(counterpart), nativeAvailable: counterpart.nativePresent, counterpartId: counterpart.id,
      nativePresent: row.nativePresent, retained: !!row.snapshot, capturedAt: row.snapshot?.capturedAt, file: row.file, dir: row.dir, indexedFile: row.indexedFile, projectless, projectExplicit, projectName };
  }
  async list({ harness = "codex", query = "", offset = 0, pinned = false, refresh = false } = {}) {
    this.validateHarness(harness);
    if (typeof query !== "string" || query.length > 500 || !Number.isInteger(offset) || offset < 0 || offset > 20000) throw Error("对话查询无效");
    await this.refresh(refresh);
    const term = query.trim().toLowerCase();
    const groups = new Map();
    for (const row of this.entries.filter((r) => r.harness === harness && (r.nativePresent || r.snapshot))) {
      const old = groups.get(row.sessionId);
      if (!old || Number(row.nativePresent) > Number(old.nativePresent) ||
          (row.nativePresent === old.nativePresent && row.updatedAt > old.updatedAt)) groups.set(row.sessionId, row);
    }
    const all = [...groups.values()];
    const filtered = all.filter((r) => (!pinned || r.pinned) && (!term || [r.title, r.cwd, r.sessionId].some((t) => t?.toLowerCase().includes(term))))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    return { items: filtered.slice(offset, offset + 40).map((r) => this.publicRow(r)), total: filtered.length, count: all.length,
      retained: all.filter((r) => r.snapshot).length, offset, errors: this.errors.filter((e) => e.harness === harness), error: this.error || "", updatedAt: new Date(this.updatedAt).toISOString() };
  }
  async preview(id, before = 0) {
    if (!Number.isInteger(before) || before < 0 || before > 1960) throw Error("对话页码无效");
    return this.run("preview", { row: this.lookup(id), before });
  }
  backupRevision(harness) {
    return crypto.createHash('sha256').update(JSON.stringify(this.entries.filter((r) => r.harness === harness && r.snapshot)
      .map((r) => [r.id, r.snapshot.blob, r.snapshot.signature]).sort())).digest('hex');
  }
  async backups({ harness = 'codex', offset = 0 } = {}) {
    this.validateHarness(harness);
    if (!Number.isInteger(offset) || offset < 0 || offset > 20000) throw Error('备份页码无效');
    await this.refresh(true);
    const unique = new Map(), rows = this.entries.filter((r) => r.harness === harness && r.snapshot).map((r) => {
      const file = snapshotFile(this.vault, r.snapshot); let bytes = 0, available = false;
      try { const s = fs.lstatSync(file); available = s.isFile() && s.size === r.snapshot.size + 28; if (s.isFile()) bytes = s.size; } catch (e) { if (e.code !== 'ENOENT') throw e; }
      unique.set(file, bytes);
      return { ...this.publicRow(r), capturedAt: r.snapshot.capturedAt, backupBytes: bytes, available };
    }).sort((a, b) => (b.capturedAt || '').localeCompare(a.capturedAt || ''));
    return { items: rows.slice(offset, offset + 40), offset, total: rows.length, bytes: [...unique.values()].reduce((a, b) => a + b, 0),
      revision: this.backupRevision(harness), error: this.error || '' };
  }
  async backupPreview(id, before = 0) {
    if (!Number.isInteger(before) || before < 0 || before > 1960) throw Error('备份页码无效');
    const row = this.lookup(id); if (!row.snapshot) throw Error('保留副本不存在');
    return this.run('preview', { row, before, backupOnly: true });
  }
  resumeRow(id) {
    const row = this.lookup(id);
    if (this.counterpartEntries !== this.entries) {
      this.counterpartEntries = this.entries; this.counterparts = new Map();
      for (const r of this.entries) if (r.nativePresent) {
        const key = r.harness + '\0' + r.sessionId, old = this.counterparts.get(key);
        if (!old || Number(!!r.indexedFile) > Number(!!old.indexedFile) || (r.indexedFile === old.indexedFile && r.updatedAt > old.updatedAt)) this.counterparts.set(key, r);
      }
    }
    return this.counterparts.get(row.harness + '\0' + row.sessionId) || row;
  }
  async restoreBackup(id, target) {
    return this.serial(async () => {
      const row = this.lookup(id);
      if (!row.snapshot) throw Error('保留副本不存在');
      if (this.resumeRow(id).nativePresent) throw Error('原生会话仍在，未覆盖；可使用当前记录继续');
      const result = await this.run('stage', { row, target, backupOnly: true }); this.updatedAt = 0;
      return { ...result, message: '已从保留副本恢复到当前客户端的本地目录。' };
    });
  }
  async cleanupBackups({ harness, ids, revision, confirmed } = {}) {
    this.validateHarness(harness);
    if (confirmed !== true || typeof revision !== 'string' || (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.some((id) => !/^[a-f0-9]{64}$/.test(id))))) throw Error('请确认清理保留副本');
    return this.serial(() => {
      if (this.error) throw Error(this.error);
      if (revision !== this.backupRevision(harness)) throw Error('保留副本已变化，请刷新后重新清理');
      const selected = this.entries.filter((r) => r.harness === harness && r.snapshot && (!ids || ids.includes(r.id)));
      if (ids && new Set(selected.map((r) => r.id)).size !== new Set(ids).size) throw Error('副本不属于当前客户端，未清理');
      const selectedIds = new Set(selected.map((r) => r.id)), shared = new Set(this.entries.filter((r) => !selectedIds.has(r.id) && r.snapshot).map((r) => r.snapshot.blob));
      const plans = new Map();
      for (const row of selected) {
        const file = snapshotFile(this.vault, row.snapshot); safePath(file);
        if (shared.has(row.snapshot.blob)) continue;
        let stat; try { stat = fs.lstatSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if (stat && !stat.isFile()) throw Error('副本不是普通文件，未清理');
        plans.set(row.snapshot.blob, { blob: row.snapshot.blob, harness, stamp: stat && signature(stat), bytes: stat?.size || 0 });
      }
      // Commit the bounded deletion intent before removing ciphertext. A failed
      // unlink keeps its entry and remains visible/retryable in history management.
      const previous = this.pendingCleanup;
      this.pendingCleanup = [...previous.filter((p) => !plans.has(p.blob)), ...plans.values()];
      try { this.persist(); } catch (e) { this.pendingCleanup = previous; throw e; }
      const removed = new Set(shared), failures = []; let bytes = 0;
      for (const p of plans.values()) {
        const file = snapshotFile(this.vault, p);
        try {
          if (fs.existsSync(file)) {
            safePath(file); const s = fs.lstatSync(file);
            if (!s.isFile() || signature(s) !== p.stamp) throw Error('副本在清理前发生变化');
            fs.unlinkSync(file); bytes += p.bytes;
          }
          removed.add(p.blob);
        } catch { failures.push(p.blob); }
      }
      let count = 0;
      for (const row of selected) if (removed.has(row.snapshot.blob)) { delete row.snapshot; count++; }
      this.entries = this.entries.filter((r) => r.nativePresent || r.snapshot || r.pinned);
      this.pendingCleanup = this.pendingCleanup.filter((p) => !removed.has(p.blob));
      this.persist();
      return { count, bytes, failed: failures.length, message: `已清理 ${count} 个保留副本` + (failures.length ? `；${failures.length} 个文件未能清理，仍可重试` : '') };
    });
  }
  pin(id, value) {
    return this.serial(() => {
      if (typeof value !== "boolean") throw Error("置顶选项无效");
      const row = this.lookup(id), related = this.entries.filter((r) => r.harness === row.harness && r.sessionId === row.sessionId);
      const old = related.map((r) => r.pinned); related.forEach((r) => { r.pinned = value; });
      try { this.persist(); } catch (e) { related.forEach((r, i) => { r.pinned = old[i]; }); throw e; }
      return this.publicRow(row);
    });
  }
  async preserve(harness) {
    this.validateHarness(harness); await this.refresh(true);
    return this.serial(async () => {
      if (this.error) throw Error(this.error);
      if (this.errors.some((e) => e.harness === harness)) throw Error("部分会话无法读取，未切换账户；请检查会话目录权限后重试");
      this.persist(); // Commit the key BEFORE writing any encrypted transcript.
      const result = await this.run("preserve", { entries: this.entries.filter((r) => r.harness === harness && inScope(r)) });
      const previous = new Map();
      for (const item of result.rows) {
        const row = this.lookup(item.id); previous.set(item.id, row.snapshot); row.snapshot = item.snapshot;
      }
      try { this.persist(); } catch (e) { for (const [id, snapshot] of previous) this.lookup(id).snapshot = snapshot; throw e; }
      // Superseded encrypted blobs are ASS-owned, never native transcripts.
      for (const [id, old] of previous) if (old && old.blob !== this.lookup(id).snapshot.blob) {
        try { fs.unlinkSync(snapshotFile(this.vault, old)); } catch {}
      }
      if (result.failures.length) throw Error(`${result.failures.length} 个会话未能保留，未切换账户；请等待任务结束后重试`);
      return { count: result.rows.length, retained: new Set(this.entries.filter((r) => r.harness === harness && r.snapshot).map((r) => r.sessionId)).size };
    });
  }
  async stage(id, target) {
    return this.serial(async () => {
      const row = this.lookup(id), result = await this.run("stage", { row, target });
      this.updatedAt = 0;
      return { ...result, conversation: this.publicRow(row) };
    });
  }
}
// Preserve first; OAuthHistory still performs its own compare-before-write and
// one-use-ticket checks after the asynchronous snapshot. No client is restarted.
async function switchWithConversations({ history, library, ticket, confirmed, selectTarget }) {
  const record = history.tickets.get(ticket);
  if (!record || confirmed !== true || record.expires < history.now()) throw Error("切换确认已失效，请重新选择账户");
  const retained = SUPPORTED.has(record.harness) ? await library.preserve(record.harness) : null;
  const result = history.apply(ticket, confirmed);
  let warning = "";
  if (retained) { try { selectTarget?.(record.harness); } catch { warning = "；启动账户选择未保存，请从当前账户卡片启动"; } }
  return { ...result, conversations: retained,
    message: retained ? `OAuth 已切换，本地对话已保留（${retained.retained} 个）。新窗口使用当前账户；已有窗口请自行重启。${warning}` : result.message };
}
module.exports = { ConversationLibrary, switchWithConversations };
