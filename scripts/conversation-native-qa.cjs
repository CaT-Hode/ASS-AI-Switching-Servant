// Native resume against a local mock endpoint and two synthetic OAuth logins.
// Never reads the user's real auth/config or starts/stops their desktop client.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http"), crypto = require("node:crypto");
const { spawn } = require("node:child_process"), assert = require("node:assert/strict");
const { Router } = require("../core/router.cjs");
const { ConversationLibrary } = require("../core/conversations.cjs");
const { ProjectConversations } = require("../core/project-conversations.cjs");
const { prepareConfig, atomic } = require("../core/config.cjs");
const { makeCatalog } = require("../core/models.cjs");
const { isolatedEnv } = require("../core/harnesses.cjs");
const jwt = (user) => "header." + Buffer.from(JSON.stringify({ exp: 2100000000, sub: user,
  "https://api.openai.com/auth": { chatgpt_account_id: user, chatgpt_user_id: user, chatgpt_plan_type: "plus" } })).toString("base64url") + ".synthetic";
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value)); };
function run(binary, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (s) => { stdout = (stdout + s).slice(-256000); });
    child.stderr.on("data", (s) => { stderr = (stderr + s).slice(-8000); });
    const timer = setTimeout(() => child.kill(), 35000);
    child.once("error", (e) => { clearTimeout(timer); reject(e); });
    child.once("exit", (code) => { clearTimeout(timer); if (code !== 0) reject(Error(`native resume failed (${code}): ${stderr.slice(-4000)} ${stdout.slice(-1000)}`)); else resolve(stdout); });
  });
}
(async () => {
  const [codexBinary, claudeBinary] = process.argv.slice(2);
  if (!codexBinary || !path.isAbsolute(codexBinary) || !fs.statSync(codexBinary).isFile()) throw Error("Pass an absolute Codex binary, optionally a Claude Code CLI binary");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ass-conversation-native-")), workspace = path.join(root, "project"); fs.mkdirSync(workspace);
  const encryptionKey = crypto.randomBytes(32), encryption = { isEncryptionAvailable: () => true,
    encryptString: (s) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv), bytes = Buffer.concat([c.update(s), c.final()]); return Buffer.concat([iv, c.getAuthTag(), bytes]); },
    decryptString: (b) => { const c = crypto.createDecipheriv("aes-256-gcm", encryptionKey, b.subarray(0, 12)); c.setAuthTag(b.subarray(12, 28)); return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(); } };
  const sources = [], library = new ConversationLibrary({ dataDir: root, crypto: encryption, sources: () => sources });
  let calls = [];
  const router = new Router({ getState: () => ({ providers: [] }), fetchUpstream: async (_, options) => {
    const body = JSON.parse(options.body); calls.push({ auth: options.headers.authorization, body });
    const message = { id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] };
    const response = { id: "resp_fixture", object: "response", status: "completed", model: body.model, output: [message], usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } };
    const events = [{ type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.added", item: message, output_index: 0 }, { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: message.id, delta: "OK" },
      { type: "response.output_item.done", output_index: 0, item: message }, { type: "response.completed", response }];
    return new Response(events.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
  } });
  let server;
  try {
    await router.start(0);
    function codexHome(user) {
      const dir = path.join(root, "codex-" + user), catalog = path.join(dir, "catalog.json");
      atomic(catalog, JSON.stringify(makeCatalog([], [])));
      atomic(path.join(dir, "config.toml"), prepareConfig("", catalog, `http://127.0.0.1:${router.port}/clients/ASS/v1`).text);
      write(path.join(dir, "auth.json"), { auth_mode: "chatgpt", tokens: { access_token: jwt(user), id_token: jwt(user), refresh_token: "synthetic-refresh-" + user, account_id: user }, last_refresh: new Date().toISOString() });
      sources.push({ harness: "codex", dir }); return dir;
    }
    const firstHome = codexHome("alice"), envA = isolatedEnv("codex", firstHome);
    const common = ["--skip-git-repo-check", "--json", "-c", 'model_provider="openai"', "-c", "analytics.enabled=false", "-c", "features.connectors=false", "-m", "gpt-6-astra"];
    const first = await run(codexBinary, ["exec", ...common, "Initial conversation. Reply OK without tools."], envA, workspace);
    const id = first.split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }).find((r) => r.type === "thread.started")?.thread_id;
    assert.ok(id); await library.preserve("codex"); const row = (await library.list()).items.find((r) => r.sessionId === id); assert.ok(row);
    const original = fs.readFileSync(row.file), secondHome = codexHome("bob"), staged = await library.stage(row.id, secondHome);
    calls = [];
    const resumed = await run(codexBinary, ["exec", "resume", id, ...common, "Resume the earlier conversation. Reply OK without tools."], isolatedEnv("codex", secondHome), workspace);
    assert.match(resumed, /turn.completed/); assert.ok(calls.length && calls.every((c) => c.auth === "Bearer " + jwt("bob")));
    assert.ok(calls.some((c) => JSON.stringify(c.body).includes("Initial conversation")));
    assert.deepEqual(fs.readFileSync(row.file), original); assert.equal(staged.copied, true);
    const results = [{ client: "codex", originalUnchanged: true, historyReused: true, currentOAuth: "synthetic-bob", resumed: true }];
    if (claudeBinary) {
      if (!path.isAbsolute(claudeBinary) || !fs.statSync(claudeBinary).isFile()) throw Error("Invalid Claude Code binary");
      let ccCalls = [];
      server = http.createServer(async (req, res) => {
        let raw = ""; for await (const s of req) raw += s;
        if (!req.url.startsWith("/v1/messages") || req.url.includes("count_tokens")) { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ input_tokens: 5, models: [], data: [] })); }
        const body = JSON.parse(raw); ccCalls.push({ auth: req.headers.authorization, body });
        res.setHeader("Content-Type", "text/event-stream");
        const msg = { id: "msg_ass", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 1 } };
        const events = [{ type: "message_start", message: msg }, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } }, { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }, { type: "message_stop" }];
        res.end(events.map((e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join(""));
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      function claudeHome(user) {
        const dir = path.join(root, "claude-" + user);
        write(path.join(dir, ".credentials.json"), { claudeAiOauth: { accessToken: "synthetic-oauth-" + user, refreshToken: "synthetic-refresh-" + user, expiresAt: Date.now() + 36000000,
          scopes: ["user:inference", "user:profile"], subscriptionType: "max" } });
        write(path.join(dir, ".claude.json"), { hasCompletedOnboarding: true, oauthAccount: { accountUuid: user, organizationUuid: "synthetic-org", emailAddress: user + "@example.invalid" },
          projects: { [workspace]: { hasTrustDialogAccepted: true } } });
        write(path.join(dir, "settings.json"), { cleanupPeriodDays: 9999 });
        sources.push({ harness: "claude", dir });
        const env = { ...isolatedEnv("claude", dir), ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" };
        delete env.CLAUDE_CODE_SKIP_PROMPT_HISTORY; delete env.CLAUDE_CODE_PROJECT_DIR_NAME;
        return { dir, env };
      }
      const a = claudeHome("alice"), cli = ["-p", "--output-format", "json", "--model", "claude-sonnet-4-6", "--max-turns", "1", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'];
      const fresh = JSON.parse(await run(claudeBinary, [...cli, "--", "Initial CC conversation. Reply OK without tools."], a.env, workspace));
      assert.equal(fresh.is_error, false); assert.ok(fresh.session_id); await library.preserve("claude");
      const ccRow = (await library.list({ harness: "claude", refresh: true })).items.find((r) => r.sessionId === fresh.session_id); assert.ok(ccRow);
      const ccOriginal = fs.readFileSync(ccRow.file), b = claudeHome("bob"), current = await library.stage(ccRow.id, b.dir); ccCalls = [];
      const continued = JSON.parse(await run(claudeBinary, [...cli, "--resume", current.file, "--", "Resume the earlier CC conversation. Reply OK without tools."], b.env, workspace));
      assert.equal(continued.is_error, false); assert.ok(ccCalls.length && ccCalls.every((c) => c.auth === "Bearer synthetic-oauth-bob"));
      assert.ok(ccCalls.some((c) => JSON.stringify(c.body).includes("Initial CC conversation")));
      // Explicit path resumption may append to its original JSONL. The prior
      // history must remain a byte-for-byte prefix, and old auth is untouched.
      assert.ok(fs.readFileSync(ccRow.file).subarray(0, ccOriginal.length).equals(ccOriginal));
      assert.equal(JSON.parse(fs.readFileSync(path.join(a.dir, ".credentials.json"))).claudeAiOauth.accessToken, "synthetic-oauth-alice");
      results.push({ client: "claude", priorHistoryUnchanged: true, historyReused: true, currentOAuth: "synthetic-bob", resumed: true });
      const shared = new ProjectConversations({ dataDir: root, crypto: encryption, sources: () => sources });
      const project = (await shared.list()).items.find((p) => p.cwd === workspace); assert.ok(project);
      await shared.configure(project.id, { enabled: true });
      const thread = shared.project(project.id).threads.find((t) => t.origins.some((o) => o.harness === "codex" && o.sessionId === id)); assert.ok(thread);
      const ccProjection = await shared.prepare(project.id, thread.id, "claude", b.dir); ccCalls = [];
      const crossCC = JSON.parse(await run(claudeBinary, [...cli, "--resume", ccProjection.nativeFile, "--", "Cross-harness CC continuation. Reply OK without tools."], b.env, workspace));
      assert.equal(crossCC.is_error, false); assert.ok(ccCalls.some((c) => JSON.stringify(c.body).includes("Initial conversation")));
      assert.ok(ccCalls.every((c) => c.auth === "Bearer synthetic-oauth-bob"));
      await shared.sync(project.id);
      const sharedPreview = await shared.preview(project.id, thread.id);
      if (!sharedPreview.messages.some((m) => m.text.includes("Cross-harness CC continuation"))) {
        const codecs = require("../core/project-codecs.cjs");
        console.error(JSON.stringify({ diagnostic: "CC collection", sharedCount: sharedPreview.total,
          ccRecords: codecs.discover(sources, { cwd: workspace, includeMessages: true }).rows.filter((r) => r.harness === "claude").map((r) => ({ id: r.sessionId, count: r.messages.length, marker: r.messages.some((m) => m.text.includes("Cross-harness CC continuation")), pending: r.pending })),
          tail: codecs.lines(ccProjection.nativeFile).slice(-8).map((r) => ({ type: r.type, subtype: r.subtype, id: r.uuid, parent: r.parentUuid, side: r.isSidechain, stop: r.message?.stop_reason, marker: JSON.stringify(r.message?.content || "").includes("Cross-harness CC continuation") })) }));
        throw Error("Completed native CC turn was not collected");
      }
      const codexProjection = await shared.prepare(project.id, thread.id, "codex", secondHome); calls = [];
      const crossCodex = await run(codexBinary, ["exec", "resume", codexProjection.sessionId, ...common, "Return from CC to Codex. Reply OK without tools."], isolatedEnv("codex", secondHome), workspace);
      assert.match(crossCodex, /turn.completed/);
      const crossId = crossCodex.split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }).find((r) => r.type === "thread.started")?.thread_id;
      if (!calls.some((c) => JSON.stringify(c.body).includes("Cross-harness CC continuation"))) console.error(JSON.stringify({ diagnostic: "Codex projection", expectedId: codexProjection.sessionId, actualId: crossId, sharedCount: sharedPreview.total, projectionCount: require("../core/project-codecs.cjs").readConversation({ harness: "codex", file: codexProjection.nativeFile }).messages.length, requestInputs: calls.map((c) => c.body.input?.length), file: path.basename(codexProjection.nativeFile) }));
      assert.equal(crossId, codexProjection.sessionId); assert.ok(calls.some((c) => JSON.stringify(c.body).includes("Cross-harness CC continuation")));
      assert.ok(calls.every((c) => c.auth === "Bearer " + jwt("bob")));
      results.push({ client: "codex -> CC -> codex", historyReused: true, currentOAuth: "synthetic-bob", resumed: true, hardlink: ccProjection.mode === "hardlink" });
      if (process.env.ASS_QA_DSH_CATALOG) {
        const { pathToFileURL } = require("node:url"), codecs = require("../core/project-codecs.cjs"), zlib = require("node:zlib");
        const { sessionFormatCatalog } = await import(pathToFileURL(process.env.ASS_QA_DSH_CATALOG).href);
        const projected = await shared.prepare(project.id, thread.id, "dsh", path.join(root, "dsh"));
        const rows = zlib.zstdDecompressSync(fs.readFileSync(projected.nativeFile)).toString().trim().split("\n").map(JSON.parse);
        const restore = sessionFormatCatalog.createRestore(rows[0], { recovery: "strict", validation: "current" });
        for (const row of rows.slice(1)) restore.decodeRow(row);
        const restored = restore.finish(); assert.ok(JSON.stringify(restored).includes("Cross-harness CC continuation"));
        results.push({ client: "DSH native strict format validator", accepted: true, version: sessionFormatCatalog.currentVersion });
      }
      if (process.env.ASS_QA_CLIENTS) {
        const { pathToFileURL } = require("node:url"), codecs = require("../core/project-codecs.cjs"), clients = process.env.ASS_QA_CLIENTS;
        const piModule = ["@mariozechner/pi-coding-agent", "@earendil-works/pi-coding-agent"].map((p) => path.join(clients, p, "dist/core/session-manager.js")).find(fs.existsSync);
        assert.ok(piModule); const { SessionManager } = await import(pathToFileURL(piModule).href);
        const piHome = path.join(root, "pi"), piProjection = await shared.prepare(project.id, thread.id, "pi", piHome);
        const session = SessionManager.open(piProjection.nativeFile, path.dirname(piProjection.nativeFile));
        assert.ok(JSON.stringify(session.buildSessionContext().messages).includes("Cross-harness CC continuation"));
        session.appendMessage({ role: "user", content: [{ type: "text", text: "Native pi continuation" }], timestamp: Date.now() });
        session.appendMessage({ role: "assistant", api: "openai-responses", provider: "openai", model: "synthetic", content: [{ type: "text", text: "Native pi persisted answer" }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
        sources.push({ harness: "pi", dir: piHome }); await shared.sync(project.id);
        assert.ok((await shared.preview(project.id, thread.id)).messages.some((m) => m.text === "Native pi persisted answer"));
        results.push({ client: "pi native SessionManager", contextAccepted: true, nativeWriteCollected: true });
        const exe = ["opencode-windows-x64/bin/opencode.exe", "opencode-ai/bin/opencode.exe"].map((p) => path.join(clients, p)).find(fs.existsSync); assert.ok(exe);
        const openHome = path.join(root, "xdg", "opencode"), projection = await shared.prepare(project.id, thread.id, "opencode", openHome);
        const env = { ...isolatedEnv("opencode", openHome), XDG_DATA_HOME: path.dirname(openHome), OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true" };
        assert.match(await run(exe, ["import", projection.file], env, workspace), /Imported session:/);
        const exported = JSON.parse(await run(exe, ["export", projection.sessionId], env, workspace));
        assert.deepEqual(codecs.decodeOpenCode(exported).messages.map((m) => m.text), (await shared.preview(project.id, thread.id)).messages.map((m) => m.text));
        sources.push({ harness: "opencode", dir: openHome }); await shared.sync(project.id);
        assert.equal(shared.project(project.id).threads.filter((t) => t.id === thread.id).length, 1);
        results.push({ client: "OpenCode native import/export", contextAccepted: true, orderPreserved: true, DBReadCollected: true });
        shared.releaseImports = async (plan) => {
          for (const item of [...plan.returns, ...plan.imports]) {
            assert.equal(item.dir, openHome);
            await run(exe, item.signature ? ['session', 'delete', item.sessionId] : ['import', item.file], env, workspace);
          }
        };
        const nativeOriginal = fs.readFileSync(row.file);
        const pendingHomes = shared.project(project.id).threads.filter((t) => codecs.readConversation(t.home).pending);
        if (pendingHomes.length) console.error(JSON.stringify({ diagnostic: 'release pending homes', rows: pendingHomes.map((t) => ({ harness: t.home.harness, file: path.basename(t.home.file), tail: codecs.lines(t.home.file).slice(-8).map((r) => ({ type: r.type, event: r.payload?.type, role: r.payload?.role || r.message?.role, stop: r.message?.stop_reason, contentTypes: r.payload?.content?.map?.((p) => p.type) })) })) }));
        await shared.configure(project.id, { enabled: false });
        assert.equal(shared.project(project.id).enabled, false); assert.deepEqual(fs.readFileSync(row.file), nativeOriginal);
        assert.ok(!fs.existsSync(ccProjection.nativeFile)); assert.ok(!fs.existsSync(piProjection.nativeFile));
        assert.ok(!codecs.discover(sources).rows.some((r) => r.harness === 'opencode' && r.sessionId === projection.sessionId));
        assert.ok(codecs.discover(sources, { cwd: workspace, includeMessages: true }).rows.some((r) =>
          r.harness === 'codex' && r.sessionId !== id && r.sessionId !== codexProjection.sessionId &&
          r.messages.some((m) => m.text === 'Native pi persisted answer')));
        results.push({ client: 'project release + OpenCode native deletion', onlyIndexedProjectionsRemoved: true, originalPreserved: true, completedContentReturned: true });
      }
    }
    console.log(JSON.stringify({ passed: true, results, realCredentialsUsed: false, externalInference: false, runningDesktopTouched: false }));
  } finally { await router.stop(); if (server) await new Promise((r) => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
