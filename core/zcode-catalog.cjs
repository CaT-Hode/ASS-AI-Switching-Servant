// Read-only projection of ZCode's native provider/model rules. Never execute
// option `map` expressions, fetch grants, or write/materialize native caches.
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Script } = require("node:vm");
const { zcodeVersion } = require("./oauth-info.cjs");
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const list = (v) => Array.isArray(v) ? v : [];
const has = (v) => typeof v === "string" && !!v.trim();
const GROUPS = ["modelRules", "modelApiRules", "providerSiteRules", "templateModelRules", "builtinProviderModelRules"];

function release(data) {
  const p = data?.config?.providerConfigRules, m = data?.config?.modelConfigRules;
  if (data?.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      !Array.isArray(p?.providerRules) || !Array.isArray(p.templateRules) ||
      !GROUPS.every((key) => Array.isArray(m?.[key]))) return false;
  for (const [rows, key] of [[p.providerRules, "providerId"], [p.templateRules, "templateId"]]) {
    if (new Set(rows.map((r) => r?.[key])).size !== rows.length ||
        rows.some((r) => !object(r) || !has(r[key]) || !object(r.config))) return false;
  }
  if (p.providerRules.some((r) => r.providerId === "builtin:zapi")) return false;
  const valid = GROUPS.every((key) => m[key].every((r) => object(r) && object(r.config) &&
    (key === "templateModelRules" ? has(r.templateId) && has(r.modelId) :
      key === "builtinProviderModelRules" ? has(r.providerId) && has(r.modelId) :
        has(r.modelMatch) && (key !== "modelApiRules" || has(r.apiTypeMatch)) &&
        (key !== "providerSiteRules" || has(r.baseUrlMatch)))));
  if (!valid) return false;
  try {
    for (const key of GROUPS.slice(0, 3)) for (const r of m[key]) {
      for (const field of ["modelMatch", "apiTypeMatch", "baseUrlMatch"]) if (r[field] !== undefined) {
        if (!has(r[field]) || r[field].length > 2048) return false;
        new RegExp("^(?:" + r[field] + ")$");
      }
    }
    return true;
  } catch { return false; }
}

function builtin({ dir, env = {}, override, launcher = {} }, read) {
  const sources = [], materialized = path.join(dir, "runtime/provider/bundled/zcode-builtin.json");
  const explicit = (key) => !override && has(env[key]) ? env[key].trim() : "";
  const installed = launcher.desktopExecutable
    ? path.join(path.dirname(launcher.desktopExecutable), "resources/config/provider/zcode-builtin.json")
    : /\.[cm]?js$/i.test(launcher.entryPoint || "")
      ? path.join(path.dirname(launcher.entryPoint), "provider/zcode-builtin.json") : "";
  const load = (file) => {
    if (!file) return null;
    const source = read(file); sources.push(source);
    if (source.data && !release(source.data)) {
      source.status = "unreadable"; source.message = "ZCode 内置模型目录版本或结构无法识别";
      delete source.data;
    }
    return source.data ? source : null;
  };
  const bundledOverride = explicit("ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE");
  // A selected installation owns its bundled baseline. The materialized copy is
  // for standalone binaries; do not prefer it over a newer selected app version.
  let bundled = load(bundledOverride || installed || materialized);
  if (!bundledOverride && installed && sources.at(-1)?.status === "missing") bundled = load(materialized);
  let activePath = explicit("ZCODE_BUILTIN_PROVIDER_CONFIG_FILE");
  const appVersion = launcher.desktopExecutable ? zcodeVersion({ launcher: () => launcher }) : null;
  if (!activePath && appVersion) {
    try {
      const endpoint = new URL(env.ZCODE_BASE_URL?.trim() || env.ZCODE_ENDPOINT_ORIGIN?.trim() || "https://zcode.z.ai");
      if (!["http:", "https:"].includes(endpoint.protocol)) throw Error();
      const key = "endpoint-" + createHash("sha256").update(endpoint.origin).digest("hex").slice(0, 32);
      const platform = (process.platform === "win32" ? "windows" : process.platform) + "-" +
        (process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch);
      activePath = path.join(dir, "runtime/provider", platform, appVersion, key, "zcode-builtin.json");
    } catch {
      if (bundled) sources.push({ file: bundled.file, status: "unreadable", message: "ZCode 服务地址无效，未读取活动模型缓存" });
    }
  }
  const active = load(activePath);
  // Equal-revision conflicts prefer Bundled, exactly as the native source does.
  const selected = active && (!bundled || active.data.revision > bundled.data.revision) ? active : bundled;
  return { sources, config: selected?.data.config, file: selected?.file };
}

