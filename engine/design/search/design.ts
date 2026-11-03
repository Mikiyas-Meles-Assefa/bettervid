// The design brain's one run (docs/DESIGN-BRAIN.md 2): an intent plan, the user's material and the narration in, a
// composed scene with every decision and its reason out. It joins the layers:
//   wave 1   the depicter for every object of the plan (engine/design/depict/depicter.ts, with its check and repair
//            rounds) and the director (agents/director.ts, checked and repaired), asked side by side; the director's
//            corrections of the plan are made at once, each a visible note, and an object whose words a correction
//            changed is depicted again from the corrected words
//   wave 2+  the search and look loop (run.ts) with the real designer and viewer panel, the depicter's specs in every
//            composition and the director's answer; the moments are searched side by side
//   then     the whole video composed with the chosen design and measured against the director's video goals; when a
//            goal misses and the director's budget has calls left, the designer of each moment that misses it most gets
//            one revision round with the whole-video readings, and the video is composed and measured again
//   files    design.json, decisions.json, notes.txt (the director's corrections first), composed.scene.json, ids.json,
//            props.json and report.txt under `dir`
// Every agent goes through the Reasoner, so the run is resumable: a task not answered yet makes the run "pending" with
// the task files it waits for; running again replays every answered step (deterministic composition and sampling) and
// goes on. Tasks that do not depend on each other go out in the same wave, so a video takes few agent turns.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Scene, Theme } from "../../core/types.ts";
import type { DirectorAnswer, DirectorInput } from "../agents/api.ts";
import { agents as realAgents, applyCorrections, checkDesigner, checkDirector, checkViewer } from "../agents/index.ts";
import { CALLS_PER_MOMENT } from "../agents/director.ts";
import { compose, type ComposeCtx, type Composition } from "../compose/compose.ts";
import { depict, depicterTask, type DepictRequest } from "../depict/depicter.ts";
import { checkSpec } from "../depict/depict.ts";
import type { PropSpec } from "../depict/spec.ts";
import { idsOf, relationLine } from "../intent/parse.ts";
import { suggestDesign, viewingFrom } from "../suggest.ts";
import type { AgentTask, DecisionRecord, Design, IntentPlan, PartCard, Reading, Reasoner, Requirement, Viewing, Word } from "../types.ts";
import { holdsFrom, measureGoals, newCache, windowOf } from "./evaluate.ts";
import { runSearch, type SearchAgents, type SearchResult } from "./run.ts";
import { settle, type Repair } from "./settle.ts";
import type { SheetOptions, StillRenderer } from "./sheet.ts";

export type DesignInputs = {
  plan: IntentPlan;
  /** Every spoken word of the video, with global numbers, so the plan's `@N` and the scene's frames are the video's own. */
  words: Word[];
  holds: { id: string; afterWord: number; seconds: number; purpose?: string }[];
  /** The part of the narration this plan covers, when the video is made in parts. */
  range?: { id: string; firstWord: number; lastWord: number };
  frames: number;
  cards: PartCard[];
  requirements: Requirement[];
  /** The user's pictures by card name, as URLs the renderer can load (data URLs for stills). */
  assets: Record<string, string>;
  /** The user's request and what the plan stage knows (purpose, audience, platform), in plain text. */
  brief: string;
  /** The direction plan's events, in plain text. */
  direction?: string;
  theme: Theme;
  styleName: string;
  /** The viewing the project implies (its frame, the platform): a hint the director confirms or replaces. */
  viewing?: Viewing;
  /** Depicter specs already made for this video (another part's), by plan id: not asked again. */
  props?: Record<string, PropSpec>;
};

/** The agents a design run calls: the search's, the director with its repair rounds, and the checks of every answer. */
export type DesignAgents = SearchAgents & {
  directorTask(input: DirectorInput, repair?: Repair): AgentTask;
  checkDirector?(input: DirectorInput, a: DirectorAnswer): string[];
  applyCorrections?(plan: IntentPlan, a: DirectorAnswer): { plan: IntentPlan; notes: string[] };
};

/** engine/design/agents with their checks: what a run uses unless a caller (a test) injects others. */
export const brainAgents: DesignAgents = { ...realAgents, checkDirector, checkDesigner, checkViewer, applyCorrections };

export type DesignOptions = {
  /** Stills for contact sheets; without them the agents read numbers only and the viewer panel does not sit. */
  stills?: StillRenderer;
  sheet?: { finalists: number; frames: number } & SheetOptions;
  /** Whether the viewer panel sits (it needs stills). Default: whenever there are stills. */
  viewers?: boolean;
  /** Repair rounds for every agent task, and check-and-repair rounds for the depicter. */
  repairs?: number;
  depictRounds?: number;
  /** The whole-video revision round (default on). */
  revise?: boolean;
  log?: (line: string) => void;
};

