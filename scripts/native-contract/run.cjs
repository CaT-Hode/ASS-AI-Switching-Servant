// Explicit opt-in, installed pinned consumers only. Never downloads a binary.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { resolveLauncher } = require('../../core/client-launcher.cjs');
const { HarnessManager } = require('../../core/harnesses.cjs');
const { NativeConfig, providerId } = require('../../core/native-config.cjs');
const { parseImport } = require('../../core/models.cjs'), codecs = require('../../core/project-codecs.cjs');
const { mock } = require('./mock.cjs');
const pins = { codex: ['@openai/codex', '0.159.2'], claude: ['@anthropic-ai/claude-code', '2.1.285'],
  'opencode-v1': ['opencode-ai', '1.18.33'], 'opencode-v2': ['@opencode/cli', '2.0.20'],
  pi: ['@earendil-works/pi-coding-agent', '0.99.1'], dsh: ['@deepseek-ai/dsh', '0.2.0-rc.2'], kimi: ['@moonshot-ai/kimi-code', '2.1.1'],
  zcode: ['@zcode/desktop', '3.14.4'] };
const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2)); };
const crypt = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() }; // synthetic fixtures only
function execute(launcher, args, f) {
  return new Promise((resolve, reject) => {
    const child = spawn(launcher.executable, [...launcher.args, ...args], { env: f.env, cwd: f.work, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, 45000);
    child.stdout.on('data', b => { stdout = (stdout + b).slice(-(1024 ** 2)); });
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-(1024 ** 2)); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, expired, args }); });
  });
}
async function main() {
  if (!process.argv.includes('--enable')) { console.log('SKIPPED native contracts: use --enable and --prefix <installed harness roots>'); return; }
  const index = process.argv.indexOf('--prefix'), prefix = index >= 0 && process.argv[index + 1];
  if (!prefix || !path.isAbsolute(prefix)) throw Error('Provide absolute --prefix with pinned packages in <name>/node_modules/<package>');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ass-native-contract-'));
  const results = [], server = await mock();
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, status: 'pass' }); } catch (e) { results.push({ name, status: 'fail', message: e.message }); }
  };
  try {
    for (const [name, [pkg, expected]] of Object.entries(pins)) {
      const onlyIndex = process.argv.indexOf('--only');
      if (onlyIndex >= 0 && !process.argv[onlyIndex + 1]?.split(',').includes(name)) continue;
      const harness = name.startsWith('opencode') ? 'opencode' : name, packageDir = path.join(prefix, name, 'node_modules', pkg);
      const zcodeRoot = path.join(prefix, 'zcode'), zcodeCLI = path.join(zcodeRoot, 'resources/glm/zcode.cjs');
      const manifest = name === 'zcode' ? path.join(zcodeRoot, 'resources/app.asar/package.json') : path.join(packageDir, 'package.json');
      const zcodeMeta = name === 'zcode' ? require('../../core/desktop-metadata.cjs').readDesktopJson(manifest) : null;
      if (name === 'zcode' ? !zcodeMeta?.version || !fs.existsSync(zcodeCLI) : !fs.existsSync(manifest)) { results.push({ name, status: 'blocked', message: 'Pinned native consumer is not installed' }); continue; }
      const meta = zcodeMeta || JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (meta.name !== pkg || meta.version !== expected) { results.push({ name, status: 'blocked', message: `Expected ${pkg}@${expected}` }); continue; }
      try {
      const home = path.join(root, name, 'home'), work = path.join(root, name, 'project'); fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(work, { recursive: true });
      const env = { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
        SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, COMSPEC: process.env.COMSPEC, PATHEXT: process.env.PATHEXT,
        PATH: [path.dirname(process.execPath), process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin', '/bin'].join(path.delimiter),
        TEMP: path.join(home, 'tmp'), TMP: path.join(home, 'tmp'), TMPDIR: path.join(home, 'tmp'),
        XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_STATE_HOME: path.join(home, '.local/state'), XDG_CACHE_HOME: path.join(home, '.cache'),
        XDG_RUNTIME_DIR: path.join(home, 'runtime'), CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PI_CODING_AGENT_DIR: path.join(home, '.pi/agent'), DSH_HOME: path.join(home, '.dsh'), KIMI_CODE_HOME: path.join(home, '.kimi-code'),
        CI: '1', NO_COLOR: '1', TERM: 'dumb', DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', PI_OFFLINE: '1', PI_TELEMETRY: '0',
        OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost',
        NODE_OPTIONS: '--require=' + JSON.stringify(path.join(__dirname, 'guard.cjs')) };
      fs.mkdirSync(env.TEMP, { recursive: true }); fs.mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true });
      if (name === 'zcode') Object.assign(env, { ZCODE_DATA_BASE_DIR: home, ZCODE_CREDENTIAL_SECRET: 'synthetic-fixture-only',
        ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: path.join(home, '.zcode/v2/provider_config.json'),
        ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: path.join(zcodeRoot, 'resources/config/provider/zcode-builtin.json'),
        ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE: path.join(zcodeRoot, 'resources/config/provider/zcode-builtin.json') });
      const launcher = resolveLauncher(harness, name === 'zcode' ? zcodeCLI : packageDir, env), f = { home, work, env };
      if (!launcher.ready) { results.push({ name, status: 'blocked', message: launcher.message }); continue; }
      const providers = parseImport({ providers: [{ id: 'contract', baseUrl: server.base, apiKey: 'synthetic-contract-key',
        models: [{ model: 'contract-model', wireApi: harness === 'claude' ? 'anthropic' : harness === 'codex' ? 'openai-responses' : 'openai-chat', efforts: ['low'], defaultEffort: 'low', contextWindow: 64000, maxOutputTokens: 1024 }] }] });
      const data = path.join(root, name, 'ass'), manager = new HarnessManager(data, () => ({ providers }), [], env.CODEX_HOME, { home, env, launchEnv: env, isConnected: () => true });
      manager.state.executables[harness] = name === 'zcode' ? zcodeCLI : packageDir;
      const native = new NativeConfig(data, crypt, manager); manager.options.nativeConfig = native;
      let args;
      if (harness === 'dsh') {
        put(path.join(env.DSH_HOME, 'desktop-link/web.json'), { coreVersion: expected, profile: 'headless' });
        native.sync(harness, { account: 'api:contract', model: 'contract-model' });
        args = ['--profile', 'headless', '--json', 'ASS_CONTRACT_FOLLOWUP'];
      } else if (harness === 'pi') {
        native.sync(harness, { account: 'api:contract', model: 'contract-model' });
        args = ['--offline', '--no-extensions', '--no-skills', '--no-context-files', '--no-tools', '--mode', 'json', '-p', 'ASS_CONTRACT_FOLLOWUP'];
      } else if (harness === 'kimi') {
        native.sync(harness); const file = path.join(home, '.kimi-code/config.toml'), TOML = require('@iarna/toml');
        const conf = TOML.parse(fs.readFileSync(file, 'utf8')); conf.default_model = Object.keys(conf.models)[0]; put(file, TOML.stringify(conf));
        args = ['-p', 'ASS_CONTRACT_FOLLOWUP'];
      } else if (harness === 'opencode') {
        if (name === 'opencode-v2') {
          const file = path.join(root, name, 'bootstrap-credential-service.json');
          put(file, [{ id: 'cred_contract_bootstrap', integrationID: 'opencode', label: 'Synthetic bootstrap', active: true,
            value: { type: 'key', key: 'synthetic-bootstrap-key' } }]);
          const initialized = await execute(launcher, ['auth', 'import', file, '--standalone'], f);
          put(path.join(root, name, 'initialized-service.json'), initialized);
          assert.equal(initialized.code, 0, initialized.stderr.slice(-5000));
        }
        native.sync(harness, { account: 'api:contract', model: 'contract-model' });
        args = ['run', 'ASS_CONTRACT_FOLLOWUP', '--model', providerId(providers[0], 'openai-chat') + '/contract-model', ...(name === 'opencode-v2' ? ['--standalone'] : [])];
      } else if (harness === 'claude') {
        // Native CC overlay points to the local Messages mock; no ASS router needed.
        put(path.join(env.CLAUDE_CONFIG_DIR, 'settings.json'), { env: { ANTHROPIC_API_KEY: 'synthetic-contract-key', ANTHROPIC_BASE_URL: server.base.replace(/\/v1$/, ''), ANTHROPIC_MODEL: 'contract-model' } });
        args = ['-p', 'ASS_CONTRACT_FOLLOWUP', '--output-format', 'json', '--tools', '', '--disable-slash-commands', '--max-turns', '1'];
      } else if (harness === 'codex') {
        put(path.join(env.CODEX_HOME, 'config.toml'), `model_provider = "contract"\nmodel = "contract-model"\n[model_providers.contract]\nname = "Local contract"\nbase_url = "${server.base}"\nwire_api = "responses"\nexperimental_bearer_token = "synthetic-contract-key"\n`);
        args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', 'ASS_CONTRACT_FOLLOWUP'];
      } else if (harness === 'zcode') {
        native.sync(harness); const file = env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, conf = JSON.parse(fs.readFileSync(file, 'utf8'));
        conf.config.defaultModelSelection = { providerId: providerId(providers[0], 'openai-chat'), modelId: 'contract-model' };
        put(file, conf); args = ['-p', 'ASS_CONTRACT_FOLLOWUP'];
      }
      await check(name + ': native request', async () => {
        const start = server.requests.length, r = await execute(launcher, args, f); put(path.join(root, name, 'native-request.json'), r);
        assert.equal(r.code, 0, r.stderr.slice(-5000)); assert.ok(r.stdout.includes('ASS_CONTRACT_OK'), r.stdout.slice(-1000));
        const seen = server.requests.slice(start); assert.ok(seen.some(r => r.authorization === 'Bearer synthetic-contract-key' || r.apiKey === 'synthetic-contract-key'), 'Missing native wire authentication');
      });
      if (harness === 'kimi') await check(name + ': native model discovery variants', async () => {
        const TOML = require('@iarna/toml'), file = path.join(home, '.kimi-code/config.toml');
        for (const [style, protocol] of [['provider_id', 'openai'], ['default_provider', 'openai_responses'], ['flat', 'anthropic']]) {
          const provider = { type: protocol, base_url: server.base, api_key: 'synthetic-contract-key' };
          const common = { max_context_size: 64000, max_output_size: 1024, capabilities: [] };
          const conf = style === 'flat' ? { default_model: 'qa', models: { qa: { ...common, ...provider, protocol, name: 'contract-model' } } }
            : { default_model: 'qa', ...(style === 'default_provider' ? { default_provider: 'local' } : {}), providers: { local: provider },
              models: { qa: { ...common, ...(style === 'provider_id' ? { provider_id: 'local', name: 'contract-model' } : { model: 'contract-model' }) } } };
          put(file, TOML.stringify(conf));
          const found = require('../../core/additional-harnesses.cjs').inspect('kimi', { home, env });
          assert.ok(found.modelAccounts.some(a => a.declaredModels.some(m => m.model === 'contract-model')), 'ASS missed ' + style);
          const start = server.requests.length, r = await execute(launcher, ['-p', 'ASS_CONTRACT_FOLLOWUP'], f); put(path.join(root, name, style + '.json'), r);
          assert.equal(r.code, 0, r.stderr.slice(-5000)); assert.ok(server.requests.slice(start).some(r => r.body.model === 'contract-model'), 'Native route changed for ' + style);
        }
      });
      if (harness === 'codex') await check(name + ': native body-store deletion boundary', async () => {
        const rows = codecs.discover([{ harness, dir: env.CODEX_HOME }]).rows;
        assert.ok(rows.length, 'Codex native rollout missing'); const row = rows[0];
        const r = await execute(launcher, ['migrate-rollouts', '--apply', '--thread', row.sessionId, '--json'], f);
        put(path.join(root, name, 'migration.json'), r); assert.equal(r.code, 0, r.stderr.slice(-5000));
        const { DatabaseSync } = require('node:sqlite'), bodyFile = path.join(env.CODEX_HOME, 'thread_history_1.sqlite');
        const count = () => { const db = new DatabaseSync(bodyFile, { readOnly: true }); try { return db.prepare('SELECT COUNT(*) AS n FROM thread_items WHERE thread_id=?').get(row.sessionId).n; } finally { db.close(); } };
        const before = count(); assert.ok(before > 0, 'Native migration did not materialize bodies');
        const trash = require('../../core/conversation-trash.cjs'), vault = path.join(root, name, 'trash-vault'), secret = require('node:crypto').randomBytes(32).toString('base64');
        const entry = await trash.plan({ vault, secret, rows: [row], sources: [{ harness, dir: env.CODEX_HOME }], label: 'Synthetic boundary' });
        await trash.commit(entry); assert.equal(fs.existsSync(row.file), false); assert.equal(count(), before);
        await trash.restore({ vault, secret, entry }); assert.ok(fs.existsSync(row.file));
        const directory = path.resolve(vault, 'trash', entry.id);
        assert.ok(directory.startsWith(path.resolve(root) + path.sep)); assert.match(entry.id, /^[a-f0-9-]{36}$/);
        fs.rmSync(directory, { recursive: true, force: true }); assert.equal(count(), before);
        put(path.join(root, name, 'deletion-boundary.json'), { thread: row.sessionId, bodyRowsBefore: before, bodyRowsAfterRestoreAndBackupPurge: count(), contract: 'Explicit UI disclosure; native body store retained' });
      });
      if (harness === 'dsh') await check(name + ': custom profile and independent home consumption', async () => {
        const adapter = require('../../core/dsh-config.cjs'), YAML = require('yaml');
        const boot = await execute(launcher, ['--profile', 'qa-web', '--from-default-profile', 'web', '--dump-config'], f);
        assert.equal(boot.code, 0, boot.stderr.slice(-5000));
        put(path.join(env.DSH_HOME, 'desktop-link/web.json'), { coreVersion: expected, profile: 'qa-web' });
        native.sync('dsh');
        const plan = manager.modelPlan('dsh', require('../../core/client-policy.cjs').modelRef('contract', 'contract-model'));
        manager.materialize(plan); assert.equal(plan.args[plan.args.indexOf('--profile') + 1], 'qa-web');
        assert.equal(manager.projectConversationPlan('dsh', work).args[1], 'qa-web');
        const actual = await execute(launcher, [...plan.args, '--dump-config'], f);
        put(path.join(root, name, 'custom-profile.json'), actual); assert.equal(actual.code, 0, actual.stderr.slice(-5000));
        assert.ok(YAML.parse(actual.stdout, { logLevel: 'silent' }).some(r => r.id === 'agent-default-model' && r.config.model === 'contract-model'));
        const base = adapter.target(env.DSH_HOME, manager), independent = manager.root('dsh', 'a'.repeat(24)), target = adapter.profileTarget(independent, base);
        for (const [name, content] of adapter.profileFiles(target, base)) put(path.join(independent, name), content);
        native.syncProfile('dsh', independent);
        const result = await execute(launcher, [...adapter.launchArgs(target), '--dump-config'], { ...f, env: { ...env, DSH_HOME: independent } });
        put(path.join(root, name, 'independent-profile.json'), result); assert.equal(result.code, 0, result.stderr.slice(-5000));
        assert.ok(YAML.parse(result.stdout, { logLevel: 'silent' }).some(r => r.id === 'llm-pi-ai' && r.config.providers?.[providerId(providers[0], 'openai-chat')]));
        // Explicitly reject ultra-only/default-ultra before both disk and journal changes.
        const before = fs.readFileSync(base.config), journal = fs.readFileSync(native.fields.file);
        providers[0].models[0].efforts = ['ultra']; providers[0].models[0].defaultEffort = 'ultra';
        assert.throws(() => native.sync('dsh'), /思考档位/);
        assert.deepEqual(fs.readFileSync(base.config), before); assert.deepEqual(fs.readFileSync(native.fields.file), journal);
        providers[0].models[0].efforts = ['low']; providers[0].models[0].defaultEffort = 'low';
        put(path.join(env.DSH_HOME, 'desktop-link/web.json'), { coreVersion: expected, profile: 'headless' });
        native.sync('dsh', { account: 'api:contract', model: 'contract-model' });
      });
      if (harness === 'dsh') {
        providers[0].models[0].efforts = ['low']; providers[0].models[0].defaultEffort = 'low';
        put(path.join(env.DSH_HOME, 'desktop-link/web.json'), { coreVersion: expected, profile: 'headless' });
        native.sync('dsh', { account: 'api:contract', model: 'contract-model' });
      }
      if (name === 'opencode-v2') await check(name + ': native active credential service', async () => {
        const file = path.join(root, name, 'synthetic-credentials.json'), adapter = require('../../core/opencode-version.cjs');
        put(file, [{ id: 'cred_contract_a', integrationID: 'openai', label: 'Synthetic A', active: true, value: { type: 'key', key: 'synthetic-a' } },
          { id: 'cred_contract_b', integrationID: 'openai', label: 'Synthetic B', active: false, value: { type: 'key', key: 'synthetic-b' } }]);
        let r = await execute(launcher, ['auth', 'import', file, '--standalone'], f);
        assert.equal(r.code, 0, r.stderr.slice(-5000));
        const dir = path.join(env.XDG_DATA_HOME, 'opencode');
        const records = require('../../core/credential-status.cjs').inspectCredentials('opencode', dir, { native: true, launcher });
        assert.ok(records.rows.some(r => r.credentialId === 'cred_contract_a' && r.active));
        assert.ok(records.rows.some(r => r.credentialId === 'cred_contract_b' && !r.active));
        r = await execute(launcher, ['auth', 'switch', 'openai', 'cred_contract_b', '--standalone'], f);
        assert.equal(r.code, 0, r.stderr.slice(-5000));
        assert.ok(adapter.credentials(dir).find(r => r.id === 'cred_contract_b').active);
      });
      if (['dsh', 'pi', 'opencode'].includes(harness)) await check(name + ': native history continuation', async () => {
        const sid = harness === 'opencode' ? 'ses_asscontract1234567890123456' : '123e4567-e89b-42d3-a456-426614174000';
        const seed = { id: sid, cwd: work, title: 'Contract history', messages: [{ role: 'user', text: 'ASS_HISTORY_USER 中文' }, { role: 'assistant', text: 'ASS_HISTORY_ASSISTANT 😀' }], nativeVersion: name === 'opencode-v2' ? 2 : 1 };
        const out = codecs.encode(harness, seed); let file, resume;
        if (harness === 'dsh') { file = path.join(env.DSH_HOME, 'sessions', codecs.dshSlug(work), sid, 'session.v3.jsonl.zstd'); resume = ['--profile', 'headless', '--session-id', sid, '--json', 'ASS_CONTRACT_FOLLOWUP']; }
        else if (harness === 'pi') { file = path.join(env.PI_CODING_AGENT_DIR, 'sessions', codecs.slug(work), sid + '.jsonl'); resume = [...args.slice(0, -2), '--session', file, '-p', 'ASS_CONTRACT_FOLLOWUP']; }
        else { file = path.join(root, name, 'transfer.json'); resume = [...args, '--session', sid]; }
        put(file, out.bytes);
        if (harness === 'opencode') {
          const r = await execute(launcher, require('../../core/opencode-version.cjs').command(seed.nativeVersion, 'import', file), f);
          put(path.join(root, name, 'import.json'), r); assert.equal(r.code, 0, r.stderr.slice(-5000));
        }
        const start = server.requests.length, r = await execute(launcher, resume, f); put(path.join(root, name, 'history.json'), r);
        assert.equal(r.code, 0, r.stderr.slice(-5000)); assert.ok(server.requests.slice(start).some(r => JSON.stringify(r.body).includes('ASS_HISTORY_USER') && JSON.stringify(r.body).includes('ASS_HISTORY_ASSISTANT')), 'Native consumer did not use imported context');
        const nativeFile = harness === 'opencode' ? path.join(env.XDG_DATA_HOME, 'opencode/opencode.db')
          : harness === 'dsh' ? codecs.discover([{ harness, dir: env.DSH_HOME }]).rows.find(r => r.sessionId === sid)?.file : file;
        assert.ok(codecs.readConversation({ harness, file: nativeFile, sessionId: sid }).messages.some(m => m.text.includes('ASS_CONTRACT_OK')), 'Native append not readable by ASS');
        if (harness === 'opencode') {
          const backup = codecs.openCodeBundle(nativeFile, sid), backupFile = path.join(root, name, 'native-export.json');
          put(backupFile, backup);
          const r = await execute(launcher, require('../../core/opencode-version.cjs').command(seed.nativeVersion, 'delete', sid), f);
          assert.equal(r.code, 0); assert.throws(() => codecs.openCodeBundle(nativeFile, sid), /会话不存在/);
          const restored = await execute(launcher, require('../../core/opencode-version.cjs').command(seed.nativeVersion, 'import', backupFile), f);
          assert.equal(restored.code, 0, restored.stderr.slice(-5000)); assert.ok(codecs.openCodeBundle(nativeFile, sid).messages.length >= backup.messages.length);
        }
      });
      } catch (error) { results.push({ name, status: 'fail', message: 'Native fixture setup: ' + error.message }); }
    }
  } finally { server.server.close(); put(path.join(root, 'requests.json'), server.requests); put(path.join(root, 'results.json'), { platform: process.platform, pins, results }); }
  for (const r of results) console.log(`${r.status.toUpperCase()} ${r.name}${r.message ? ': ' + r.message : ''}`);
  console.log('Evidence: ' + root);
  if (results.some(r => r.status === 'fail')) process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
