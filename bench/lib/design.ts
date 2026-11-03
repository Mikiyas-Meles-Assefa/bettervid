// The bench's design steps: the design brain's whole run (engine/design/search/design.ts runDesign: the depicter and the
// director, the search with the designer and the viewer panel, the whole-video pass) on a case folder with an intent
// plan (intent/intent.txt from `bench intent-submit`, or intent.txt), project.json and, when the case has material,
// cards.json from `bench read`.
//   design <run> [case ...] [--no-sheets]   runs it; agent tasks wait in <case>/design/ask/ and are answered in
//                                            <case>/design/answer/. When the run is done, composed.scene.json (which
//                                            every later bench step scores as it is), design.json and decisions.json
//                                            are written to the case folder.
//   design-status <run> [case ...]           every task still waiting, by role, so they can be handed out in batches;
//                                            and how many tasks each role was asked per case.
// Rerun `design` after answering the waiting tasks; answered steps replay from their answers.
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { themeFrom } from "../../engine/render/theme.ts";
import { parseIntent } from "../../engine/design/intent/parse.ts";
import { fileReasoner } from "../../engine/design/reasoner.ts";
import { runDesign, type DesignInputs } from "../../engine/design/search/design.ts";
import { remotionStills } from "../../engine/design/search/sheet.ts";
import { suggestViewing, viewingFrom } from "../../engine/design/suggest.ts";
import type { Project } from "../../schemas/project.ts";
import { frameOf, loadCase, MATERIAL } from "./case.ts";
import { WORK, folderOf } from "./paths.ts";
import { loadCards } from "./read.ts";
import { settingsOf } from "./settings.ts";

type Step = (run: string, ids: string[], flags: Set<string>) => Promise<void>;
const FPS = 30;

/** The intent plan's file in a case folder: the intent author's (intent/intent.txt) or one put there by hand. */
export const intentFile = (folder: string) => [join(folder, "intent", "intent.txt"), join(folder, "intent.txt")].find(existsSync);

/** The direction plan as plain text for the director: each event's job, what the viewer knows and waits for, its look. */
export function directionOf(p: Project): string {
  const words = p.narration?.words ?? [];
  const quote = (n: number) => `word ${n} ("${words[n]?.text ?? ""}")`;
  return (p.direction?.events ?? [])
    .map((e) => {
      const out = [`- ${e.id}, ${quote(e.firstWord)} to ${quote(e.lastWord)}: ${e.job}`];
      if (e.knows) out.push(`  knows after it: ${e.knows}`);
      if (e.waiting) out.push(`  waiting for: ${e.waiting}`);
      if (e.look) out.push(`  look: ${e.look}`);
      if (e.feel || e.rhythm) out.push(`  feel: ${e.feel || "-"}; rhythm: ${e.rhythm ?? "-"}`);
      if (e.withhold) out.push(`  withhold ${e.withhold.what} until ${e.withhold.until}`);
      if (e.reveal) out.push(`  reveal at ${quote(e.reveal.word)}: ${e.reveal.what}`);
      for (const h of e.holds ?? []) out.push(`  hold ${h.id} after ${quote(h.afterWord)}, ${h.seconds} s, for ${h.purpose}: ${h.does}${h.shows ? ` (on screen: "${h.shows}")` : ""}`);
      if (e.demo) out.push(`  demonstration: ${e.demo.what}; ${e.demo.phases.map((ph) => `${ph.pace} from ${"word" in ph.at ? quote(ph.at.word) : `hold ${ph.at.hold}`} (${ph.why})`).join("; ")}`);
      return out.join("\n");
    })
    .join("\n");
}

/** A bench case as the design brain's inputs: the plan, the narration, the material, the brief and the viewing hint. */
export function caseInputs(run: string, id: string): { inputs: DesignInputs; dir: string } | { problem: string } {
  const folder = folderOf(run, id);
  const file = intentFile(folder);
  if (!file) return { problem: "no intent plan (intent/intent.txt from `bench intent-submit`, or intent.txt)" };
  if (!existsSync(join(folder, "project.json"))) return { problem: "no project.json (`bench prepare` writes it)" };
  const p: Project = JSON.parse(readFileSync(join(folder, "project.json"), "utf8"));
  const c = loadCase(id);
  if (c.material?.length && !loadCards(run, id)) return { problem: "the case has material but no cards.json (`bench read` writes it)" };
  const k = loadCards(run, id) ?? { cards: [], requirements: [] };
  const words = p.narration!.words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
  const purposes = new Map((p.direction?.events ?? []).flatMap((e) => e.holds ?? []).map((h) => [h.id, h.purpose]));
  const holds = (p.narration!.holds ?? []).map((h) => ({ id: h.id, afterWord: h.afterWord, seconds: h.seconds, ...(purposes.get(h.id) ? { purpose: purposes.get(h.id) } : {}) }));
  // The user's pictures as data URLs, by the card that reads each.
  const assets: Record<string, string> = {};
  for (const m of c.material ?? []) if (m.kind === "image" && m.file) assets[m.name] = `data:image/${m.file.toLowerCase().endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(join(MATERIAL, m.file)).toString("base64")}`;
  const ctx = settingsOf(c).context;
  const [width, height] = frameOf(c);
  const brief = [
    `The user asked: ${c.request}`,
    `Topic: ${c.topic}`,
    `Intent: ${c.intent}`,
    ...(c.asked?.length ? [`Asked for on purpose: ${c.asked.join("; ")}`] : []),
    `Goal: ${c.goal}`,
    `Promise: ${c.promise}`,
    `Arc: ${c.arc}`,
    `Where it is watched: ${ctx.screen}, ${ctx.frame} frame, seen from ${ctx.distance}, ${ctx.attention} (${ctx.why})`,
    `Style: ${c.style}`,
  ].join("\n");
  // The viewing as the case says it: its screen, distance and attention, and the sizes in millimetres suggested from
  // them (suggest.ts suggestViewing), each with its reason; the director confirms or replaces them.
  const sized = suggestViewing({ screen: ctx.screen, distance: ctx.distance, watch: ctx.attention, frame: ctx.frame, why: ctx.why, request: c.request }, width, height);
  const viewing = viewingFrom({
    width,
    height,
    fps: FPS,
    screen: sized.screen,
    frameWidthMm: sized.frameWidthMm,
    distanceMm: sized.distanceMm,
    watch: sized.watch,
    captions: { show: true, box: [0, 1640 / 1920, 1, 1810 / 1920], why: "the bench burns the narration in as captions in this band" },
    why: `the case's own words (${ctx.screen}, seen from ${ctx.distance}; ${ctx.why}): ${sized.why}`,
  });
  const inputs: DesignInputs = { plan: parseIntent(readFileSync(file, "utf8")), words, holds, frames: Math.ceil(p.narration!.seconds * FPS), cards: k.cards, requirements: k.requirements, assets, brief, direction: directionOf(p) || undefined, theme: themeFrom(c.style), styleName: c.style, viewing };
  return { inputs, dir: join(folder, "design") };
}

