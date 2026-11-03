// The search and look loop (docs/DESIGN-BRAIN.md 2.4), per moment:
//   1. the designer agent writes the moment's goals (with instrument settings), the space worth searching and any
//      style overrides (engine/design/agents through the Agents contract, answered by a Reasoner)
//   2. candidates come from that space and from the engine's generators (generate.ts), within the moment's share of
//      the budget, each composed into the whole video
//   3. every instrument the goals name measures each candidate's window with the goals' settings; scores are misses
//      against the agent's own goals (evaluate.ts, score.ts)
//   4. the designer sees the best candidates' readings and their contact sheet and picks one, revises the space for
//      another round, or says it is done (then the lowest miss is kept); finalists may go to the viewer panel, whose
//      fixes are measured too and whose pick is kept
//   5. budgets bound it: candidates per moment (shared by importance), rounds per moment, model calls per video; the
//      moments that carry the video (the director's importance) are searched first, so when calls run out it is the
//      least important moments that keep the style's suggestion
// Every pick is a DecisionRecord with the goals it answered and the readings that showed it.
//
// The loop is resumable: an agent task that is not answered yet (a file Reasoner in development) stops the run with
// status "pending"; everything is deterministic (seeded sampling, pure composition), so running again after the
// answer replays the answered steps and continues.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Theme } from "../../core/types.ts";
import type { Agents, DesignerAnswer, DirectorAnswer, ViewerAnswer } from "../agents/api.ts";
import { instruments } from "../instruments/index.ts";
import { styleValues } from "../suggest.ts";
import type { Candidate, Design, From, Goal, IntentPlan, MeasureInput, MomentDesign, PartCard, Reasoner, Word } from "../types.ts";
import { candidateText, composeCached, designHash, evaluate, holdsFrom, LAYOUT, newCache, withMoment, windowOf, type EvalCache, type EvalContext, type Evaluated } from "./evaluate.ts";
import { budgetFor, fieldValue, generate, withFields, type Generated } from "./generate.ts";
import { candidateSheet, type SheetOptions, type StillRenderer } from "./sheet.ts";

export type SearchInput = {
  plan: IntentPlan;
  /** The design to start from: the style's suggestion with the director's answer applied. */
  design: Design;
  director: DirectorAnswer;
  cards: PartCard[];
  words: Word[];
  holds: { id: string; afterWord: number; seconds: number }[];
  theme: Theme;
  frames: number;
  assets?: Record<string, string>;
  agents: Agents;
  reasoner: Reasoner;
  /** Where contact sheets are written. */
  dir: string;
  /** Renders stills for contact sheets; without it the agents read numbers only and the viewer panel does not sit. */
  stills?: StillRenderer;
  /** How many finalists a sheet shows and how many keyframes per finalist (settings of the run, not of taste). */
  sheet?: { finalists: number; frames: number } & SheetOptions;
  /** Whether finalists go to the viewer panel after the designer's rounds. */
  viewers?: boolean;
  /** Only these moments (by index); the others keep their design. */
  only?: number[];
  cache?: EvalCache;
  log?: (line: string) => void;
};

export type RoundLog = { round: number; candidates: number; best: string; total: number; ms: number; perCandidate: number; sheet?: string; notes: string[] };
export type MomentOutcome = {
  moment: number;
  status: "done" | "pending" | "skipped";
  importance: number;
  budget: number;
  rounds: RoundLog[];
  pick?: { id: string; label: string; by: From; total: number; was: number };
  why: string;
};
export type SearchResult = {
  status: "done" | "pending";
  design: Design;
  moments: MomentOutcome[];
  calls: number;
  /** Task files waiting for an answer. */
  pending: string[];
  ms: number;
  report: string;
};

/** The goals a moment is measured against: its own and the video's (measured on the moment's window). */
export const goalsFor = (design: Design, k: number): Goal[] => design.goals.filter((g) => (g.scope === "moment" && g.moment === k) || g.scope === "video");

