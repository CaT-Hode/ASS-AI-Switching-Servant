// Pi FileAuthStorageBackend (0.99.x) uses proper-lockfile with realpath:false:
// atomic mkdir(auth.json.lock). Never steal a native lock, even if it is stale.
const fs = require('node:fs');
const { safePath } = require('./native-fields.cjs');
function busy(file) { safePath(file + '.lock'); return fs.existsSync(file + '.lock'); }
function lock(file) {
  const target = file + '.lock'; safePath(file); safePath(target);
  try { fs.mkdirSync(target, { mode: 0o700 }); }
  catch { throw Error('Pi 正在读写或刷新登录，请稍后重新确认切换；未修改凭据'); }
  const identity = fs.statSync(target);
  const assert = () => {
    safePath(target); const current = fs.statSync(target);
    if (current.ino !== identity.ino || current.birthtimeMs !== identity.birthtimeMs || Date.now() - current.mtimeMs > 5000)
      throw Error('Pi 登录锁已变化或操作超时，未继续写入');
    fs.utimesSync(target, new Date(), new Date());
  };
  const release = () => {
    try { const current = fs.lstatSync(target);
      if (current.isDirectory() && !current.isSymbolicLink() && current.ino === identity.ino && current.birthtimeMs === identity.birthtimeMs) fs.rmdirSync(target);
    } catch {}
  };
  release.assert = assert;
  return release;
}
module.exports = { busy, lock };
