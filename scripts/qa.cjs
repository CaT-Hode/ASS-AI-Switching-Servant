const { _electron: electron } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const output = path.join(process.env.LOCALAPPDATA, "ASS-validation", "ui");
fs.mkdirSync(output, { recursive: true });
(async () => {
  const data = fs.mkdtempSync(path.join(output, "profile-"));
  const codex = path.join(output, "codex");
  fs.mkdirSync(codex, { recursive: true });
  const cache = path.join(
    process.env.USERPROFILE,
    ".codex",
    "models_cache.json",
  );
  if (fs.existsSync(cache))
    fs.copyFileSync(cache, path.join(codex, "models_cache.json"));
  fs.writeFileSync(path.join(codex, "config.toml"), 'model = "gpt-6-astra"\n');
  const app = await electron.launch({
    args: [root, "--qa"],
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
    assert.ok(page.url().startsWith("file://"));
    const fake = {
      providers: [
        {
          id: "aimami_relay_sample",
          name: "示例供应商",
          baseUrl: "https://example.com/v1",
          apiKey: "synthetic-only",
          models: [
            { model: "gpt-6-astra" },
            { model: "claude-opus-5", wireApi: "anthropic" },
          ],
        },
      ],
    };
    await app.evaluate((_, raw) => global.assTest.store.import(raw), fake);
    await page.reload();
    await page.waitForSelector("h1");
    await page.screenshot({
      animations: "disabled",
      path: path.join(output, "overview.png"),
    });
    await page
      .getByRole("button", { name: "供应商与模型", exact: true })
      .click();
    await page.getByRole("button", { name: "示例供应商", exact: true }).click();
    await page
      .getByRole("button", { name: "配置模型 gpt-6-astra", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("slider", { name: "最高可选强度", exact: true })
      .fill("5");
    await dialog.getByLabel("上下文 tokens").fill("777000");
    await dialog
      .getByRole("slider", { name: "最低可选强度", exact: true })
      .fill("1");
    await dialog
      .getByRole("slider", { name: "默认思维强度", exact: true })
      .fill("4");
    await page.screenshot({
      animations: "disabled",
      path: path.join(output, "model-editor.png"),
    });
    await dialog.getByRole("button", { name: "保存模型" }).click();
    await dialog.waitFor({ state: "hidden" });
    const saved = await app.evaluate(
      () =>
        global.assTest.store.state.providers.find(
          (p) => p.id === "aimami_relay_sample",
        ).models[0],
    );
    assert.equal(saved.contextWindow, 777000);
    assert.equal(saved.defaultEffort, "ultra");
    assert.ok(saved.efforts.includes("max"));
    await page
      .getByRole("button", { name: "配置模型 claude-opus-5", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("slider", { name: "最高可选强度", exact: true })
        .inputValue(),
      "4",
    );
    await page
      .getByRole("slider", { name: "最高可选强度", exact: true })
      .fill("5");
    assert.equal(
      await page
        .getByRole("slider", { name: "最高可选强度", exact: true })
        .inputValue(),
      "4",
    );
    await page
      .getByRole("slider", { name: "最低可选强度", exact: true })
      .fill("2");
    await page.screenshot({
      animations: "disabled",
      path: path.join(output, "nongpt-range.png"),
    });
    await page.getByRole("button", { name: "保存模型" }).click();
    await page.getByRole("button", { name: "供应商设置" }).click();
    await page.getByRole("button", { name: "余额接口", exact: true }).click();
    await page.getByLabel(/^余额接口预设/).selectOption("custom");
    await page.getByLabel(/^余额接口路径/).fill("/balance");
    await page.getByLabel(/^余额字段路径/).fill("data.amount");
    await page.getByLabel(/^换算系数/).fill("0.01");
    await page.screenshot({
      animations: "disabled",
      path: path.join(output, "balance-editor.png"),
    });
    await page.getByRole("button", { name: "保存供应商" }).click();
    await page.getByRole("button", { name: "接入 Codex", exact: true }).click();
    await page
      .getByRole("button", { name: "已接入 Codex", exact: true })
      .waitFor();
    const config = fs.readFileSync(path.join(codex, "config.toml"), "utf8");
    assert.match(config, /25819/);
    await page.getByRole("button", { name: "连接诊断", exact: true }).click();
    await page.getByRole("button", { name: "断开 Codex" }).click();
    assert.ok(
      !fs
        .readFileSync(path.join(codex, "config.toml"), "utf8")
        .includes("25819"),
    );
    await page
      .getByRole("button", { name: "客户端与账户", exact: true })
      .click();
    await page
      .getByRole("button", { name: "添加授权账户", exact: true })
      .click();
    await page.getByLabel("账户名称", { exact: true }).fill("工作账户");
    await page.getByRole("button", { name: "创建账户", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.ok(
      await page
        .locator(".account-row.selected")
        .innerText()
        .then((t) => t.includes("工作账户")),
    );
    await page
      .getByRole("button", {
        name: /^Claude Code (已找到客户端|未检测到安装)$/,
      })
      .click();
    assert.ok((await page.locator(".account-row").count()) > 0);
    await page.screenshot({
      animations: "disabled",
      path: path.join(output, "clients.png"),
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1100, 780),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      animations: "disabled",
      path: path.join(output, "clients-1100.png"),
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "添加授权账户", exact: true })
      .click();
    const accountDialog = page.getByRole("dialog");
    await accountDialog.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)),
    );
    assert.equal(
      await accountDialog.evaluate((el) => getComputedStyle(el).transform),
      "none",
    );
    await page.keyboard.press("Escape");
    await accountDialog.waitFor({ state: "hidden" });
    assert.equal(
      await page
        .getByRole("button", { name: "添加授权账户", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    const settings = fs.readFileSync(path.join(data, "settings.json"), "utf8");
    assert.ok(!settings.includes("synthetic-only"));
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        consoleErrors: errors.length,
        ui: "passed",
        modelEditor: "passed",
        balanceSettings: "passed",
        attachDetach: "passed",
        encryptedAtRest: "passed",
        screenshots: output,
      }),
    );
  } finally {
    await app.evaluate(() => global.assTest.quit());
    await app.close().catch(() => {});
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
