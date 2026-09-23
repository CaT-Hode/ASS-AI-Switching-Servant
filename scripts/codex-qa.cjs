// Optional paid Codex smoke test. Run live-qa first to populate an isolated profile.
// Set ASS_CODEX_EXE to the native executable; no commands bypass execution policy.
const { _electron: electron } = require("playwright");
const path = require("node:path");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  data = path.join(process.env.LOCALAPPDATA, "ASS-validation", "live-profile");
const codex = process.env.ASS_CODEX_EXE;
if (!codex) throw Error("Set ASS_CODEX_EXE to the native Codex executable");
function run(
  model,
  effort = "low",
  prompt = "Reply exactly OK. Do not use tools.",
) {
  const args = [
    "exec",
    "--ignore-user-config",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--json",
    "-m",
    model,
    "-c",
    `model_provider="ass_router"`,
    "-c",
    `model_reasoning_effort="${effort}"`,
    "-c",
    `model_catalog_json=${JSON.stringify(path.join(data, "catalog.json"))}`,
    "-c",
    'model_providers.ass_router.name="ASS"',
    "-c",
    'model_providers.ass_router.base_url="http://127.0.0.1:25819/v1"',
    "-c",
    'model_providers.ass_router.wire_api="responses"',
    "-c",
    "model_providers.ass_router.requires_openai_auth=true",
    "-c",
    "model_providers.ass_router.supports_websockets=false",
    "-c",
    "model_providers.ass_router.request_max_retries=0",
    "-c",
    "model_providers.ass_router.stream_max_retries=0",
    prompt,
  ];
  return new Promise((resolve) => {
    const child = spawn(codex, args, { cwd: data, windowsHide: true });
    child.stdin.end();
    let output = "",
      error = "";
    const timer = setTimeout(() => child.kill(), 90000);
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (error += b));
    child.on("close", (code) => {
      clearTimeout(timer);
      const events = output
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return {};
          }
        });
      resolve({
        model,
        code,
        events: events.map((e) => ({
          type: e.type,
          message: e.message,
          item: e.item
            ? {
                type: e.item.type,
                text: e.item.text?.slice(0, 300),
                status: e.item.status,
                command: e.item.command,
                exit_code: e.item.exit_code,
              }
            : undefined,
        })),
        error: code === 0 ? undefined : error.slice(-700),
      });
    });
  });
}
(async () => {
  const app = await electron.launch({
    args: [root, "--qa", "--hidden"],
    env: {
      ...process.env,
      ASS_TEST_DATA: data,
      ASS_TEST_CODEX: path.join(process.env.USERPROFILE, ".codex"),
    },
    timeout: 60000,
  });
  try {
    await app.evaluate(async () => {
      while (!global.assTest) await new Promise((r) => setTimeout(r, 50));
      const t = global.assTest,
        original = t.router.fetch;
      t.toolShapes = [];
      t.router.fetch = async (...args) => {
        const b = JSON.parse(args[1].body);
        t.toolShapes.push({
          keys: Object.keys(b),
          model: b.model,
          tools: b.tools?.map((t) => ({ type: t.type, name: t.name })),
        });
        return original(...args);
      };
    });
    const models = await app.evaluate(() =>
      global.assTest.store.state.providers
        .flatMap((p) =>
          p.models
            .filter(
              (m) =>
                m.enabled &&
                (/mimo/i.test(m.model) || m.wireApi === "anthropic"),
            )
            .slice(0, 1)
            .map((m) => p.id + "::" + m.model),
        )
        .slice(0, 2),
    );
    for (const model of ["gpt-6-astra", ...models])
      console.log(
        JSON.stringify(
          await run(
            model,
            "low",
            "Use the provided exec_command tool once to execute with shell set to powershell.exe (not cmd.exe): Write-Output (Get-Random -Minimum 100000 -Maximum 999999). Do not read or modify any files. Report the result returned by the tool, never invent it.",
          ),
        ),
      );
    console.log(
      JSON.stringify({
        requestToolShapes: await app.evaluate(() => global.assTest.toolShapes),
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
