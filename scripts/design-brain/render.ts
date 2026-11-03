// Renders a compiled scene (scene.json) as a small clip and a sheet of stills, low resolution to keep disk use small.
// Usage: node --experimental-strip-types scripts/design-brain/render.ts <scene.json> <outPrefix> [style]
// Writes <outPrefix>.mp4 (about 360 px wide) and <outPrefix>-frames/ (one still a second, 216 px wide).
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { themeFrom } from "../../engine/render/theme.ts";

const [file, out, style = process.env.STYLE ?? "flat"] = process.argv.slice(2);
const scene = JSON.parse(readFileSync(file!, "utf8"));
const theme = themeFrom(style);
const browserExecutable = process.env.BETTERVID_CHROME;
const concurrency = Number(process.env.RENDER_CONCURRENCY ?? 3);
const serveUrl = await bundle({ entryPoint: resolve("engine/render/preview.tsx") });
const inputProps = { scene, theme };
const composition = await selectComposition({ serveUrl, id: "Scene", inputProps, browserExecutable });
await renderMedia({ serveUrl, composition, inputProps, codec: "h264", imageFormat: "jpeg", concurrency, crf: 28, scale: 1 / 3, browserExecutable, chromiumOptions: { gl: "angle" }, outputLocation: `${out}.mp4` });
const dir = `${out}-frames`;
mkdirSync(dir, { recursive: true });
for (let f = 15; f < scene.frames; f += 30) {
  await renderStill({ serveUrl, composition, inputProps, frame: f, imageFormat: "jpeg", jpegQuality: 70, scale: 0.2, browserExecutable, chromiumOptions: { gl: "angle" }, output: `${dir}/${String(f).padStart(5, "0")}.jpg` });
}
console.log(`${out}: ${(scene.frames / 30).toFixed(1)} s rendered`);
