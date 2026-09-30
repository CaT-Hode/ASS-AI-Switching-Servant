// Bounded line/frame reads: large logs do not need one giant string/buffer.
const fs = require('node:fs'), zlib = require('node:zlib');
const { StringDecoder } = require('node:string_decoder');
const { safePath } = require('./native-fields.cjs');
const MAX_LINE = 64 * 1024 ** 2;
function* frames(buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 5) return;
    const magic = buffer.readUInt32LE(offset); offset += 4;
    if ((magic & 0xfffffff0) >>> 0 === 0x184d2a50) {
      if (buffer.length - offset < 4) return;
      const n = buffer.readUInt32LE(offset); offset += 4;
      if (buffer.length - offset < n) return; offset += n; continue;
    }
    if (magic !== 0xfd2fb528) throw Error('DSH 压缩记录损坏');
    const d = buffer[offset++]; if (d & 0x18) throw Error('DSH 压缩帧头无效');
    const headerBytes = (d & 0x20 ? 0 : 1) + ([0, 1, 2, 4][d & 3]) + (d >>> 6 ? 1 << (d >>> 6) : d & 0x20 ? 1 : 0);
    if (buffer.length - offset < headerBytes) return; offset += headerBytes;
    for (;;) {
      if (buffer.length - offset < 3) return;
      const b = buffer.readUIntLE(offset, 3); offset += 3;
      const type = b >>> 1 & 3; if (type === 3) throw Error('DSH 压缩块无效');
      const n = type === 1 ? 1 : b >>> 3; if (buffer.length - offset < n) return;
      offset += n; if (b & 1) break;
    }
    if (d & 4) { if (buffer.length - offset < 4) return; offset += 4; }
    yield buffer.subarray(start, offset);
  }
}
function* chunks(file) {
  safePath(file);
  if (file.endsWith('.zstd')) {
    if (!zlib.zstdDecompressSync) throw Error('当前运行时不支持 DSH Zstandard 会话');
    if (fs.statSync(file).size > 256 * 1024 ** 2) throw Error('压缩会话超过读取范围，未截断');
    for (const frame of frames(fs.readFileSync(file))) yield zlib.zstdDecompressSync(frame, { maxOutputLength: MAX_LINE });
    return;
  }
  const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(512 * 1024);
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) yield buffer.subarray(0, n); }
  finally { fs.closeSync(fd); }
}
function* records(file) {
  const decoder = new StringDecoder('utf8'); let pending = '', first = true;
  for (const chunk of chunks(file)) {
    pending += decoder.write(chunk);
    let start = 0, end;
    while ((end = pending.indexOf('\n', start)) !== -1) {
      if (end - start > MAX_LINE) throw Error('单条会话记录过大，未截断');
      let line = pending.slice(start, end); start = end + 1;
      if (first) { line = line.replace(/^\uFEFF/, ''); first = false; }
      if (line.trim()) yield JSON.parse(line);
    }
    pending = pending.slice(start);
    if (pending.length > MAX_LINE) throw Error('单条会话记录过大，未截断');
  }
  // Native append writers commit on newline; an unfinished tail stays local.
  // DSH commits a complete Zstd frame; its last JSON row may omit the newline.
  if (file.endsWith('.zstd') && pending.trim()) yield JSON.parse(pending + decoder.end());
}
function lines(file, harness) {
  const rows = [];
  for (const r of records(file)) {
    if (harness === 'codex' && !['session_meta', 'response_item', 'turn_context'].includes(r.type) &&
      !(r.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted', 'user_message', 'agent_message'].includes(r.payload?.type))) continue;
    rows.push(r);
  }
  return rows;
}
module.exports = { lines, records, frames };
