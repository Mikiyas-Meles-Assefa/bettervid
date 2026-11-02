// Test helper: renders a few frames of a project's timeline as JPEGs, to check the look without a full render.
// Usage: node --experimental-strip-types video/check/stills.ts <projectDir> <frame> [<frame> ...]
// Frames may be given as seconds with an "s" suffix (e.g. 31s). Writes <projectDir>/stills/<frame>.jpg.
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { playerProps } from "../../pipeline/stages/render.ts";

const [folder, ...at] = process.argv.slice(2);
if (!folder || !at.length) throw new Error("usage: stills.ts <projectDir> <frame> [...]");
const p = JSON.parse(readFileSync(join(folder, "project.json"), "utf8"));
const inputProps = playerProps(p); // writes the scene file, so before bundling
const serveUrl = await bundle({ entryPoint: resolve("video/index.ts"), publicDir: resolve(folder) });
const browserExecutable = process.env.BETTERVID_CHROME || null;
const composition = await selectComposition({ serveUrl, id: "Bettervid", inputProps, browserExecutable });
mkdirSync(join(folder, "stills"), { recursive: true });
for (const a of at) {
  const frame = a.endsWith("s") ? Math.round(Number(a.slice(0, -1)) * p.timeline.fps) : Number(a);
  const t0 = Date.now();
  await renderStill({ serveUrl, composition, inputProps, frame, imageFormat: "jpeg", scale: 0.5, browserExecutable, output: join(folder, "stills", `${String(frame).padStart(5, "0")}.jpg`) });
  console.log(`frame ${frame}: ${Date.now() - t0} ms`);
}
