// Actual Electron renderer/restart using only isolated synthetic accounts.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const out = path.join(process.env.LOCALAPPDATA, "ASS-validation", "v0.1.24");
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, "profile-")), codex = path.join(data, "codex"), home = path.join(data, "test-home");
const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
put(path.join(codex, "models_cache.json"), { models: [{ slug: "gpt-fixture", display_name: "GPT Fixture", context_window: 128000 }] });
put(path.join(home, ".dsh", ".credentials.yaml"), { version: 1, refs: { DEEPSEEK_API_KEY: "synthetic-deepseek-key" } });
put(path.join(home, ".local", "share", "opencode", "auth.json"), { "opencode-go": { type: "api", key: "synthetic-go-key" } });
const packaged = process.env.ASS_QA_PACKAGED === "1";
const launch = () => electron.launch({ ...(packaged ? { executablePath: path.join(root, "release", "v" + require("../package.json").version, "ASS-win32-x64", "ASS.exe") } : {}),
  args: packaged ? ["--qa"] : [root, "--qa"], env: { ...process.env, ASS_TEST_DATA: data, ASS_TEST_CODEX: codex, ASS_TEST_PORT: "25827" }, timeout: 60000 });
(async () => {
  let app = await launch();
  try {
    let page = await app.firstWindow(); const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    await page.waitForSelector("h1");
    const promotion = await app.evaluate(async () => {
      const t = global.assTest;
      t.setFetch(async (url, init) => {
        if (url.endsWith("/user/balance")) return Response.json({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "120.5" }] });
        if (url.endsWith("/usage")) return Response.json({ usage: { rolling: { percent: 12, status: "ok" }, weekly: { percent: 28, status: "ok" } } });
        if (url.endsWith("/models")) return Response.json({ data: [{ id: url.includes("deepseek") ? "deepseek-chat" : "glm-test", context_length: 131072 }] });
        const body = JSON.parse(init.body);
        await new Promise((r) => setTimeout(r, 35));
        return new Response(new ReadableStream({ async start(c) {
          const send = (value) => c.enqueue(new TextEncoder().encode("data: " + JSON.stringify(value) + "\n\n"));
          send({ choices: [{ delta: { role: "assistant" } }] });
          await new Promise((r) => setTimeout(r, 45));
          send({ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 2 } }); c.close();
        } }), { headers: { "content-type": "text/event-stream" } });
      });
      await t.syncNativeSuppliers();
      const s = t.snapshot();
      return { count: s.providers.length, names: s.providers.map((p) => p.name),
        claudeModels: s.harnesses.clients.find((c) => c.id === "claude").injection.models.length };
    });
    assert.equal(promotion.count, 2); assert.equal(promotion.claudeModels, 2);
    assert.equal(await page.locator(".theme-control button").count(), 1);
    await page.locator(".theme-toggle").press("Home");
    await page.locator(".theme-toggle").screenshot({ path: path.join(out, "theme-light.png") });
    await page.getByRole("button", { name: "切换为自动模式", exact: true }).click();
    const animation = await page.evaluate(async () => {
      const frames = [];
      for (let i = 0; i < 24; i++) {
        await new Promise(requestAnimationFrame);
        frames.push({ transform: getComputedStyle(document.querySelector(".theme-orbit")).transform,
          disc: getComputedStyle(document.querySelector(".theme-dawn-cut")).transform });
      }
      return { positions: new Set(frames.map((f) => f.transform)).size, shapes: new Set(frames.map((f) => f.disc)).size,
        first: frames[0], last: frames.at(-1) };
    });
    assert.ok(animation.positions > 1 && animation.shapes > 1, "sun/moon both move and morph between states: " + JSON.stringify(animation));
    await page.waitForFunction(() => Number(document.querySelector(".theme-toggle").style.getPropertyValue("--theme-progress")) === .5);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "system");
    await page.locator(".theme-toggle").screenshot({ path: path.join(out, "theme-auto.png") });
    await page.getByRole("button", { name: "切换为深色模式", exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector(".theme-toggle").style.getPropertyValue("--theme-progress")) === 1);
    const geometry = await page.locator(".theme-toggle").evaluate((button) => ({ width: button.getBoundingClientRect().width,
      parentWidth: button.parentElement.getBoundingClientRect().width, travel: button.clientWidth - 38,
      thumb: (() => { const r = button.querySelector(".theme-orbit").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })() }));
    assert.ok(Math.abs(geometry.width - geometry.parentWidth) < 2 && geometry.width > 150);
    const moonMatrix = await page.locator(".theme-orbit").evaluate((node) => { const m = new DOMMatrix(getComputedStyle(node).transform); return [m.b, m.c]; });
    assert.deepEqual(moonMatrix, [0, 0], "moon stays upright");
    await page.locator(".theme-toggle").screenshot({ path: path.join(out, "theme-dark.png") });
    const progress = () => page.locator(".theme-toggle").evaluate((b) => Number(b.style.getPropertyValue("--theme-progress")));
    await page.mouse.move(geometry.thumb.x, geometry.thumb.y); await page.mouse.down();
    await page.mouse.move(geometry.thumb.x - geometry.travel * .45, geometry.thumb.y, { steps: 6 });
    assert.ok(Math.abs(await progress() - .55) < .025, "drag is one-to-one with pointer");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "drag preview does not save half-finished theme");
    await page.locator(".theme-toggle").screenshot({ path: path.join(out, "theme-drag.png") });
    await page.mouse.move(geometry.thumb.x - geometry.travel * .2, geometry.thumb.y, { steps: 4 });
    await page.waitForFunction(() => Math.abs(Number(document.querySelector(".theme-toggle").style.getPropertyValue("--theme-progress")) - .8) < .025, null, { timeout: 1000 });
    const reversed = await progress();
    assert.ok(Math.abs(reversed - .8) < .025, "reversal follows pointer without restarting: " + JSON.stringify({ progress: reversed, gesture: await page.locator(".theme-toggle").evaluate((b) => ({ dragging: b.dataset.dragging, moving: b.dataset.moving, focused: b === document.activeElement, mode: b.dataset.mode })) }));
    await page.mouse.move(geometry.thumb.x - geometry.travel, geometry.thumb.y, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await page.locator(".theme-toggle").press("End");
    assert.equal(await progress(), 1, "keyboard commits immediately without a drag or duplicate click");
    await page.locator(".theme-toggle").press("Home"); assert.equal(await progress(), 0);
    await page.mouse.move(geometry.thumb.x - geometry.travel, geometry.thumb.y); await page.mouse.down();
    await page.mouse.move(geometry.thumb.x - geometry.travel * .5, geometry.thumb.y, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => document.querySelector(".theme-toggle").dataset.mode === "system");
    await page.getByRole("button", { name: "切换为深色模式", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    await page.screenshot({ path: path.join(out, "overview-dark.png") });
    await page.getByRole("button", { name: "连接诊断", exact: true }).click();
    await page.getByRole("button", { name: "一键测试", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".diagnostic-progress strong")?.textContent.includes("测试完成"));
    const results = await app.evaluate(() => Object.values(global.assTest.snapshot().diagnostics));
    assert.equal(results.length, 2); assert.ok(results.every((r) => r.ok && r.httpStatus === 200 && r.firstTextMs >= r.headersMs && r.outputTokens === 2));
    await page.locator(".diagnostic-extra summary").first().click();
    await page.screenshot({ path: path.join(out, "diagnostics-dark.png"), fullPage: true });
    await page.getByRole("button", { name: "切换为浅色模式", exact: true }).click();
    await page.screenshot({ path: path.join(out, "diagnostics-light.png"), fullPage: true });
    await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
    await page.getByRole("button", { name: "切换为自动模式", exact: true }).click();
    await page.getByRole("button", { name: "切换为深色模式", exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector(".theme-toggle").style.getPropertyValue("--theme-progress")) === 1);
    await page.screenshot({ path: path.join(out, "providers-dark.png") });
    assert.equal(await page.locator('.supplier-symbol img').evaluateAll((imgs) => imgs.length > 0 && imgs.every((img) => getComputedStyle(img).filter !== "none")), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    const snapshots = await app.evaluate(() => ({ diagnostics: global.assTest.snapshot().diagnostics, batch: global.assTest.snapshot().diagnosticBatch }));
    await page.locator(".theme-toggle").press("ArrowLeft");
    assert.equal(await progress(), .5);
    for (const [key, selector] of [["Home", ".theme-sun-idle"], ["ArrowRight", ".theme-horizon > path"], ["End", ".theme-stars > path"]]) {
      await page.locator(".theme-toggle").press(key);
      await page.waitForFunction((selector) => getComputedStyle(document.querySelector(selector)).animationPlayState === "running", selector, { timeout: 3000 });
    }
    await page.locator(".theme-toggle").press("ArrowLeft");
    await app.evaluate(() => global.assTest.quit()); await app.close();
    app = await launch(); page = await app.firstWindow(); await page.waitForSelector("h1");
    assert.equal(await page.locator("h1").innerText(), "路由总览");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "system");
    assert.equal(await page.locator(".theme-toggle").getAttribute("aria-pressed"), "mixed");
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    await page.waitForFunction(() => document.querySelector(".theme-toggle").dataset.systemDark === "true");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "system");
    const restored = await app.evaluate(() => ({ diagnostics: global.assTest.snapshot().diagnostics, batch: global.assTest.snapshot().diagnosticBatch }));
    assert.deepEqual(restored.diagnostics, snapshots.diagnostics);
    assert.equal(restored.batch.passed, 2); assert.equal(restored.batch.restored, true);
    await page.getByRole("button", { name: "连接诊断", exact: true }).click();
    assert.match(await page.locator(".diagnostic-progress").innerText(), /上次测试/);
    await page.screenshot({ path: path.join(out, "diagnostics-restarted.png"), fullPage: true });
    console.log(JSON.stringify({ ok: true, animation, promotion, restoredResults: Object.keys(restored.diagnostics).length, screenshots: out, data }));
  } finally { await app.evaluate(() => global.assTest.quit()).catch(() => {}); await app.close().catch(() => {}); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
