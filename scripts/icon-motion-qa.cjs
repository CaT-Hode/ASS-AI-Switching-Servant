const { _electron: electron } = require("playwright");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), version = require("../package.json").version;
const out = path.join(process.env.LOCALAPPDATA, "ASS-validation", "v" + version);
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, "icons-")), codex = path.join(data, "codex");
const packaged = process.env.ASS_QA_PACKAGED === "1";
(async () => {
  const app = await electron.launch({ ...(packaged ? { executablePath: path.join(root, "release", "v" + version, "ASS-win32-x64/ASS.exe") } : {}),
    args: packaged ? ["--qa"] : [root, "--qa"], env: { ...process.env, ASS_TEST_DATA: data, ASS_TEST_CODEX: codex, ASS_TEST_PORT: "25829" }, timeout: 60000 });
  try {
    const page = await app.firstWindow(), errors = [], frames = {};
    page.on("pageerror", (e) => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: "no-preference" }); await page.waitForSelector("h1");
    await app.evaluate(() => {
      global.assTest.store.updateProvider({ id: "icons", name: "Icon Fixture", apiKey: "synthetic-key", baseUrl: "https://icons.example/v1",
        models: [{ model: "icon-model", wireApi: "openai-chat" }] });
      global.assTest.connections.onChange();
    });
    async function hoverFrames(button, name) {
      await page.mouse.move(480, 35);
      await button.hover();
      const count = await button.evaluate(async (node) => {
        const frames = [];
        for (let i = 0; i < 16; i++) {
          await new Promise(requestAnimationFrame);
          frames.push(JSON.stringify([...node.querySelectorAll("svg.lucide, svg.lucide > *")].map((s) => {
            const style = getComputedStyle(s); return [style.transform, style.d];
          })));
        }
        return new Set(frames).size;
      });
      assert.ok(count > 1, name + " should animate through different shapes"); frames[name] = count;
    }
    for (const name of ["路由总览", "供应商与模型", "客户端与账户", "连接诊断", "关于 ASS"]) {
      await hoverFrames(page.getByRole("button", { name, exact: true }), name);
    }
    const nav = page.getByRole("button", { name: "路由总览", exact: true });
    await nav.click();
    assert.equal(await nav.getAttribute("data-icon-pulse"), "true");
    await page.waitForFunction(() => !document.querySelector('[data-icon-pulse]'));
    await nav.press("Enter"); assert.equal(await nav.getAttribute("data-icon-pulse"), null, "keyboard does not trigger decorative pulse");
    await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
    await page.getByRole("button", { name: "查看 Icon Fixture 的模型", exact: true }).click();
    for (const [label, name] of [["模型详情 icon-model", "settings"], ["检测模型 icon-model", "zap"], ["删除模型 icon-model", "trash"]]) {
      await hoverFrames(page.getByRole("button", { name: label, exact: true }), name);
      if (name === "settings") assert.equal(await page.getByRole("button", { name: label, exact: true }).locator("circle").first().evaluate((s) => new DOMMatrix(getComputedStyle(s).transform).e < -4), true, "slider knobs must move inside the settings icon");
    }
    assert.equal(await page.getByRole("button", { name: "删除模型 icon-model", exact: true }).locator("path").first().evaluate((s) => new DOMMatrix(getComputedStyle(s).transform).b < -.15), true, "trash lid must lift/rotate, not just the whole button");
    await page.getByRole("button", { name: "删除模型 icon-model", exact: true }).hover();
    await page.screenshot({ path: path.join(out, "model-icons-hover.png") });
    await page.getByRole("button", { name: "删除模型 icon-model", exact: true }).click();
    assert.equal(await page.getByRole("dialog", { name: "删除此模型？", exact: true }).count(), 1, "animation must not delay the delete confirmation");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const settings = page.getByRole("button", { name: "模型详情 icon-model", exact: true });
    await settings.hover();
    assert.equal(await settings.locator("svg").evaluate((s) => getComputedStyle(s).transitionDuration), "0s");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, packaged, frames, errors, data }));
  } finally { await app.evaluate(() => global.assTest.quit()).catch(() => {}); await app.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
