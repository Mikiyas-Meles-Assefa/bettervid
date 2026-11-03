// Evaluation: each candidate design of a moment is composed as part of the whole video (only that moment's design
// differs), its window is measured with every instrument its goals name, with the settings the goals chose (merged
// over the instrument's suggestion by settingsFor), and scored. Results are cached by the design's hash, so a resumed
// run or a second round re-measures nothing it has seen. Every candidate reports its time.
//
// Besides the instruments, the search reports the composer's own boxes as a reading named "layout": per plan name, the
// share of the frame its box covers on the moment's settled layout (area, w, h), and "anchor" for the moment's subject.
// It is a measurement of the composition, never a judgment. What the camera crops is read by visibility on the drawn
// frame (through the camera and clips at each sampled frame), not from these boxes.
import { createHash } from "node:crypto";
import { compose, type ComposeCtx, type Composition } from "../compose/compose.ts";
import { instruments, settingsFor } from "../instruments/index.ts";
import type { CameraPlan, Candidate, Design, Goal, IntentPlan, MeasureInput, MomentDesign, Reading, Viewing, Word } from "../types.ts";
import { idsOf } from "../intent/parse.ts";
import type { Generated, Source } from "./generate.ts";
import { scoreGoal } from "./score.ts";

export type Evaluated = Candidate & { label: string; source: Source; why: string; ms: number; window: [number, number]; notes: string[]; boxes?: Record<string, [number, number, number, number]> };

export type EvalContext = {
  plan: IntentPlan;
  compose: ComposeCtx;
  holds?: MeasureInput["holds"];
  /** Compositions and evaluations seen before, by hash (shared across rounds and moments). */
  cache?: EvalCache;
};
export type EvalCache = { compositions: Map<string, Composition>; results: Map<string, Omit<Evaluated, "id" | "label" | "source" | "why">>; limit: number };
export const newCache = (limit = 40): EvalCache => ({ compositions: new Map(), results: new Map(), limit });

export const LAYOUT = {
  name: "layout",
  describe:
    "The composer's own boxes on the moment's settled layout, as shares of the frame (camera crops are visibility's cut.<name>). Values: area.<plan name>, w.<plan name>, h.<plan name>, area.anchor, w.anchor, h.anchor (the subject, or the stage that holds it), stage (1 when a stage is on screen). No settings.",
  suggested: {},
};

const hash = (x: unknown) => createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 16);
export const designHash = (d: Design) => hash({ v: d.viewing, t: d.tempo, m: d.moments, demos: d.demos, o: d.overrides });

/** The design with moment k's design replaced. */
export const withMoment = (design: Design, md: MomentDesign): Design => ({ ...design, moments: design.moments.map((m) => (m.moment === md.moment ? md : m)) });

/** Moment k's window in frames: from its onset (its word less its lead) to the next moment's onset. */
export function windowOf(plan: IntentPlan, design: Design, words: Word[], k: number, frames: number): [number, number] {
  const fps = design.viewing.fps;
  const at = (n: number) => words[Math.min(Math.max(0, n), words.length - 1)]!.start;
  const onset = (j: number) => {
    const md = design.moments.find((m) => m.moment === j);
    return Math.max(0, Math.round((at(plan.moments[j]!.word) - (md?.lead.value ?? 0)) * fps));
  };
  const order = plan.moments.map((m, j) => ({ w: m.word, j })).sort((a, b) => a.w - b.w || a.j - b.j);
  const pos = order.findIndex((o) => o.j === k);
  const a = Math.min(onset(k), frames - 1);
  const next = order[pos + 1];
  const b = next ? Math.max(a + 1, Math.min(frames, onset(next.j))) : frames;
  return [a, b];
}

/**
 * Holds as the instruments read them (seconds), from the director's holds and the words. With the plan, each hold is
 * tied to the names of the moment it falls in (the latest moment whose word is at or before the hold's word): its
 * subject, what it keeps and acts on, and its question (ask@<word>), so timing reads what the silence is for.
 */
export function holdsFrom(holds: { id: string; afterWord: number; seconds: number }[], words: Word[], plan?: IntentPlan): { id: string; from: number; to: number; names?: string[] }[] {
  return holds.map((h) => {
    const w = words[Math.min(h.afterWord, words.length - 1)];
    const next = words[h.afterWord + 1];
    const from = w?.end ?? (next ? next.start - h.seconds : (w?.start ?? 0));
    const m = plan ? [...plan.moments].filter((x) => x.word <= h.afterWord).sort((a, b) => b.word - a.word)[0] : undefined;
    const names = m ? [...new Set([...idsOf(m), ...(m.ask ? [`ask@${m.word}`] : [])])] : [];
    return { id: h.id, from, to: from + h.seconds, ...(names.length ? { names } : {}) };
  });
}

