// Packaged UI regression: renamed portable installs, synthetic keys and mocked HTTP.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { version } = require('../package.json'), root = path.resolve(__dirname, '..');
const out = path.join(process.env.LOCALAPPDATA, 'ASS-validation'); fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, 'dsh-discovery-'));
let app, page; const errors = [];
const call = (name, ...args) => page.evaluate(([name, args]) => window.ass.call(name, ...args), [name, args]);
(async () => {
  const env = { ...process.env, ASS_TEST_DATA: data, ASS_TEST_CODEX: path.join(data, 'codex'), ASS_TEST_PORT: '25846' }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: path.join(root, `release/v${version}/ASS-win32-x64/ASS.exe`), args: ['--qa'], env });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (['warning', 'error'].includes(m.type())) errors.push(m.text()); });
  await page.waitForSelector('h1');
  const seeded = await app.evaluate(async () => {
    const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
    const { harnesses } = global.assTest, home = harnesses.nativeHome;
    if (!home.startsWith(process.env.ASS_TEST_DATA + path.sep)) throw Error('Unexpected real native home');
    const install = path.join(home, 'relocated application 中文'), native = path.join(install, '.dsh');
    fs.mkdirSync(path.join(native, 'profiles/web'), { recursive: true });
    fs.writeFileSync(path.join(install, 'dsh.cmd'), '@echo off\r\nset "DSH_HOME=%~dp0.dsh"\r\n');
    fs.writeFileSync(path.join(native, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: synthetic-dsh-discovery-secret\n');
    fs.writeFileSync(path.join(native, 'profiles/web/cordis.patch.yml'), '[]\n');
    harnesses.state.executables.dsh = install; harnesses.save();
    global.assTest.setFetch(async () => new Response('{}', { status: 403 }));
    await global.assTest.syncNativeSuppliers();
    return { install, native, auth: path.join(native, '.credentials.yaml') };
  });
  const state = await call('snapshot'), client = state.harnesses.clients.find(c => c.id === 'dsh');
  assert.ok(client.accounts.some(a => a.kind === 'native' && a.ready && a.nativeDir === seeded.native));
  assert.equal(JSON.stringify(state).includes('synthetic-dsh-discovery-secret'), false);
  await page.getByRole('button', { name: '客户端与账户', exact: true }).click();
  await page.locator('.client-list .client-select').filter({ hasText: 'DeepSeek Harness' }).click();
  const panel = page.getByRole('region', { name: 'DeepSeek Harness 账户管理' });
  await panel.getByText('API Key', { exact: true }).first().waitFor();
  await panel.locator('.client-settings > summary').click();
  await panel.locator('.credential-sources code').getByText(seeded.auth, { exact: true }).waitFor();
  await page.screenshot({ path: path.join(out, 'dsh-portable-discovery.png'), animations: 'disabled' });
  const next = await app.evaluate((_, install) => {
    const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path'), dir = path.join(install, 'moved data');
    fs.mkdirSync(path.join(dir, 'profiles/web'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: synthetic-dsh-discovery-secret\n');
    fs.writeFileSync(path.join(dir, 'profiles/web/cordis.patch.yml'), '[]\n');
    fs.writeFileSync(path.join(install, 'dsh.cmd'), `set "DSH_HOME=${dir}"\r\n`); return dir;
  }, seeded.install);
  const updated = (await call('snapshot')).harnesses.clients.find(c => c.id === 'dsh');
  assert.ok(updated.accounts.some(a => a.kind === 'native' && a.nativeDir === next));
  assert.ok(!updated.accounts.some(a => a.kind === 'native' && a.nativeDir === seeded.native));
  await panel.locator('.credential-sources code').getByText(path.join(next, '.credentials.yaml'), { exact: true }).waitFor();
  const integrity = await app.evaluate((_, native) => {
    const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
    return fs.readFileSync(path.join(native, '.credentials.yaml'), 'utf8') === 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: synthetic-dsh-discovery-secret\n' &&
      fs.readFileSync(path.join(native, 'profiles/web/cordis.patch.yml'), 'utf8') === '[]\n';
  }, seeded.native);
  assert.ok(integrity); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ version, portableOfficialAccount: true, sourcePathVisible: true, launcherEditRefresh: true, syntheticNativeFilesUnchanged: true, secretsInSnapshot: false, pageErrors: 0 }));
})().catch(async error => { if (page) await page.screenshot({ path: path.join(out, 'dsh-discovery-failure.png'), animations: 'disabled' }).catch(() => {}); console.error(error.stack); process.exitCode = 1; })
  .finally(async () => { if (app) { await app.evaluate(() => global.assTest.quit()).catch(() => {}); await app.close().catch(() => {}); } });
