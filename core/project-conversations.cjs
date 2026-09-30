const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { atomic, safePath } = require('./native-fields.cjs');
const { HARNESSES } = require('./project-codecs.cjs');
class ProjectConversations {
  constructor({ dataDir, crypto: encryption, sources, history, releaseImports, assertIdle, now = Date.now }) {
    this.vault = path.join(dataDir, 'project-conversations'); this.file = path.join(this.vault, 'index.enc.json');
    this.encryption = encryption; this.sources = sources; this.history = history; this.releaseImports = releaseImports; this.assertIdle = assertIdle;
    this.now = now; this.queue = Promise.resolve(); this.candidates = []; this.recordsCache = [];
    this.state = { version: 1, secret: '', projects: [], observed: {} }; this.error = ''; this.job = null;
    try { safePath(this.file); const raw = fs.existsSync(this.file) ? (() => {
      if (fs.statSync(this.file).size > 64 * 1024 ** 2) throw Error(); return fs.readFileSync(this.file, 'utf8');
    })() : null; if (raw) {
      const state = JSON.parse(encryption.decryptString(Buffer.from(JSON.parse(raw).encrypted, 'base64')));
      if (state.version !== 1 || !Array.isArray(state.projects) || Buffer.from(state.secret || '', 'base64').length !== 32) throw Error();
      this.state = { observed: {}, ...state };
    } } catch { this.error = '项目对话索引无法解密，未覆盖'; }
  }
  serial(fn) { const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next; }
  persist() {
    if (this.error) throw Error(this.error);
    if (!this.encryption.isEncryptionAvailable()) throw Error('本机加密不可用，未启用项目同步');
    this.state.secret ||= crypto.randomBytes(32).toString('base64');
    atomic(this.file, JSON.stringify({ encrypted: this.encryption.encryptString(JSON.stringify(this.state)).toString('base64') }));
  }
  run(action, args = {}) {
    return new Promise((resolve, reject) => {
      const w = new Worker(path.join(__dirname, 'project-conversation-worker.cjs'), { workerData: {
        action, vault: this.vault, state: this.state, sources: this.sources(), ...args,
      } }); let done = false;
      const finish = (e, v) => { if (done) return; done = true; clearTimeout(timer); e ? reject(e) : resolve(v); };
      const timer = setTimeout(() => { w.terminate(); finish(Error('项目同步超时，原生历史未覆盖')); }, 120000);
      w.once('message', (r) => finish(r.error ? Error(r.error) : null, r.result));
      w.once('error', () => finish(Error('项目对话读取失败'))); w.once('exit', () => finish(Error('项目同步意外结束')));
    });
  }
  project(id) { const p = this.state.projects.find((p) => p.id === id); if (!p) throw Error('项目不存在，请刷新'); return p; }
  summary(p) { return { id: p.id, cwd: p.cwd, name: p.name, enabled: p.enabled, targets: p.targets, count: p.enabled ? p.threads.length : this.recordsCache.filter((r) => r.projectId === p.id).length,
    branches: p.threads.filter((r) => r.branchOf).length, lastSync: p.lastSync, errors: p.errors || [] }; }
  async list() {
    return this.serial(async () => {
      const r = await this.run('discover', { history: await this.history?.() || [] }); this.candidates = r.projects; this.recordsCache = r.records;
      if (!this.error) { this.state.observed = r.observed; this.state.catalog = r.catalog; this.persist(); }
      const map = new Map(r.projects.map((p) => [p.id, { ...p, enabled: false, targets: HARNESSES, lastSync: '', branches: 0 }]));
      for (const p of this.state.projects) map.set(p.id, { ...map.get(p.id), ...this.summary(p) });
      return { items: [...map.values()].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)),
        retained: Object.fromEntries(HARNESSES.map((h) => [h, r.records.filter((r) => r.harness === h && r.retained).length])), errors: r.errors, error: this.error || this.lastError || '' };
    });
  }
  async configure(id, { enabled, targets = HARNESSES } = {}) {
    if (typeof enabled !== 'boolean' || !Array.isArray(targets) || !targets.length || targets.some((h) => !HARNESSES.includes(h))) throw Error('项目同步选项无效');
    if (id === 'unassigned') throw Error('无项目会话只管理内容，不支持同步');
    if (!enabled && this.state.projects.find((p) => p.id === id)?.enabled) {
      await this.assertIdle?.(id); await this.sync(id);
      return this.serial(async () => {
        await this.assertIdle?.(id);
        const plan = await this.run('release-plan', { projectId: id });
        this.state = plan.state; this.project(id).releasePlan = plan; delete plan.state; this.persist();
        if (plan.imports.length || plan.returns.length) {
          if (!this.releaseImports) throw Error('此项目包含 OpenCode 同步副本，需要可用的 CLI 才能关闭同步');
          await this.releaseImports(plan);
        }
        const r = await this.run('release-commit', { projectId: id, plan }); this.state = r.state;
        delete this.project(id).releasePlan; this.persist(); this.recordsCache = [];
        return { ...this.summary(this.project(id)), removed: r.removed, message: '同步已关闭，已完成内容归回初始客户端；同步副本已移除，可从 ASS 备份恢复。' };
      });
    }
    await this.serial(() => {
      let p = this.state.projects.find((p) => p.id === id);
      if (!p) {
        const candidate = this.candidates.find((p) => p.id === id); if (!candidate || !path.isAbsolute(candidate.cwd)) throw Error('请先从记录中选择项目');
        safePath(candidate.cwd); if (!fs.statSync(candidate.cwd).isDirectory()) throw Error('项目目录不存在');
        p = { id, cwd: candidate.cwd, name: candidate.name, enabled: false, targets: [], threads: [], origins: {}, errors: [] }; this.state.projects.push(p);
      }
      const before = { enabled: p.enabled, targets: p.targets }; p.enabled = enabled; p.targets = [...new Set(targets)];
      try { this.persist(); } catch (e) { Object.assign(p, before); throw e; }
    });
    if (enabled) await this.sync(id);
    return this.summary(this.project(id));
  }
  async sync(id) {
    return this.serial(async () => {
      if (id) this.project(id); if (!this.state.projects.some((p) => p.enabled && (!id || p.id === id))) return { updated: 0 };
      this.persist(); const r = await this.run('sync', { projectId: id });
      const old = this.state; this.state = r.state;
      try { this.persist(); } catch (e) { this.state = old; throw e; }
      const errors = this.state.projects.filter((p) => p.enabled).reduce((n, p) => n + p.errors.length, 0);
      return { updated: r.updated, message: (r.updated ? `已同步 ${r.updated} 条对话更新` : '项目对话已同步') + (errors ? `；${errors} 个来源暂时无法读取` : ''), projects: this.state.projects.map((p) => this.summary(p)) };
    });
  }
  async threads(id, { offset = 0, query = '' } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || typeof query !== 'string' || query.length > 500) throw Error('对话查询无效');
    await this.sync(id); const p = this.project(id);
    const filtered = p.threads.filter((t) => t.title.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ...this.summary(p), total: filtered.length, offset, items: filtered.slice(offset, offset + 40).map((t) => ({ id: t.id, title: t.title, count: t.refs.length, updatedAt: t.updatedAt,
      branchOf: t.branchOf || '', originHarness: t.home?.harness || t.origins[0]?.harness, harnesses: [...new Set(t.origins.map((o) => o.harness))], projections: t.routes.map((r) => ({ harness: r.harness, mode: r.mode })) })) };
  }
  async records(id, { offset = 0, query = '', harness = '', pinned = false } = {}) {
    if (!Number.isInteger(offset) || offset < 0 || typeof query !== 'string' || query.length > 500 || (harness && !HARNESSES.includes(harness))) throw Error('会话查询无效');
    if (!this.candidates.some((p) => p.id === id) && !this.state.projects.some((p) => p.id === id)) await this.list();
    const all = this.recordsCache.filter((r) => r.projectId === id && (!harness || r.harness === harness));
    const filtered = all.filter((r) => (!pinned || r.pinned) && `${r.title} ${r.sessionId}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    return { total: filtered.length, offset, items: filtered.slice(offset, offset + 40).map((r) => ({ ...r, kind: 'native' })) };
  }
  record(id) { const r = this.recordsCache.find((r) => r.id === id); if (!r) throw Error('会话不存在，请刷新'); return r; }
  async nativePreview(id, before = 0) {
    if (!Number.isInteger(before) || before < 0) throw Error('会话页码无效');
    return this.run('native-preview', { row: this.record(id), before });
  }
  async preview(projectId, threadId, before = 0) {
    if (!Number.isInteger(before) || before < 0) throw Error('对话页码无效');
    return this.serial(() => this.run('preview', { projectId, threadId, before }));
  }
  async prepare(projectId, threadId, harness, dir) {
    if (!HARNESSES.includes(harness) || !path.isAbsolute(dir)) throw Error('客户端目录无效');
    await this.sync(projectId);
    return this.serial(async () => {
      const p = this.project(projectId); if (!p.enabled || !p.targets.includes(harness)) throw Error('请先启用此项目与客户端的同步');
      this.persist(); const r = await this.run('prepare', { projectId, threadId, harness, dir });
      const old = this.state; this.state = r.state;
      try { this.persist(); } catch (e) { this.state = old; throw e; }
      const { state, ...result } = r; return result;
    });
  }
  start() {
    this.timer = setInterval(() => {
      if (this.job || !this.state.projects.some((p) => p.enabled)) return;
      this.job = this.sync().catch((e) => { this.lastError = e.message; }).finally(() => { this.job = null; });
    }, 15000); this.timer.unref();
  }
  stop() { clearInterval(this.timer); }
}
module.exports = { ProjectConversations };
