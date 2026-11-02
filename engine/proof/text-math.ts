// Proof of text, math and layout: silent, built by hand, and spread over unrelated subjects. Letters arrive one by one,
// sentences and equations rearrange with each part keeping its identity, matrix rows and columns act as sets, and a
// layout makes room when something joins it. Nothing here shows a box: only the parts themselves are drawn.
// Usage: node --experimental-strip-types engine/proof/text-math.ts <outDir> <style> [<style> ...]
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { compile } from "../core/compile.ts";
import type { CompileContext, Step, Theme } from "../core/types.ts";
import { graphKit } from "../kits/graph.ts";
import { mathKit, mathSet } from "../kits/math.ts";
import { textKit, textSet } from "../kits/text.ts";
import { layoutKit } from "../layout/kit.ts";
import { themeFrom } from "../render/theme.ts";

function story(): { steps: Step[]; frames: number } {
  const steps: Step[] = [];
  let t = 10;

  // Language: a sentence keeps its words, and only their places change the meaning.
  steps.push({ at: t, enter: "none", add: [{ id: "lang", kind: "layout", data: { gap: 90, items: [
    { id: "lang.title", kind: "words", data: { text: "Word order carries meaning", size: 64, role: "title", color: "accent", width: 860 } },
    { id: "lang.line", kind: "words", data: { states: ["the dog chased the cat", "the cat chased the dog"], size: 96, width: 900 } },
  ] } }] });
  steps.push({ at: t, play: [{ behavior: "reveal", target: "lang.title", args: { stagger: 1, frames: 10, rise: 26 } }, { behavior: "reveal", target: "lang.line", args: { stagger: 2, frames: 10, rise: 20 } }] });
  steps.push({ at: (t += 80), play: [{ behavior: "become", target: "lang.line", args: { state: 1, frames: 36 } }] });
  steps.push({ at: (t += 56), play: [{ behavior: "each", target: "lang.line", args: { part: textSet.word(1), color: "accent" } }] });
  steps.push({ at: (t += 40), remove: ["lang"] });
  t += 18;

  // Physics: one law solved for another letter. Symbols cross the equals sign, which stays put.
  steps.push({ at: t, add: [{ id: "phys", kind: "layout", data: { gap: 110, items: [
    { id: "phys.title", kind: "words", data: { text: "Newton's second law", size: 70, role: "title" } },
    { id: "phys.eq", kind: "math", data: { states: ["F=ma", String.raw`\frac{F}{m}=a`, String.raw`a=\frac{F}{m}`], size: 190, keep: "=" } },
  ] } }] });
  steps.push({ at: (t += 45), play: [{ behavior: "become", target: "phys.eq", args: { state: 1, frames: 34 } }] });
  steps.push({ at: (t += 52), play: [{ behavior: "become", target: "phys.eq", args: { state: 2, frames: 34 } }] });
  steps.push({ at: (t += 52), play: [{ behavior: "swell", target: "phys.eq", args: { part: mathSet.char("a"), size: 1.3, frames: 24 } }] });
  steps.push({ at: (t += 34), remove: ["phys"] });
  t += 18;

  // Algebra: a value moves, a sign flips by leaving and arriving, and an answer appears.
  steps.push({ at: t, add: [{ id: "alg.page", kind: "layout", data: { items: [{ id: "alg", kind: "math", data: { states: ["x+2=5", "x=5-2", "x=3"], size: 170, keep: "=" } }] } }] });
  steps.push({ at: (t += 40), play: [{ behavior: "become", target: "alg", args: { state: 1, frames: 34 } }] });
  steps.push({ at: (t += 56), play: [{ behavior: "become", target: "alg", args: { state: 2, frames: 30 } }] });
  steps.push({ at: (t += 50), remove: ["alg.page"] });
  t += 18;

  // Linear algebra: a row and a column act together, though no symbol belongs to one group, and rows can trade places.
  steps.push({ at: t, add: [{ id: "mat", kind: "layout", data: { gap: 100, items: [
    { id: "mat.title", kind: "words", data: { text: "Rows and columns", size: 70, role: "title" } },
    { id: "mat.m", kind: "math", data: { states: [String.raw`\begin{bmatrix}2&7&1\\0&3&5\\4&8&6\end{bmatrix}`, String.raw`\begin{bmatrix}4&8&6\\0&3&5\\2&7&1\end{bmatrix}`], size: 150 } },
  ] } }] });
  steps.push({ at: (t += 36), play: [{ behavior: "each", target: "mat.m", args: { part: mathSet.col(1), color: "accent", stagger: 5 } }] });
  steps.push({ at: (t += 36), play: [{ behavior: "each", target: "mat.m", args: { part: mathSet.col(1), color: "ink" } }, { behavior: "each", target: "mat.m", args: { part: mathSet.row(0), color: "accent" } }] });
  steps.push({ at: (t += 36), play: [{ behavior: "each", target: "mat.m", args: { part: mathSet.row(0), color: "ink" } }, { behavior: "become", target: "mat.m", args: { state: 1, frames: 40 } }] });
  steps.push({ at: (t += 64), remove: ["mat"] });
  t += 18;

  // Layout: mixed kinds of thing, placed relative to one another, then making room for one more.
  const page = {
    id: "bio",
    kind: "layout",
    data: {
      gap: 90,
      states: [["bio.title", "bio.eq", "bio.net"], ["bio.title", "bio.eq", "bio.net", "bio.note"]],
      items: [
        { id: "bio.title", kind: "words", data: { text: "Photosynthesis", size: 96, role: "title", color: "accent" } },
        { id: "bio.eq", kind: "math", data: { latex: String.raw`6\,\text{CO}_2+6\,\text{H}_2\text{O}\;\xrightarrow{\text{light}}\;\text{C}_6\text{H}_{12}\text{O}_6+6\,\text{O}_2`, size: 90 } },
        { id: "bio.net", kind: "graph", data: { radius: 74, nodes: [{ id: "a", x: 0, y: 0, label: "Sun" }, { id: "b", x: 380, y: 0, label: "Leaf" }, { id: "c", x: 760, y: 0, label: "Air" }], edges: [{ id: "ab", from: "a", to: "b" }, { id: "bc", from: "b", to: "c" }] } },
        { id: "bio.note", kind: "words", data: { text: "Plants store the energy of sunlight in sugar, and release oxygen on the way.", size: 58, width: 820 } },
      ],
    },
  };
  steps.push({ at: t, add: [page] });
  steps.push({ at: (t += 60), play: [{ behavior: "become", target: "bio", args: { state: 1, frames: 34 } }] });
  t += 100;
  return { steps, frames: t };
}

export function buildProof(theme: Theme) {
  const { steps, frames } = story();
  const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames, theme, kits: [layoutKit, textKit, mathKit, graphKit] };
  return compile({ steps }, ctx);
}

if (process.argv[1]?.endsWith("text-math.ts")) {
  const [out, ...styles] = process.argv.slice(2);
  const serveUrl = await bundle({ entryPoint: resolve("engine/render/preview.tsx") });
  for (const name of styles) {
    const theme = themeFrom(name);
    const scene = buildProof(theme);
    const inputProps = { scene, theme };
    const composition = await selectComposition({ serveUrl, id: "Scene", inputProps });
    const t0 = Date.now();
    await renderMedia({ serveUrl, composition, inputProps, codec: "h264", imageFormat: "jpeg", concurrency: 2, crf: 23, outputLocation: join(out!, `${name}.mp4`) });
    console.log(`${name}: ${(scene.frames / 30).toFixed(1)} s, ${scene.nodes.length} parts, ${scene.tracks.length} tracks, rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}
