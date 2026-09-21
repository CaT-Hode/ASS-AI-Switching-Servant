const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { atomic } = require("./config.cjs");
const TOML = require("@iarna/toml");
const IDS = ["codex", "claude", "opencode", "pi", "dsh"];
const NAMES = new Set(["config.toml", "catalog.json", "models.json", "settings.yaml"]);
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const LEGACY_OFFICIAL = 'cli_auth_credentials_store = "file"\nmodel_provider = "ass_official"\n[model_providers.ass_official]\nname = "ASS Official"\nbase_url = "http://127.0.0.1:25819/v1"\nwire_api = "responses"\nrequires_openai_auth = true\nsupports_websockets = false\n';
function legacyBaseline(harness, name, text) {
  if (text === null) return null;
  if (harness === "codex" && name === "config.toml" && text.replaceAll("\r\n", "\n") === LEGACY_OFFICIAL)
    return 'cli_auth_credentials_store = "file"\n';
  try {
    const value = name === "config.toml" ? TOML.parse(text) : JSON.parse(text);
    const only = (v, keys) => v && Object.keys(v).every((k) => keys.includes(k));
    const local = (url) => typeof url === "string" && /^http:\/\/127\.0\.0\.1:25819\/harness\/[\w-]+\/v1$/.test(url);
    if (harness === "codex" && name === "config.toml" &&
        only(value, ["model", "model_provider", "model_reasoning_effort", "model_catalog_json", "model_providers"]) &&
        value.model_provider === "ass_api" && only(value.model_providers, ["ass_api"]) &&
        value.model_providers.ass_api.base_url === "http://127.0.0.1:25819/v1" && value.model_providers.ass_api.env_key === "ASS_LOCAL_TOKEN") return null;
    if (harness === "pi" && name === "models.json" && only(value, ["providers"]) && only(value.providers, ["ass"]) &&
        local(value.providers.ass.baseUrl) && value.providers.ass.apiKey === "$ASS_LOCAL_TOKEN") return null;
    if (harness === "dsh" && name === "settings.yaml" && only(value, ["llm-pi-ai", "agent-default-model"]) &&
        only(value["llm-pi-ai"], ["providers"]) && only(value["llm-pi-ai"].providers, ["ass-api"]) &&
        local(value["llm-pi-ai"].providers["ass-api"].baseURL) && value["llm-pi-ai"].providers["ass-api"].apiKeyEnv === "ASS_LOCAL_TOKEN") return null;
  } catch { /* Unknown content remains recoverable and is never guessed to be ours. */ }
  return text;
}
class InjectionFiles {
  constructor(dataDir) {
    this.root = path.resolve(dataDir);
    this.file = path.join(this.root, "route-injections.json");
    this.entries = [];
    this.error = "";
    try {
      if (fs.existsSync(this.file)) {
        if (fs.statSync(this.file).size > 16 * 1024 * 1024) throw Error();
        const entries = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (!Array.isArray(entries) || entries.length > 2000) throw Error();
        for (const e of entries) {
          if (!IDS.includes(e.harness) || !/^[a-f0-9]{64}$/.test(e.after) ||
              !(e.before === null || typeof e.before === "string")) throw Error();
          this.target(e.relative, e.harness);
        }
        this.entries = entries;
      }
    } catch { this.error = "注入恢复记录损坏，已禁止覆盖和自动清理，请保留数据目录并检查"; }
  }
  target(relative, harness) {
    if (typeof relative !== "string") throw Error("无效注入路径");
    const parts = relative.replaceAll("\\", "/").split("/");
    if (parts.length !== 4 || parts[0] !== "clients" || parts[1] !== harness ||
        !IDS.includes(harness) || !/^[a-f0-9]{24}$/.test(parts[2]) || !NAMES.has(parts[3]))
      throw Error("注入路径不在 ASS 独立账户目录内");
    let current = this.root;
    for (const part of parts) {
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
        throw Error("注入目录包含链接，拒绝写入或清理");
    }
    return current;
  }
  save() { atomic(this.file, JSON.stringify(this.entries)); }
  adoptLegacy() {
    if (this.error) return;
    for (const harness of IDS) {
      const dir = path.join(this.root, "clients", harness);
      if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) continue;
      for (const account of fs.readdirSync(dir).slice(0, 1000)) {
        if (!/^[a-f0-9]{24}$/.test(account)) continue;
        for (const name of ["config.toml", "models.json", "settings.yaml"]) {
          const relative = `clients/${harness}/${account}/${name}`;
          const file = this.target(relative, harness);
          if (this.entries.some((e) => e.relative === relative) || !fs.existsSync(file)) continue;
          if (fs.statSync(file).size > 1024 * 1024) continue;
          const original = fs.readFileSync(file, "utf8"), before = legacyBaseline(harness, name, original);
          if (before === original) continue;
          atomic(path.join(this.root, "backups", "legacy-injection-" + hash(relative + original) + ".txt"), original);
          this.entries.push({ harness, relative, before, after: hash(original) });
          this.save();
        }
      }
    }
  }
  list(ids) {
    if (this.error) throw Error(this.error);
    return this.entries.filter((e) => ids.includes(e.harness));
  }
  preflight(ids) {
    for (const e of this.list(ids)) {
      const file = this.target(e.relative, e.harness);
      if (fs.existsSync(file) && hash(fs.readFileSync(file)) !== e.after)
        throw Error("注入文件已被外部修改，未覆盖：" + e.relative);
    }
  }
  write(harness, plan) {
    if (this.error) throw Error(this.error);
    this.preflight([harness]);
    for (const [name, content] of plan.files) {
      const relative = path.relative(this.root, path.join(plan.dir, name)).replaceAll("\\", "/");
      const file = this.target(relative, harness);
      let entry = this.entries.find((e) => e.relative === relative);
      const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      if (!entry) {
        entry = { harness, relative, before: legacyBaseline(harness, name, before), after: hash(content) };
        if (entry.before !== before) {
          // Preserve a recovery copy when migrating an exact legacy ASS-generated file.
          atomic(path.join(this.root, "backups", "legacy-injection-" + hash(relative + before) + ".txt"), before);
        }
        this.entries.push(entry);
      } else entry.after = hash(content);
      // Record before writing; a crash or disk error leaves a visible conflict, never guessed cleanup.
      this.save();
      atomic(file, content);
    }
  }
  restore(ids) {
    this.preflight(ids);
    const selected = this.list(ids);
    for (const e of selected) {
      const file = this.target(e.relative, e.harness);
      if (fs.existsSync(file) && hash(fs.readFileSync(file)) !== e.after)
        throw Error("恢复期间注入文件被修改，已停止后续清理：" + e.relative);
      if (e.before === null) {
        if (fs.existsSync(file)) fs.unlinkSync(file); // Exact allowlisted generated file, never a directory.
      } else atomic(file, e.before);
      this.entries = this.entries.filter((x) => x !== e);
      this.save();
    }
    return selected.length;
  }
  fingerprint(ids) {
    return hash(JSON.stringify(this.list(ids).map((e) => {
      const f = this.target(e.relative, e.harness);
      return [e.relative, fs.existsSync(f) ? hash(fs.readFileSync(f)) : null];
    })));
  }
}
module.exports = { InjectionFiles, IDS, hash, legacyBaseline };
