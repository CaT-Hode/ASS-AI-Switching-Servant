const { parentPort, workerData } = require("node:worker_threads");
require("./usage-readers.cjs")
  .scan(workerData.options, workerData.cache)
  .then((result) => parentPort.postMessage(result))
  .catch(() => {
    throw Error("本地用量读取失败");
  });
