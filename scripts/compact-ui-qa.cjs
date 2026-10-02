// Desktop layout/account regressions; all credentials, network and process data
// are synthetic. No production harness is stopped, started or reconfigured.
const { _electron: electron } = require('playwright'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), out = path.join(process.env.LOCALAPPDATA, 'ASS-validation');
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, 'compact-ui-')), home = path.join(data, 'test-home'), codex = path.join(home, '.codex');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
const jwt = (v) => 'header.' + Buffer.from(JSON.stringify(v)).toString('base64url') + '.signature';
write(path.join(codex, 'auth.json'), { auth_mode: 'chatgpt', tokens: { access_token: jwt({ exp: 2100000000, sub: 'fixture' }),
  id_token: jwt({ email: 'compact@example.test', 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture', chatgpt_user_id: 'fixture', chatgpt_plan_type: 'pro' } }), refresh_token: 'synthetic-refresh', account_id: 'fixture' } });
write(path.join(home, '.dsh/.credentials.yaml'), { version: 1, refs: { DEEPSEEK_API_KEY: 'synthetic-native-key' } });
write(path.join(home, '.dsh/settings.yaml'), { 'llm-deepseek': { baseURL: 'https://api.deepseek.com', models: [{ id: 'deepseek-chat' }] } });
let app, page; const errors = [];
const call = (name, ...args) => page.evaluate(([name, args]) => window.ass.call(name, ...args), [name, args]);
(async () => {
  const env = { ...process.env, ASS_TEST_DATA: data, ASS_TEST_CODEX: codex, ASS_TEST_PORT: '25850' }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...(process.env.ASS_QA_EXE ? { executablePath: process.env.ASS_QA_EXE } : {}), args: process.env.ASS_QA_EXE ? ['--qa'] : [root, '--qa'], env });
  try {
    page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.waitForSelector('h1');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1440, 960);
      global.assTest.setFetch(async (url) => {
        const u = String(url);
        if (u.includes('/wham/usage')) return Response.json({ account_id: 'fixture', plan_type: 'pro', rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 2100000000 }, secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 2100000000 } } });
        if (u.includes('/user/balance')) return Response.json({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '25.00', granted_balance: '0.00', topped_up_balance: '25.00' }] });
        if (u.includes('/models')) return Response.json({ data: [{ id: 'deepseek-chat' }] });
        return new Response('{}', { status: 403 });
      });
      // Synthetic monthly window for visual-only period coverage; not a claim
      // that Codex's real subscription has a monthly window.
      const m = global.assTest.accountInfo, prior = m.public.bind(m);
      m.public = (provider) => {
        const result = prior(provider);
        return provider.id.startsWith('native-info:codex:') && result.fields.some((f) => f.kind === 'quota') ?
          { ...result, fields: [...result.fields, { id: 'quota-monthly', label: '月', kind: 'quota', usedPercent: 55, remainingPercent: 45 }] } : result;
      };
    });
    await page.getByRole('button', { name: '客户端与账户', exact: true }).click();
    await page.getByRole('button', { name: '刷新状态', exact: true }).click();
    await page.locator('.client-account-card').getByText('compact@example.test', { exact: true }).waitFor();
    await page.getByText('剩余 75%', { exact: true }).waitFor(); await page.getByText('剩余 60%', { exact: true }).waitFor();
    await page.locator('.client-account-card .account-plan').getByText('Pro', { exact: true }).waitFor();
    const meter = page.getByRole('progressbar', { name: '5h 剩余额度', exact: true });
    assert.equal(await meter.getAttribute('aria-valuenow'), '75');
    assert.equal(await page.locator('.usage-meter-thumb').count(), 0);
    const periods = [['5h', 'short'], ['周', 'week'], ['月', 'month']], colors = [];
    for (const [label, period] of periods) {
      const bar = page.getByRole('progressbar', { name: label + ' 剩余额度', exact: true });
      assert.equal(await bar.getAttribute('data-period'), period);
      colors.push(await bar.locator('.usage-meter-fill').evaluate((e) => getComputedStyle(e).backgroundImage));
    }
    assert.equal(new Set(colors).size, 3);
    await page.waitForFunction(() => document.querySelector('.usage-meter.visible .usage-meter-star'));
    const position = await meter.locator('.usage-meter-star').first().evaluate((e) => getComputedStyle(e).transform);
    await page.waitForFunction((prior) => getComputedStyle(document.querySelector('.usage-meter.visible .usage-meter-star')).transform !== prior, position);
    assert.equal(await page.locator('.client-heading button[aria-label="刷新状态"]').count(), 1);
    assert.equal(await page.locator('.client-injection').getByRole('button', { name: /刷新|同步/ }).count(), 0);
    assert.equal(await page.locator('.client-account-card .account-origin, .account-expiry').count(), 0);
    assert.equal(await page.locator('.client-account-card').getByText(/账户 ID|资料来源|更多资料/).count(), 0);
    assert.equal(await page.locator('.page-header').count(), 0);
    assert.equal(await page.locator('.window-chrome .brand').count(), 1);
    assert.equal(await page.locator('.sidebar > .brand').count(), 0);
    assert.equal(await page.locator('.client-glyph .brand-motion-trace, .client-provider-logo .brand-motion-trace').count(), 0);
    const top = await page.locator('.clients-layout').evaluate((e) => e.getBoundingClientRect().top); assert.ok(top >= 36 && top < 65, `content top ${top}`);
    await call('ui-preferences', { theme: 'light' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.screenshot({ path: path.join(out, 'compact-accounts-light.png'), animations: 'disabled' });
    await call('ui-preferences', { theme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.screenshot({ path: path.join(out, 'compact-quota-dark.png'), animations: 'disabled' });
    await call('save-provider', { id: 'saved-native-key', name: 'DeepSeek 保存副本', baseUrl: 'https://api.deepseek.com', apiKey: 'synthetic-native-key', models: [{ model: 'deepseek-chat', wireApi: 'openai-chat' }] });
    await call('save-provider', { id: 'other-key', name: 'DeepSeek 另一个 Key', baseUrl: 'https://api.deepseek.com', apiKey: 'synthetic-other-key', models: [{ model: 'deepseek-chat', wireApi: 'openai-chat' }] });
    await page.getByRole('button', { name: 'DeepSeek Harness', exact: true }).click();
    await page.getByRole('button', { name: '刷新状态', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.client-account-card').length === 2);
    const client = (await call('snapshot')).harnesses.clients.find((c) => c.id === 'dsh');
    assert.equal(client.accounts.filter((a) => a.kind === 'native').length, 1); assert.equal(client.accounts.filter((a) => a.kind === 'api').length, 1);
    assert.ok(client.accounts.some((a) => a.providerId === 'other-key'));
    // Verify the same cards remain after refreshing model metadata again.
    await page.getByRole('button', { name: '刷新状态', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.client-account-card').length === 2);
    await call('ui-preferences', { theme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.screenshot({ path: path.join(out, 'compact-accounts-dark.png'), animations: 'disabled' });
    await page.getByRole('button', { name: '供应商与模型', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '导入配置', exact: true }).count(), 1);
    assert.equal(await page.locator('.supplier-symbol .brand-motion-trace, .supplier-symbol.motion-brand').count(), 0);
    for (const width of [1440, 1100]) {
      await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 960), width);
      await page.waitForFunction((w) => window.innerWidth === w && document.documentElement.scrollWidth <= w, width);
      assert.ok(await page.locator('.inventory-toolbar').evaluate((e) => e.getBoundingClientRect().top < 65));
      const buttonsFit = await page.locator('.inventory-toolbar').evaluate((e) => [...e.querySelectorAll('button')].every((b) => b.getBoundingClientRect().right <= window.innerWidth));
      assert.equal(buttonsFit, true);
      const chrome = await page.evaluate(() => {
        const rect = (q) => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        return { sidebar: rect('.sidebar'), main: rect('main'), brand: rect('.window-chrome .brand'), logo: rect('.brand img'),
          version: rect('.brand .version-button'), versionSize: getComputedStyle(document.querySelector('.brand .version-button')).fontSize,
          titleSize: getComputedStyle(document.querySelector('.brand strong')).fontSize, gradient: getComputedStyle(document.querySelector('.window-chrome')).backgroundImage,
          drag: getComputedStyle(document.querySelector('.window-chrome')).getPropertyValue('-webkit-app-region'),
          buttonDrag: getComputedStyle(document.querySelector('.brand .version-button')).getPropertyValue('-webkit-app-region') };
      });
      assert.equal(chrome.sidebar.right, chrome.main.x);
      assert.equal(chrome.brand.width, chrome.sidebar.width);
      assert.equal(chrome.brand.y, 15); assert.equal(chrome.brand.height, 44);
      assert.equal(chrome.logo.width, 40); assert.equal(chrome.titleSize, '26px'); assert.equal(chrome.versionSize, '10px');
      assert.equal(chrome.logo.y, 19); assert.ok(chrome.logo.bottom <= 59);
      assert.ok(chrome.version.y >= 15 && chrome.version.bottom <= 59 && chrome.version.right <= chrome.sidebar.right);
      assert.ok(await page.locator('.sidebar .nav-label').evaluate((e) => e.getBoundingClientRect().top >= 71), 'navigation avoids lowered brand');
      assert.ok(chrome.gradient.includes(`${chrome.sidebar.width}px`));
      assert.equal(chrome.drag, 'drag'); assert.equal(chrome.buttonDrag, 'no-drag');
    }
    await page.screenshot({ path: path.join(out, 'compact-providers-dark.png'), animations: 'disabled' });
    await page.getByRole('button', { name: '查看 DeepSeek 另一个 Key 的模型', exact: true }).click();
    const models = page.getByRole('dialog', { name: 'DeepSeek 另一个 Key · 模型', exact: true }); await models.waitFor();
    await models.getByRole('button', { name: '模型详情 deepseek-chat', exact: true }).click();
    await page.locator('.provider-side-dialog').waitFor();
    await page.screenshot({ path: path.join(out, 'neutral-model-dialogs-dark.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.locator('.provider-side-dialog').waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    await models.waitFor({ state: 'detached' });
    for (const [label, file] of [['路由总览', 'neutral-overview-dark.png'], ['连接诊断', 'neutral-diagnostics-dark.png']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('heading', { name: label, exact: true }).waitFor();
      assert.ok((await page.locator('main').innerText()).length > 20);
      await page.screenshot({ path: path.join(out, file), animations: 'disabled' });
    }
    const palette = await page.evaluate(() => { const color = (v) => v.match(/[\d.]+/g)?.slice(0, 3).map(Number); const main = color(getComputedStyle(document.querySelector('main')).backgroundColor); return { main, border: getComputedStyle(document.documentElement).getPropertyValue('--border').trim(), logo: getComputedStyle(document.querySelector('.brand img')).filter }; });
    assert.ok(Math.max(...palette.main) - Math.min(...palette.main) <= 6, 'main background stays neutral');
    assert.ok(palette.border.includes('ffffff0a')); assert.equal(palette.logo, 'none');
    await page.getByRole('button', { name: '关于 ASS', exact: true }).click();
    assert.equal(await page.locator('.ass-brand-hero img').getAttribute('src'), await page.locator('.brand img').getAttribute('src'));
    const pixels = await page.locator('.brand img').evaluate((image) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
      const c = canvas.getContext('2d'); c.drawImage(image, 0, 0, 100, 100);
      const pixel = (x, y) => Array.from(c.getImageData(x, y, 1, 1).data);
      const rgba = c.getImageData(0, 0, 100, 100).data;
      let white = 0;
      for (let i = 0; i < rgba.length; i += 4) if (rgba[i] > 245 && rgba[i + 1] > 245 && rgba[i + 2] > 245 && rgba[i + 3] > 200) white++;
      return { corner: pixel(0, 0), hole: pixel(50, 50), petal: pixel(25, 25), ring: pixel(61, 50), white };
    });
    assert.ok(pixels.corner[3] < 10 && pixels.hole[3] < 10, 'transparent background and hollow ring');
    assert.ok(pixels.petal[3] < 10 && pixels.white > 100, 'hollow petals with white outlines in the gaps');
    assert.ok(pixels.ring[3] > 240 && pixels.ring[0] > pixels.ring[1] * 1.5, 'orange center retained');
    await page.getByRole('button', { name: '供应商与模型', exact: true }).click();
    await page.getByRole('button', { name: '查看 ASS 版本与更新', exact: true }).click();
    await page.getByRole('heading', { name: '关于 ASS', exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, 'neutral-about-dark.png'), animations: 'disabled' });
    assert.equal(await page.getByText('从 ASS 官方 GitHub Releases 获取版本信息。').count(), 0);
    assert.equal(await page.locator('vite-error-overlay').count(), 0); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, data, viewport: '1440x960 and 1100x960 desktop', checks: ['body starts in former title area', 'aligned native chrome and sidebar at both desktop widths', 'logo and clickable version inside title bar', 'same hollow-petal/white-outline/orange-gear icon in header and about', 'one harness refresh entry', 'subscription quotas retained', 'compact account information', 'same native/promoted API dedup after model sync', 'different API keys retained', 'static harness/provider logos', 'import only on provider page', 'neutral palette across overview, diagnostics, about and nested model dialogs', 'light/dark screenshots', 'no horizontal overflow or renderer errors'], realProcessesTouched: false }));
  } finally { await app.evaluate(() => global.assTest.quit()).catch(() => {}); await app.close().catch(() => {}); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
