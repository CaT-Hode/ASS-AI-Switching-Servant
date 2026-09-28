// Real Electron dialog checks. All accounts/files live under an isolated QA home.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), version = require("../package.json").version;
const out = path.join(process.env.LOCALAPPDATA, "ASS-validation", "v" + version);
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, "repair-")), codex = path.join(data, "codex");
fs.mkdirSync(codex); fs.writeFileSync(path.join(codex, "config.toml"), '# QA user content\n[features]\nkeep = true\n');
const packaged = process.env.ASS_QA_PACKAGED === "1";
(async () => {
  const app = await electron.launch({ ...(packaged ? { executablePath: path.join(root, "release", "v" + version, "ASS-win32-x64/ASS.exe") } : {}),
    args: packaged ? ["--qa"] : [root, "--qa"], env: { ...process.env, ASS_TEST_DATA: data, ASS_TEST_CODEX: codex, ASS_TEST_PORT: "25828" }, timeout: 60000 });
  try {
    const page = await app.firstWindow(), errors = [], checked = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector("h1");
    await app.evaluate(() => {
      const t = global.assTest;
      t.store.updateProvider({ id: "repair-fixture", name: "Repair Fixture", baseUrl: "https://repair-fixture.example/v1", apiKey: "synthetic-repair-key",
        models: [{ model: "fixture-model", wireApi: "openai-chat", defaultEffort: "high" }] });
      t.harnesses.setNativeVariant("kimi", "current");
    });
    await page.getByRole("button", { name: "客户端与账户", exact: true }).click();
    for (const id of ["dsh", "opencode", "pi", "kimi", "zcode", "codex", "claude"]) {
      const state = await app.evaluate(async ({ safeStorage }, id) => {
        const t = global.assTest, fs = process.getBuiltinModule("node:fs");
        const p = await t.connections.preview(id, true);
        await t.connections.apply({ ticket: p.ticket, mode: "safe", acknowledged: true });
        if (id === "codex") {
          fs.writeFileSync(t.config.file, fs.readFileSync(t.config.file, "utf8").replace("requires_openai_auth = true", "requires_openai_auth = false"));
        } else if (id === "claude") {
          const proxy = t.connections.proxyConfig, envelope = JSON.parse(fs.readFileSync(proxy.file));
          const saved = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.encrypted, "base64")));
          saved.clients.claude.providers[0].baseUrl = "https://changed-fixture.example/v1";
          fs.writeFileSync(proxy.file, JSON.stringify({ version: 1, encrypted: safeStorage.encryptString(JSON.stringify(saved)).toString("base64") }));
        } else {
          for (const file of t.nativeConfig.list([id])) {
            const before = fs.readFileSync(file, "utf8"), after = before.replaceAll("https://repair-fixture.example/v1", "https://changed-fixture.example/v1");
            if (before !== after) fs.writeFileSync(file, after);
          }
        }
        t.connections.onChange();
        return { name: t.harnesses.snapshot().clients.find((c) => c.id === id).name, error: t.connections.snapshot().clients[id].syncError };
      }, id);
      assert.ok(state.error, id + " must show the injected conflict");
      const client = page.locator('.client-select').and(page.getByRole("button", { name: state.name, exact: true }));
      if (!await client.isVisible()) await page.locator(".more-clients > summary").click();
      await client.click();
      const toggle = page.getByRole("switch", { name: state.name + " ASS 接入", exact: true });
      await toggle.click();
      const dialog = page.getByRole("dialog"), action = dialog.getByRole("button", { name: "一键修复", exact: true });
      await action.waitFor({ state: "visible" });
      await page.waitForFunction(() => !document.querySelector(".connection-repair")?.disabled);
      assert.match(await dialog.innerText(), /接入异常/);
      if (id === "dsh") {
        await page.screenshot({ path: path.join(out, "repair-dsh-dialog.png") });
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
        assert.ok(await app.evaluate(() => global.assTest.connections.snapshot().clients.dsh.syncError));
        await toggle.click(); await page.waitForFunction(() => !document.querySelector(".connection-repair")?.disabled);
      }
      await action.click(); await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(() => !document.querySelector('.connection-switch[data-error="true"]'));
      const result = await app.evaluate((_, id) => global.assTest.connections.snapshot().clients[id], id);
      assert.equal(result.syncError, ""); assert.equal(result.enabled, true); checked.push(id);
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(out, "repair-complete.png") });
    console.log(JSON.stringify({ ok: true, packaged, checked, errors, data }));
  } finally { await app.evaluate(() => global.assTest.quit()).catch(() => {}); await app.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
