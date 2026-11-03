// The search and look loop (docs/DESIGN-BRAIN.md 2.4), per moment:
//   1. the designer agent writes the moment's goals (with instrument settings), the space worth searching and any
//      style overrides (engine/design/agents through the Agents contract, answered by a Reasoner); an answer with
//      problems (the agents' own checks) goes back as a repair task, never dropped or replaced
//   2. candidates come from that space and from the engine's generators (generate.ts), within the moment's share of
//      the budget, each composed into the whole video
//   3. every instrument the goals name measures each candidate's window with the goals' settings; scores are misses
//      against the agent's own goals (evaluate.ts, score.ts)
//   4. finalists go on a contact sheet; on a moment whose share of the calls allows it the viewer panel looks at the
//      sheet first (its fixes are measured as candidates too, and its reports go to the designer as readings); the
//      designer then picks one, revises the space for another round, or says it is done (the viewer's pick, else the
//      lowest miss, is kept)
//   5. budgets bound it: the director's budget is shared by importance (agents/director.ts allocate): candidates a
//      round, rounds and model calls per moment, so the moments that carry the video get the most and the least
//      important may keep their design untried (said in the report). A moment's last call is always the designer's look
//      at its final round, where it picks: no moment the search reaches ends without a designer's choice, and a tie at
//      the lowest miss is the designer's to break, never the order candidates were made in
// Every pick is a DecisionRecord with the goals it answered and the readings that showed it.
//
// Moments are searched side by side: each one starts from the same design (the director's), so one moment's tasks never
// wait for another's answers and a whole wave of tasks goes out at once; the picks are merged at the end. The loop is
// resumable: a task not answered yet stops its moment as "pending"; everything is deterministic (seeded sampling, pure
// composition), so running again replays the answered steps and continues.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Theme } from "../../core/types.ts";
import type { Agents, DesignerAnswer, DesignerInput, DirectorAnswer, ViewerAnswer, ViewerInput } from "../agents/api.ts";
import { allocate, CALLS_PER_MOMENT } from "../agents/director.ts";
import type { PropSpec } from "../depict/spec.ts";
import { instruments } from "../instruments/index.ts";
import { styleValues } from "../suggest.ts";
import type { AgentTask, Candidate, Design, From, Goal, IntentPlan, MeasureInput, MomentDesign, PartCard, Reading, Reasoner, Requirement, Word } from "../types.ts";
import { candidateText, composeCached, designHash, evaluate, holdsFrom, LAYOUT, newCache, withMoment, windowOf, type EvalCache, type EvalContext, type Evaluated } from "./evaluate.ts";
import { fieldValue, generate, withFields, type Generated } from "./generate.ts";
import { settle, type Repair } from "./settle.ts";
import { candidateSheet, type SheetOptions, type StillRenderer } from "./sheet.ts";

/** The agents the search calls: the contract's, with repair rounds and the checks that decide when one is needed. */
export type SearchAgents = Agents & {
  designerTask(input: DesignerInput, repair?: Repair): AgentTask;
  viewerTask(input: ViewerInput, repair?: Repair): AgentTask;
  checkDesigner?(input: DesignerInput, a: DesignerAnswer): string[];
  checkViewer?(input: ViewerInput, a: ViewerAnswer): string[];
};

export type SearchInput = {
  plan: IntentPlan;
  /** The design to start from: the style's suggestion with the director's answer applied. */
  design: Design;
  director: DirectorAnswer;
  cards: PartCard[];
  words: Word[];
  holds: { id: string; afterWord: number; seconds: number; purpose?: string }[];
  theme: Theme;
  frames: number;
  assets?: Record<string, string>;
  /** The depicter's specs of the plan's objects, so every candidate is composed with the things as they are drawn. */
  props?: Record<string, PropSpec>;
  requirements?: Requirement[];
  /** The user's request in plain text, as the director had it. */
  brief?: string;
  agents: SearchAgents;
  reasoner: Reasoner;
  /** Where contact sheets are written. */
  dir: string;
  /** Renders stills for contact sheets; without it the agents read numbers only and the viewer panel does not sit. */
  stills?: StillRenderer;
  /** How many finalists a sheet shows and how many keyframes per finalist (settings of the run, not of taste). */
  sheet?: { finalists: number; frames: number } & SheetOptions;
  /** Whether the viewer panel sits on finalists, on the moments whose share of the calls allows it. */
  viewers?: boolean;
  /** Only these moments (by index); the others keep their design. */
  only?: number[];
  /**
   * Moments whose search starts from their design as it stands, measured and shown to the designer as a round (a
   * revision after the whole video was measured): the designer keeps it or revises the space.
   */
  revise?: { moments: number[]; readings: Reading[] };
  /** Repair rounds per agent task (an answer the checks refuse goes back with its problems). */
  repairs?: number;
  cache?: EvalCache;
  log?: (line: string) => void;
};

