const fs = require("node:fs");
const path = require("node:path");
const { locations } = require("./additional-harnesses.cjs");

function target(manager) {
  const variant = manager.state.nativeVariants?.kimi || "auto";
  const override = manager.state.credentialHomes.kimi;
  const candidates = locations("kimi", { home: manager.nativeHome, env: manager.nativeEnv, override });
  let chosen;
  if (variant !== "auto") {
    chosen = override ? candidates[0] : candidates.find((c) => c.legacy === (variant === "legacy"));
    if (!chosen) throw Error("未找到所选 Kimi 配置目录，请指定目录");
    chosen = { ...chosen, legacy: variant === "legacy" };
  } else if (override) {
    chosen = candidates[0];
    if (chosen.legacy === null) throw Error("请在客户端设置中选择 Kimi 配置版本");
  } else {
    const existing = candidates.filter((c) => fs.existsSync(path.join(c.dir, "config.toml")));
    if (existing.length > 1) throw Error("检测到新旧两套 Kimi 配置，请在客户端设置中选择版本");
    // An existing legacy home without a config is still evidence of that client.
    chosen = existing[0] || candidates.find((c) => fs.existsSync(c.dir)) || candidates[0];
  }
  return { dir: chosen.dir, config: path.join(chosen.dir, "config.toml"), variant: chosen.legacy ? "legacy" : "current" };
}
module.exports = { target };
