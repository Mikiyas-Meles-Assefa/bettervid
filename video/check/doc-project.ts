// Test helper, not pipeline code: copies a documentary project with shots and real images into PROJECTS_DIR and gives
// it a ScenePlan made by shotsToScene alone (no model calls), as one section, to test pictures and per-image credits.
// Usage: node --experimental-strip-types video/check/doc-project.ts <sourceProjectDir> <newId> <style>
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../../schemas/project.ts";
import { shotsToScene } from "../../pipeline/lib/shots-scene.ts";

const [from, id, style] = process.argv.slice(2);
if (!from || !id || !style) throw new Error("usage: doc-project.ts <sourceProjectDir> <newId> <style>");
const to = join(process.env.PROJECTS_DIR ?? "projects", id);
cpSync(from, to, { recursive: true, filter: (f) => !f.endsWith(".mp4") });
const p: Project = JSON.parse(readFileSync(join(from, "project.json"), "utf8"));
p.id = id;
p.input.style = style;
delete p.timeline;
delete p.render;
for (const s of ["timeline", "mix", "render", "critic"] as const) delete p.stages[s];
const { source, assets } = shotsToScene(p);
p.scene = { sections: [{ id: "s1", firstWord: 0, lastWord: p.narration!.words.length - 1, source, ok: true, rounds: 0, usd: 0 }], assets };
writeFileSync(join(to, "project.json"), JSON.stringify(p, null, 2));
console.log(`${to}: ${Object.keys(assets).length} pictures, style ${style}`);
