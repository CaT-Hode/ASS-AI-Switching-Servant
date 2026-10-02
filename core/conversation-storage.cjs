const fs = require('node:fs'), path = require('node:path');
const { safePath } = require('./native-fields.cjs');
const { snapshotFile, signature } = require('./conversation-files.cjs');
function trashFiles(vault, entry) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(entry.id)) throw Error('删除备份标识无效');
  const directory = path.join(vault, 'trash', entry.id); safePath(directory);
  const files = new Set((entry.files || []).map(item => snapshotFile(directory, item.snapshot)));
  for (const item of entry.imports || []) {
    if (!/^[a-f0-9]{64}\.opencode\.enc$/.test(item.backup)) throw Error('删除备份文件名无效');
    files.add(path.join(directory, item.backup));
  }
  const progress = path.join(directory, 'progress.json');
  if (fs.existsSync(progress)) files.add(progress);
  return [...files].map(file => {
    safePath(file); let stat;
    try { stat = fs.lstatSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (stat && !stat.isFile()) throw Error('删除备份不是普通文件');
    return { file, bytes: stat?.size || 0, stamp: stat && signature(stat) };
  });
}
module.exports = { trashFiles };
