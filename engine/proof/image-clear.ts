// Proof that styling never eats the subject: a picture is placed in a scene with drawn shapes around it, rendered in
// every style, and the pixels are compared with the source. Any overlay, filter or tint would show up as a difference.
// Usage: node --experimental-strip-types engine/proof/image-clear.ts <outDir> [<style> ...]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundled } from "../render/bundle.ts";
import { renderStill, selectComposition } from "@remotion/renderer";
import { compile } from "../core/compile.ts";
import { circle } from "../kits/shapes.ts";
import { styleNames, themeFrom } from "../render/theme.ts";

const SIZE = 600;
const [out, ...named] = process.argv.slice(2);
const picture = join(out!, "picture.png");
const ffmpeg = (...a: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a], { maxBuffer: 1 << 28 });
const raw = (file: string, crop: string) => ffmpeg("-i", file, "-vf", crop, "-f", "rawvideo", "-pix_fmt", "rgb24", "-");

ffmpeg("-f", "lavfi", "-i", `testsrc2=size=${SIZE}x${SIZE}:rate=1`, "-frames:v", "1", picture);
const source = raw(picture, "null");
const src = `data:image/png;base64,${readFileSync(picture).toString("base64")}`;
const [x, y] = [540, 960];
const serveUrl = await bundled(resolve("engine/proof/styles-preview.tsx"));
let worst = 0;
for (const name of named.length ? named : styleNames()) {
  const theme = themeFrom(name);
  const scene = compile({ steps: [{ at: 0, enter: "none", add: [
    { id: "behind", kind: "path", props: { x, y: y - 480, points: circle(0, 0, 90), closed: 1, stroke: "ink", strokeWidth: 8, fill: "accent" } },
    { id: "photo", kind: "image", props: { src, x, y, w: SIZE, h: SIZE } },
    { id: "label", kind: "text", props: { x, y: y + 430, text: "A photo stays a photo", size: 64, color: "ink" } },
  ] }] }, { fps: 30, width: 1080, height: 1920, frames: 2, theme });
  const inputProps = { scene, theme };
  const composition = await selectComposition({ serveUrl, id: "Scene", inputProps });
  const output = join(out!, `image-${name}.png`);
  await renderStill({ serveUrl, composition, inputProps, frame: 0, imageFormat: "png", output });
  const got = raw(output, `crop=${SIZE}:${SIZE}:${x - SIZE / 2}:${y - SIZE / 2}`);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < source.length; i++) {
    const d = Math.abs(source[i]! - got[i]!);
    sum += d;
    max = Math.max(max, d);
  }
  worst = Math.max(worst, max);
  console.log(`${name}: mean difference ${(sum / source.length).toFixed(3)}, largest ${max}`);
}
if (worst > 3) throw new Error(`a style changed the picture: largest pixel difference ${worst}`);
console.log("every style left the picture alone");
