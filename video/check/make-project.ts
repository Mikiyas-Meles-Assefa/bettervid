// Test helper, not pipeline code: copies a real project (narration, words, sources) into PROJECTS_DIR under a new id and
// gives it a hand-built ScenePlan from a scene file written for that narration, so the timeline and render stages can
// run on the engine without any model calls.
// Usage: node --experimental-strip-types video/check/make-project.ts <sourceProjectDir> <sceneFile> <newId> <style> [--image NAME=assets/file.jpg@WORD]
// The scene is split into three sections so joining is tested too. With --image, the state starting at WORD also shows
// that image.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Project, SceneSection } from "../../schemas/project.ts";

const [from, sceneFile, id, style, ...rest] = process.argv.slice(2);
if (!from || !sceneFile || !id || !style) throw new Error("usage: make-project.ts <sourceProjectDir> <sceneFile> <newId> <style> [--image NAME=file@WORD]");
const root = process.env.PROJECTS_DIR ?? "projects";
const to = join(root, id);
mkdirSync(join(to, "assets"), { recursive: true });

const p: Project = JSON.parse(readFileSync(join(from, "project.json"), "utf8"));
p.id = id;
p.input.style = style;
delete p.timeline;
delete p.render;
for (const s of ["timeline", "mix", "render", "critic"] as const) delete p.stages[s];
for (const f of [p.narration!.audio, "grain.png"]) if (existsSync(join(from, f))) copyFileSync(join(from, f), join(to, f));

let source = readFileSync(sceneFile, "utf8");
const assets: Record<string, string> = {};
const imageArg = rest[rest.indexOf("--image") + 1];
if (rest.includes("--image") && imageArg) {
  const m = /^(\w+)=(.+)@(\d+)$/.exec(imageArg);
  if (!m) throw new Error("--image needs NAME=file@WORD");
  const [, name, file, word] = m as unknown as [string, string, string, string];
  mkdirSync(dirname(join(to, file)), { recursive: true });
  copyFileSync(join(from, file), join(to, file));
  assets[name] = file;
  // Added to the state that starts at that word.
  const lines = source.split("\n");
  const at = lines.findIndex((l) => new RegExp(`^@${word}\\b`).test(l));
  if (at < 0) throw new Error(`no state starts at word ${word}`);
  lines.splice(at + 1, 0, `image ${name} asset=${name} w=520 h=520`);
  source = lines.join("\n");
}

// Three sections, split at state lines near a third and two thirds of the way.
const lines = source.split("\n");
const stateLines = lines.flatMap((l, i) => (/^@\d+/.test(l) ? [i] : []));
const cuts = [0, stateLines[Math.floor(stateLines.length / 3)]!, stateLines[Math.floor((2 * stateLines.length) / 3)]!, lines.length];
const wordAt = (i: number) => Number(/^@(\d+)/.exec(lines[i]!)![1]);
const last = p.narration!.words.length - 1;
const sections: SceneSection[] = cuts.slice(0, -1).map((c, i) => ({
  id: `part${i + 1}`,
  firstWord: wordAt(c),
  lastWord: i + 2 < cuts.length ? wordAt(cuts[i + 1]!) - 1 : last,
  source: lines.slice(c, cuts[i + 1]).join("\n"),
  ok: true,
  rounds: 0,
  usd: 0,
}));
// Joined in word order, so hand them over shuffled to prove the timeline sorts them.
p.scene = { sections: [sections[2]!, sections[0]!, sections[1]!], assets };
writeFileSync(join(to, "project.json"), JSON.stringify(p, null, 2));
console.log(`${to}: ${sections.length} sections from ${basename(sceneFile)}, ${Object.keys(assets).length} assets, style ${style}`);
