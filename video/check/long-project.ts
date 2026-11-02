// Test helper: a long engine project with no model calls. Several scene files, each written for its own narration, are
// joined one after another (word numbers and times shifted), one section each, until the story passes a target length.
// The audio, sources and script come from a real project; the audio is shorter than the story, which is fine for
// measuring size and speed. Usage:
// node --experimental-strip-types video/check/long-project.ts <sourceProjectDir> <newId> <style> <seconds> <sceneDir> [<sceneDir> ...]
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project, SceneSection, Word } from "../../schemas/project.ts";

const [from, id, style, seconds, ...scenes] = process.argv.slice(2);
if (!from || !id || !style || !seconds || !scenes.length) throw new Error("usage: long-project.ts <sourceProjectDir> <newId> <style> <seconds> <sceneDir> [...]");
const to = join(process.env.PROJECTS_DIR ?? "projects", id);
mkdirSync(to, { recursive: true });
const p: Project = JSON.parse(readFileSync(join(from, "project.json"), "utf8"));
p.id = id;
p.input.style = style;
delete p.timeline;
delete p.render;
for (const s of ["timeline", "mix", "render", "critic"] as const) delete p.stages[s];
for (const f of [p.narration!.audio, "grain.png"]) copyFileSync(join(from, f), join(to, f));

const words: Word[] = [];
const sections: SceneSection[] = [];
let time = 0;
for (let i = 0; time < Number(seconds); i++) {
  const folder = scenes[i % scenes.length]!;
  const request = JSON.parse(readFileSync(join(folder, "request.json"), "utf8")) as { words: { text: string; start: number }[]; frames: number };
  const offset = words.length;
  const source = readFileSync(join(folder, "scene.txt"), "utf8").replace(/@(\d+)/g, (_, n) => `@${Number(n) + offset}`);
  request.words.forEach((w, k) => words.push({ text: w.text, start: time + w.start, end: time + (request.words[k + 1]?.start ?? w.start + 0.4), beatId: "b" }));
  sections.push({ id: `s${i + 1}`, firstWord: offset, lastWord: words.length - 1, source, ok: true, rounds: 0, usd: 0 });
  time += request.frames / 30;
}
p.narration = { ...p.narration!, words, seconds: time };
p.scene = { sections, assets: {} };
writeFileSync(join(to, "project.json"), JSON.stringify(p, null, 2));
console.log(`${to}: ${sections.length} sections, ${words.length} words, ${time.toFixed(0)} s`);
