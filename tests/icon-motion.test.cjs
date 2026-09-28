const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
test("all app icons have semantic motion tracks targeting existing named SVG parts", async () => {
  const { iconArt } = await import("../src/icon-art.mjs");
  const { iconMotion } = await import("../src/icon-motion-recipes.mjs");
  assert.deepEqual(Object.keys(iconArt).sort(), Object.keys(iconMotion).sort());
  for (const [name, art] of Object.entries(iconArt)) {
    const parts = [];
    const visit = ([tag, attrs, children]) => { assert.ok(tag); if (attrs["data-part"]) parts.push(attrs["data-part"]); children?.forEach(visit); };
    art.forEach(visit);
    assert.equal(parts.length, new Set(parts).size, name + " uses duplicate part names");
    for (const track of iconMotion[name]) {
      assert.ok(parts.includes(track.part), name + " missing " + track.part);
      assert.ok(track.duration > 0 && track.duration + track.delay <= 560);
      assert.ok(track.frames.length >= 2);
      for (const frame of track.frames) assert.ok(Object.keys(frame).every((k) => ["transform", "opacity", "offset"].includes(k)));
    }
  }
  for (const file of fs.readdirSync(path.join(__dirname, "../src")).filter((n) => n.endsWith(".jsx") && n !== "icons.jsx")) {
    const source = fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
    assert.ok(!source.includes('from "lucide-react"'), file + " bypasses semantic icons");
    for (const match of source.matchAll(/import\s*{([^}]+)}\s*from\s*"\.\/icons.jsx"/g))
      for (const name of match[1].split(",").map((s) => s.trim()).filter(Boolean)) assert.ok(iconArt[name] || name === "Loader2", name);
  }
});

test("delegated motion coalesces rapid input, ignores disabled/theme controls and cleans up", async () => {
  const { attachIconMotion } = await import("../src/icon-player.mjs");
  const events = new Map(), mediaEvents = new Map();
  const reduced = { matches: false, addEventListener: (_, fn) => mediaEvents.set("change", fn), removeEventListener: () => mediaEvents.clear() };
  const win = { matchMedia: (q) => q.includes("reduce") ? reduced : { matches: true }, addEventListener() {}, removeEventListener() {} };
  const root = { contains: () => true, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name) => events.delete(name) };
  let blocked = false, count = 0; const animations = [];
  const host = { matches: () => blocked, contains: () => false, querySelectorAll: () => [svg] };
  const svg = { dataset: { motionIcon: "Settings2" }, closest: (q) => q === ".spin" ? null : host,
    querySelector: () => ({ animate() { count++; const a = { finished: new Promise(() => {}), cancel() { this.cancelled = true; }, updatePlaybackRate(rate) { this.rate = rate; } }; animations.push(a); return a; } }) };
  const event = { target: { closest: () => host }, button: 0, pointerType: "mouse" };
  const dispose = attachIconMotion(root, win);
  events.get("pointerover")(event); assert.equal(count, 2);
  events.get("pointerdown")(event); assert.equal(count, 2); assert.ok(animations.every((a) => a.rate === 1.35));
  events.get("keydown")(); assert.ok(animations.every((a) => a.cancelled)); assert.equal(svg.dataset.iconAnimating, undefined);
  blocked = true; events.get("pointerover")(event); assert.equal(count, 2);
  blocked = false; reduced.matches = true; events.get("pointerdown")(event); assert.equal(count, 2);
  reduced.matches = false; events.get("pointerover")({ ...event, pointerType: "touch" }); assert.equal(count, 2);
  events.get("pointerover")(event); assert.equal(count, 4);
  mediaEvents.get("change")(); assert.equal(svg.dataset.iconAnimating, undefined);
  dispose(); assert.equal(events.size, 0); assert.equal(mediaEvents.size, 0);
});
