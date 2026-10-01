// The credential is prepared before clients.json publishes the new profile.
// Recovery only removes exact files owned by an unfinished import, never a
// directory recursively: a native client may have added or rotated content.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { atomic } = require('./config.cjs');
const { safePath } = require('./native-fields.cjs');
const MARKER = '.ass-oauth-import.json';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function finish(dir, committed) {
  const marker = path.join(dir, MARKER); safePath(marker);
  if (!fs.existsSync(marker)) return;
  if (fs.statSync(marker).size > 1024) return;
  const transaction = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (transaction.version !== 1 || transaction.id !== path.basename(dir) || !/^[a-f0-9]{64}$/.test(transaction.authHash)) return;
  const auth = path.join(dir, 'auth.json'); safePath(auth);
  if (!committed && fs.existsSync(auth) && fs.statSync(auth).size <= 2 * 1024 * 1024 && hash(fs.readFileSync(auth)) === transaction.authHash)
    fs.unlinkSync(auth);
  // The atomic writer's completed temp file may survive a process interruption.
  if (!committed && Number.isSafeInteger(transaction.pid) && transaction.pid > 0) {
    const tmp = auth + '.' + transaction.pid + '.tmp'; safePath(tmp);
    if (fs.existsSync(tmp) && fs.statSync(tmp).size <= 2 * 1024 * 1024 && hash(fs.readFileSync(tmp)) === transaction.authHash) fs.unlinkSync(tmp);
  }
  fs.unlinkSync(marker);
  if (!committed) try { fs.rmdirSync(dir); } catch (e) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e; }
}
function recover(manager) {
  const base = path.join(manager.dataDir, 'clients', 'pi'); safePath(base);
  if (!fs.existsSync(base)) return;
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{24}$/.test(entry.name)) continue;
    const dir = path.join(base, entry.name);
    try { finish(dir, manager.state.profiles.some(p => p.harness === 'pi' && p.id === entry.name)); } catch { /* Preserve ambiguous/unreadable content. */ }
  }
}
function importProfile(manager, label, provider, record, sourceLabel) {
  manager.assertManaged('pi');
  if (!label?.trim()) throw Error('请输入账户名称');
  const p = { id: crypto.randomBytes(12).toString('hex'), harness: 'pi', label: label.trim().slice(0, 60),
    oauthProvider: provider, importedFrom: sourceLabel, importedAt: new Date().toISOString() };
  const dir = manager.root('pi', p.id), auth = JSON.stringify({ [provider]: record }, null, 2);
  const previous = manager.state, diskBefore = fs.existsSync(manager.file) ? fs.readFileSync(manager.file, 'utf8') : null;
  const next = { ...previous, profiles: [...previous.profiles, p], selected: { ...previous.selected, pi: p.id } };
  safePath(dir); fs.mkdirSync(path.dirname(dir), { recursive: true }); fs.mkdirSync(dir);
  try {
    atomic(path.join(dir, MARKER), JSON.stringify({ version: 1, id: p.id, pid: process.pid, authHash: hash(auth) }));
    atomic(path.join(dir, 'auth.json'), auth);
    const diskNow = fs.existsSync(manager.file) ? fs.readFileSync(manager.file, 'utf8') : null;
    if (diskNow !== diskBefore) throw Error('客户端账户配置已变化，请刷新后重新导入');
    manager.state = next;
    manager.save();
  } catch (error) {
    // A save implementation can throw after its rename. In that case the
    // published complete profile is committed, and must not lose its auth.
    manager.state = previous;
    let committed;
    try { committed = fs.existsSync(manager.file) && fs.readFileSync(manager.file, 'utf8') === JSON.stringify(next, null, 2); }
    catch { throw error; } // Keep auth and marker if commit status cannot be read.
    manager.state = committed ? next : previous;
    try { finish(dir, committed); if (!fs.existsSync(path.join(dir, MARKER))) fs.rmdirSync(dir); } catch { /* Recovery retries later. */ }
    if (!committed) throw error;
  }
  try { finish(dir, true); } catch { /* Committed state remains authoritative. */ }
  return p.id;
}
module.exports = { importProfile, recover };
