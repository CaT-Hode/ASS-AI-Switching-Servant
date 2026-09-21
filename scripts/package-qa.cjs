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
    await page.waitForSelector("h1");
    assert.equal(await page.title(), "ASS · 模型随你切");
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
    await page.getByRole("heading", { name: "模型随你切，账户由你管。", exact: true }).waitFor();
    assert.equal(await page.getByRole("switch", { name: "自动检查更新", exact: true }).isChecked(), true);
    await page
      .getByRole("button", { name: "客户端与账户", exact: true })
      .click();
    await page
      .getByRole("button", { name: /^pi (已找到客户端|未检测到安装)$/ })
      .click();
    await page
      .getByRole("heading", { name: "从其他客户端导入 OAuth" })
      .waitFor();
    assert.equal(fs.existsSync(path.join(codex, "config.toml")), false);
    assert.equal(await page.getByRole("button", { name: "接入 Codex", exact: true }).count(), 0);
    const toggle = page.getByRole("switch", { name: "pi ASS 接入", exact: true });
    assert.equal(await toggle.isChecked(), false);
    await toggle.click();
    await page.getByRole("button", { name: "继续查看影响" }).click();
    assert.equal(await page.getByRole("button", { name: "确认开启接入", exact: true }).isDisabled(), true);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await toggle.isChecked(), false);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        packaged: "passed",
        emptyProfile: true,
        nativeWindow: true,
        oauthUI: true,
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
