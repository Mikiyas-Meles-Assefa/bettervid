// Candidates for one moment: designs of that moment to compose and measure. Two sources:
//   the designer's SearchSpace   per field, the values worth trying; sampled as a small factorial when it is small and
//                                as a Latin hypercube otherwise (every value of every field appears, never all combinations)
//   the engine's own generators  packer variants (the anchor as large as the usable frame allows, each arrangement the
//                                packer knows), a camera planner over the stretch of moments that share things (hold,
//                                push or cut to the subject, follow it, pull back after a push; no camera move while the
//                                moment's things change, and no view that leaves a changing thing outside it), and lead
//                                and dwell options read from the words around the moment
// Generators give options, not opinions: every value they produce is a geometric fact of the frame or a time read from
// the narration. Which option is good is the goals' and the designer's call. Effort follows importance: the per-video
// budget (Design.budget.candidatesPerMoment times the moments) is shared by the director's importance.
import { createHash } from "node:crypto";
import type { Theme } from "../../core/types.ts";
import { ARRANGEMENTS, usableRect } from "../compose/pack.ts";
import { Values } from "../compose/values.ts";
import { idsOf } from "../intent/parse.ts";
import type { CameraPlan, Decided, Design, IntentPlan, MomentDesign, Word } from "../types.ts";
import type { SearchSpace } from "../agents/api.ts";

export type Source = "current" | "space" | "packer" | "camera" | "timing" | "revise";
export type Generated = { id: string; label: string; source: Source; design: MomentDesign; why: string };
export type Boxes = { moment: number; boxes: Record<string, [number, number, number, number]> }[];
export type GenContext = { plan: IntentPlan; design: Design; words: Word[]; theme: Theme; /** The current composition's boxes per moment (fractions of the frame). */ boxes?: Boxes };

type Field = keyof SearchSpace;
const FIELDS: Field[] = ["subjectScale", "subjectAt", "arrangement", "supportOpacity", "typeScale", "lead", "dwell", "camera"];
const MOVES = new Set(["hold", "push", "drift", "cut", "follow"]);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const frac = (x: unknown) => isNum(x) && x >= 0 && x <= 1;

/** A value the designer offered for a field, checked and normalized; undefined (with the reason) when it cannot be used. */
export function fieldValue(field: Field, v: unknown, current: MomentDesign): { value?: unknown; problem?: string } {
  switch (field) {
    case "subjectScale":
    case "typeScale":
      return isNum(v) && v > 0 ? { value: v } : { problem: `${field} ${JSON.stringify(v)} is not a positive number` };
    case "supportOpacity":
      return frac(v) ? { value: v } : { problem: `supportOpacity ${JSON.stringify(v)} is not between 0 and 1` };
    case "lead":
      return isNum(v) ? { value: v } : { problem: `lead ${JSON.stringify(v)} is not a number of seconds` };
    case "dwell":
      return isNum(v) && v >= 0 ? { value: v } : { problem: `dwell ${JSON.stringify(v)} is not a number of seconds` };
    case "subjectAt":
      return Array.isArray(v) && v.length === 2 && v.every(frac) ? { value: [v[0], v[1]] } : { problem: `subjectAt ${JSON.stringify(v)} is not [x, y] in 0..1` };
    case "arrangement":
      return typeof v === "string" && v.trim() ? { value: v.trim() } : { problem: `arrangement ${JSON.stringify(v)} is not a word` };
    case "camera": {
      // A camera may be given in part ({"zoom": 1.3}): the rest is the moment's current camera.
      if (!v || typeof v !== "object" || Array.isArray(v)) return { problem: `camera ${JSON.stringify(v)} is not a camera plan` };
      const c = { ...current.camera.value, ...(v as Partial<CameraPlan>) };
      if (!isNum(c.zoom) || c.zoom <= 0 || !Array.isArray(c.at) || !c.at.every(frac) || !MOVES.has(c.move)) return { problem: `camera ${JSON.stringify(v)} needs zoom > 0, at [x, y] in 0..1 and a move (${[...MOVES].join(", ")})` };
      return { value: { zoom: c.zoom, at: [c.at[0], c.at[1]], move: c.move, ...(isNum(c.frames) ? { frames: c.frames } : {}) } };
    }
  }
}

