const path = require("node:path");
const { execFile } = require("node:child_process");
async function assertClaudePicker(launcher) {
  const version = await new Promise((resolve, reject) => execFile(launcher.executable,
    [...launcher.args, "--version"], { windowsHide: true, timeout: 8000, maxBuffer: 8192 },
    (error, stdout) => error ? reject(Error("无法确认 Claude Code 版本，请运行 claude --version；无账号模型列表需要 2.1.242+")) : resolve(stdout.match(/\b(\d+)\.(\d+)\.(\d+)\b/)?.slice(1).map(Number))));
  if (!version || version[0] < 2 || (version[0] === 2 && (version[1] < 1 || (version[1] === 1 && version[2] < 242))))
    throw Error("仅显示注入模型需要 Claude Code 2.1.242 或更高版本，请先升级客户端");
}

function claudeModelSettings(providers, selected) {
  const options = providers.flatMap((p) => p.models.filter((m) => m.enabled).map((m) => ({
    model: p.id + "::" + m.model,
    label: p.name + " · " + (m.displayName || m.model),
    description: m.model,
  })));
  if (!options.some((m) => m.model === selected)) throw Error("启动模型不在已注入的模型列表中");
  return {
    model: selected,
    availableModels: options.map((m) => m.model),
    enforceAvailableModels: true,
    // Older CC releases use the allowlist plus gateway discovery. v2.1.242+
    // additionally supports an explicitly ordered picker without built-in rows.
    modelPicker: { options, replaceBuiltInOptions: true },
  };
}

function configureClaudeModels(config, providers, selected, dir) {
  const settings = claudeModelSettings(providers, selected);
  config.files.push(["settings.json", JSON.stringify(settings, null, 2)]);
  config.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = "1";
  config.env.CLAUDE_CODE_SUBAGENT_MODEL = selected;
  config.env.ANTHROPIC_DEFAULT_FABLE_MODEL = selected;
  // Never load another project's credential overrides into an API-only home.
  // Managed organizational policy still applies; normal tool approval remains on.
  config.args.push("--setting-sources", "user", "--settings", path.join(dir, "settings.json"));
}
function prepareClaudeOnboarding(dir) {
  const { read, edit, atomic } = require("./native-fields.cjs");
  const file = path.join(dir, ".claude.json"), before = read(file);
  // This file is live CC state, not an injected document to remove on disconnect.
  // Keep trust decisions, MCP entries and any later state written by the client.
  const after = edit(before, "json", ["hasCompletedOnboarding"], { exists: true, value: true });
  if (after !== before) atomic(file, after);
}
module.exports = { claudeModelSettings, configureClaudeModels, assertClaudePicker, prepareClaudeOnboarding };
