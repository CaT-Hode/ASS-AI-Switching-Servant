// Tests the packaged Windows executable with a fresh, disposable profile.
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const output = path.join(process.env.LOCALAPPDATA, "ASS-validation");
fs.mkdirSync(output, { recursive: true });
const data = fs.mkdtempSync(path.join(output, "packaged-"));
const codex = path.join(data, "codex");
fs.mkdirSync(codex);
(async () => {
  const app = await electron.launch({
    executablePath: path.join(root, "release", "ASS-win32-x64", "ASS.exe"),
    args: ["--qa"],
    env: { ...process.env, ASS_TEST_DATA: data, ASS_TEST_CODEX: codex },
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector("h1");
    assert.equal(await page.title(), "AI Switch Servant");
    const state = await app.evaluate(() => global.assTest.snapshot());
    assert.equal(state.providers.length, 0);
    assert.equal(state.harnesses.clients.length, 5);
    assert.equal(state.service.running, true);
    assert.equal(state.encrypted, true);
    assert.equal(state.authReady, false);
    assert.equal(state.codex.attached, false);
    assert.equal(state.startupError, "");
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