/** What an agent needs from a candidate: no per-frame series. */
const lean = (c: Evaluated, sheet?: string): Candidate => ({ id: c.id, moment: c.moment, design: c.design, readings: c.readings.map(({ series: _s, ...r }) => r), scores: c.scores, total: c.total, ...(sheet ? { sheet } : {}) });

/** The words spoken in a window, for the viewer panel. */
function transcriptOf(words: Word[], window: [number, number], fps: number): string {
  const [a, b] = [window[0] / fps, window[1] / fps];
  return words.filter((w) => w.start >= a && w.start < b).map((w) => w.text).join(" ");
}

/** The fields a candidate changed against another design, in short words. */
function changed(a: MomentDesign, b: MomentDesign): string {
  const fields = ["subjectScale", "subjectAt", "arrangement", "supportOpacity", "typeScale", "lead", "dwell", "camera"] as const;
  const out = fields.filter((f) => JSON.stringify(a[f].value) !== JSON.stringify(b[f].value)).map((f) => `${f} ${JSON.stringify(a[f].value)}`);
  return out.length ? out.join(", ") : "the design as it stood";
}

export async function runSearch(input: SearchInput): Promise<SearchResult> {
  const t0 = performance.now();
  const log = input.log ?? (() => {});
  const { plan, words, agents, reasoner } = input;
  const fps = input.design.viewing.fps;
  const cache = input.cache ?? newCache();
  const holds = holdsFrom(input.holds, words);
  const ectx: EvalContext = { plan, compose: { theme: input.theme, words, frames: input.frames, cards: input.cards, assets: input.assets }, holds: holds as MeasureInput["holds"], cache };
  const instrumentList = [LAYOUT, ...Object.values(instruments).map((i) => ({ name: i.name, describe: i.describe, suggested: i.suggest(input.design.viewing) as Record<string, unknown> }))];
  let design = input.design;
  let calls = 0;
  const pending: string[] = [];
  const outcomes: MomentOutcome[] = [];
  const order = design.moments
    .filter((m) => !input.only || input.only.includes(m.moment))
    .map((m) => ({ k: m.moment, imp: m.importance.value }))
    .sort((a, b) => b.imp - a.imp || a.k - b.k);
  const ask = async <T>(task: Parameters<Reasoner["ask"]>[0]): Promise<T | undefined> => {
    calls++;
    const a = await reasoner.ask<T>(task);
    if (a.status === "pending") {
      pending.push(a.file);
      return undefined;
    }
    return a.value;
  };

  for (const { k, imp } of order) {
    const budget = budgetFor(design, k);
    const out: MomentOutcome = { moment: k, status: "skipped", importance: imp, budget, rounds: [], why: "" };
    outcomes.push(out);
    if (pending.length) {
      out.why = "waits for an earlier moment's answer";
      continue;
    }
    if (plan.moments[k]!.plain) {
      out.why = "the author refused the agents' proposals for this moment (plain)";
      continue;
    }
    if (calls >= design.budget.calls) {
      out.why = `the video's ${design.budget.calls} model calls are spent on more important moments`;
      continue;
    }
    const perRound = Math.max(2, Math.ceil(budget / Math.max(1, design.budget.rounds)));
    const start = design.moments.find((m) => m.moment === k)!;
    let best: Evaluated | undefined;
    let pick: { c: Evaluated; by: From; why: string } | undefined;
    let prev: { candidates: Candidate[]; sheet?: string; ranked: Evaluated[] } | undefined;
    const seen = new Map<string, Evaluated>();

    for (let r = 1; r <= design.budget.rounds && !pick; r++) {
      if (calls >= design.budget.calls) {
        out.why = "the video's model calls ran out during this moment";
        break;
      }
      const task = agents.designerTask({ plan, moment: k, design, director: input.director, cards: input.cards, words, styleValues: styleValues(input.theme, design.viewing), instruments: instrumentList, ...(prev ? { round: { candidates: prev.candidates, sheet: prev.sheet, readings: prev.candidates[0]?.readings ?? [] } } : {}) });
      const ans = await ask<DesignerAnswer>(task);
      if (!ans) {
        out.status = "pending";
        out.why = `waits for the designer (${task.id})`;
        break;
      }
      design = agents.applyDesigner(design, k, ans);
      if (ans.pick && prev) {
        const c = seen.get(ans.pick);
        if (c) {
          pick = { c, by: "designer", why: ans.why };
          break;
        }
        out.rounds.push({ round: r, candidates: 0, best: "", total: NaN, ms: 0, perCandidate: 0, notes: [`the designer picked "${ans.pick}", which is not a candidate of this moment; searching again`] });
      }
      const goals = goalsFor(design, k);
      if (!goals.length) {
        out.rounds.push({ round: r, candidates: 0, best: "", total: NaN, ms: 0, perCandidate: 0, notes: ["no goals for this moment: nothing to compare candidates against"] });
        if (ans.done) break;
        continue;
      }
      // Later rounds search around the best so far, so a revision refines instead of starting over.
      const base = best ? best.design : design.moments.find((m) => m.moment === k)!;
      const boxes = composeCached(plan, withMoment(design, base), ectx).boxes;
      const gen = generate(k, ans.space, perRound, { plan, design, words, theme: input.theme, boxes }, { seed: `m${k}.r${r}`, base });
      const ev = evaluate(design, k, gen.candidates, goals, ectx);
      for (const c of ev.ranked) seen.set(c.id, c);
      // The best of every round, re-measured with the goals as they stand now (a revision may have changed them).
      const pool = [...ev.ranked, ...(best ? evaluate(design, k, [{ id: best.id, label: best.label, source: best.source, design: best.design, why: best.why }], goals, ectx).ranked : [])].sort((a, b) => a.total - b.total);
      best = pool[0]!;
      const finalists = pool.slice(0, input.sheet?.finalists ?? 4);
      let sheet: string | undefined;
      if (input.stills && input.sheet) {
        const window = windowOf(plan, withMoment(design, best.design), words, k, input.frames);
        const rows = finalists.map((c) => ({ label: `${c.id} ${c.label}: miss ${c.total.toFixed(2)}`, d: withMoment(design, c.design) }));
        const file = `${input.dir}/sheets/m${k}.r${r}.jpg`;
        // A sheet of the same designs over the same window is not rendered again (a resumed run replays its rounds).
        const key = createHash("sha1").update(JSON.stringify({ rows: rows.map((x) => [x.label, designHash(x.d)]), window, frames: input.sheet.frames })).digest("hex");
        if (existsSync(file) && existsSync(`${file}.key`) && readFileSync(`${file}.key`, "utf8") === key) sheet = file;
        else {
          sheet = await candidateSheet(rows.map((x) => ({ label: x.label, scene: composeCached(plan, x.d, ectx).scene })), window, input.sheet.frames, fps, file, input.stills, input.sheet);
          if (existsSync(file)) writeFileSync(`${file}.key`, key);
        }
      }
      prev = { candidates: finalists.map((c) => lean(c, sheet)), sheet, ranked: pool };
      out.rounds.push({ round: r, candidates: gen.candidates.length, best: best.id, total: best.total, ms: ev.ms, perCandidate: ev.perCandidate, sheet, notes: gen.notes });
      log(`m${k} round ${r}: ${gen.candidates.length} candidates in ${ev.ms.toFixed(0)} ms (${ev.perCandidate.toFixed(0)} ms each), best ${best.id} (${best.label}) miss ${best.total.toFixed(3)}`);
      if (ans.done) break;
    }
    if (out.status === "pending") continue;
    if (!pick && best && prev) {
      pick = { c: best, by: "search", why: "the lowest miss against the goals" };
      // The viewer panel looks at the finalists' sheet and may pick another and fix fields; fixes are measured too.
      if (input.viewers && prev.sheet && calls < design.budget.calls) {
        const window = windowOf(plan, withMoment(design, best.design), words, k, input.frames);
        const goals = goalsFor(design, k);
        const vtask = agents.viewerTask({ sheets: [{ candidate: prev.candidates.map((c) => c.id).join(", "), image: prev.sheet }], transcript: transcriptOf(words, window, fps), seats: input.director.seats, goals });
        const v = await ask<ViewerAnswer>(vtask);
        if (!v) {
          out.status = "pending";
          out.why = `waits for the viewer panel (${vtask.id})`;
          continue;
        }
        const fixed: Generated[] = [];
        for (const [i, f] of v.fixes.entries()) {
          const c = seen.get(f.candidate);
          const fv = c && fieldValue(f.field as Parameters<typeof fieldValue>[0], f.value, c.design);
          if (!c || !fv || fv.problem) continue;
          fixed.push({ id: `${f.candidate}.v${i}`, label: `${c.label}, viewer: ${f.field}`, source: "revise", design: withFields(c.design, { [f.field]: fv.value }, f.why, "viewer"), why: f.why });
        }
        const ev = fixed.length ? evaluate(design, k, fixed, goals, ectx).ranked : [];
        for (const c of ev) seen.set(c.id, c);
        const vp = ev.find((c) => c.id.startsWith(`${v.pick}.v`)) ?? seen.get(v.pick);
        if (vp) pick = { c: vp, by: "viewer", why: v.seats.filter((s) => s.candidate === v.pick).map((s) => `${s.who}: ${s.saw}`).join("; ") || "the viewer panel's pick" };
      }
    }
    if (!pick) {
      out.status = out.status === "skipped" && !out.why ? "skipped" : out.status;
      out.why ||= "no candidate was measured";
      continue;
    }
    // The design the moment started from, measured against the goals as they stand at the end (goals change between rounds).
    const finalGoals = goalsFor(design, k);
    const was = finalGoals.length ? evaluate(design, k, [{ id: `m${k}.start`, label: "start", source: "current", design: start, why: "the design the search started from" }], finalGoals, ectx).ranked[0]!.total : pick.c.total;
    if (finalGoals.length) pick = { ...pick, c: evaluate(design, k, [{ id: pick.c.id, label: pick.c.label, source: pick.c.source, design: pick.c.design, why: pick.c.why }], finalGoals, ectx).ranked[0]! };
    const md0 = design.moments.find((m) => m.moment === k)!;
    design = withMoment(design, pick.c.design);
    design = {
      ...design,
      decisions: [
        ...design.decisions.filter((d) => !(d.area === "search" && d.moment === k)),
        { area: "search", moment: k, choice: `${pick.c.id} (${pick.c.label}): ${changed(pick.c.design, md0)}`, goals: pick.c.scores.map((s) => s.goal), readings: Object.fromEntries(pick.c.scores.filter((s) => s.value !== undefined).map((s) => [s.goal, s.value!])), from: pick.by, why: `${pick.why}; total miss ${pick.c.total.toFixed(3)} against ${was.toFixed(3)} for the design it started from` },
      ],
    };
    out.status = "done";
    out.pick = { id: pick.c.id, label: pick.c.label, by: pick.by, total: pick.c.total, was };
    out.why = pick.why;
  }

  const status = pending.length ? "pending" : "done";
  const ms = performance.now() - t0;
  const lines = [`search ${status}: ${calls} of ${design.budget.calls} calls, ${(ms / 1000).toFixed(1)} s`];
  for (const o of [...outcomes].sort((a, b) => a.moment - b.moment)) {
    const head = `m${o.moment} (importance ${o.importance}, budget ${o.budget}): ${o.status}`;
    const p = o.pick ? `; kept ${o.pick.id} (${o.pick.label}) by ${o.pick.by}, miss ${o.pick.was.toFixed(3)} -> ${o.pick.total.toFixed(3)}` : "";
    lines.push(`${head}${p}${o.why ? `; ${o.why}` : ""}`);
    for (const r of o.rounds) lines.push(`  round ${r.round}: ${r.candidates} candidates, ${r.perCandidate.toFixed(0)} ms each${r.best ? `, best ${r.best} miss ${r.total.toFixed(3)}` : ""}${r.sheet ? `, sheet ${r.sheet}` : ""}${r.notes.length ? `; ${r.notes.join("; ")}` : ""}`);
  }
  return { status, design, moments: outcomes, calls, pending, ms, report: lines.join("\n") };
}

export { candidateText };