/** The layout reading of moment k from a composition's boxes. */
export function layoutReading(c: Composition, plan: IntentPlan, k: number, _camera?: CameraPlan): Reading {
  const boxes = c.boxes.find((b) => b.moment === k)?.boxes ?? {};
  const values: Record<string, number> = {};
  const r = (x: number) => Math.round(x * 1000) / 1000;
  for (const [id, [x0, y0, x1, y1]] of Object.entries(boxes)) {
    values[`area.${id}`] = r(Math.max(0, x1 - x0) * Math.max(0, y1 - y0));
    values[`w.${id}`] = r(x1 - x0);
    values[`h.${id}`] = r(y1 - y0);
  }
  const m = plan.moments[k]!;
  const subj = m.reveal ?? m.show;
  const a = (subj && boxes[subj]) ?? boxes.stage;
  const notes: string[] = [];
  if (a) {
    values["area.anchor"] = r((a[2] - a[0]) * (a[3] - a[1]));
    values["w.anchor"] = r(a[2] - a[0]);
    values["h.anchor"] = r(a[3] - a[1]);
    notes.push(`the anchor (${subj && boxes[subj] ? subj : "the stage"}) covers ${Math.round(values["area.anchor"]! * 100)}% of the frame, ${Math.round(values["w.anchor"]! * 100)}% of its width and ${Math.round(values["h.anchor"]! * 100)}% of its height`);
  }
  if (boxes.stage) values.stage = 1;
  return { instrument: "layout", values, notes };
}

/**
 * Per plan name, the words of the moments that make it their subject or act on it (show, reveal, acts, becomes,
 * compare), and for a composer's name tied to a moment (ask@<word>, reading@<word>) that moment's word: what timing
 * uses as the thing's cue when the narration never says its name.
 */
export function cuesOf(plan: IntentPlan, names: string[] = []): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const add = (id: string | undefined, w: number) => {
    if (!id) return;
    const list = (out[id] ??= []);
    if (!list.includes(w)) list.push(w);
  };
  for (const m of plan.moments) {
    add(m.show, m.word);
    add(m.reveal, m.word);
    for (const a of m.acts) [...a.ids, a.to].forEach((id) => add(id, m.word));
    for (const b of m.becomes) add(b.id, m.word);
    for (const id of m.compare ?? []) add(id, m.word);
  }
  for (const n of names) {
    const at = /@(\d+)$/.exec(n);
    if (at && plan.moments.some((m) => m.word === Number(at[1]))) add(n, Number(at[1]));
  }
  for (const l of Object.values(out)) l.sort((x, y) => x - y);
  return out;
}

/** Goals grouped by instrument and settings: one measurement per group. */
function groupsOf(goals: Goal[]): Map<string, { instrument: string; settings?: Record<string, unknown>; goals: Goal[] }> {
  const out = new Map<string, { instrument: string; settings?: Record<string, unknown>; goals: Goal[] }>();
  for (const g of goals) {
    const key = `${g.instrument}|${JSON.stringify(g.settings ?? {})}`;
    if (!out.has(key)) out.set(key, { instrument: g.instrument, settings: g.settings, goals: [] });
    out.get(key)!.goals.push(g);
  }
  return out;
}

/**
 * Measures a composition's window for a set of goals and scores them: each goal is scored on the reading of its own
 * instrument with its own settings. Instruments that do not exist are reported, and their goals count as missed.
 */
export function measureGoals(c: Composition, plan: IntentPlan, k: number | undefined, goals: Goal[], input: Omit<MeasureInput, "scene" | "ids">, camera?: CameraPlan): { readings: Reading[]; scores: Candidate["scores"]; total: number; notes: string[] } {
  const notes: string[] = [];
  const readings: Reading[] = [];
  const scores: Candidate["scores"] = [];
  const full: MeasureInput = { ...input, scene: c.scene, ids: c.ids, cues: input.cues ?? cuesOf(plan, Object.keys(c.ids)) };
  for (const grp of groupsOf(goals).values()) {
    let reading: Reading | undefined;
    if (grp.instrument === "layout") reading = k === undefined ? undefined : layoutReading(c, plan, k, camera);
    else if (instruments[grp.instrument]) {
      try {
        reading = instruments[grp.instrument]!.measure(full, settingsFor(grp.instrument, full, grp.settings));
      } catch (e) {
        notes.push(`${grp.instrument} could not measure: ${(e as Error).message.slice(0, 120)}`);
      }
    } else notes.push(`no instrument "${grp.instrument}" (instruments: layout, ${Object.keys(instruments).join(", ")})`);
    if (reading) readings.push(grp.settings && Object.keys(grp.settings).length ? { ...reading, notes: [`settings ${JSON.stringify(grp.settings)}`, ...reading.notes] } : reading);
    for (const g of grp.goals) scores.push(reading ? scoreGoal(g, [reading]) : { goal: g.id, miss: 1 });
  }
  let w = 0;
  let s = 0;
  goals.forEach((g) => {
    const sc = scores.find((x) => x.goal === g.id)!;
    if (sc.applies === false) return;
    w += Math.max(0, g.weight);
    s += Math.max(0, g.weight) * sc.miss;
  });
  for (const g of goals) {
    const sc = scores.find((x) => x.goal === g.id);
    if (sc?.applies === false) notes.push(`goal ${g.id}: ${g.instrument} ${g.value} does not apply in this window; not counted here`);
    else if (sc?.value === undefined) notes.push(`goal ${g.id}: no reading "${g.value}" from ${g.instrument}`);
  }
  return { readings, scores, total: w > 0 ? s / w : 0, notes };
}

