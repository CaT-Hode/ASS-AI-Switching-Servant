// Tests the packaged Windows executable with a fresh, disposable profile.
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const { version } = require("../package.json");
const output = path.join(process.env.LOCALAPPDATA, "ASS-validation");
fs.mkdirSync(output, { recursive: true });
const data = fs.mkdtempSync(path.join(output, "packaged-"));
const codex = path.join(data, "codex");
fs.mkdirSync(codex);
(async () => {
  const app = await electron.launch({
    executablePath: path.join(
      root,
      "release",
      "v" + version,
      "ASS-win32-x64",
      "ASS.exe",
    ),
    args: ["--qa"],
    env: {
      ...process.env,
      ASS_TEST_DATA: data,
      ASS_TEST_CODEX: codex,
      ASS_TEST_PORT: "25820",
    },
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
    await page.waitForSelector("h1");
    assert.equal(await page.title(), "ASS");
    const state = await app.evaluate(() => global.assTest.snapshot());
    assert.equal(state.providers.length, 0);
    assert.equal(state.harnesses.clients.length, 5);
    assert.equal(state.service.running, false);
    assert.equal(state.encrypted, true);
    assert.equal(state.authReady, false);
    assert.equal(state.codex.attached, false);
    assert.equal(state.startupError, "");
    assert.equal(state.updates.automatic, true);
    assert.equal(state.updates.status, "idle");
    await page.getByRole("button", { name: "关于 ASS", exact: true }).click();
    await page.locator(".ass-wordmark").waitFor();
    assert.equal(await page.locator(".ass-brand-hero p").textContent(), "Agent-Switching-Servant");
    assert.equal(await app.evaluate(({ app }) => app.getName()), "ASS");
    assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), data);
    assert.equal(await page.locator("vite-error-overlay").count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: path.join(output, "agent-switching-servant-about.png"), animations: "disabled" });
    assert.equal(await page.getByRole("switch", { name: "自动检查更新", exact: true }).isChecked(), true);
    await page
      .getByRole("button", { name: "客户端与账户", exact: true })
      .click();
    if (!(await page.getByRole("button", { name: "pi", exact: true }).isVisible()))
      await page.locator(".more-clients > summary").click();
    await page
      .getByRole("button", { name: "pi", exact: true })
      .click();
    await page
      .locator(".pi-import > summary")
      .waitFor();
    assert.equal(fs.existsSync(path.join(codex, "config.toml")), false);
    assert.equal(await page.getByRole("button", { name: "接入 Codex", exact: true }).count(), 0);
    assert.equal(await page.locator('.client-list').getByRole('switch').count(), 0);
    assert.equal(await page.locator('.client-panel .client-heading').getByRole('switch').count(), 1);
    const toggle = page.getByRole("switch", { name: "pi ASS 接入", exact: true });
    assert.equal(await toggle.isChecked(), false);
    await toggle.click();
    assert.equal(await page.getByRole("dialog").getByRole("button").count(), 2);
    assert.equal(await page.getByRole("dialog").getByRole("checkbox").count(), 0);
    assert.equal(await page.getByRole("dialog").getByRole("radio").count(), 0);
    assert.equal(await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await toggle.isChecked(), false);
    assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
    await toggle.click();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await toggle.isChecked(), false);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        packaged: "passed",
        emptyProfile: true,
        nativeWindow: true,
        oauthUI: true,
        fullName: "Agent-Switching-Servant",
        pageErrors: 0,
      }),
    );
  } finally {
    await app.evaluate(() => global.assTest.quit()).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
