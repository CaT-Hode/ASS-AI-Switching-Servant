// Optional paid network probes. Set ASS_IMPORT_FILE to a private provider export.
// Uses an isolated app profile; reads existing Codex auth but does not refresh it.
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, ".."),
  data = path.join(process.env.LOCALAPPDATA, "ASS-validation", "live-profile");
if (!process.env.ASS_IMPORT_FILE)
  throw Error("Set ASS_IMPORT_FILE before running the paid network probes");
(async () => {
  const app = await electron.launch({
    args: [root, "--qa"],
    env: {
      ...process.env,
      ASS_TEST_DATA: data,
      ASS_TEST_CODEX: path.join(process.env.USERPROFILE, ".codex"),
      ASS_TEST_PORT: "25820",
    },
    timeout: 60000,
  });
  try {
    await app.firstWindow();
    const exported = JSON.parse(
      fs.readFileSync(process.env.ASS_IMPORT_FILE, "utf8"),
    );
    console.log(
      JSON.stringify(
        await app.evaluate(
          (_, raw) => global.assTest.store.import(raw),
          exported,
        ),
      ),
    );
    const result = await app.evaluate(async () => {
      const t = global.assTest;
      const results = [];
      for (const id of [
        "official",
        ...t.store.state.providers.map((p) => p.id),
      ]) {
        const models =
          id === "official"
            ? t.store.public().officialModels
            : t.store.state.providers.find((p) => p.id === id).models;
        const model = models.find((m) => m.enabled !== false);
        if (!model) continue;
        const r = await t.diagnose(id, model.model);
        results.push({ kind: "connection", provider: id, ...r });
      }
      return results;
    });
    console.log(JSON.stringify(result));
    const balances = await app.evaluate(async () => {
      const t = global.assTest;
      const rows = [];
      for (const p of t.store.state.providers) {
        const r = await t.balance(p.id);
        rows.push({
          provider: p.name,
          ok: r.ok,
          adapter: r.adapter,
          units: r.rows?.map((x) => x.unit),
          error: r.ok ? undefined : r.message,
        });
      }
      return rows;
    });
    console.log(JSON.stringify({ balances }));
  } finally {
    await app.evaluate(() => global.assTest.quit()).catch(() => {});
    await app.close().catch(() => {});
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