const decided = <T>(value: T, why: string, from: Decided<T>["from"] = "search"): Decided<T> => ({ value, from, why });

/** The moment's design with some fields set, each marked as the search's with its reason. */
export function withFields(md: MomentDesign, set: Partial<Record<Field, unknown>>, why: string, from: Decided<unknown>["from"] = "search"): MomentDesign {
  const out: MomentDesign = { ...md };
  for (const [k, v] of Object.entries(set)) (out as Record<string, unknown>)[k] = decided(v, why, from);
  return out;
}

/** A design's search fields only, as a key: two candidates with the same key compose the same. */
export const fieldsKey = (md: MomentDesign) => JSON.stringify(FIELDS.map((f) => (md[f] as Decided<unknown> | undefined)?.value));

/** A seeded random generator (mulberry32), so a search repeats exactly and a resumed run asks the same questions. */
export function rng(seed: string): () => number {
  let a = createHash("sha1").update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Samples a SearchSpace: up to `n` value sets. When every combination fits in `n` they are all tried (a small
 * factorial); otherwise a Latin hypercube: each field's values are spread evenly over the samples in a shuffled order,
 * so every value of every field is tried about equally often and no two samples repeat.
 */
export function sampleSpace(current: MomentDesign, space: SearchSpace, n: number, seed: string): { sets: Partial<Record<Field, unknown>>[]; notes: string[] } {
  const notes: string[] = [];
  const axes: [Field, unknown[]][] = [];
  for (const f of FIELDS) {
    const raw = space[f];
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) {
      notes.push(`${f}: the space gives ${JSON.stringify(raw)}, not a list of values; not searched`);
      continue;
    }
    const vals: unknown[] = [];
    for (const v of raw) {
      const r = fieldValue(f, v, current);
      if (r.problem) notes.push(r.problem);
      else if (!vals.some((x) => JSON.stringify(x) === JSON.stringify(r.value))) vals.push(r.value);
    }
    if (vals.length) axes.push([f, vals]);
  }
  if (!axes.length || n <= 0) return { sets: [], notes };
  const total = axes.reduce((p, [, v]) => p * v.length, 1);
  const sets: Partial<Record<Field, unknown>>[] = [];
  if (total <= n) {
    const rec = (i: number, acc: Partial<Record<Field, unknown>>) => {
      if (i === axes.length) return void sets.push({ ...acc });
      for (const v of axes[i]![1]) rec(i + 1, { ...acc, [axes[i]![0]]: v });
    };
    rec(0, {});
    return { sets, notes };
  }
  const rand = rng(seed);
  const perms = axes.map(() => {
    const p = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j]!, p[i]!];
    }
    return p;
  });
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const s: Partial<Record<Field, unknown>> = {};
    axes.forEach(([f, vals], a) => (s[f] = vals[Math.floor(((perms[a]![i]! + 0.5) * vals.length) / n)]));
    const key = JSON.stringify(s);
    if (!seen.has(key)) (seen.add(key), sets.push(s));
  }
  notes.push(`space of ${total} combinations sampled as a Latin hypercube of ${sets.length}`);
  return { sets, notes };
}

/** How many candidates moment k gets: the per-video budget shared by importance (at least the current design and one more). */
export function budgetFor(design: Design, k: number): number {
  const ms = design.moments;
  const total = Math.max(ms.length, design.budget.candidatesPerMoment * ms.length);
  const sum = ms.reduce((s, m) => s + Math.max(0, m.importance.value), 0);
  const mine = ms.find((m) => m.moment === k)?.importance.value ?? 0;
  const share = sum > 0 ? (total * Math.max(0, mine)) / sum : design.budget.candidatesPerMoment;
  return Math.max(2, Math.round(share));
}

