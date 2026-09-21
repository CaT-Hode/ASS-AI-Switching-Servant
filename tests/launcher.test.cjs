const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  resolveLauncher,
  discoverLaunchers,
} = require("../core/client-launcher.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ass-launcher-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (p, value = "") => {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), value);
  };
  write("runtime/node.exe");
  return {
    root,
    write,
    env: { PATH: path.join(root, "runtime"), USERPROFILE: root },
  };
}
test("DSH source directory resolves built CLI without changing working directory", (t) => {
  const { root, write, env } = fixture(t);
  write("repo/package.json", '{"name":"@deepseek-ai/dsh-root"}');
  write("repo/apps/cli/package.json", '{"name":"@deepseek-ai/dsh"}');
  write("repo/apps/cli/lib/bin.js");
  const source = path.join(root, "repo"),
    result = resolveLauncher("dsh", source, env);
  assert.equal(result.ready, true);
  assert.equal(result.kind, "source-built");
  assert.deepEqual(result.args, [path.join(source, "apps/cli/lib/bin.js")]);
  assert.equal(result.cwd, undefined);
  assert.equal(fs.existsSync(path.join(source, "dsh-ass.cmd")), false);
  assert.equal(discoverLaunchers("dsh", env, [source, source]).length, 1);
});
test("source recognition reports missing dependencies and Node without executing package scripts", (t) => {
  const { root, write, env } = fixture(t);
  write(
    "repo/package.json",
    '{"name":"@deepseek-ai/dsh-root","scripts":{"dsh":"untrusted-command"}}',
  );
  write("repo/apps/cli/package.json", '{"name":"@deepseek-ai/dsh"}');
  assert.match(
    resolveLauncher("dsh", path.join(root, "repo"), env).message,
    /构建产物/,
  );
  write("repo/apps/cli/lib/bin.js");
  assert.match(
    resolveLauncher("dsh", path.join(root, "repo"), {
      PATH: "",
      USERPROFILE: root,
    }).message,
    /Node.js/,
  );
});
test("npm directories, executable paths and script entries remain compatible", (t) => {
  const { root, write, env } = fixture(t);
  write(
    "npm/package.json",
    '{"name":"@mariozechner/pi-coding-agent","bin":{"pi":"dist/cli.js"}}',
  );
  write("npm/dist/cli.js");
  write("dsh.cmd");
  assert.equal(
    resolveLauncher("pi", path.join(root, "npm"), env).kind,
    "npm-package",
  );
  assert.equal(
    resolveLauncher("dsh", path.join(root, "dsh.cmd"), env).kind,
    "executable",
  );
  assert.equal(
    resolveLauncher("pi", path.join(root, "npm/dist/cli.js"), env).kind,
    "node",
  );
  assert.equal(resolveLauncher("pi", "relative-path", env).ready, false);
});
test("ambiguous installations are returned separately and package bin cannot escape directory", (t) => {
  const { root, write, env } = fixture(t);
  write("one/dsh.cmd");
  write("two/dsh.cmd");
  assert.equal(
    discoverLaunchers("dsh", env, [
      path.join(root, "one"),
      path.join(root, "two"),
    ]).length,
    2,
  );
  write(
    "bad/package.json",
    '{"name":"@deepseek-ai/dsh","bin":{"dsh":"../outside.js"}}',
  );
  write("outside.js");
  assert.match(
    resolveLauncher("dsh", path.join(root, "bad"), env).message,
    /超出/,
  );
});
