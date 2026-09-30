const path = require('node:path');
// Windows SQLite indexes use extended paths; desktop project roots do not.
function displayPath(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
}
function pathKey(value) {
  const p = path.resolve(displayPath(value));
  return process.platform === 'win32' ? p.toLowerCase() : p;
}
module.exports = { displayPath, pathKey };
