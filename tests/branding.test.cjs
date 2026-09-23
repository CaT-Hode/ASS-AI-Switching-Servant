const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
test("project full name is Agent-Switching-Servant with ASS product and matching package lock", () => {
  const pkg = JSON.parse(read("package.json")), lock = JSON.parse(read("package-lock.json"));
  assert.equal(pkg.name, "agent-switching-servant");
  assert.equal(pkg.productName, "ASS");
  assert.ok(pkg.description.includes("Agent-Switching-Servant"));
  assert.equal(lock.name, pkg.name); assert.equal(lock.packages[""].name, pkg.name);
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[""].version, pkg.version);
  for (const file of ["README.md", "LICENSE", "src/updates.jsx", "core/openrouter-auth.cjs", "scripts/package.mjs"])
    assert.ok(read(file).includes("Agent-Switching-Servant"), file);
});
test("brand rename retains persisted data location, app identity and update compatibility", () => {
  const main = read("electron/main.cjs"), updates = read("core/updates.cjs");
  assert.ok(main.includes('path.join(app.getPath("appData"), "AI Switch Servant")'));
  assert.ok(main.includes('app.setName("ASS")'));
  assert.ok(main.includes('app.setAppUserModelId("local.ass.desktop")'));
  assert.ok(updates.includes('CaT-Hode/ASS-AI-Switching-Servant'));
  assert.ok(updates.includes('AI-Switch-Servant-v${v.text}-win32-x64.zip'));
  assert.ok(read("core/config.cjs").includes(".replaceAll('name = \"ASS', 'name = \"AI Switch Servant')"));
});
