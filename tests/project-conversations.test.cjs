const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { ProjectConversations } = require('../core/project-conversations.cjs');
const codecs = require('../core/project-codecs.cjs');
const ID = '123e4567-e89b-42d3-a456-426614174000', timestamp = '2026-09-30T02:00:00.000Z';
const messages = [{ role: 'user', text: 'Shared project discussion', timestamp }, { role: 'assistant', text: 'Existing answer', timestamp }];
const { DatabaseSync } = require('node:sqlite');
function write(file, bytes) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
function fixture(t, all = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ass-project-sync-')); t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const cwd = path.join(root, 'project'), other = path.join(root, 'other-project'); fs.mkdirSync(cwd); fs.mkdirSync(other);
  const dirs = Object.fromEntries(codecs.HARNESSES.map((h) => [h, path.join(root, h)])); for (const d of Object.values(dirs)) fs.mkdirSync(d);
  const sources = codecs.HARNESSES.map((harness) => ({ harness, dir: dirs[harness] }));
  const secret = crypto.randomBytes(32), encryption = { isEncryptionAvailable: () => true,
    encryptString: (s) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', secret, iv), bytes = Buffer.concat([c.update(s), c.final()]); return Buffer.concat([iv, c.getAuthTag(), bytes]); },
    decryptString: (b) => { const c = crypto.createDecipheriv('aes-256-gcm', secret, b.subarray(0, 12)); c.setAuthTag(b.subarray(12, 28)); return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(); } };
  const file = path.join(dirs.codex, 'sessions', `rollout-${ID}.jsonl`); write(file, codecs.encode('codex', { id: ID, cwd, title: 'Test', messages, createdAt: timestamp }).bytes);
  if (all) {
    for (const h of ['claude', 'pi', 'dsh']) {
      const encoded = codecs.encode(h, { id: ID, cwd, title: h + ' project', messages, createdAt: timestamp });
      write(path.join(dirs[h], h === 'claude' ? 'projects' : 'sessions', 'project', h === 'dsh' ? ID + '/session.v3.jsonl.zstd' : ID + '.jsonl'), encoded.bytes);
    }
    const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(path.join(dirs.opencode, 'opencode.db'));
    db.exec('CREATE TABLE session(id TEXT PRIMARY KEY,title TEXT,directory TEXT,time_created INTEGER,time_updated INTEGER,parent_id TEXT,version TEXT,project_id TEXT,slug TEXT); CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT)');
    const bundle = JSON.parse(codecs.encode('opencode', { id: 'ses_test', cwd, title: 'OpenCode project', messages, createdAt: timestamp }).bytes);
    db.prepare('INSERT INTO session VALUES(?,?,?,?,?,NULL,?,?,?)').run(bundle.info.id, bundle.info.title, cwd, Date.parse(timestamp), Date.parse(timestamp), '1.0', 'global', 'test');
    for (const m of bundle.messages) { db.prepare('INSERT INTO message VALUES(?,?,?,?,?)').run(m.info.id, bundle.info.id, m.info.time.created, m.info.time.created, JSON.stringify(m.info));
      for (const p of m.parts) db.prepare('INSERT INTO part VALUES(?,?,?,?,?,?)').run(p.id, m.info.id, bundle.info.id, m.info.time.created, m.info.time.created, JSON.stringify(p)); }
    db.close();
  }
  const dataDir = path.join(root, 'data'), options = { dataDir, crypto: encryption, sources: () => sources };
  const library = new ProjectConversations(options); return { root, cwd, other, dirs, sources, file, options, library };
}
async function enable(f) { const list = await f.library.list(), p = list.items.find((p) => p.cwd === f.cwd); assert.ok(p); await f.library.configure(p.id, { enabled: true }); return p.id; }
function appendCC(route, user, answer) {
  const rows = codecs.lines(route.nativeFile), parent = rows.filter((r) => r.uuid).at(-1).uuid, uid = crypto.randomUUID(), aid = crypto.randomUUID();
  fs.appendFileSync(route.nativeFile, codecs.jsonl([
    { type: 'user', sessionId: route.sessionId, cwd: route.cwd, uuid: uid, parentUuid: parent, timestamp, message: { role: 'user', content: user } },
    { type: 'assistant', sessionId: route.sessionId, cwd: route.cwd, uuid: aid, parentUuid: uid, timestamp, message: { id: aid, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: answer }] } },
  ]));
}
function appendPi(route, user, answer) {
  const rows = codecs.lines(route.nativeFile), parentId = rows.at(-1).id, id = crypto.randomUUID(), aid = crypto.randomUUID();
  fs.appendFileSync(route.nativeFile, codecs.jsonl([{ type: 'message', id, parentId, timestamp, message: { role: 'user', content: [{ type: 'text', text: user }] } },
    { type: 'message', id: aid, parentId: id, timestamp, message: { role: 'assistant', content: [{ type: 'text', text: answer }], stopReason: 'stop' } }]));
}

