const fs = require('node:fs');
const CONFIG_LIMITS = Object.freeze({ providers: 100, models: 10000, bytes: 5 * 1024 * 1024 });
function checkSize(text) {
  if (Buffer.byteLength(text, 'utf8') > CONFIG_LIMITS.bytes) throw Error('配置文件超过 5 MiB 上限');
}
function validateProviders(providers) {
  if (providers.length > CONFIG_LIMITS.providers) throw Error('供应商数量超过 100 上限');
  if (providers.some(p => p.models?.length > CONFIG_LIMITS.models)) throw Error('每个供应商的模型数量超过 10000 上限');
  // Budget the exact pretty-printed portable representation, including secrets.
  checkSize(JSON.stringify({ schemaVersion: 1, providers }, null, 2));
}
function readConfigFile(file) {
  if (fs.statSync(file).size > CONFIG_LIMITS.bytes) throw Error('配置文件超过 5 MiB 上限');
  const text = fs.readFileSync(file, 'utf8'); checkSize(text); return JSON.parse(text);
}
module.exports = { CONFIG_LIMITS, checkSize, validateProviders, readConfigFile };