/** The stretch of moments around k that share things on screen (the stage persists across it). */
export function stretchOf(plan: IntentPlan, k: number): number[] {
  const shares = (a: number, b: number) => {
    const A = new Set(idsOf(plan.moments[a]!));
    return idsOf(plan.moments[b]!).some((x) => A.has(x));
  };
  let lo = k;
  let hi = k;
  while (lo > 0 && shares(lo - 1, lo)) lo--;
  while (hi < plan.moments.length - 1 && shares(hi, hi + 1)) hi++;
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

type Box = [number, number, number, number];
const union = (bs: Box[]): Box | undefined => (bs.length ? [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))] : undefined);

/** Where a box lands on screen under a camera plan (zoom about the fixed point `at`), in fractions of the frame. */
export function onScreen(b: Box, cam: Pick<CameraPlan, "zoom" | "at">): Box {
  const m = (v: number, p: number) => p + (v - p) * cam.zoom;
  return [m(b[0], cam.at[0]), m(b[1], cam.at[1]), m(b[2], cam.at[0]), m(b[3], cam.at[1])];
}
const inside = (b: Box, u: Box, tol = 1e-3) => b[0] >= u[0] - tol && b[1] >= u[1] - tol && b[2] <= u[2] + tol && b[3] <= u[3] + tol;

/**
 * The view that puts box b in the middle of the usable rect u, as large as `share` of the zoom that would fill u
 * (1 fills it). The fixed point solves p + (c - p) z = target for each axis; it is kept inside the frame, and the zoom
 * steps down until the box fits on screen. Pure geometry.
 */
export function viewOf(b: Box, u: Box, share = 1): Pick<CameraPlan, "zoom" | "at"> | undefined {
  const bw = b[2] - b[0];
  const bh = b[3] - b[1];
  if (bw <= 0 || bh <= 0) return undefined;
  const full = Math.min((u[2] - u[0]) / bw, (u[3] - u[1]) / bh);
  let z = Math.max(1, 1 + (full - 1) * share);
  const target = [(u[0] + u[2]) / 2, (u[1] + u[3]) / 2];
  const c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  for (let i = 0; i < 40 && z > 1 + 1e-3; i++) {
    const at = [0, 1].map((a) => Math.min(1, Math.max(0, (target[a]! - c[a]! * z) / (1 - z)))) as [number, number];
    const cam = { zoom: +z.toFixed(3), at: [+at[0].toFixed(3), +at[1].toFixed(3)] as [number, number] };
    if (inside(onScreen(b, cam), [0, 0, 1, 1])) return cam;
    z = 1 + (z - 1) * 0.9;
  }
  return undefined;
}

function idBox(boxes: Boxes | undefined, k: number, id: string | undefined, plan: IntentPlan): Box | undefined {
  if (!id || !boxes) return undefined;
  const b = boxes.find((x) => x.moment === k)?.boxes;
  if (!b) return undefined;
  if (b[id]) return b[id] as Box;
  const things = new Map(plan.things.map((t) => [t.id, t]));
  // Objects and the user's material stand on the stage: the stage's box holds them.
  const onStage = things.get(id)?.kind === "object" || things.get(id)?.kind === "material" || id.includes(".") || !things.has(id);
  return onStage && b.stage ? (b.stage as Box) : undefined;
}

/** What changes in moment k: the things its acts, becomes and reveal touch. */
export function changingIds(plan: IntentPlan, k: number): string[] {
  const m = plan.moments[k]!;
  return [...new Set([...m.acts.flatMap((a) => [...a.ids, ...(a.to ? [a.to] : [])]), ...m.becomes.map((b) => b.id), ...(m.reveal ? [m.reveal] : [])])];
}

