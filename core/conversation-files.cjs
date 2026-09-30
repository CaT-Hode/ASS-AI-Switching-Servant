// Local transcripts only. No auth files, remote requests, or native index writes.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { safePath } = require("./native-fields.cjs");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const { displayPath, pathKey: key } = require('./conversation-paths.cjs');
const inside = (dir, file) => { const rel = path.relative(dir, file); return !!rel && !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + path.sep); };
const signature = (s) => `${s.size}:${s.mtimeMs}:${s.ino}`;
const clean = (v, n = 250) => typeof v === "string" ? v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").slice(0, n) : "";
function contentText(content) {
  if (typeof content === "string") return clean(content, 16000);
  if (!Array.isArray(content)) return "";
  return content.filter((c) => ["text", "input_text", "output_text"].includes(c?.type))
    .map((c) => clean(c.text, 16000)).join("\n").slice(0, 16000);
}
function records(text) {
  return text.replace(/^\uFEFF/, "").split("\n").flatMap((line) => {
    try { const value = JSON.parse(line); return value && typeof value === "object" ? [value] : []; } catch { return []; }
  });
}
function sample(file, size) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(Math.min(size, 2 * 1024 * 1024)); fs.readSync(fd, head, 0, head.length, 0);
    if (head.length === size) return records(head.toString("utf8"));
    const tail = Buffer.alloc(Math.min(size - head.length, 256 * 1024));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    return [...records(head.toString("utf8")), ...records(tail.toString("utf8").split("\n").slice(1).join("\n"))];
  } finally { fs.closeSync(fd); }
}
function enumerate(dir, output, depth = 0, allowUnnamed = false) {
  if (depth > 8 || output.length >= 20000) throw Error("会话目录超过扫描范围");
  safePath(dir);
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e.code === "ENOENT") return; throw e; }
  for (const item of names) {
    if (item.isSymbolicLink() || item.name === "subagents" || item.name === "memory") continue;
    const file = path.join(dir, item.name);
    if (item.isDirectory()) enumerate(file, output, depth + 1, allowUnnamed);
    else if (item.isFile() && item.name.endsWith(".jsonl") && (allowUnnamed || UUID.test(item.name))) output.push(file);
  }
}
function codexIndex(dir) {
  const rows = new Map();
  rows.databaseState = 'absent';
  // SQLite is an enrichment, not the only source of truth. Missing or locked
  // indexes cannot make retained JSONL disappear after an account change.
  try {
    const { DatabaseSync } = require("node:sqlite");
    const names = fs.readdirSync(dir).filter((n) => /^state_\d+\.sqlite$/.test(n)).sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
    if (names[0]) {
      rows.databaseState = 'unavailable';
      const file = path.join(dir, names[0]); safePath(file);
      const db = new DatabaseSync(file, { readOnly: true, timeout: 500 });
      try {
        const fields = new Set(db.prepare("PRAGMA table_info(threads)").all().map((r) => r.name));
        const selected = ["id", "name", "title", "cwd", "model", "model_provider", "archived", "source", "rollout_path", "project_id"].filter((n) => fields.has(n));
        if (fields.has("id")) {
          const threads = db.prepare(`SELECT ${selected.join(",")} FROM threads LIMIT 20001`).all();
          rows.databaseState = threads.length > 20000 ? 'partial' : 'ready';
          for (const row of threads.slice(0, 20000)) rows.set(row.id.toLowerCase(), { ...row, indexPresent: true, title: row.name?.trim() || row.title });
        }
      } finally { db.close(); }
    }
  } catch { /* Native clients can rebuild indexes from their transcripts. */ }
  try {
    const file = path.join(dir, "session_index.jsonl"); safePath(file);
    if (fs.statSync(file).size <= 16 * 1024 ** 2)
      for (const r of records(fs.readFileSync(file, "utf8"))) if (typeof r.id === "string") {
        const id = r.id.toLowerCase();
        rows.set(id, { ...rows.get(id), title: rows.get(id)?.title || r.thread_name });
      }
  } catch {}
  try {
    const file = path.join(dir, '.codex-global-state.json'); safePath(file);
    if (fs.statSync(file).size > 16 * 1024 ** 2) throw Error();
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const projects = new Map(Object.entries(state['local-projects'] || {}).map(([id, p]) => [p.id || id, p]));
    for (const [id, assignment] of Object.entries(state['thread-project-assignments'] || {})) {
      const p = assignment?.projectKind === 'local' && projects.get(assignment.projectId);
      const roots = (p?.rootPaths || []).map(displayPath).filter((r) => path.isAbsolute(r));
      if (!roots.length) continue;
      const row = rows.get(id) || {}, native = displayPath(row.cwd);
      const cwd = roots.find((r) => key(r) === key(native || '.') || inside(r, native)) || roots[0];
      rows.set(id, { ...row, cwd, projectName: p.name, projectExplicit: true, projectless: false });
    }
    for (const id of state['projectless-thread-ids'] || []) rows.set(id, { ...rows.get(id), projectless: true, projectExplicit: false });
  } catch {}
  return rows;
}
function metadata(file, source, stat, index) {
  const values = sample(file, stat.size), filenameIds = path.basename(file).match(new RegExp(UUID.source, 'ig')) || [];
  const meta = values.find((r) => r.type === "session_meta")?.payload || {};
  const id = (source.harness === 'codex' ? meta.id || filenameIds.at(-1) : filenameIds.at(-1) || values.find((r) => r.sessionId)?.sessionId)?.toLowerCase();
  const native = index?.get(id) || {};
  const nativeIndexState = source.harness !== 'codex' ? undefined : native.indexPresent
    ? native.rollout_path && key(native.rollout_path) !== key(file) ? 'other-file' : 'indexed'
    : index?.databaseState === 'ready' ? 'missing' : index?.databaseState || 'absent';
  if (!id || (meta.id && !filenameIds.some((v) => v.toLowerCase() === id))) throw Error("会话标识与文件名不一致");
  if (source.harness === "claude" && values.some((r) => r.sessionId && r.sessionId.toLowerCase() !== id)) throw Error("CC 会话标识不一致");
  const sidechain = source.harness === "codex" ? !!meta.source?.subagent || native.source === "subagent" : values.some((r) => r.isSidechain);
  if (sidechain) return null;
  const messages = values.filter((r) => source.harness === "codex" ? r.type === "response_item" && r.payload?.type === "message" : ["user", "assistant"].includes(r.type));
  const prompt = messages.map((r) => source.harness === "codex" ? r.payload : r.message)
    .filter((m) => m?.role === "user").map((m) => contentText(m.content))
    .find((text) => text && !/^\s*(?:# AGENTS\.md|<environment_context>|<INSTRUCTIONS>|<local-command|<command-)/i.test(text));
  let titleEvent = values.filter((r) => r.type === 'custom-title').at(-1) || values.filter((r) => r.type === 'summary').at(-1);
  if (source.harness === 'claude') {
    // A rename can sit in the middle of a long CC log, outside head/tail samples.
    for (const r of require('./conversation-reader.cjs').records(file)) if (r.type === 'custom-title' && (!r.sessionId || r.sessionId.toLowerCase() === id)) titleEvent = r;
    try {
      const indexFile = path.join(path.dirname(file), 'sessions-index.json'); safePath(indexFile);
      if (fs.statSync(indexFile).size <= 16 * 1024 ** 2) {
        const entry = JSON.parse(fs.readFileSync(indexFile, 'utf8')).entries?.find((r) => r.sessionId?.toLowerCase() === id);
        if (entry) Object.assign(native, { cwd: entry.projectPath || entry.cwd, title: titleEvent?.customTitle || entry.customTitle || entry.summary });
      }
    } catch {}
  }
  const cwd = displayPath(clean(native.cwd || values.filter((r) => r.type === 'turn_context').at(-1)?.payload?.cwd || meta.cwd || values.find((r) => r.cwd)?.cwd, 2000));
  const title = clean(native.title || titleEvent?.customTitle || titleEvent?.summary || prompt?.split("\n")[0] || "未命名对话", 1000);
  const model = clean(native.model || values.filter((r) => r.type === "turn_context" || r.type === "assistant").at(-1)?.payload?.model || values.filter((r) => r.type === "assistant").at(-1)?.message?.model);
  return { id: hash(source.harness + "\0" + key(file)), sessionId: id, harness: source.harness,
    file, dir: source.dir, relative: path.relative(source.dir, file), sourceLabel: source.label || "本机历史",
    title, cwd, model, indexedFile: native.rollout_path && key(native.rollout_path) === key(file), projectless: native.projectless, projectExplicit: native.projectExplicit, projectName: native.projectName,
    nativeIndexState,
    archived: path.relative(source.dir, file).split(path.sep)[0] === 'archived_sessions' || [true, 1, '1'].includes(native.archived),
    updatedAt: new Date(stat.mtimeMs).toISOString(), createdAt: clean(meta.timestamp || values.find((r) => r.timestamp)?.timestamp, 50),
    size: stat.size, signature: signature(stat), nativePresent: true };
}
function scan(sources, previous = []) {
  const rows = new Map(previous.map((r) => [r.id, { ...r, nativePresent: false }])), errors = [];
  const pinned = new Set(previous.filter((r) => r.pinned).map((r) => r.harness + "\0" + r.sessionId));
  const seen = new Set();
  for (const source of sources) {
    if (!["codex", "claude"].includes(source.harness) || !path.isAbsolute(source.dir)) continue;
    try {
      const files = [], index = source.harness === "codex" ? codexIndex(source.dir) : null;
      for (const name of source.harness === "codex" ? ["sessions", "archived_sessions"] : ["projects"])
        enumerate(path.join(source.dir, name), files, 0, source.harness === 'claude');
      for (const file of files) {
        try {
        if (seen.has(key(file))) continue; seen.add(key(file)); safePath(file);
        const stat = fs.statSync(file), id = hash(source.harness + "\0" + key(file)), old = rows.get(id);
        if (!stat.isFile() || stat.size === 0) continue;
        let row = metadata(file, source, stat, index);
        if (row) rows.set(id, { ...row, snapshot: old?.snapshot, pinned: pinned.has(row.harness + "\0" + row.sessionId) });
        } catch (e) { errors.push({ harness: source.harness, file, message: e.message }); }
      }
    } catch { errors.push({ harness: source.harness, dir: source.dir, message: "部分本地会话未能读取，已保留上次结果" }); }
  }
  return { entries: [...rows.values()], errors };
}
async function* jsonLines(stream) {
  let line = Buffer.alloc(0), overflow = false;
  for await (const chunk of stream) {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) {
      if (!overflow && line.length + i - start <= 16 * 1024 ** 2) {
        const text = Buffer.concat([line, chunk.subarray(start, i)]).toString("utf8").replace(/^\uFEFF/, "");
        try { yield JSON.parse(text); } catch {}
      }
      line = Buffer.alloc(0); overflow = false; start = i + 1;
    }
    if (!overflow && line.length + chunk.length - start <= 16 * 1024 ** 2) line = Buffer.concat([line, chunk.subarray(start)]);
    else { overflow = true; line = Buffer.alloc(0); }
  }
  if (!overflow && line.length) { try { yield JSON.parse(line.toString("utf8")); } catch {} }
}
function snapshotFile(vault, snapshot) {
  if (!/^[a-f0-9]{32}\.ass-session$/.test(snapshot?.blob || "")) throw Error("会话保留记录无效");
  const file = path.join(vault, "records", snapshot.blob); safePath(file); return file;
}
function input(row, vault, secret, backupOnly = false) {
  if (!backupOnly) {
    try { safePath(row.file); if (fs.statSync(row.file).isFile()) return fs.createReadStream(row.file); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  if (!row.snapshot || !secret) throw Error("原会话文件不存在，且没有可用的保留副本");
  const file = snapshotFile(vault, row.snapshot), fd = fs.openSync(file, "r");
  let header;
  try { header = Buffer.alloc(28); if (fs.readSync(fd, header, 0, 28, 0) !== 28) throw Error("会话副本不完整"); }
  finally { fs.closeSync(fd); }
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(secret, "base64"), header.subarray(0, 12));
  decipher.setAuthTag(header.subarray(12));
  // pipeline propagates source errors (including truncated/tampered ciphertext).
  const source = fs.createReadStream(file, { start: 28 });
  source.on("error", (e) => decipher.destroy(e)); source.pipe(decipher);
  return decipher;
}
async function preview(row, vault, secret, before = 0, backupOnly = false) {
  let messages = [], fallback = [], total = 0, fallbackTotal = 0;
  const remember = (m, event) => {
    if (!m.text) return;
    const list = event ? fallback : messages;
    if (list.at(-1)?.text === m.text && list.at(-1)?.role === m.role && list.at(-1)?.timestamp === m.timestamp) return;
    list.push(m); if (list.length > 2000) list.shift();
    if (event) fallbackTotal++; else total++;
  };
  for await (const r of jsonLines(input(row, vault, secret, backupOnly))) {
    if (row.harness === "codex") {
      if (r.type === "response_item" && r.payload?.type === "message" && ["user", "assistant"].includes(r.payload.role))
        remember({ role: r.payload.role, text: contentText(r.payload.content), timestamp: clean(r.timestamp, 50) });
      else if (r.type === "event_msg" && ["user_message", "agent_message"].includes(r.payload?.type))
        remember({ role: r.payload.type === "user_message" ? "user" : "assistant", text: clean(r.payload.message, 16000), timestamp: clean(r.timestamp, 50) }, true);
    } else if (["user", "assistant"].includes(r.type) && r.message)
      remember({ role: r.type, text: contentText(r.message.content), timestamp: clean(r.timestamp, 50) });
  }
  if (!messages.length) { messages = fallback; total = fallbackTotal; }
  const end = Math.max(0, messages.length - before), start = Math.max(0, end - 40);
  return { messages: messages.slice(start, end), before, hasEarlier: start > 0, total, truncated: total > messages.length };
}
async function preserve(row, vault, secret) {
  safePath(row.file);
  const stat = fs.statSync(row.file);
  if (row.snapshot?.signature === signature(stat)) {
    try { if (fs.statSync(snapshotFile(vault, row.snapshot)).size === row.snapshot.size + 28) return row.snapshot; } catch {}
  }
  if (!stat.size) throw Error("会话文件为空，未覆盖既有副本");
  const blob = crypto.randomBytes(16).toString("hex") + ".ass-session", file = path.join(vault, "records", blob);
  safePath(file); fs.mkdirSync(path.dirname(file), { recursive: true });
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(secret, "base64"), iv), digest = crypto.createHash("sha256");
  const meter = new Transform({ transform(chunk, _, done) { digest.update(chunk); done(null, chunk); } });
  fs.writeFileSync(file, Buffer.concat([iv, Buffer.alloc(16)]), { flag: "wx", mode: 0o600 });
  try {
    await pipeline(fs.createReadStream(row.file, { start: 0, end: stat.size - 1 }), meter, cipher, fs.createWriteStream(file, { flags: "r+", start: 28 }));
    const after = fs.statSync(row.file);
    if (after.ino !== stat.ino || after.size < stat.size || (after.size === stat.size && after.mtimeMs !== stat.mtimeMs))
      throw Error("会话文件正在被改写，请等待任务结束后再切换");
    const fd = fs.openSync(file, "r+");
    try { fs.writeSync(fd, cipher.getAuthTag(), 0, 16, 12); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { blob, signature: signature(stat), size: stat.size, digest: digest.digest("hex"), capturedAt: new Date().toISOString() };
  } catch (e) { fs.unlinkSync(file); throw e; }
}
async function stage(row, target, vault, secret, backupOnly = false) {
  if (!path.isAbsolute(target) || !["codex", "claude"].includes(row.harness)) throw Error("续聊目录无效");
  safePath(target);
  // Existing transcripts in the active home are used in place, never replaced.
  if (!backupOnly && inside(target, row.file)) {
    try { safePath(row.file); if (fs.statSync(row.file).isFile()) return { file: row.file, copied: false }; }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  // CC supports an explicit transcript path, so a different credential home
  // need not receive a duplicate. OAuth comes ONLY from the current target.
  if (!backupOnly && row.harness === "claude") {
    try { safePath(row.file); if (fs.statSync(row.file).isFile()) return { file: row.file, copied: false }; }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  const parts = row.relative.split(/[\\/]/);
  if (!UUID.test(row.sessionId) || parts.some((p) => p === ".." || p === "." || !p)) throw Error("会话相对路径无效");
  if (row.harness === "codex" && parts[0] === "archived_sessions") parts[0] = "sessions";
  if (parts[0] !== (row.harness === "codex" ? "sessions" : "projects")) throw Error("会话目录不属于此客户端");
  const file = path.join(target, ...parts); if (!inside(target, file)) throw Error("会话路径越界");
  safePath(file);
  if (fs.existsSync(file)) throw Error("当前目录已有同名会话，未覆盖；请从当前目录的记录继续");
  if (row.harness === "codex") {
    const existing = [];
    enumerate(path.join(target, "sessions"), existing);
    enumerate(path.join(target, "archived_sessions"), existing);
    if (existing.some((f) => path.basename(f).match(UUID)?.[0]?.toLowerCase() === row.sessionId))
      throw Error("当前目录已有相同 ID 的会话，未创建重复记录；请刷新后从当前目录的记录继续");
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + crypto.randomBytes(8).toString("hex") + ".tmp", digest = crypto.createHash("sha256");
  const meter = new Transform({ transform(chunk, _, done) { digest.update(chunk); done(null, chunk); } });
  try {
    await pipeline(input(row, vault, secret, backupOnly), meter, fs.createWriteStream(tmp, { flags: "wx", mode: 0o600 }));
    if ((backupOnly || !fs.existsSync(row.file)) && digest.digest("hex") !== row.snapshot?.digest) throw Error("会话副本校验失败，未恢复");
    // An exclusive hard-link commit cannot overwrite a file created by a client
    // while the restore was in progress. Temp and target share a filesystem.
    safePath(file); fs.linkSync(tmp, file);
    return { file, copied: true };
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
module.exports = { scan, preview, preserve, stage, snapshotFile, signature, inside, codexIndex, metadata, sample };
