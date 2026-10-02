// Opt-in native contracts only; every input/home belongs to the runner.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const codecs = require('../../core/project-codecs.cjs'), contract = require('../../core/opencode-version.cjs');
const { ProjectConversations } = require('../../core/project-conversations.cjs');
const mainFile = path.resolve(__dirname, '../../electron/main.cjs');
function releaseCallback(launcher, dir, env) {
  const source = fs.readFileSync(mainFile, 'utf8');
  const start = source.indexOf('releaseImports: async (plan) => {') + 'releaseImports: '.length;
  const end = source.indexOf('\n        } });\n      projectConversations.start();', start);
  assert.ok(end > start);
  return new Function('require', 'harnesses', 'path', 'fs', 'return (' + source.slice(start, end) + '\n})')(
    createRequire(mainFile), { launcher: () => launcher, projectConversationPlan: () => ({ dir, env }) }, path, fs);
}
async function openCode({ name, launcher, f, root, execute, put, crypt, check }) {
  await check(name + ': exact Electron duplicate resume, restore and Pi return', async () => {
    const version = name === 'opencode-v2' ? 2 : 1, dir = path.join(f.env.XDG_DATA_HOME, 'opencode'), db = path.join(dir, 'opencode.db');
    const cwd = path.join(f.work, 'round2-project'); fs.mkdirSync(cwd, { recursive: true });
    const local = { ...f, work: cwd }, id = 'ses_round2original12345678901234';
    const messages = [{ role: 'user', text: '中文 original question', timestamp: '2026-10-01T00:00:00Z' }, { role: 'assistant', text: 'original answer 😀', timestamp: '2026-10-01T00:00:01Z' }, { role: 'user', text: 'second original question', timestamp: '2026-10-01T00:00:02Z' }, { role: 'assistant', text: 'second original answer', timestamp: '2026-10-01T00:00:03Z' }];
    const input = path.join(root, name, 'round2.json'); put(input, codecs.encode('opencode', { id, cwd, messages, createdAt: '2026-10-01T00:00:00Z', title: 'Round2', nativeVersion: version }).bytes);
    const initial = await execute(launcher, contract.command(version, 'import', input), local); assert.equal(initial.code, 0, initial.stderr);
    const standaloneFile = path.join(root, name, 'standalone', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
    fs.mkdirSync(path.dirname(standaloneFile), { recursive: true }); fs.linkSync(fs.realpathSync(launcher.executable), standaloneFile);
    const standalone = require('../../core/client-launcher.cjs').resolveLauncher('opencode', standaloneFile, f.env);
    assert.ok(standalone.ready); assert.equal(contract.version(standalone, dir), version);
    const exportResult = await execute(standalone, contract.command(contract.version(standalone, dir), 'export', id), local); assert.equal(exportResult.code, 0, exportResult.stderr);
    put(path.join(root, name, 'standalone-export.json'), { version, code: exportResult.code, standaloneSha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(standaloneFile)).digest('hex') });
    const options = { dataDir: path.join(root, name, 'round2-ass'), crypto: crypt, sources: () => [{ harness: 'opencode', dir }], releaseImports: releaseCallback(launcher, dir, f.env) };
    const library = new ProjectConversations(options), project = (await library.list()).items.find(p => codecs.pathKey(p.cwd) === codecs.pathKey(cwd));
    assert.ok(project); await library.configure(project.id, { enabled: true });
    const thread = (await library.threads(project.id)).items[0];
    const source = fs.readFileSync(mainFile, 'utf8'), start = source.indexOf('register("project-conversations-resume",'), end = source.indexOf('      register("conversations-preview"', start);
    let handler;
    new Function('register', 'require', 'connections', 'harnesses', 'projectConversations', 'router', 'fs', 'path', source.slice(start, end))(
      (_, fn) => { handler = fn; }, createRequire(mainFile), { launch: fn => fn(), enabled: {} },
      { launcher: () => launcher, projectConversationPlan: () => ({ dir, env: f.env }), launchPlan: async () => ({ ok: true }) }, library, {}, fs, path);
    await handler(project.id, thread.id, 'opencode'); await handler(project.id, thread.id, 'opencode');
    const pi = path.join(root, name, 'round2-pi'); fs.mkdirSync(pi);
    const route = await library.prepare(project.id, thread.id, 'pi', pi);
    const more = [...messages, { role: 'user', text: 'Pi followup 中文' }, { role: 'assistant', text: 'Pi answer 😀' }];
    put(route.nativeFile, codecs.encode('pi', { id: route.sessionId, cwd, messages: more, createdAt: '2026-10-01T00:00:00Z' }).bytes);
    await library.sync(project.id); await library.configure(project.id, { enabled: false });
    assert.equal(library.project(project.id).enabled, false); assert.equal(fs.existsSync(route.nativeFile), false);
    const rows = codecs.discover([{ harness: 'opencode', dir }], { includeMessages: true }).rows.filter(r => codecs.pathKey(r.cwd) === codecs.pathKey(cwd));
    assert.ok(rows.some(r => r.messages?.length === 6));
    const nativeRow = (await library.records(project.id)).items.find(r => r.sessionId === id); assert.ok(nativeRow);
    const before = codecs.openCodeBundle(db, id), deleted = await library.remove({ projectId: project.id, recordId: nativeRow.id, confirmed: true });
    await library.restoreTrash(deleted.id);
    const fresh = new ProjectConversations(options); assert.equal(fresh.trashList().items.length, 0);
    assert.ok(contract.equal(before, codecs.openCodeBundle(db, id)));
    const restored = (await fresh.list()).items.find(p => codecs.pathKey(p.cwd) === codecs.pathKey(cwd)); assert.ok((await fresh.records(restored.id)).items.some(r => r.sessionId === id));
    put(path.join(root, name, 'round2-history-results.json'), { version, duplicateResume: true, restoredVisibleAfterRestart: true, returnMessages: 6, standaloneSchema: true });
  });
}
async function pi({ name, packageDir, f, root, put, crypt, check }) {
  await check(name + ': native AuthStorage lock prevents concurrent OAuth overwrite', async () => {
    const { FileAuthStorageBackend } = await import(pathToFileURL(path.join(packageDir, 'dist/core/auth-storage.js')).href);
    const { OAuthHistory } = require('../../core/oauth-history.cjs');
    const dir = path.join(root, name, 'round2-pi-oauth'), file = path.join(dir, 'auth.json'), source = { harness: 'pi', dir, native: true };
    const a = { type: 'oauth', access: 'synthetic-a', refresh: 'synthetic-ra', expires: 2100000000000, email: 'a@example.test' }, b = { ...a, access: 'synthetic-b', refresh: 'synthetic-rb', email: 'b@example.test' };
    const history = new OAuthHistory({ dataDir: path.join(root, name, 'round2-oauth-ass'), crypto: crypt, sources: () => [source], target: () => source });
    put(file, { anthropic: a, other: { type: 'api_key', key: 'synthetic-other' } }); history.scan({ immediate: true }); const id = history.entries[0].id;
    put(file, { anthropic: b, other: { type: 'api_key', key: 'synthetic-other' } }); history.scan({ immediate: true });
    const ticket = history.preview('pi', id).ticket, backend = new FileAuthStorageBackend(file);
    let unlock, acquired; const held = new Promise(resolve => { unlock = resolve; }), ready = new Promise(resolve => { acquired = resolve; });
    const operation = backend.withLockAsync(async current => { acquired(); await held; return { result: true, next: current }; });
    await ready;
    try { assert.throws(() => history.apply(ticket, true), /Pi 正在/); assert.ok(fs.existsSync(file + '.lock')); assert.equal(JSON.parse(fs.readFileSync(file)).anthropic.access, b.access); }
    finally { unlock(); await operation; }
    history.apply(history.preview('pi', id).ticket, true);
    const stored = await backend.withLockAsync(async current => ({ result: JSON.parse(current) }));
    assert.deepEqual(stored.anthropic, a); assert.equal(stored.other.key, 'synthetic-other'); assert.equal(fs.existsSync(file + '.lock'), false);
    put(path.join(root, name, 'round2-native-auth-lock.json'), { nativeVersion: JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'))).version, nativeBackend: true, concurrentSwitchBlocked: true, retryNativeRead: true, unrelatedProviderPreserved: true, realOAuthRefresh: false });
  });
}
async function kimi({ name, launcher, f, root, execute, put, server, check }) {
  await check(name + ': model credentials and flat route identities match native requests', async () => {
    const TOML = require('@iarna/toml'), { inspect } = require('../../core/additional-harnesses.cjs'), { modelSources } = require('../../core/model-inventory.cjs'), { resolveNativeDiagnostic } = require('../../core/native-model-diagnostics.cjs');
    const file = path.join(f.env.KIMI_CODE_HOME, 'config.toml'), original = fs.readFileSync(file);
    const provider = { type: 'openai', base_url: server.base + '/provider', api_key: 'synthetic-provider' };
    const common = { max_context_size: 64000, max_output_size: 1024 };
    const cases = {
      standard: { providers: { local: provider }, models: { qa: { ...common, provider_id: 'local', name: 'wire' } } },
      modelOverride: { providers: { local: provider }, models: { qa: { ...common, provider_id: 'local', name: 'wire', base_url: server.base + '/model', api_key: 'synthetic-model' } } },
      modelKey: { providers: { local: { type: 'openai', base_url: server.base + '/provider' } }, models: { qa: { ...common, provider_id: 'local', name: 'wire', api_key: 'synthetic-model' } } },
      flat: { models: { first: { ...common, name: 'first', protocol: 'openai', base_url: server.base + '/first', api_key: 'synthetic-first' }, second: { ...common, name: 'second', protocol: 'openai', base_url: server.base + '/second', api_key: 'synthetic-second' } } },
    };
    const results = [];
    try {
      for (const [shape, config] of Object.entries(cases)) {
        for (const alias of Object.keys(config.models)) {
          put(file, TOML.stringify({ ...config, default_model: alias }));
          const found = inspect('kimi', { home: f.home, env: f.env }), client = { id: 'kimi', name: 'Kimi', accounts: [...found.accounts, ...found.apiAccounts], modelAccounts: found.modelAccounts };
          const models = modelSources({ providers: [], officialModels: [] }, { clients: [client] }, { home: f.home, env: f.env }).find(p => p.id === 'native-kimi').models;
          const model = models.find(m => m.nativeAlias === alias), target = resolveNativeDiagnostic(model.diagnosticProviderId, model.model, { clients: [client] }, { home: f.home, env: f.env });
          const start = server.requests.length, result = await execute(launcher, ['-p', 'ASS_CONTRACT_FOLLOWUP'], f);
          assert.equal(result.code, 0, result.stderr);
          const requests = server.requests.slice(start); assert.ok(requests.length);
          const actual = requests[0]; assert.equal(actual.path, new URL(target.request.url).pathname); assert.equal(actual.body.model, target.request.body.model); assert.equal(actual.authorization, target.request.headers.authorization);
          results.push({ shape, alias, nativeRequestMatches: true });
        }
      }
    } finally { fs.writeFileSync(file, original); }
    put(path.join(root, name, 'round2-native-shapes.json'), results);
  });
}
module.exports = { openCode, pi, kimi };