/** Packer variants: the anchor as large as the usable frame allows, and each arrangement the packer knows. */
export function packerVariants(md: MomentDesign): { set: Partial<Record<Field, unknown>>; label: string; why: string }[] {
  const out: { set: Partial<Record<Field, unknown>>; label: string; why: string }[] = [];
  const fill = md.subjectScale.value < 1;
  if (fill) out.push({ set: { subjectScale: 1 }, label: "fill", why: "the anchor as large as the usable frame allows; the packer shrinks it until what must stay fits" });
  for (const a of ARRANGEMENTS) {
    if (a === md.arrangement.value) continue;
    out.push({ set: { arrangement: a }, label: a, why: `the support packed as ${a}` });
  }
  if (fill) for (const a of ARRANGEMENTS) if (a !== md.arrangement.value) out.push({ set: { arrangement: a, subjectScale: 1 }, label: `${a}+fill`, why: `the support packed as ${a}, the anchor as large as fits` });
  return out;
}

/**
 * Camera plans for moment k, read with the stretch it belongs to: hold the whole frame, push or cut to the subject
 * (filling the usable frame, or halfway there), follow it, and pull back to the whole frame after an earlier moment of
 * the stretch pushed in. Continuity: a view must keep every thing that changes in the moment on screen, and while things
 * change (the moment's acts) the camera does not move (a change during a move is easily missed).
 */
export function cameraPlans(k: number, ctx: GenContext): { set: Partial<Record<Field, unknown>>; label: string; why: string }[] {
  const { plan, design } = ctx;
  const m = plan.moments[k]!;
  const md = design.moments.find((x) => x.moment === k)!;
  const cur = md.camera.value;
  const V = new Values(design, ctx.theme);
  const v = design.viewing;
  const { rect } = usableRect(v, V.px("frame.margin", k));
  const U: Box = [rect.x0 / v.width, rect.y0 / v.height, rect.x1 / v.width, rect.y1 / v.height];
  const out: { set: Partial<Record<Field, unknown>>; label: string; why: string }[] = [];
  // At zoom 1 the fixed point changes nothing on screen: such views are the same view.
  const same = (a: CameraPlan, b: CameraPlan) => a.move === b.move && a.zoom === b.zoom && (a.zoom <= 1 + 1e-3 || JSON.stringify(a.at) === JSON.stringify(b.at));
  const add = (cam: CameraPlan, label: string, why: string) => {
    if (same(cam, cur)) return;
    if (out.some((o) => JSON.stringify(o.set.camera) === JSON.stringify(cam))) return;
    out.push({ set: { camera: cam }, label, why });
  };
  const stretch = stretchOf(plan, k);
  const pushedBefore = stretch.filter((j) => j < k).some((j) => (design.moments.find((x) => x.moment === j)?.camera.value.zoom ?? 1) > 1 + 1e-3);
  const wide: CameraPlan = { zoom: 1, at: cur.at, move: "hold" };
  add(wide, pushedBefore ? "pull back" : "hold wide", pushedBefore ? "an earlier moment of this stretch pushed in: the whole frame again, to recap" : "the whole frame, still");
  const subject = idBox(ctx.boxes, k, m.reveal ?? m.show, plan);
  const changing = changingIds(plan, k).map((id) => idBox(ctx.boxes, k, id, plan)).filter((b): b is Box => !!b);
  const target = union([...(subject ? [subject] : []), ...changing]);
  if (!target) return out;
  const moving = m.acts.length > 0;
  for (const [share, how] of [[1, "fills the usable frame"], [0.5, "halfway to filling it"]] as const) {
    const view = viewOf(target, U, share);
    if (!view || view.zoom <= 1 + 1e-3) continue;
    const keepAll = changing.every((b) => inside(onScreen(b, view), [0, 0, 1, 1]));
    if (!keepAll) continue;
    const name = share === 1 ? "close" : "closer";
    add({ ...view, move: "cut" }, `cut ${name}`, `a cut to the subject and what changes: it ${how}`);
    if (!moving) {
      add({ ...view, move: "push" }, `push ${name}`, `a push to the subject: it ${how} by the end of the moment`);
      add({ ...view, move: "follow" }, `follow ${name}`, `the camera follows to the subject: it ${how}`);
    }
  }
  return out;
}