test('Codex current project assignment and title override the original session header, even without a log change', async (t) => {
  const f = fixture(t), global = path.join(f.dirs.codex, '.codex-global-state.json');
  const db = new DatabaseSync(path.join(f.dirs.codex, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,title TEXT,cwd TEXT,rollout_path TEXT,archived INTEGER,name TEXT)');
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,0,?)').run(ID, '# AGENTS.md instructions', f.other, f.file, '客户端已命名');
  write(global, JSON.stringify({ 'local-projects': { project: { id: 'project', name: '实际项目', rootPaths: [f.cwd] } }, 'thread-project-assignments': { [ID]: { projectKind: 'local', projectId: 'project' } } }));
  let list = await f.library.list(); assert.equal(list.items[0].cwd, f.cwd); assert.equal(list.items[0].name, '实际项目');
  const records = await f.library.records(list.items[0].id); assert.equal(records.items[0].title, '客户端已命名');
  const id = list.items[0].id; await f.library.configure(id, { enabled: true });
  db.prepare('UPDATE threads SET name=? WHERE id=?').run('客户端重新命名', ID);
  await f.library.sync(id); assert.equal((await f.library.threads(id)).items[0].title, '客户端重新命名');
  db.close();
  write(global, JSON.stringify({ 'projectless-thread-ids': [ID] }));
  const raw = codecs.discover(f.sources).rows.find((r) => r.sessionId === ID); assert.equal(raw.projectless, true);
});

test('unified metadata search covers project paths and native titles, scoped to the current harness without rescanning', async (t) => {
  const f = fixture(t, true), id = crypto.randomUUID();
  write(path.join(f.dirs.codex, 'sessions', `rollout-${id}.jsonl`), codecs.encode('codex', { id, cwd: f.other, title: 'Unique history needle', messages: [{ ...messages[0], text: 'Unique history needle' }, messages[1]], createdAt: timestamp }).bytes);
  const list = await f.library.list(), original = fs.readFileSync(f.file);
  const home = list.items.find((p) => p.cwd === f.cwd), other = list.items.find((p) => p.cwd === f.other);
  f.library.run = () => { throw Error('search must use cached metadata'); };
  assert.deepEqual(f.library.search({ harness: 'codex', query: '  NEEDLE  ' }).items, [{ id: other.id, projectMatch: false, matches: 1 }]);
  assert.equal(f.library.search({ harness: 'codex', query: 'other-project' }).items[0].projectMatch, true);
  assert.equal(f.library.search({ harness: 'codex', query: 'OpenCode project' }).items.length, 0);
  assert.equal(f.library.search({ harness: 'opencode', query: 'OpenCode project' }).items[0].id, home.id);
  assert.equal(f.library.search({ harness: 'codex', query: 'Existing answer' }).items.length, 0, 'message bodies are not searched or transferred');
  assert.equal(f.library.search({ harness: 'codex', query: '' }).items.length, 2);
  assert.deepEqual(fs.readFileSync(f.file), original);
  for (const input of [{ harness: 'other' }, { harness: 'codex', query: 'x'.repeat(501) }, { harness: 'codex', nativeView: 'yes' }]) assert.throws(() => f.library.search(input), /查询无效/);
});

test('shared search and cached paging do not trigger synchronization, while native view stays native', async (t) => {
  const f = fixture(t), id = await enable(f), p = f.library.project(id);
  p.threads[0].title = 'Shared needle';
  f.library.run = () => { throw Error('search must not synchronize'); };
  assert.equal(f.library.search({ harness: 'pi', query: 'needle' }).items[0].id, id);
  assert.equal(f.library.search({ harness: 'pi', query: 'needle', nativeView: true }).items.length, 0);
  assert.equal((await f.library.threads(id, { cached: true, query: 'needle' })).items[0].title, 'Shared needle');
  await assert.rejects(f.library.threads(id, { cached: 'true' }), /查询无效/);
});

test('large Codex logs are listed and synchronized without a full-file buffer or 128 MiB exclusion', async (t) => {
  const f = fixture(t), fd = fs.openSync(f.file, 'a');
  const noise = JSON.stringify({ type: 'debug_only', payload: 'x'.repeat(128 * 1024) }) + '\n';
  try { for (let i = 0; i < 1030; i++) fs.writeSync(fd, noise); } finally { fs.closeSync(fd); }
  assert.ok(fs.statSync(f.file).size > 128 * 1024 ** 2);
  const listed = codecs.discover(f.sources); assert.equal(listed.errors.length, 0); assert.equal(listed.rows.length, 1);
  const synced = codecs.discover(f.sources, { includeMessages: true, cwd: f.cwd });
  assert.equal(synced.errors.length, 0); assert.equal(synced.rows[0].messages.length, 2);
});

test('DSH v4 concatenated checked frames include all messages, native title, and final row without newline', (t) => {
  const f = fixture(t), z = require('node:zlib');
  const rows = [{ type: 'session', version: 4, id: ID, cwd: f.cwd, createdAt: Date.parse(timestamp) },
    { type: 'turn/start', seq: 0 }, { type: 'user/message', seq: 1, data: { content: 'DSH 问题' } },
    { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: 'DSH 回答' }] } } },
    { type: 'session/title', seq: 3, data: { title: 'DSH 原生名称' } }, { type: 'turn/end', seq: 4 }];
  const file = path.join(f.dirs.dsh, 'sessions', 'project', ID, 'session.v4.jsonl.zstd');
  const frames = rows.map((r, i) => z.zstdCompressSync(Buffer.from(JSON.stringify(r) + (i < rows.length - 1 ? '\n' : '')), { params: { [z.constants.ZSTD_c_checksumFlag]: 1 } }));
  write(file, Buffer.concat(frames)); const before = fs.readFileSync(file);
  const found = codecs.discover(f.sources, { includeMessages: true }).rows.find((r) => r.harness === 'dsh');
  assert.equal(found.title, 'DSH 原生名称'); assert.equal(found.pending, false); assert.deepEqual(found.messages.map((m) => m.text), ['DSH 问题', 'DSH 回答']);
  fs.appendFileSync(file, frames[1].subarray(0, 9)); assert.equal(codecs.readConversation(found).messages.length, 2);
  assert.deepEqual(fs.readFileSync(file).subarray(0, before.length), before);
});