export type DesignOutcome =
  | { status: "pending"; waiting: string[]; report: string }
  | { status: "done"; scene: Scene; design: Design; ids: Record<string, string[]>; notes: string[]; decisions: DecisionRecord[]; corrections: DirectorAnswer["corrections"]; props: Record<string, PropSpec>; report: string };

const label = (t: IntentPlan["things"][number]) => `${t.id} (${t.kind}${t.desc ? `: ${t.desc}` : t.text ? `: "${t.text}"` : t.many ? `: ${t.many.n} ${t.many.unit}` : t.material ? `: ${t.material.name}` : ""})`;
const words = (s: string) => s.toLowerCase().replace(/[-_]+/g, " ");

/** What the depicter is told about one object: its words, the plan's verbs for it, the things beside it, the material that names it. */
export function depictRequest(plan: IntentPlan, id: string, x: Pick<DesignInputs, "cards" | "requirements" | "brief">, tag = ""): DepictRequest {
  const t = plan.things.find((y) => y.id === id)!;
  const acts = plan.moments.flatMap((m) => m.acts.filter((a) => a.ids.includes(id)).map((a) => ({ verb: a.verb, ...(a.arg ? { arg: a.arg } : {}), ...(a.to ? { to: a.to } : {}) })));
  const unique = [...new Map(acts.map((a) => [JSON.stringify(a), a])).values()];
  const placed = (plan.relations ?? []).filter((r) => r.a === id || r.b === id);
  const beside = new Set([...plan.moments.filter((m) => idsOf(m).includes(id)).flatMap((m) => idsOf(m)), ...placed.flatMap((r) => [r.a, r.b])].filter((y) => y !== id));
  const relations = placed.map(relationLine);
  const company = plan.things.filter((y) => beside.has(y.id)).map(label);
  // Lines of the user's material that name the thing by its plan name (the plan's own word, no list of topic words).
  const name = words(id);
  const material = [
    ...x.cards.flatMap((c) => [c.about, ...(c.text ?? "").split(/\n+/), ...Object.values(c.parts).map((p) => p.about)].filter((l) => l && words(l).includes(name)).map((l) => `${l.trim().slice(0, 300)} (${c.file})`)),
    ...x.requirements.filter((r) => words(`${r.detail} ${r.applies ?? ""}`).includes(name)).map((r) => `${r.kind}: ${r.detail} (${r.source.file})`),
  ].slice(0, 12);
  return { id: `depict.${id}${tag}`, name: id, desc: t.desc ?? t.id, acts: unique, ...(company.length ? { company } : {}), ...(material.length ? { material } : {}), purpose: x.brief.split("\n").filter(Boolean).slice(0, 3).join(" ").slice(0, 400), ...(relations.length ? { relations } : {}) };
}

/** Writes a file under the run's folder. */
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), body);
};

