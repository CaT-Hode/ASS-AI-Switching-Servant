// Synthetic upstream only; independent encrypted profile and no real clients restarted.
const { _electron } = require("playwright");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), out = path.join(process.env.LOCALAPPDATA, "ASS-validation");
const data = fs.mkdtempSync(path.join(out, "protocol-ui-")), codex = path.join(data, "codex");
fs.mkdirSync(codex); fs.writeFileSync(path.join(codex, "config.toml"), 'model = "official-original"\n');
const auth = '{"tokens":{"access_token":"synthetic-official"}}'; fs.writeFileSync(path.join(codex, "auth.json"), auth);
// Exercise the production version gate with a Windows shim, not a test bypass.
const claudeFixture = path.join(data, "launcher with spaces", "claude.cmd");
const claudeLauncher = process.env.ASS_QA_CLAUDE_ENTRY || claudeFixture;
fs.mkdirSync(path.dirname(claudeFixture), { recursive: true });
const writeClaudeVersion = version => fs.writeFileSync(claudeFixture, `@echo off\r\nif not "%~1"=="--version" exit /b 9\r\necho ${version} ^(Claude Code^)\r\n`);
writeClaudeVersion("2.1.283");
let app, page; const errors = [];
const call = (name, ...args) => page.evaluate(([name, args]) => window.ass.call(name, ...args), [name, args]);
async function start() {
  app = await _electron.launch({ ...(process.env.ASS_QA_EXE ? { executablePath: process.env.ASS_QA_EXE } : {}),
    args: process.env.ASS_QA_EXE ? ["--qa"] : [root, "--qa"], env: { ...process.env, ASS_TEST_DATA: data, ASS_TEST_CODEX: codex, ASS_TEST_PORT: "25839" } });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
  await page.waitForSelector("h1");
  await app.evaluate((_, file) => global.assTest.harnesses.setExecutable("claude", file), claudeLauncher);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1420, 960);
    global.assTest.setFetch(async (url, init) => {
      if (!init?.body) return Response.json({ data: [] });
      const body = JSON.parse(init.body), protocol = url.endsWith("responses") ? "responses" : url.endsWith("messages") ? "messages" : "chat";
      if (body.model !== "dual" && protocol !== "chat") return Response.json({}, { status: 405 });
      const events = protocol === "responses" ? [{ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }] } }]
        : protocol === "messages" ? [{ type: "content_block_delta", delta: { type: "text_delta", text: "OK" } }, { type: "message_stop" }]
        : [{ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }] }];
      return new Response(events.map(e => "data: " + JSON.stringify(e) + "\n\n").join(""));
    });
  });
}
async function stop() { await app?.evaluate(() => global.assTest.quit()).catch(() => {}); await app?.close().catch(() => {}); app = null; }
async function choose(name) {
  await page.getByRole("button", { name: "客户端与账户", exact: true }).click();
  const button = page.locator(".client-list").getByRole("button", { name, exact: true });
  if (!(await button.isVisible())) await page.locator(".more-clients > summary").click();
  await button.click();
}
async function confirm(button) {
  await button.click(); const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
(async () => {
  try {
    await start(); await choose("Codex");
    assert.equal(await page.getByRole("switch", { name: "Codex 无账号启动" }).isDisabled(), true);
    await call("save-provider", { id: "fixture", name: "协议测试", baseUrl: "https://fixture.test/v1", apiKey: "synthetic-api", models: [{ model: "dual", wireApi: "openai-chat" }, { model: "chat-only", wireApi: "anthropic" }] });
    // Creation checks run in the background; injection itself must never wait for them.
    await app.evaluate(() => global.assTest.prepareProtocols("codex"));
    await confirm(page.getByRole("switch", { name: "Codex ASS 接入", exact: true }));
    await confirm(page.getByRole("switch", { name: "Codex 无账号启动" }));
    let snapshot = await call("snapshot"); assert.equal(snapshot.connections.clients.codex.accountless, true);
    assert.equal(snapshot.harnesses.clients.find(c => c.id === "codex").injection.models[0].protocol, "openai-responses");
    await page.screenshot({ path: path.join(out, "accountless-codex-light.png") });
    await choose("Claude Code");
    await confirm(page.getByRole("switch", { name: "Claude Code ASS 接入", exact: true }));
    // Fail if QA ever bypasses this production check again. Only the test shim
    // is rewritten; the optional real installed launcher is read/started only.
    await app.evaluate((_, file) => global.assTest.harnesses.setExecutable("claude", file), claudeFixture);
    writeClaudeVersion("2.1.223");
    await assert.rejects(call("connection-preview", "claude", true, false, true), /2\.1\.242/);
    assert.equal((await call("snapshot")).connections.clients.claude.accountless, false);
    assert.ok(!fs.existsSync(path.join(data, "test-home/.claude/settings.json")));
    writeClaudeVersion("2.1.283");
    await app.evaluate((_, file) => global.assTest.harnesses.setExecutable("claude", file), claudeLauncher);
    await confirm(page.getByRole("switch", { name: "Claude Code 无账号启动" }));
    snapshot = await call("snapshot");
    assert.equal(snapshot.connections.clients.claude.runtimeStatus, "terminal-ready");
    await page.getByText("终端 claude 同样免登录 · ASS 需保持运行", { exact: true }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, "test-home/.claude/settings.json"))).env.ANTHROPIC_BASE_URL, "http://127.0.0.1:25839/clients/claude/models");
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, "test-home/.claude.json"))).hasCompletedOnboarding, true);
    assert.deepEqual(snapshot.harnesses.clients.find(c => c.id === "claude").injection.models.map(m => m.protocol), ["anthropic", "openai-chat"]);
    await page.locator(".client-provider summary").click();
    await page.screenshot({ path: path.join(out, "accountless-claude-protocols.png") });
    await stop(); await start();
    snapshot = await call("snapshot");
    assert.equal(snapshot.connections.clients.codex.accountless, true); assert.equal(snapshot.connections.clients.claude.accountless, true);
    assert.equal(Object.keys(snapshot.capabilities).length, 2);
    await choose("Codex"); await confirm(page.getByRole("switch", { name: "Codex 无账号启动" }));
    assert.equal((await call("snapshot")).connections.clients.codex.accountless, false);
    assert.equal((await call("snapshot")).connections.clients.claude.accountless, true);
    await choose("Claude Code"); await confirm(page.getByRole("switch", { name: "Claude Code 无账号启动" }));
    assert.equal((await call("snapshot")).connections.clients.claude.accountless, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, "test-home/.claude/settings.json"))), {});
    assert.equal(fs.readFileSync(path.join(codex, "auth.json"), "utf8"), auth);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, accountlessEligibility: true, productionVersionGate: true, oldVersionRejected: true,
      claudeLauncher, bothClients: true, automaticProtocols: true, restartPersistence: true, oauthPreserved: true, screenshots: out, errors }));
  } finally { await stop(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
