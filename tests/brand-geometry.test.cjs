const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SPEC, loadPetals, createGeometry, buildLogoSvg, pointSegmentDistance } = require("../scripts/brand-geometry.cjs");
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("all eight traced petals stay byte-identical; only the central orange path changes", () => {
  const reference = loadPetals(), svg = buildLogoSvg();
  assert.equal(reference.length, 8);
  for (const petal of reference) assert.ok(svg.includes(petal.tag), petal.id);
  assert.equal((svg.match(/<path /g) || []).length, 9);
  assert.ok(svg.includes('id="hub-fitted"'));
  assert.ok(svg.includes(`A ${SPEC.holeRadius} ${SPEC.holeRadius}`));
  assert.doesNotMatch(svg, /<use|rotate\(|gradient|filter=|opacity=|<image|data:image|<script/i);
});
test("actual petal-root facets AND all eight gap-width bridges share the same hub clearance", () => {
  const { hub, perimeter, facets } = createGeometry();
  assert.equal(facets.filter(f => f.type === "gap").length, 8);
  assert.equal(new Set(facets.filter(f => f.type === "petal").map(f => f.id)).size, 8);
  for (let i = 0; i < perimeter.length; i++) {
    const next = (i + 1) % hub.length;
    for (const p of [hub[i], hub[next]]) near(dot(sub(perimeter[i], p), facets[i].outward), SPEC.gap);
    near(dot(sub(hub[next], hub[i]), facets[i].outward), 0);
    assert.ok(hub[i].every(Number.isFinite));
  }
});
test("fitted hub stays clear of the original unmodified Bezier petals and keeps a substantial circular band", () => {
  const { hub, roots } = createGeometry();
  let closest = Infinity;
  for (let i = 0; i < hub.length; i++) {
    const a = hub[i], b = hub[(i + 1) % hub.length];
    for (let step = 0; step <= 4; step++) {
      const p = a.map((v, k) => v + (b[k] - v) * step / 4);
      assert.ok(Math.hypot(...sub(p, SPEC.center)) > SPEC.holeRadius + 32);
      for (const { samples } of roots) {
        for (let j = 0; j < samples.length; j++) closest = Math.min(closest,
          pointSegmentDistance(p, samples[j], samples[(j + 1) % samples.length]));
      }
    }
  }
  assert.ok(closest >= SPEC.gap - SPEC.simplifyTolerance - 1.1, `hub clearance: ${closest}`);
});
