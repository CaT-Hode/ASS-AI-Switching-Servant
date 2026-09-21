const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.join(process.env.LOCALAPPDATA, "ASS-validation");
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, "v0110-qa-")),
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
  const row = page.getByRole("form", {
    name: "ok-model 行内配置",
    exact: true,
  });
  assert.equal(await row.getByRole("button").count(), 2);
  const openDetails = async () => {
    await row
      .getByRole("button", { name: "ok-model 模型操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "详细设置", exact: true }).click();
    await side.waitFor();
  };
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
  await row
    .getByRole("button", { name: "ok-model 模型操作", exact: true })
    .click();
  assert.equal(await page.getByRole("menuitem").count(), 3);
  await page.screenshot({
    path: path.join(out, "v0110-model-actions.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.mouse.click(7, 7);
  await list.waitFor({ state: "hidden" });
  assert.equal(await page.locator("dialog[open]").count(), 0);
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
  await page.getByRole("button", { name: "取消测试", exact: true }).click();
  await page.waitForFunction(() =>
    window.ass.call("snapshot").then((s) => !s.diagnosticBatch.running),
  );
  s = await state();
  assert.equal(s.diagnosticBatch.cancelled, 3);
  assert.equal(await app.evaluate(() => global.assTest.sent.length), 2);
  await page.getByRole("button", { name: "客户端与账户", exact: true }).click();
  s = await state();
  for (const id of ["dsh", "opencode"]) {
    const c = s.harnesses.clients.find((c) => c.id === id);
    await page
      .getByRole("button", {
        name: new RegExp("^" + c.name + " (已找到客户端|未检测到安装)$"),
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
      modelActions: 2,
      blankDismiss: "one level only, drag guarded",
      nativeCatalogs: true,
      batch: "pass/fail/skip/cancel, no duplicates",
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