/** Composes a design, through the cache. */
export function composeCached(plan: IntentPlan, design: Design, ctx: EvalContext): Composition {
  const key = designHash(design);
  const hit = ctx.cache?.compositions.get(key);
  if (hit) return hit;
  const c = compose(plan, design, ctx.compose);
  if (ctx.cache) {
    ctx.cache.compositions.set(key, c);
    while (ctx.cache.compositions.size > ctx.cache.limit) ctx.cache.compositions.delete(ctx.cache.compositions.keys().next().value!);
  }
  return c;
}

/**
 * Every candidate of moment k composed into the whole design, measured on its window for `goals`, scored and ranked
 * (lowest total miss first; ties keep the order they were generated in, so the current design wins a tie).
 */
export function evaluate(design: Design, k: number, cands: Generated[], goals: Goal[], ctx: EvalContext): { ranked: Evaluated[]; ms: number; perCandidate: number } {
  const t0 = performance.now();
  const frames = ctx.compose.frames;
  const words = ctx.compose.words;
  let base: Composition | undefined;
  const out: Evaluated[] = [];
  for (const g of cands) {
    const t = performance.now();
    const d = withMoment(design, g.design);
    const window = windowOf(ctx.plan, d, words, k, frames);
    const key = hash({ d: designHash(d), goals, window, k });
    let r = ctx.cache?.results.get(key);
    if (!r) {
      const c = composeCached(ctx.plan, d, ctx);
      const m = measureGoals(c, ctx.plan, k, goals, { words, viewing: d.viewing, window, holds: ctx.holds }, g.design.camera.value);
      const notes = [...m.notes];
      // A stage shared by a stretch of moments moves for all of them: say which other moments this design changes.
      base ??= composeCached(ctx.plan, design, ctx);
      const moved = c.boxes.filter((b) => b.moment !== k && JSON.stringify(b.boxes) !== JSON.stringify(base!.boxes.find((x) => x.moment === b.moment)?.boxes)).map((b) => b.moment);
      if (moved.length) notes.push(`also changes the layout of moment${moved.length > 1 ? "s" : ""} ${moved.join(", ")} (they share the stage)`);
      r = { moment: k, design: g.design, readings: m.readings, scores: m.scores, total: m.total, ms: performance.now() - t, window, notes, boxes: c.boxes.find((b) => b.moment === k)?.boxes };
      ctx.cache?.results.set(key, r);
    }
    out.push({ ...r, id: g.id, label: g.label, source: g.source, why: g.why, design: g.design, ms: performance.now() - t });
  }
  const ranked = out.map((c, i) => ({ c, i })).sort((a, b) => a.c.total - b.c.total || a.i - b.i).map((x) => x.c);
  const ms = performance.now() - t0;
  return { ranked, ms, perCandidate: ms / Math.max(1, cands.length) };
}

/** A candidate's readings and scores as plain lines for an agent. */
export function candidateText(c: Evaluated, goals: Goal[]): string {
  const lines = [`${c.id} (${c.label}; ${c.source}): total miss ${c.total.toFixed(3)}`];
  for (const s of c.scores) {
    const g = goals.find((x) => x.id === s.goal);
    lines.push(s.applies === false ? `  ${s.goal}: ${g ? `${g.instrument} ${g.value}` : ""} does not apply here` : `  ${s.goal}: ${g ? `${g.instrument} ${g.value}` : ""} = ${s.value ?? "not measured"} (miss ${s.miss.toFixed(2)})`);
  }
  const fields = (["subjectScale", "subjectAt", "arrangement", "supportOpacity", "typeScale", "lead", "dwell", "camera"] as const).map((f) => `${f} ${JSON.stringify(c.design[f].value)}`);
  lines.push(`  design: ${fields.join("; ")}`);
  for (const n of c.notes) lines.push(`  note: ${n}`);
  return lines.join("\n");
}

export type { Viewing };
