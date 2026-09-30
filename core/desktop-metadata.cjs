// External desktop metadata only. Electron's node:fs caches native ASAR objects
// (and their Windows handles) even for stat/lstat. Never send these paths through
// that wrapper, including during path checks. Do not change process.noAsar.
const fs = process.versions.electron ? require("original-fs") : require("node:fs");
const path = require("node:path");
const MAX_JSON_BYTES = 512 * 1024;
const MAX_HEADER_BYTES = 16 * 1024 * 1024;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function noLinks(file) {
  let cursor = file;
  while (true) {
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw Error("Linked metadata path");
    } catch (e) { if (e.code !== "ENOENT") throw e; }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

function readExactly(fd, size, position) {
  const buffer = Buffer.alloc(size);
  let done = 0;
  while (done < size) {
    const read = fs.readSync(fd, buffer, done, size - done, position + done);
    if (!read) throw Error("Truncated desktop metadata");
    done += read;
  }
  return buffer;
}

function jsonObject(buffer) {
  const value = JSON.parse(buffer.toString("utf8"));
  return object(value) ? value : {};
}

function readPlainJson(file, maxBytes) {
  noLinks(file);
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const info = fs.fstatSync(fd);
    if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size > maxBytes) return {};
    return jsonObject(readExactly(fd, info.size, 0));
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function readArchiveJson(archive, components, maxBytes) {
  noLinks(archive);
  let fd;
  try {
    fd = fs.openSync(archive, "r");
    const info = fs.fstatSync(fd);
    if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 16) return {};
    // ASAR framing: an 8-byte uint32 Pickle, followed by a string Pickle.
    // Format: https://github.com/electron/asar/blob/main/src/disk.ts
    const size = readExactly(fd, 8, 0);
    const headerSize = size.readUInt32LE(4);
    if (size.readUInt32LE(0) !== 4 || headerSize < 8 || headerSize % 4 !== 0 ||
        headerSize > MAX_HEADER_BYTES || headerSize > info.size - 8) return {};
    const header = readExactly(fd, headerSize, 8);
    const jsonSize = header.readUInt32LE(4);
    if (header.readUInt32LE(0) !== headerSize - 4 ||
        8 + Math.ceil(jsonSize / 4) * 4 !== headerSize) return {};
    let entry = jsonObject(header.subarray(8, 8 + jsonSize));
    for (const component of components) {
      if (!object(entry) || Object.hasOwn(entry, "link") || !object(entry.files) ||
          !Object.hasOwn(entry.files, component)) return {};
      entry = entry.files[component];
    }
    if (!object(entry) || Object.hasOwn(entry, "link") || Object.hasOwn(entry, "files") ||
        !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > maxBytes ||
        entry.unpacked !== undefined && typeof entry.unpacked !== "boolean") return {};
    if (entry.unpacked === true) {
      // components come from the requested path, never a header-supplied link.
      return readPlainJson(path.join(archive + ".unpacked", ...components), maxBytes);
    }
    if (typeof entry.offset !== "string" || !/^\d+$/.test(entry.offset)) return {};
    const offset = Number(entry.offset), start = 8 + headerSize + offset;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(start) ||
        start > info.size || entry.size > info.size - start) return {};
    return jsonObject(readExactly(fd, entry.size, start));
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function readDesktopJson(file, maxBytes = MAX_JSON_BYTES) {
  try {
    if (typeof file !== "string" || !path.isAbsolute(file) ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_JSON_BYTES) return {};
    // Reject traversal before normalization; metadata is never a link resolver.
    if (file.split(/[\\/]/).some((part) => part === ".." || part === ".")) return {};
    const normalized = path.normalize(file);
    const match = /^(.*?\.asar)[\\/](.+)$/i.exec(normalized);
    if (!match) return readPlainJson(normalized, maxBytes);
    const archive = match[1], components = match[2].split(/[\\/]/);
    if (components.some((part) => !part || part.includes(":"))) return {};
    // Support loose resources/app and real directories named app.asar (fixtures
    // and unpacked development installs), without virtual Electron stat calls.
    noLinks(archive);
    if (fs.statSync(archive).isDirectory()) return readPlainJson(normalized, maxBytes);
    return readArchiveJson(archive, components, maxBytes);
  } catch { return {}; } // Missing/updating/malformed installations fail closed.
}

module.exports = { readDesktopJson };
