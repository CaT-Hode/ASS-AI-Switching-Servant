const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { HarnessManager } = require('../core/harnesses.cjs');
const { OAuthHistory } = require('../core/oauth-history.cjs');
const { normalizeOAuth, oauthTransferCompatibility } = require('../core/oauth-import.cjs');
const CLIENT = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const jwt = claims => 'synthetic.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
const grant = extra => ({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: 2100000000000,
  accountId: 'synthetic-account', ...extra });
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ass-oauth-qa-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), data = path.join(root, 'ass'), env = { CLAUDE_CONFIG_DIR: path.join(home, 'custom-claude') };
  const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  const create = () => { const m = new HarnessManager(data, () => ({ providers: [] }), [], path.join(home, '.codex'), { home, env, launchEnv: { PATH: '' } });
    m.piProviders = [{ id: 'anthropic' }, { id: 'openai-codex' }]; return m; };
  put(path.join(env.CLAUDE_CONFIG_DIR, '.credentials.json'), { claudeAiOauth: grant({ clientId: CLIENT, scopes: ['user:inference'] }) });
  return { root, home, data, env, put, create, manager: create() };
}
test('OAuth import write, rename and state commit failures leave previous disk and memory state intact', t => {
  for (const fault of ['write', 'rename', 'save-write', 'save-rename']) {
    const f = setup(t), m = f.manager, id = m.importOAuth('local-claude', 'original');
    const before = fs.readFileSync(m.file, 'utf8'), memory = JSON.stringify(m.state), original = fs.readFileSync(path.join(m.root('pi', id), 'auth.json'), 'utf8');
    const source = fs.readFileSync(path.join(f.env.CLAUDE_CONFIG_DIR, '.credentials.json'), 'utf8');
    const method = fault.endsWith('rename') ? 'renameSync' : 'writeFileSync', real = fs[method]; let count = 0;
    fs[method] = (...args) => {
      const destination = String(args[method === 'renameSync' ? 1 : 0]);
      if (fault.startsWith('save') ? destination.startsWith(m.file) : destination.includes(path.join('clients', 'pi')) && /auth\.json(?:\.\d+\.tmp)?$/.test(destination)) {
        count++; throw Object.assign(Error('synthetic disk full'), { code: 'ENOSPC' });
      }
      return real(...args);
    };
    try { assert.throws(() => m.importOAuth('local-claude', 'failed'), { code: 'ENOSPC' }); } finally { fs[method] = real; }
    assert.equal(count, 1); assert.equal(JSON.stringify(m.state), memory); assert.equal(fs.readFileSync(m.file, 'utf8'), before);
    const reloaded = f.create(); assert.equal(reloaded.state.selected.pi, id); assert.equal(reloaded.state.profiles.length, 1);
    assert.equal(fs.readFileSync(path.join(m.root('pi', id), 'auth.json'), 'utf8'), original);
    assert.equal(fs.readFileSync(path.join(f.env.CLAUDE_CONFIG_DIR, '.credentials.json'), 'utf8'), source);
    assert.deepEqual(fs.readdirSync(path.join(f.data, 'clients', 'pi')), [id]);
  }
});
test('OAuth import crashes recover unpublished credentials and retain published complete profiles', t => {
  for (const phase of ['credential', 'commit', 'native-added']) {
    const f = setup(t), first = f.manager.importOAuth('local-claude', 'original');
    const script = `const fs=require('node:fs'),path=require('node:path');
      const {HarnessManager}=require(${JSON.stringify(path.resolve(__dirname, '../core/harnesses.cjs'))});
      const m=new HarnessManager(${JSON.stringify(f.data)},()=>({providers:[]}),[],${JSON.stringify(path.join(f.home, '.codex'))},
        {home:${JSON.stringify(f.home)},env:${JSON.stringify(f.env)},launchEnv:{PATH:''}}); m.piProviders=[{id:'anthropic'}];
      const rename=fs.renameSync; fs.renameSync=(a,b)=>{ rename(a,b);
        if (${JSON.stringify(phase)}==='commit' ? b===m.file : b.endsWith(path.sep+'auth.json')) {
          if (${JSON.stringify(phase)}==='native-added') { fs.writeFileSync(path.join(path.dirname(b),'native-session.json'),'keep'); fs.writeFileSync(b,'{"rotated":"keep"}'); }
          process.exit(73);
        }
      }; m.importOAuth('local-claude','interrupted');`;
    const child = spawnSync(process.execPath, ['-e', script], { env: { SystemRoot: process.env.SystemRoot }, encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 73, child.stderr);
    const reloaded = f.create(), dirs = fs.readdirSync(path.join(f.data, 'clients/pi'));
    if (phase === 'commit') {
      assert.equal(reloaded.state.profiles.length, 2); assert.notEqual(reloaded.state.selected.pi, first);
      const p = reloaded.state.profiles.find(p => p.id !== first); assert.ok(p.importedAt && p.importedFrom);
      assert.equal(JSON.parse(fs.readFileSync(path.join(reloaded.root('pi', p.id), 'auth.json'))).anthropic.refresh, 'synthetic-refresh');
    } else {
      assert.equal(reloaded.state.profiles.length, 1); assert.equal(reloaded.state.selected.pi, first);
      if (phase === 'credential') assert.deepEqual(dirs, [first]);
      else { const orphan = dirs.find(d => d !== first); assert.equal(fs.readFileSync(path.join(f.data, 'clients/pi', orphan, 'auth.json'), 'utf8'), '{"rotated":"keep"}');
        assert.equal(fs.readFileSync(path.join(f.data, 'clients/pi', orphan, 'native-session.json'), 'utf8'), 'keep'); }
    }
  }
});
test('OAuth import treats an already published state as committed even if save throws afterwards', t => {
  const f = setup(t), m = f.manager, save = m.save.bind(m); m.save = () => { save(); throw Error('post commit exception'); };
  const id = m.importOAuth('local-claude', 'complete'); assert.equal(f.create().state.selected.pi, id);
  assert.ok(fs.existsSync(path.join(m.root('pi', id), 'auth.json')));
  const another = setup(t), previous = JSON.stringify(another.manager.state), read = fs.readFileSync;
  another.manager.save = () => {
    fs.readFileSync = (file, ...args) => { if (file === another.manager.file) throw Object.assign(Error('unreadable'), { code: 'EACCES' }); return read(file, ...args); };
    throw Error('save failed');
  };
  try { assert.throws(() => another.manager.importOAuth('local-claude', 'unknown commit'), /save failed/); }
  finally { fs.readFileSync = read; }
  assert.equal(JSON.stringify(another.manager.state), previous); assert.equal(another.create().state.profiles.length, 0);
  assert.deepEqual(fs.readdirSync(path.join(another.data, 'clients/pi')), []);
});
test('OAuth import rejects concurrent clients.json edits without undoing another writer', t => {
  const f = setup(t), m = f.manager; m.importOAuth('local-claude', 'original'); const previous = JSON.stringify(m.state);
  const rename = fs.renameSync; let changed;
  fs.renameSync = (a, b) => { rename(a, b); if (b.endsWith(path.sep + 'auth.json')) {
    changed = { ...JSON.parse(fs.readFileSync(m.file)), workspace: 'concurrent-workspace' }; fs.writeFileSync(m.file, JSON.stringify(changed));
  } };
  try { assert.throws(() => m.importOAuth('local-claude', 'conflict'), /变化/); } finally { fs.renameSync = rename; }
  assert.equal(JSON.stringify(m.state), previous); assert.equal(f.create().state.workspace, changed.workspace);
  assert.equal(f.create().state.profiles.length, 1);
});
test('Pi legacy imports require the access JWT account claim even with explicit stored or identity IDs', () => {
  for (const access of ['opaque', jwt({ exp: 2100000000, client_id: 'app_EMoamEEZ73f0CkXaXp7hrann' })]) {
    const t = { access_token: access, refresh_token: 'synthetic-refresh', account_id: 'stored', id_token: jwt({ chatgpt_account_id: 'stored' }) };
    const status = oauthTransferCompatibility('codex', { tokens: t }); assert.equal(status.reasonCode, 'oauth_access_account_missing');
    assert.equal(status.compatible, false); assert.equal(status.requiresLogin, true); assert.ok(!JSON.stringify(status).includes('synthetic-refresh'));
  }
  const access = jwt({ exp: 2100000000, 'https://api.openai.com/auth': { chatgpt_account_id: 'actual' } });
  const token = { type: 'oauth', access, refresh: 'synthetic-refresh', expires: 2100000000000, methodID: 'chatgpt-browser', metadata: { accountID: 'actual' } };
  assert.equal(normalizeOAuth('opencode', { openai: token }, 'openai').record.accountId, 'actual');
  for (const [metadata, code] of [[{ accountID: 'conflict' }, 'oauth_account_mismatch'], [{ clientId: 'different' }, 'oauth_client_mismatch'],
    [{ scopes: ['chatgpt.tokens.use.direct'] }, 'chatgpt_plan_login_required']])
    assert.throws(() => normalizeOAuth('opencode', { openai: { ...token, metadata } }, 'openai'), { code });
});
test('Anthropic client identity, explicit scopes and unknown constraints are checked and compatible metadata is retained', () => {
  const metadata = { clientId: CLIENT, scopes: ['user:profile', 'user:inference'], customMetadata: { keep: 'local-metadata' } };
  const result = normalizeOAuth('claude', { claudeAiOauth: grant(metadata) });
  assert.deepEqual(result.record.customMetadata, metadata.customMetadata); assert.equal(result.record.clientId, CLIENT); assert.deepEqual(result.record.scopes, metadata.scopes);
  for (const [extra, code] of [[{ clientId: 'different' }, 'oauth_client_mismatch'], [{ client_id: 'different' }, 'oauth_client_mismatch'],
    [{ provider: 'openai' }, 'oauth_provider_mismatch'], [{ scopes: ['user:profile'] }, 'oauth_scope_mismatch'],
    [{ scopes: ['user:inference', 'unknown-scope'] }, 'oauth_scope_mismatch'], [{ scopes: [1] }, 'oauth_scope_mismatch'],
    [{ metadata: { clientId: 'different' } }, 'oauth_client_mismatch'],
    [{ issuer: 'unknown' }, 'oauth_metadata_unverified'], [{ extensions: { grantBound: true } }, 'oauth_metadata_unverified']]) {
    const source = { claudeAiOauth: grant(extra) }, before = JSON.stringify(source);
    assert.throws(() => normalizeOAuth('claude', source), { code }); assert.equal(JSON.stringify(source), before);
    assert.equal(oauthTransferCompatibility('claude', source).requiresLogin, true);
    assert.throws(() => normalizeOAuth('opencode', { anthropic: { type: 'oauth', access: 'synthetic', refresh: 'synthetic', expires: 2100000000000, ...extra } }, 'anthropic'), { code });
  }
  assert.throws(() => normalizeOAuth('claude', { clientId: 'different', claudeAiOauth: grant() }), { code: 'oauth_client_mismatch' });
  const legacy = oauthTransferCompatibility('claude', { claudeAiOauth: grant({ expiresAt: 1500000000000 }) });
  assert.equal(legacy.compatible, true); assert.equal(legacy.verification, 'format-only'); assert.equal(legacy.expired, true); assert.match(legacy.refreshGuidance, /原生 pi/);
});
test('Claude user settings overrides block both preview and changes made before apply without exposing secrets', t => {
  for (const variable of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN']) {
    const f = setup(t), m = f.manager, dir = f.env.CLAUDE_CONFIG_DIR, file = path.join(dir, '.credentials.json');
    const history = new OAuthHistory({ dataDir: f.data, crypto: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() },
      sources: () => m.oauthHistorySources(), target: (h, p) => m.oauthHistoryTarget(h, p) });
    history.scan({ immediate: true }); const id = history.entries[0].id;
    f.put(file, { claudeAiOauth: grant({ accountId: 'another', accessToken: 'synthetic-another-access' }) }); history.scan({ immediate: true });
    const ticket = history.preview('claude', id).ticket, before = fs.readFileSync(file, 'utf8');
    const settings = path.join(dir, 'settings.json'); f.put(settings, { theme: 'dark', env: { [variable]: 'synthetic-secret-override' } });
    const originalSettings = fs.readFileSync(settings, 'utf8');
    assert.match(m.oauthHistoryTarget('claude').blocked, /用户级 settings.env/); assert.ok(!m.oauthHistoryTarget('claude').blocked.includes('synthetic-secret'));
    assert.throws(() => history.apply(ticket, true), /settings.env/); assert.throws(() => history.preview('claude', id), /settings.env/);
    assert.equal(fs.readFileSync(file, 'utf8'), before); assert.equal(fs.readFileSync(settings, 'utf8'), originalSettings);
    f.put(settings, { env: { [variable]: '' } }); assert.equal(m.oauthHistoryTarget('claude').blocked, '');
    f.put(settings, '{malformed'); assert.match(m.oauthHistoryTarget('claude').blocked, /无法安全读取/);
  }
});
test('OpenCode v2 OAuth inventory imports every DB credential independently, ignores stale files and rechecks deleted rows', t => {
  const f = setup(t), m = f.manager, dir = path.join(f.home, '.local/share/opencode'); fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'opencode.db'), { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(dbFile);
  try { db.exec('CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT, value TEXT, active INTEGER)');
    const insert = db.prepare('INSERT INTO credential VALUES (?,?,?,?,?)');
    for (const id of ['A', 'B']) insert.run(id, 'anthropic', id, JSON.stringify({ type: 'oauth', access: 'synthetic-' + id, refresh: 'refresh-' + id, expires: 2100000000000, clientId: CLIENT, scopes: ['user:inference'] }), id === 'A' ? 1 : 0);
    insert.run('api', 'other', 'private label', JSON.stringify({ type: 'key', key: 'synthetic-private-key' }), 1);
    f.put(path.join(dir, 'auth.json'), { 'stale-provider': { type: 'oauth', access: 'stale', refresh: 'stale', expires: 2100000000000 } });
    const before = fs.readFileSync(dbFile), sources = m.oauthSources().filter(s => s.kind === 'opencode'); assert.equal(sources.length, 2);
    for (const s of sources) { assert.equal(s.compatible, true); const id = m.importOAuth(s.id, 'database');
      assert.equal(JSON.parse(fs.readFileSync(path.join(m.root('pi', id), 'auth.json'))).anthropic.access, 'synthetic-' + s.credentialId); }
    assert.deepEqual(fs.readFileSync(dbFile), before);
    const view = m.snapshot(), snapshot = JSON.stringify(view); assert.ok(!snapshot.includes('synthetic-private-key')); assert.ok(!snapshot.includes('refresh-A')); assert.ok(!JSON.stringify(view.oauthSources).includes('credentialId'));
    const originalSources = m.oauthSources.bind(m); m.oauthSources = () => { const rows = originalSources(); db.prepare('DELETE FROM credential WHERE id=?').run('A'); return rows; };
    assert.throws(() => m.importOAuth(sources.find(s => s.credentialId === 'A').id, 'stale'), /变化/); assert.equal(m.state.profiles.length, 2);
  } finally { db.close(); }
});
