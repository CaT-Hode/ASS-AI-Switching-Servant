// Resolve only known config locations and the explicitly selected workspace.
// No recursive disk scan, remote config fetch, interpolation commands or writes.
const fs = require("node:fs");
const path = require("node:path");
const JSONC = require("jsonc-parser");
const { memoRead } = require("./read-scope.cjs");
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function readConfig(file) {
  return memoRead(readConfig, [file], () => readUncachedConfig(file));
}
function readUncachedConfig(file) {
  try {
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw Error();
    return parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw Error("OpenCode 配置无法读取，未推断 API 凭据");
  }
}
function parse(text) {
  if (typeof text !== "string" || text.length > 2 * 1024 * 1024) throw Error("OpenCode 配置无法读取");
  const errors = [], data = JSONC.parse(text.replace(/^\uFEFF/, ""), errors, { allowTrailingComma: true });
  if (errors.length || !object(data)) throw Error("OpenCode 配置无法读取");
  return data;
}
function merge(a, b) {
  const out = { ...a };
  for (const [key, value] of Object.entries(b || {})) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    out[key] = object(value) ? merge(object(out[key]) ? out[key] : {}, value) : value;
  }
  return out;
}
function projectDirs(workspace) {
  if (!workspace || !path.isAbsolute(workspace)) return [];
  const rows = [];
  for (let dir = path.resolve(workspace), depth = 0; depth < 64; depth++) {
    rows.unshift(dir);
    if (fs.existsSync(path.join(dir, ".git")) || path.dirname(dir) === dir) break;
    dir = path.dirname(dir);
  }
  return rows;
}
function loadOpenCodeConfig({ home, env = {}, workspace, configDir, read = readConfig } = {}) {
  const files = [], pair = (dir) => ["opencode.json", "opencode.jsonc"].map((f) => path.join(dir, f));
  const globalDir = configDir || path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "opencode");
  files.push(path.join(globalDir, "config.json"), ...pair(globalDir));
  const resolve = (file) => path.isAbsolute(file) ? file : workspace ? path.resolve(workspace, file) : null;
  if (env.OPENCODE_CONFIG) files.push(resolve(env.OPENCODE_CONFIG));
  const dirs = projectDirs(workspace);
  for (const dir of dirs) files.push(...pair(dir));
  for (const dir of dirs) files.push(...pair(path.join(dir, ".opencode")));
  if (env.OPENCODE_CONFIG_DIR) {
    const dir = resolve(env.OPENCODE_CONFIG_DIR);
    if (dir) files.push(...pair(dir));
  }
  let data = {};
  const custom = new Set(), sources = [];
  const add = (value, file) => {
    const layer = { ...value, provider: merge(value.provider, value.providers) };
    delete layer.providers;
    for (const [id, p] of Object.entries(layer.provider))
      for (const model of Object.keys(p?.models || {})) custom.add(id + "\0" + model);
    data = merge(data, layer); sources.push(file);
  };
  for (const file of [...new Set(files.filter(Boolean))]) add(read(file), file);
  if (env.OPENCODE_CONFIG_CONTENT) add(parse(env.OPENCODE_CONFIG_CONTENT), "OPENCODE_CONFIG_CONTENT");
  const managed = env.ProgramData || env.PROGRAMDATA;
  if (managed && path.isAbsolute(managed)) for (const file of pair(path.join(managed, "opencode"))) add(read(file), file);
  return { data, custom, sources };
}
module.exports = { loadOpenCodeConfig, readConfig, merge };
