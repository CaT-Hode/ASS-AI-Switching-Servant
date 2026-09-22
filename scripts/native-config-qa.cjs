// Real Electron UI/DPAPI, isolated client homes, synthetic credentials only.
// Browser plugin not available; validate the native window using Playwright Electron.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  out = path.join(process.env.LOCALAPPDATA, "ASS-validation");
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, "native-config-")),
  home = path.join(data, "test-home");
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof value === "string" ? value : JSON.stringify(value),
  );
};
const grant = {
  type: "oauth",
  access: "synthetic-native-access",
  refresh: "synthetic-native-refresh",
  expires: 2100000000000,
};
write(path.join(home, ".pi/agent/auth.json"), { "openai-codex": grant });
write(path.join(home, ".pi/agent/settings.json"), {
  defaultProvider: "openai-codex",
  defaultModel: "original",
  theme: "light",
});
write(path.join(home, ".local/share/opencode/auth.json"), { openai: grant });
write(
  path.join(home, ".config/opencode/opencode.jsonc"),
  '// keep this comment\n{"model":"openai/original", "mcp":{"keep":{"enabled":true}}}\n',
);
write(
  path.join(home, ".dsh/.credentials.yaml"),
  "version: 1\nrecords:\n  llm-pi-ai/openai-codex:\n    kind: grant\n    payload: " +
    JSON.stringify(grant) +
    "\n",
);
write(path.join(data, "codex/auth.json"), {
  tokens: {
    access_token: grant.access,
    refresh_token: grant.refresh,
    account_id: "synthetic-account",
  },
});
const codexOriginal = fs.readFileSync(path.join(data, "codex/auth.json"));
let app, page;
const errors = [];
async function start() {
  const env = {
    ...process.env,
    ASS_TEST_DATA: data,
    ASS_TEST_CODEX: path.join(data, "codex"),
    ASS_TEST_PORT: "25836",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    ...(process.env.ASS_QA_EXE
      ? { executablePath: process.env.ASS_QA_EXE }
      : {}),
    args: process.env.ASS_QA_EXE ? ["--qa"] : [root, "--qa"],
    env,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
  await page.waitForSelector("h1");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1380, 940);
    global.assTest.setFetch(async () => new Response("{}", { status: 403 }));
  });
}
async function stop() {
  if (app) {
    const previous = app;
    app = null;
    await previous.evaluate(() => global.assTest.quit()).catch(() => {});
    await previous.close().catch(() => {});
  }
}
const call = (name, ...args) =>
  page.evaluate(([name, args]) => window.ass.call(name, ...args), [name, args]);
