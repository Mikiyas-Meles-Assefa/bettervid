// Test helper: render speed of a project's timeline over a frame range, with no audio or encoding quality concerns.
// Usage: node --experimental-strip-types video/check/speed.ts <projectDir> <firstFrame> <lastFrame> [concurrency]
// Prints frames per second for the whole call (including browser start) and for frames alone.
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { playerProps } from "../../pipeline/stages/render.ts";

const [folder, a, b, conc] = process.argv.slice(2);
if (!folder || !a || !b) throw new Error("usage: speed.ts <projectDir> <first> <last> [concurrency]");
const p = JSON.parse(readFileSync(join(folder, "project.json"), "utf8"));
const serveUrl = await bundle({ entryPoint: resolve("video/index.ts"), publicDir: resolve(folder) });
// INLINE=1 keeps engine scenes in the props, to compare with the scene file the pipeline uses.
const inputProps = process.env.INLINE ? { timeline: p.timeline } : playerProps(p);
const browserExecutable = process.env.BETTERVID_CHROME || null;
const t0 = Date.now();
const composition = await selectComposition({ serveUrl, id: "Bettervid", inputProps, browserExecutable });
const t1 = Date.now();
let first = 0;
const out = join(folder, "speed.mp4");
await renderMedia({
  serveUrl, composition, inputProps, browserExecutable, codec: "h264", crf: 23, imageFormat: "jpeg", concurrency: Number(conc ?? 4), muted: true,
  frameRange: [Number(a), Number(b)], outputLocation: out,
  onProgress: ({ renderedFrames }) => {
    if (renderedFrames > 0 && !first) first = Date.now();
  },
});
const t2 = Date.now();
rmSync(out, { force: true });
const n = Number(b) - Number(a) + 1;
const kb = (JSON.stringify(inputProps).length / 1024).toFixed(0);
console.log(`${folder}: ${n} frames, props ${kb} KB, select ${t1 - t0} ms, first frame after ${first - t1} ms, ${(n / ((t2 - t1) / 1000)).toFixed(1)} frames/s overall, ${(n / ((t2 - first) / 1000)).toFixed(1)} frames/s after the first`);
