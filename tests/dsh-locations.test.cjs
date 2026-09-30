const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { locations: homes, declaredHome } = require('../core/dsh-locations.cjs');
const { HarnessManager } = require('../core/harnesses.cjs');
const { NativeConfig, locations: configLocation } = require('../core/native-config.cjs');
const { nativeOfficialProvider } = require('../core/native-official.cjs');
const { target } = require('../core/dsh-config.cjs');
const { discoverNative } = require('../core/credential-status.cjs');
const crypt = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ass-dsh-paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'user'), install = path.join(root, 'renamed app 中文'), data = path.join(root, 'ass-data');
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  const seed = (dir, secret = 'synthetic-dsh-key') => {
    write(path.join(dir, '.credentials.yaml'), `version: 1\nrefs:\n  DEEPSEEK_API_KEY: ${secret}\n`);
    write(path.join(dir, 'profiles/web/cordis.patch.yml'), '[]\n');
  };
  const file = path.join(install, 'dsh.cmd'), dir = path.join(install, '.dsh');
  write(file, '@echo off\r\nset "DSH_HOME=%~dp0.dsh"\r\n'); seed(dir);
  const manager = new HarnessManager(data, () => ({ providers: [] }), [], path.join(home, '.codex'), { home, env: {}, launchEnv: {} });
  manager.state.executables.dsh = install;
  manager.options.nativeConfig = new NativeConfig(data, crypt, manager);
  return { root, home, install, file, dir, data, manager, write, seed };
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
test('a relocated portable launcher discovers official DSH API and uses the same home in config, history and continuation', t => {
  const f = fixture(t), auth = path.join(f.dir, '.credentials.yaml'), config = path.join(f.dir, 'profiles/web/cordis.patch.yml');
  f.seed(path.join(f.home, '.dsh'), 'synthetic-other-key');
  const before = [hash(auth), hash(config)], client = f.manager.snapshot().clients.find(c => c.id === 'dsh');
  const account = client.accounts.find(a => a.nativeDir === f.dir);
  assert.ok(account?.ready); assert.equal(account.provider, 'DEEPSEEK_API_KEY'); assert.equal(account.sourcePath, auth);
  assert.equal(nativeOfficialProvider(client, account, { env: {}, home: f.home }).baseUrl, 'https://api.deepseek.com');
  assert.equal(configLocation('dsh', f.manager).config, config);
  assert.equal(f.manager.discoverNativeApis('dsh').activeApis.length, 1);
  assert.ok(f.manager.conversationSources().some(s => s.harness === 'dsh' && s.dir === f.dir));
  assert.equal(f.manager.projectConversationPlan('dsh', f.install).env.DSH_HOME, f.dir);
  assert.deepEqual([hash(auth), hash(config)], before);
  assert.ok(!JSON.stringify(client).includes('synthetic-dsh-key'));
});
test('literal CMD, PowerShell and shell declarations expand only known directory variables', t => {
  const f = fixture(t), env = { USERPROFILE: f.home, HOME: f.home, CUSTOM_ROOT: f.install };
  const examples = [
    ['wrapper.cmd', 'set "DSH_HOME=%CUSTOM_ROOT%\\state"', path.join(f.install, 'state')],
    ['wrapper.ps1', '$env:DSH_HOME = "$PSScriptRoot/state"', path.join(f.install, 'state')],
    ['environment.ps1', '$env:DSH_HOME = "$env:USERPROFILE/custom"', path.join(f.home, 'custom')],
    ['wrapper.sh', 'export DSH_HOME="$HOME/custom"', path.join(f.home, 'custom')],
    ['literal.sh', `DSH_HOME='${f.install.replace(/\\/g, '/')}/state'`, path.join(f.install, 'state')],
  ];
  for (const [name, content, expected] of examples) {
    const file = path.join(f.install, name); f.write(file, content);
    assert.equal(declaredHome(file, f.home, env).dir, expected);
  }
});
test('explicit directories, guarded environment defaults and unconditional wrapper overrides keep their precedence', t => {
  const f = fixture(t), envHome = path.join(f.root, 'environment'), manual = path.join(f.root, 'manual'), launcher = f.manager.launcher('dsh');
  assert.equal(homes({ home: f.home, env: { DSH_HOME: envHome }, launcher }).dirs[0], f.dir);
  assert.equal(homes({ home: f.home, env: { DSH_HOME: envHome }, override: manual, launcher }).dirs[0], manual);
  f.write(f.file, '@if not defined DSH_HOME set "DSH_HOME=%~dp0.dsh"\r\n');
  const guarded = homes({ home: f.home, env: { DSH_HOME: envHome }, launcher });
  assert.equal(guarded.dirs[0], envHome); assert.equal(guarded.issue, '');
  f.write(f.file, '@if not defined DSH_HOME set "DSH_HOME=%~dp0.dsh"\r\n');
  assert.equal(homes({ home: f.home, env: {}, launcher }).dirs[0], f.dir);
});
test('installation-local state is a bounded fallback, unrelated folders and global npm shims use the standard home', t => {
  const f = fixture(t); f.write(f.file, '@echo off\r\n');
  assert.equal(f.manager.nativeLocations('dsh')[0], f.dir);
  const prefix = path.join(f.root, 'npm-prefix'), shim = path.join(prefix, 'dsh.cmd'); f.write(shim, '@echo off\r\n');
  f.manager.state.executables.dsh = shim;
  f.write(path.join(prefix, '.dsh/README.md'), 'unrelated folder');
  assert.deepEqual(f.manager.nativeLocations('dsh'), [path.join(f.home, '.dsh')]);
  f.seed(path.join(prefix, '.dsh'));
  assert.equal(f.manager.nativeLocations('dsh')[0], path.join(prefix, '.dsh'));
});
test('dynamic, incomplete and conflicting declarations are reported without executing or guessing a directory', t => {
  const f = fixture(t), marker = path.join(f.root, 'must-not-run');
  for (const content of ['set "DSH_HOME=%UNKNOWN_ROOT%\\state"', 'set "DSH_HOME=%~dp0one"\nset "DSH_HOME=%~dp0two"', `$env:DSH_HOME = $(New-Item '${marker}')`]) {
    const ext = content.startsWith('$env') ? '.ps1' : '.cmd', file = path.join(f.install, 'dynamic' + ext);
    f.write(file, content); f.manager.state.executables.dsh = file;
    assert.match(homes({ home: f.home, launcher: f.manager.launcher('dsh') }).issue, /无法静态确认/);
    assert.throws(() => configLocation('dsh', f.manager), /无法静态确认/);
    const scan = discoverNative('dsh', { home: f.home, launcher: f.manager.launcher('dsh') });
    assert.ok(scan.some(s => s.status === 'external' && /无法静态确认/.test(s.message)));
    assert.ok(!fs.existsSync(marker));
  }
});
test('a launcher edit or credential removal is reflected in the next snapshot without persisting an inferred override', t => {
  const f = fixture(t), next = path.join(f.install, 'new state'); f.seed(next);
  assert.ok(f.manager.snapshot().clients.find(c => c.id === 'dsh').accounts.some(a => a.nativeDir === f.dir));
  f.write(f.file, `set "DSH_HOME=${next}"\r\n`);
  const changed = f.manager.snapshot().clients.find(c => c.id === 'dsh');
  assert.ok(changed.accounts.some(a => a.nativeDir === next)); assert.ok(!changed.accounts.some(a => a.nativeDir === f.dir));
  assert.equal(f.manager.state.credentialHomes.dsh, undefined);
  fs.unlinkSync(path.join(next, '.credentials.yaml'));
  assert.ok(!f.manager.snapshot().clients.find(c => c.id === 'dsh').accounts.some(a => a.ready));
});
test('a selected non-web profile can be identified from its patch without a version marker', t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.dir, 'profiles/web/cordis.patch.yml'));
  f.write(path.join(f.dir, 'desktop-link/web.json'), JSON.stringify({ profile: 'headless' }));
  f.write(path.join(f.dir, 'profiles/headless/cordis.patch.yml'), '[]\n');
  assert.equal(target(f.dir).config, path.join(f.dir, 'profiles/headless/cordis.patch.yml'));
  assert.equal(target(f.dir).format, 'dsh-patch');
});
