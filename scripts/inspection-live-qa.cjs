// Explicit opt-in: one provider/model, four to six small paid requests, low effort only.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path");
if (
  !process.env.ASS_IMPORT_FILE ||
  !process.env.ASS_LIVE_PROVIDER ||
  !process.env.ASS_LIVE_MODEL
)
  throw Error(
    "Set ASS_IMPORT_FILE, ASS_LIVE_PROVIDER and ASS_LIVE_MODEL to opt into this paid probe",
  );
const root = path.resolve(__dirname, "..");
const output = path.join(process.env.LOCALAPPDATA, "ASS-validation");
fs.mkdirSync(output, { recursive: true });
const data = fs.mkdtempSync(path.join(output, "inspection-live-")),
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
    await app.firstWindow();
    const raw = JSON.parse(fs.readFileSync(process.env.ASS_IMPORT_FILE, "utf8"));
    const result = await app.evaluate(async (_, raw) => {
      const t = global.assTest;
      const provider = raw.providers.find(
        (p) => p.id === process.env.ASS_LIVE_PROVIDER,
      );
      const model = provider?.models.find(
        (m) => m.model === process.env.ASS_LIVE_MODEL,
      );
      if (!model) throw Error("Selected model is not in the private export");
      t.store.import({
        providers: [
          {
            ...provider,
            models: [{ ...model, efforts: ["low"], defaultEffort: "low" }],
          },
        ],
      });
      const report = await t.probeModel(provider.id, model.model);
      const metadata = t.snapshot().providerModels[provider.id];
      return {
        report,
        metadata: {
          source: metadata.source,
          count: metadata.models.length,
          error: metadata.error,
        },
      };
    }, raw);
    console.log(JSON.stringify(result));
  } finally {
    await app.evaluate(() => global.assTest.quit()).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
