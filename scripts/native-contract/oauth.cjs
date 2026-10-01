// Opt-in OAuth contract checks: synthetic grants, isolated homes, localhost CLI
// requests and unchanged official Pi modules with an in-memory refresh mock.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), { pathToFileURL } = require('node:url');
const { HarnessManager } = require('../../core/harnesses.cjs'), { OAuthHistory } = require('../../core/oauth-history.cjs');
const { normalizeOAuth, piOAuthProviders } = require('../../core/oauth-import.cjs');
const { mock } = require('./mock.cjs');
const CLIENT = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
async function main() {
  if (!process.argv.includes('--enable')) { console.log('SKIPPED OAuth contracts: use --enable --prefix <installed harness roots>'); return; }
  const prefix = process.argv[process.argv.indexOf('--prefix') + 1];
  if (!prefix || !path.isAbsolute(prefix)) throw Error('Provide an absolute --prefix');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ass-native-oauth-')), results = [];
  const env = { HOME: root, USERPROFILE: root, APPDATA: path.join(root, 'AppData/Roaming'), LOCALAPPDATA: path.join(root, 'AppData/Local'),
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, COMSPEC: process.env.COMSPEC, PATHEXT: process.env.PATHEXT,
    PATH: [path.dirname(process.execPath), process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin', '/bin'].join(path.delimiter),
    TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), TMPDIR: path.join(root, 'tmp'),
    XDG_CONFIG_HOME: path.join(root, '.config'), XDG_DATA_HOME: path.join(root, '.local/share'), XDG_STATE_HOME: path.join(root, '.local/state'), XDG_CACHE_HOME: path.join(root, '.cache'),
    CODEX_HOME: path.join(root, '.codex'), CLAUDE_CONFIG_DIR: path.join(root, 'custom-claude'), PI_CODING_AGENT_DIR: path.join(root, '.pi/agent'),
    CI: '1', NO_COLOR: '1', TERM: 'dumb', DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', PI_OFFLINE: '1', PI_TELEMETRY: '0',
    OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost',
    NODE_OPTIONS: '--require=' + JSON.stringify(path.join(__dirname, 'guard.cjs')) };
  fs.mkdirSync(env.TEMP, { recursive: true });
  // Official lazy modules also see only the isolated environment.
  process.env = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));
  const packages = { pi: ['@earendil-works/pi-coding-agent', '0.99.1'], claude: ['@anthropic-ai/claude-code', '2.1.285'], 'opencode-v2': ['@opencode/cli', '2.0.20'] };
  const entries = {};
  for (const [name, [pkg, version]] of Object.entries(packages)) {
    const base = path.join(prefix, name, 'node_modules', pkg), metadata = JSON.parse(fs.readFileSync(path.join(base, 'package.json')));
    assert.equal(metadata.version, version); assert.equal(metadata.name, pkg); entries[name] = base;
  }
  const local = await mock();
  const { resolveLauncher } = require('../../core/client-launcher.cjs');
  const execute = (harness, base, args, extra = {}) => new Promise((resolve, reject) => {
    const launcher = resolveLauncher(harness, base, env); assert.ok(launcher.ready, launcher.message);
    const child = spawn(launcher.executable, [...launcher.args, ...args], { cwd: root, env: { ...env, ...extra }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on('data', b => stdout = (stdout + b).slice(-100000)); child.stderr.on('data', b => stderr = (stderr + b).slice(-100000));
    child.on('error', e => { clearTimeout(timer); reject(e); }); child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  const onlyIndex = process.argv.indexOf('--only'), only = onlyIndex >= 0 ? process.argv[onlyIndex + 1]?.split(',') : null;
  const check = async (name, fn) => {
    const group = name.includes('settings') ? 'settings' : name.split(' ')[0].toLowerCase();
    if (only && !only.includes(group)) return;
    try { await fn(); results.push({ name, status: 'pass' }); } catch (e) { results.push({ name, status: 'fail', message: e.message }); }
  };
  const manager = new HarnessManager(path.join(root, 'ass'), () => ({ providers: [] }), [], env.CODEX_HOME, { home: root, env, launchEnv: env });
  const grant = (id, extra = {}) => ({ accessToken: 'sk-ant-oat01-SYNTHETIC_' + id, refreshToken: 'sk-ant-ort01-SYNTHETIC_' + id,
    expiresAt: Date.now() + 3600000, accountId: id, clientId: CLIENT, scopes: ['user:inference', 'user:profile'], customMetadata: { keep: id }, ...extra });
  const file = path.join(env.CLAUDE_CONFIG_DIR, '.credentials.json'), settings = path.join(env.CLAUDE_CONFIG_DIR, 'settings.json');
  const settingsData = { env: { ANTHROPIC_BASE_URL: local.base.replace(/\/v1$/, ''), ANTHROPIC_MODEL: 'claude-sonnet-4-6' } };
  const history = new OAuthHistory({ dataDir: manager.dataDir, crypto: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() },
    sources: () => manager.oauthHistorySources(), target: (h, p) => manager.oauthHistoryTarget(h, p) }); // synthetic fixtures only
  const claude = async want => {
    const start = local.requests.length, output = await execute('claude', entries.claude, ['-p', 'ASS_CONTRACT_FOLLOWUP', '--output-format', 'json', '--tools', '', '--disable-slash-commands', '--max-turns', '1']);
    assert.equal(output.code, 0, output.stderr); assert.ok(local.requests.slice(start).some(r => r.authorization === 'Bearer ' + want));
  };
  try {
    const piEntry = path.join(entries.pi, 'dist/cli.js'); manager.piProviders = await piOAuthProviders(piEntry);
    const ai = path.join(entries.pi, 'node_modules/@earendil-works/pi-ai/dist');
    const { anthropicOAuth } = await import(pathToFileURL(path.join(ai, 'auth/oauth/anthropic.js')).href);
    const { openaiCodexProvider } = await import(pathToFileURL(path.join(ai, 'providers/openai-codex.js')).href);
    const { stream } = await import(pathToFileURL(path.join(ai, 'api/openai-codex-responses.js')).href);
    await check('Pi official Anthropic consumer and refresh client match imported grant', async () => {
      put(file, { claudeAiOauth: grant('A') }); const id = manager.importOAuth('local-claude', 'Claude A');
      const record = JSON.parse(fs.readFileSync(path.join(manager.root('pi', id), 'auth.json'))).anthropic;
      assert.equal((await anthropicOAuth.toAuth(record)).apiKey, record.access); assert.equal(record.clientId, CLIENT);
      let body; const original = globalThis.fetch;
      try { globalThis.fetch = async (url, init) => { assert.equal(String(url), 'https://platform.claude.com/v1/oauth/token'); body = JSON.parse(init.body);
        return Response.json({ access_token: 'synthetic-rotated-access', refresh_token: 'synthetic-rotated-refresh', expires_in: 3600 }); };
        await anthropicOAuth.refresh(record, new AbortController().signal);
      } finally { globalThis.fetch = original; }
      assert.equal(body.client_id, record.clientId); assert.equal(body.refresh_token, record.refresh);
      put(file, { claudeAiOauth: grant('conflict', { clientId: 'different-client' }) }); const before = manager.state.profiles.length;
      assert.throws(() => manager.importOAuth('local-claude', 'reject')); assert.equal(manager.state.profiles.length, before);
    });
    await check('Pi official legacy request uses access JWT account and rejects a missing claim before wire', async () => {
      const jwt = claims => 'synthetic.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
      const claims = { exp: Math.floor(Date.now() / 1000) + 3600, 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } };
      put(path.join(env.CODEX_HOME, 'auth.json'), { tokens: { access_token: jwt(claims), refresh_token: 'synthetic-refresh', account_id: 'synthetic-account' } });
      const id = manager.importOAuth('local-codex', 'Codex'), record = JSON.parse(fs.readFileSync(path.join(manager.root('pi', id), 'auth.json')))['openai-codex'];
      const model = { ...openaiCodexProvider().getModels()[0], baseUrl: local.base }; let captured;
      const request = apiKey => stream(model, { messages: [{ role: 'user', content: 'Synthetic', timestamp: Date.now() }] }, { apiKey, transport: 'sse', maxRetries: 0,
        fetch: async (url, init) => { captured = Object.fromEntries(new Headers(init.headers)); return Response.json({ error: { message: 'synthetic capture' } }, { status: 400 }); } }).result();
      await request(record.access); assert.equal(captured['chatgpt-account-id'], record.accountId); assert.equal(captured.authorization, 'Bearer ' + record.access);
      const bad = { tokens: { access_token: jwt({ exp: claims.exp }), refresh_token: 'synthetic-refresh', account_id: record.accountId } };
      assert.throws(() => normalizeOAuth('codex', bad), { code: 'oauth_access_account_missing' }); captured = undefined;
      const response = await request(bad.tokens.access_token); assert.equal(captured, undefined); assert.match(response.errorMessage, /Failed to extract accountId/);
    });
    await check('Claude native A-B-A switch consumes exact saved grant and metadata', async () => {
      put(settings, settingsData); const records = {};
      for (const id of ['A', 'B']) { records[id] = grant(id); put(file, { claudeAiOauth: records[id], unrelated: { keep: true } }); history.scan({ immediate: true }); }
      for (const id of ['A', 'B', 'A']) { const entry = history.entries.find(e => e.grant.accountId === id); history.apply(history.preview('claude', entry.id).ticket, true);
        assert.deepEqual(JSON.parse(fs.readFileSync(file)).claudeAiOauth, records[id]); await claude(records[id].accessToken); }
    });
    for (const variable of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN']) await check('Claude settings override guard: ' + variable, async () => {
      put(settings, settingsData);
      if (!history.entries.some(e => e.harness === 'claude')) { put(file, { claudeAiOauth: grant('A') }); history.scan({ immediate: true }); }
      const entry = history.entries.find(e => e.harness === 'claude'), ticket = history.preview('claude', entry.id).ticket;
      const override = 'sk-ant-oat01-SYNTHETIC_' + 'OVERRIDE', configuration = { env: { ...settingsData.env, [variable]: override } };
      put(settings, configuration); const before = fs.readFileSync(file, 'utf8');
      assert.throws(() => history.apply(ticket, true), /settings.env/); assert.throws(() => history.preview('claude', entry.id), /settings.env/);
      assert.equal(fs.readFileSync(file, 'utf8'), before); assert.deepEqual(JSON.parse(fs.readFileSync(settings)), configuration);
      await claude(override); put(settings, settingsData);
    });
    await check('OpenCode v2 native auth import, database-only discovery and independent Pi import', async () => {
      const jwt = id => 'synthetic.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600,
        'https://api.openai.com/auth': { chatgpt_account_id: id } })).toString('base64url') + '.signature';
      const credentials = ['A', 'B'].map((id, i) => ({ id: 'cred_synthetic_' + id, integrationID: 'openai', label: 'Synthetic ' + id, active: i === 0,
        value: { type: 'oauth', methodID: 'chatgpt-browser', access: jwt(id), refresh: 'synthetic-refresh-' + id, expires: Date.now() + 3600000, metadata: { accountID: id } } }));
      const source = path.join(root, 'credentials.json'); put(source, credentials);
      const imported = await execute('opencode', entries['opencode-v2'], ['auth', 'import', source, '--standalone']); assert.equal(imported.code, 0, imported.stderr);
      const sources = manager.oauthSources().filter(s => s.kind === 'opencode'); assert.equal(sources.length, 2);
      for (const s of sources) { const id = manager.importOAuth(s.id, 'Database'); assert.equal(JSON.parse(fs.readFileSync(path.join(manager.root('pi', id), 'auth.json')))['openai-codex'].access,
        credentials.find(c => c.id === s.credentialId).value.access); }
      for (const id of ['A', 'B', 'A']) { const output = await execute('opencode', entries['opencode-v2'], ['auth', 'switch', 'openai', 'cred_synthetic_' + id, '--standalone']); assert.equal(output.code, 0, output.stderr);
        assert.match(manager.oauthSources().find(s => s.kind === 'opencode' && s.credentialId === 'cred_synthetic_' + id).label, /当前/); }
    });
  } finally {
    local.server.close(); put(path.join(root, 'results.json'), { scope: 'Synthetic isolated fixtures; CLI localhost requests and in-memory official Pi refresh. No real login, service refresh or entitlement validation.', results });
    put(path.join(root, 'requests.json'), local.requests); console.log(JSON.stringify({ root, results }, null, 2));
  }
  if (results.some(r => r.status !== 'pass')) process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
