// Builds a project's scene with the engine as it is now and renders full-size frames, for before and after checks of
// drawing changes. Prints build problems instead of failing, so an old scene that no longer builds is shown, not hidden.
// Usage: node --experimental-strip-types scripts/scene-frames.ts <projectDir> <outDir> <seconds> [<seconds> ...]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "../engine/language/build.ts";
import { closeRenderer, joinScene, renderStills, sceneBuildOptions } from "../pipeline/stages/scene.ts";
import type { Project } from "../schemas/project.ts";

const [folder, out, ...at] = process.argv.slice(2);
if (!folder || !out || !at.length) throw new Error("usage: scene-frames.ts <projectDir> <outDir> <seconds> [...]");
const p: Project = JSON.parse(readFileSync(join(folder, "project.json"), "utf8"));
const plan = p.scene!;
const source = process.env.SCENE_FILE ? readFileSync(process.env.SCENE_FILE, "utf8") : joinScene(plan);
// Pictures load as file URLs from the project folder.
const assets = Object.fromEntries(Object.entries(plan.assets).map(([k, f]) => [k, `data:image/${f.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(join(folder, f)).toString("base64")}`]));
const opts = sceneBuildOptions(p, assets);
const r = await build(source, opts);
mkdirSync(out, { recursive: true });
const lines = source.split("\n");
const report = r.problems.map((x) => `line ${x.line} (${lines[x.line - 1]?.trim().slice(0, 90) ?? ""}): ${x.message}`).join("\n");
writeFileSync(join(out, "problems.txt"), report || "none\n");
writeFileSync(join(out, "scene.txt"), source);
console.log(`${p.input.style}: ${r.problems.length} problems`);
if (report) console.log(report);
if (r.scene && at[0] !== "none") {
  const frames = at.map((s) => Math.round(Number(s) * opts.ctx.fps));
  const files = await renderStills(r.scene, opts.ctx.theme, frames, resolve(out), 1);
  console.log(files.join("\n"));
}
await closeRenderer();
