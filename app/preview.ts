// Style previews: one small scene, written in the scene language and drawn by the engine, rendered in any style. The
// picker shows a still and a short loop of it, so every style is judged on the same picture.
// Usage: node --experimental-strip-types app/preview.ts [<style> ...]   (all top-level and custom styles by default)
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { CompileContext } from "../engine/core/types.ts";
import { build, formatProblems } from "../engine/language/build.ts";
import { themeFrom } from "../engine/render/theme.ts";

// Invented narration, about 2.6 words a second. Neutral on purpose: it is only there to time the scene.
const SCRIPT = "Every idea starts small. One part feeds the next, and then the next. Watch what matters light up. That is the whole trick.";
const SCENE = `@0
text title "Every idea starts small" size=big font=title
@4 keep enter=pop
row parts gap=50
  circle a "seed" fill=highlight
  box b "sprout" fill=accent
  diamond c "tree" fill=paper stroke=ink
@6 keep
arrow a -> b color=ink
@10 keep
arrow b -> c color=ink
tag c "grows" side=right
@13 keep
focus b
mark ring b
graph g: A-B:4 A-C:2 B-C:1 C-D:3
@16 keep
light g.edge.AC g.edge.CD g.node.D color=accent
big: n1=2 times=× n2=3 eq== n3=6
@19 keep
light n3 g.edge.AC g.edge.CD g.node.D color=accent
mark underline n3
do pulse n3`;

const fps = 30;
let t = 0.3;
const WORDS = SCRIPT.split(/\s+/).map((text) => {
  const w = { text, start: Math.round(t * 100) / 100 };
  t += 0.26 + text.length * 0.02 + (/[.?!]$/.test(text) ? 0.4 : /[,:;]$/.test(text) ? 0.15 : 0);
  return w;
});
export const PREVIEW_FRAMES = Math.ceil((t + 1.4) * fps);
export const STILL_FRAME = PREVIEW_FRAMES - 20; // everything is on screen and lit
export const PREVIEWS = resolve("styles/previews");

let served: Promise<string> | undefined;
const serveUrl = () => (served ??= bundle({ entryPoint: resolve("engine/render/preview.tsx") }));
const chrome = { gl: "angle" as const };
const browserExecutable = process.env.BETTERVID_CHROME || null;

// Styles the picker offers: the files in styles/, then the ones people made in styles/custom/.
export function allStyles(): string[] {
  const json = (folder: string) => (existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() : []);
  return [...json("styles"), ...json("styles/custom").map((n) => `custom/${n}`)];
}

async function composition(style: string) {
  const theme = themeFrom(style);
  const ctx: CompileContext = { fps, width: 1080, height: 1920, frames: PREVIEW_FRAMES, theme, words: WORDS };
  const r = await build(SCENE, { ctx, seed: 7, words: WORDS.map((w) => w.text) });
  if (!r.scene) throw new Error(`the preview scene does not build in ${style}:\n${formatProblems(r.problems.slice(0, 6))}`);
  const inputProps = { scene: r.scene, theme };
  const url = await serveUrl();
  return { url, inputProps, comp: await selectComposition({ serveUrl: url, id: "Scene", inputProps, chromiumOptions: chrome, browserExecutable }) };
}

// One still of the finished scene, small enough for the page and for a model to look at.
export async function previewStill(style: string, output: string, frame = STILL_FRAME, scale = 0.5): Promise<string> {
  const { url, inputProps, comp } = await composition(style);
  mkdirSync(dirname(output), { recursive: true });
  await renderStill({ serveUrl: url, composition: comp, inputProps, frame, imageFormat: "jpeg", jpegQuality: 86, scale, output, chromiumOptions: chrome, browserExecutable });
  return output;
}

// The picker's assets for a style: <name>.jpg and a silent <name>.webm loop, under styles/previews/.
export async function preview(style: string): Promise<{ still: string; loop: string }> {
  const still = join(PREVIEWS, `${style}.jpg`);
  const loop = join(PREVIEWS, `${style}.webm`);
  await previewStill(style, still, STILL_FRAME, 0.4);
  const { url, inputProps, comp } = await composition(style);
  await renderMedia({ serveUrl: url, composition: comp, inputProps, codec: "vp9", crf: 36, scale: 0.4, concurrency: 4, muted: true, outputLocation: loop, chromiumOptions: chrome, browserExecutable });
  return { still, loop };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const list = process.argv.slice(2);
  for (const style of list.length ? list : allStyles()) {
    const t0 = Date.now();
    await preview(style);
    console.log(`${style}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}