// Runs only this fixed implementation, with JSON data, under a time budget.
// Native modelMatch expressions are regexes; a corrupt cache must not hang the
// Electron main process. No user-supplied JavaScript or parameter maps run here.
function project(json) {
  const { builtin = {}, personal = {}, accountTypes = [] } = JSON.parse(json);
  const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const list = (v) => Array.isArray(v) ? v : [];
  const has = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 2048;
  const ids = (v) => [...new Set(list(v).filter(has).map((s) => s.trim()))];
  const blocked = new Set(["__proto__", "constructor", "prototype"]);
  function overlay(a, b) {
    if (b === undefined) return a;
    if (!object(a) || !object(b)) return b;
    const value = { ...a };
    for (const key of Object.keys(b)) if (!blocked.has(key)) value[key] = overlay(a[key], b[key]);
    return value;
  }
  function order(builtinIds, personalIds, requested) {
    const b = ids(builtinIds), p = ids(personalIds).filter((id) => !b.includes(id));
    const selected = ids(requested).filter((id) => b.includes(id) || p.includes(id));
    return [...b.filter((id) => !selected.includes(id)), ...selected, ...p.filter((id) => !selected.includes(id))];
  }
  const templates = new Map(list(builtin.providerConfigRules?.templateRules).map((r) => [r.templateId, r.config]));
  const base = new Map(), providers = new Map();
  for (const r of list(builtin.providerConfigRules?.providerRules)) {
    if (r.config.access?.type === "zhipu-account" && !accountTypes.includes(r.config.access.accountType)) continue;
    const value = { ...r, config: overlay(templates.get(r.templateId) || {}, r.config) };
    base.set(r.providerId, value); providers.set(r.providerId, value);
  }
  const invalid = new Set(), personalRows = list(personal.providerConfigRules?.providerRules);
  for (const r of personalRows) {
    if (!object(r) || !has(r.providerId) || !object(r.config)) continue;
    if (r.providerId.startsWith("account:") && (r.config.access !== undefined || !base.has(r.providerId))) continue;
    if (personalRows.filter((v) => v?.providerId === r.providerId).length > 1) { invalid.add(r.providerId); continue; }
    const previous = base.get(r.providerId);
    const config = previous ? overlay(previous.config, r.config) : overlay(templates.get(r.templateId) || {}, r.config);
    providers.set(r.providerId, { ...previous, ...r, config });
  }
  const mr = builtin.modelConfigRules || {}, pr = personal.modelConfigRules || {};
  const regex = new Map();
  function matches(pattern, value, insensitive = false) {
    if (!has(pattern) || !has(value)) return false;
    const key = (insensitive ? "i:" : ":") + pattern;
    if (!regex.has(key)) regex.set(key, new RegExp("^(?:" + pattern + ")$", insensitive ? "i" : ""));
    return regex.get(key).test(value);
  }
  const result = [];
  for (const id of order([...base.keys()], [...providers.keys()].filter((id) => !base.has(id)), personal.providerOrder)) {
    const p = providers.get(id), c = p.config;
    if (invalid.has(id) || (p.enabled === false && c.access?.type !== "zhipu-account") || c.visibility === "hidden" ||
        (p.templateId && !templates.has(p.templateId))) continue;
    let baseUrl;
    try {
      const u = new URL(c.api?.baseUrl), suffix = u.search + u.hash, full = u.toString();
      baseUrl = (suffix ? full.slice(0, -suffix.length) : full).replace(/\/+$/, "") + suffix;
    } catch {}
    const models = [];
    for (const modelId of order(c.builtinModelIds, c.personalModelIds, c.modelOrder)) {
      const exact = [...list(pr.providerModelRules), ...list(pr.manualProviderModelRules)]
        .filter((r) => r?.providerId === id && r.modelId === modelId && object(r.config));
      if (exact.length > 1) continue;
      let config = {};
      for (const key of ["modelRules", "modelApiRules", "providerSiteRules"]) for (const r of list(mr[key])) {
        if (!matches(r.modelMatch, modelId, true) || (r.apiTypeMatch !== undefined && !matches(r.apiTypeMatch, c.api?.type)) ||
            (r.baseUrlMatch !== undefined && !matches(r.baseUrlMatch, baseUrl))) continue;
        config = overlay(config, r.config);
      }
      for (const r of list(mr.templateModelRules)) if (r.templateId === p.templateId && r.modelId === modelId) config = overlay(config, r.config);
      for (const r of list(mr.builtinProviderModelRules)) if (r.providerId === id && r.modelId === modelId) config = overlay(config, r.config);
      if (exact[0]) config = overlay(config, exact[0].config);
      if (config.enabled !== false) models.push({ modelId, config });
    }
    result.push({ ...p, models });
  }
  return JSON.stringify(result);
}
const projection = new Script("(" + project.toString() + ")(input)");
function resolve(builtinConfig, personal, accountTypes) {
  return JSON.parse(projection.runInNewContext({ URL, input: JSON.stringify({ builtin: builtinConfig, personal, accountTypes }) },
    { timeout: 100, contextCodeGeneration: { strings: false, wasm: false } }));
}
function inspect(options, personal, read, accountTypes = []) {
  const loaded = builtin(options, read);
  let providers;
  try { providers = resolve(loaded.config, personal, accountTypes); }
  catch {
    loaded.sources.push({ file: loaded.file || path.join(options.dir, "provider_config.json"), status: "unreadable",
      message: "ZCode 模型规则无法解析或超时；仅保留可读取的个人模型" });
    try { providers = resolve(undefined, personal, []); } catch { providers = []; }
    loaded.config = undefined;
  }
  return { ...loaded, providers };
}
module.exports = { inspect, release, resolve };
