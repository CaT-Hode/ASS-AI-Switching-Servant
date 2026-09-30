"use strict";

// Development-only bitmap -> actual Bezier paths. Potrace is installed under
// qa/logo-trace-tools, not in the application's dependency tree or release.
const { app, nativeImage, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Potrace } = require("../qa/logo-trace-tools/node_modules/potrace");
const root = path.resolve(__dirname, "..");
app.commandLine.appendSwitch("force-device-scale-factor", "1");

function classify(bitmap, width, height) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const [b, g, r, a] = bitmap.subarray(i * 4, i * 4 + 4);
    if (a < 128) continue;
    if (Math.min(r, g, b) > 55 && Math.max(r, g, b) - Math.min(r, g, b) < 24) mask[i] = 1;
    else if (r > 145 && g > 55 && g < 195 && b < 115 && r > g * 1.22 && g > b * 1.35) mask[i] = 2;
  }
  return mask;
}
function components(mask, width, height) {
  const labels = new Int32Array(mask.length), queue = new Int32Array(mask.length);
  const found = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    const id = found.length + 1, type = mask[i];
    let head = 0, tail = 0, sx = 0, sy = 0, left = width, top = height, right = 0, bottom = 0;
    queue[tail++] = i; labels[i] = id;
    while (head < tail) {
      const at = queue[head++], x = at % width, y = Math.floor(at / width);
      sx += x; sy += y; left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const next of [x > 0 ? at - 1 : -1, x + 1 < width ? at + 1 : -1,
        y > 0 ? at - width : -1, y + 1 < height ? at + width : -1]) {
        if (next < 0 || labels[next] || mask[next] !== type) continue;
        labels[next] = id; queue[tail++] = next;
      }
    }
    found.push({ id, type, area: tail, centroid: [sx / tail, sy / tail], bounds: [left, top, right, bottom] });
  }
  return { labels, found };
}
function representativeColor(bitmap, labels, ids) {
  const histograms = Array.from({ length: 3 }, () => new Uint32Array(256));
  let count = 0;
  for (let i = 0; i < labels.length; i++) {
    if (!ids.has(labels[i]) || bitmap[i * 4 + 3] !== 255) continue;
    const at = i * 4;
    histograms[0][bitmap[at + 2]]++; histograms[1][bitmap[at + 1]]++; histograms[2][bitmap[at]]++; count++;
  }
  return "#" + histograms.map(hist => {
    let sum = 0;
    for (let value = 0; value < 256; value++) { sum += hist[value]; if (sum >= count / 2) return value.toString(16).padStart(2, "0"); }
    throw Error("Empty reference color sample");
  }).join("");
}
async function traceComponent(component, labels, width, height, color) {
  const bitmap = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < labels.length; i++) if (labels[i] === component.id) {
    bitmap[i * 4] = 0; bitmap[i * 4 + 1] = 0; bitmap[i * 4 + 2] = 0;
  }
  const png = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 }).toPNG();
  const tracer = new Potrace({ threshold: 128, turdSize: 8, alphaMax: 0.85,
    optCurve: true, optTolerance: 0.06, color, background: "transparent" });
  await new Promise((resolve, reject) => tracer.loadImage(png, err => err ? reject(err) : resolve()));
  return tracer.getPathTag().replace("<path ", `<path id="${component.type === 1 ? "petal" : "hub"}-${component.id}" `);
}
async function render(svg, width, height) {
  const window = new BrowserWindow({ width, height, useContentSize: true, frame: false,
    show: false, transparent: true, backgroundColor: "#00000000",
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } });
  try {
    const html = `<html><head><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${svg}</body></html>`;
    await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    return await window.webContents.capturePage({ x: 0, y: 0, width, height });
  } finally { window.destroy(); }
}
function similarity(expected, actual, type) {
  let intersection = 0, union = 0;
  for (let i = 0; i < expected.length; i++) {
    const a = expected[i] === type, b = actual[i] === type;
    if (a && b) intersection++;
    if (a || b) union++;
  }
  return { intersection, union, iou: intersection / union };
}
app.whenReady().then(async () => {
  const source = path.join(root, "docs/assets/ass-reference-flat.png");
  const image = nativeImage.createFromPath(source), { width, height } = image.getSize();
  if (image.isEmpty()) throw Error("Reference image missing");
  const bitmap = image.toBitmap(), sourceMask = classify(bitmap, width, height);
  const { labels, found } = components(sourceMask, width, height);
  const petals = found.filter(c => c.type === 1 && c.area > 5000);
  const hub = found.filter(c => c.type === 2).sort((a, b) => b.area - a.area)[0];
  if (petals.length !== 8 || !hub || hub.area < 10000) throw Error(`Reference decomposition failed: ${petals.length} petals`);
  petals.sort((a, b) => Math.atan2(a.centroid[1] - height / 2, a.centroid[0] - width / 2)
    - Math.atan2(b.centroid[1] - height / 2, b.centroid[0] - width / 2));
  const selected = [...petals, hub], selectedIds = new Set(selected.map(c => c.id));
  const cleanedMask = sourceMask.map((value, i) => selectedIds.has(labels[i]) ? value : 0);
  const colors = { petals: representativeColor(bitmap, labels, new Set(petals.map(c => c.id))),
    hub: representativeColor(bitmap, labels, new Set([hub.id])) };
  const paths = [];
  for (const component of selected) paths.push(await traceComponent(component, labels, width, height,
    component.type === 1 ? colors.petals : colors.hub));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">\n<title id="title">ASS reference — eight individually traced petals and original circular hub</title>\n${paths.join("\n")}\n</svg>\n`;
  if (/<image|href=|data:image|gradient|filter=/i.test(svg)) throw Error("Reference must be genuine editable paths");
  const preview = await render(svg, width, height), actualMask = classify(preview.toBitmap(), width, height);
  const fidelity = { petals: similarity(cleanedMask, actualMask, 1), hub: similarity(cleanedMask, actualMask, 2) };
  if (fidelity.petals.iou < 0.985 || fidelity.hub.iou < 0.985) throw Error("Reference tracing drifted from bitmap boundaries");
  fs.mkdirSync(path.join(root, "design/logo"), { recursive: true });
  fs.writeFileSync(path.join(root, "public/ass-logo-reference.svg"), svg);
  fs.writeFileSync(path.join(root, "design/logo/ass-reference-preview.png"), preview.toPNG());
  const report = { source: "docs/assets/ass-reference-flat.png", sourceSha256: createHash("sha256").update(fs.readFileSync(source)).digest("hex"),
    size: [width, height], vector: "public/ass-logo-reference.svg", preview: "design/logo/ass-reference-preview.png",
    tool: "node-potrace 2.1.8 (development-only GPL-2.0 tracer; no tool code included in SVG or application)",
    colors, shapes: selected, fidelity,
    scope: "Individual source outlines, original positions, spacing, circular hub; solid-color medians; no symmetry or redesign; red/noise pixels excluded" };
  fs.writeFileSync(path.join(root, "docs/assets/ass-reference-trace.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ size: report.size, paths: selected.length, colors, fidelity,
    vector: report.vector, preview: report.preview }, null, 2));
  app.quit();
}).catch(err => { console.error(err.stack); app.exit(1); });