test('CC rename in the middle of a long file overrides sampled summary and first prompt', (t) => {
  const f = fixture(t), encoded = codecs.encode('claude', { id: ID, cwd: f.cwd, title: '准确标题', messages });
  const file = path.join(f.dirs.claude, 'projects', 'project', ID + '.jsonl');
  write(file, Buffer.concat([encoded.bytes, Buffer.from(codecs.jsonl(Array.from({ length: 30 }, () => ({ type: 'progress', padding: 'x'.repeat(100000) }))))]));
  const row = codecs.discover(f.sources).rows.find((r) => r.harness === 'claude'); assert.equal(row.title, '准确标题');
});

test('deleting a native conversation requires confirmation and preserves encrypted, restart-recoverable backup', async (t) => {
  const f = fixture(t), original = fs.readFileSync(f.file), list = await f.library.list(), projectId = list.items[0].id;
  const recordId = (await f.library.records(projectId)).items[0].id;
  await assert.rejects(f.library.remove({ projectId, recordId }), /确认/); assert.ok(fs.existsSync(f.file));
  const r = await f.library.remove({ projectId, recordId, confirmed: true }); assert.ok(!fs.existsSync(f.file));
  assert.equal((await f.library.list()).items.length, 0); assert.equal(f.library.trashList().items.length, 1);
  const again = new ProjectConversations(f.options); await again.restoreTrash(r.id);
  assert.deepEqual(fs.readFileSync(f.file), original); assert.equal((await again.list()).items[0].count, 1);
  assert.equal(again.trashList().items.length, 0);
  assert.ok(!fs.readFileSync(again.file, 'utf8').includes(messages[0].text));
});

test('Codex native deletion removes just its index row and name entry; restoration keeps unrelated threads intact', async (t) => {
  const f = fixture(t), dbfile = path.join(f.dirs.codex, 'state_5.sqlite'), db = new DatabaseSync(dbfile);
  db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,title TEXT,cwd TEXT,rollout_path TEXT,archived INTEGER)');
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,0)').run(ID, 'Native title', f.cwd, f.file);
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,0)').run('other', 'Keep', f.other, 'other-file');
  const names = path.join(f.dirs.codex, 'session_index.jsonl'); write(names, codecs.jsonl([{ id: ID, thread_name: 'Old name' }, { id: 'other', thread_name: 'Keep' }]));
  const p = (await f.library.list()).items[0], row = (await f.library.records(p.id)).items[0];
  const deleted = await f.library.remove({ projectId: p.id, recordId: row.id, confirmed: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM threads').get().n, 1); assert.ok(!fs.readFileSync(names, 'utf8').includes(ID));
  await f.library.restoreTrash(deleted.id); assert.equal(db.prepare('SELECT count(*) AS n FROM threads').get().n, 2); assert.ok(fs.readFileSync(names, 'utf8').includes(ID)); db.close();
});

test('project deletion covers CC/pi/DSH, including DSH old generations; code and auth are never removed', async (t) => {
  const f = fixture(t, true); const sources = f.sources.filter((s) => s.harness !== 'opencode');
  const library = new ProjectConversations({ ...f.options, sources: () => sources });
  const old = codecs.discover(sources).rows.find((r) => r.harness === 'dsh').file;
  const v4 = old.replace('v3.', 'v4.'); const z = require('node:zlib'), body = codecs.lines(old); body[0].version = 4; write(v4, z.zstdCompressSync(Buffer.from(codecs.jsonl(body))));
  const code = path.join(f.cwd, 'keep.txt'), auth = path.join(f.dirs.codex, 'auth.json'); write(code, 'PROJECT'); write(auth, 'AUTH');
  const p = (await library.list()).items[0], result = await library.remove({ projectId: p.id, confirmed: true });
  assert.equal((await library.list()).items.length, 0); assert.ok(!fs.existsSync(v4)); assert.ok(!fs.existsSync(old));
  assert.equal(fs.readFileSync(code, 'utf8'), 'PROJECT'); assert.equal(fs.readFileSync(auth, 'utf8'), 'AUTH');
  await library.restoreTrash(result.id); assert.equal((await library.list()).items[0].count, 4); assert.ok(fs.existsSync(v4) && fs.existsSync(old));
});

test('deletion refuses a running harness and restoration never overwrites a replacement log', async (t) => {
  const f = fixture(t), library = new ProjectConversations({ ...f.options, assertDeletionIdle: async () => { throw Error('运行中'); } });
  const p = (await library.list()).items[0]; await assert.rejects(library.remove({ projectId: p.id, confirmed: true }), /运行中/); assert.ok(fs.existsSync(f.file));
  const own = (await f.library.list()).items[0], deleted = await f.library.remove({ projectId: own.id, confirmed: true });
  write(f.file, 'REPLACEMENT'); await assert.rejects(f.library.restoreTrash(deleted.id), /同名/); assert.equal(fs.readFileSync(f.file, 'utf8'), 'REPLACEMENT');
});

