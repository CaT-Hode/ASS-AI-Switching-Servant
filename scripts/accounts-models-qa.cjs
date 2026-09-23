// Real Electron renderer, isolated profiles and synthetic network/credentials.
// Browser plugin is unavailable; use the project's Playwright Electron support.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.join(process.env.LOCALAPPDATA, "ASS-validation");
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, "accounts-models-")),
  home = path.join(data, "test-home"),
  codex = path.join(data, "codex");
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof value === "string" ? value : JSON.stringify(value),
  );
};
const grant = {
  type: "oauth",
  access: "synthetic-account-access",
  refresh: "synthetic-account-refresh",
  expires: 2100000000000,
};
write(path.join(codex, "models_cache.json"), {
  models: [
    { slug: "gpt-test", display_name: "GPT Test", context_window: 128000 },
  ],
});
write(path.join(codex, "auth.json"), {
  tokens: {
    access_token: grant.access,
    refresh_token: grant.refresh,
    account_id: "synthetic-account-id",
  },
});
write(path.join(home, ".claude/.credentials.json"), {
  claudeAiOauth: {
    accessToken: grant.access,
    refreshToken: grant.refresh,
    expiresAt: grant.expires,
  },
});
write(path.join(home, ".claude/settings.json"), { model: "claude-test" });
write(path.join(home, ".local/share/opencode/auth.json"), {
  openai: grant,
  anthropic: grant,
});
write(path.join(home, ".pi/agent/auth.json"), {
  "openai-codex": grant,
  "github-copilot": grant,
  anthropic: { ...grant, expires: 1000000000000 },
});
write(path.join(home, ".pi/agent/models.json"), {
  providers: {
    "openai-codex": {
      api: "openai-responses",
      models: [
        {
          id: "gpt-native",
          name: "原生模型",
          contextWindow: 128000,
          input: ["text", "image"],
        },
      ],
    },
  },
});
write(
  path.join(home, ".dsh/.credentials.yaml"),
  "version: 1\nrefs:\n  DEEPSEEK_API_KEY: synthetic-account-key\nrecords:\n  llm-pi-ai/openai-codex:\n    kind: grant\n    payload: " +
    JSON.stringify(grant) +
    "\n",
);
const originals = [
  path.join(codex, "auth.json"),
  ...[
    ".claude/.credentials.json",
    ".local/share/opencode/auth.json",
    ".pi/agent/auth.json",
    ".dsh/.credentials.yaml",
  ].map((p) => path.join(home, p)),
].map((file) => [file, fs.readFileSync(file)]);
const errors = [];
let app, page;
async function launch() {
  app = await electron.launch({
    ...(process.env.ASS_QA_EXE
      ? { executablePath: process.env.ASS_QA_EXE }
      : {}),
    args: process.env.ASS_QA_EXE ? ["--qa"] : [root, "--qa"],
    env: {
      ...process.env,
      ASS_TEST_DATA: data,
      ASS_TEST_CODEX: codex,
      ASS_TEST_PORT: "25820",
    },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.waitForSelector("h1");
  assert.equal(await page.title(), "ASS");
  assert.ok(page.url().startsWith("file://"));
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].setSize(1380, 940);
    global.assTest.confirm = 1;
    dialog.showMessageBox = async (...args) => {
      global.assTest.lastConfirmation = args.at(-1);
      return { response: global.assTest.confirm };
    };
    global.assTest.sent = [];
    global.assTest.setFetch(async (url, init) => {
      global.assTest.sent.push({
        url,
        model: init?.body ? JSON.parse(init.body).model : null,
      });
      if (url.endsWith("/wham/usage"))
        return Response.json({
          rate_limit: {
            primary_window: {
              used_percent: 20,
              limit_window_seconds: 18000,
              reset_at: 2100000000,
            },
            secondary_window: {
              used_percent: 40,
              limit_window_seconds: 604800,
              reset_at: 2100000000,
            },
          },
        });
      if (url.endsWith("/api/oauth/usage"))
        return Response.json({
          five_hour: { utilization: 30 },
          seven_day: { utilization: 60 },
        });
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
      if (url.endsWith("/zen/go/v1/usage"))
        return Response.json({ limits: [] });
      if (url.endsWith("/models"))
        return Response.json({
          data: [
            { id: "alpha", context_length: 128000, supports_tools: true },
            { id: "beta" },
            {
              id: "new-model",
              context_length: 96000,
              input_modalities: ["text", "image"],
            },
          ],
        });
      if (url.endsWith("/chat/completions"))
        return new Response(
          "data: " +
            JSON.stringify({
              choices: [
                { index: 0, delta: { content: "OK" }, finish_reason: "stop" },
              ],
            }) +
            "\n\ndata: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        );
      return new Response(
        "data: " +
          JSON.stringify({
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "OK" }],
                },
              ],
            },
          }) +
          "\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    });
  });
}
const snapshot = () => page.evaluate(() => window.ass.call("snapshot"));
async function stop() {
  if (app) {
    await app.evaluate(() => global.assTest.quit()).catch(() => {});
    await app.close().catch(() => {});
  }
}
const chooseClient = async (name) => {
  if (!(await page.locator(".client-list").getByRole("button", {name, exact: true}).isVisible()))
    await page.locator(".more-clients > summary").click();
  await page
    .locator(".client-list")
    .getByRole("button", { name, exact: true })
    .click();
  await page.locator(".client-heading h2").filter({ hasText: name }).waitFor();
};
async function run() {
  await launch();
  try {
    await app.evaluate(() => {
      const t = global.assTest;
      t.store.import({
        providers: [
          {
            id: "work",
            name: "工作 API",
            baseUrl: "https://example.test/v1",
            apiKey: "synthetic-key",
            models: [
              {
                model: "alpha",
                displayName: "Alpha",
                wireApi: "anthropic",
                contextWindow: 128000,
                efforts: ["low", "medium", "high", "max"],
              },
              {
                model: "beta",
                displayName: "Beta",
                wireApi: "openai-responses",
              },
            ],
          },
          {
            id: "deep",
            name: "DeepSeek",
            baseUrl: "https://api.deepseek.com",
            apiKey: "synthetic-key",
            models: ["deepseek-chat"],
          },
          {
            id: "go",
            name: "OpenCode Go",
            baseUrl: "https://opencode.ai/zen/go/v1",
            apiKey: "synthetic-key",
            models: ["go-test"],
          },
        ],
      });
      t.harnesses.add("codex", "工作授权");
    });
    await page
      .getByRole("button", { name: "供应商与模型", exact: true })
      .click();
    await page
      .getByRole("region", { name: "供应商卡片", exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator(".configured-models, .inline-model, .provider-model-catalog")
        .count(),
      0,
    );
    assert.equal(
      await app.evaluate(
        () =>
          global.assTest.sent.filter((x) => x.url.endsWith("/models")).length,
      ),
      0,
      "Gallery must not automatically fetch a provider's models",
    );
    for (const width of [1100, 1380, 1536]) {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0].setSize(width, 940),
        width,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: path.join(out, `v019-provider-gallery-${width}.png`),
        animations: "disabled",
      });
    }
    await page.getByLabel("搜索供应商或模型").fill("工作");
    await page.getByLabel("来源筛选").selectOption("api");
    const openWork = page.getByRole("button", {
      name: "查看 工作 API 的模型",
      exact: true,
    });
    await openWork.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("region", { name: "工作 API 模型配置", exact: true })
      .waitFor();
    assert.equal(
      await page.locator("dialog.provider-model-dialog[open]").count(),
      1,
    );
    assert.equal(
      await page.evaluate(() => {
        document.querySelector(".provider-gallery input").focus();
        return document
          .querySelector(".provider-model-dialog")
          .contains(document.activeElement);
      }),
      true,
      "Gallery cannot take focus behind the level-2 modal",
    );
    assert.equal(
      await page
        .getByLabel("搜索已配置模型")
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.getByLabel("alpha 显示名称", { exact: true }).fill("保留的草稿");
    await page
      .locator(".provider-model-dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.locator(".provider-model-dialog").waitFor({ state: "hidden" });
    await openWork.waitFor();
    assert.equal(
      await openWork.evaluate((e) => e === document.activeElement),
      true,
    );
    assert.equal(
      await page.getByLabel("搜索供应商或模型").inputValue(),
      "工作",
    );
    assert.equal(await page.getByLabel("来源筛选").inputValue(), "api");
    assert.equal(await page.locator(".inline-model").count(), 0);
    await page.getByText("1 项未保存", { exact: true }).waitFor();
    await openWork.click();
    assert.equal(
      await page.getByLabel("alpha 显示名称", { exact: true }).inputValue(),
      "保留的草稿",
    );
    await page
      .getByRole("form", { name: "alpha 行内配置", exact: true })
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page.locator(".provider-model-dialog").waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "供应商与模型", exact: true })
      .click();
    await openWork.waitFor();
    assert.equal(
      await page.locator(".configured-models").count(),
      0,
      "Sidebar navigation must return to level 1",
    );
    await page
      .getByRole("button", { name: "客户端与账户", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "官方账户中心", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.locator(".client-list").getByRole("switch").count(),
      0,
    );
    const nativeCounts = { codex: 1, claude: 1, opencode: 0, pi: 3, dsh: 1 };
    for (const [id, name] of Object.entries({
      codex: "Codex",
      claude: "Claude Code",
      opencode: "OpenCode",
      pi: "pi",
      dsh: "DeepSeek Harness",
    })) {
      await chooseClient(name);
      assert.equal(await page.locator(".client-heading").getByRole("switch").count(), 1);
      assert.equal(
        await page
          .locator(".client-panel .client-heading")
          .getByRole("switch", { name: name + " ASS 接入", exact: true })
          .count(),
        1,
      );
      const s = await snapshot(),
        c = s.harnesses.clients.find((c) => c.id === id);
      assert.equal(
        c.accounts.filter((a) => a.kind === "native").length,
        nativeCounts[id],
      );
      assert.equal(
        c.accounts.filter((a) => a.kind === "api").length,
        ["dsh", "opencode"].includes(id) ? 1 : 0,
      );
    }
    await chooseClient("pi");
    await page.getByRole("button", { name: "添加账户", exact: true }).click();
    const add = page.getByRole("dialog");
    assert.equal(await add.getByRole("button", { name: /工作 API/ }).count(), 0);
    await add.getByRole("button", { name: "关闭", exact: true }).click();
    await add.waitFor({ state: "hidden" });
    const piAccount = (await snapshot()).harnesses.clients.find((c) => c.id === "pi").accounts.find((a) => a.provider === "openai-codex");
    const work = page.getByRole("article", {
      name: piAccount.label + " 账户",
      exact: true,
    });
    await work
      .getByRole("button", { name: "设为启动账户", exact: true })
      .click();
    await work.getByRole("button", { name: "下次启动使用", exact: true }).waitFor();
    await page.getByRole("switch", { name: "工作 API 供应商接入", exact: true }).click();
    assert.equal(
      (await snapshot()).harnesses.clients
        .find((c) => c.id === "codex")
        .accounts.filter((a) => a.providerId === "work").length,
      0,
    );
    await page.screenshot({
      path: path.join(out, "v017-clients-1380.png"),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "供应商与模型", exact: true }).click();
    await openWork.click();
    let section = page.getByRole("region", {
      name: "工作 API 模型配置",
      exact: true,
    });
    await section.waitFor();
    assert.equal(
      await page.locator("dialog.provider-model-dialog[open]").count(),
      1,
      "Client deep links open level 2 directly",
    );
    await section.getByText(/已读取 3 个可用模型/).waitFor();
    let row = page.getByRole("form", { name: "alpha 行内配置", exact: true });
    await row.getByLabel("alpha 模型 ID", { exact: true }).fill("alpha-new");
    await row
      .getByLabel("alpha 显示名称", { exact: true })
      .fill("Alpha 新名称");
    await row
      .getByLabel("alpha 接口类型", { exact: true })
      .selectOption("openai-chat");
    await row.getByLabel("alpha 上下文长度", { exact: true }).fill("196608");
    await row
      .getByLabel("alpha 默认思维强度", { exact: true })
      .selectOption("high");
    await row.getByRole("button", { name: "保存", exact: true }).click();
    row = page.getByRole("form", { name: "alpha-new 行内配置", exact: true });
    await row.waitFor();
    const s = await snapshot(),
      m = s.providers.find((p) => p.id === "work").models[0];
    assert.deepEqual(
      [m.model, m.displayName, m.wireApi, m.contextWindow, m.defaultEffort],
      ["alpha-new", "Alpha 新名称", "openai-chat", 196608, "high"],
    );
    assert.deepEqual(
      s.harnesses.clients.find((c) => c.id === "pi").injection.excludedProviders,
      ["work"],
    );
    await row
      .getByLabel("alpha-new 显示名称", { exact: true })
      .fill("取消修改");
    await row.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(
      await row.getByLabel("alpha-new 显示名称", { exact: true }).inputValue(),
      "Alpha 新名称",
    );
    await row.getByLabel("alpha-new 模型 ID", { exact: true }).fill("beta");
    await row.getByRole("button", { name: "保存", exact: true }).click();
    await row.getByRole("alert").waitFor();
    assert.match(await row.getByRole("alert").innerText(), /重复/);
    await row.getByRole("button", { name: "取消", exact: true }).click();
    await row.getByLabel("alpha-new 上下文长度", { exact: true }).fill("0");
    assert.equal(
      await row
        .locator("input[type=number]")
        .evaluate((e) => e.checkValidity()),
      false,
    );
    await row.getByRole("button", { name: "取消", exact: true }).click();
    const advanced = row.getByRole("button", {
      name: "模型详情 alpha-new",
      exact: true,
    });
    assert.equal(await row.getByRole("button").count(), 3);
    assert.equal(await row.getByRole("menu").count(), 0);
    // The right-side level 3 shifts the level-2 list left, with no overlap.
    const openAdvanced = async () => {
      await advanced.click();
    };
    const deleteModel = async (name, confirm = true) => {
      await page
        .getByRole("button", { name: "删除模型 " + name, exact: true })
        .click();
      const confirmation = page.getByRole("dialog", {
        name: "删除此模型？",
        exact: true,
      });
      await confirmation
        .getByRole("button", { name: confirm ? "确定" : "取消", exact: true })
        .click();
    };
    await openAdvanced();
    let detailDialog = page.getByRole("dialog", {
      name: "模型详情",
      exact: true,
    });
    await detailDialog.waitFor();
    assert.equal(await page.locator("dialog[open]").count(), 2);
    assert.equal(
      await page.evaluate(() => {
        document.querySelector(".provider-model-dialog input").focus();
        return document
          .querySelector(".provider-side-dialog")
          .contains(document.activeElement);
      }),
      true,
      "Only the detail editor may receive input",
    );
    assert.equal(
      await detailDialog.getByLabel("模型 ID", { exact: true }).inputValue(),
      "alpha-new",
    );
    await page.screenshot({
      path: path.join(out, "v019-model-level3.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await detailDialog.waitFor({ state: "hidden" });
    assert.equal(
      await advanced.evaluate((e) => e === document.activeElement),
      true,
    );
    await section.waitFor();
    // Optimistic guard prevents stale drafts from overwriting a concurrent change.
    await row
      .getByLabel("alpha-new 显示名称", { exact: true })
      .fill("过时草稿");
    await app.evaluate(() => {
      const t = global.assTest,
        m = t.store.state.providers.find((p) => p.id === "work").models[0];
      t.store.model("work", { ...m, displayName: "最新配置" }, m.model);
    });
    await row.getByRole("button", { name: "保存", exact: true }).click();
    await row.getByRole("alert").waitFor();
    assert.match(await row.getByRole("alert").innerText(), /已变化/);
    await row.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(
      await row.getByLabel("alpha-new 显示名称", { exact: true }).inputValue(),
      "最新配置",
    );
    await app.evaluate(() => {
      global.assTest.confirm = 0;
    });
    await deleteModel("beta", false);
    await page.waitForTimeout(150);
    assert.equal(
      (await snapshot()).providers.find((p) => p.id === "work").models.length,
      2,
    );
    await app.evaluate(() => {
      global.assTest.confirm = 1;
      const t = global.assTest,
        save = t.store.save.bind(t.store);
      t.store.save = () => {
        t.store.save = save;
        throw Error("模拟写入失败");
      };
    });
    await deleteModel("beta");
    const deleteDialog = page.getByRole("dialog", {
      name: "删除此模型？",
      exact: true,
    });
    await deleteDialog
      .getByRole("alert")
      .filter({ hasText: "模拟写入失败" })
      .waitFor();
    assert.equal(
      (await snapshot()).providers.find((p) => p.id === "work").models.length,
      2,
    );
    assert.equal(
      JSON.parse(
        fs.readFileSync(path.join(data, "settings.json")),
      ).providers.find((p) => p.id === "work").models.length,
      2,
    );
    await page.screenshot({
      path: path.join(out, "v0111-delete-error.png"),
      animations: "disabled",
    });
    await deleteDialog
      .getByRole("button", { name: "确定", exact: true })
      .click();
    await page
      .getByRole("form", { name: "beta 行内配置", exact: true })
      .waitFor({ state: "hidden" });
    await section
      .getByRole("button", { name: "发现模型", exact: true })
      .click();
    let modal = page.getByRole("dialog", {
      name: "工作 API · 发现模型",
      exact: true,
    });
    await modal.getByLabel("搜索供应商可用模型").fill("new-model");
    await modal.getByRole("button", { name: "加入配置", exact: true }).click();
    await modal.getByRole("button", { name: "已添加", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await modal.waitFor({ state: "hidden" });
    assert.equal(
      await section
        .getByRole("button", { name: "发现模型", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await section
      .getByRole("button", { name: "手动添加", exact: true })
      .click();
    const manual = page.getByRole("dialog", { name: "添加模型", exact: true });
    await manual.getByLabel("模型 ID", { exact: true }).fill("manual-test");
    await manual.getByLabel("模型 ID", { exact: true }).press("Tab");
    await manual.getByRole("button", { name: "保存模型", exact: true }).click();
    await manual.waitFor({ state: "hidden" });
    await page
      .getByRole("form", { name: "manual-test 行内配置", exact: true })
      .waitFor();
    await deleteModel("manual-test");
    await page
      .getByRole("form", { name: "manual-test 行内配置", exact: true })
      .waitFor({ state: "hidden" });
    // Lightning remains model-specific and never submits the inline form.
    const modelCheck = row.getByRole("button", {
      name: "检测模型 alpha-new",
      exact: true,
    });
    assert.equal(await modelCheck.locator("svg").getAttribute("fill"), "none");
    await modelCheck.click();
    await row.getByText(/连接通过/).waitFor();
    await modelCheck.locator('svg[fill="currentColor"]').waitFor();
    assert.match(await modelCheck.getAttribute("class"), /passed/);
    assert.equal(
      (await app.evaluate(() => global.assTest.sent.filter((x) => x.model))).at(
        -1,
      ).model,
      "alpha-new",
    );
    await page.screenshot({
      path: path.join(out, "v017-model-edit-1380.png"),
      animations: "disabled",
    });
    for (const width of [1100, 1380, 1536]) {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0].setSize(width, 940),
        width,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: path.join(out, `v019-model-list-${width}.png`),
        animations: "disabled",
      });
      const centered = await page
        .locator(".provider-model-dialog")
        .boundingBox();
      await openAdvanced();
      await detailDialog.waitFor();
      await page.waitForFunction(() => {
        const list = document
          .querySelector(".provider-model-dialog")
          .getBoundingClientRect();
        const editor = document
          .querySelector(".provider-side-dialog")
          .getBoundingClientRect();
        return (
          list.right + 12 <= editor.left &&
          editor.right <= innerWidth &&
          Math.abs(list.top - editor.top) < 1
        );
      });
      const split = await page.locator(".provider-model-dialog").boundingBox();
      assert.ok(
        split.x < centered.x && split.width < centered.width,
        "List must shift left and yield width",
      );
      for (const selector of [
        ".provider-model-dialog",
        ".provider-side-dialog",
      ]) {
        assert.ok(
          await page
            .locator(selector)
            .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        );
        const rect = await page.locator(selector).boundingBox();
        assert.ok(rect.width >= 450 && rect.y > 0 && rect.height < 940);
      }
      await page.screenshot({
        path: path.join(out, `v019-model-split-${width}.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await detailDialog.waitFor({ state: "hidden" });
      await page.waitForFunction(
        (expected) =>
          Math.abs(
            document
              .querySelector(".provider-model-dialog")
              .getBoundingClientRect().width - expected,
          ) < 1,
        centered.width,
      );
      assert.equal(await page.locator("dialog[open]").count(), 1);
      assert.equal(
        await advanced.evaluate((e) => e === document.activeElement),
        true,
      );
    }
    for (let i = 0; i < 3; i++) {
      await openAdvanced();
      await detailDialog.waitFor();
      await page.keyboard.press("Escape");
      await detailDialog.waitFor({ state: "hidden" });
      assert.equal(await page.locator("dialog[open]").count(), 1);
    }
    await page
      .locator(".provider-model-dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page.locator(".provider-model-dialog").waitFor({ state: "hidden" });
    const pcard = page.getByRole("article", {
      name: "工作 API 供应商",
      exact: true,
    });
    await pcard
      .getByRole("button", { name: "工作 API 更多操作", exact: true })
      .click();
    await page.screenshot({
      path: path.join(out, "v017-provider-menu.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".provider-model-dialog").count(),
      0,
      "Closing a card menu must not open its card",
    );
    // Read-only native model sources use the same hierarchy without edit controls.
    const nativeCard = page.locator(
      '.supplier-card[data-provider-id="native-pi"]',
    );
    await nativeCard.scrollIntoViewIfNeeded();
    const galleryY = await page.evaluate(() => scrollY);
    await nativeCard.locator(".supplier-open").click();
    await page.locator(".native-model-row").waitFor();
    assert.equal(await page.locator(".inline-model").count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "手动添加", exact: true }).count(),
      0,
    );
    await page.keyboard.press("Escape");
    await page.locator(".provider-model-dialog").waitFor({ state: "hidden" });
    assert.ok(Math.abs((await page.evaluate(() => scrollY)) - galleryY) < 1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWork.click();
    await section.waitFor();
    await openAdvanced();
    await detailDialog.waitFor();
    assert.equal(
      await page
        .locator(".provider-model-dialog")
        .evaluate((e) => getComputedStyle(e).transitionDuration),
      "0s",
    );
    await page.keyboard.press("Escape");
    await detailDialog.waitFor({ state: "hidden" });
    await page.keyboard.press("Escape");
    await page.locator(".provider-model-dialog").waitFor({ state: "hidden" });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1100, 780),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(out, "v017-providers-1100.png"),
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "客户端与账户", exact: true })
      .click();
    await work.getByRole("button", { name: "下次启动使用", exact: true }).waitFor();
    await chooseClient("DeepSeek Harness");
    const deepAccount = page.getByRole("article", { name: "DeepSeek 账户", exact: true });
    await deepAccount
      .getByRole("button", { name: "DeepSeek 账户操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "移除此账户卡片", exact: true })
      .click();
    await deepAccount.waitFor({ state: "hidden" });
    assert.ok((await snapshot()).providers.some((p) => p.id === "deep"));
    await page.getByRole("button", { name: "添加账户", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /DeepSeek/ })
      .click();
    await deepAccount.waitFor();
    await deepAccount
      .getByRole("button", { name: "设为启动账户", exact: true })
      .click();
    await chooseClient("pi");
    // The per-client injection switch still uses the short, cancel-first confirmation.
    const toggle = page.getByRole("switch", {
      name: "pi ASS 接入",
      exact: true,
    });
    await toggle.click();
    modal = page.getByRole("dialog");
    assert.equal(await modal.getByRole("button").count(), 2);
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    assert.equal(await toggle.isChecked(), false);
    await stop();
    await launch();
    await page
      .locator(".client-heading h2")
      .filter({ hasText: "pi" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("article", { name: piAccount.label + " 账户", exact: true })
        .getByRole("button", { name: "下次启动使用", exact: true })
        .count(),
      1,
    );
    const restored = await snapshot();
    assert.deepEqual(
      restored.providers
        .find((p) => p.id === "work")
        .models.map((m) => m.model),
      ["alpha-new", "new-model"],
    );
    assert.equal(restored.preferences.view, "clients");
    for (const [file, content] of originals)
      assert.deepEqual(fs.readFileSync(file), content);
    for (const secret of [grant.access, grant.refresh, "synthetic-key"])
      assert.ok(!JSON.stringify(restored).includes(secret));
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        nativeHarnesses: 5,
        bindings: "isolated, automatic, unbind and restart",
        inline:
        "five fields, save/cancel, duplicate, stale, invalid, delete/cancel, provider exclusion survives rename",
        directory: "automatic and one-click add",
        hierarchy:
          "gallery/list/detail dialogs, right-side editor, left yield, restore width, no overlap, nested Escape/focus, direct links, drafts, manual add, readonly, reduced motion",
        modelCheck:
          "specific model only, outline before test and solid after result",
        screenshots: out,
        nativeCredentialsUntouched: true,
        pageErrors: 0,
      }),
    );
  } catch (e) {
    await page
      .screenshot({
        path: path.join(out, "v017-failure.png"),
        animations: "disabled",
      })
      .catch(() => {});
    throw e;
  } finally {
    await stop();
  }
}
run().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
