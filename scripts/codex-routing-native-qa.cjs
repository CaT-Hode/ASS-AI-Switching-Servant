// Run an explicitly selected local Codex binary against synthetic local data.
// No real login, provider key, inference network or running desktop is touched.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const { Router } = require("../core/router.cjs");
const { atomic, prepareConfig } = require("../core/config.cjs");
const { makeCatalog, parseImport, codexModelId } = require("../core/models.cjs");

(async () => {
  const binary = process.argv[2];
  if (!binary || !path.isAbsolute(binary) || !fs.statSync(binary).isFile()) throw Error("Pass the verified absolute Codex binary path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ass-codex-routing-"));
  const providers = parseImport({ providers: [{ id: "aimami_relay_fixture", name: "Fixture", baseUrl: "https://upstream.invalid/v1",
    apiKey: "synthetic-provider-key", models: [{ model: "gpt-6-astra" }] }] });
  let calls = [], upgrades = 0;
  const jwt = (payload) => Buffer.from('{"alg":"none"}').toString("base64url") + "." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".synthetic";
  const access = jwt({ sub: "synthetic-user", exp: Math.floor(Date.now() / 1000) + 3600,
    email: "synthetic@example.invalid", "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account", chatgpt_plan_type: "plus", chatgpt_user_id: "synthetic-user" } });
  const router = new Router({ getState: () => ({ providers }), fetchUpstream: async (url, options) => {
    // The only upstream implementation is this in-memory stub; no fetch call.
    const body = JSON.parse(options.body); calls.push({ url, model: body.model, auth: options.headers.authorization });
    const message = { id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] };
    const response = { id: "resp_fixture", object: "response", status: "completed", output: [message], model: body.model,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    const events = [{ type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: message },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: message.id, delta: "OK" },
      { type: "response.output_item.done", output_index: 0, item: message }, { type: "response.completed", response }];
    return new Response(events.map(e => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
  } });
  try {
    await router.start(0); router.server.on("upgrade", () => { upgrades++; });
    const results = [];
    for (const [provider, model] of [["openai", codexModelId(providers[0].id, "gpt-6-astra")],
      ["openai", "gpt-6-astra"], ["ASS", codexModelId(providers[0].id, "gpt-6-astra")]]) {
      const home = path.join(root, String(results.length)); fs.mkdirSync(home);
      const catalog = path.join(home, "catalog.json"); atomic(catalog, JSON.stringify(makeCatalog([], providers)));
      atomic(path.join(home, "config.toml"), prepareConfig("", catalog, `http://127.0.0.1:${router.port}/clients/ASS/v1`).text);
      atomic(path.join(home, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: access, id_token: access,
        refresh_token: "synthetic-refresh-never-used", account_id: "synthetic-account" }, last_refresh: new Date().toISOString() }));
      const env = { ...process.env, CODEX_HOME: home, TERM: "dumb" };
      for (const key of Object.keys(env)) if (/^(OPENAI_|CODEX_THREAD|CODEX_INTERNAL|ASS_LOCAL|CHATGPT_)/i.test(key)) delete env[key];
      const before = upgrades; calls = [];
      const result = await new Promise((resolve, reject) => {
        const child = spawn(binary, ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--json",
          "-c", `model_provider="${provider}"`, "-c", "analytics.enabled=false", "-c", "features.connectors=false",
          "-m", model, "Reply OK without any tools."], { cwd: home, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let output = "", stderr = "";
        child.stdout.on("data", b => { output = (output + b).slice(-64000); });
        child.stderr.on("data", b => { stderr = (stderr + b).slice(-16000); });
        const timer = setTimeout(() => child.kill(), 30000);
        child.once("error", e => { clearTimeout(timer); reject(e); });
        child.once("exit", code => { clearTimeout(timer); resolve({ code, output, stderr }); });
      });
      // Print only filtered diagnostics on failure, never the synthetic auth body.
      if (result.code !== 0 || !calls.length) throw Error(JSON.stringify({ provider, code: result.code,
        calls: calls.length, upgrades: upgrades - before, detail: result.stderr.replaceAll(access, "[REDACTED]").slice(-5000), output: result.output.slice(-3000) }));
      const thirdParty = model.includes("::");
      assert.ok(calls.every(c => c.model === "gpt-6-astra"));
      assert.ok(calls.every(c => c.url.startsWith(thirdParty ? "https://upstream.invalid/" : "https://chatgpt.com/")));
      assert.ok(calls.every(c => c.auth === "Bearer " + (thirdParty ? "synthetic-provider-key" : access)));
      if (provider === "openai") assert.ok(upgrades > before, "must exercise the installed binary's WS fallback");
      assert.match(result.output, /turn.completed/);
      results.push({ provider, thirdParty, calls: calls.length, wsFallback: upgrades > before, completed: true });
    }
    console.log(JSON.stringify({ passed: true, results, realCredentialsUsed: false, externalInference: false, runningDesktopTouched: false }));
  } finally { await router.stop(); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