test('OpenCode deletion and encrypted recovery go through the native import/delete adapter, not whole DB replacement', async (t) => {
  const f = fixture(t, true), calls = [], database = path.join(f.dirs.opencode, 'opencode.db');
  const adapter = async ({ imports, returns }) => {
    const db = new DatabaseSync(database);
    try {
      for (const item of imports) {
        calls.push('delete:' + item.sessionId);
        db.prepare('DELETE FROM part WHERE session_id=?').run(item.sessionId); db.prepare('DELETE FROM message WHERE session_id=?').run(item.sessionId); db.prepare('DELETE FROM session WHERE id=?').run(item.sessionId);
      }
      for (const item of returns) {
        calls.push('import:' + item.sessionId); const b = JSON.parse(fs.readFileSync(item.file));
        db.prepare('INSERT INTO session VALUES(?,?,?,?,?,NULL,?,?,?)').run(b.info.id, b.info.title, b.info.directory, b.info.time.created, b.info.time.updated, b.info.version, b.info.projectID, b.info.slug);
        for (const m of b.messages) {
          db.prepare('INSERT INTO message VALUES(?,?,?,?,?)').run(m.info.id, b.info.id, m.info.time.created, m.info.time.created, JSON.stringify(m.info));
          for (const p of m.parts) db.prepare('INSERT INTO part VALUES(?,?,?,?,?,?)').run(p.id, m.info.id, b.info.id, m.info.time.created, m.info.time.created, JSON.stringify(p));
        }
      }
    } finally { db.close(); }
  };
  const library = new ProjectConversations({ ...f.options, sources: () => f.sources.filter((r) => r.harness === 'opencode'), releaseImports: adapter });
  const before = codecs.openCodeBundle(database, 'ses_test'), p = (await library.list()).items[0];
  const result = await library.remove({ projectId: p.id, confirmed: true });
  assert.throws(() => codecs.openCodeBundle(database, 'ses_test'), /不存在/);
  const entry = library.state.trash[0]; assert.ok(entry.imports[0].backup.endsWith('.enc')); assert.ok(!JSON.stringify(entry).includes('Existing answer'));
  await library.restoreTrash(result.id); assert.deepEqual(codecs.openCodeBundle(database, 'ses_test'), before);
  assert.deepEqual(calls, ['delete:ses_test', 'import:ses_test']);
});

test('Windows extended and UNC paths keep one project identity', () => {
  const { displayPath } = require('../core/conversation-paths.cjs');
  assert.equal(displayPath('\\\\?\\D:\\CodexProj\\ASS'), 'D:\\CodexProj\\ASS');
  assert.equal(displayPath('\\\\?\\UNC\\server\\project'), '\\\\server\\project');
  if (process.platform === 'win32') assert.equal(codecs.pathKey('\\\\?\\D:\\CodexProj\\ASS'), codecs.pathKey('D:\\CodexProj\\ASS'));
});

