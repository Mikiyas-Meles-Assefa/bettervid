// Proof of the truth kits: one silent scene per kind, written in the scene language as Spark would write it, built with
// the pipeline's kit list and rendered in any styles. Nothing here is computed by hand.
// Usage: node --experimental-strip-types engine/truth/proof.ts <outDir> <style> [<style> ...]
// ONLY=sort,trace limits the scenes. STILLS=n writes n frames per scene instead of a video.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundled } from "../render/bundle.ts";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { CompileContext } from "../core/types.ts";
import { KITS } from "../kits/index.ts";
import { build, formatProblems } from "../language/build.ts";
import { themeFrom } from "../render/theme.ts";

// Words every 0.4 s stand in for a voice, so `@N` means 0.4 N seconds.
const WORDS = 60;
const SCENES: Record<string, string> = {
  matrix: `@0
text title "Row reduce to solve" size=big font=title
matrix m data=[[2,1,-1,8],[-3,-1,2,-11],[-2,1,2,-3]] solve=rref aug=1
@3 keep
do steps m until=@52
@55 keep
mark box m.cell.1.4,m.cell.3.4
`,
  det: `@0
text title "Sarrus, product by product" size=big font=title
det d data=[[2,-3,1],[2,0,-1],[1,4,5]] method=sarrus
@3 keep
do steps d at=@4,@10,@15,@20,@25,@30,@35,@42
`,
  cramer: `@0
text title "Cramer's rule" size=big font=title
cramer c a=[[2,1],[1,3]] b=[3,5]
@2 keep
do steps c until=@54
`,
  matvec: `@0
text title "Matrix times vector" size=big font=title
matvec p m=[[1,2,0],[3,-1,4]] v=[5,6,-2]
@4 keep
do steps p at=@6,@24
@40 keep
mark ring p.out.cell.2.1
`,
  sort: `@0
text title "Quicksort, for real" size=big font=title
sort s data=[6,3,9,1,7,2,8,4] algo=quick
@2 keep
do steps s until=@56
`,
  merge: `@0
text title "Merge sort" size=big font=title
sort s data=[6,3,9,1,7,2] algo=merge show=boxes
@2 keep
do steps s until=@56
`,
  trace: `@0
trace t code=["function sum(xs) {","  let total = 0","  for (const n of xs) {","    total += n","  }","  return total","}","console.log(sum([3, 5, 2]))"] h=1500
@2 keep
do steps t until=@57
`,
  dijkstra: `@0
text title "Shortest path from A to F" size=big font=title
dijkstra g edges=A-B:4,A-C:2,B-C:1,B-D:5,C-E:8,C-F:10,D-E:2,E-F:3 from=A to=F
@2 keep
do steps g until=@56
`,
};

const [out = "projects/truth-proof", ...styles] = process.argv.slice(2);
const only = process.env.ONLY?.split(",");
const stills = Number(process.env.STILLS ?? 0);
const words = Array.from({ length: WORDS }, (_, i) => ({ start: 0.2 + i * 0.4 }));
const frames = Math.ceil((words.at(-1)!.start + 1.5) * 30);
const serveUrl = await bundled(resolve("engine/render/preview.tsx"));
const browserExecutable = process.env.BETTERVID_CHROME || undefined;
for (const [name, source] of Object.entries(SCENES)) {
  if (only && !only.includes(name)) continue;
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "scene.txt"), source);
  for (const style of styles) {
    const theme = themeFrom(style);
    const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames, theme, words, kits: KITS };
    const r = await build(source, { ctx, seed: 11 });
    if (!r.scene) throw new Error(`${name} does not build:\n${formatProblems(r.problems.slice(0, 6))}`);
    const inputProps = { scene: r.scene, theme };
    const composition = await selectComposition({ serveUrl, id: "Scene", inputProps, browserExecutable });
    const t0 = Date.now();
    if (stills) {
      const folder = join(dir, `${style}-stills`);
      mkdirSync(folder, { recursive: true });
      for (let i = 0; i < stills; i++) {
        const frame = Math.round(((i + 1) / (stills + 1)) * (r.scene.frames - 1));
        await renderStill({ serveUrl, composition, inputProps, frame, imageFormat: "jpeg", scale: 0.4, output: join(folder, `${String(frame).padStart(5, "0")}.jpg`), browserExecutable });
      }
    } else {
      await renderMedia({ serveUrl, composition, inputProps, codec: "h264", imageFormat: "jpeg", concurrency: 4, crf: 23, outputLocation: join(dir, `${style}.mp4`), browserExecutable, chromiumOptions: { gl: "angle" } });
    }
    console.log(`${name} ${style}: ${(r.scene.frames / 30).toFixed(1)} s, ${r.scene.nodes.length} parts, ${r.scene.tracks.length} tracks, took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}
