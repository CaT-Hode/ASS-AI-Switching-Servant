// Windows icons use the artwork bounds, not the generated canvas bounds.
// Ignore virtually invisible alpha noise when measuring the original logo.
function iconCrop(bitmap, width, height, occupancy = 0.94) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || bitmap.length !== width * height * 4)
    throw Error("Invalid icon bitmap");
  if (!(occupancy > 0 && occupancy <= 1)) throw Error("Invalid icon occupancy");
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bitmap[(y * width + x) * 4 + 3] < 8) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) throw Error("Icon contains no visible artwork");
  const artwork = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  const side = Math.ceil(Math.max(artwork.width, artwork.height) / occupancy);
  if (side > Math.min(width, height)) throw Error("Logo needs more source padding for square icon export");
  const crop = {
    x: Math.max(0, Math.min(width - side, Math.floor(left + artwork.width / 2 - side / 2))),
    y: Math.max(0, Math.min(height - side, Math.floor(top + artwork.height / 2 - side / 2))),
    width: side, height: side,
  };
  return { crop, artwork, occupancy: Math.max(artwork.width, artwork.height) / side };
}
module.exports = { iconCrop };
