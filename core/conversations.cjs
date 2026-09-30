const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const { atomic, read } = require("./native-fields.cjs");
const { snapshotFile } = require("./conversation-files.cjs");
const SUPPORTED = new Set(["codex", "claude"]);
class ConversationLibrary {
  constructor({ dataDir, crypto: encryption, sources, now = Date.now }) {
    this.vault = path.join(dataDir, "conversation-library"); this.file = path.join(this.vault, "index.enc.json");
    this.encryption = encryption; this.sources = sources; this.now = now;
    this.entries = []; this.errors = []; this.secret = ""; this.updatedAt = 0; this.queue = Promise.resolve(); this.scanJob = null;
    try {
      const raw = read(this.file);
      if (raw) {
        const data = JSON.parse(encryption.decryptString(Buffer.from(JSON.parse(raw).encrypted, "base64")));
        if (data.version !== 1 || !Array.isArray(data.entries) || Buffer.from(data.secret || "", "base64").length !== 32) throw Error();
        this.entries = data.entries; this.secret = data.secret;
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
    atomic(this.file, JSON.stringify({ encrypted: this.encryption.encryptString(JSON.stringify({ version: 1, secret: this.secret, entries: this.entries })).toString("base64") }));
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
    const { id, sessionId, harness, title, cwd, model, archived, updatedAt, createdAt, size, pinned, sourceLabel, projectless, projectExplicit, projectName } = row;
    return { id, sessionId, harness, title, cwd, model, archived, updatedAt, createdAt, size, pinned, sourceLabel,
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
      const result = await this.run("preserve", { entries: this.entries.filter((r) => r.harness === harness) });
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
