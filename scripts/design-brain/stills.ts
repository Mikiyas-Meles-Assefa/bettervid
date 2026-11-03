// Renders a few stills of compiled scenes, larger than render.ts does, to look closely at single frames.
// Usage: node --experimental-strip-types scripts/design-brain/stills.ts <outDir> <scale> <scene.json>:<f1,f2,...> [more scene:frames]
// Writes <outDir>/<scene base>-<frame>.jpg.
import { mkdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { bundled } from "../../engine/render/bundle.ts";
import { renderStill, selectComposition } from "@remotion/renderer";
import { themeFrom } from "../../engine/render/theme.ts";

const [outDir, scaleArg, ...jobs] = process.argv.slice(2);
const browserExecutable = process.env.BETTERVID_CHROME;
const theme = themeFrom(process.env.STYLE ?? "flat");
mkdirSync(outDir!, { recursive: true });
const serveUrl = await bundled(resolve("engine/render/preview.tsx"));
for (const job of jobs) {
  const [file, list] = job.split(":");
  const scene = JSON.parse(readFileSync(file!, "utf8"));
  const inputProps = { scene, theme };
  const composition = await selectComposition({ serveUrl, id: "Scene", inputProps, browserExecutable });
  const tag = basename(file!).replace(/\.scene\.json$/, "") + "-" + basename(resolve(file!, ".."));
  for (const f of list!.split(",").map(Number)) {
    await renderStill({ serveUrl, composition, inputProps, frame: Math.min(f, scene.frames - 1), imageFormat: "jpeg", jpegQuality: 75, scale: Number(scaleArg), browserExecutable, chromiumOptions: { gl: "angle" }, output: `${outDir}/${tag}-${String(f).padStart(4, "0")}.jpg` });
  }
}
console.log("done");
