// Test helper: how long the engine takes to work out one frame of a project's scene, outside the browser.
// Usage: node --experimental-strip-types video/check/evaluate-cost.ts <projectDir> [<projectDir> ...]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate } from "../../engine/core/evaluate.ts";
import type { Scene, Theme } from "../../engine/core/types.ts";
import { themed } from "../../engine/render/effects.ts";

for (const folder of process.argv.slice(2)) {
  const p = JSON.parse(readFileSync(join(folder, "project.json"), "utf8"));
  const clip = p.timeline.clips.find((c: { type: string }) => c.type === "engine");
  const scene = themed(clip.scene as Scene, clip.theme as Theme);
  for (let f = 0; f < 600; f++) evaluate(scene, f); // warm up
  const t0 = performance.now();
  let live = 0;
  for (let f = 0; f < 600; f++) live += evaluate(scene, f).length;
  const ms = (performance.now() - t0) / 600;
  // Parts that reach the page: visible, or holding an image (those stay mounted while hidden).
  let shown = 0;
  type R = ReturnType<typeof evaluate>[number];
  const walk = (r: R, on: boolean) => {
    const v = on && Number(r.props.opacity ?? 1) > 0;
    if (v) shown++;
    r.children.forEach((k) => walk(k, v));
  };
  for (let f = 0; f < 600; f += 10) evaluate(scene, f).forEach((r) => walk(r, true));
  console.log(`${folder}: ${scene.nodes.length} parts, ${scene.tracks.length} tracks, ${ms.toFixed(2)} ms a frame, ${(live / 600).toFixed(0)} roots and ${(shown / 60).toFixed(0)} visible parts a frame over frames 0 to 599`);
}
