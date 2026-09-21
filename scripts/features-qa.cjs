// Real Electron UI, isolated profile/port, synthetic upstream. Never authorizes real accounts.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const output = path.join(process.env.LOCALAPPDATA, "ASS-validation", "ui");
fs.mkdirSync(output, { recursive: true });
const data = fs.mkdtempSync(path.join(output, "features-")),
  codex = path.join(data, "codex");
fs.mkdirSync(codex);
(async () => {
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
    const page = await app.firstWindow(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.waitForSelector("h1");
    await app.evaluate(({ dialog }) => {
      const t = global.assTest;
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: ["D:\\deepseek-harness"],
      });
      t.sentModels = [];
      t.setFetch(async (url, init) => {
        if (url.endsWith("/auth/keys"))
          return Response.json({ key: "synthetic-pkce-key" });
        if (url.endsWith("/models"))
          return Response.json({
            data: [
              { id: "probe-a", context_length: 65536, supports_tools: true },
              {
                id: "probe-new",
                context_length: 128000,
                reasoning_efforts: ["ultra"],
                input_modalities: ["text", "image"],
              },
            ],
          });
        const body = JSON.parse(init.body);
        t.sentModels.push(body.model);
        if (body.reasoning?.effort === "ass_invalid_effort")
          return Response.json(
            { error: { message: "invalid reasoning effort" } },
            { status: 400 },
          );
        const marker =
          typeof body.input === "string" &&
          body.input.match(/marker ([a-f0-9]+)/)?.[1];
        const content = body.tools
          ? [
              {
                type: "function_call",
                id: "call",
                name: "ass_probe_echo",
                arguments: JSON.stringify({ marker }),
              },
            ]
          : [
              {
                type: "message",
                content: [{ type: "output_text", text: "OK" }],
              },
            ];
        return new Response(
          "data: " +
            JSON.stringify({
              type: "response.completed",
              response: { status: "completed", output: content },
            }) +
            "\n\n",
          { headers: { "content-type": "text/event-stream" } },
        );
      });
      t.store.import({
        providers: [
          {
            id: "qa_models",
            name: "检测示例",
            baseUrl: "https://example.com/v1",
            apiKey: "synthetic-only",
            wireApi: "openai-responses",
            models: [
              { model: "probe-a", efforts: ["low", "max"] },
              { model: "probe-b" },
            ],
          },
        ],
      });
      t.openRouterAuth.openExternal = async (url) => {
        t.callbackUrl = new URL(url).searchParams.get("callback_url");
      };
    });
    await page.reload();
    await page.waitForSelector("h1");
    await page
      .getByRole("button", { name: "供应商与模型", exact: true })
      .click();
    await page
      .getByRole("article", { name: "检测示例 供应商", exact: true })
      .getByRole("button", { name: "查看 检测示例 的模型", exact: true })
      .click();
    await page
      .getByRole("form", { name: "probe-b 行内配置", exact: true })
      .getByRole("button", { name: "检测模型 probe-b", exact: true })
      .click();
    await page
      .getByRole("form", { name: "probe-b 行内配置", exact: true })
      .getByText("连接通过", { exact: false })
      .waitFor();
    const single = await app.evaluate(() => ({
      models: global.assTest.sentModels,
      diagnostics: global.assTest.snapshot().diagnostics,
    }));
    assert.deepEqual(single.models, ["probe-b"]);
    assert.equal(Object.keys(single.diagnostics).length, 1);
    assert.equal(
      single.diagnostics[JSON.stringify(["qa_models", "probe-b"])].ok,
      true,
    );
    await page
      .getByRole("region", { name: "检测示例 模型配置", exact: true })
      .getByRole("button", { name: "发现模型", exact: true })
      .click();
    await page
      .locator(".discovered-model")
      .filter({ hasText: "probe-new" })
      .getByRole("button", { name: "加入配置" })
      .click();
    await page
      .locator(".discovered-model")
      .filter({ hasText: "probe-new" })
      .getByRole("button", { name: "已添加" })
      .waitFor();
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog", { name: "检测示例 · 发现模型", exact: true })
      .waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "probe-a 模型操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "能力详情", exact: true }).click();
    await page.getByRole("button", { name: "自动检测能力" }).click();
    await page.getByText("已观察到有效调用", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("参数接受 · 非法值被拒", { exact: true }).count(),
      2,
    );
    await page.screenshot({
      path: path.join(output, "capabilities.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog", { name: /^模型能力/ })
      .waitFor({ state: "hidden" });
    await page.keyboard.press("Escape");
    await page.locator(".provider-model-dialog").waitFor({ state: "hidden" });
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
      (await app.evaluate(() => global.assTest.snapshot())).officialServices
        .length,
      19,
    );
    for (const [name, secret] of [
      ["OpenAI 工作账户", "synthetic-openai-key"],
      ["OpenAI 个人账户", "synthetic-personal-key"],
    ]) {
      await page.getByRole("button", { name: "添加账户", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "新建 API 账户", exact: true })
        .click();
      await page
        .getByRole("button", { name: "OpenAI API", exact: true })
        .click();
      await page.getByLabel("供应商名称", { exact: true }).fill(name);
      await page.getByLabel("API Key", { exact: true }).fill(secret);
      await page
        .getByRole("button", { name: "保存供应商", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page
        .getByRole("article", { name: name + " 账户", exact: true })
        .waitFor();
    }
    await page.getByRole("button", { name: "添加账户", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "原生授权账户", exact: true })
      .click();
    await page.getByLabel("账户名称", { exact: true }).fill("ChatGPT 工作授权");
    await page.getByRole("button", { name: "创建账户", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByText("ChatGPT 工作授权", { exact: true }).waitFor();
    const secretCheck = await app.evaluate(() => {
      const s = global.assTest.snapshot();
      return {
        apiAccounts: s.providers.filter(
          (p) => s.officialProviderIds[p.id] === "openai",
        ).length,
        redacted: !JSON.stringify(s).includes("synthetic-openai-key"),
        unique:
          new Set(s.providers.map((p) => p.id)).size === s.providers.length,
        bound: s.harnesses.clients
          .find((c) => c.id === "codex")
          .accounts.filter((a) => a.kind === "api").length,
      };
    });
    assert.deepEqual(secretCheck, {
      apiAccounts: 2,
      redacted: true,
      unique: true,
      bound: 2,
    });
    await page.screenshot({
      path: path.join(output, "bound-accounts.png"),
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "添加原生客户端 Key", exact: true })
      .click();
    await page.getByLabel("账户名称", { exact: true }).fill("Cursor 原生 Key");
    await page
      .getByLabel("API Key", { exact: true })
      .fill("synthetic-cursor-key");
    await page.getByRole("button", { name: "保存账户", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page
      .locator(".client-list")
      .getByRole("button", { name: /^Cursor / })
      .click();
    await page
      .getByRole("article", { name: "Cursor 原生 Key 账户", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("article", { name: "OpenAI 工作账户 账户", exact: true })
        .count(),
      0,
    );
    assert.ok(
      !fs
        .readFileSync(path.join(data, "native-accounts.json"), "utf8")
        .includes("synthetic-cursor-key"),
    );
    await page
      .locator(".client-list")
      .getByRole("button", { name: /^Codex / })
      .click();
    await page.getByRole("button", { name: "添加账户", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "新建 API 账户", exact: true })
      .click();
    await page.getByRole("button", { name: "开始授权", exact: true }).click();
    await page.getByRole("button", { name: "取消授权", exact: true }).waitFor();
    await app.evaluate(async () => {
      const callback = new URL(global.assTest.callbackUrl);
      callback.searchParams.set("code", "synthetic-code");
      await fetch(callback);
    });
    await page
      .getByText("API Key 已加密保存，请添加模型后使用。", { exact: true })
      .waitFor();
    assert.ok(
      !fs
        .readFileSync(path.join(data, "settings.json"), "utf8")
        .includes("synthetic-pkce-key"),
    );
    const pkce = await app.evaluate(() => {
      const s = global.assTest.snapshot(),
        p = s.providers.find(
          (p) => s.officialProviderIds[p.id] === "openrouter",
        );
      return s.harnesses.clients
        .find((c) => c.id === "codex")
        .accounts.some((a) => a.providerId === p.id);
    });
    assert.equal(pkce, true);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1100, 780),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page
      .getByRole("button", {
        name: /^DeepSeek Harness (已找到客户端|未检测到安装)$/,
      })
      .click();
    await page.getByText("客户端路径与凭据目录", { exact: true }).click();
    await page.getByRole("button", { name: "自动识别", exact: true }).click();
    if (await page.getByRole("dialog").isVisible())
      await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "选择目录", exact: true })
      .first()
      .click();
    const launcher = await app.evaluate(() =>
      global.assTest.harnesses.launcher("dsh"),
    );
    assert.equal(launcher.kind, "source-built");
    assert.equal(launcher.location.toLowerCase(), "d:\\deepseek-harness");
    assert.ok(launcher.args[0].endsWith("apps\\cli\\lib\\bin.js"));
    await page.screenshot({
      path: path.join(output, "dsh-directory.png"),
      animations: "disabled",
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        featureUI: "passed",
        officialServices: 19,
        multiAccount: "passed",
        pkce: "synthetic exchange passed",
        perModel: "passed",
        capabilityControl: "passed",
        directoryDetection: launcher.kind,
        errors: errors.length,
        screenshots: output,
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
