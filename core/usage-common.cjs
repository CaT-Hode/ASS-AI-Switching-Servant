const crypto = require("node:crypto");
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
const known = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const num = (v) => known(v) ? v : 0;
const label = (v) => typeof v === "string" && v.length <= 200 && !/[\x00-\x1f]/.test(v) ? v : "未标注";
function dayKey(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";
}
function localHour(value) {
  if (value == null || (typeof value === "string" && !/[T ]\d{2}:\d{2}/.test(value))) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getHours() : null;
}
function normalized(input, output, cacheRead, cacheWrite, reasoning, includesCache = false) {
  cacheRead = num(cacheRead); cacheWrite = num(cacheWrite);
  input = num(input) + (includesCache ? 0 : cacheRead + cacheWrite);
  return { input, output: num(output), cacheRead: Math.min(input, cacheRead),
    cacheWrite: Math.min(Math.max(0, input - cacheRead), cacheWrite), reasoning: Math.min(num(output), num(reasoning)) };
}
module.exports = { hash, known, num, label, dayKey, localHour, normalized };
