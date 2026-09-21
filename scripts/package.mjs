import { packager } from "@electron/packager";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const outputs = await packager({
  dir: root,
  name: "ASS",
  executableName: "ASS",
  appCopyright: "AI Switch Servant",
  icon: fileURLToPath(new URL("../assets/ass.ico", import.meta.url)),
  asar: true,
  platform: "win32",
  arch: "x64",
  out: fileURLToPath(new URL("../release", import.meta.url)),
  overwrite: true,
  tmpdir: false,
  ignore: /^\/(release|tests|qa|design|scripts)(\/|$)/,
  // Windows scanners can briefly hold the just-extracted runtime open.
  // Give those handles time to close before Packager renames the directory.
  afterExtract: [
    async () => {
      await setTimeout(2000);
    },
  ],
});
for (const output of outputs) console.log("Packaged: " + output);
