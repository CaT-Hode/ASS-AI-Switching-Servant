const fs = require("node:fs");
const path = require("node:path");
const TOML = require("@iarna/toml");
const { isDeepStrictEqual: equal } = require("node:util");
const START = "# >>> ass managed start";
const END = "# <<< ass managed end";
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(tmp, value, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
function withoutOwn(text) {
  return text.replace(
    /# >>> ass managed start[\s\S]*?# <<< ass managed end\r?\n?/g,
    "",
  );
}
function prepareConfig(text, catalog, baseUrl = "http://127.0.0.1:25819/clients/ASS/v1", defaultModel = null, localToken = "") {
  if (text.includes("aimami-relay codex-router top start"))
    throw new Error(
      "检测到其他路由工具仍接管 Codex。请先关闭旧路由，再点击接入。",
    );
  const clean = withoutOwn(text),
    parsed = TOML.parse(clean);
  const replaced = {};
  if (
    parsed.model_providers?.openai ||
    parsed.model_providers?.ass_router ||
    parsed.model_providers?.aimai1
  )
    throw new Error(
      "存在其他工具或非 ASS 管理的模型供应商，请先恢复原配置，避免覆盖",
    );
  let first = clean.search(/^\[/m);
  if (first < 0) first = clean.length;
  let top = clean.slice(0, first),
    rest = clean.slice(first);
  for (const key of ["model_provider", "model_catalog_json", ...(defaultModel ? ["model", "model_reasoning_effort"] : [])]) {
    replaced[key] = parsed[key] ?? null;
    top = top.replace(new RegExp("^" + key + "\\s*=.*(?:\\r?\\n|$)", "m"), "");
  }
  const model = defaultModel ? `model = ${JSON.stringify(defaultModel.model)}\nmodel_reasoning_effort = ${JSON.stringify(defaultModel.effort)}\n` : "";
  const block = `${START}\nmodel_provider = "ass_router"\nmodel_catalog_json = ${JSON.stringify(catalog)}\n${model}${END}\n`;
  const auth = localToken ? `requires_openai_auth = false\nexperimental_bearer_token = ${JSON.stringify(localToken)}\n` : "requires_openai_auth = true\n";
  const providers = `\n${START}\n[model_providers.ass_router]\nname = "ASS"\nbase_url = ${JSON.stringify(baseUrl)}\nwire_api = "responses"\n${auth}supports_websockets = false\n${END}\n`;
  const result = block + top + rest + providers;
  TOML.parse(result);
  return { text: result, replaced };
}
class ConfigManager {
  constructor(codexDir, dataDir, port = 25819) {
    this.file = path.join(codexDir, "config.toml");
    this.dataDir = dataDir;
    this.catalog = path.join(dataDir, "catalog.json");
    this.record = path.join(dataDir, "codex-attachment.json");
    this.baseUrl = `http://127.0.0.1:${port}/clients/ASS/v1`;
  }
  status() {
    try {
      const text = fs.readFileSync(this.file, "utf8"), c = TOML.parse(text);
      return {
        attached:
          c.model_provider === "ass_router" &&
          c.model_catalog_json === this.catalog &&
          c.model_providers?.ass_router?.supports_websockets === false &&
          [this.baseUrl, this.baseUrl.replace("/clients/ASS/", "/clients/codex/"), "http://127.0.0.1:25819/v1"].includes(c.model_providers?.ass_router?.base_url),
        managed: text.includes(START),
        provider: c.model_provider || "openai",
      };
    } catch {
      return { attached: false, provider: "unknown" };
    }
  }
  prepareAttach(defaultModel = null, localToken = "") {
    const old = fs.existsSync(this.file) ? fs.readFileSync(this.file, "utf8") : "";
    // Validate ownership, restore the baseline in memory, then apply the new
    // desired default. Never strip an externally edited managed block.
    const baseline = old.includes(START) ? this.preflightDetach().next : old;
    return { old, ...prepareConfig(baseline, this.catalog, this.baseUrl, defaultModel, localToken) };
  }
  attach(defaultModel = null) {
    const { old, text, replaced } = this.prepareAttach(defaultModel);
    if (old === text) return;
    const backup = path.join(
      this.dataDir,
      "backups",
      "config-" + Date.now() + ".toml",
    );
    atomic(backup, old);
    if ((fs.existsSync(this.file) ? fs.readFileSync(this.file, "utf8") : "") !== old)
      throw new Error("配置同时被修改，请重试");
    const previousRecord = fs.existsSync(this.record) ? fs.readFileSync(this.record) : null;
    try {
      atomic(this.record, JSON.stringify({ backup, replaced, blocks: text.match(/# >>> ass managed start[\s\S]*?# <<< ass managed end/g) }));
      atomic(this.file, text);
    } catch (error) {
      if (previousRecord) atomic(this.record, previousRecord);
      else if (fs.existsSync(this.record)) fs.unlinkSync(this.record);
      throw error;
    }
    return backup;
  }
  preflightDetach() {
    if (!fs.existsSync(this.file)) return null;
    const current = fs.readFileSync(this.file, "utf8");
    if (!current.includes(START)) {
      if (current.includes("ass_router") || current.includes(this.baseUrl))
        throw Error("Codex 配置中存在无法归属的 ASS 字段，请先检查配置，未自动删除");
      return null;
    }
    let next = withoutOwn(current);
    const record = JSON.parse(fs.readFileSync(this.record, "utf8"));
    let expected = record.blocks;
    if (!expected) {
      // Recover the exact v0.1.0–v0.1.2 managed text from its saved original.
      const original = fs.readFileSync(record.backup, "utf8");
      expected = prepareConfig(original, this.catalog, "http://127.0.0.1:25819/v1").text
        .replaceAll('name = "ASS', 'name = "AI Switch Servant')
        .match(/# >>> ass managed start[\s\S]*?# <<< ass managed end/g);
    }
    const blocks = current.match(/# >>> ass managed start[\s\S]*?# <<< ass managed end/g);
    if (JSON.stringify(blocks) !== JSON.stringify(expected))
      throw Error("Codex 的 ASS 管理区段已被外部修改，未覆盖；请检查备份和当前配置");
    const parsed = TOML.parse(next);
    for (const [k, v] of Object.entries(record.replaced))
      if (v !== null && parsed[k] === undefined)
        next = `${k} = ${JSON.stringify(v)}\n` + next;
    TOML.parse(next);
    return { current, next };
  }
  prepareRepair() {
    let record, current, parsed;
    try {
      record = JSON.parse(fs.readFileSync(this.record, "utf8"));
      current = fs.existsSync(this.file) ? fs.readFileSync(this.file, "utf8") : "";
      parsed = TOML.parse(current);
    } catch { throw Error("Codex 配置或接入记录无法解析，未修复"); }
    const expected = record.blocks;
    if (!Array.isArray(expected) || expected.length !== 2 || expected.some((s) => typeof s !== "string" ||
        !s.startsWith(START + "\n") || !s.endsWith(END)))
      throw Error("缺少可信的 Codex 管理区段记录，未修复");
    let owned;
    try { owned = expected.map((s) => TOML.parse(s)); }
    catch { throw Error("Codex 管理区段记录无效，未修复"); }
    const topKeys = ["model_provider", "model_catalog_json", "model", "model_reasoning_effort"];
    if (Object.keys(owned[0]).some((k) => !topKeys.includes(k)) ||
        owned[0].model_provider !== "ass_router" || owned[0].model_catalog_json !== this.catalog ||
        !equal(Object.keys(owned[1]), ["model_providers"]) ||
        !equal(Object.keys(owned[1].model_providers || {}), ["ass_router"]) ||
        owned[1].model_providers.ass_router?.base_url !== this.baseUrl)
      throw Error("Codex 管理区段与当前接入不匹配，未修复");
    const blocks = [...current.matchAll(/# >>> ass managed start[\s\S]*?# <<< ass managed end/g)];
    if ((current.split(START).length - 1 !== blocks.length) ||
        (current.split(END).length - 1 !== blocks.length) || ![0, 2].includes(blocks.length))
      throw Error("Codex 管理标记缺失或不完整，未修复");
    const onlyOwned = (value, keys) => Object.keys(value).every((k) => Object.hasOwn(keys, k) &&
      (keys[k] && typeof keys[k] === "object" ? value[k] && typeof value[k] === "object" && onlyOwned(value[k], keys[k]) : true));
    let next = current;
    if (blocks.length) {
      for (let i = blocks.length - 1; i >= 0; i--) {
        let value;
        try { value = TOML.parse(blocks[i][0]); }
        catch { throw Error("Codex 管理区段无法解析，未修复"); }
        if (!onlyOwned(value, owned[i])) throw Error("Codex 管理区段混入非 ASS 字段，未覆盖");
        next = next.slice(0, blocks[i].index) + expected[i] + next.slice(blocks[i].index + blocks[i][0].length);
      }
    } else {
      if (Object.keys(owned[0]).some((k) => Object.hasOwn(parsed, k)) || parsed.model_providers?.ass_router)
        throw Error("Codex 无标记的同名字段无法确认归属，未覆盖");
      next = expected[0] + "\n" + current + "\n" + expected[1] + "\n";
    }
    // A marker within a string is not ownership. Compare the entire semantic
    // document after replacing only the recorded keys, leaving user tables intact.
    const target = structuredClone(parsed);
    Object.assign(target, owned[0]);
    target.model_providers ||= {};
    target.model_providers.ass_router = owned[1].model_providers.ass_router;
    try {
      if (!equal(target, TOML.parse(next))) throw Error();
    } catch { throw Error("修复会影响非 ASS 的 Codex 配置，未写入"); }
    return { file: this.file, before: fs.existsSync(this.file) ? current : null, after: next };
  }
  detach() {
    const plan = this.preflightDetach();
    if (!plan) return;
    const { current, next } = plan;
    atomic(
      path.join(
        this.dataDir,
        "backups",
        "config-detach-" + Date.now() + ".toml",
      ),
      current,
    );
    if (fs.readFileSync(this.file, "utf8") !== current)
      throw Error("Codex 配置同时被修改，请重新检查后断开");
    atomic(this.file, next);
  }
}
module.exports = { atomic, prepareConfig, withoutOwn, ConfigManager };
