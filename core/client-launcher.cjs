const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

const PACKAGES = {
  codex: ["@openai/codex"],
  claude: ["@anthropic-ai/claude-code"],
  opencode: ["opencode-ai"],
  pi: ["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"],
  dsh: ["@deepseek-ai/dsh"],
};
function stat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}
function json(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
function findExecutable(name, env = process.env) {
  const dirs = (env.Path || env.PATH || "")
    .split(path.delimiter)
    .map((s) => s.replace(/^"|"$/g, ""));
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, "npm"));
  dirs.push(path.join(env.USERPROFILE || os.homedir(), ".local", "bin"));
  for (const dir of dirs.filter(Boolean))
    for (const ext of [".exe", ".cmd", ".ps1"])
      if (stat(path.join(dir, name + ext))?.isFile())
        return path.resolve(dir, name + ext);
  return "";
}
function resolveLauncher(harness, selectedPath, env = process.env) {
  const location = selectedPath ? path.resolve(selectedPath) : "";
  const fail = (message) => ({
    ready: false,
    location,
    executable: "",
    args: [],
    kind: "missing",
    message,
    command: "",
  });
  const launch = (
    executable,
    args,
    kind,
    message,
    entryPoint = executable,
  ) => ({
    ready: true,
    location,
    executable,
    args,
    kind,
    message,
    entryPoint,
    command: [executable, ...args].map((s) => JSON.stringify(s)).join(" "),
  });
  const nodeEntry = (entry, kind, message, loader) => {
    const node = findExecutable("node", env);
    if (!node)
      return fail("已找到入口，但未找到 Node.js；请安装 Node.js 24+ 后刷新");
    return launch(
      node,
      [...(loader ? ["--import", pathToFileURL(loader).href] : []), entry],
      kind,
      message,
      entry,
    );
  };
  if (!PACKAGES[harness]) return fail("未知客户端");
  if (!selectedPath) return fail("未检测到安装；可选择程序或源码目录");
  if (!path.isAbsolute(selectedPath)) return fail("请选择绝对路径");
  const info = stat(location);
  if (!info) return fail("原路径已不存在，请重新选择程序或目录");
  if (info.isFile()) {
    const ext = path.extname(location).toLowerCase();
    if ([".exe", ".cmd", ".ps1"].includes(ext))
      return launch(location, [], "executable", "可执行文件");
    if ([".js", ".mjs", ".cjs"].includes(ext))
      return nodeEntry(location, "node", "Node.js 入口");
    return fail("请选择 exe / cmd / ps1 / js 文件，或客户端目录");
  }
  if (!info.isDirectory()) return fail("所选位置不是文件或目录");
  const manifest = json(path.join(location, "package.json"));
  if (harness === "dsh" && manifest.name === "@deepseek-ai/dsh-root") {
    const cliDir = path.join(location, "apps", "cli");
    if (json(path.join(cliDir, "package.json")).name !== "@deepseek-ai/dsh")
      return fail("DSH 源码缺少 apps/cli/package.json");
    const built = path.join(cliDir, "lib", "bin.js");
    if (stat(built)?.isFile())
      return nodeEntry(built, "source-built", "DSH 源码目录 · 已构建 CLI");
    const source = path.join(cliDir, "src", "bin.ts");
    if (stat(source)?.isFile()) {
      try {
        const loader = createRequire(source).resolve("tsx/esm");
        if (stat(loader)?.isFile())
          return nodeEntry(
            source,
            "source-tsx",
            "DSH 源码目录 · 本地 tsx 入口",
            loader,
          );
      } catch {}
    }
    return fail(
      "已识别 DSH 源码，但未找到构建产物或本地 tsx；请先按项目说明安装依赖并构建",
    );
  }
  if (PACKAGES[harness].includes(manifest.name)) {
    const bin =
      typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[harness];
    if (typeof bin !== "string")
      return fail("已识别客户端包，但没有对应的 bin 入口");
    const entry = path.resolve(location, bin);
    if (!entry.startsWith(location + path.sep))
      return fail("客户端 bin 入口超出所选目录，已拒绝");
    if (!stat(entry)?.isFile())
      return fail("客户端 bin 入口不存在，请先完成安装或构建");
    if (
      [".js", ".mjs", ".cjs"].includes(path.extname(entry).toLowerCase()) ||
      !path.extname(entry)
    )
      return nodeEntry(entry, "npm-package", "npm 客户端包入口");
    return fail("客户端包的 bin 类型尚不支持，请直接选择启动程序");
  }
  for (const relative of ["", "bin", "node_modules/.bin"])
    for (const ext of [".exe", ".cmd", ".ps1"]) {
      const entry = path.join(location, relative, harness + ext);
      if (stat(entry)?.isFile())
        return launch(entry, [], "directory", "安装目录 · 可执行入口");
    }
  for (const pkg of PACKAGES[harness]) {
    const packageDir = path.join(location, "node_modules", pkg);
    if (stat(path.join(packageDir, "package.json"))?.isFile()) {
      const result = resolveLauncher(harness, packageDir, env);
      return { ...result, location };
    }
  }
  return fail("此目录中未识别到该客户端；请选择安装根目录或受支持的源码根目录");
}
function searchLocations(harness, env = process.env) {
  const home = env.USERPROFILE || os.homedir();
  const locations = [findExecutable(harness, env)];
  if (harness === "dsh") {
    const roots = [
      home,
      path.join(home, "source", "repos"),
      path.join(home, "projects"),
      path.join(home, "Documents"),
      path.join(home, "dev"),
    ];
    if (process.platform === "win32")
      roots.push(path.parse(home).root, "D:\\", "E:\\");
    for (const root of roots)
      locations.push(path.join(root, "deepseek-harness"));
  }
  return locations.filter(Boolean);
}
function discoverLaunchers(
  harness,
  env = process.env,
  locations = searchLocations(harness, env),
) {
  const found = [],
    seen = new Set();
  for (const location of locations) {
    const result = resolveLauncher(harness, location, env);
    if (!result.ready) continue;
    const identity = JSON.stringify([
      result.executable,
      result.args,
    ]).toLowerCase();
    if (!seen.has(identity)) {
      seen.add(identity);
      found.push(result);
    }
  }
  return found;
}
module.exports = { findExecutable, resolveLauncher, discoverLaunchers };
