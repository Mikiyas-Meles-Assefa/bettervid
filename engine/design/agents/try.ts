// Development harness: the director and the designer on one bench case, through the file Reasoner (no model calls).
//   node --experimental-strip-types engine/design/agents/try.ts <dir> <case> <intent.txt> [moment ...]
// Each run writes the next task to <dir>/ask/<id>.md; an agent answers <dir>/answer/<id>.json; run again. An answer with
// problems from checkDirector or checkDesigner gets a repair task (<id>.r1 ...), never a silent drop. Once the director
// is applied, every moment (or the ones named) gets a designer task. The state is printed and kept in <dir>/state.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { caseProject, frameOf, loadCase } from "../../../bench/lib/case.ts";
import { themeFrom } from "../../render/theme.ts";
import { parseIntent } from "../intent/parse.ts";
import { readDoc } from "../material/index.ts";
import { fileReasoner } from "../reasoner.ts";
import { styleValues, suggestDesign, suggestViewing, viewingFrom } from "../suggest.ts";
import type { AgentTask, Design, PartCard, Reasoner } from "../types.ts";
import type { DesignerAnswer, DesignerInput, DirectorAnswer, DirectorInput } from "./api.ts";
import { instrumentInfo } from "./common.ts";
import { checkDesigner, designerTask } from "./designer.ts";
import { applyCorrections, applyDirector, checkDirector, directorTask } from "./director.ts";
import { applyDesigner } from "./designer.ts";

const [dir, id, intentFile, ...only] = process.argv.slice(2);
if (!dir || !id || !intentFile) throw new Error("usage: try.ts <dir> <case> <intent.txt> [moment ...]");
const c = loadCase(id);
const p = caseProject(c);
const words = p.narration!.words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
const purposes = new Map((p.direction?.events ?? []).flatMap((e) => e.holds ?? []).map((h) => [h.id, [h.purpose, h.does].filter(Boolean).join(": ")]));
const holds = (p.narration!.holds ?? []).map((h) => ({ id: h.id, afterWord: h.afterWord, seconds: h.seconds, purpose: purposes.get(h.id) }));
const plan = parseIntent(readFileSync(intentFile, "utf8"));
const theme = themeFrom(c.style);
const cards: PartCard[] = (c.material ?? []).filter((m) => m.text).map((m) => readDoc({ name: m.name.replace(/\.\w+$/, "").replace(/\W+/g, "_"), file: m.name, text: m.text, about: m.about }));
const [width, height] = frameOf(c);
const ctxOf = c.measure?.context;
const sized = suggestViewing({ screen: ctxOf?.screen, distance: ctxOf?.distance, watch: ctxOf?.attention, why: ctxOf?.why, request: c.request }, width, height);
const startViewing = viewingFrom({ width, height, fps: 30, screen: sized.screen, frameWidthMm: sized.frameWidthMm, distanceMm: sized.distanceMm, watch: sized.watch, why: sized.why });
const start = suggestDesign(plan, startViewing, theme, cards, words);
const brief = [`Request: ${c.request}`, `Intent: ${c.intent}`, `Goal: ${c.goal}`, `Frame: ${width}x${height}`].join("\n");
const direction = (p.direction?.events ?? []).map((e) => `- ${e.id}: ${e.job}${e.feel ? ` (feel ${e.feel})` : ""}; look: ${e.look}${e.waiting ? `; waiting: ${e.waiting}` : ""}`).join("\n");
const dirInput: DirectorInput = { plan, words, holds, cards, requirements: [], brief, direction, theme, styleName: c.style, start };

const reasoner = fileReasoner(dir);
const log: string[] = [];

/** Ask a task; on an answer with problems, ask its repair, up to three rounds. */
async function settle<T>(make: (repair?: { previous: unknown; problems: string[]; round: number }) => AgentTask, check: (a: T) => string[]): Promise<T | undefined> {
  let repair: { previous: unknown; problems: string[]; round: number } | undefined;
  for (let round = 0; round <= 3; round++) {
    const task = make(repair);
    const ans = await (reasoner as Reasoner).ask<T>(task);
    if (ans.status === "pending") return void log.push(`pending ${task.id}: ${ans.file}`);
    const problems = check(ans.value);
    log.push(`${task.id}: ${problems.length ? `${problems.length} problems` : "ok"}`, ...problems.map((x) => `  - ${x}`));
    if (!problems.length) return ans.value;
    repair = { previous: ans.value, problems, round: round + 1 };
  }
  log.push("gave up after 3 repair rounds");
}

const dirAnswer = await settle<DirectorAnswer>((r) => directorTask(dirInput, r), (a) => checkDirector(dirInput, a));
const state: Record<string, unknown> = { case: id, moments: plan.moments.length, notes: plan.notes };
if (dirAnswer) {
  let design: Design = applyDirector(start, dirAnswer);
  const corrected = applyCorrections(plan, dirAnswer);
  state.corrections = corrected.notes;
  const ks = only.length ? only.map(Number) : plan.moments.map((_, k) => k);
  const S = styleValues(theme, design.viewing);
  for (const k of ks) {
    const input: DesignerInput = { plan: corrected.plan, moment: k, design, director: dirAnswer, cards, words, styleValues: S, instruments: instrumentInfo(design.viewing), holds, brief };
    const a = await settle<DesignerAnswer>((r) => designerTask(input, r), (x) => checkDesigner(input, x));
    if (a) design = applyDesigner(design, k, a);
  }
  state.design = design;
}
writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 1));
console.log(log.join("\n"));
