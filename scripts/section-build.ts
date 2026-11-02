// Builds one section of a project as it is written (or the joined scene) with the engine as it is now, and prints its
// problems, for checking that engine changes let old sections build. Optional frames render full size.
// Usage: node --experimental-strip-types scripts/section-build.ts <projectDir> <sectionId|all> [<outDir> <seconds> ...]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "../engine/language/build.ts";
import { shotsToScene } from "../pipeline/lib/shots-scene.ts";
import { closeRenderer, joinSections, renderStills, sceneBuildOptions, splitSections } from "../pipeline/stages/scene.ts";
import type { Project } from "../schemas/project.ts";

const [folder, which, out, ...at] = process.argv.slice(2);
if (!folder || !which) throw new Error("usage: section-build.ts <projectDir> <sectionId|all> [<outDir> <seconds> ...]");
const p: Project = JSON.parse(readFileSync(join(folder, "project.json"), "utf8"));
const named: Record<string, string> = p.scene?.assets ?? (p.shots?.length ? shotsToScene(p).assets : {});
const assets = Object.fromEntries(Object.entries(named).map(([k, f]) => [k, out ? `data:image/${f.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(join(folder, f)).toString("base64")}` : f]));
const ranges = splitSections(p.narration!.words);
const sourceOf = (id: string) => readFileSync(join(folder, "scene", id, "scene.txt"), "utf8");
const source = process.env.SRC ? readFileSync(process.env.SRC, "utf8") : which === "all" ? joinSections(ranges.filter((r) => existsSync(join(folder, "scene", r.id, "scene.txt"))).map((r) => ({ id: r.id, firstWord: r.firstWord, source: sourceOf(r.id) }))) : sourceOf(which);
if (process.env.SAVE) writeFileSync(process.env.SAVE, source);
const r = await build(source, sceneBuildOptions(p, assets));
const lines = source.split("\n");
console.log(`${folder} ${which}: ${r.problems.length} problems`);
for (const x of r.problems) console.log(`  line ${x.line} (${lines[x.line - 1]?.trim().slice(0, 80) ?? ""}): ${x.message}`);
for (const x of r.notes ?? []) console.log(`  note: ${x}`);
if (out && r.scene && at.length) {
  const fps = 30;
  const files = await renderStills(r.scene, sceneBuildOptions(p).ctx.theme, at.map((s) => Math.round(Number(s) * fps)), resolve(out), 1);
  console.log(files.join("\n"));
  await closeRenderer();
}