export type RoundLog = { round: number; candidates: number; best: string; total: number; ms: number; perCandidate: number; sheet?: string; notes: string[] };
export type MomentOutcome = {
  moment: number;
  status: "done" | "pending" | "skipped" | "failed";
  importance: number;
  budget: number;
  rounds: RoundLog[];
  pick?: { id: string; label: string; by: From; total: number; was: number };
  /** Agent tasks this moment asked (repairs included) and the repairs it needed. */
  asked: number;
  repairs: string[];
  why: string;
};
export type SearchResult = {
  status: "done" | "pending";
  design: Design;
  moments: MomentOutcome[];
  /** Model calls the search spent on the director's budget (one per designer or viewer task) and in all (with repairs). */
  calls: number;
  asked: number;
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

const FIELDS = ["subjectScale", "subjectAt", "arrangement", "supportOpacity", "typeScale", "lead", "dwell", "camera"] as const;

/** The fields a candidate changed against another design, in short words. */
function changed(a: MomentDesign, b: MomentDesign): string {
  const out = [...FIELDS, "focus" as const].filter((f) => JSON.stringify(a[f].value) !== JSON.stringify(b[f].value)).map((f) => `${f} ${JSON.stringify(a[f].value)}`);
  return out.length ? out.join(", ") : "the design as it stood";
}

/**
 * The design a later round searches around: the best so far, with what the designer decided this round on top (its
 * focus, its proposals, and every field it set to one value), so a revision is never undone by the best of before.
 */
function carry(best: MomentDesign, cur: MomentDesign, a: DesignerAnswer): MomentDesign {
  const out: MomentDesign = { ...best, focus: cur.focus, proposals: cur.proposals };
  for (const f of FIELDS) if ((a.space?.[f]?.length ?? 0) === 1 && cur[f].from === "designer") (out as Record<string, unknown>)[f] = cur[f];
  return out;
}

/** The viewer panel's reports as readings the designer reads beside the round's numbers. */
function panelReadings(v: ViewerAnswer): Reading[] {
  const seats = [...new Set(v.seats.map((s) => s.who))];
  return seats.map((who) => {
    const mine = v.seats.filter((s) => s.who === who);
    return {
      instrument: `viewer panel, ${who}`,
      values: Object.fromEntries(mine.map((s) => [`keepsWatching.${s.candidate}`, s.wouldKeepWatching ? 1 : 0])),
      notes: mine.map((s) => `${s.candidate}: saw ${s.saw}; remembers ${s.remembers}${s.problems.length ? `; problems: ${s.problems.join("; ")}` : ""}`),
    };
  });
}

type Local = { design: Design; pick?: { c: Evaluated; by: From; why: string }; overrides: Design["overrides"] };

export async function runSearch(input: SearchInput): Promise<SearchResult> {
  const t0 = performance.now();
  const log = input.log ?? (() => {});
  const { plan, words, agents, reasoner } = input;
  const start0 = input.design;
  const fps = start0.viewing.fps;
  const cache = input.cache ?? newCache();
  const repairs = input.repairs ?? 3;
  const holds = holdsFrom(input.holds, words, plan);
  const ectx: EvalContext = { plan, compose: { theme: input.theme, words, frames: input.frames, cards: input.cards, assets: input.assets, props: input.props }, holds: holds as MeasureInput["holds"], cache };
  const instrumentList = [LAYOUT, ...Object.values(instruments).map((i) => ({ name: i.name, describe: i.describe, suggested: i.suggest(start0.viewing) as Record<string, unknown> }))];
  const S = styleValues(input.theme, start0.viewing);
  // The budget is shared by the moments being searched (all of them, or the ones asked for).
  const searched = start0.moments.filter((m) => !input.only || input.only.includes(m.moment));
  const plain = new Set(searched.filter((m) => plan.moments[m.moment]?.plain).map((m) => m.moment));
  const shares = new Map(allocate({ ...start0, moments: searched }, plain).map((a) => [a.moment, a]));
  // A task id is asked once per run: a later task that would repeat one (a round whose best did not change) gets a
  // number, so its answer never replaces the earlier task's.
  const used = new Set<string>();
  const once = (make: (r?: Repair) => AgentTask) => (r?: Repair): AgentTask => {
    const t = make(r);
    let id = t.id;
    for (let n = 2; used.has(id); n++) id = `${t.id}.n${n}`;
    used.add(id);
    // Finalists on one sheet share its picture: each picture is listed once.
    const images = t.images ? [...new Set(t.images)] : undefined;
    return { ...t, id, ...(images ? { images } : {}) };
  };
  let calls = 0;
  let asked = 0;
  const pending: string[] = [];
  const outcomes: MomentOutcome[] = [];
  const locals = new Map<number, Local>();
  const order = start0.moments
    .filter((m) => !input.only || input.only.includes(m.moment))
    .map((m) => ({ k: m.moment, imp: m.importance.value }))
    .sort((a, b) => b.imp - a.imp || a.k - b.k);

  for (const { k, imp } of order) {
    const share = shares.get(k) ?? { candidates: start0.budget.candidatesPerMoment, rounds: start0.budget.rounds, calls: CALLS_PER_MOMENT };
    const out: MomentOutcome = { moment: k, status: "skipped", importance: imp, budget: share.candidates * share.rounds, rounds: [], asked: 0, repairs: [], why: "" };
    outcomes.push(out);
    if (plan.moments[k]!.plain) {
      out.why = "the author refused the agents' proposals for this moment (plain)";
      continue;
    }
    if (share.calls < CALLS_PER_MOMENT) {
      out.why = `the video's ${start0.budget.calls} model calls cover a search and the designer's look (${CALLS_PER_MOMENT} calls each) for the ${[...shares.values()].filter((x) => x.calls >= CALLS_PER_MOMENT).length} most important moments only; this one keeps its design untried`;
      continue;
    }
    const L: Local = { design: start0, overrides: [] };
    locals.set(k, L);
    let left = share.calls;
    const perRound = Math.max(2, share.candidates);
    // Candidates and sheets of a revision are named apart from the first search's (m3.w1.c2, not m3.r1.c2).
    const tag = input.revise?.moments.includes(k) ? "w" : "r";
    const start = start0.moments.find((m) => m.moment === k)!;
    let best: Evaluated | undefined;
    let viewerPick: { c: Evaluated; why: string } | undefined;
    let viewed = false;
    let prev: { candidates: Candidate[]; sheet?: string; ranked: Evaluated[]; readings: Reading[] } | undefined;
    const seen = new Map<string, Evaluated>();
    const extra = new Map<string, Design["overrides"]>(); // style overrides a viewer's fix brings with its candidate
    const ask = async <A>(make: (r?: Repair) => AgentTask, check: ((a: A) => string[]) | undefined, who: string) => {
      calls++;
      left--;
      const s = await settle<A>(reasoner, once(make), check, repairs);
      asked += s.asked;
      out.asked += s.asked;
      if (s.status === "pending") {
        pending.push(s.file);
        out.status = "pending";
        out.why = `waits for the ${who} (${s.id})`;
        return undefined;
      }
      if (s.status === "failed") {
        out.status = "failed";
        out.why = `the ${who}'s answer (${s.id}) still had ${s.problems.length} problems after ${repairs} repairs: ${s.problems.slice(0, 3).join("; ")}`;
        return undefined;
      }
      out.repairs.push(...s.repaired);
      return s.value;
    };
    const sheetOf = async (r: string, rows: Evaluated[], d: Design): Promise<string | undefined> => {
      if (!input.stills || !input.sheet || !rows.length) return undefined;
      const window = windowOf(plan, withMoment(d, rows[0]!.design), words, k, input.frames);
      const list = rows.map((c) => ({ label: `${c.id} ${c.label}: miss ${c.total.toFixed(2)}`, d: withMoment({ ...d, overrides: [...d.overrides, ...(extra.get(c.id) ?? [])] }, c.design) }));
      // A sheet of the same designs over the same window is not rendered again (a resumed run replays its rounds). Its
      // name carries what it shows, so a task names exactly the sheet of its own candidates: a later run whose round
      // made other candidates writes another sheet, never over the one an earlier task still points at.
      const key = createHash("sha1").update(JSON.stringify({ rows: list.map((x) => [x.label, designHash(x.d)]), window, frames: input.sheet.frames })).digest("hex");
      const file = `${input.dir}/sheets/m${k}.${r}.${key.slice(0, 10)}.jpg`;
      if (existsSync(file) && existsSync(`${file}.key`) && readFileSync(`${file}.key`, "utf8") === key) return file;
      const made = await candidateSheet(list.map((x) => ({ label: x.label, scene: composeCached(plan, x.d, ectx).scene })), window, input.sheet.frames, fps, file, input.stills, input.sheet);
      if (existsSync(file)) writeFileSync(`${file}.key`, key);
      return made;
    };

    if (input.revise?.moments.includes(k)) {
      const goals = goalsFor(L.design, k);
      if (goals.length) {
        const ev = evaluate(L.design, k, [{ id: `m${k}.whole`, label: "as composed in the whole video", source: "current", design: start, why: "the design the whole video was composed with" }], goals, ectx).ranked;
        best = ev[0]!;
        seen.set(best.id, best);
        const sheet = await sheetOf("whole", ev, L.design);
        prev = { candidates: ev.map((c) => lean(c, sheet)), sheet, ranked: ev, readings: input.revise.readings };
      }
    }

    // The names the composition draws as things of their own: what the instruments can measure by name.
    const drawn = Object.keys(composeCached(plan, L.design, ectx).ids);
    for (let r = 1; !L.pick; r++) {
      // The last look: the rounds are spent, or one call is left. The designer picks among what it sees.
      const final = !!prev && (r > share.rounds || left <= 1);
      if (!prev && (r > share.rounds || left < CALLS_PER_MOMENT)) {
        out.why ||= r > 1 ? "no round was measured (the designer's answers named no goals), and the moment's calls or rounds ran out" : "the moment's share of the model calls cannot pay for a search and a look";
        break;
      }
      const dInput: DesignerInput = { plan, moment: k, design: L.design, director: input.director, cards: input.cards, words, styleValues: S, instruments: instrumentList, holds: input.holds, requirements: input.requirements, brief: input.brief, share: { candidates: share.candidates, rounds: share.rounds, calls: share.calls }, drawn, ...(prev ? { round: { candidates: prev.candidates, sheet: prev.sheet, readings: prev.readings, ...(final ? { final } : {}) } } : {}) };
      const ans = await ask<DesignerAnswer>((rep) => agents.designerTask(dInput, rep), agents.checkDesigner && ((a) => agents.checkDesigner!(dInput, a)), "designer");
      if (!ans) break;
      const picked = ans.pick && prev ? seen.get(ans.pick) : undefined;
      L.design = agents.applyDesigner(L.design, k, ans, picked);
      // The designer saw the panel's reports and chose to search again: the panel's pick of the earlier round is passed.
      if (!ans.pick) viewerPick = undefined;
      if (ans.pick && prev) {
        if (picked) {
          L.pick = { c: picked, by: "designer", why: ans.why };
          break;
        }
        out.rounds.push({ round: r, candidates: 0, best: "", total: NaN, ms: 0, perCandidate: 0, notes: [`the designer picked "${ans.pick}", which is not a candidate of this moment; searching again`] });
      }
      if (final) break;
      const goals = goalsFor(L.design, k);
      if (!goals.length) {
        out.rounds.push({ round: r, candidates: 0, best: "", total: NaN, ms: 0, perCandidate: 0, notes: ["no goals for this moment: nothing to compare candidates against"] });
        if (ans.done) break;
        continue;
      }
      // Later rounds search around the best so far, so a revision refines instead of starting over.
      const cur = L.design.moments.find((m) => m.moment === k)!;
      const base = best ? carry(best.design, cur, ans) : cur;
      const boxes = composeCached(plan, withMoment(L.design, base), ectx).boxes;
      // A candidate that composes to the same video as one already listed gives its slot to the next option.
      const distinct = (md: MomentDesign) => {
        const d = withMoment(L.design, md);
        return createHash("sha1").update(JSON.stringify([composeCached(plan, d, ectx).scene, windowOf(plan, d, words, k, input.frames)])).digest("hex");
      };
      const gen = generate(k, ans.space, perRound, { plan, design: L.design, words, theme: input.theme, boxes }, { seed: `m${k}.${tag}${r}`, base, distinct });
      const ev = evaluate(L.design, k, gen.candidates, goals, ectx);
      for (const c of ev.ranked) seen.set(c.id, c);
      // The best of every round, re-measured with the goals as they stand now (a revision may have changed them).
      const again = best ? evaluate(L.design, k, [{ id: best.id, label: best.label, source: best.source, design: best.design, why: best.why }], goals, ectx).ranked : [];
      const pool = [...ev.ranked, ...again.filter((c) => !ev.ranked.some((x) => x.id === c.id))].sort((a, b) => a.total - b.total);
      best = pool[0]!;
      let finalists = pool.slice(0, input.sheet?.finalists ?? 4);
      let sheet = await sheetOf(`${tag}${r}`, finalists, L.design);
      let readings: Reading[] = [];
      // The viewer panel sits once, on the first sheet, when the moment's calls leave room for it and for the designer's
      // look that always follows: its reports go to the designer with the round.
      const more = !ans.done;
      if (input.viewers && sheet && !viewed && left >= 2) {
        viewed = true;
        const window = windowOf(plan, withMoment(L.design, best.design), words, k, input.frames);
        const vInput: ViewerInput = { sheets: finalists.map((c) => ({ candidate: c.id, image: sheet! })), transcript: transcriptOf(words, window, fps), seats: input.director.seats, goals, styleKeys: Object.keys(S), moments: plan.moments.length, designs: Object.fromEntries(finalists.map((c) => [c.id, c.design])) };
        const v = await ask<ViewerAnswer>((rep) => agents.viewerTask(vInput, rep), agents.checkViewer && ((a) => agents.checkViewer!(vInput, a)), "viewer panel");
        if (!v) break;
        const fixed: Generated[] = [];
        const styled: { g: Generated; o: Design["overrides"] }[] = [];
        for (const [i, f] of v.fixes.entries()) {
          const c = seen.get(f.candidate);
          if (!c) continue;
          const id = `${f.candidate}.v${i}`;
          if ((FIELDS as readonly string[]).includes(f.field)) {
            const fv = fieldValue(f.field as (typeof FIELDS)[number], f.value, c.design);
            if (!fv || fv.problem) continue;
            fixed.push({ id, label: `${c.label}, viewer: ${f.field}`, source: "revise", design: withFields(c.design, { [f.field]: fv.value }, f.why, "viewer"), why: f.why });
          } else {
            // A style key: for this moment only (the moments are searched side by side), measured as its own candidate.
            const key = f.field.includes("@") ? f.field : `${f.field}@${k}`;
            if (!key.endsWith(`@${k}`)) continue;
            styled.push({ g: { id, label: `${c.label}, viewer: ${key}`, source: "revise", design: c.design, why: f.why }, o: [{ key, value: f.value, why: `the viewer panel: ${f.why}` }] });
          }
        }
        const measured = fixed.length ? evaluate(L.design, k, fixed, goals, ectx).ranked : [];
        for (const s of styled) {
          extra.set(s.g.id, s.o);
          measured.push(...evaluate({ ...L.design, overrides: [...L.design.overrides.filter((o) => !s.o.some((x) => x.key === o.key)), ...s.o] }, k, [s.g], goals, ectx).ranked);
        }
        for (const c of measured) seen.set(c.id, c);
        const vp = measured.filter((c) => c.id.startsWith(`${v.pick}.v`)).sort((a, b) => a.total - b.total)[0] ?? seen.get(v.pick);
        const on = v.seats.filter((s) => s.candidate === v.pick);
        if (vp) viewerPick = { c: vp, why: `the viewer panel's pick: ${on.filter((s) => s.wouldKeepWatching).length} of ${on.length} seats would keep watching${on[0] ? ` (${on[0].who}: ${on[0].remembers})` : ""}` };
        readings = panelReadings(v);
        if (measured.length) {
          finalists = [...finalists, ...measured].sort((a, b) => a.total - b.total).slice(0, (input.sheet?.finalists ?? 4) + measured.length);
          if (more) sheet = await sheetOf(`${tag}${r}.v`, finalists, L.design);
        }
      }
      prev = { candidates: finalists.map((c) => lean(c, sheet)), sheet, ranked: pool, readings };
      out.rounds.push({ round: r, candidates: gen.candidates.length, best: best.id, total: best.total, ms: ev.ms, perCandidate: ev.perCandidate, sheet, notes: gen.notes });
      log(`m${k} round ${r}: ${gen.candidates.length} candidates in ${ev.ms.toFixed(0)} ms (${ev.perCandidate.toFixed(0)} ms each), best ${best.id} (${best.label}) miss ${best.total.toFixed(3)}`);
      if (ans.done) break;
    }
    if (out.status === "pending" || out.status === "failed") continue;
    if (!L.pick && viewerPick) L.pick = { ...viewerPick, by: "viewer" };
    if (!L.pick && best) L.pick = { c: best, by: "search", why: best.id === `m${k}.whole` ? "kept as composed" : "the lowest miss against the goals" };
    if (!L.pick) {
      out.why ||= "no candidate was measured";
      continue;
    }
    // The design the moment started from, measured against the goals as they stand at the end (goals change between rounds).
    const finalGoals = goalsFor(L.design, k);
    const pickedDesign = { ...L.design, overrides: [...L.design.overrides, ...(extra.get(L.pick.c.id) ?? [])] };
    const was = finalGoals.length ? evaluate(L.design, k, [{ id: `m${k}.start`, label: "start", source: "current", design: start, why: "the design the search started from" }], finalGoals, ectx).ranked[0]!.total : L.pick.c.total;
    if (finalGoals.length) L.pick = { ...L.pick, c: { ...evaluate(pickedDesign, k, [{ id: L.pick.c.id, label: L.pick.c.label, source: L.pick.c.source, design: L.pick.c.design, why: L.pick.c.why }], finalGoals, ectx).ranked[0]!, label: L.pick.c.label } };
    L.overrides = extra.get(L.pick.c.id) ?? [];
    out.status = "done";
    out.pick = { id: L.pick.c.id, label: L.pick.c.label, by: L.pick.by, total: L.pick.c.total, was };
    out.why = L.pick.why;
  }

  // The picks merged into one design: each moment's design, goals, overrides (key@N) and decisions.
  let design = start0;
  const before = start0.decisions.length;
  for (const o of [...outcomes].sort((a, b) => a.moment - b.moment)) {
    const L = locals.get(o.moment);
    if (o.status !== "done" || !L?.pick) continue;
    const k = o.moment;
    const mine = (key: string) => key.endsWith(`@${k}`);
    const overrides = [...L.design.overrides.filter((x) => mine(x.key)), ...L.overrides];
    const md0 = start0.moments.find((m) => m.moment === k)!;
    design = withMoment(design, L.pick.c.design);
    design = {
      ...design,
      goals: [...design.goals.filter((g) => !(g.scope === "moment" && g.moment === k)), ...L.design.goals.filter((g) => g.scope === "moment" && g.moment === k)],
      overrides: [...design.overrides.filter((x) => !overrides.some((y) => y.key === x.key)), ...overrides],
      decisions: [
        ...design.decisions.filter((d) => !(d.area === "search" && d.moment === k)),
        ...L.design.decisions.slice(before).filter((d) => !(d.area === "search" && d.moment === k)),
        { area: "search", moment: k, choice: `${L.pick.c.id} (${L.pick.c.label}): ${changed(L.pick.c.design, md0)}${L.overrides.length ? `; ${L.overrides.map((x) => `${x.key} = ${JSON.stringify(x.value)}`).join(", ")}` : ""}`, goals: L.pick.c.scores.map((s) => s.goal), readings: Object.fromEntries(L.pick.c.scores.filter((s) => s.value !== undefined).map((s) => [s.goal, s.value!])), from: L.pick.by, why: `${L.pick.why}; total miss ${L.pick.c.total.toFixed(3)} against ${o.pick!.was.toFixed(3)} for the design it started from` },
      ],
    };
  }

  const status = pending.length ? "pending" : "done";
  const ms = performance.now() - t0;
  const lines = [`search ${status}: ${calls} of ${start0.budget.calls} calls (${asked} tasks with repairs), ${(ms / 1000).toFixed(1)} s`];
  for (const o of [...outcomes].sort((a, b) => a.moment - b.moment)) {
    const head = `m${o.moment} (importance ${o.importance}, budget ${o.budget}): ${o.status}`;
    const p = o.pick ? `; kept ${o.pick.id} (${o.pick.label}) by ${o.pick.by}, miss ${o.pick.was.toFixed(3)} -> ${o.pick.total.toFixed(3)}` : "";
    lines.push(`${head}${p}${o.why ? `; ${o.why}` : ""}`);
    for (const r of o.rounds) lines.push(`  round ${r.round}: ${r.candidates} candidates, ${r.perCandidate.toFixed(0)} ms each${r.best ? `, best ${r.best} miss ${r.total.toFixed(3)}` : ""}${r.sheet ? `, sheet ${r.sheet}` : ""}${r.notes.length ? `; ${r.notes.join("; ")}` : ""}`);
    for (const x of o.repairs) lines.push(`  repaired ${x}`);
  }
  return { status, design, moments: outcomes, calls, asked, pending, ms, report: lines.join("\n") };
}

export { candidateText };
