// Electron + Windows DPAPI, synthetic OAuth only, no production-home writes.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), out = path.join(process.env.LOCALAPPDATA, "ASS-validation");
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, "oauth-history-")), home = path.join(data, "test-home"), codex = path.join(home, ".codex"), auth = path.join(codex, "auth.json");
fs.mkdirSync(codex, { recursive: true });
const jwt = (value) => "header." + Buffer.from(JSON.stringify(value)).toString("base64url") + ".signature";
const login = (user, refresh = "1") => ({ auth_mode: "chatgpt", tokens: {
  account_id: "qa-workspace", refresh_token: "synthetic-private-refresh-" + user + refresh,
  access_token: jwt({ exp: 2100000000, "https://api.openai.com/auth": { chatgpt_account_id: "qa-workspace", chatgpt_user_id: user } }),
  id_token: jwt({ email: user + "@example.test", "https://api.openai.com/auth": { chatgpt_account_id: "qa-workspace", chatgpt_user_id: user, chatgpt_plan_type: "pro" } }),
}, keep: "unrelated" });
const write = (user, refresh) => fs.writeFileSync(auth, JSON.stringify(login(user, refresh)));
write("alice");
const sessionId = "123e4567-e89b-12d3-a456-426614174000", workspace = path.join(home, "project"), cc = path.join(home, ".claude");
fs.mkdirSync(workspace, { recursive: true }); fs.mkdirSync(path.join(codex, "sessions/2026/09/30"), { recursive: true });
const codexSession = path.join(codex, `sessions/2026/09/30/rollout-2026-09-30T10-00-00-${sessionId}.jsonl`);
fs.writeFileSync(codexSession, [
  { type: "session_meta", payload: { id: sessionId, cwd: workspace, timestamp: "2026-09-30T00:00:00Z", model_provider: "openai" } },
  { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "保留项目的历史讨论" }] } },
  { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "这段对话在切换账户后仍然存在。\n实现记录与项目上下文已保存。" }] } },
].map(JSON.stringify).join("\n") + "\n");
const ccSession = path.join(cc, `projects/project/${sessionId}.jsonl`), ccAuth = path.join(cc, ".credentials.json"), ccMeta = path.join(home, ".claude.json");
fs.mkdirSync(path.dirname(ccSession), { recursive: true });
fs.writeFileSync(ccSession, [
  { type: "user", cwd: workspace, sessionId, uuid: "synthetic-user", message: { role: "user", content: "Claude Code 跨账户续聊" } },
  { type: "assistant", cwd: workspace, sessionId, message: { role: "assistant", model: "claude-sonnet", content: [{ type: "text", text: "OAuth 切换后，历史不随账户隐藏；继续使用当前登录。" }] } },
].map(JSON.stringify).join("\n") + "\n");
function writeCC(user) {
  fs.writeFileSync(ccAuth, JSON.stringify({ claudeAiOauth: { accessToken: "synthetic-" + user, refreshToken: "synthetic-cc-refresh-" + user,
    expiresAt: 2100000000000, accountId: user }, keep: "unrelated" }));
  fs.writeFileSync(ccMeta, JSON.stringify({ oauthAccount: { accountUuid: user, emailAddress: user + "@example.test" },
    projects: { [workspace]: { lastSessionId: sessionId, hasTrustDialogAccepted: true } }, theme: "dark" }));
}
writeCC("charlie");
let app, page; const errors = [];
async function start() {
  const env = { ...process.env, ASS_TEST_DATA: data, ASS_TEST_CODEX: codex, ASS_TEST_PORT: "25841" };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...(process.env.ASS_QA_EXE ? { executablePath: process.env.ASS_QA_EXE } : {}), args: process.env.ASS_QA_EXE ? ["--qa"] : [root, "--qa"], env });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector("h1");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1440, 980);
    global.assTest.setFetch(async () => new Response("{}", { status: 403 }));
    const t = global.assTest, r = t.restarter, exe = process.execPath;
    t.lifecycleFixture = { client: 'codex', stops: 0, launches: 0, rows: [{ pid: 900001, parentPid: 10, exe, created: '2026-09-30T02:00:00Z' }] };
    r.fileInfo = () => [1, 1]; r.ownerPid = 900999; r.wait = async () => {};
    r.adapter = { inventory: async (ids) => ({ apps: [{ id: t.lifecycleFixture.client, name: t.lifecycleFixture.client === 'codex' ? 'Codex 桌面端' : 'Claude 桌面端', exe }].filter((a) => ids.includes(a.id)), rows: t.lifecycleFixture.rows }),
      stop: async () => { t.lifecycleFixture.stops++; t.lifecycleFixture.rows = []; return { stopped: true }; },
      launch: async () => { t.lifecycleFixture.launches++; t.lifecycleFixture.rows = [{ pid: 900010 + t.lifecycleFixture.launches, parentPid: 10, exe, created: '2026-09-30T03:00:00Z' }]; return { launched: true }; } };
  });
  await page.getByRole("button", { name: "客户端与账户", exact: true }).click();
}
async function stop() { if (app) { const a = app; app = null; await a.evaluate(() => global.assTest.quit()).catch(() => {}); await a.close().catch(() => {}); } }
const call = (name, ...args) => page.evaluate(([name, args]) => window.ass.call(name, ...args), [name, args]);
const card = (user) => page.locator(".client-account-card").filter({ hasText: user + "@example.test" });
(async () => {
  try {
    await start(); await card("alice").getByRole("button", { name: "当前账户", exact: true }).waitFor();
    const first = fs.readFileSync(auth, "utf8");
    assert.equal(await app.evaluate(() => global.assTest.oauthHistory.entries.filter((e) => e.harness === "codex").length), 1);
    // This change is picked up by the main-process timer, not a manual refresh.
    write("bob"); await card("bob").getByRole("button", { name: "当前账户", exact: true }).waitFor();
    assert.equal(await page.locator(".client-account-card").count(), 2);
    const bob = fs.readFileSync(auth, "utf8");
    await card("alice").getByRole("button", { name: "切换账户", exact: true }).click();
    let dialog = page.getByRole("dialog");
    assert.equal(await dialog.getByRole('radio', { name: '仅切换账户', exact: true }).isChecked(), true);
    await dialog.getByRole('radio', { name: '强制关闭', exact: true }).check();
    await page.screenshot({ path: path.join(out, "oauth-switch-confirm.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal(fs.readFileSync(auth, "utf8"), bob);
    assert.equal(await app.evaluate(() => global.assTest.lifecycleFixture.stops), 0);
    await card("alice").getByRole("button", { name: "切换账户", exact: true }).click();
    dialog = page.getByRole("dialog");
    assert.equal(await dialog.getByRole('radio', { name: '仅切换账户', exact: true }).isChecked(), true);
    await dialog.getByRole('radio', { name: '强制关闭', exact: true }).check();
    await dialog.getByRole("button", { name: "确定", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(JSON.parse(fs.readFileSync(auth, "utf8")), JSON.parse(first));
    assert.equal(await app.evaluate(() => global.assTest.lifecycleFixture.stops), 1);
    assert.equal(await app.evaluate(() => global.assTest.lifecycleFixture.launches), 0);
    await card("alice").getByRole("button", { name: "当前账户", exact: true }).waitFor();
    assert.equal((await call("conversations-list", { harness: "codex" })).retained, 1);
    await page.getByRole("button", { name: "对话管理", exact: true }).click();
    await page.locator('.conversation-tabs').getByRole('button', { name: 'Codex', exact: true }).click();
    await page.getByRole("button", { name: /保留项目的历史讨论/ }).waitFor();
    await page.getByLabel("对话内容").getByText(/这段对话在切换账户后仍然存在/).waitFor();
    await page.getByRole("button", { name: "置顶对话", exact: true }).click();
    await page.getByRole("button", { name: "取消置顶对话", exact: true }).waitFor();
    await page.getByRole("searchbox", { name: "搜索对话" }).fill("不匹配的标题");
    await page.getByText("暂无对话", { exact: true }).waitFor();
    await page.getByRole("searchbox", { name: "搜索对话" }).fill("");
    await page.getByLabel("对话内容").getByText(/这段对话在切换账户后仍然存在/).waitFor();
    await page.screenshot({ path: path.join(out, "conversations-codex-light.png"), animations: "disabled" });
    await page.getByRole("button", { name: "客户端与账户", exact: true }).click();
    write("alice", "rotated");
    await page.waitForFunction(async () => (await window.ass.call("snapshot")).harnesses.clients.find((c) => c.id === "codex").accounts.filter((a) => a.oauthRecordId).length === 2);
    // Wait for the main timer to persist the new refresh token without exposing it.
    for (let i = 0; i < 8; i++) {
      if (await app.evaluate(() => global.assTest.oauthHistory.entries.some((e) => e.harness === "codex" && e.grant.refresh_token.endsWith("rotated")))) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(await app.evaluate(() => global.assTest.oauthHistory.entries.filter((e) => e.harness === "codex").length), 2);
    assert.equal(await app.evaluate(() => global.assTest.oauthHistory.entries.some((e) => e.harness === "codex" && e.grant.refresh_token.endsWith("rotated"))), true);
    const snapshot = JSON.stringify(await call("snapshot"));
    assert.ok(!snapshot.includes("synthetic-private-refresh") && !snapshot.includes("header."));
    assert.ok(!fs.readFileSync(path.join(data, "oauth-history.enc.json"), "utf8").includes("alice@example.test"));
    await page.screenshot({ path: path.join(out, "oauth-history-accounts.png"), animations: "disabled" });
    await stop(); await start();
    await card("alice").getByRole("button", { name: "当前账户", exact: true }).waitFor();
    assert.equal(await app.evaluate(() => global.assTest.oauthHistory.entries.filter((e) => e.harness === "codex").length), 2);
    await card("bob").getByRole("button", { name: "切换账户", exact: true }).click();
    await page.getByRole('dialog').getByRole('radio', { name: '强制重启', exact: true }).check();
    await page.getByRole("dialog").getByRole("button", { name: "确定", exact: true }).click();
    await card("bob").getByRole("button", { name: "当前账户", exact: true }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(auth)).tokens.refresh_token, "synthetic-private-refresh-bob1");
    assert.equal(await app.evaluate(() => global.assTest.lifecycleFixture.launches), 1);
    // Claude: native project index/trust stays intact and missing JSONL can be
    // recovered using the CURRENT login, not the transcript's former account.
    await page.getByRole("button", { name: "Claude Code", exact: true }).click();
    await app.evaluate(() => { global.assTest.lifecycleFixture.client = 'claude'; });
    await card("charlie").getByRole("button", { name: "当前账户", exact: true }).waitFor();
    writeCC("dana"); await card("dana").getByRole("button", { name: "当前账户", exact: true }).waitFor();
    const ccBefore = fs.readFileSync(ccSession);
    await card("charlie").getByRole("button", { name: "切换账户", exact: true }).click();
    await page.getByRole("dialog").getByRole('radio', { name: '仅切换账户', exact: true }).waitFor();
    await page.getByRole('dialog').getByRole('radio', { name: '强制关闭', exact: true }).check();
    await page.getByRole("dialog").getByRole("button", { name: "确定", exact: true }).click();
    await card("charlie").getByRole("button", { name: "当前账户", exact: true }).waitFor();
    assert.deepEqual(fs.readFileSync(ccSession), ccBefore);
    assert.equal(await app.evaluate(() => global.assTest.lifecycleFixture.launches), 1);
    assert.equal(await app.evaluate(() => global.assTest.lifecycleFixture.stops), 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(ccMeta)).projects, { [workspace]: { lastSessionId: sessionId, hasTrustDialogAccepted: true } });
    fs.unlinkSync(ccSession);
    await page.getByRole("button", { name: "查看保留的对话", exact: true }).click();
    await page.getByRole("button", { name: /Claude Code 跨账户续聊/ }).waitFor();
    await page.getByLabel("对话内容").getByText(/OAuth 切换后/).waitFor();
    await app.evaluate(() => {
      const manager = global.assTest.harnesses, previous = manager.launcher.bind(manager);
      manager.launcher = (id) => ["codex", "claude"].includes(id) ? { ready: true, executable: "synthetic.exe", args: [], kind: "exe", installed: true } : previous(id);
      manager.launchPlan = async (id, plan) => { global.assTest.resumed = { id, dir: plan.dir, args: plan.args, home: plan.env.CLAUDE_CONFIG_DIR, files: plan.files }; return { ok: true, message: "隔离续聊启动计划已验证" }; };
    });
    await call("ui-preferences", { theme: "dark" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    await page.getByRole("button", { name: "从副本继续", exact: true }).click();
    const resumeDialog = page.getByRole("dialog", { name: "继续对话确认" });
    await page.waitForFunction(() => document.querySelector('.conversation-resume-confirm button') === document.activeElement);
    await page.keyboard.press("Escape"); await resumeDialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "从副本继续", exact: true }).click();
    await page.screenshot({ path: path.join(out, "conversations-cc-dark.png"), animations: "disabled" });
    await page.getByRole("dialog", { name: "继续对话确认" }).getByRole("button", { name: "确定", exact: true }).click();
    await page.getByText("隔离续聊启动计划已验证", { exact: true }).waitFor();
    const resumed = await app.evaluate(() => global.assTest.resumed);
    assert.equal(resumed.home, cc); assert.equal(resumed.dir, cc); assert.deepEqual(resumed.files, []); assert.deepEqual(resumed.args, ["--resume", ccSession]);
    assert.deepEqual(fs.readFileSync(ccSession), ccBefore); assert.equal(JSON.parse(fs.readFileSync(ccAuth)).claudeAiOauth.accountId, "charlie");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, data, browser: "Browser plugin not available; Electron Playwright", checks: ["background OAuth change detection", "identity refresh deduplication", "cancel is read-only", "confirmed Codex + CC native switch", "DPAPI ciphertext and renderer secrecy", "restart history + switch", "search and pinned conversations", "missing CC JSONL recovery", "resume with current account", "desktop light/dark screenshots", "no renderer errors"] }));
  } finally { await stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
