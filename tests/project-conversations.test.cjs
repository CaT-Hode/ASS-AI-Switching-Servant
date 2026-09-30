const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { ProjectConversations } = require('../core/project-conversations.cjs');
const codecs = require('../core/project-codecs.cjs');
const ID = '123e4567-e89b-42d3-a456-426614174000', timestamp = '2026-09-30T02:00:00.000Z';
const messages = [{ role: 'user', text: 'Shared project discussion', timestamp }, { role: 'assistant', text: 'Existing answer', timestamp }];
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
  assert.throws(() => codecs.decode('dsh', [{ ...header, version: 4 }]), /尚未支持/);
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
