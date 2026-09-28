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
          frames.push(JSON.stringify([...node.querySelectorAll("svg[data-motion-icon] [data-part]")].map((s) => {
            const style = getComputedStyle(s); return [style.transform, style.opacity];
          })));
        }
        return new Set(frames).size;
      });
      assert.ok(count > 1, name + " should animate its own parts"); frames[name] = count;
      assert.equal(await button.locator("svg[data-motion-icon]").first().evaluate((s) => getComputedStyle(s).transform), "none", "outer icon remains stable");
    }
    for (const name of ["路由总览", "供应商与模型", "客户端与账户", "连接诊断", "关于 ASS"]) {
      await hoverFrames(page.getByRole("button", { name, exact: true }), name);
    }
    const nav = page.getByRole("button", { name: "路由总览", exact: true });
    await nav.click();
    await page.waitForFunction(() => !document.querySelector('[data-icon-animating]'));
    await nav.press("Enter"); assert.equal(await page.locator('[data-icon-animating]').count(), 0, "keyboard does not trigger decorative motion");
    await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
    await page.getByRole("button", { name: "查看 Icon Fixture 的模型", exact: true }).click();
    for (const [label, name] of [["模型详情 icon-model", "settings"], ["检测模型 icon-model", "zap"], ["删除模型 icon-model", "trash"]]) {
      await hoverFrames(page.getByRole("button", { name: label, exact: true }), name);
    }
    await page.getByRole("button", { name: "删除模型 icon-model", exact: true }).hover();
    await page.screenshot({ path: path.join(out, "model-icons-hover.png") });
    await page.getByRole("button", { name: "删除模型 icon-model", exact: true }).click();
    assert.equal(await page.getByRole("dialog", { name: "删除此模型？", exact: true }).count(), 1, "animation must not delay the delete confirmation");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const settings = page.getByRole("button", { name: "模型详情 icon-model", exact: true });
    await settings.hover();
    assert.equal(await settings.locator("svg").evaluate((s) => getComputedStyle(s).transitionDuration), "0s");
    assert.equal(await page.locator('[data-icon-animating]').count(), 0);
    await page.keyboard.press("Escape");
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    const theme = page.locator(".theme-toggle");
    const width = await theme.evaluate((b) => b.getBoundingClientRect().width);
    const choose = async (mode, x) => {
      await theme.click({ position: { x, y: 20 } });
      await page.waitForFunction((mode) => document.querySelector('.theme-toggle').dataset.mode === mode && !document.querySelector('.theme-toggle').hasAttribute('data-moving'), mode);
    };
    for (const [mode, x] of [["dark", width - 20], ["light", 20], ["system", width / 2], ["system", width / 2], ["dark", width - 20], ["dark", width - 20]]) {
      await choose(mode, x);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), mode, "click location is stable, not cyclic");
      assert.equal(await theme.locator('.theme-ripples i').evaluateAll((nodes) => nodes.every((n) => getComputedStyle(n).animationPlayState === 'running')), true);
      await theme.screenshot({ path: path.join(out, 'theme-' + mode + '.png') });
    }
    const eclipse = await theme.locator('.theme-eclipse-shadow').evaluate((node) => {
      const animation = node.getAnimations()[0]; animation.pause();
      return [0, 6000, 15600, 24000].map((time) => { animation.currentTime = time; return getComputedStyle(node).transform; });
    });
    assert.equal(new Set(eclipse).size, 3, "moon shadow follows a slow eclipse cycle");
    const thumb = await theme.locator('.theme-orbit').boundingBox();
    const travel = await theme.evaluate((n) => n.clientWidth - 38);
    await page.mouse.move(thumb.x + 16, thumb.y + 16); await page.mouse.down();
    await page.mouse.move(thumb.x + 16 - travel * .45, thumb.y + 16, { steps: 5 });
    const progress = () => theme.evaluate((n) => Number(n.style.getPropertyValue('--theme-progress')));
    assert.ok(Math.abs(await progress() - .55) < .03, "drag preserves grab offset");
    await page.mouse.move(thumb.x + 16 - travel * .2, thumb.y + 16, { steps: 4 });
    assert.ok(Math.abs(await progress() - .8) < .03, "direction reversal remains continuous");
    await page.keyboard.press('Escape'); await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.theme-toggle').hasAttribute('data-moving'));
    assert.equal(await progress(), 1, "cancelled drag restores committed mode");
    await page.getByRole('button', { name: '关于 ASS', exact: true }).click();
    const geometry = await page.evaluate(() => {
      const theme = document.querySelector('.theme-control').getBoundingClientRect(), version = document.querySelector('.brand .version-button').getBoundingClientRect();
      return { bottomGap: innerHeight - theme.bottom, versionTop: version.top, width: document.documentElement.scrollWidth, window: innerWidth,
        sidebarText: document.querySelector('.sidebar').textContent };
    });
    assert.ok(geometry.bottomGap < 24 && geometry.bottomGap > 0); assert.ok(geometry.versionTop < 110);
    assert.ok(!geometry.sidebarText.includes('检查更新')); assert.ok(geometry.width <= geometry.window);
    // Mock the OS boundary only inside this disposable process, not Windows.
    await app.evaluate(({ app }) => { global.loginItemCalls = []; app.setLoginItemSettings = (settings) => global.loginItemCalls.push(settings); });
    const startup = page.getByRole('switch', { name: '开机启动', exact: true });
    const wasOn = await startup.isChecked(); await startup.click();
    await page.waitForFunction((wasOn) => document.querySelector('[aria-label="开机启动"]').checked !== wasOn, wasOn);
    assert.equal(await app.evaluate(() => global.loginItemCalls.at(-1).openAtLogin), !wasOn);
    assert.equal(await startup.evaluate((n) => getComputedStyle(n).width), await page.getByRole('switch', { name: '自动检查更新', exact: true }).evaluate((n) => getComputedStyle(n).width));
    await page.screenshot({ path: path.join(out, 'about-dark.png') });
    await choose('light', 20); await page.screenshot({ path: path.join(out, 'about-light.png') });
    await choose('system', width / 2);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await theme.locator('.theme-ripples i').first().evaluate((n) => getComputedStyle(n).animationName), 'none');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, packaged, frames, eclipse, geometry, errors, data, screenshots: out }));
  } finally { await app.evaluate(() => global.assTest.quit()).catch(() => {}); await app.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
