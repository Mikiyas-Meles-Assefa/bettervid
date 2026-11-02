// Proof of the style system: the one Dijkstra scene, unchanged, rendered in every style file. Silent, with no model.
// Usage: node --experimental-strip-types engine/proof/styles.ts <outDir> [--stills <frame,frame>] [<style> ...]
// With --stills it renders only those frames as PNGs, which is enough to judge a look.
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { compile } from "../core/compile.ts";
import type { Step, Theme } from "../core/types.ts";
import { graphKit } from "../kits/graph.ts";
import { styleNames, themeFrom } from "../render/theme.ts";
import { scene } from "./dijkstra.ts";

// Until compile reads theme.enter, a step with no entrance of its own takes the style's.
const entering = (steps: Step[], theme: Theme): Step[] => steps.map((s) => (s.add && !s.enter ? { ...s, enter: theme.enter } : s));

// Until `evaluate` stops easing whole strings, a spring passing 1 and back would flash old text over new.
const steadyText = (steps: Step[]): Step[] => steps.map((s) => (Object.values(s.set ?? {}).some((p) => "text" in p) ? { ...s, move: { ...s.move, ease: "out" as const } } : s));

const args = process.argv.slice(2);
const out = args.shift()!;
const stillsAt = args[0] === "--stills" ? (args.shift(), args.shift()!.split(",").map(Number)) : undefined;
const styles = args.length ? args : styleNames();
const { steps, frames } = scene();
const serveUrl = await bundle({ entryPoint: resolve("engine/proof/styles-preview.tsx") });

for (const name of styles) {
  const theme = themeFrom(name);
  const built = compile({ steps: steadyText(entering(steps, theme)) }, { fps: 30, width: 1080, height: 1920, frames, theme, kits: [graphKit] });
  const inputProps = { scene: built, theme };
  const composition = await selectComposition({ serveUrl, id: "Scene", inputProps });
  const t0 = Date.now();
  if (stillsAt) {
    for (const frame of stillsAt) await renderStill({ serveUrl, composition, inputProps, frame, imageFormat: "png", output: join(out, `${name}-${frame}.png`) });
  } else {
    await renderMedia({ serveUrl, composition, inputProps, codec: "h264", imageFormat: "jpeg", concurrency: 2, crf: 20, outputLocation: join(out, `${name}.mp4`) });
  }
  console.log(`${name}: ${frames} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
