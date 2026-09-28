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

test("Pi uses the official compact monochrome mark, black in light and white in dark", async () => {
  const { providerBrand } = await import("../src/provider-brand.mjs");
  assert.equal(providerBrand({ id: "native-pi" }), "pi");
  const svg = read("public/providers/pi.svg");
  assert.ok(svg.includes('fill="#000"'));
  assert.doesNotMatch(svg, /#F09082|#4D9ABF|#F1BE58/);
  assert.equal((svg.match(/<path /g) || []).length, 3);
  assert.ok(read("src/clients.jsx").includes('pi: "pi"'));
  assert.ok(read("src/theme.css").includes('img[src="./providers/pi.svg"] { filter: var(--pi-logo-filter); }'));
  assert.ok(read("src/theme.css").includes(':root[data-theme="dark"] { --pi-logo-filter: invert(1); }'));
});
