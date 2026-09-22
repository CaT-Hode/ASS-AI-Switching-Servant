// Offline native readers: synthetic credentials, no logins, installs or model requests.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { HarnessManager } = require("../core/harnesses.cjs");
const { NativeConfig, locations, providerId } = require("../core/native-config.cjs");
const { parseImport } = require("../core/models.cjs");
const { modelRef } = require("../core/client-policy.cjs");
const out = path.join(process.env.LOCALAPPDATA, "ASS-validation"), clients = process.env.ASS_QA_CLIENTS;
if (!clients) throw Error("Set ASS_QA_CLIENTS to the validation node_modules directory");
fs.mkdirSync(out, { recursive: true });
const root = fs.mkdtempSync(path.join(out, "native-readers-")), home = path.join(root, "home"), codex = path.join(root, "codex");
fs.mkdirSync(home); fs.mkdirSync(codex);
const providers = parseImport({ providers: [
  { id: "synthetic", baseUrl: "https://example.test/v1", apiKey: "synthetic-model-key", models: [{ model: "test-chat", wireApi: "openai-chat" }] },
  { id: "deep", baseUrl: "https://api.deepseek.com", apiKey: "synthetic-official-deep-key", models: [] },
  { id: "go", baseUrl: "https://opencode.ai/zen/go/v1", apiKey: "synthetic-official-go-key", models: [] },
] });
const nativeEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, USERPROFILE: home, HOME: home, APPDATA: path.join(home, "AppData/Roaming"), LOCALAPPDATA: path.join(home, "AppData/Local"), TEMP: root, TMP: root };
const manager = new HarnessManager(root, () => ({ providers }), [], codex, { home, env: nativeEnv, isConnected: () => true });
const crypt = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
const native = manager.options.nativeConfig = new NativeConfig(root, crypt, manager);
const id = providerId(providers[0], "openai-chat");
const load = (file) => import(pathToFileURL(file).href);
function run(exe, args, env, combined = false) {
  const r = spawnSync(exe, args, { env, cwd: root, encoding: "utf8", windowsHide: true, timeout: 50000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0, r.error?.message || (r.stderr || "").slice(-1200));
  return combined ? r.stdout + r.stderr : r.stdout;
}
(async () => {
  const pi = path.join(clients, "@mariozechner/pi-coding-agent");
  manager.setExecutable("pi", path.join(clients, ".bin/pi.cmd"));
  await manager.refreshOAuth();
  assert.ok(manager.piProviders.some((p) => p.id === "openai-codex"));
  native.sync("pi");
  const { AuthStorage } = await load(path.join(pi, "dist/core/auth-storage.js"));
  const { ModelRegistry } = await load(path.join(pi, "dist/core/model-registry.js"));
  const target = locations("pi", manager), auth = AuthStorage.create(target.auth);
  const registry = ModelRegistry.create(auth, target.config);
  assert.equal(registry.getError(), undefined);
  const model = registry.getAvailable().find((m) => m.id === "test-chat" && m.provider === id);
  assert.ok(model);
  assert.equal((await registry.getApiKeyAndHeaders(model)).apiKey, "synthetic-model-key");
  const plan = manager.modelPlan("pi", modelRef("synthetic", "test-chat"));
  assert.match(run(process.execPath, [path.join(pi, "dist/cli.js"), "--list-models", "test-chat"], { ...plan.env, PI_OFFLINE: "1" }, true), /test-chat/);
  const source = JSON.stringify({ tokens: { access_token: "h." + Buffer.from('{"exp":2100000000}').toString("base64url") + ".s", refresh_token: "synthetic-refresh", account_id: "synthetic-account" } });
  fs.writeFileSync(path.join(codex, "auth.json"), source);
  const imported = manager.importOAuth("local-codex", "Synthetic Codex import");
  const importedAuth = AuthStorage.create(path.join(manager.root("pi", imported), "auth.json"));
  assert.deepEqual(importedAuth.getAuthStatus("openai-codex"), { configured: true, source: "stored" });
  assert.equal(importedAuth.getAll()["openai-codex"].accountId, "synthetic-account");
  assert.deepEqual(importedAuth.drainErrors(), []);
  assert.equal(fs.readFileSync(path.join(codex, "auth.json"), "utf8"), source);
  console.log(JSON.stringify({ pi: JSON.parse(fs.readFileSync(path.join(pi, "package.json"))).version, modelRegistry: true, modelCredential: true, oauthImportRead: true }));
  native.sync("opencode");
  const open = manager.plan("opencode", "api:go");
  manager.materialize(open);
  const exe = ["opencode-windows-x64/bin/opencode.exe", "opencode-ai/bin/opencode.exe"].map((s) => path.join(clients, s)).find(fs.existsSync);
  const openEnv = { ...open.env, OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true" };
  const config = JSON.parse(run(exe, ["debug", "config"], openEnv));
  assert.equal(config.provider[id].models["test-chat"].name, "test-chat");
  const api = JSON.parse(fs.readFileSync(path.join(open.dir, "data/opencode/auth.json")));
  assert.equal(api["opencode-go"].key, "synthetic-official-go-key");
  assert.equal(api[id].key, "synthetic-model-key");
  assert.ok(run(exe, ["debug", "paths"], openEnv).includes(open.dir));
  console.log(JSON.stringify({ opencode: run(exe, ["--version"], openEnv).trim(), nativeConfig: true, officialAndModelCredentialsSeparate: true }));
  const sourceDir = process.env.ASS_QA_DSH_SOURCE;
  if (!sourceDir) throw Error("Set ASS_QA_DSH_SOURCE to the existing built DSH source checkout");
  const requireDsh = createRequire(path.join(sourceDir, "apps/cli/package.json"));
  const sdk = (name) => load(requireDsh.resolve(name));
  const { Context } = await sdk("@deepseek-ai/cordis");
  const { default: z } = await sdk("@deepseek-ai/schemastery");
  const { FileSettingsProvider } = await sdk("@deepseek-ai/dsh-settings-file");
  const { LocalCredentialProvider } = await sdk("@deepseek-ai/dsh-credentials-local");
  const { credentialRef, credentialKey } = await load(path.join(sourceDir, "packages/credentials/credentials/lib/index.js"));
  const { Config: PiConfig } = await load(path.join(sourceDir, "packages/llm/llm-pi-ai/lib/index.js"));
  native.sync("dsh");
  const account = manager.plan("dsh", "api:deep");
  manager.materialize(account);
  const ctx = new Context(), credentialFiber = ctx.plugin(LocalCredentialProvider, { path: path.join(account.dir, ".credentials.yaml"), watch: false });
  const modelPlan = manager.modelPlan("dsh", modelRef("synthetic", "test-chat"));
  manager.materialize(modelPlan);
  const settingsFile = modelPlan.launchFiles[0][0], settingsFiber = ctx.plugin(FileSettingsProvider, { path: settingsFile, watch: false });
  try {
    await credentialFiber; await settingsFiber;
    assert.equal((await ctx.credentials.describe(credentialRef("DEEPSEEK_API_KEY"))).configured, true);
    assert.equal((await ctx.credentials.readRecord(credentialKey("llm-pi-ai", id))).key, "synthetic-model-key");
    assert.equal(ctx.settings.register("llm-pi-ai", PiConfig).get().providers[id].models[0].id, "test-chat");
    const selected = ctx.settings.register("agent-default-model", z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string() })).get();
    assert.equal(selected.provider, id); assert.equal(selected.model, "test-chat");
  } finally { await settingsFiber.dispose(); await credentialFiber.dispose(); }
  const bin = path.join(sourceDir, "apps/cli/lib/bin.js");
  const dump = run(process.execPath, [bin, ...modelPlan.args, "--dump-config"], { ...modelPlan.env, DSH_TELEMETRY_DISABLED: "1" });
  assert.ok(dump.includes(settingsFile) || dump.includes(settingsFile.replaceAll("\\", "/")));
  console.log(JSON.stringify({ dsh: run(process.execPath, [bin, "--version"], modelPlan.env).trim(), settingsReader: true, credentialsReader: true, launchOverlayComposed: true, modelRequests: 0 }));
})().catch((e) => { console.error(e.stack); process.exitCode = 1; });
