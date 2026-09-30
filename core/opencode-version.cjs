// Versioned OpenCode contract. Discovery is read-only; credential activation
// is delegated to the public CLI. ASS never writes OpenCode's SQLite tables.
const fs = require('node:fs'), path = require('node:path');
const { safePath } = require('./native-fields.cjs');
function database(file, fn) {
  safePath(file);
  const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(file, { readOnly: true, timeout: 500 });
  try { db.exec('BEGIN'); return fn(db); } finally { db.close(); }
}
function hasTable(db, name) { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name); }
function version(launcher, dir) {
  if (/^2\./.test(launcher?.version || '')) return 2;
  const entry = launcher?.entryPoint || launcher?.executable;
  if (entry) for (const relative of ['.', '..', '../..']) {
    try { const p = JSON.parse(fs.readFileSync(path.resolve(path.dirname(entry), relative, 'package.json'), 'utf8'));
      if (p.name === '@opencode/cli' && /^2\./.test(p.version)) return 2;
      if (p.name === 'opencode-ai' && /^1\./.test(p.version)) return 1;
    } catch {}
  }
  const file = dir && path.join(dir, 'opencode.db');
  if (file && fs.existsSync(file)) return database(file, db => hasTable(db, 'session_v2') || hasTable(db, 'credential') ? 2 : 1);
  return 1;
}
function credentials(dir) {
  const file = path.join(dir, 'opencode.db');
  if (!fs.existsSync(file)) return null;
  return database(file, db => {
    if (!hasTable(db, 'credential')) return null;
    const columns = new Set(db.prepare('PRAGMA table_info(credential)').all().map(r => r.name));
    if (!['id', 'integration_id', 'label', 'value', 'active'].every(k => columns.has(k)))
      throw Error('OpenCode credential 数据库版本未支持，未读取旧 auth.json 作为替代');
    const rows = db.prepare('SELECT id,integration_id,label,value,active FROM credential LIMIT 10001').all();
    if (rows.length > 10000) throw Error('OpenCode 账户数量超过读取范围');
    return rows.map(r => ({ id: r.id, integrationID: r.integration_id, label: r.label,
      active: !!r.active, value: JSON.parse(r.value) }));
  });
}
function selected(account) {
  const rows = credentials(account.nativeDir || path.dirname(account.sourcePath));
  const row = rows?.find(r => r.id === account.credentialId && r.integrationID === account.provider);
  if (!row) throw Error('OpenCode 原生账户已变化，请刷新后选择');
  return row;
}
function command(major, action, argument) {
  if (!['import', 'export', 'delete'].includes(action)) throw Error('无效的 OpenCode 会话操作');
  return major === 2 ? ['session', action, argument, '--standalone']
    : action === 'import' ? ['import', argument] : ['session', action, argument];
}
function encode({ id, cwd, title, messages, createdAt, model = 'gpt-5' }) {
  const time = Date.parse(createdAt), zero = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
  const ref = { id: model, providerID: 'openai' };
  const rows = messages.map((m, i) => {
    const when = Date.parse(m.timestamp || createdAt), base = { id: 'msg_' + id.slice(4) + '_' + i.toString(16).padStart(8, '0'), time: { created: when } };
    return m.role === 'user' ? { ...base, type: 'user', text: m.text, files: [], agents: [], skills: [] }
      : { ...base, type: 'assistant', agent: 'build', model: ref, content: [{ type: 'text', text: m.text }],
        finish: 'stop', cost: 0, tokens: zero, time: { created: when, streamed: when, completed: when } };
  });
  if (rows.length) rows.push({ type: 'idle', id: 'msg_' + id.slice(4) + '_idle', time: { created: rows.at(-1).time.created }, outcome: 'succeeded' });
  return { info: { id, projectID: 'global', title, location: { directory: cwd }, cost: 0, tokens: zero,
    time: { created: time, updated: time }, agent: 'build', model: ref }, messages: rows };
}
function bundle(db, id) {
  const r = db.prepare('SELECT * FROM session_v2 WHERE id=?').get(id); if (!r) throw Error('OpenCode 会话不存在');
  const messages = db.prepare('SELECT * FROM session_message WHERE session_id=? ORDER BY seq').all(id)
    .map(m => ({ ...JSON.parse(m.data), id: m.id, type: m.type }));
  return { info: { id, projectID: r.project_id, title: r.title, location: { directory: r.directory },
    cost: r.cost, tokens: { input: r.tokens_input, output: r.tokens_output, reasoning: r.tokens_reasoning,
      cache: { read: r.tokens_cache_read, write: r.tokens_cache_write } },
    ...(r.metadata ? { metadata: JSON.parse(r.metadata) } : {}),
    ...(r.permission ? { permissions: JSON.parse(r.permission) } : {}),
    ...(r.revert ? { revert: JSON.parse(r.revert) } : {}),
    ...(r.fork_session_id && r.fork_boundary ? { fork: { sessionID: r.fork_session_id, boundary: JSON.parse(r.fork_boundary) } } : {}),
    ...(r.parent_id ? { parentID: r.parent_id } : {}), ...(r.agent ? { agent: r.agent } : {}),
    ...(r.model ? { model: JSON.parse(r.model) } : {}), time: { created: r.time_created, updated: r.time_updated } }, messages };
}
module.exports = { version, credentials, selected, command, encode, bundle, database, hasTable };
