const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), asar = require("@electron/asar");
const root = path.resolve(__dirname, ".."), { version } = require("../package.json");
const archive = path.join(root, "release", "v" + version, "ASS-win32-x64/resources/app.asar");
let count = 0;
function verify(relative) {
  for (const e of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, e.name);
    if (e.isDirectory()) verify(name);
    else {
      if (!asar.extractFile(archive, name).equals(fs.readFileSync(path.join(root, name)))) throw Error("Packaged source mismatch: " + name);
      count++;
    }
  }
}
for (const dir of ["core", "electron", "dist"]) verify(dir);
const forbidden = asar.listPackage(archive).filter((n) => /^[/\\](?:qa|tests|design|release|\.git)(?:[/\\]|$)/.test(n) ||
  /^[/\\](?:auth\.json|clients(?:\.before-[^/\\]+)?\.json|settings\.json|preferences\.json|[^/\\]+\.enc\.json|[^/\\]+\.aimami-relay\.json|\.env(?:\..*)?)$/.test(n));
if (forbidden.length) throw Error("Forbidden packaged files: " + forbidden.join(", "));
const suspect = [];
for (const relative of ["core", "electron", "src"]) for (const name of fs.readdirSync(path.join(root, relative))) {
  const file = path.join(root, relative, name);
  if (!fs.statSync(file).isFile()) continue;
  if (/sk-(?:proj-|ant-)?[A-Za-z0-9_-]{35,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(fs.readFileSync(file, "utf8"))) suspect.push(path.join(relative, name));
}
if (suspect.length) throw Error("Unexpected token-shaped source content: " + suspect.join(", "));
if (JSON.parse(asar.extractFile(archive, "package.json")).version !== version) throw Error("Wrong packaged version");
console.log(JSON.stringify({ version, identicalRuntimeFiles: count, forbiddenPackagedFiles: forbidden.length, tokenShapedSourceFiles: suspect.length,
  asarSha256: crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex") }));
