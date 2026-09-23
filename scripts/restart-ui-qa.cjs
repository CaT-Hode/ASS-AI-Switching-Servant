// Native Electron confirmation flow, entirely synthetic process adapter.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), out = path.join(process.env.LOCALAPPDATA, "ASS-validation");
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, "restart-ui-")), codex = path.join(data, "codex"); fs.mkdirSync(codex);
fs.writeFileSync(path.join(codex, "auth.json"), JSON.stringify({ tokens: { access_token: "synthetic-access", refresh_token: "synthetic-refresh" } }));
fs.writeFileSync(path.join(codex, "config.toml"), 'model = "fixture"\n');
(async () => {
  const env = { ...process.env, ASS_TEST_DATA: data, ASS_TEST_CODEX: codex, ASS_TEST_PORT: "25842" }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ ...(process.env.ASS_QA_EXE ? { executablePath: process.env.ASS_QA_EXE } : {}), args: process.env.ASS_QA_EXE ? ["--qa"] : [root, "--qa"], env });
  try {
    const page = await app.firstWindow(), errors = []; page.setDefaultTimeout(15000); page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector("h1");
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1440, 940);
      const t = global.assTest, r = t.restarter;
      const exe = process.execPath; // Fixture path is metadata only. Adapter never executes it.
      const application = { id: "codex", name: "Codex 桌面端", exe, aumid: "OpenAI.Codex_fixture!App" };
      t.restartFixture = { stops: 0, launches: 0, rows: [{ pid: 900001, parentPid: 10, exe, created: "2026-09-23T02:00:00Z" }] };
      r.fileInfo = () => [1, 1]; r.ownerPid = 900999; r.wait = async () => {};
      r.adapter = {
        inventory: async () => ({ apps: [application], rows: t.restartFixture.rows }),
        stop: async () => { t.restartFixture.stops++; t.restartFixture.rows = []; return { stopped: true }; },
        launch: async () => { t.restartFixture.launches++; t.restartFixture.rows = [{ pid: 900010 + t.restartFixture.launches, parentPid: 10, exe, created: "2026-09-23T03:00:00Z" }]; return { launched: true }; },
      };
      t.setFetch(async () => Response.json({}));
    });
    const call = (name, ...args) => page.evaluate(([name, args]) => window.ass.call(name, ...args), [name, args]);
    await call("save-provider", { name: "fixture", baseUrl: "https://example.test/v1", apiKey: "synthetic-key", models: [{ model: "fixture", wireApi: "openai-responses" }] });
    await page.getByRole("button", { name: "客户端与账户", exact: true }).click();
    const toggle = page.getByRole("switch", { name: "Codex ASS 接入", exact: true });
    const dialog = page.getByRole("dialog"), checkbox = dialog.getByRole("checkbox", { name: "立即重启 Codex 桌面端", exact: true });
    await toggle.click(); await checkbox.waitFor(); assert.equal(await checkbox.isChecked(), false);
    await dialog.getByRole("button", { name: "确定", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal(await app.evaluate(() => global.assTest.restartFixture.stops), 0);
    await toggle.click(); await checkbox.check();
    await page.screenshot({ path: path.join(out, "restart-on-injection-confirm.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal(await app.evaluate(() => global.assTest.restartFixture.stops), 0);
    assert.equal((await call("snapshot")).connections.clients.codex.enabled, true);
    await toggle.click(); await checkbox.waitFor(); assert.equal(await checkbox.isChecked(), false); await checkbox.check();
    await dialog.getByRole("button", { name: "确定", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal((await call("snapshot")).connections.clients.codex.enabled, false);
    assert.equal(await app.evaluate(() => global.assTest.restartFixture.launches), 1);
    await toggle.click(); await checkbox.waitFor(); await checkbox.check();
    await dialog.getByRole("button", { name: "确定", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal((await call("snapshot")).connections.clients.codex.enabled, true);
    assert.equal(await app.evaluate(() => global.assTest.restartFixture.launches), 2);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, defaultNoRestart: true, cancelNoMutation: true, optInEnableAndDisable: true, selectionNotPersisted: true, realProcessesTouched: false, pageErrors: 0 }));
  } catch (error) {
    const page = app.windows()[0];
    if (page) {
      await page.screenshot({ path: path.join(out, "restart-ui-failure.png") }).catch(() => {});
      console.error("Confirmation:", await page.getByRole("dialog").allTextContents().catch(() => []));
    }
    throw error;
  } finally { await app.evaluate(() => global.assTest.quit()).catch(() => {}); await app.close().catch(() => {}); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
