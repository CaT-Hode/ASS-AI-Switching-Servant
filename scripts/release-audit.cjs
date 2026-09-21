// Run after git add. Optional ASS_AUDIT_EXPORT is a private provider export to
// compare in memory; neither its credentials nor contents are printed or copied.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const forbidden =
  /(?:^|\/)(?:auth\.json|\.credentials\.json|settings\.json|clients\.json|native-accounts\.json|updates\.json|connections\.json|route-injections\.json|client-processes\.json|codex-attachment\.json|requests\.jsonl(?:\.previous)?|[^/]+\.aimami-relay\.json)$/i;
const tokenShape =
  /\b(?:sk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{28,}|gh[pousr]_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b/;
const secrets = [];
function collect(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, v] of Object.entries(value)) {
    if (
      /^(apiKey|access_token|refresh_token|accessToken|refreshToken)$/i.test(
        key,
      ) &&
      typeof v === "string" &&
      v.length >= 8
    )
      secrets.push(v);
    else if (v && typeof v === "object") collect(v);
  }
}
if (process.env.ASS_AUDIT_EXPORT)
  collect(JSON.parse(fs.readFileSync(process.env.ASS_AUDIT_EXPORT, "utf8")));
function check(name, buffer, packaged = false) {
  const normalized = name.replaceAll("\\", "/");
  if (forbidden.test(normalized))
    throw Error("Private filename found: " + normalized);
  if (/^\/?backups\//.test(normalized)) throw Error("Private backup found: " + normalized);
  if (packaged && /^\/?(?:qa|design|tests|scripts)\//.test(normalized))
    throw Error("Development-only artifact found: " + normalized);
  if (
    !/\.(?:json|c?js|mjs|jsx|ts|tsx|md|txt|toml|ya?ml|html|css|lock)$/.test(
      normalized,
    )
  )
    return;
  const text = buffer.toString("utf8");
  if (secrets.some((s) => text.includes(s)) || tokenShape.test(text))
    throw Error("Possible credential found in: " + normalized);
}
(async () => {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString()
    .split("\0")
    .filter(Boolean);
  if (!files.length) throw Error("Stage the source files before auditing");
  for (const f of files) check(f, fs.readFileSync(path.join(root, f)));
  const { listPackage, extractFile } = await import("@electron/asar");
  const archive = path.join(
    root,
    "release/v" +
      require("../package.json").version +
      "/ASS-win32-x64/resources/app.asar",
  );
  const entries = listPackage(archive);
  for (const entry of entries) {
    const name = entry.replace(/^[\\/]/, "");
    if (forbidden.test(name.replaceAll("\\", "/")))
      throw Error("Private packaged filename found");
    if (
      /\.(?:json|c?js|mjs|jsx|ts|tsx|md|txt|toml|ya?ml|html|css|lock)$/.test(
        name,
      )
    )
      check(name, extractFile(archive, name), true);
  }
  console.log(
    JSON.stringify({
      sourceFiles: files.length,
      packagedEntries: entries.length,
      privateCredentialComparison: secrets.length > 0,
      audit: "passed",
    }),
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