export const design: Step = async (run, ids, flags) => {
  for (const id of ids) {
    const got = caseInputs(run, id);
    if ("problem" in got) {
      console.log(`${id}: ${got.problem}`);
      continue;
    }
    const { inputs, dir } = got;
    const sheets = !flags.has("--no-sheets");
    try {
      const r = await runDesign(dir, inputs, fileReasoner(dir), undefined, {
        ...(sheets ? { stills: remotionStills({ theme: inputs.theme, scale: Number(process.env.SHEET_SCALE ?? 0.15), bundleDir: process.env.BUNDLE_DIR }), sheet: { finalists: 3, frames: 3, cell: 150 } } : {}),
      });
      if (r.status === "pending") {
        console.log(`${id}: waiting on ${r.waiting.length} task${r.waiting.length > 1 ? "s" : ""} (${roles(r.waiting)}); \`bench design-status ${run}\` lists them`);
        continue;
      }
      const folder = folderOf(run, id);
      for (const f of ["composed.scene.json", "design.json", "decisions.json"]) copyFileSync(join(dir, f), join(folder, f));
      console.log(`${id}: done; composed.scene.json written. ${r.report.split("\n")[0]}`);
      for (const n of r.notes.slice(0, 6)) console.log(`  ${n.slice(0, 220)}`);
    } catch (e) {
      console.log(`${id}: FAILED: ${(e as Error).message}`);
    }
  }
};

/** A task file's role, from its first line ("# Task <id> (<role>)"). */
const roleOf = (file: string) => (existsSync(file) ? /\(([a-z]+)\)\s*$/.exec(readFileSync(file, "utf8").split("\n", 1)[0]!)?.[1] : undefined) ?? "unknown";
const answerOf = (ask: string) => ask.replace(/\/ask\/([^/]+)\.md$/, "/answer/$1.json");
function roles(files: string[]): string {
  const n = new Map<string, number>();
  for (const f of files) n.set(roleOf(f), (n.get(roleOf(f)) ?? 0) + 1);
  return [...n].map(([r, k]) => `${k} ${r}`).join(", ");
}

export const designStatus: Step = async (run, ids) => {
  const listed = ids.filter((id) => existsSync(join(folderOf(run, id), "design")));
  const all = listed.length ? listed : existsSync(join(WORK, run)) ? readdirSync(join(WORK, run)).filter((id) => existsSync(join(folderOf(run, id), "design"))) : [];
  const byRole = new Map<string, string[]>();
  for (const id of all) {
    const dir = join(folderOf(run, id), "design");
    const waiting: string[] = existsSync(join(dir, "waiting.json")) ? JSON.parse(readFileSync(join(dir, "waiting.json"), "utf8")) : [];
    const open = waiting.filter((f) => !existsSync(answerOf(f)));
    for (const f of open) byRole.set(roleOf(f), [...(byRole.get(roleOf(f)) ?? []), `${f} -> ${answerOf(f)}`]);
    const asked = existsSync(join(dir, "ask")) ? readdirSync(join(dir, "ask")).filter((f) => f.endsWith(".md")).map((f) => join(dir, "ask", f)) : [];
    const done = existsSync(join(dir, "composed.scene.json")) && !waiting.length;
    console.log(`${id}: ${done ? "done" : open.length ? `${open.length} waiting` : waiting.length ? "answered, run `bench design` again" : "not run"}; tasks asked: ${roles(asked) || "none"}`);
  }
  for (const [role, files] of byRole) console.log(`\n${role} (${files.length}):\n${files.join("\n")}`);
};

// bench/run.ts looks steps up by command name.
export { designStatus as "design-status" };
