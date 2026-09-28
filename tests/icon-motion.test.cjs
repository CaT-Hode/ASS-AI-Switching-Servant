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
    assert.ok(iconMotion[name].hover.length && iconMotion[name].press.length, name + " needs hover and press choreography");
    assert.ok(iconMotion[name].press.every((track) => !track.loop), name + " press must end");
    for (const track of [...iconMotion[name].hover, ...iconMotion[name].press]) {
      assert.ok(parts.includes(track.part), name + " missing " + track.part);
      assert.ok(track.duration > 0 && track.duration + (track.delay || 0) <= 4000);
      assert.ok(track.frames.length >= 1);
      for (const frame of track.frames) assert.ok(Object.keys(frame).every((k) => ["transform", "opacity", "offset", "strokeDasharray", "strokeDashoffset"].includes(k)));
    }
  }
  for (const file of fs.readdirSync(path.join(__dirname, "../src")).filter((n) => n.endsWith(".jsx") && n !== "icons.jsx")) {
    const source = fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
    assert.ok(!source.includes('from "lucide-react"'), file + " bypasses semantic icons");
    for (const match of source.matchAll(/import\s*{([^}]+)}\s*from\s*"\.\/icons.jsx"/g))
      for (const name of match[1].split(",").map((s) => s.trim()).filter(Boolean)) assert.ok(iconArt[name] || ["Loader2", "BrandMotion"].includes(name), name);
  }
});

test("motion has separate hover/press/exit, retargets live frames and cleans up detached or disabled controls", async () => {
  const { attachIconMotion } = await import("../src/icon-player.mjs");
  const events = new Map(), mediaEvents = new Map();
  const reduced = { matches: false, addEventListener: (_, fn) => mediaEvents.set("change", fn), removeEventListener: () => mediaEvents.clear() };
  let observe;
  const win = { matchMedia: (q) => q.includes("reduce") ? reduced : { matches: true }, addEventListener() {}, removeEventListener() {},
    getComputedStyle: () => ({ transform: "matrix(1,0,0,1,2.5,0)", opacity: "1" }), MutationObserver: class { constructor(fn) { observe = fn; } observe() {} disconnect() {} } };
  const root = { contains: () => true, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name) => events.delete(name) };
  let blocked = false, count = 0; const animations = [];
  const host = { matches: (q) => q === '[data-icon-scope]' ? false : blocked, contains: () => false, querySelectorAll: () => [svg] };
  const svg = { isConnected: true, dataset: { motionIcon: "Settings2" }, closest: (q) => q === ".spin" ? null : host,
    querySelector: () => ({ animate(frames) { count++; const a = { frames, finished: new Promise(() => {}), cancel() { this.cancelled = true; } }; animations.push(a); return a; } }) };
  const event = { target: { closest: () => host }, button: 0, pointerType: "mouse" };
  const dispose = attachIconMotion(root, win);
  events.get("pointerover")(event); assert.equal(count, 2);
  assert.equal(svg.dataset.iconPhase, 'hover');
  events.get("pointerdown")(event); assert.equal(count, 4); assert.equal(svg.dataset.iconPhase, 'press');
  assert.equal(animations.at(-1).frames[0].transform, 'matrix(1,0,0,1,2.5,0)', 'press starts at the live hover frame');
  events.get("pointerdown")(event); assert.equal(count, 4, 'rapid press does not restart an in-flight press');
  events.get('pointerout')(event); assert.equal(svg.dataset.iconPhase, 'exit'); assert.equal(count, 6);
  events.get('pointerover')(event); assert.equal(svg.dataset.iconPhase, 'hover'); assert.equal(count, 8);
  events.get("keydown")(); assert.ok(animations.every((a) => a.cancelled)); assert.equal(svg.dataset.iconAnimating, undefined);
  blocked = true; events.get("pointerover")(event); assert.equal(count, 8);
  blocked = false; reduced.matches = true; events.get("pointerdown")(event); assert.equal(count, 8);
  reduced.matches = false; events.get("pointerover")({ ...event, pointerType: "touch" }); assert.equal(count, 8);
  events.get("pointerover")(event); assert.equal(count, 10);
  svg.isConnected = false; observe(); assert.equal(svg.dataset.iconAnimating, undefined);
  svg.isConnected = true; events.get('pointerover')(event); blocked = true; observe(); assert.equal(svg.dataset.iconAnimating, undefined);
  mediaEvents.get("change")(); assert.equal(svg.dataset.iconAnimating, undefined);
  dispose(); assert.equal(events.size, 0); assert.equal(mediaEvents.size, 0);
});
