// Requires optional native clients in ASS_QA_CLIENTS. All profiles are isolated.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { HarnessManager } = require("../core/harnesses.cjs");
const { parseImport } = require("../core/models.cjs");
const root = path.join(process.env.LOCALAPPDATA, "ASS-validation", "harness"),
  clients = process.env.ASS_QA_CLIENTS;
if (!clients)
  throw Error("Set ASS_QA_CLIENTS to the validation node_modules directory");
fs.mkdirSync(root, { recursive: true });
const providers = parseImport({
  providers: [
    {
      id: "synthetic",
      name: "Test API",
      baseUrl: "https://example.com",
      apiKey: "not-real",
      wireApi: "openai-chat",
      models: [{ model: "test-chat", wireApi: "openai-chat" }],
    },
  ],
});
const codexDir = fs.mkdtempSync(path.join(root, "synthetic-codex-"));
const manager = new HarnessManager(root, () => ({ providers }), [], codexDir);
function run(exe, args, env) {
  const r = spawnSync(exe, args, {
    env,
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 50000,
  });
  return {
    code: r.status,
    error: r.error?.message,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}
(async () => {
  const pi = path.join(clients, "@mariozechner/pi-coding-agent/dist/cli.js"),
    piCmd = path.join(clients, ".bin/pi.cmd");
  manager.setExecutable("pi", piCmd);
  await manager.refreshOAuth();
  assert.ok(manager.piProviders.some((p) => p.id === "openai-codex"));
  console.log(
    JSON.stringify({ piOAuth: manager.piProviders.map((p) => p.id) }),
  );
  const plan = manager.plan(
    "pi",
    "api:synthetic",
    "launch",
    "test-chat",
    "synthetic-local-token",
  );
  manager.materialize(plan);
  plan.env.PI_OFFLINE = "1";
  const p = run(process.execPath, [pi, "--list-models", "test-chat"], plan.env);
  console.log(
    JSON.stringify({
      client: "pi",
      code: p.code,
      found: (p.stdout + p.stderr).includes("test-chat"),
    }),
  );
  assert.equal(p.code, 0);
  assert.match(p.stdout + p.stderr, /test-chat/);
  const source = JSON.stringify({
    tokens: {
      access_token:
        "h." + Buffer.from('{"exp":2000000000}').toString("base64url") + ".s",
      refresh_token: "synthetic-refresh-not-valid",
      account_id: "synthetic-account",
    },
  });
  fs.writeFileSync(path.join(codexDir, "auth.json"), source);
  const imported = manager.importOAuth("local-codex", "Synthetic Codex import");
  const { AuthStorage } = await import(
    pathToFileURL(
      path.join(
        clients,
        "@mariozechner/pi-coding-agent/dist/core/auth-storage.js",
      ),
    ).href
  );
  const auth = AuthStorage.create(
    path.join(manager.root("pi", imported), "auth.json"),
  );
  assert.deepEqual(auth.getAuthStatus("openai-codex"), {
    configured: true,
    source: "stored",
  });
  assert.equal(auth.getAll()["openai-codex"].type, "oauth");
  assert.equal(auth.getAll()["openai-codex"].accountId, "synthetic-account");
  assert.deepEqual(auth.drainErrors(), []);
  assert.equal(
    fs.readFileSync(path.join(codexDir, "auth.json"), "utf8"),
    source,
  );
  console.log(
    JSON.stringify({
      piNativeOAuthRead: "passed",
      sourceUnchanged: true,
      networkRefresh: false,
    }),
  );
  const open = manager.plan(
    "opencode",
    "api:synthetic",
    "launch",
    "test-chat",
    "synthetic-local-token",
  );
  manager.materialize(open);
  const exe = path.join(clients, "opencode-windows-x64/bin/opencode.exe");
  const o = run(exe, ["debug", "config"], open.env);
  let config;
  try {
    config = JSON.parse(o.stdout);
  } catch {}
  console.log(
    JSON.stringify({
      client: "opencode",
      code: o.code,
      model: config?.model,
      error: o.stderr.slice(-500),
    }),
  );
  assert.equal(config?.model, "ass/test-chat");
  const paths = run(exe, ["debug", "paths"], open.env);
  assert.ok(paths.stdout.includes(open.dir));
  console.log(JSON.stringify({ openCodeProfileIsolation: true }));
  const d = manager.plan(
    "dsh",
    "api:synthetic",
    "launch",
    "test-chat",
    "synthetic-local-token",
  );
  manager.materialize(d);
  const dsh = path.join(clients, "@deepseek-ai/dsh/lib/bin.js");
  const v = run(process.execPath, [dsh, "--version"], d.env);
  console.log(
    JSON.stringify({
      client: "dsh",
      version: v.stdout.trim(),
      config: JSON.parse(
        fs.readFileSync(path.join(d.dir, "settings.yaml"), "utf8"),
      )["agent-default-model"].model,
    }),
  );
  assert.equal(v.code, 0);
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
