const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib');
const codecs = require('../core/project-codecs.cjs'), dsh = require('../core/dsh-config.cjs');
const kimi = require('../core/kimi-model-config.cjs'), oc = require('../core/opencode-version.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ass-contract-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}
test('DSH exports an isolated single-line header and complete event frame', () => {
  const messages = [{ role: 'user', text: '中文问题 😀' }, { role: 'assistant', text: '长文本'.repeat(10000) }];
  const out = codecs.encode('dsh', { id: 'session-test', cwd: process.cwd(), title: '中文', messages });
  const frames = [...require('../core/conversation-reader.cjs').frames(out.bytes)];
  assert.equal(frames.length, 2);
  const header = zlib.zstdDecompressSync(frames[0]).toString();
  assert.equal(header.trim().split('\n').length, 1); assert.equal(JSON.parse(header).type, 'session');
  const rows = Buffer.concat(frames.map(f => zlib.zstdDecompressSync(f))).toString().trim().split('\n').map(JSON.parse);
  assert.deepEqual(codecs.decode('dsh', rows).messages.map(m => m.text), messages.map(m => m.text));
  assert.throws(() => [...require('../core/conversation-reader.cjs').frames(out.bytes.subarray(0, -1))], /截断/);
  const corrupt = Buffer.from(out.bytes); corrupt[0] ^= 1;
  assert.throws(() => [...require('../core/conversation-reader.cjs').frames(corrupt)], /损坏/);
  const empty = codecs.encode('dsh', { id: 'empty', cwd: process.cwd(), messages: [] });
  assert.equal([...require('../core/conversation-reader.cjs').frames(empty.bytes)].length, 1);
});
test('DSH rejects unsupported reasoning before native writes, preserving supported levels', () => {
  assert.throws(() => dsh.reasoning({ efforts: ['ultra'], defaultEffort: 'ultra' }), /没有可用/);
  assert.throws(() => dsh.reasoning({ efforts: ['low', 'ultra'], defaultEffort: 'ultra' }), /默认/);
  assert.throws(() => dsh.reasoning({ efforts: [], defaultEffort: 'low' }), /没有可用/);
  assert.deepEqual(dsh.reasoning({ efforts: ['low', 'max', 'ultra'], defaultEffort: 'max' }), { low: 'low', max: 'max' });
});
test('DSH profile target is shared across base and independent homes, unsafe names rejected', t => {
  const dir = fixture(t); fs.mkdirSync(path.join(dir, 'desktop-link'));
  fs.writeFileSync(path.join(dir, 'desktop-link/web.json'), JSON.stringify({ coreVersion: '0.2.0-rc.2', profile: 'qa-web' }));
  const base = dsh.target(dir), target = dsh.profileTarget(path.join(dir, 'other'), base);
  assert.deepEqual(dsh.launchArgs(target), ['--profile', 'qa-web']);
  assert.ok(target.config.endsWith(path.join('profiles', 'qa-web', 'cordis.patch.yml')));
  assert.throws(() => dsh.profileTarget(dir, { format: 'dsh-patch', profile: '../escape' }), /无效/);
});
test('Kimi recognizes current, inherited and flat model routes without trusting conflicting aliases', () => {
  const p = { type: 'openai', base_url: 'http://127.0.0.1:1/v1', api_key: 'synthetic' };
  for (const raw of [{ provider_id: 'local', name: 'wire' }, { model: 'wire' }]) {
    const result = kimi.normalize({ default_provider: 'local', providers: { local: p }, models: { qa: raw } });
    assert.equal(result.models[0].provider, 'local'); assert.equal(result.models[0].model, 'wire');
  }
  const flat = kimi.normalize({ models: { qa: { name: 'wire', protocol: 'openai', base_url: p.base_url, api_key: p.api_key } } });
  assert.equal(flat.models[0].provider, '127.0.0.1:1'); assert.equal(flat.providers['127.0.0.1:1'].api_key, 'synthetic');
  for (const raw of [{ provider_id: 'local', provider: 'other', name: 'wire' }, { provider: 'local', name: 'one', model: 'two' }]) {
    const result = kimi.normalize({ providers: { local: p }, models: { qa: raw } });
    assert.equal(result.models.length, 0); assert.match(result.issues[0], /冲突/);
  }
});
test('Kimi effective env override requires nonempty model name and blocks partial config, with names only', () => {
  assert.equal(kimi.environmentIssue({ KIMI_MODEL_API_KEY: 'secret-alone' }), '');
  assert.equal(kimi.environmentIssue({ KIMI_MODEL_NAME: '  ', KIMI_MODEL_API_KEY: 'secret' }), '');
  assert.match(kimi.environmentIssue({ KIMI_MODEL_NAME: 'wire' }), /缺少 KIMI_MODEL_API_KEY/);
  const message = kimi.environmentIssue({ KIMI_MODEL_NAME: 'secret-model', KIMI_MODEL_API_KEY: 'secret-key', KIMI_MODEL_BASE_URL: 'secret-endpoint' });
  assert.match(message, /KIMI_MODEL_NAME/); assert.ok(!message.includes('secret-'));
});
test('OpenCode v2 credential service distinguishes active accounts and never falls back to stale auth', t => {
  const dir = fixture(t), file = path.join(dir, 'opencode.db'), { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE credential(id TEXT PRIMARY KEY,integration_id TEXT,label TEXT,value TEXT,active INTEGER)');
  for (const [id, active, key] of [['cred_a', 1, 'key-a'], ['cred_b', 0, 'key-b']])
    db.prepare('INSERT INTO credential VALUES(?,?,?,?,?)').run(id, 'openai', id, JSON.stringify({ type: 'key', key }), active);
  db.close(); fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({ openai: { type: 'api', key: 'stale' } }));
  const r = require('../core/credential-status.cjs').inspectCredentials('opencode', dir, { native: true });
  assert.equal(r.rows.length, 2); assert.deepEqual(r.rows.map(x => x.active), [true, false]);
  assert.ok(!JSON.stringify(r).includes('key-a')); assert.ok(!JSON.stringify(r).includes('stale'));
  assert.equal(oc.version(null, dir), 2); assert.equal(oc.selected({ nativeDir: dir, sourcePath: file, credentialId: 'cred_b', provider: 'openai' }).value.key, 'key-b');
});
test('OpenCode v2 transfer preserves final ordered turns and uses versioned CLI commands', () => {
  const messages = [{ role: 'user', text: 'question' }, { role: 'assistant', text: 'answer' }];
  const out = codecs.encode('opencode', { id: 'ses_test', cwd: process.cwd(), messages, nativeVersion: 2 });
  const bundle = JSON.parse(out.bytes), decoded = codecs.decodeOpenCode(bundle);
  assert.equal(bundle.messages.at(-1).type, 'idle'); assert.equal(decoded.pending, false);
  assert.deepEqual(decoded.messages.map(m => m.text), ['question', 'answer']);
  assert.deepEqual(oc.command(2, 'import', 'test.json'), ['session', 'import', 'test.json', '--standalone']);
  assert.deepEqual(oc.command(1, 'import', 'test.json'), ['import', 'test.json']);
});
