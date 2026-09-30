// Real Electron UI checks with isolated synthetic transcripts and credentials.
const { _electron: electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite'), codecs = require('../core/project-codecs.cjs');
const root = path.resolve(__dirname, '..'), out = path.join(process.env.LOCALAPPDATA, 'ASS-validation'); fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, 'history-storage-')), home = path.join(data, 'test-home'), cwd = path.join(home, 'history-project'); fs.mkdirSync(cwd, { recursive: true });
const dirs = { codex: path.join(home, '.codex'), claude: path.join(home, '.claude') }, ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
function write(harness, id, folder, title, text) {
  const encoded = codecs.encode(harness, { id, cwd, title, createdAt: new Date().toISOString(), messages: [{ role: 'user', text, timestamp: new Date().toISOString() }, { role: 'assistant', text: 'Saved answer', timestamp: new Date().toISOString() }] });
  const file = path.join(dirs[harness], folder, id + '.jsonl'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, encoded.bytes); return file;
}
const file = write('codex', ids[0], 'sessions/project', 'Active storage example', 'Saved original body');
const archived = write('codex', ids[1], 'archived_sessions', 'Archived example', 'Archived body');
write('codex', ids[2], 'sessions/project', 'Residual example', 'Residual body');
fs.writeFileSync(path.join(dirs.codex, 'session_index.jsonl'), JSON.stringify({ id: ids[2], thread_name: 'Residual example' }) + '\n');
write('claude', crypto.randomUUID(), 'projects/project', 'Claude retained example', 'Claude saved body');
const db = new DatabaseSync(path.join(dirs.codex, 'state_5.sqlite'));
db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,name TEXT,cwd TEXT,rollout_path TEXT,archived INTEGER)');
const insert = db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)'); insert.run(ids[0], 'Active storage example', cwd, file, 0); insert.run(ids[1], 'Archived example', cwd, archived, 1); db.close();
let app, page; const errors = [];
const call = (name, ...args) => page.evaluate(([name, args]) => window.ass.call(name, ...args), [name, args]);
(async () => {
  const env = { ...process.env, ASS_TEST_DATA: data, ASS_TEST_CODEX: dirs.codex, ASS_TEST_PORT: '25848' }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...(process.env.ASS_QA_EXE ? { executablePath: process.env.ASS_QA_EXE } : {}), args: process.env.ASS_QA_EXE ? ['--qa'] : [root, '--qa'], env });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  await page.waitForSelector('h1');
  await app.evaluate(({ BrowserWindow }, dirs) => {
    BrowserWindow.getAllWindows()[0].setSize(1380, 930); global.assTest.setFetch(async () => new Response('{}', { status: 403 }));
    const m = global.assTest.harnesses, prior = m.snapshot.bind(m);
    m.snapshot = () => ({ ...prior(), clients: prior().clients.map(c => ({ ...c, detected: ['codex', 'claude'].includes(c.id) })) });
    m.conversationPlan = h => ({ dir: dirs[h], args: [], env: {}, cwd: dirs[h] });
    m.launchPlan = async () => ({ ok: true, message: 'Synthetic continuation opened' });
  }, dirs);
  await page.getByRole('button', { name: '对话管理', exact: true }).click();
  await page.locator('.project-thread-row').filter({ hasText: 'Active storage example' }).waitFor();
  assert.equal(await page.locator('.project-thread-row').count(), 1);
  await page.getByRole('button', { name: '归档及残留', exact: false }).click();
  await page.locator('.project-thread-row').filter({ hasText: 'Archived example' }).waitFor();
  assert.equal(await page.locator('.conversation-history-badge').filter({ hasText: '已归档' }).count(), 1);
  assert.equal(await page.locator('.conversation-history-badge').filter({ hasText: '索引缺失' }).count(), 1);
  await page.locator('.project-thread-main').filter({ hasText: 'Residual example' }).click();
  await page.locator('.conversation-source-note').getByText(/可能是删除后的残留/).waitFor();
  await page.screenshot({ path: path.join(out, 'history-inactive-sources.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '当前对话', exact: true }).click();
  await page.getByRole('button', { name: '历史与存储', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '历史与存储', exact: true }); await dialog.getByText('暂无保留副本', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '保留当前对话', exact: true }).click();
  await dialog.locator('.conversation-history-main').filter({ hasText: 'Active storage example' }).waitFor();
  assert.equal((await call('conversations-backups', { harness: 'codex' })).total, 1);
  await call('conversations-preserve', 'claude');
  const original = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, original.replace('Saved original body', 'Changed live body'));
  await dialog.getByRole('button', { name: '关闭历史与存储' }).click();
  await page.getByRole('button', { name: '历史与存储', exact: true }).click();
  await dialog.getByLabel('副本内容').getByText('Saved original body', { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel('副本内容').getByText('Changed live body', { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(out, 'history-storage-light.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: '清空本客户端副本' }).click();
  await page.getByRole('alertdialog', { name: '永久清理历史确认' }).getByRole('button', { name: '取消' }).click();
  assert.equal((await call('conversations-backups', { harness: 'codex' })).total, 1);
  await dialog.getByRole('button', { name: '关闭历史与存储' }).click();
  assert.ok(file.startsWith(data + path.sep)); fs.unlinkSync(file);
  await page.getByRole('button', { name: '历史与存储', exact: true }).click();
  await dialog.getByRole('button', { name: '恢复到当前客户端' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.conversation-history-preview footer button').disabled);
  await dialog.getByRole('button', { name: '恢复到当前客户端' }).click();
  await dialog.getByRole('status').getByText('已从保留副本恢复到当前客户端的本地目录。', { exact: true }).waitFor(); assert.ok(fs.existsSync(file));
  for (const [theme, width] of [['dark', 1100], ['light', 1380]]) {
    await call('ui-preferences', { theme }); await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900), width);
    // Windows rounds DIPs at fractional display scales (1100 -> 1101 at 225%).
    await page.waitForFunction(([theme, width]) => document.documentElement.dataset.theme === theme && Math.abs(innerWidth - width) <= 2, [theme, width]).catch(async error => {
      console.error(JSON.stringify({ requested: [theme, width], viewport: await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, width: innerWidth, height: innerHeight, scale: devicePixelRatio })),
        window: await app.evaluate(({ BrowserWindow }) => ({ size: BrowserWindow.getAllWindows()[0].getSize(), content: BrowserWindow.getAllWindows()[0].getContentSize() })) }));
      throw error;
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const bounds = await dialog.boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(bounds.y >= 0 && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
    await page.screenshot({ path: path.join(out, `history-storage-${theme}-${width}.png`), animations: 'disabled' });
  }
  await dialog.getByRole('button', { name: '清空本客户端副本' }).click();
  const confirmation = page.getByRole('alertdialog', { name: '永久清理历史确认' }); await confirmation.getByRole('button', { name: '永久清理', exact: true }).click();
  await dialog.getByText('暂无保留副本', { exact: true }).waitFor();
  assert.equal((await call('conversations-backups', { harness: 'codex' })).bytes, 0); assert.equal((await call('conversations-backups', { harness: 'claude' })).total, 1); assert.ok(fs.existsSync(file));
  await dialog.getByRole('button', { name: '关闭历史与存储' }).click();
  const row = page.locator('.project-thread-row').filter({ hasText: 'Active storage example' }); await row.waitFor();
  await row.getByRole('button', { name: '删除对话 Active storage example' }).click();
  await page.getByRole('dialog', { name: '删除本地记录确认' }).getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.project-thread-row')].some(el => el.textContent.includes('Active storage example')));
  await page.getByRole('button', { name: '历史与存储', exact: true }).click(); await dialog.getByRole('button', { name: '已删除备份', exact: true }).click();
  await dialog.locator('.conversation-history-trash article').waitFor();
  await dialog.locator('.conversation-history-trash article').getByRole('button', { name: '永久清理', exact: true }).click();
  await confirmation.getByRole('button', { name: '永久清理', exact: true }).click(); await dialog.getByText('暂无已删除备份', { exact: true }).waitFor();
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, archiveAndResidualLabels: true, backupPreview: true, restore: true, scopedCleanup: true, trashPurge: true, layouts: [1380, 1100], pageErrors: 0 }));
})().catch(async e => { if (page) await page.screenshot({ path: path.join(out, 'history-storage-failure.png'), animations: 'disabled' }).catch(() => {}); console.error(e.stack); process.exitCode = 1; })
  .finally(async () => { if (app) { await app.evaluate(() => global.assTest.quit()).catch(() => {}); await app.close().catch(() => {}); } });