export async function runDesign(dir: string, inputs: DesignInputs, reasoner: Reasoner, agents: DesignAgents = brainAgents, opts: DesignOptions = {}): Promise<DesignOutcome> {
  const t0 = performance.now();
  const log = opts.log ?? (() => {});
  const repairs = opts.repairs ?? 3;
  const report: string[] = [];
  const notes: string[] = [];
  const waiting: string[] = [];
  const { plan, theme, cards, words: said } = inputs;
  if (!inputs.viewing) throw new Error("runDesign needs a viewing (at least the frame) for the director to start from");
  const pending = (why: string): DesignOutcome => {
    report.push(`pending: ${why}`, ...waiting.map((w) => `- ${w}`));
    const text = report.join("\n");
    put(dir, "report.txt", `${text}\n`);
    put(dir, "waiting.json", JSON.stringify(waiting, null, 1));
    return { status: "pending", waiting: [...waiting], report: text };
  };
  put(dir, "waiting.json", "[]");

  // Wave 1: the depicter for every object and the director, side by side.
  const props: Record<string, PropSpec> = { ...(inputs.props ?? {}) };
  const depictOne = async (p: IntentPlan, id: string, tag = "") => {
    const r = await depict(reasoner, depictRequest(p, id, inputs, tag), opts.depictRounds ?? repairs + 1);
    if (r.status === "pending") return void waiting.push(r.file);
    props[id] = r.spec;
    report.push(`depicted ${id} as ${r.spec.kind}${r.spec.form ? ` (${r.spec.form})` : ""} in ${r.rounds} round${r.rounds > 1 ? "s" : ""}`);
    if (r.problems.length) notes.push(`the depiction of ${id} still has problems after ${r.rounds} rounds: ${r.problems.map((x) => `${x.path}: ${x.problem}`).join("; ")}`);
  };
  const objects = plan.things.filter((t) => t.kind === "object" && !inputs.props?.[t.id]);
  for (const t of objects) await depictOne(plan, t.id);
  const start = suggestDesign(plan, inputs.viewing, theme, cards, said, inputs.props ?? {});
  // What the start composes to names what the instruments can read; known once every object is depicted (the director's
  // goals are checked against it then, and a goal on a name that is not drawn goes back as a repair).
  let drawn: string[] | undefined;
  if (!waiting.length) {
    try {
      drawn = Object.keys(compose(plan, suggestDesign(plan, inputs.viewing, theme, cards, said, props), { theme, words: said, frames: inputs.frames, cards, assets: inputs.assets, props }).ids);
    } catch {
      drawn = undefined;
    }
  }
  const dInput: DirectorInput = { plan, words: said, holds: inputs.holds, cards, requirements: inputs.requirements, brief: inputs.brief, direction: inputs.direction, theme, styleName: inputs.styleName, viewing: inputs.viewing, start, ...(drawn ? { drawn } : {}) };
  const d = await settle<DirectorAnswer>(reasoner, (r) => agents.directorTask(dInput, r), agents.checkDirector && ((a) => agents.checkDirector!(dInput, a)), repairs);
  if (d.status === "failed") throw new Error(`the director's answer (${d.id}) still had ${d.problems.length} problems after ${repairs} repairs: ${d.problems.slice(0, 4).join("; ")}`);
  if (d.status === "pending") waiting.push(d.file);
  if (waiting.length || d.status !== "answered") return pending("wave 1: the depicter and the director");
  const director = d.value;
  report.push(`director: ${d.asked} task${d.asked > 1 ? "s" : ""}${d.repaired.length ? ` (repaired: ${d.repaired.join("; ")})` : ""}; budget ${JSON.stringify(director.budget)}`);

  // The director's corrections, each a visible note; an object a correction re-worded is depicted from its new words.
  const corrected = agents.applyCorrections ? agents.applyCorrections(plan, director) : { plan, notes: director.corrections.map((c) => `the director asks to correct "${c.was}" to "${c.now}" (${c.source}), but these agents cannot apply corrections`) };
  const P = corrected.plan;
  for (const t of P.things.filter((x) => x.kind === "object")) {
    const was = plan.things.find((x) => x.id === t.id);
    if (was && was.desc !== t.desc && !inputs.props?.[t.id]) await depictOne(P, t.id, ".corrected");
  }
  if (waiting.length) return pending("an object the director corrected, depicted again");

  // What the composer cannot draw from a depiction goes back to the depicter as a repair, never drawn as something lesser.
  const ctx: ComposeCtx = { theme, words: said, frames: inputs.frames, cards, assets: inputs.assets, props };
  let design = agents.applyDirector(suggestDesign(P, viewingFrom(director.viewing), theme, cards, said, props), director);
  for (const bp of compose(P, design, ctx).problems.filter((x) => x.who === "depicter" && props[x.thing])) {
    const req = depictRequest(P, bp.thing, inputs, ".build");
    const make = (r?: Repair) => depicterTask(req, { previous: (r?.previous as PropSpec | undefined) ?? props[bp.thing]!, problems: (r?.problems ?? [bp.problem]).map((problem) => ({ path: "composer", problem })), round: (r?.round ?? 0) + 1 });
    const fix = await settle<PropSpec>(reasoner, make, (s) => checkSpec(s, { verbs: req.acts.map((a) => a.verb) }).map((x) => `${x.path}: ${x.problem}`), repairs);
    if (fix.status === "pending") waiting.push(fix.file);
    else if (fix.status === "answered") props[bp.thing] = fix.value;
    else notes.push(`the depiction of ${bp.thing} cannot be drawn: ${bp.problem}; its repair still had problems: ${fix.problems.join("; ")}`);
  }
  if (waiting.length) return pending("the composer asked the depicter to repair a depiction");
  if (Object.keys(props).length) design = agents.applyDirector(suggestDesign(P, viewingFrom(director.viewing), theme, cards, said, props), director);

  // Wave 2 onward: the search and look loop.
  const cache = newCache();
  const viewers = opts.viewers ?? !!opts.stills;
  const searchInput = { plan: P, director, cards, words: said, holds: inputs.holds, theme, frames: inputs.frames, assets: inputs.assets, props, requirements: inputs.requirements, brief: inputs.brief, agents, reasoner, dir, stills: opts.stills, sheet: opts.stills ? (opts.sheet ?? { finalists: 3, frames: 3 }) : undefined, viewers, repairs, cache, log };
  const sr = await runSearch({ ...searchInput, design });
  report.push("", sr.report);
  for (const o of sr.moments.filter((m) => m.status === "failed")) notes.push(`m${o.moment} was not searched: ${o.why}`);
  if (sr.status === "pending") {
    waiting.push(...sr.pending);
    return pending("the search");
  }
  design = sr.design;

  // The whole video, composed with the chosen design and measured against the director's video goals.
  const holds = holdsFrom(inputs.holds, said, P);
  const videoGoals = () => design.goals.filter((g) => g.scope === "video");
  const measureWhole = (c: Composition) => (videoGoals().length ? measureGoals(c, P, undefined, videoGoals(), { words: said, viewing: design.viewing, holds }) : undefined);
  let c = compose(P, design, ctx);
  let whole = measureWhole(c);
  let rev: SearchResult | undefined;
  const left = design.budget.calls - sr.calls;
  if (whole && whole.total > 0 && opts.revise !== false && left >= CALLS_PER_MOMENT) {
    // The moments where the video goals miss most on their own windows, the most important first: each gets a revision
    // and the designer's look at it (CALLS_PER_MOMENT calls), so no revised moment ends without the designer's pick.
    const per = design.moments
      .filter((m) => !P.moments[m.moment]!.plain)
      .map((m) => ({ k: m.moment, imp: m.importance.value, miss: measureGoals(c, P, m.moment, videoGoals(), { words: said, viewing: design.viewing, holds, window: windowOf(P, design, said, m.moment, inputs.frames, c.onsets) }).total }))
      .filter((x) => x.miss > 0)
      .sort((a, b) => b.imp * b.miss - a.imp * a.miss || a.k - b.k)
      .slice(0, Math.floor(left / CALLS_PER_MOMENT));
    if (per.length) {
      const readings: Reading[] = [{ instrument: "whole video", values: Object.fromEntries(whole.scores.filter((s) => s.value !== undefined).map((s) => [s.goal, s.value!])), notes: [`the video goals measured over the whole video miss ${whole.total.toFixed(3)} in all: ${whole.scores.map((s) => `${s.goal} miss ${s.miss.toFixed(2)}`).join(", ")}`, `this moment's window misses them by ${per.map((x) => `m${x.k} ${x.miss.toFixed(3)}`).join(", ")}`] }];
      rev = await runSearch({ ...searchInput, design: { ...design, budget: { ...design.budget, rounds: 1, calls: per.length * CALLS_PER_MOMENT } }, only: per.map((x) => x.k), revise: { moments: per.map((x) => x.k), readings } });
      report.push("", `whole-video revision of ${per.map((x) => `m${x.k}`).join(", ")}:`, rev.report);
      if (rev.status === "pending") {
        waiting.push(...rev.pending);
        return pending("the whole-video revision");
      }
      design = { ...rev.design, budget: design.budget };
      c = compose(P, design, ctx);
      const after = measureWhole(c);
      report.push(`video goals over the whole video: miss ${whole.total.toFixed(3)} before the revision, ${after?.total.toFixed(3)} after`);
      whole = after;
    }
  }
  if (whole) {
    design = { ...design, decisions: [...design.decisions, { area: "video goals", choice: `measured over the whole video: total miss ${whole.total.toFixed(3)}`, goals: whole.scores.map((s) => s.goal), readings: Object.fromEntries(whole.scores.filter((s) => s.value !== undefined).map((s) => [s.goal, s.value!])), from: "search", why: whole.scores.map((s) => `${s.goal} miss ${s.miss.toFixed(2)}`).join(", ") }] };
    notes.push(`video goals over the whole video: total miss ${whole.total.toFixed(3)} (${whole.scores.map((s) => (s.applies === false ? `${s.goal} does not apply` : `${s.goal} ${s.value === undefined ? "not measured" : Number(s.value.toFixed(3))}, miss ${s.miss.toFixed(2)}`)).join("; ")})`, ...whole.notes);
  }
  for (const p of c.problems) notes.push(`${p.thing}: ${p.problem} (for the ${p.who})`);
  const allNotes = [...corrected.notes, ...notes, ...c.notes];
  const decisions = [...design.decisions, ...c.decisions];
  const calls = sr.calls + (rev?.calls ?? 0);
  report.unshift(`design ${inputs.range?.id ?? ""} done in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${objects.length} depicted, ${calls} of ${design.budget.calls} search calls`.replace("  ", " "));
  const text = report.join("\n");
  put(dir, "design.json", JSON.stringify(design, null, 1));
  put(dir, "decisions.json", JSON.stringify(decisions, null, 1));
  put(dir, "notes.txt", `${allNotes.join("\n")}\n`);
  put(dir, "props.json", JSON.stringify(props, null, 1));
  put(dir, "ids.json", JSON.stringify(c.ids, null, 1));
  put(dir, "composed.scene.json", JSON.stringify(c.scene));
  put(dir, "report.txt", `${text}\n`);
  return { status: "done", scene: c.scene, design, ids: c.ids, notes: allNotes, decisions, corrections: director.corrections, props, report: text };
}
