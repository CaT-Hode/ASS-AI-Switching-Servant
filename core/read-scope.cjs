// Reuse synchronous reads within one operation, never across requests or awaits.
// Credentials and config changes are observed afresh by the next operation.
let scope;
const VALUE = Symbol("value");
function withReadScope(read) {
  if (scope) return read();
  scope = new Map();
  try { return read(); } finally { scope = undefined; }
}
function memoRead(owner, keys, read) {
  if (!scope) return read();
  if (!scope.has(owner)) scope.set(owner, new Map());
  let node = scope.get(owner);
  for (const key of keys) {
    if (!node.has(key)) node.set(key, new Map());
    node = node.get(key);
  }
  if (!node.has(VALUE)) node.set(VALUE, read());
  return node.get(VALUE);
}
module.exports = { withReadScope, memoRead };