/** Lead and dwell options read from the words: on the word, one word ahead, and a dwell that lasts until the next moment's word. */
export function timingOptions(k: number, ctx: GenContext): { set: Partial<Record<Field, unknown>>; label: string; why: string }[] {
  const { plan, words, design } = ctx;
  const md = design.moments.find((x) => x.moment === k)!;
  const m = plan.moments[k]!;
  const at = (n: number) => words[Math.min(Math.max(0, n), words.length - 1)]!.start;
  const out: { set: Partial<Record<Field, unknown>>; label: string; why: string }[] = [];
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const leads: [number, string, string][] = [[0, "on the word", "the change starts as its word starts"]];
  if (m.word > 0) leads.push([r2(at(m.word) - at(m.word - 1)), "a word ahead", "the change starts with the word before its own, so the eye arrives as the word is said"]);
  for (const [lead, label, why] of leads) if (Math.abs(lead - md.lead.value) > 0.02) out.push({ set: { lead }, label, why });
  const next = plan.moments[k + 1];
  if (next) {
    const gap = r2(at(next.word) - at(m.word));
    if (gap > 0 && Math.abs(gap - md.dwell.value) > 0.05) out.push({ set: { dwell: gap }, label: "dwell to next", why: `the moment holds until the next moment's word, ${gap} s later` });
  }
  return out;
}

/**
 * Every candidate for moment k within `n`: the current design first, then the designer's space and the engine's
 * generators taking turns (so both are tried), each distinct.
 */
export function generate(k: number, space: SearchSpace | undefined, n: number, ctx: GenContext, o: { seed?: string; generators?: boolean; base?: MomentDesign } = {}): { candidates: Generated[]; notes: string[] } {
  const md = o.base ?? ctx.design.moments.find((x) => x.moment === k);
  if (!md) throw new Error(`no MomentDesign for moment ${k}`);
  const notes: string[] = [];
  const seed = o.seed ?? `m${k}`;
  const cands: Generated[] = [{ id: `${seed}.c0`, label: "current", source: "current", design: md, why: "the design as it stands" }];
  const seen = new Set([fieldsKey(md)]);
  const push = (set: Partial<Record<Field, unknown>>, label: string, source: Source, why: string) => {
    if (cands.length >= n) return false;
    const d = withFields(md, set, why);
    const key = fieldsKey(d);
    if (seen.has(key)) return true;
    seen.add(key);
    cands.push({ id: `${seed}.c${cands.length}`, label, source, design: d, why });
    return true;
  };
  const sp = sampleSpace(md, space ?? {}, Math.max(0, n - 1), `${seed}.space`);
  notes.push(...sp.notes);
  const gens = o.generators === false ? [] : [...packerVariants(md).map((g) => ({ ...g, source: "packer" as const })), ...cameraPlans(k, { ...ctx, design: { ...ctx.design, moments: ctx.design.moments.map((x) => (x.moment === k ? md : x)) } }).map((g) => ({ ...g, source: "camera" as const })), ...timingOptions(k, ctx).map((g) => ({ ...g, source: "timing" as const }))];
  // Generators by kind take turns too, so a small budget still tries a layout, a camera and a timing.
  const byKind = ["packer", "camera", "timing"].map((s) => gens.filter((g) => g.source === s));
  const genOrder: typeof gens = [];
  for (let i = 0; byKind.some((l) => l.length > i); i++) for (const l of byKind) if (l[i]) genOrder.push(l[i]!);
  const label = (s: Partial<Record<Field, unknown>>) => Object.entries(s).map(([f, v]) => `${f} ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
  let i = 0;
  let j = 0;
  while (cands.length < n && (i < sp.sets.length || j < genOrder.length)) {
    if (i < sp.sets.length) (push(sp.sets[i]!, label(sp.sets[i]!), "space", "from the designer's search space"), i++);
    if (cands.length < n && j < genOrder.length) (push(genOrder[j]!.set, genOrder[j]!.label, genOrder[j]!.source, genOrder[j]!.why), j++);
  }
  if (i < sp.sets.length || j < genOrder.length) notes.push(`budget ${n}: ${sp.sets.length - i} space samples and ${genOrder.length - j} generated options left untried`);
  return { candidates: cands, notes };
}
