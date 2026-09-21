const { test } = require("node:test");
const assert = require("node:assert/strict");
const { iconCrop } = require("../scripts/icon-layout.cjs");

function rectangle(width, height, x, y, w, h) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let row = y; row < y + h; row++)
    for (let col = x; col < x + w; col++) bitmap[(row * width + col) * 4 + 3] = 255;
  return bitmap;
}
test("icon export enlarges padded artwork to 94 percent and centers it without stretching", () => {
  const bitmap = rectangle(1254, 1254, 187, 196, 884, 878);
  bitmap[3] = 1; // Invisible generation noise must not keep the full canvas.
  const { crop, artwork, occupancy } = iconCrop(bitmap, 1254, 1254);
  assert.deepEqual(artwork, { x: 187, y: 196, width: 884, height: 878 });
  assert.deepEqual(crop, { x: 158, y: 164, width: 941, height: 941 });
  assert.ok(occupancy >= 0.938 && occupancy <= 0.94);
  assert.ok(Math.abs(artwork.x + artwork.width / 2 - (crop.x + crop.width / 2)) <= 0.5);
  assert.ok(Math.abs(artwork.y + artwork.height / 2 - (crop.y + crop.height / 2)) <= 0.5);
});
test("icon export rejects empty or invalid input without replacing the asset", () => {
  assert.throws(() => iconCrop(Buffer.alloc(0), 0, 0));
  assert.throws(() => iconCrop(Buffer.alloc(16), 2, 2));
  assert.throws(() => iconCrop(rectangle(4, 4, 0, 0, 4, 4), 4, 4, 0.94));
});
