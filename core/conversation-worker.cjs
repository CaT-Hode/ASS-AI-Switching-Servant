const { parentPort, workerData: data } = require("node:worker_threads");
const files = require("./conversation-files.cjs");
(async () => {
  if (data.action === "scan") return files.scan(data.sources, data.entries);
  if (data.action === "preview") return files.preview(data.row, data.vault, data.secret, data.before, data.backupOnly);
  if (data.action === "stage") return files.stage(data.row, data.target, data.vault, data.secret, data.backupOnly);
  if (data.action === "preserve") {
    const rows = [], failures = [];
    for (const row of data.entries) {
      if (!row.nativePresent) continue;
      try { rows.push({ id: row.id, snapshot: await files.preserve(row, data.vault, data.secret) }); }
      catch { failures.push(row.id); }
    }
    return { rows, failures };
  }
  throw Error("不支持的对话操作");
})().then((result) => parentPort.postMessage({ result }), (e) => parentPort.postMessage({ error: e.message }));
