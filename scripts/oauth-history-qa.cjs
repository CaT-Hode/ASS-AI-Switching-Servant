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
    assert.equal(await app.evaluate(() => global.assTest.oauthHistory.entries.length), 1);
    // This change is picked up by the main-process timer, not a manual refresh.
    write("bob"); await card("bob").getByRole("button", { name: "当前账户", exact: true }).waitFor();
    assert.equal(await page.locator(".client-account-card").count(), 2);
    const bob = fs.readFileSync(auth, "utf8");
    await card("alice").getByRole("button", { name: "切换账户", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await page.screenshot({ path: path.join(out, "oauth-switch-confirm.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal(fs.readFileSync(auth, "utf8"), bob);
    await card("alice").getByRole("button", { name: "切换账户", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "确定", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(JSON.parse(fs.readFileSync(auth, "utf8")), JSON.parse(first));
    await card("alice").getByRole("button", { name: "当前账户", exact: true }).waitFor();
    write("alice", "rotated");
    await page.waitForFunction(async () => (await window.ass.call("snapshot")).harnesses.clients.find((c) => c.id === "codex").accounts.filter((a) => a.oauthRecordId).length === 2);
    // Wait for the main timer to persist the new refresh token without exposing it.
    for (let i = 0; i < 8; i++) {
      if (await app.evaluate(() => global.assTest.oauthHistory.entries.some((e) => e.grant.refresh_token.endsWith("rotated")))) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(await app.evaluate(() => global.assTest.oauthHistory.entries.length), 2);
    assert.equal(await app.evaluate(() => global.assTest.oauthHistory.entries.some((e) => e.grant.refresh_token.endsWith("rotated"))), true);
    const snapshot = JSON.stringify(await call("snapshot"));
    assert.ok(!snapshot.includes("synthetic-private-refresh") && !snapshot.includes("header."));
    assert.ok(!fs.readFileSync(path.join(data, "oauth-history.enc.json"), "utf8").includes("alice@example.test"));
    await page.screenshot({ path: path.join(out, "oauth-history-accounts.png"), animations: "disabled" });
    await stop(); await start();
    await card("alice").getByRole("button", { name: "当前账户", exact: true }).waitFor();
    assert.equal(await app.evaluate(() => global.assTest.oauthHistory.entries.length), 2);
    await card("bob").getByRole("button", { name: "切换账户", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "确定", exact: true }).click();
    await card("bob").getByRole("button", { name: "当前账户", exact: true }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(auth)).tokens.refresh_token, "synthetic-private-refresh-bob1");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, data, checks: ["background OAuth change detection", "identity refresh deduplication", "cancel is read-only", "confirmed native switch", "DPAPI ciphertext and renderer secrecy", "restart history + switch", "no renderer errors"] }));
  } finally { await stop(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
