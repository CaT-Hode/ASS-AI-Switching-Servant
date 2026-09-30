// Rendered desktop QA with synthetic sessions/credentials, not production data.
const { _electron: electron } = require('playwright'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const codecs = require('../core/project-codecs.cjs'), root = path.resolve(__dirname, '..');
const out = path.join(process.env.LOCALAPPDATA, 'ASS-validation'); fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, 'project-sync-')), home = path.join(data, 'test-home'), cwd = path.join(home, 'shared-project'), timestamp = new Date().toISOString(); fs.mkdirSync(cwd, { recursive: true });
const dirs = { codex: path.join(home, '.codex'), claude: path.join(home, '.claude'), pi: path.join(home, '.pi/agent'), dsh: path.join(home, '.dsh'), opencode: path.join(home, '.local/share/opencode') };
const write = (f, bytes) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, bytes); };
const sourceId = '123e4567-e89b-42d3-a456-426614174000', messages = [{ role: 'user', text: '统一项目内的历史讨论', timestamp }, { role: 'assistant', text: '实现方向、已有结论和项目上下文会随客户端切换保留。', timestamp }];
for (const h of ['codex', 'claude', 'pi', 'dsh']) {
  const encoded = codecs.encode(h, { id: sourceId, cwd, title: '共享项目讨论', messages, createdAt: timestamp });
  write(path.join(dirs[h], h === 'claude' ? 'projects' : 'sessions', 'project', h === 'dsh' ? sourceId + '/session.v3.jsonl.zstd' : sourceId + '.jsonl'), encoded.bytes);
}
fs.mkdirSync(dirs.opencode, { recursive: true });
const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(path.join(dirs.opencode, 'opencode.db'));
db.exec('CREATE TABLE session(id TEXT PRIMARY KEY,title TEXT,directory TEXT,time_created INTEGER,time_updated INTEGER,parent_id TEXT,version TEXT,project_id TEXT,slug TEXT); CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT)');
const bundle = JSON.parse(codecs.encode('opencode', { id: 'ses_fixture', cwd, title: 'OpenCode 历史', messages, createdAt: timestamp }).bytes);
db.prepare('INSERT INTO session VALUES(?,?,?,?,?,NULL,?,?,?)').run(bundle.info.id, bundle.info.title, cwd, Date.parse(timestamp), Date.parse(timestamp), '1.0', 'global', 'test');
for (const m of bundle.messages) { db.prepare('INSERT INTO message VALUES(?,?,?,?,?)').run(m.info.id, bundle.info.id, m.info.time.created, m.info.time.created, JSON.stringify(m.info)); for (const p of m.parts) db.prepare('INSERT INTO part VALUES(?,?,?,?,?,?)').run(p.id, m.info.id, bundle.info.id, m.info.time.created, m.info.time.created, JSON.stringify(p)); } db.close();
const jwt = (v) => 'header.' + Buffer.from(JSON.stringify(v)).toString('base64url') + '.signature';
write(path.join(dirs.codex, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: jwt({ exp: 2100000000, sub: 'fixture' }), id_token: jwt({ email: 'fixture@example.test' }), refresh_token: 'synthetic-current', account_id: 'fixture' } }));
write(path.join(dirs.claude, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'synthetic-current', refreshToken: 'synthetic-current-refresh', expiresAt: 2100000000000 } }));
let app, page; const errors = [];
const call = (name, ...args) => page.evaluate(([name, args]) => window.ass.call(name, ...args), [name, args]);
async function start() {
  const env = { ...process.env, ASS_TEST_DATA: data, ASS_TEST_CODEX: dirs.codex, ASS_TEST_PORT: '25849' }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...(process.env.ASS_QA_EXE ? { executablePath: process.env.ASS_QA_EXE } : {}), args: process.env.ASS_QA_EXE ? ['--qa'] : [root, '--qa'], env });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
  await page.waitForSelector('h1'); await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1520, 980); global.assTest.setFetch(async () => new Response('{}', { status: 403 }));
    const m = global.assTest.harnesses, previous = m.launcher.bind(m); m.launcher = (h) => ['codex', 'claude', 'pi', 'dsh', 'opencode'].includes(h) ? { ready: true, executable: 'synthetic.exe', args: [] } : previous(h);
    m.launchPlan = async (id, plan) => { global.assTest.projectPlan = { id, args: plan.args, dir: plan.dir, envHome: plan.env.CLAUDE_CONFIG_DIR || plan.env.PI_CODING_AGENT_DIR }; return { ok: true }; };
  }); await page.getByRole('button', { name: '对话管理', exact: true }).click();
}
async function close() { if (app) { await app.evaluate(() => global.assTest.quit()).catch(() => {}); await app.close().catch(() => {}); app = null; } }
async function launch(target) {
  await page.getByRole('group', { name: '续聊客户端' }).count().catch(() => 0);
  await page.locator('.conversation-tabs').getByRole('button', { name: target, exact: true }).click();
  await page.getByRole('button', { name: `在 ${target} 继续`, exact: true }).click(); await page.getByRole('dialog', { name: '跨客户端续聊确认' }).getByRole('button', { name: '确定', exact: true }).click();
  await page.getByText('已在当前客户端继续共享对话；已完成的新内容将自动同步。', { exact: true }).waitFor(); return app.evaluate(() => global.assTest.projectPlan);
}
(async () => {
  try {
    await start(); assert.match(await page.title(), /ASS/); assert.ok(await page.locator('body').innerText());
    await page.locator('.conversation-tabs button').first().waitFor();
    assert.deepEqual(await page.locator('.conversation-tabs button').allTextContents(), ['Codex', 'Claude Code', 'OpenCode', 'pi', 'DSH']);
    await page.getByRole('switch', { name: '项目同步', exact: true }).waitFor();
    assert.equal(await page.getByRole('switch', { name: '项目同步' }).getAttribute('aria-checked'), 'false');
    const discovered = await call('project-conversations-list'); assert.deepEqual(new Set(discovered.items[0].harnesses), new Set(codecs.HARNESSES));
    await page.getByRole('switch', { name: '项目同步', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="项目同步"]').getAttribute('aria-checked') === 'true');
    await page.locator('.project-shared-threads button').filter({ hasText: 'Codex' }).click(); await page.getByText('实现方向、已有结论和项目上下文会随客户端切换保留。', { exact: true }).waitFor();
    const cc = await launch('Claude Code'), pi = await launch('pi'), ccFile = cc.args[1], piFile = pi.args[1];
    assert.equal(cc.dir, dirs.claude); assert.equal(pi.dir, dirs.pi);
    const project = (await call('project-conversations-list')).items.find((p) => p.enabled);
    const routes = await app.evaluate((_, id) => global.assTest.projectConversations.project(id).threads.flatMap((t) => t.routes), project.id);
    assert.ok(routes.filter((r) => ['claude', 'pi'].includes(r.harness)).every((r) => r.mode === 'hardlink'));
    await call('ui-preferences', { theme: 'light' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light'); await page.screenshot({ path: path.join(out, 'project-sync-light.png'), animations: 'disabled' });
    let rows = codecs.lines(ccFile), parent = rows.filter((r) => r.uuid).at(-1).uuid, uid = crypto.randomUUID(), aid = crypto.randomUUID();
    fs.appendFileSync(ccFile, codecs.jsonl([{ type: 'user', sessionId: routes.find((r) => r.nativeFile === ccFile).sessionId, cwd, uuid: uid, parentUuid: parent, timestamp, message: { role: 'user', content: '在 CC 完成后端适配' } }, { type: 'assistant', sessionId: routes.find((r) => r.nativeFile === ccFile).sessionId, cwd, uuid: aid, parentUuid: uid, timestamp, message: { id: aid, role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'CC 分支：后端适配已完成。' }] } }]));
    rows = codecs.lines(piFile); uid = crypto.randomUUID();
    fs.appendFileSync(piFile, codecs.jsonl([{ type: 'message', id: uid, parentId: rows.at(-1).id, timestamp, message: { role: 'user', content: [{ type: 'text', text: '在 pi 同时完成前端' }] } }, { type: 'message', id: crypto.randomUUID(), parentId: uid, timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'pi 分支：前端改动独立保留。' }], stopReason: 'stop' } }]));
    await page.getByRole('button', { name: '同步当前项目', exact: true }).click(); await page.locator('.project-shared-threads button').filter({ hasText: '分支' }).waitFor();
    await page.locator('.project-shared-threads button').filter({ hasText: '分支' }).click(); await page.getByText('pi 分支：前端改动独立保留。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '在 pi 继续', exact: true }).click();
    await page.getByRole('dialog', { name: '跨客户端续聊确认' }).getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('dialog', { name: '跨客户端续聊确认' }).waitFor({ state: 'detached' });
    await call('ui-preferences', { theme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.waitForFunction(() => document.querySelector('.project-resume').getBoundingClientRect().bottom <= window.innerHeight);
    await page.screenshot({ path: path.join(out, 'project-sync-dark.png'), animations: 'disabled' });
    for (const width of [1280, 1100]) {
      await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 900), width);
      await page.waitForFunction((w) => {
        const r = document.querySelector('.project-resume').getBoundingClientRect();
        const detail = document.querySelector('.project-sync-layout .conversation-detail').getBoundingClientRect();
        const actions = document.querySelector('.project-sync-layout .conversation-detail-heading .actions').getBoundingClientRect();
        const labelsFit = [...document.querySelectorAll('.project-thread-main')].every((b) => {
          const bottom = b.getBoundingClientRect().bottom;
          return [...b.children].every((c) => c.getBoundingClientRect().bottom <= bottom);
        });
        return window.innerWidth === w && document.documentElement.scrollWidth <= window.innerWidth && r.right <= window.innerWidth && r.bottom <= window.innerHeight && actions.right <= detail.right && labelsFit;
      }, width);
    }
    await page.screenshot({ path: path.join(out, 'project-sync-compact.png'), animations: 'disabled' });
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    assert.equal((await call('project-conversations-threads', project.id)).branches, 1);
    assert.deepEqual(errors, []); await close(); await start(); await page.getByRole('switch', { name: '项目同步', exact: true }).waitFor();
    assert.equal((await call('project-conversations-threads', project.id)).branches, 1);
    await page.getByRole('switch', { name: '项目同步' }).click();
    await page.getByRole('dialog', { name: '关闭项目同步确认' }).getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.getByRole('switch', { name: '项目同步' }).getAttribute('aria-checked'), 'true');
    await page.getByRole('switch', { name: '项目同步' }).click();
    await page.getByRole('dialog', { name: '关闭项目同步确认' }).getByRole('button', { name: '确定', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="项目同步"]').getAttribute('aria-checked') === 'false');
    assert.ok(!fs.existsSync(ccFile)); assert.ok(!fs.existsSync(piFile));
    // Missing clients and detected-but-unsupported clients must not get tabs.
    await app.evaluate(() => {
      const m = global.assTest.harnesses, prior = m.snapshot.bind(m);
      m.snapshot = (options) => { const result = prior(options); return { ...result, clients: result.clients.map((c) =>
        ({ ...c, detected: ['codex', 'claude', 'kimi'].includes(c.id) })) }; };
    });
    await call('snapshot');
    await page.waitForFunction(() => document.querySelectorAll('.conversation-tabs button').length === 2);
    assert.deepEqual(await page.locator('.conversation-tabs button').allTextContents(), ['Codex', 'Claude Code']);
    console.log(JSON.stringify({ ok: true, data, browser: 'Browser plugin not available; Electron Playwright', viewport: '1520x980, 1280x900, 1100x900 desktop', checks: ['five native sources', 'opt-in project sync', 'current credential targets', 'hardlink handoff', 'CC + pi divergent branches', 'cancel resume', 'persistent project settings and history', 'light/dark rendered UI', 'no clipping or horizontal overflow', 'no renderer/console errors or framework overlay'], nativeInference: false }));
  } finally { await close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
