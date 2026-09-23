import { packager } from "@electron/packager";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { readFile } from "node:fs/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const outputs = await packager({
  dir: root,
  name: "ASS",
  executableName: "ASS",
  appCopyright: "ASS · Agent-Switching-Servant",
  win32metadata: { FileDescription: "Agent-Switching-Servant", ProductName: "ASS" },
  icon: fileURLToPath(new URL("../assets/ass.ico", import.meta.url)),
  asar: true,
  platform: "win32",
  arch: "x64",
  out: fileURLToPath(new URL("../release/v" + version, import.meta.url)),
  overwrite: true,
  tmpdir: false,
  ignore: /^\/(release|tests|qa|design|scripts)(\/|$)/,
  // Windows scanners can briefly hold the just-extracted runtime open.
  // Give those handles time to close before Packager renames the directory.
  afterExtract: [
    async () => {
      await setTimeout(8000);
    },
  ],
});
for (const output of outputs) console.log("Packaged: " + output);
