const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server"), icons = require("lucide-react");
test("every icon motion selector matches the actual Lucide class, including numbered names and aliases", () => {
  const css = fs.readFileSync(path.join(__dirname, "../src/motion.css"), "utf8");
  for (const name of new Set(css.match(/lucide-[a-z\d-]+/g))) {
    const exported = name.slice(7).split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
    assert.ok(icons[exported], "missing icon " + exported);
    const html = renderToStaticMarkup(React.createElement(icons[exported]));
    assert.ok(html.includes("lucide " + name + '"'), name + " does not match actual SVG classes");
  }
});
