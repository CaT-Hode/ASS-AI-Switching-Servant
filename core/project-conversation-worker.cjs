const { parentPort, workerData: data } = require('node:worker_threads');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { safePath } = require('./native-fields.cjs');
const codecs = require('./project-codecs.cjs');
const { hash, pathKey } = codecs;
const { historyStatus, inScope } = require('./conversation-status.cjs');
const prefix = (a, b) => a.length <= b.length && a.every((v, i) => v === b[i]);
const identity = (row) => row.harness + '\0' + row.sessionId;
function project(id) { const p = data.state.projects.find((p) => p.id === id); if (!p) throw Error('项目不存在'); return p; }
function thread(p, id) { const t = p.threads.find((t) => t.id === id); if (!t) throw Error('对话不存在'); return t; }
function block(ref, value) {
  if (!/^[a-f0-9]{64}$/.test(ref)) throw Error('对话内容索引无效');
  const file = path.join(data.vault, 'blocks', ref + '.enc'); safePath(file);
  const secret = Buffer.from(data.state.secret, 'base64');
  if (value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) { block(ref); return; }
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', secret, iv), body = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
    try { fs.writeFileSync(file, Buffer.concat([iv, c.getAuthTag(), body]), { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  } else {
    const raw = fs.readFileSync(file); if (raw.length < 28) throw Error('共享内容不完整');
    const c = crypto.createDecipheriv('aes-256-gcm', secret, raw.subarray(0, 12)); c.setAuthTag(raw.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([c.update(raw.subarray(28)), c.final()]).toString());
    if (hash(JSON.stringify({ role: value.role, text: value.text })) !== ref) throw Error('共享内容校验失败'); return value;
  }
}
function refsFor(messages) { return messages.map((m) => { const value = { role: m.role, text: m.text }, ref = hash(JSON.stringify(value)); block(ref, value); return ref; }); }
function merge(p, row) {
  if (!row.messages?.length) return 0;
  const refs = refsFor(row.messages), key = identity(row), projection = p.threads.flatMap((t) => t.routes.map((r) => ({ t, r })))
    .find(({ r }) => r.harness === row.harness && r.sessionId === row.sessionId);
  let origin = p.origins[key], t;
  if (!origin && projection) { origin = p.origins[key] = { threadId: projection.t.id, refs: projection.r.refs, signature: '', file: row.file }; }
  if (!origin) {
    const id = hash(p.id + '\0' + key); t = { id, title: row.title, refs, times: row.messages.map((m) => m.timestamp), createdAt: row.createdAt, updatedAt: row.updatedAt,
      home: { harness: row.harness, sessionId: row.sessionId, dir: row.dir, file: row.file }, origins: [{ harness: row.harness, sessionId: row.sessionId }], routes: [] };
    p.threads.push(t); p.origins[key] = { threadId: id, refs, signature: row.signature, file: row.file }; return 1;
  }
  t = thread(p, origin.threadId);
  if (t.home?.harness === row.harness && t.home?.sessionId === row.sessionId && row.title) t.title = row.title;
  if (prefix(refs, origin.refs)) return 0; // Shrunk/truncated/unfinished source never deletes the shared past.
  if (prefix(t.refs, refs)) { t.refs = refs; t.times = row.messages.map((m) => m.timestamp); t.updatedAt = row.updatedAt; }
  else if (prefix(refs, t.refs)) { origin.refs = refs; origin.signature = row.signature; return 0; }
  else {
    // Two continuations of the same baseline are distinct branches. Never
    // reorder them by wall-clock time or replace either participant's history.
    const id = hash(t.id + '\0' + key + '\0' + refs.join(':'));
    let branch = p.threads.find((b) => b.id === id);
    if (!branch) { branch = { ...t, id, title: t.title + ' · 分支', refs, times: row.messages.map((m) => m.timestamp), branchOf: t.id, routes: [], origins: [{ harness: row.harness, sessionId: row.sessionId }], updatedAt: row.updatedAt }; p.threads.push(branch); }
    t = branch; origin.threadId = id;
  }
  origin.refs = refs; origin.signature = row.signature;
  if (!t.origins.some((o) => o.harness === row.harness && o.sessionId === row.sessionId)) t.origins.push({ harness: row.harness, sessionId: row.sessionId });
  return 1;
}
function discover() {
  data.state.catalog ||= {};
  const result = codecs.discover(data.sources, { cache: data.state.catalog }), grouped = new Map();
  const records = new Map();
  const prefer = (old, row) => !old || Number(!!row.nativePresent) > Number(!!old.nativePresent) ||
    (row.nativePresent === old.nativePresent && (Number(!!row.indexedFile) > Number(!!old.indexedFile) ||
      (row.indexedFile === old.indexedFile && row.updatedAt > old.updatedAt)));
  for (const row of result.rows) if (prefer(records.get(identity(row)), row)) records.set(identity(row), row);
  for (const history of data.history || []) {
    const old = records.get(identity(history));
    const same = old?.file === history.file;
    if (same || prefer(old, history)) records.set(identity(history), { ...old, ...history, libraryId: history.id, dir: history.dir || old?.dir || path.dirname(history.file) });
  }
  const retired = new Set([...(data.state.deleted || []), ...data.state.projects.flatMap((p) => p.retired || [])]);
  for (const entry of data.state.trash || []) if (['deleted', 'purging'].includes(entry.phase)) for (const row of entry.rows || []) retired.add(identity(row));
  for (const [key] of records) if (retired.has(key)) records.delete(key);
  const inactive = {};
  for (const [key, row] of records) {
    row.historyStatus = historyStatus(row);
    if (row.historyStatus !== 'active') inactive[row.harness] = (inactive[row.harness] || 0) + 1;
    if (!inScope(row, data.scope || 'active')) records.delete(key);
  }
  for (const row of records.values()) {
    const cwd = row.projectless ? '' : row.projectExplicit ? row.cwd : codecs.projectPath(row.cwd, data.sources), id = cwd ? hash(pathKey(cwd)) : codecs.NO_PROJECT; row.projectId = id;
    const route = data.state.projects.flatMap((p) => p.threads.flatMap((t) => t.routes.map((r) => ({ p, t, r })))).find(({ r }) => identity(r) === identity(row));
    if (route) row.syncedFrom = route.t.home?.harness || route.t.origins[0]?.harness;
    let p = grouped.get(id);
    if (!p) { p = { id, cwd, name: row.projectName || (cwd ? path.basename(cwd) : '无项目会话'), nonProject: !cwd, count: 0, counts: {}, harnesses: [], keys: new Set() }; grouped.set(id, p); }
    if (!p.keys.has(identity(row))) { p.count++; p.counts[row.harness] = (p.counts[row.harness] || 0) + 1; p.keys.add(identity(row)); }
    if (!p.harnesses.includes(row.harness)) p.harnesses.push(row.harness);
  }
  return { projects: [...grouped.values()].map(({ keys, ...p }) => p), records: [...records.values()], inactive, errors: result.errors, observed: data.state.observed, catalog: data.state.catalog };
}
function sync() {
  let updated = 0;
  for (const p of data.state.projects.filter((p) => p.enabled && (!data.projectId || p.id === data.projectId))) {
    data.state.catalog ||= {};
    const processed = Object.fromEntries(Object.entries(data.state.observed).filter(([key]) => key.startsWith(p.id + ':')).map(([key, sig]) => [key.slice(p.id.length + 1), sig]));
    const r = codecs.discover(data.sources, { cwd: p.cwd, includeMessages: true, cache: data.state.catalog, processed }); p.errors = r.errors;
    const unique = new Map();
    for (const row of r.rows) {
      const ownedProjection = historyStatus(row) === 'residual' && p.threads.some(t => t.routes.some(route => identity(route) === identity(row) && pathKey(route.nativeFile) === pathKey(row.file)));
      if (!inScope(row) && !ownedProjection) continue;
      const old = unique.get(identity(row)); if (!old || Number(!!row.indexedFile) > Number(!!old.indexedFile) || (row.indexedFile === old.indexedFile && row.updatedAt > old.updatedAt)) unique.set(identity(row), row);
    }
    for (const row of unique.values()) {
      const origin = p.origins[identity(row)], shared = origin && p.threads.find((t) => t.id === origin.threadId);
      if (shared?.home?.harness === row.harness && shared.home.sessionId === row.sessionId && row.title) shared.title = row.title;
      const k = p.id + ':' + identity(row); if (data.state.observed[k] === row.signature) continue;
      updated += merge(p, row); if (!row.pending) data.state.observed[k] = row.signature;
    }
    // An explicit CC/pi path can be outside the active account's storage tree.
    for (const route of p.threads.flatMap((t) => t.routes).filter((r) => r.harness !== 'opencode')) {
      if (r.rows.some((row) => identity(row) === route.harness + '\0' + route.sessionId)) continue;
      try { const decoded = codecs.readConversation({ harness: route.harness, file: route.nativeFile, sessionId: route.sessionId });
        if (!decoded.cwd || pathKey(decoded.cwd) !== pathKey(p.cwd)) continue;
        updated += merge(p, { ...decoded, harness: route.harness, file: route.nativeFile, signature: codecs.stamp(fs.statSync(route.nativeFile)), updatedAt: new Date(fs.statSync(route.nativeFile).mtimeMs).toISOString() });
      } catch { /* Missing projections do not remove canonical history. */ }
    }
    p.lastSync = new Date().toISOString();
  }
  return { state: data.state, updated };
}
function nativeFile(harness, dir, cwd, id, timestamp) {
  const safeSlug = codecs.slug(cwd), fileStamp = timestamp.replace(/[:.]/g, '-');
  if (harness === 'codex') return path.join(dir, 'sessions', ...timestamp.slice(0, 10).split('-'), `rollout-${fileStamp}-${id}.jsonl`);
  if (harness === 'claude') return path.join(dir, 'projects', cwd.replace(/[^a-zA-Z0-9-]/g, '-'), id + '.jsonl');
  if (harness === 'pi') return path.join(dir, 'sessions', safeSlug, `${fileStamp}_${id}.jsonl`);
  if (harness === 'dsh') return path.join(dir, 'sessions', codecs.dshSlug(cwd), id, 'session.v3.jsonl.zstd');
  throw Error('此客户端使用原生导入接口');
}
function prepare() {
  const p = project(data.projectId), t = thread(p, data.threadId), harness = data.harness;
  safePath(data.dir); if (!fs.statSync(p.cwd).isDirectory()) throw Error('项目目录不存在');
  const version = hash(t.refs.join(':')), prior = t.routes.find((r) => r.harness === harness && r.version === version && pathKey(r.dir) === pathKey(data.dir));
  if (prior && fs.existsSync(prior.nativeFile || prior.file)) {
    safePath(prior.file); safePath(prior.nativeFile || prior.file);
    if (harness !== 'opencode') {
      const source = fs.statSync(prior.file), native = fs.statSync(prior.nativeFile);
      // Native atomic replacement can detach a hardlink. Resume its current
      // file without rewriting it, and report the actual storage relationship.
      prior.mode = source.dev === native.dev && source.ino === native.ino ? 'hardlink' : 'copy';
    }
    return { state: data.state, ...prior, cwd: p.cwd };
  }
  const digest = hash(p.id + ':' + t.id + ':' + harness + ':' + version + ':' + pathKey(data.dir));
  const sessionId = harness === 'opencode' ? 'ses_' + digest.slice(0, 26) : `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const timestamp = new Date().toISOString(), messages = t.refs.map((ref, i) => ({ ...block(ref), timestamp: t.times[i] }));
  const from = t.home?.harness || t.origins[0]?.harness, labels = { codex: 'Codex', claude: 'CC', dsh: 'DSH', opencode: 'OpenCode', pi: 'pi' };
  const title = `来自 ${labels[from]} 的同步 · ${t.title}`;
  if (messages[0]?.role === 'user') messages[0] = { ...messages[0], text: `[来自 ${labels[from]} 的同步]\n` + messages[0].text };
  const result = codecs.encode(harness, { id: sessionId, cwd: p.cwd, title, messages, createdAt: timestamp });
  const file = path.join(data.vault, 'projections', harness, sessionId + result.suffix); safePath(file); fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, result.bytes, { flag: 'wx', mode: 0o600 });
  let target = file, mode = 'import';
  if (harness !== 'opencode') {
    target = nativeFile(harness, data.dir, p.cwd, sessionId, timestamp); safePath(target); fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) throw Error('已有同名会话，未覆盖');
    try { fs.linkSync(file, target); mode = 'hardlink'; }
    catch (e) { if (!['EXDEV', 'EPERM', 'ENOTSUP'].includes(e.code)) throw e; fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL); mode = 'copy'; }
  }
  const route = { harness, sessionId, version, refs: [...t.refs], dir: data.dir, file, nativeFile: target, mode, createdAt: timestamp };
  t.routes.push(route); return { state: data.state, ...route, cwd: p.cwd };
}
// Two-phase release: export completed updates to the initial harness first,
// then remove ONLY indexed ASS projections after a compare-before-remove.
// The original logs are never overwritten. Removed projections stay recoverable
// in ASS's vault (including native import bundles for OpenCode).
function releasePlan() {
  const p = project(data.projectId), files = [], imports = [], returns = [];
  for (const t of p.threads) {
    let home = t.home;
    if (!home) { const o = t.origins[0], origin = p.origins[o.harness + '\0' + o.sessionId];
      const source = data.sources.find((s) => origin?.file && !path.relative(s.dir, origin.file).startsWith('..') && s.harness === o.harness);
      if (!origin || !source) throw Error('初始客户端位置无法确认，未关闭同步');
      home = t.home = { ...o, file: origin.file, dir: source.dir };
    }
    let origin;
    try { origin = codecs.readConversation(home); } catch { throw Error('初始会话无法读取，请先恢复原记录再关闭同步'); }
    if (origin.pending) throw Error('初始客户端仍有未完成的对话，请结束后关闭同步');
    const oldRefs = origin.messages.map((m) => hash(JSON.stringify({ role: m.role, text: m.text })));
    if (JSON.stringify(oldRefs) !== JSON.stringify(t.refs)) {
      const digest = hash('return:' + p.id + ':' + t.id + ':' + t.refs.join(':'));
      const sessionId = home.harness === 'opencode' ? 'ses_' + digest.slice(0, 26) : `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      const timestamp = t.updatedAt, result = codecs.encode(home.harness, { id: sessionId, cwd: p.cwd, title: t.title,
        messages: t.refs.map((ref, i) => ({ ...block(ref), timestamp: t.times[i] })), createdAt: timestamp });
      const file = path.join(data.vault, 'returned', home.harness, sessionId + result.suffix); safePath(file); fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!fs.existsSync(file)) fs.writeFileSync(file, result.bytes, { flag: 'wx', mode: 0o600 });
      if (home.harness === 'opencode') returns.push({ harness: home.harness, dir: home.dir, sessionId, file, cwd: p.cwd });
      else {
        const target = nativeFile(home.harness, home.dir, p.cwd, sessionId, timestamp); safePath(target); fs.mkdirSync(path.dirname(target), { recursive: true });
        if (!fs.existsSync(target)) { try { fs.linkSync(file, target); } catch (e) { if (!['EXDEV', 'EPERM', 'ENOTSUP'].includes(e.code)) throw e; fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL); } }
        // A collision/modified retry must not be silently treated as a saved return.
        if (hash(fs.readFileSync(file)) !== hash(fs.readFileSync(target))) throw Error('归回记录已发生变化，未移除同步副本');
      }
    }
    for (const r of t.routes) {
      if (r.harness === 'opencode') {
        const db = path.join(r.dir, 'opencode.db');
        if (!fs.existsSync(db)) continue;
        let bundle; try { bundle = codecs.openCodeBundle(db, r.sessionId); } catch (e) { if (/会话不存在/.test(e.message)) continue; throw e; }
        const decoded = codecs.decodeOpenCode(bundle);
        const refs = decoded.messages.map((m) => hash(JSON.stringify({ role: m.role, text: m.text })));
        const owned = p.origins[r.harness + '\0' + r.sessionId];
        if (!owned || JSON.stringify(refs) !== JSON.stringify(owned.refs)) throw Error('OpenCode 同步记录仍在变化，未移除');
        const backup = path.join(data.vault, 'released', r.sessionId + '.json'); safePath(backup); fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, JSON.stringify(bundle), { mode: 0o600 });
        imports.push({ harness: r.harness, dir: r.dir, sessionId: r.sessionId, signature: hash(JSON.stringify(bundle)), cwd: p.cwd });
      } else if (fs.existsSync(r.nativeFile)) {
        safePath(r.nativeFile); const stat = fs.statSync(r.nativeFile), row = codecs.readConversation({ ...r, file: r.nativeFile });
        if (row.pending || row.sessionId !== r.sessionId || pathKey(row.cwd) !== pathKey(p.cwd)) throw Error('同步会话仍在进行或身份改变，未移除');
        const owned = p.origins[r.harness + '\0' + r.sessionId];
        const refs = row.messages.map((m) => hash(JSON.stringify({ role: m.role, text: m.text })));
        if (!owned || JSON.stringify(refs) !== JSON.stringify(owned.refs)) throw Error('同步记录发生变化，请重新关闭同步');
        const backup = path.join(data.vault, 'released', r.harness, r.sessionId + path.extname(r.nativeFile)); safePath(backup); fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(r.nativeFile, backup);
        files.push({ file: r.nativeFile, signature: codecs.stamp(stat), digest: hash(fs.readFileSync(r.nativeFile)) });
      }
    }
  }
  return { state: data.state, files, imports, returns };
}
function releaseCommit() {
  const p = project(data.projectId);
  for (const item of data.plan.files) { safePath(item.file); if (!fs.existsSync(item.file)) continue;
    if (codecs.stamp(fs.statSync(item.file)) !== item.signature || hash(fs.readFileSync(item.file)) !== item.digest) throw Error('同步文件正在变化，未关闭同步'); }
  for (const item of data.plan.files) if (fs.existsSync(item.file)) fs.unlinkSync(item.file);
  // A clean re-enable starts from native history; deleted routes cannot be
  // resurrected from the old canonical graph on the next refresh.
  p.retired = [...new Set([...(p.retired || []), ...p.threads.flatMap((t) => t.routes.map(identity))])];
  p.enabled = false; p.threads = []; p.origins = {}; p.lastSync = '';
  for (const k of Object.keys(data.state.observed)) if (k.startsWith(p.id + ':')) delete data.state.observed[k];
  return { state: data.state, removed: data.plan.files.length + data.plan.imports.length };
}
(async () => {
  if (data.action === 'trash-plan') return require('./conversation-trash.cjs').plan({ vault: data.vault, secret: data.state.secret, rows: data.rows, sources: data.sources, label: data.label });
  if (data.action === 'trash-commit') return require('./conversation-trash.cjs').commit(data.entry);
  if (data.action === 'trash-restore') return require('./conversation-trash.cjs').restore({ vault: data.vault, secret: data.state.secret, entry: data.entry });
  if (data.action === 'discover') return discover();
  if (data.action === 'sync') return sync();
  if (data.action === 'prepare') return prepare();
  if (data.action === 'release-plan') return releasePlan();
  if (data.action === 'release-commit') return releaseCommit();
  if (data.action === 'native-preview') {
    const row = codecs.readConversation(data.row, { completed: false }), end = Math.max(0, row.messages.length - data.before), start = Math.max(0, end - 40);
    return { messages: row.messages.slice(start, end), before: data.before, total: row.messages.length, hasEarlier: start > 0 };
  }
  if (data.action === 'preview') {
    const t = thread(project(data.projectId), data.threadId), end = Math.max(0, t.refs.length - data.before), start = Math.max(0, end - 40);
    return { messages: t.refs.slice(start, end).map((ref, i) => ({ ...block(ref), timestamp: t.times[start + i] })), before: data.before, total: t.refs.length, hasEarlier: start > 0 };
  }
  throw Error('未知项目对话操作');
})().then((result) => parentPort.postMessage({ result }), (e) => parentPort.postMessage({ error: e.message }));
