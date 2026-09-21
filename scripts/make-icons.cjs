// Deterministic format export of the generated logo, not a replacement drawing.
const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
app
  .whenReady()
  .then(() => {
    const root = path.resolve(__dirname, "..");
    const image = nativeImage.createFromPath(
      path.join(root, "public/ass-logo.png"),
    );
    if (image.isEmpty()) throw new Error("Logo missing");
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const pngs = sizes.map((size) =>
      image.resize({ width: size, height: size, quality: "best" }).toPNG(),
    );
    const header = Buffer.alloc(6 + 16 * sizes.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, i) => {
      const at = 6 + i * 16;
      header[at] = size % 256;
      header[at + 1] = size % 256;
      header.writeUInt16LE(1, at + 4);
      header.writeUInt16LE(32, at + 6);
      header.writeUInt32LE(pngs[i].length, at + 8);
      header.writeUInt32LE(offset, at + 12);
      offset += pngs[i].length;
    });
    fs.mkdirSync(path.join(root, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "assets/ass.ico"),
      Buffer.concat([header, ...pngs]),
    );
    console.log("Exported ASS icon: 16–256px");
    app.quit();
  })
  .catch((e) => {
    console.error(e.message);
    app.exit(1);
  });
