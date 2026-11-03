// Renders a scene written in the language, with no sound. Each style rebuilds it, so colors and fonts come from that style.
// Usage: node --experimental-strip-types engine/language/render.ts <sceneDir> <style> [<style> ...]
// With STILLS=n it writes n evenly spaced frames instead of a video, which is much faster for checking a scene.
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundled } from "../render/bundle.ts";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { CompileContext } from "../core/types.ts";
import { themeFrom } from "../render/theme.ts";
import { build, formatProblems } from "./build.ts";
import { loadLibrary } from "./library.ts";

const [dir, ...styles] = process.argv.slice(2);
const stills = Number(process.env.STILLS ?? 0);
const source = readFileSync(join(dir!, "scene.txt"), "utf8");
const request = JSON.parse(readFileSync(join(dir!, "request.json"), "utf8"));
const serveUrl = await bundled(resolve("engine/render/preview.tsx"));
for (const style of styles) {
  const theme = themeFrom(style);
  const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames: request.frames, theme, words: request.words };
  const r = await build(source, { ctx, library: process.env.LIBRARY === "off" ? [] : loadLibrary(), seed: 11, words: request.words.map((w: { text: string }) => w.text) });
  if (!r.scene) throw new Error(`does not build:\n${formatProblems(r.problems.slice(0, 6))}`);
  const inputProps = { scene: r.scene, theme };
  const composition = await selectComposition({ serveUrl, id: "Scene", inputProps });
  const t0 = Date.now();
  if (stills) {
    const folder = join(dir!, `${style}-stills`);
    mkdirSync(folder, { recursive: true });
    for (let i = 0; i < stills; i++) {
      const frame = Math.round(((i + 1) / (stills + 1)) * (r.scene.frames - 1));
      await renderStill({ serveUrl, composition, inputProps, frame, imageFormat: "jpeg", scale: 0.4, output: join(folder, `${String(frame).padStart(5, "0")}.jpg`) });
    }
  } else {
    await renderMedia({ serveUrl, composition, inputProps, codec: "h264", imageFormat: "jpeg", concurrency: 2, crf: 23, outputLocation: join(dir!, `${style}.mp4`) });
  }
  console.log(`${style}: ${(r.scene.frames / 30).toFixed(1)} s, ${r.scene.nodes.length} parts, ${r.scene.tracks.length} tracks, took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