async function choose(name) {
  await page
    .locator(".client-list")
    .getByRole("button", { name: new RegExp(name) })
    .click();
  assert.equal(await page.locator(".client-injection").count(), 1);
}
async function toggle(name) {
  await page
    .getByRole("switch", { name: name + " ASS 接入", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("button", { name: "确定", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
}
(async () => {
  try {
    await start();
    const provider = await call("save-provider", {
      name: "Native QA",
      baseUrl: "https://api.example.test/v1",
      apiKey: "synthetic-upstream-key",
      wireApi: "openai-chat",
      enabled: true,
      models: [{ model: "qa-model", wireApi: "openai-chat" }],
    });
    for (const id of ["pi", "opencode", "dsh"]) {
      await assert.rejects(call("account-bind-api", id, provider), /官方 API/);
      await call("client-injection", id, { defaultModel: JSON.stringify([provider, "qa-model"]) });
    }
    await page
      .getByRole("button", { name: "客户端与账户", exact: true })
      .click();
    for (const [id, name] of [
      ["pi", "pi"],
      ["opencode", "OpenCode"],
      ["dsh", "DeepSeek Harness"],
    ]) {
      await choose(name);
      assert.equal(await page.getByRole("region", { name: name + " 模型接入", exact: true }).count(), 1);
      await toggle(name);
      const state = await call("snapshot"),
        client = state.connections.clients[id];
      assert.equal(client.enabled, true);
      assert.equal(client.mode, "native");
      assert.equal(client.pending, false);
      assert.equal(client.syncError, "");
      assert.equal(
        state.harnesses.clients
          .find((c) => c.id === id)
          .accounts.filter((a) => a.kind === "native").length,
        id === "pi" ? 1 : 0,
      );
    }
    assert.equal(
      await app.evaluate(() => !!global.assTest.router.server),
      false,
    );
    const state = await call("snapshot"),
      model = state.providers.find((p) => p.id === provider).models[0];
    await call(
      "save-model",
      provider,
      { ...model, contextWindow: 262144 },
      model.model,
      model,
    );
    for (const id of ["pi", "opencode", "dsh"])
      assert.equal(
        (await call("snapshot")).connections.clients[id].pending,
        true,
      );
    await choose("pi");
    await page.screenshot({
      path: path.join(out, "account-separation-native-config.png"),
      animations: "disabled",
    });
    assert.ok(
      !fs
        .readFileSync(path.join(data, "native-injections.enc.json"), "utf8")
        .includes("synthetic-upstream-key"),
    );
    await stop();
    await start();
    assert.equal(
      await app.evaluate(() => !!global.assTest.router.server),
      false,
    );
    const restarted = await call("snapshot");
    for (const id of ["pi", "opencode", "dsh"])
      assert.equal(restarted.connections.clients[id].pending, true);
    for (const id of ["pi", "opencode", "dsh"]) {
      const preview = await call("connection-preview", id, true);
      await call("connection-apply", { ticket: preview.ticket, mode: "safe", acknowledged: true });
    }
    // Simulate native OAuth refresh; an ASS model edit must preserve it.
    const authFile = path.join(home, ".pi/agent/auth.json"),
      auth = JSON.parse(fs.readFileSync(authFile));
    auth["openai-codex"].access = "synthetic-rotated-access";
    write(authFile, auth);
    const current = restarted.providers.find((p) => p.id === provider)
      .models[0];
    await call(
      "save-model",
      provider,
      { ...current, displayName: "New label" },
      current.model,
      current,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(authFile))["openai-codex"].access,
      "synthetic-rotated-access",
    );
    const resync = await call("connection-preview", "pi", true);
    await call("connection-apply", { ticket: resync.ticket, mode: "safe", acknowledged: true });
    const modelsFile = path.join(home, ".pi/agent/models.json"),
      models = JSON.parse(fs.readFileSync(modelsFile));
    const key = Object.keys(models.providers)[0];
    models.providers[key].models[0].name = "External edit";
    write(modelsFile, models);
    const changed = (await call("snapshot")).providers.find(
      (p) => p.id === provider,
    ).models[0];
    await call(
      "save-model",
      provider,
      { ...changed, displayName: "Saved but pending" },
      changed.model,
      changed,
    );
    assert.match(
      (await call("snapshot")).connections.clients.pi.syncError,
      /外部修改/,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(modelsFile)).providers[key].models[0].name,
      "External edit",
    );
    models.providers[key].models[0].name = "New label";
    write(modelsFile, models);
    await page
      .getByRole("button", { name: "客户端与账户", exact: true })
      .click();
    await choose("pi");
    await page
      .getByRole("button", { name: "同步 pi 原生配置", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确定", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal((await call("snapshot")).connections.clients.pi.syncError, "");
    await choose("DeepSeek Harness");
    await page.getByRole("button", { name: "添加账户", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "新建 API 账户", exact: true }).click();
    assert.equal(await page.getByRole("dialog").getByRole("button", { name: /DeepSeek 官方/ }).count(), 1);
    assert.equal(await page.getByRole("dialog").getByText("自定义 API", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("dialog").getByText("OpenRouter 浏览器授权", { exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await choose("Codex");
    await page.getByRole("button", { name: "添加账户", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "新建 API 账户", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: /OpenAI API/ }).click();
    await page.getByRole("dialog").getByLabel("账户名称", { exact: true }).fill("QA 官方 API");
    await page.getByRole("dialog").getByLabel("API Key", { exact: true }).fill("synthetic-official-new");
    await page.getByRole("dialog").getByRole("button", { name: "保存账户", exact: true }).click();
    await page.keyboard.press("Escape");
    const officialCard = page.getByRole("article", { name: "QA 官方 API 账户", exact: true });
    await officialCard.waitFor();
    const officialState = await call("snapshot");
    assert.equal(officialState.connections.clients.codex.enabled, false);
    assert.equal(officialState.harnesses.clients.find((c) => c.id === "codex").accounts.find((a) => a.label === "QA 官方 API").ready, true);
    await officialCard.getByRole("button", { name: "设为启动账户", exact: true }).click();
    await officialCard.getByText("下次启动使用", { exact: true }).waitFor();
    assert.deepEqual(fs.readFileSync(path.join(data, "codex/auth.json")), codexOriginal);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, "account-separation-official-account.png"), animations: "disabled" });
    // Real exit path keeps native configuration while restoring proxy-only clients.
    const quit = await call("connection-preview", "all", false, true);
    assert.equal(quit.retainedNative.length, 3);
    await call("connection-apply", {
      ticket: quit.ticket,
      mode: "safe",
      acknowledged: true,
    }).catch(() => {});
    await app.close().catch(() => {});
    app = null;
    await start();
    assert.equal((await call("snapshot")).connections.clients.pi.enabled, true);
    assert.ok(
      Object.keys(JSON.parse(fs.readFileSync(authFile))).some((k) =>
        k.startsWith("ass-"),
      ),
    );
    await page
      .getByRole("button", { name: "客户端与账户", exact: true })
      .click();
    for (const name of ["pi", "OpenCode", "DeepSeek Harness"]) {
      await choose(name);
      await toggle(name);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(authFile)), {
      "openai-codex": { ...grant, access: "synthetic-rotated-access" },
    });
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(home, ".pi/agent/settings.json")))
        .defaultModel,
      "original",
    );
    assert.deepEqual(
      fs.readFileSync(path.join(data, "codex/auth.json")),
      codexOriginal,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        nativeClients: 3,
        routerStarted: false,
        nativeOAuthPreserved: true,
        conflictAndRetry: true,
        DPAPI: true,
        exitRetainsNative: true,
        disconnectRestoresFields: true,
        codexUntouched: true,
        accountPolicy: true,
        pendingDoesNotAutoApply: true,
        pageErrors: 0,
      }),
    );
  } catch (e) {
    await page
      ?.screenshot({ path: path.join(out, "native-config-failure.png") })
      .catch(() => {});
    throw e;
  } finally {
    await stop();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