test('delete process guard is read-only, rejects busy or unverifiable clients', async () => {
  const { assertDeletionIdle } = require('../core/conversation-delete-guard.cjs');
  await assertDeletionIdle([{ harness: 'codex' }], async (script, input) => { assert.ok(!/Stop-Process|taskkill|[.]Kill\(/i.test(script)); assert.deepEqual(input.harnesses, ['codex']); return { running: [] }; });
  await assert.rejects(assertDeletionIdle([{ harness: 'codex' }], async () => ({ running: ['codex'] })), /先关闭 Codex/);
  await assert.rejects(assertDeletionIdle([{ harness: 'codex' }], async () => ({})), /未能确认/);
});
test('delete guard unwraps the shared adapter singleton, but keeps busy and malformed replies blocked', async () => {
  const { assertDeletionIdle } = require('../core/conversation-delete-guard.cjs');
  const rows = [{ harness: 'claude' }, { harness: 'claude' }, { harness: 'pi' }];
  await assertDeletionIdle(rows, async (_, input) => {
    assert.deepEqual(input.harnesses, ['claude', 'pi']); return [{ running: [] }];
  });
  await assert.rejects(assertDeletionIdle(rows, async () => [{ running: ['claude'] }]), /先关闭 Claude/);
  for (const value of [[], [{ running: [] }, { running: [] }], null, [{}], [{ running: null }],
    [{ running: 'claude' }], [{ running: [null] }], [{ running: ['codex'] }]])
    await assert.rejects(assertDeletionIdle(rows, async () => value), /未能确认/);
  await assert.rejects(assertDeletionIdle(rows, async () => { throw Error('inspection failed'); }), /inspection failed/);
});
test('closed-client deletion and encrypted recovery work through the actual PowerShell adapter contract', { skip: process.platform !== 'win32' }, async (t) => {
  const f = fixture(t), { assertDeletionIdle } = require('../core/conversation-delete-guard.cjs');
  const { runPowerShell } = require('../core/client-processes.cjs'); let calls = 0;
  const guard = (rows) => assertDeletionIdle(rows, async (script, input) => {
    assert.ok(script.includes('Get-CimInstance Win32_Process'));
    assert.deepEqual(input.harnesses, ['codex']); calls++;
    // Synthetic closed inventory, but the real native subprocess/JSON wrapper.
    // Never inspect, close or delete a user's client or transcript in this test.
    return runPowerShell('[pscustomobject]@{ running=@() } | ConvertTo-Json -Compress', {});
  });
  const library = new ProjectConversations({ ...f.options, assertDeletionIdle: guard });
  const original = fs.readFileSync(f.file), p = (await library.list()).items[0];
  const removed = await library.remove({ projectId: p.id, confirmed: true });
  assert.equal(fs.existsSync(f.file), false); assert.equal(calls, 2);
  assert.equal(library.trashList().items[0].id, removed.id);
  await library.restoreTrash(removed.id); assert.equal(calls, 3);
  assert.deepEqual(fs.readFileSync(f.file), original);
});
for (const h of codecs.HARNESSES) test(`${h} native projection preserves ordered shared context`, () => {
  const out = codecs.encode(h, { id: h === 'opencode' ? 'ses_test' : ID, cwd: process.cwd(), title: 'Shared', messages, createdAt: timestamp });
  const rows = h === 'dsh' ? require('node:zlib').zstdDecompressSync(out.bytes).toString() : out.bytes.toString();
  const value = h === 'opencode' ? codecs.decodeOpenCode(JSON.parse(rows)) : codecs.decode(h, rows.trim().split('\n').map(JSON.parse));
  assert.deepEqual(value.messages.map((m) => [m.role, m.text]), messages.map((m) => [m.role, m.text])); assert.equal(value.cwd, process.cwd());
  assert.ok(!/auth\.json|\.credentials\.json|apiKey/.test(rows));
});

test('CC repeated upstream message IDs remain separate across completed turns', () => {
  const rows = [
    { type: 'user', uuid: 'u1', parentUuid: null, sessionId: ID, cwd: process.cwd(), timestamp, message: { role: 'user', content: 'First question' } },
    { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp, message: { id: 'reused-upstream-id', stop_reason: 'end_turn', content: [{ type: 'text', text: 'First answer' }] } },
    { type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp, message: { role: 'user', content: 'Second question' } },
    { type: 'assistant', uuid: 'a2', parentUuid: 'u2', timestamp, message: { id: 'reused-upstream-id', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Second answer' }] } },
  ];
  const value = codecs.decode('claude', rows);
  assert.equal(value.pending, false);
  assert.deepEqual(value.messages.map((m) => m.text), ['First question', 'First answer', 'Second question', 'Second answer']);
});
test('project discovery covers all five sources but is read-only and opt-in', async (t) => {
  const f = fixture(t, true), original = fs.readFileSync(f.file), list = await f.library.list();
  assert.equal(list.items.length, 1); assert.equal(list.items[0].count, 5); assert.equal(list.items[0].enabled, false);
  assert.deepEqual(new Set(list.items[0].harnesses), new Set(codecs.HARNESSES)); assert.deepEqual(fs.readFileSync(f.file), original);
  assert.equal(f.library.state.projects.length, 0);
});
test('different projects and different original tasks are not conflated', async (t) => {
  const f = fixture(t, true); write(path.join(f.dirs.pi, 'sessions', 'other', 'other.jsonl'), codecs.encode('pi', { id: crypto.randomUUID(), cwd: f.other, title: 'Other', messages, createdAt: timestamp }).bytes);
  const id = await enable(f), threads = await f.library.threads(id); assert.equal(threads.items.length, 5); assert.equal((await f.library.list()).items.length, 2);
});
test('CC handoff is hardlinked, native originals and credentials stay untouched', async (t) => {
  const f = fixture(t), original = fs.readFileSync(f.file), auth = path.join(f.dirs.claude, '.credentials.json'); write(auth, 'KEEP CURRENT ACCOUNT');
  const id = await enable(f), thread = (await f.library.threads(id)).items[0], route = await f.library.prepare(id, thread.id, 'claude', f.dirs.claude);
  assert.equal(route.mode, 'hardlink'); assert.equal(fs.statSync(route.file).ino, fs.statSync(route.nativeFile).ino);
  assert.deepEqual(codecs.readConversation({ harness: 'claude', file: route.nativeFile }).messages.map((m) => m.text), messages.map((m) => m.text));
  assert.deepEqual(fs.readFileSync(f.file), original); assert.equal(fs.readFileSync(auth, 'utf8'), 'KEEP CURRENT ACCOUNT');
});
test('completed CC continuation returns to Codex via the same canonical conversation', async (t) => {
  const f = fixture(t), id = await enable(f), th = (await f.library.threads(id)).items[0], route = await f.library.prepare(id, th.id, 'claude', f.dirs.claude);
  appendCC(route, 'New CC question', 'New CC answer'); await f.library.sync(id);
  const all = await f.library.threads(id); assert.equal(all.items.length, 1); assert.equal(all.items[0].count, 4);
  const resumed = await f.library.prepare(id, th.id, 'codex', f.dirs.codex);
  assert.deepEqual(codecs.readConversation({ harness: 'codex', file: resumed.nativeFile }).messages.map((m) => m.text), [...messages.map((m) => m.text), 'New CC question', 'New CC answer']);
  const same = await f.library.prepare(id, th.id, 'codex', f.dirs.codex); assert.equal(same.nativeFile, resumed.nativeFile);
});
test('native atomic replacement is retained and reports the detached link as a copy', async (t) => {
  const f = fixture(t), id = await enable(f), th = (await f.library.threads(id)).items[0], route = await f.library.prepare(id, th.id, 'claude', f.dirs.claude);
  const replacement = route.nativeFile + '.replacement'; fs.writeFileSync(replacement, fs.readFileSync(route.nativeFile));
  fs.renameSync(replacement, route.nativeFile);
  const again = await f.library.prepare(id, th.id, 'claude', f.dirs.claude);
  assert.equal(again.nativeFile, route.nativeFile); assert.equal(again.mode, 'copy');
  assert.notEqual(fs.statSync(again.file).ino, fs.statSync(again.nativeFile).ino);
});
test('two simultaneous continuations create two durable branches with shared prefix blocks', async (t) => {
  const f = fixture(t), id = await enable(f), th = (await f.library.threads(id)).items[0];
  const cc = await f.library.prepare(id, th.id, 'claude', f.dirs.claude), pi = await f.library.prepare(id, th.id, 'pi', f.dirs.pi);
  appendCC(cc, 'CC branch', 'CC result'); appendPi(pi, 'pi branch', 'pi result'); await f.library.sync(id);
  const all = await f.library.threads(id); assert.equal(all.items.length, 2); assert.equal(all.branches, 1);
  const histories = await Promise.all(all.items.map((r) => f.library.preview(id, r.id))); assert.ok(histories.some((r) => r.messages.some((m) => m.text === 'CC result'))); assert.ok(histories.some((r) => r.messages.some((m) => m.text === 'pi result')));
  assert.equal(fs.readdirSync(path.join(f.library.vault, 'blocks')).length, 6);
  assert.deepEqual(codecs.readConversation({ harness: 'claude', file: cc.nativeFile }).messages.at(-1).text, 'CC result');
});
test('incomplete turns and torn lines never replace completed shared history', async (t) => {
  const f = fixture(t), id = await enable(f), th = (await f.library.threads(id)).items[0];
  fs.appendFileSync(f.file, codecs.jsonl([{ type: 'event_msg', payload: { type: 'task_started' } }, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Pending question' }] } }]) + '{"type":');
  await f.library.sync(id); assert.equal((await f.library.preview(id, th.id)).total, 2);
  assert.ok(fs.readFileSync(f.file, 'utf8').endsWith('{"type":'));
});
test('project history survives restart and shared text is encrypted on disk', async (t) => {
  const f = fixture(t), id = await enable(f), th = (await f.library.threads(id)).items[0], again = new ProjectConversations(f.options);
  assert.equal((await again.threads(id)).items.length, 1); assert.equal((await again.preview(id, th.id)).messages[0].text, messages[0].text);
  assert.ok(!fs.readFileSync(again.file, 'utf8').includes(messages[0].text));
  for (const name of fs.readdirSync(path.join(again.vault, 'blocks'))) assert.ok(!fs.readFileSync(path.join(again.vault, 'blocks', name)).includes(Buffer.from(messages[0].text)));
});
test('closing sync removes indexed projections but retains original and recoverable backups', async (t) => {
  const f = fixture(t), id = await enable(f), th = (await f.library.threads(id)).items[0], route = await f.library.prepare(id, th.id, 'claude', f.dirs.claude);
  await f.library.configure(id, { enabled: false }); await f.library.sync();
  assert.equal(f.library.project(id).threads.length, 0); assert.ok(!fs.existsSync(route.nativeFile)); assert.ok(fs.existsSync(f.file));
  assert.ok(fs.existsSync(path.join(f.library.vault, 'released', 'claude', route.sessionId + '.jsonl')));
  await assert.rejects(f.library.prepare(id, th.id, 'pi', f.dirs.pi), /启用/);
});
test('native records are grouped and previewable before opting in, without capturing content', async (t) => {
  const f = fixture(t, true), projects = await f.library.list(), p = projects.items.find((p) => p.cwd === f.cwd);
  const r = await f.library.records(p.id); assert.equal(r.total, 5); assert.ok(!p.enabled); assert.equal(f.library.state.projects.length, 0);
  assert.equal((await f.library.nativePreview(r.items.find((r) => r.harness === 'pi').id)).total, 2);
  assert.ok(!fs.existsSync(path.join(f.library.vault, 'blocks')));
});
test('projectless Codex/CC records have no sync switch or writable shared graph', async (t) => {
  const f = fixture(t), file = path.join(f.dirs.claude, 'projects', 'loose.jsonl');
  write(file, codecs.encode('claude', { id: ID, cwd: os.homedir(), title: 'No project', messages }).bytes);
  const p = (await f.library.list()).items.find((p) => p.nonProject); assert.equal(p.id, codecs.NO_PROJECT);
  assert.equal((await f.library.records(p.id)).total, 1); await assert.rejects(f.library.configure(p.id, { enabled: true }), /不支持同步/);
});
test('all completed branches return to the initial harness before closing, other native histories are untouched', async (t) => {
  const f = fixture(t, true), id = await enable(f), th = (await f.library.threads(id)).items.find((r) => r.harnesses.includes('codex'));
  const original = fs.readFileSync(f.file), unrelated = codecs.discover(f.sources).rows.find((r) => r.harness === 'claude'), bytes = fs.readFileSync(unrelated.file);
  const cc = await f.library.prepare(id, th.id, 'claude', f.dirs.claude), pi = await f.library.prepare(id, th.id, 'pi', f.dirs.pi);
  appendCC(cc, 'CC question', 'CC branch'); appendPi(pi, 'pi question', 'pi branch'); await f.library.sync(id);
  await f.library.configure(id, { enabled: false });
  const native = codecs.discover(f.sources, { includeMessages: true }).rows;
  assert.ok(native.some((r) => r.harness === 'codex' && r.messages.some((m) => m.text === 'CC branch')));
  assert.ok(native.some((r) => r.harness === 'codex' && r.messages.some((m) => m.text === 'pi branch')));
  assert.deepEqual(fs.readFileSync(f.file), original); assert.deepEqual(fs.readFileSync(unrelated.file), bytes);
  assert.ok(!fs.existsSync(cc.nativeFile)); assert.ok(!fs.existsSync(pi.nativeFile));
  await f.library.list(); assert.ok(!(await f.library.records(id)).items.some((r) => r.syncedFrom));
});
test('closing refuses an incomplete target turn; no original or projection is removed', async (t) => {
  const f = fixture(t), id = await enable(f), th = (await f.library.threads(id)).items[0], pi = await f.library.prepare(id, th.id, 'pi', f.dirs.pi);
  fs.appendFileSync(pi.nativeFile, codecs.jsonl([{ type: 'message', id: 'unfinished', parentId: codecs.lines(pi.nativeFile).at(-1).id, message: { role: 'user', content: 'Still working' } }]));
  await assert.rejects(f.library.configure(id, { enabled: false }), /仍在进行|变化/);
  assert.ok(f.library.project(id).enabled); assert.ok(fs.existsSync(pi.nativeFile)); assert.ok(fs.existsSync(f.file));
});
test('projection labels identify the original harness without altering shared message hashes', async (t) => {
  const f = fixture(t), id = await enable(f), th = (await f.library.threads(id)).items[0], pi = await f.library.prepare(id, th.id, 'pi', f.dirs.pi);
  assert.match(fs.readFileSync(pi.nativeFile, 'utf8'), /来自 Codex 的同步/);
  assert.deepEqual(codecs.readConversation({ harness: 'pi', file: pi.nativeFile }).messages.map((m) => m.text), messages.map((m) => m.text));
  const p = (await f.library.list()).items.find((p) => p.id === id); assert.ok(p.enabled);
  assert.equal((await f.library.records(id, { harness: 'pi' })).items[0].syncedFrom, 'codex');
});
test('pi v1/v2 linear migration, system filtering and incomplete tools are read-only', () => {
  const rows = [{ type: 'session', version: 1, id: ID, cwd: process.cwd() },
    { type: 'message', message: { role: 'system', content: 'Old permission prompt' } },
    { type: 'message', message: { role: 'user', content: 'Old question' } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Old answer' }], stopReason: 'stop', model: 'old-model' } },
    { type: 'message', message: { role: 'hookMessage', content: 'Extension authority' } }];
  const original = JSON.stringify(rows), parsed = codecs.decode('pi', rows); assert.deepEqual(parsed.messages.map((m) => m.text), ['Old question', 'Old answer']);
  assert.equal(parsed.model, 'old-model'); assert.equal(JSON.stringify(rows), original);
  rows.push({ type: 'message', message: { role: 'user', content: 'pending' } }, { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: {} }], stopReason: 'toolUse' } });
  assert.equal(codecs.decode('pi', rows).pending, true); assert.equal(codecs.decode('pi', rows).messages.length, 2);
});
test('DSH current replacement surface and nested tool results preserve the final conversation', () => {
  const header = { type: 'session', version: 3, id: ID, cwd: process.cwd(), createdAt: Date.parse(timestamp) };
  const rows = [header, { type: 'turn/start', seq: 0 }, { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'Question' }] } },
    { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: 'Old output' }] } } },
    { type: 'assistant/message', seq: 3, surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 }, data: { message: { content: [{ type: 'text', text: 'Final output' }] } } },
    { type: 'tool/result', seq: 4, data: { message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'Nested output' }] }] } } }, { type: 'turn/end', seq: 5 }];
  const parsed = codecs.decode('dsh', rows); assert.ok(!parsed.messages.some((m) => m.text.includes('Old output'))); assert.ok(parsed.messages.some((m) => m.text.includes('Nested output')));
  assert.throws(() => codecs.decode('dsh', [{ ...header, version: 5 }]), /尚未支持/);
});
test('pi custom session root is discovered and current model defaults override historical metadata on resume', (t) => {
  const f = fixture(t), custom = path.join(f.root, 'custom-sessions');
  write(path.join(custom, 'pi.jsonl'), codecs.encode('pi', { id: ID, cwd: f.cwd, messages }).bytes);
  assert.equal(codecs.discover([{ harness: 'pi', dir: f.dirs.pi, sessionDirs: [custom] }]).rows.length, 1);
  const { HarnessManager } = require('../core/harnesses.cjs'), manager = new HarnessManager(f.root, () => ({ providers: [] }), [], f.dirs.codex, { home: f.root, env: { PI_CODING_AGENT_DIR: f.dirs.pi, PI_CODING_AGENT_SESSION_DIR: custom } });
  write(path.join(f.dirs.pi, 'settings.json'), JSON.stringify({ defaultProvider: 'anthropic', defaultModel: 'current-model' }));
  const plan = manager.projectConversationPlan('pi', f.cwd, ID, path.join(custom, 'pi.jsonl'));
  assert.deepEqual(plan.args.slice(0, 6), ['--session', path.join(custom, 'pi.jsonl'), '--provider', 'anthropic', '--model', 'current-model']);
  assert.ok(manager.conversationSources().find((r) => r.harness === 'pi').sessionDirs.includes(custom));
});
test('tampered shared blocks block resume and do not create a native file', async (t) => {
  const f = fixture(t), id = await enable(f), th = (await f.library.threads(id)).items[0], ref = f.library.project(id).threads[0].refs[0];
  fs.writeFileSync(path.join(f.library.vault, 'blocks', ref + '.enc'), 'corrupted');
  await assert.rejects(f.library.prepare(id, th.id, 'claude', f.dirs.claude)); assert.ok(!fs.existsSync(path.join(f.dirs.claude, 'projects')));
});
test('unknown future formats refuse conversion without changing native history', (t) => {
  const f = fixture(t), file = path.join(f.dirs.pi, 'sessions', 'future.jsonl'); write(file, codecs.jsonl([{ type: 'session', version: 999, id: ID, cwd: f.cwd }]));
  const before = fs.readFileSync(file), r = codecs.discover(f.sources); assert.ok(r.errors.some((e) => e.harness === 'pi')); assert.deepEqual(fs.readFileSync(file), before);
});
test('historical tool operations are inert text, not replayable target tool calls', () => {
  const source = [{ type: 'user', sessionId: ID, cwd: process.cwd(), message: { role: 'user', content: 'Question' } },
    { type: 'assistant', sessionId: ID, cwd: process.cwd(), message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'delete', input: { path: 'never-executed' } }] } },
    { type: 'user', sessionId: ID, cwd: process.cwd(), message: { role: 'user', content: [{ type: 'tool_result', content: 'Synthetic result' }] } },
    { type: 'assistant', sessionId: ID, cwd: process.cwd(), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done' }] } }];
  const decoded = codecs.decode('claude', source), result = codecs.encode('codex', { id: ID, cwd: process.cwd(), messages: decoded.messages });
  assert.match(result.bytes.toString(), /历史工具调用/); assert.match(result.bytes.toString(), /历史工具结果/); assert.ok(!result.bytes.toString().includes('function_call'));
});
test('CC pending tool execution is withheld even when it includes interim text', () => {
  const rows = [{ type: 'user', sessionId: ID, cwd: process.cwd(), message: { role: 'user', content: 'Pending question' } },
    { type: 'assistant', sessionId: ID, message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'text', text: 'Working' }, { type: 'tool_use', name: 'read', input: {} }] } }];
  const decoded = codecs.decode('claude', rows); assert.equal(decoded.pending, true); assert.equal(decoded.messages.length, 0);
});
test('CC attachment/progress parent records do not sever cross-harness history', () => {
  const rows = [{ type: 'user', uuid: 'user', parentUuid: null, sessionId: ID, cwd: process.cwd(), message: { role: 'user', content: 'Original question' } },
    { type: 'attachment', uuid: 'context', parentUuid: 'user' }, { type: 'progress', uuid: 'progress', parentUuid: 'context' },
    { type: 'assistant', uuid: 'answer', parentUuid: 'progress', sessionId: ID, message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Answer after context' }] } }];
  assert.deepEqual(codecs.decode('claude', rows).messages.map((m) => m.text), ['Original question', 'Answer after context']);
});
test('DSH native project directory collapses separators and escapes Unicode', () => {
  assert.equal(codecs.dshSlug('D:\\CodexProj\\ASS'), '--D-CodexProj-ASS--');
  assert.equal(codecs.dshSlug('D:\\中文'), '--D-~4E2D~6587--');
});
test('OpenCode message IDs remain chronological even when timestamps are equal', () => {
  const result = JSON.parse(codecs.encode('opencode', { id: 'ses_test', cwd: process.cwd(), title: 'Order', messages: [...messages, ...messages], createdAt: timestamp }).bytes);
  const ids = result.messages.map((m) => m.info.id); assert.deepEqual([...ids].sort(), ids);
});
test('OpenCode projections are official import bundles, never direct DB writes', async (t) => {
  const f = fixture(t, true), dbFile = path.join(f.dirs.opencode, 'opencode.db'), before = fs.readFileSync(dbFile), id = await enable(f);
  const th = (await f.library.threads(id)).items.find((r) => r.harnesses.includes('codex')), route = await f.library.prepare(id, th.id, 'opencode', f.dirs.opencode);
  assert.equal(route.mode, 'import'); const bundle = JSON.parse(fs.readFileSync(route.file)); assert.ok(bundle.info.id.startsWith('ses_')); assert.equal(bundle.messages.length, 2); assert.deepEqual(fs.readFileSync(dbFile), before);
});
test('same message body retains its individual timestamps while content is deduplicated', async (t) => {
  const f = fixture(t); const repeated = [...messages, { ...messages[0], timestamp: '2026-09-30T03:00:00.000Z' }, { ...messages[1], timestamp: '2026-09-30T03:00:00.000Z' }];
  write(f.file, codecs.encode('codex', { id: ID, cwd: f.cwd, messages: repeated }).bytes);
  const id = await enable(f), th = (await f.library.threads(id)).items[0], preview = await f.library.preview(id, th.id);
  assert.equal(preview.messages[2].timestamp, repeated[2].timestamp); assert.equal(fs.readdirSync(path.join(f.library.vault, 'blocks')).length, 2);
});
test('OpenCode project resume uses its existing native auth/DB root, not an isolated nested home', (t) => {
  const f = fixture(t), { HarnessManager } = require('../core/harnesses.cjs');
  const manager = new HarnessManager(f.root, () => ({ providers: [] }), [], f.dirs.codex, { home: f.root, env: { XDG_DATA_HOME: path.dirname(f.dirs.opencode), XDG_CONFIG_HOME: path.join(f.root, 'config') } });
  manager.state.credentialHomes.opencode = f.dirs.opencode;
  const plan = manager.projectConversationPlan('opencode', f.cwd);
  assert.equal(plan.env.XDG_DATA_HOME, path.dirname(f.dirs.opencode)); assert.equal(plan.env.XDG_CONFIG_HOME, path.join(f.root, 'config')); assert.deepEqual(plan.files, []);
});
