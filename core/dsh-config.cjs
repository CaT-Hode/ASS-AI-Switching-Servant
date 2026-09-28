const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const { memoRead } = require("./read-scope.cjs");
const ids = new Set(["llm-pi-ai", "llm-deepseek", "agent-default-model"]);
function json(file) {
  return memoRead(json, [file], () => readJson(file));
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw Error("DSH 运行版本记录无法读取"); }
}
function usesProfile(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(version || "");
  if (!m) return false;
  const [major, minor, patch] = m.slice(1, 4).map(Number);
  return major > 0 || minor > 1 || (minor === 1 && (patch > 7 || (patch === 7 && (!m[4] || m[4] === "rc" && +m[5] >= 2))));
}
function target(dir, manager) {
  return memoRead(target, [dir, manager], () => resolveTarget(dir, manager));
}
function resolveTarget(dir, manager) {
  const link = json(path.join(dir, "desktop-link", "web.json"));
  const installed = json(path.join(dir, "desktop-link", "active-core.json"));
  // A running desktop core can differ from the source checkout selected as CLI.
  let version = link.coreVersion || installed.version;
  if (!version && manager?.state.executables?.dsh) {
    const executable = manager.state.executables.dsh;
    const entry = typeof executable === "string" ? executable : executable.entryPoint;
    if (entry) {
      for (const base of [entry, path.dirname(entry), path.dirname(path.dirname(entry))]) {
        if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) continue;
        const manifest = json(path.join(base, "package.json"));
        if (manifest.name === "@deepseek-ai/dsh") { version = manifest.version; break; }
      }
    }
  }
  const owned = manager?.options.nativeConfig?.fields.entries.some((e) => e.harness === "dsh" && e.format === "dsh-patch" &&
    path.resolve(e.file).toLowerCase().startsWith(path.resolve(dir, "profiles").toLowerCase() + path.sep));
  // Independent account homes inherit the profile format, not desktop runtime
  // metadata. A generated patch remains readable after ASS or DSH restarts.
  const profileFile = path.join(dir, "profiles", "web", "cordis.patch.yml");
  const modern = usesProfile(version) || owned || (!version && fs.existsSync(profileFile));
  const profile = link.profile || "web";
  if (modern && !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile)) throw Error("DSH 当前 profile 名称无效，未写入配置");
  return { dir, auth: path.join(dir, ".credentials.yaml"),
    config: modern ? path.join(dir, "profiles", profile, "cordis.patch.yml") : path.join(dir, "settings.yaml"),
    format: modern ? "dsh-patch" : "yaml", profile, version };
}
function profileTarget(dir, base) {
  return { dir, auth: path.join(dir, ".credentials.yaml"), format: base.format, profile: "web",
    config: base.format === "dsh-patch" ? path.join(dir, "profiles/web/cordis.patch.yml") : path.join(dir, "settings.yaml") };
}
// Project only the two configurable plugin entries. The rest of the Cordis
// patch (including !!js expressions) stays as YAML syntax and is never executed.
function document(text) {
  const yaml = YAML.parseDocument(text === null || !text.trim() ? "[]\n" : text, { uniqueKeys: true });
  if (yaml.errors.length || !YAML.isSeq(yaml.contents)) throw Error("DSH profile 补丁必须是有效的 YAML 列表，未覆盖");
  YAML.visit(yaml, (_, node) => { if (YAML.isAlias(node)) throw Error("DSH 补丁包含 YAML 别名，请先整理后接入"); });
  const data = {}, indexes = {};
  for (const [index, node] of yaml.contents.items.entries()) {
    if (!YAML.isMap(node)) throw Error("DSH 补丁条目不是对象，未覆盖");
    const id = node.get("id");
    if (!ids.has(id)) continue;
    if (Object.hasOwn(indexes, id)) throw Error("DSH 补丁存在重复的模型配置条目，未覆盖");
    if (node.has("remove") || node.has("replace") || node.has("insert") || node.has("disabled"))
      throw Error("DSH 模型插件被禁用或使用结构化替换，请先在 DSH 确认插件配置");
    const config = node.get("config", true);
    if (config && !YAML.isMap(config)) throw Error("DSH 模型插件 config 不是对象，未覆盖");
    if (config) YAML.visit(config, (_, value) => {
      if (value?.tag && !value.tag.startsWith("tag:yaml.org,2002:")) throw Error("DSH 模型配置包含表达式，未覆盖");
      if (value?.tag === "tag:yaml.org,2002:js") throw Error("DSH 模型配置包含表达式，未覆盖");
    });
    indexes[id] = index;
    data[id] = config?.toJSON() || {};
  }
  return { data, yaml, indexes };
}
function edit(text, keys, value) {
  const doc = document(text), [id, ...field] = keys;
  let index = doc.indexes[id];
  if (index === undefined) {
    if (!value.exists) return text;
    index = doc.yaml.contents.items.length;
    doc.yaml.add(doc.yaml.createNode({ id, config: {} }));
  }
  if (value.exists) doc.yaml.setIn([index, "config", ...field], value.value);
  else doc.yaml.deleteIn([index, "config", ...field]);
  return doc.yaml.toString({ lineWidth: 0 });
}
function validField(e) {
  return e.harness === "dsh" && !e.selector && Array.isArray(e.path) &&
    (e.path.length === 3 && e.path[0] === "llm-pi-ai" && e.path[1] === "providers" && /^ass-[a-f0-9]{16}-(chat|responses|messages)$/.test(e.path[2]) ||
     e.path.length === 2 && e.path[0] === "agent-default-model" && ["provider", "model", "reasoningEffort"].includes(e.path[1]));
}
function readSettings(dir, readLegacy) {
  const location = target(dir);
  if (location.format === "yaml") return readLegacy(location.config, "yaml");
  return memoRead(readSettings, [location.config], () => readProfileSettings(location));
}
function readProfileSettings(location) {
  let content = null;
  try {
    if (fs.statSync(location.config).size > 8 * 1024 * 1024) throw Error("DSH profile 配置过大");
    content = fs.readFileSync(location.config, "utf8");
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  return document(content).data;
}
module.exports = { target, profileTarget, usesProfile, document, edit, validField, readSettings };
