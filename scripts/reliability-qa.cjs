// Browser plugin not available; validate the real Electron renderer with Playwright.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.join(process.env.LOCALAPPDATA, "ASS-validation");
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, "v0111-qa-")),
  home = path.join(data, "test-home"),
  codex = path.join(data, "codex");
const write = (file, d) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof d === "string" ? d : JSON.stringify(d));
};
write(path.join(codex, "models_cache.json"), {
  models: [
    {
      slug: "gpt-fixture",
      display_name: "GPT Fixture",
      context_window: 128000,
    },
  ],
});
write(
  path.join(home, ".dsh/.credentials.yaml"),
  "version: 1\nrefs:\n  DEEPSEEK_API_KEY: synthetic-native-ds\n",
);
write(path.join(home, ".local/share/opencode/auth.json"), {
  "opencode-go": { type: "api", key: "synthetic-native-go" },
  opencode: { type: "api", key: "synthetic-native-zen" },
});
write(path.join(home, ".cache/opencode/models.json"), {
  "opencode-go": {
    models: {
      "native-go": {
        name: "Go cached model",
        limit: { context: 1000000 },
        provider: { npm: "@ai-sdk/openai-compatible" },
      },
    },
  },
});
const errors = [];
let app,
  page,
  closed = false;
(async () => {
  app = await electron.launch({
    ...(process.env.ASS_QA_EXE
      ? { executablePath: process.env.ASS_QA_EXE }
      : {}),
    args: process.env.ASS_QA_EXE ? ["--qa"] : [root, "--qa"],
    env: {
      ...process.env,
      ASS_TEST_DATA: data,
      ASS_TEST_CODEX: codex,
      ASS_TEST_PORT: "25829",
    },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.waitForSelector("h1");
  assert.match(await page.title(), /ASS/);
  assert.match(page.url(), /index\.html$/);
  assert.ok(await page.locator("h1").innerText());
  assert.equal(await page.locator("vite-error-overlay").count(), 0);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1380, 940);
    const t = global.assTest;
    t.sent = [];
    t.slow = false;
    t.setFetch(async (url, init) => {
      const key = init?.headers?.authorization;
      if (url.endsWith("/usage")) {
        if (key === "Bearer synthetic-native-zen")
          return Response.json({ error: "private-message" }, { status: 403 });
        return Response.json({
          usage: {
            rolling: {
              status: "ok",
              percent: 12,
              resetsAt: "2026-09-22T01:00:00Z",
            },
            weekly: {
              status: "rate-limited",
              percent: 100,
              resetsAt: "2026-09-28T00:00:00Z",
            },
            monthly: {
              status: "ok",
              percent: 30,
              resetsAt: "2026-10-01T00:00:00Z",
            },
          },
        });
      }
      if (url.endsWith("/user/balance"))
        return Response.json({
          is_available: true,
          balance_infos: [
            {
              currency: "CNY",
              total_balance: "123.45",
              granted_balance: "3.45",
              topped_up_balance: "120",
            },
          ],
        });
      if (url.endsWith("/models"))
        return Response.json({
          data: url.includes("deepseek.com")
            ? [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }]
            : url.includes("opencode.ai")
              ? [{ id: "native-go" }]
              : [{ id: "ok-model" }, { id: "fail-model" }],
        });
      const model = JSON.parse(init.body).model;
      t.sent.push(model);
      if (t.slow)
        await new Promise((resolve, reject) => {
          if (init.signal.aborted) return reject(Error("aborted"));
          init.signal.addEventListener(
            "abort",
            () => reject(Error("aborted")),
            { once: true },
          );
        });
      if (model === "fail-model")
        return Response.json(
          { error: { message: "fixture failed" } },
          { status: 502 },
        );
      const response = {
        id: "resp_fixture",
        status: "completed",
        output: [
          { type: "message", content: [{ type: "output_text", text: "OK" }] },
        ],
      };
      return new Response(
        "event: response.completed\ndata: " +
          JSON.stringify({ type: "response.completed", response }) +
          "\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    t.store.import({
      providers: [
        {
          id: "test",
          name: "测试供应商",
          baseUrl: "https://fixture.test/v1",
          apiKey: "synthetic-key",
          models: [
            { model: "ok-model", wireApi: "openai-responses" },
            { model: "fail-model", wireApi: "openai-responses" },
            { model: "off-model", enabled: false },
          ],
        },
        {
          id: "missing",
          name: "无凭据",
          baseUrl: "https://missing.test/v1",
          models: ["missing-model"],
        },
      ],
    });
  });
  const state = () => page.evaluate(() => window.ass.call("snapshot"));
  await state();
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  await page
    .getByRole("button", { name: "查看 测试供应商 的模型", exact: true })
    .click();
  const list = page.locator(".provider-model-dialog"),
    side = page.locator(".provider-side-dialog");
  const lightning = (model) =>
    page.getByRole("button", { name: "检测模型 " + model, exact: true });
  const checkLightning = async (model, result) => {
    const button = lightning(model);
    await button
      .locator(
        'svg.lucide-zap[fill="' + (result ? "currentColor" : "none") + '"]',
      )
      .waitFor();
    assert.equal(await button.locator(".spin").count(), 0);
    assert.equal(
      await button.evaluate((el) => el.classList.contains("passed")),
      result === "passed",
    );
    assert.equal(
      await button.evaluate((el) => el.classList.contains("failed")),
      result === "failed",
    );
    if (result) {
      assert.match(await button.getAttribute("title"), /点击重新检测/);
      const color =
        result === "passed" ? "rgb(25, 132, 85)" : "rgb(188, 75, 64)";
      await button.hover();
      assert.equal(
        await button.locator("svg").evaluate((el) => getComputedStyle(el).fill),
        color,
      );
      await page.mouse.move(1, 1);
    }
  };
  await checkLightning("ok-model", null);
  await checkLightning("fail-model", null);
  await checkLightning("off-model", null);
  const row = page.getByRole("form", {
    name: "ok-model 行内配置",
    exact: true,
  });
  assert.equal(await row.getByRole("button").count(), 3);
  const openDetails = async () => {
    await row
      .getByRole("button", { name: "模型详情 ok-model", exact: true })
      .click();
    await side.waitFor();
  };
  await openDetails();
  assert.equal(await side.locator(".model-section-toggle").count(), 2);
  assert.equal(
    await side
      .getByRole("button", { name: "配置", exact: true })
      .getAttribute("aria-expanded"),
    "true",
  );
  await side.getByLabel("显示名称", { exact: true }).fill("统一详情草稿");
  await side.getByLabel("上下文 tokens", { exact: true }).fill("144000");
  await side.getByRole("button", { name: "能力与检测", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await side
      .getByRole("button", { name: "能力与检测", exact: true })
      .getAttribute("aria-expanded"),
    "true",
  );
  assert.equal(
    await side.getByLabel("模型 ID", { exact: true }).isVisible(),
    false,
  );
  await side.getByText("接口声明", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(out, "v0111-model-capabilities.png"),
    animations: "disabled",
  });
  await side.getByRole("button", { name: "配置", exact: true }).click();
  assert.equal(
    await side.getByLabel("显示名称", { exact: true }).inputValue(),
    "统一详情草稿",
  );
  assert.equal(
    await side.getByLabel("上下文 tokens", { exact: true }).inputValue(),
    "144000",
  );
  await page.screenshot({
    path: path.join(out, "v0111-model-details.png"),
    animations: "disabled",
  });
  await side.getByRole("button", { name: "保存模型", exact: true }).click();
  await side.waitFor({ state: "hidden" });
  assert.equal(
    (await state()).providers.find((p) => p.id === "test").models[0]
      .displayName,
    "统一详情草稿",
  );
  assert.equal(
    await row.getByLabel("ok-model 上下文长度", { exact: true }).inputValue(),
    "144000",
  );
  await openDetails();
  await side.getByLabel("模型 ID", { exact: true }).click();
  const input = await side.getByLabel("模型 ID", { exact: true }).boundingBox();
  await page.mouse.move(input.x + 15, input.y + 10);
  await page.mouse.down();
  await page.mouse.move(7, 7);
  await page.mouse.up();
  assert.equal(
    await page.locator("dialog[open]").count(),
    2,
    "drag out must not dismiss",
  );
  // A click on the inert parent only dismisses the top level, without clicking through.
  const rect = await list.boundingBox();
  await page.mouse.click(rect.x + 20, rect.y + 20);
  await side.waitFor({ state: "hidden" });
  assert.equal(await page.locator("dialog[open]").count(), 1);
  assert.equal(await page.getByRole("menuitem").count(), 0);
  await page.screenshot({
    path: path.join(out, "v0111-model-actions.png"),
    animations: "disabled",
  });
  await page.mouse.click(7, 7);
  await list.waitFor({ state: "hidden" });
  assert.equal(await page.locator("dialog[open]").count(), 0);
  // Check outside surfaces at each desktop width; one click returns exactly one level.
  for (const width of [1100, 1380, 1536]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setSize(width, 940),
      width,
    );
    for (const surface of ["gap", "outside", "parent"]) {
      await page
        .getByRole("button", { name: "查看 测试供应商 的模型", exact: true })
        .click();
      await openDetails();
      await page.waitForFunction(() => {
        const left = document
            .querySelector(".provider-model-dialog")
            .getBoundingClientRect(),
          right = document
            .querySelector(".provider-side-dialog")
            .getBoundingClientRect();
        return left.right + 12 < right.left;
      });
      const left = await list.boundingBox(),
        right = await side.boundingBox();
      const point =
        surface === "gap"
          ? [(left.x + left.width + right.x) / 2, 180]
          : surface === "parent"
            ? [left.x + 18, left.y + 18]
            : [7, 7];
      await page.mouse.click(...point);
      await side.waitFor({ state: "hidden" });
      assert.equal(await page.locator("dialog[open]").count(), 1);
      assert.equal(
        await row
          .getByRole("button", { name: "模型详情 ok-model", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      if (width === 1380 && surface === "gap")
        await page.screenshot({
          path: path.join(out, "v0111-blank-return.png"),
          animations: "disabled",
        });
      await page.mouse.click(7, 7);
      await list.waitFor({ state: "hidden" });
      assert.equal(await page.locator("dialog[open]").count(), 0);
    }
  }
  // The same dismissal works for all three other model-management dialogs.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "查看 测试供应商 的模型", exact: true })
    .click();
  for (const name of ["手动添加", "供应商设置", "发现模型"]) {
    await list.getByRole("button", { name, exact: true }).click();
    await side.waitFor();
    await page.mouse.click(7, 7);
    await side.waitFor({ state: "hidden" });
    assert.equal(await page.locator("dialog[open]").count(), 1);
  }
  await page.mouse.click(7, 7);
  await list.waitFor({ state: "hidden" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Anchored confirmation is rendered in-app, not an OS message box.
  await app.evaluate(({ dialog }) => {
    global.assTest.systemPrompts = 0;
    dialog.showMessageBox = async () => {
      global.assTest.systemPrompts++;
      return { response: 0 };
    };
  });
  await page
    .getByRole("button", { name: "查看 测试供应商 的模型", exact: true })
    .click();
  const deleteTrigger = row.getByRole("button", {
    name: "删除模型 ok-model",
    exact: true,
  });
  const confirmation = page.getByRole("dialog", {
    name: "删除此模型？",
    exact: true,
  });
  for (const width of [1100, 1380, 1536]) {
    await app.evaluate(
      ({ BrowserWindow }, w) =>
        BrowserWindow.getAllWindows()[0].setSize(w, 940),
      width,
    );
    await deleteTrigger.click();
    await confirmation.waitFor();
    await confirmation.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((a) => a.finished));
    });
    const anchor = await deleteTrigger.boundingBox(),
      bubble = await confirmation.boundingBox();
    assert.ok(bubble.x >= 0 && bubble.x + bubble.width <= width);
    assert.ok(bubble.width <= 322);
    assert.ok(
      Math.abs(bubble.y - anchor.y - anchor.height) < 10 ||
        Math.abs(anchor.y - bubble.y - bubble.height) < 10,
    );
    assert.equal(await confirmation.getByRole("button").count(), 2);
    assert.equal(
      await confirmation
        .getByRole("button", { name: "取消", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    if (width === 1380)
      await page.screenshot({
        path: path.join(out, "v0111-delete-confirm.png"),
        animations: "disabled",
      });
    await page.keyboard.press("Escape");
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(await page.locator("dialog[open]").count(), 1);
    assert.equal(
      await deleteTrigger.evaluate((el) => el === document.activeElement),
      true,
    );
    await deleteTrigger.click();
    await confirmation.waitFor();
    await page.mouse.click(7, 7);
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(await page.locator("dialog[open]").count(), 1);
  }
  assert.equal(await app.evaluate(() => global.assTest.systemPrompts), 0);
  assert.ok(
    (await state()).providers
      .find((p) => p.id === "test")
      .models.some((m) => m.model === "ok-model"),
  );
  await page.mouse.click(7, 7);
  await list.waitFor({ state: "hidden" });
  // Native online model lists are now discoverable, without creating API providers.
  let s = await state();
  for (const id of ["dsh", "opencode"]) {
    const source = s.modelSources.find((p) => p.id === "native-" + id);
    await page
      .getByRole("button", {
        name: "查看 " + source.name + " 的模型",
        exact: true,
      })
      .click();
    await page.waitForFunction(
      (id) =>
        window.ass
          .call("snapshot")
          .then((s) => !!s.providerModels["native-" + id]),
      id,
    );
    assert.ok((await page.locator(".native-model-row").count()) > 0);
    if (id === "dsh")
      assert.equal(await page.locator(".native-model-row").count(), 2);
    await page.mouse.click(7, 7);
    await list.waitFor({ state: "hidden" });
  }
  await page.getByRole("button", { name: "连接诊断", exact: true }).click();
  await page.getByRole("button", { name: "一键测试", exact: true }).click();
  await page.waitForFunction(() =>
    window.ass
      .call("snapshot")
      .then((s) => s.diagnosticBatch.finishedAt && !s.diagnosticBatch.running),
  );
  s = await state();
  assert.deepEqual(
    [
      s.diagnosticBatch.passed,
      s.diagnosticBatch.failed,
      s.diagnosticBatch.skipped,
    ],
    [1, 1, 3],
  );
  assert.deepEqual((await app.evaluate(() => global.assTest.sent)).sort(), [
    "fail-model",
    "ok-model",
  ]);
  await page.screenshot({
    path: path.join(out, "v0110-diagnostics.png"),
    animations: "disabled",
  });
  // Completed results are solid in both views, including failed requests.
  await checkLightning("ok-model", "passed");
  await checkLightning("fail-model", "failed");
  await checkLightning("off-model", null);
  await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
  for (const reload of [false, true]) {
    if (reload) {
      await page.reload();
      await page.waitForSelector("h1");
    }
    await page
      .getByRole("button", { name: "查看 测试供应商 的模型", exact: true })
      .click();
    await checkLightning("ok-model", "passed");
    await checkLightning("fail-model", "failed");
    await checkLightning("off-model", null);
    if (reload) {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1380, 940),
      );
      await page.screenshot({
        path: path.join(out, "v0113-model-lightning.png"),
        animations: "disabled",
      });
    }
    await page.mouse.click(7, 7);
    await list.waitFor({ state: "hidden" });
  }
  await page.getByRole("button", { name: "连接诊断", exact: true }).click();
  await app.evaluate(() => {
    const t = global.assTest;
    t.store.model("test", { model: "queued-model" });
    t.sent = [];
    t.slow = true;
  });
  await state();
  await page.getByRole("button", { name: "一键测试", exact: true }).click();
  await page.waitForFunction(() =>
    window.ass
      .call("snapshot")
      .then((s) => Object.keys(s.diagnosticJobs).length === 2),
  );
  for (const model of ["ok-model", "fail-model"]) {
    await lightning(model).locator(".spin").waitFor();
    assert.equal(await lightning(model).locator(".lucide-zap").count(), 0);
  }
  await page.getByRole("button", { name: "取消测试", exact: true }).click();
  await page.waitForFunction(() =>
    window.ass.call("snapshot").then((s) => !s.diagnosticBatch.running),
  );
  s = await state();
  assert.equal(s.diagnosticBatch.cancelled, 3);
  assert.equal(await app.evaluate(() => global.assTest.sent.length), 2);
  await checkLightning("ok-model", "passed");
  await checkLightning("fail-model", "failed");
  await checkLightning("queued-model", null);
  // Cancelling a first, in-flight test must not produce a completed marker.
  await app.evaluate(() => {
    const t = global.assTest;
    t.cancelController = new AbortController();
    t.cancelledProbe = t.diagnose(
      "test", "queued-model", t.cancelController.signal,
    );
  });
  await lightning("queued-model").locator(".spin").waitFor();
  assert.equal(await lightning("queued-model").locator(".lucide-zap").count(), 0);
  const cancelledProbe = await app.evaluate(async () => {
    global.assTest.cancelController.abort();
    return global.assTest.cancelledProbe;
  });
  assert.equal(cancelledProbe.cancelled, true);
  await checkLightning("queued-model", null);
  assert.equal(
    (await state()).diagnostics[JSON.stringify(["test", "queued-model"])],
    undefined,
  );
  await page.getByRole("button", { name: "客户端与账户", exact: true }).click();
  s = await state();
  for (const id of ["dsh", "opencode"]) {
    const c = s.harnesses.clients.find((c) => c.id === id);
    await page
      .getByRole("button", {
        name: c.name, exact: true,
      })
      .click();
    for (const a of c.accounts.filter(
      (a) => a.kind === "native" && a.authType === "api",
    )) {
      const card = page.getByRole("article", {
        name: a.label + " 账户",
        exact: true,
      });
      await card
        .getByRole("button", { name: a.label + " 刷新账户资料", exact: true })
        .click();
      if (id === "dsh")
        await card.getByText("123.45 CNY", { exact: true }).waitFor();
      if (a.provider === "opencode-go") {
        await card.getByText("剩余 88%", { exact: true }).waitFor();
        assert.equal(await card.getByRole("progressbar").count(), 3);
        await page.screenshot({
          path: path.join(out, "v0110-opencode-account.png"),
          animations: "disabled",
        });
      }
      if (a.provider === "opencode")
        await card.getByRole("alert").filter({ hasText: "HTTP 403" }).waitFor();
    }
  }
  s = await state();
  for (const secret of [
    "synthetic-native-ds",
    "synthetic-native-go",
    "synthetic-native-zen",
    "synthetic-key",
    "private-message",
  ])
    assert.ok(!JSON.stringify(s).includes(secret));
  assert.deepEqual(errors, []);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send("ass:manage", {
      scope: "all",
      enabled: false,
      quit: true,
    }),
  );
  const quit = page.getByRole("dialog", { name: "退出 ASS？", exact: true });
  await quit.getByRole("button", { name: "直接退出", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const dialog = document.querySelector(".connection-confirm");
    return dialog && !dialog.querySelector("button.primary").disabled;
  });
  await page.screenshot({
    path: path.join(out, "v0110-exit.png"),
    animations: "disabled",
  });
  const exit = app.waitForEvent("close");
  await quit.getByRole("button", { name: "直接退出", exact: true }).click();
  await exit;
  closed = true;
  console.log(
    JSON.stringify({
      passed: true,
      modelActions: "three direct icon buttons, no dropdown",
      blankDismiss:
        "3 desktop widths, gap/outside/parent, reduced motion, drag guarded",
      unifiedDetails:
        "expandable sections, draft preserved, saved, no duplicate entries",
      nativeCatalogs: true,
      batch: "pass/fail/skip/cancel, no duplicates",
      lightning:
        "untested outline, success/failure solid with hover colors, running spinner, cancellation, reopen and renderer reload",
      nativeAccountInfo: "DeepSeek balance, Go 3 quotas, Zen403",
      exit: "direct button closes isolated app",
      errors: 0,
    }),
  );
})()
  .catch(async (e) => {
    await page
      ?.screenshot({
        path: path.join(out, "v0110-failure.png"),
        animations: "disabled",
      })
      .catch(() => {});
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app && !closed) {
      await app.evaluate(() => global.assTest.quit()).catch(() => {});
      await app.close().catch(() => {});
    }
  });
