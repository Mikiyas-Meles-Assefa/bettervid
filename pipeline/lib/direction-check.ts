// Checking that a finished video did what its direction asked (research/teaching-tempo.md, "Review"), mostly by
// measuring rather than looking. S14 found Spark sees only about half of what is wrong in a frame, so every check that
// can be answered from the compiled scene or the narration audio is answered there:
// - Scene data: the scene is evaluated frame by frame, without rendering, and each thing on screen is marked as moving
//   or changing (position, size, fade, color, light) or still. From that: is the event's `look` the thing that changes,
//   and how many other things change beside it (S13's `competing`); is a withheld thing on screen before its moment;
//   does the rate of change vary across the video rather than sit flat (Cutting's 1/f finding); does the picture keep
//   working through each hold with nothing unrelated pulling the eye; does a slow demo phase go one step at a time at a
//   readable rate, and does a fast phase come to rest on its finished state.
// - Audio: is each hold really a silence of about its length (ffmpeg silencedetect on the voice alone, as S6).
// - Models: one cheap text call maps each event's `look`, `withhold` and `demo` to the scene's ids, since those are
//   written in words before any scene exists. One optional vision call asks whether the opening shows the `promise`.
// Every finding is a ticket naming its event, with numbers, routed to the stage that can act on it.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Resolved, Scene } from "../../engine/core/types.ts";
import { evaluate } from "../../engine/core/evaluate.ts";
import { KITS } from "../../engine/kits/index.ts";
import { attachedId } from "../../engine/language/build.ts";
import { parse, type Item } from "../../engine/language/syntax.ts";
import type { DirectionEvent, DirectionPlan, Narration, Project, Word } from "../../schemas/project.ts";
import { json } from "./meta.ts";
import { dir, prompt } from "./project.ts";
import { hash } from "./util.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Sampling the scene: what is visible and what is changing, per thing, per frame.

// A thing is a top-level part of the compiled scene (a box with its label, a line of words, a mark). Parts whose ids
// extend another top-level id ("arrow.head" of "arrow") belong to it.
export type Samples = {
  fps: number;
  frames: number;
  ids: string[];
  visible: Uint8Array[]; // per thing, per frame: 1 when any of it shows
  active: Uint8Array[]; // per thing, per frame: 1 when it moves, grows, fades, changes color or lights
  text: Map<string, string>; // the words a thing carries, for naming it
};

// What counts as a change between two frames `GAP` apart. Below these a viewer does not see anything happen: a drift of
// under 15 px a second, a fade of under 2 percent.
const GAP = 2;
const TOL: Record<string, number> = { x: 1, y: 1, scaleX: 0.004, scaleY: 0.004, rotate: 0.3, size: 0.5, strokeWidth: 0.15, glowLevel: 0.02, pulse: 0.02, drawn: 0.01, trimStart: 0.01, trimEnd: 0.01, brightness: 0.01, blur: 0.2, glow: 0.02, fillOpacity: 0.02, strokeOpacity: 0.02 };
const NUMS = Object.keys(TOL);
const STRS = ["color", "fill", "stroke", "text", "weight", "src"];
type Sig = { o: number; n: number[]; s: string };

function signatures(list: Resolved[]): Map<string, Map<string, Sig>> {
  const out = new Map<string, Map<string, Sig>>();
  const walk = (nodes: Resolved[], unit: string, opacity: number, into: Map<string, Sig>) => {
    for (const r of nodes) {
      const a = r.props;
      const o = opacity * (typeof a.opacity === "number" ? a.opacity : 1);
      const pts = Array.isArray(a.points) ? (a.points as number[]) : [];
      const shape = pts.length ? `${pts.length}:${Math.round(pts.reduce((s, v, i) => s + v * ((i % 7) + 1), 0))}` : "";
      into.set(r.id, { o, n: NUMS.map((k) => (typeof a[k] === "number" ? (a[k] as number) : NaN)), s: `${STRS.map((k) => String(a[k] ?? "")).join("|")}|${shape}` });
      walk(r.children, unit, o, into);
    }
  };
  for (const r of list) {
    const into = new Map<string, Sig>();
    walk([r], r.id, 1, into);
    out.set(r.id, into);
  }
  return out;
}

const shows = (m: Map<string, Sig> | undefined) => !!m && [...m.values()].some((x) => x.o > 0.05);

function changed(a: Map<string, Sig> | undefined, b: Map<string, Sig> | undefined): boolean {
  if (!shows(a) && !shows(b)) return false;
  if (!a || !b) return true;
  for (const [id, x] of b) {
    const y = a.get(id);
    if (!y) {
      if (x.o > 0.05) return true;
      continue;
    }
    if (x.o <= 0.05 && y.o <= 0.05) continue;
    if (Math.abs(x.o - y.o) > 0.015) return true;
    if (x.s !== y.s) return true;
    for (let i = 0; i < NUMS.length; i++) {
      const [u, v] = [x.n[i]!, y.n[i]!];
      if (Number.isNaN(u) !== Number.isNaN(v) || (!Number.isNaN(u) && Math.abs(u - v) > TOL[NUMS[i]!]!)) return true;
    }
  }
  return false;
}

// Evaluates every frame once (well under a millisecond each), so a three minute video takes about a second.
export function sample(scene: Scene): Samples {
  const frames = scene.frames;
  const top = new Set(scene.nodes.filter((n) => !n.parent).map((n) => n.id));
  // A top-level part whose id extends another top-level id belongs to it.
  const unitOf = (id: string) => {
    const parts = id.split(".");
    for (let k = 1; k < parts.length; k++) {
      const head = parts.slice(0, k).join(".");
      if (top.has(head)) return head;
    }
    return id;
  };
  const ids = [...new Set([...top].map(unitOf))];
  const index = new Map(ids.map((id, i) => [id, i]));
  const visible = ids.map(() => new Uint8Array(frames));
  const active = ids.map(() => new Uint8Array(frames));
  const text = new Map<string, string>();
  const parent = new Map(scene.nodes.map((n) => [n.id, n.parent]));
  for (const n of scene.nodes) {
    if (n.kind !== "text" || typeof n.props.text !== "string") continue;
    let root = n.id;
    for (let p = n.parent; p; p = parent.get(p)) root = p;
    const u = unitOf(root);
    text.set(u, `${text.get(u) ?? ""} ${n.props.text}`.trim());
  }
  const history: Map<string, Map<string, Sig>>[] = [];
  for (let f = 0; f < frames; f++) {
    const raw = signatures(evaluate(scene, f));
    const now = new Map<string, Map<string, Sig>>();
    for (const [id, m] of raw) {
      const u = unitOf(id);
      const into = now.get(u) ?? new Map<string, Sig>();
      for (const [k, v] of m) into.set(k, v);
      now.set(u, into);
    }
    history.push(now);
    const before = history[f - GAP];
    for (const [u, i] of index) {
      if (shows(now.get(u))) visible[i]![f] = 1;
      if (before && changed(before.get(u), now.get(u))) active[i]![f] = 1;
    }
    if (f >= GAP) history[f - GAP] = undefined as never; // only the last few frames are needed
  }
  return { fps: scene.fps, frames, ids, visible, active, text };
}

// Marks, tags and arrows name what they are attached to, from the scene's source.
export function attachments(source: string, kitKinds: string[] = []): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const { doc } = parse(source, kitKinds);
  for (const s of doc.states) {
    for (const c of s.commands) {
      const id = attachedId(c);
      if (!id) continue;
      const on = c.do === "arrow" ? [c.from, c.to] : c.do === "mark" ? c.targets.flatMap((t) => t.split(",")) : c.do === "tag" ? [c.target] : [];
      out.set(id, [...new Set([...(out.get(id) ?? []), ...on])]);
    }
  }
  return out;
}

// Containers in the source (rows, stacks) are not parts of the compiled scene; a name for one means what it holds.
export function members(source: string, kitKinds: string[] = []): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const walk = (items: Item[]): string[] =>
    items.flatMap((i) => {
      const inner = walk(i.children);
      if (inner.length) out.set(i.id, new Set([...(out.get(i.id) ?? []), ...inner]));
      return [i.id, ...inner];
    });
  for (const s of parse(source, kitKinds).doc.states) walk(s.items);
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}

// Whether a thing belongs to one of the named ids: it is one, a part of one, or a mark, tag or arrow on one.
export function belongs(unit: string, named: string[], attached: Map<string, string[]> = new Map()): boolean {
  return named.some((m) => unit === m || unit.startsWith(`${m}.`) || unit.endsWith(`.${m}`) || (attached.get(unit) ?? []).some((t) => t === m || t.startsWith(`${m}.`)));
}

// ---------------------------------------------------------------------------------------------------------------------
// Time: events, holds and demo phases as frame ranges.

export type Hold = { id: string; event: string; afterWord: number; seconds: number; purpose: string; does: string; start: number; end: number; voiced: boolean };
export type Span = { event: DirectionEvent; from: number; to: number }; // frames, `to` exclusive

const at = (words: Word[], i: number) => words[Math.max(0, Math.min(i, words.length - 1))]!;

// An event runs from its first word to the next event's first word, so holds and gaps inside it belong to it.
export function spans(plan: DirectionPlan, words: Word[], fps: number, total: number): Span[] {
  const events = [...plan.events].sort((a, b) => a.firstWord - b.firstWord);
  return events.map((event, i) => ({
    event,
    from: i ? Math.round(at(words, event.firstWord).start * fps) : 0,
    to: events[i + 1] ? Math.round(at(words, events[i + 1]!.firstWord).start * fps) : total,
  }));
}

// Every hold the plan asks for, placed where the voice left it, or where it should have been when the voice did not.
export function holds(plan: DirectionPlan, narration: Pick<Narration, "words" | "holds">): Hold[] {
  const left = new Map((narration.holds ?? []).map((h) => [h.id, h]));
  return plan.events.flatMap((e) =>
    (e.holds ?? []).map((h) => {
      const v = left.get(h.id);
      const start = v ? v.start : at(narration.words, h.afterWord).end;
      return { id: h.id, event: e.id, afterWord: h.afterWord, seconds: h.seconds, purpose: h.purpose, does: h.does, start, end: start + (v ? v.seconds : h.seconds), voiced: !!v };
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Tickets.

export type Route = "scene" | "voice" | "direction";
export type Kind = "look_absent" | "look_still" | "competing" | "withheld_early" | "flat_rhythm" | "rhythm_mismatch" | "hold_frozen" | "hold_competing" | "hold_missing" | "hold_short" | "demo_rushed" | "demo_still" | "demo_unsettled" | "promise_missing";
export type Ticket = { event: string; kind: Kind; route: Route; severity: 1 | 2 | 3; from: number; to: number; note: string };

// Who can act on each kind. The scene stage fixes what the picture does in a stretch of words; the voice stage fixes
// silences; the direction stage fixes the plan itself (a rhythm it never varied, a hold too short to do its job).
export const ROUTE: Record<Kind, Route> = {
  look_absent: "scene", look_still: "scene", competing: "scene", withheld_early: "scene", flat_rhythm: "scene", rhythm_mismatch: "scene",
  hold_frozen: "scene", hold_competing: "scene", hold_missing: "voice", hold_short: "voice", demo_rushed: "scene", demo_still: "scene", demo_unsettled: "scene", promise_missing: "scene",
};

const sec = (frames: number, fps: number) => `${(frames / fps).toFixed(1)} s`;
const ticket = (t: Omit<Ticket, "route"> & { route?: Route }): Ticket => ({ route: ROUTE[t.kind], ...t });
const name = (s: Samples, id: string) => (s.text.get(id) ? `${id} ("${s.text.get(id)!.slice(0, 32)}")` : id);
const count = (bits: Uint8Array, from: number, to: number) => {
  let n = 0;
  for (let f = Math.max(0, from); f < Math.min(bits.length, to); f++) n += bits[f]!;
  return n;
};

// What changes in a stretch, per thing, in frames, most first.
export function activity(s: Samples, from: number, to: number): { id: string; frames: number }[] {
  return s.ids.map((id, i) => ({ id, frames: count(s.active[i]!, from, to) })).filter((x) => x.frames > 0).sort((a, b) => b.frames - a.frames);
}

// Moments something starts to change, merged across things that start together into one beat (a step of the picture).
export function beats(s: Samples, from: number, to: number, only?: (id: string) => boolean): number[] {
  const starts: number[] = [];
  s.ids.forEach((id, i) => {
    if (only && !only(id)) return;
    const a = s.active[i]!;
    for (let f = Math.max(1, from); f < Math.min(s.frames, to); f++) if (a[f] && !a[f - 1]) starts.push(f);
  });
  starts.sort((a, b) => a - b);
  const merge = Math.round(s.fps * 0.17);
  const out: number[] = [];
  for (const f of starts) if (!out.length || f - out.at(-1)! > merge) out.push(f);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The checks. Each is pure: samples, spans and the id map in, tickets and numbers out.

export type IdMap = { events: Record<string, { look: string[]; withhold: string[]; demo: string[] }>; promise: string[] };

// A thing that pulls the eye for less than this, in a stretch, is a passing change (an entrance), not competition.
const PULL = 0.2;

// During each event: is the look the thing that changes, and how many other things change beside it.
export function checkLook(s: Samples, list: Span[], ids: IdMap, attached: Map<string, string[]>): { tickets: Ticket[]; rows: { event: string; share: number; competing: number }[] } {
  const tickets: Ticket[] = [];
  const rows: { event: string; share: number; competing: number }[] = [];
  for (const { event, from, to } of list) {
    const look = ids.events[event.id]?.look ?? [];
    const mine = (id: string) => belongs(id, look, attached);
    const seen = s.ids.some((id, i) => mine(id) && count(s.visible[i]!, from, to) > 0);
    const act = activity(s, from, to);
    const lookFrames = act.filter((x) => mine(x.id)).reduce((n, x) => n + x.frames, 0);
    const others = act.filter((x) => !mine(x.id) && x.frames >= s.fps * PULL);
    const otherFrames = others.reduce((n, x) => n + x.frames, 0);
    const share = lookFrames + otherFrames ? lookFrames / (lookFrames + otherFrames) : 1;
    rows.push({ event: event.id, share, competing: others.length });
    const where = { event: event.id, from: from / s.fps, to: to / s.fps };
    const list3 = others.slice(0, 5).map((x) => `${name(s, x.id)} for ${sec(x.frames, s.fps)}`).join(", ");
    if (!look.length || !seen) {
      tickets.push(ticket({ ...where, kind: "look_absent", severity: 2, note: `The eye should be on "${event.look}", but ${look.length ? `${look.join(", ")} never shows` : "nothing in the scene matches it"} during ${event.id} (${where.from.toFixed(1)} to ${where.to.toFixed(1)} s, "${event.job}").` }));
      continue;
    }
    if (!lookFrames && otherFrames >= s.fps) {
      tickets.push(ticket({ ...where, kind: "look_still", severity: 2, note: `The eye should be on "${event.look}" (${look.join(", ")}), which is on screen but never moves or lights during ${event.id} (${where.from.toFixed(1)} to ${where.to.toFixed(1)} s), while other things change: ${list3}.` }));
    } else if (others.length >= 2 && share < 0.4) {
      tickets.push(ticket({ ...where, kind: "competing", severity: others.length >= 4 && share < 0.25 ? 3 : 2, note: `During ${event.id} (${where.from.toFixed(1)} to ${where.to.toFixed(1)} s) the eye should be on "${event.look}" (${look.join(", ")}), but only ${Math.round(share * 100)}% of the change on screen is there; ${others.length} other things pull at it: ${list3}.` }));
    }
  }
  return { tickets, rows };
}

// Nothing withheld may be on screen before the event it is withheld until.
export function checkWithhold(s: Samples, list: Span[], ids: IdMap, attached: Map<string, string[]>): Ticket[] {
  const out: Ticket[] = [];
  const startOf = new Map(list.map((x) => [x.event.id, x.from]));
  for (const { event } of list) {
    if (!event.withhold) continue;
    const until = startOf.get(event.withhold.until);
    const named = ids.events[event.id]?.withhold ?? [];
    if (until === undefined || !named.length) continue;
    const early = s.ids.flatMap((id, i) => {
      if (!belongs(id, named, attached)) return [];
      const first = s.visible[i]!.indexOf(1);
      return first >= 0 && first < until ? [{ id, first }] : [];
    }).sort((a, b) => a.first - b.first);
    if (!early.length) continue;
    const firstAt = early[0]!.first;
    out.push(ticket({ event: event.id, kind: "withheld_early", severity: 3, from: firstAt / s.fps, to: until / s.fps, note: `"${event.withhold.what}" is withheld until ${event.withhold.until} (${sec(until, s.fps)}), but ${early.slice(0, 4).map((x) => `${name(s, x.id)} shows from ${sec(x.first, s.fps)}`).join(", ")}.` }));
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const cv = (xs: number[]) => {
  const m = mean(xs);
  return m ? Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / m : 0;
};

// The rate of change should vary across the video, and long events should be calmer than short ones. Rates are beats
// (steps of the picture) per second. The flat line is a judgement call: below 0.25 the busiest event changes at most
// about twice as fast as the calmest, which is what a uniform rate looks like once a few entrances are counted.
export const FLAT = 0.25;
export function checkTempo(s: Samples, list: Span[]): { tickets: Ticket[]; rates: { event: string; rate: number; rhythm: string }[]; cv: number; gapsCv: number } {
  const rates = list.map(({ event, from, to }) => ({ event: event.id, rhythm: event.rhythm, rate: beats(s, from, to).length / Math.max(0.5, (to - from) / s.fps) }));
  const all = beats(s, 0, s.frames);
  const gaps = all.slice(1).map((f, i) => (f - all[i]!) / s.fps);
  const spread = cv(rates.map((r) => r.rate));
  const tickets: Ticket[] = [];
  const end = list.at(-1)?.to ?? s.frames;
  if (list.length >= 4 && spread < FLAT) {
    const varied = new Set(list.map((x) => x.event.rhythm)).size > 1;
    tickets.push(ticket({ event: list.map((x) => x.event.id).join(","), kind: "flat_rhythm", route: varied ? "scene" : "direction", severity: 2, from: 0, to: end / s.fps, note: `The picture changes at nearly the same rate all through (${rates.map((r) => `${r.event} ${r.rate.toFixed(2)}`).join(", ")} steps a second; spread ${spread.toFixed(2)}). ${varied ? "The plan mixes long and short events, but the scene does not." : "The plan gives every event the same rhythm."}` }));
  }
  const long = rates.filter((r) => r.rhythm === "long");
  const short = rates.filter((r) => r.rhythm === "short");
  if (long.length && short.length) {
    const quick = mean(short.map((r) => r.rate));
    for (const r of long.filter((x) => x.rate > quick * 1.1)) {
      const sp = list.find((x) => x.event.id === r.event)!;
      tickets.push(ticket({ event: r.event, kind: "rhythm_mismatch", severity: 1, from: sp.from / s.fps, to: sp.to / s.fps, note: `${r.event} is meant to be held (long), but it changes ${r.rate.toFixed(2)} times a second, more than the quick events average (${quick.toFixed(2)}).` }));
    }
  }
  return { tickets, rates, cv: spread, gapsCv: cv(gaps) };
}

// During each hold the picture keeps working (a frozen frame is an empty pause, Merkt 2018), and nothing unrelated to
// what the event is about pulls at the eye.
export function checkHoldPictures(s: Samples, hs: Hold[], list: Span[], ids: IdMap, attached: Map<string, string[]>): Ticket[] {
  const out: Ticket[] = [];
  for (const h of hs) {
    const [from, to] = [Math.round(h.start * s.fps), Math.round(h.end * s.fps)];
    if (to <= from) continue;
    const act = activity(s, from, to);
    const look = ids.events[h.event]?.look ?? [];
    const demo = ids.events[h.event]?.demo ?? [];
    const related = (id: string) => belongs(id, [...look, ...demo], attached);
    const where = { event: h.event, from: h.start, to: h.end };
    if (!act.length) {
      out.push(ticket({ ...where, kind: "hold_frozen", severity: h.seconds >= 2 ? 3 : 2, note: `Hold ${h.id} (${h.purpose}, ${h.seconds.toFixed(1)} s after word ${h.afterWord}) should show: "${h.does}". Nothing on screen changes from ${h.start.toFixed(1)} to ${h.end.toFixed(1)} s: a frozen frame.` }));
      continue;
    }
    const others = act.filter((x) => !related(x.id) && x.frames >= s.fps * PULL);
    const mineFrames = act.filter((x) => related(x.id)).reduce((n, x) => n + x.frames, 0);
    const otherFrames = others.reduce((n, x) => n + x.frames, 0);
    if (look.length && others.length && otherFrames > mineFrames) {
      out.push(ticket({ ...where, kind: "hold_competing", severity: 2, note: `During hold ${h.id} (${h.start.toFixed(1)} to ${h.end.toFixed(1)} s, "${h.does}") the change is mostly away from the event's look (${look.join(", ")}): ${others.slice(0, 4).map((x) => `${name(s, x.id)} for ${sec(x.frames, s.fps)}`).join(", ")}.` }));
    }
  }
  return out;
}

// Each hold is a real silence of about its length. A hold counts as kept when the voice is silent for all but a quarter
// second of it, or for 85 percent of a long one.
export function checkHoldAudio(hs: Hold[], quiet: { start: number; end: number }[]): { tickets: Ticket[]; rows: { id: string; asked: number; silent: number; voiced: boolean }[] } {
  const tickets: Ticket[] = [];
  const rows = hs.map((h) => {
    const silent = quiet.reduce((n, q) => n + Math.max(0, Math.min(q.end, h.end) - Math.max(q.start, h.start)), 0);
    return { id: h.id, asked: h.seconds, silent, voiced: h.voiced, h };
  });
  for (const r of rows) {
    const ok = r.asked - r.silent <= 0.25 || r.silent >= r.asked * 0.85;
    if (ok) continue;
    const where = { event: r.h.event, from: r.h.start, to: r.h.end };
    if (!r.voiced) tickets.push(ticket({ ...where, kind: "hold_missing", severity: 3, note: `Hold ${r.id} asks for ${r.asked.toFixed(1)} s of silence after word ${r.h.afterWord}, but the voice did not leave it: only ${r.silent.toFixed(2)} s of silence there.` }));
    else tickets.push(ticket({ ...where, kind: "hold_short", severity: r.silent < r.asked * 0.5 ? 3 : 2, note: `Hold ${r.id} should be ${r.asked.toFixed(1)} s of silence from ${r.h.start.toFixed(1)} s, but the voice is silent for only ${r.silent.toFixed(2)} s of it.` }));
  }
  return { tickets, rows: rows.map(({ h: _h, ...r }) => r) };
}

// A slow phase advances one step at a time with time to see each (about a second a step at least, Tversky's
// apprehension); a fast phase may run as fast as it likes but must come to rest on the finished state.
export const SLOW_STEP = 1.0;
export function checkDemo(s: Samples, list: Span[], hs: Hold[], words: Word[], ids: IdMap, attached: Map<string, string[]>): { tickets: Ticket[]; rows: { event: string; phase: number; pace: string; seconds: number; beats: number; steps?: number; settled?: number }[] } {
  const tickets: Ticket[] = [];
  const rows: { event: string; phase: number; pace: string; seconds: number; beats: number; steps?: number; settled?: number }[] = [];
  const byId = new Map(hs.map((h) => [h.id, h]));
  const when = (m: { word: number } | { hold: string }, end: boolean): number | undefined => {
    if ("word" in m) return (end ? at(words, m.word).end : at(words, m.word).start) * s.fps;
    const h = byId.get(m.hold);
    return h ? (end ? h.end : h.start) * s.fps : undefined;
  };
  for (const sp of list) {
    const demo = sp.event.demo;
    if (!demo?.phases.length) continue;
    const named = ids.events[sp.event.id]?.demo ?? [];
    const look = ids.events[sp.event.id]?.look ?? [];
    const only = named.length || look.length ? (id: string) => belongs(id, named.length ? named : look, attached) : undefined;
    demo.phases.forEach((ph, k) => {
      const a = when(ph.at, false);
      const next = demo.phases[k + 1];
      const b = ph.until ? when(ph.until, true) : next ? when(next.at, false) : sp.to;
      if (a === undefined || b === undefined || b <= a) return;
      const [from, to] = [Math.round(a), Math.round(b)];
      const seconds = (to - from) / s.fps;
      const bs = beats(s, from, to, only);
      const steps = ph.steps ? ph.steps[1] - ph.steps[0] + 1 : undefined;
      const row: (typeof rows)[number] = { event: sp.event.id, phase: k + 1, pace: ph.pace, seconds, beats: bs.length, steps };
      rows.push(row);
      const where = { event: sp.event.id, from: from / s.fps, to: to / s.fps };
      const label = `phase ${k + 1} of ${sp.event.id}'s demo (${ph.pace}${ph.steps ? `, steps ${ph.steps[0]} to ${ph.steps[1]}` : ""}, ${where.from.toFixed(1)} to ${where.to.toFixed(1)} s)`;
      if (!bs.length) {
        tickets.push(ticket({ ...where, kind: "demo_still", severity: 2, note: `Nothing in "${demo.what}" changes during ${label}.` }));
        return;
      }
      if (ph.pace === "slow") {
        const gaps = bs.slice(1).map((f, i) => (f - bs[i]!) / s.fps).sort((x, y) => x - y);
        const median = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : seconds;
        const perStep = steps ? seconds / steps : median;
        if (perStep < SLOW_STEP || median < SLOW_STEP * 0.7) {
          tickets.push(ticket({ ...where, kind: "demo_rushed", severity: 2, note: `${label[0]!.toUpperCase()}${label.slice(1)} should go one step at a time, but ${steps ? `${steps} steps get ${perStep.toFixed(2)} s each` : `the picture steps every ${median.toFixed(2)} s`} (${bs.length} changes, the closest ${gaps[0]?.toFixed(2) ?? "n/a"} s apart). A slow step needs about ${SLOW_STEP.toFixed(1)} s to be seen.` }));
        }
      }
      if (ph.pace === "fast" || k === demo.phases.length - 1) {
        // Settled: how long the demo holds still around the end of the phase, measured from its last change.
        const last = (() => {
          for (let f = Math.min(s.frames, to + Math.round(s.fps * 0.5)) - 1; f >= from; f--) if (s.ids.some((id, i) => (!only || only(id)) && s.active[i]![f])) return f;
          return from;
        })();
        const settled = (to - last) / s.fps;
        row.settled = settled;
        if (settled < 0.4) tickets.push(ticket({ ...where, kind: "demo_unsettled", severity: 2, note: `${label[0]!.toUpperCase()}${label.slice(1)} should end on the finished state, but "${demo.what}" is still changing at ${(last / s.fps).toFixed(1)} s, ${settled <= 0 ? "past the end of the phase" : `${settled.toFixed(2)} s before it ends`}; it never rests on the result.` }));
      }
    });
  }
  return { tickets, rows };
}

// The promise should be on screen in the first seconds. From the scene alone: does anything the promise names show by then.
export const OPENING = 3;
export function checkPromise(s: Samples, plan: DirectionPlan, ids: IdMap, attached: Map<string, string[]>, first: string): Ticket | undefined {
  const end = Math.round(OPENING * s.fps);
  if (!ids.promise.length) return ticket({ event: first, kind: "promise_missing", severity: 2, from: 0, to: OPENING, note: `The opening should confirm "${plan.promise}", but nothing in the scene matches it.` });
  const seen = s.ids.some((id, i) => belongs(id, ids.promise, attached) && count(s.visible[i]!, 0, end) > 0);
  return seen ? undefined : ticket({ event: first, kind: "promise_missing", severity: 2, from: 0, to: OPENING, note: `The opening should confirm "${plan.promise}" (${ids.promise.join(", ")}), but none of it is on screen in the first ${OPENING} s.` });
}

// ---------------------------------------------------------------------------------------------------------------------
// Audio.

// Silences in the voice alone. Narration from TTS is near digital silence between phrases, so -40 dB is safe.
// ffmpeg writes what silencedetect finds to stderr.
export function silences(file: string, noise = -40, min = 0.15): { start: number; end: number }[] {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=noise=${noise}dB:d=${min}`, "-f", "null", "-"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`silencedetect failed on ${file}: ${String(r.stderr).slice(-300)}`);
  return parseSilences(r.stderr);
}
export function parseSilences(log: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let open: number | undefined;
  for (const line of log.split("\n")) {
    const a = /silence_start: (-?[\d.]+)/.exec(line);
    const b = /silence_end: (-?[\d.]+)/.exec(line);
    if (a) open = Math.max(0, Number(a[1]));
    if (b && open !== undefined) {
      out.push({ start: open, end: Number(b[1]) });
      open = undefined;
    }
  }
  if (open !== undefined) out.push({ start: open, end: Infinity });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The id map: one cheap text call. The plan names things in words; the scene has ids. Spark sees, per event, the
// things on screen during it (with their words and what marks point at), and picks the ids for each phrase.

export type Catalogue = { id: string; words: string; on: string[]; shown: [number, number] | null }[];

export function catalogue(s: Samples, attached: Map<string, string[]>): Catalogue {
  return s.ids.map((id, i) => {
    const v = s.visible[i]!;
    const first = v.indexOf(1);
    return { id, words: (s.text.get(id) ?? "").slice(0, 60), on: attached.get(id) ?? [], shown: first < 0 ? null : [first / s.fps, v.lastIndexOf(1) / s.fps] as [number, number] };
  }).filter((x) => x.shown);
}

export function mapRequest(plan: DirectionPlan, list: Span[], s: Samples, cat: Catalogue): string {
  const describe = (c: Catalogue[number]) => `${c.id}${c.words ? ` "${c.words}"` : ""}${c.on.length ? ` (marks ${c.on.join(", ")})` : ""}, on screen ${c.shown![0].toFixed(1)} to ${c.shown![1].toFixed(1)} s`;
  const events = list.map(({ event, from, to }) => {
    const here = cat.filter((c) => c.shown![0] * s.fps < to && c.shown![1] * s.fps >= from).map((c) => c.id);
    return [
      `Event ${event.id}, ${(from / s.fps).toFixed(1)} to ${(to / s.fps).toFixed(1)} s. Job: ${event.job}`,
      `  look: ${event.look}`,
      event.withhold ? `  withhold: ${event.withhold.what}` : "",
      event.demo ? `  demo: ${event.demo.what}` : "",
      `  on screen during it: ${here.join(", ") || "(nothing)"}`,
    ].filter(Boolean).join("\n");
  });
  return `Promise of the opening: ${plan.promise}\n\nEverything the scene shows, with its words and when:\n${cat.map(describe).join("\n")}\n\nEvents:\n${events.join("\n\n")}`;
}

export const mapSchema = {
  type: "object",
  additionalProperties: false,
  required: ["promise", "events"],
  properties: {
    promise: { type: "array", items: { type: "string" } },
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "look", "withhold", "demo"],
        properties: { id: { type: "string" }, look: { type: "array", items: { type: "string" } }, withhold: { type: "array", items: { type: "string" } }, demo: { type: "array", items: { type: "string" } } },
      },
    },
  },
} as const;
type Mapped = { promise: string[]; events: { id: string; look: string[]; withhold: string[]; demo: string[] }[] };

// Keeps only ids the scene has; a container's name stands for what it holds.
export function cleanMap(raw: Mapped, s: Samples, groups: Map<string, string[]> = new Map()): IdMap {
  const known = new Set(s.ids);
  const fix = (xs: string[]) => [...new Set(xs.flatMap((x) => (known.has(x) ? [x] : (groups.get(x) ?? []).filter((m) => known.has(m)))))];
  return { promise: fix(raw.promise), events: Object.fromEntries(raw.events.map((e) => [e.id, { look: fix(e.look), withhold: fix(e.withhold), demo: fix(e.demo) }])) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Everything together.

export type Report = {
  tickets: Ticket[];
  look: { event: string; share: number; competing: number }[];
  tempo: { rates: { event: string; rate: number; rhythm: string }[]; cv: number; gapsCv: number };
  holds: { id: string; asked: number; silent: number; voiced: boolean }[];
  demo: { event: string; phase: number; pace: string; seconds: number; beats: number; steps?: number; settled?: number }[];
};

export function runChecks(o: { plan: DirectionPlan; narration: Pick<Narration, "words" | "holds">; samples: Samples; ids: IdMap; attached?: Map<string, string[]>; quiet?: { start: number; end: number }[] }): Report {
  const { plan, narration, samples: s, ids } = o;
  const attached = o.attached ?? new Map();
  const list = spans(plan, narration.words, s.fps, s.frames);
  const hs = holds(plan, narration);
  const look = checkLook(s, list, ids, attached);
  const tempo = checkTempo(s, list);
  const audio = o.quiet ? checkHoldAudio(hs, o.quiet) : { tickets: [], rows: [] };
  const demo = checkDemo(s, list, hs, narration.words, ids, attached);
  const promise = list.length ? checkPromise(s, plan, ids, attached, list[0]!.event.id) : undefined;
  const tickets = [...look.tickets, ...checkWithhold(s, list, ids, attached), ...tempo.tickets, ...checkHoldPictures(s, hs, list, ids, attached), ...audio.tickets, ...demo.tickets, ...(promise ? [promise] : [])];
  tickets.sort((a, b) => a.from - b.from || b.severity - a.severity);
  return { tickets, look: look.rows, tempo: { rates: tempo.rates, cv: tempo.cv, gapsCv: tempo.gapsCv }, holds: audio.rows, demo: demo.rows };
}

// The whole check on a project: the compiled scene, its source, the voice, and at most two Spark calls (the id map,
// kept on disk per plan and scene, and an optional look at the opening frames). `frames` turns seconds into JPEG files.
// `source` is the joined scene document the compiled scene came from, for marks and containers; `kinds` its kit kinds.
export async function checkDirection(p: Project, scene: Scene, o: { source?: string; kinds?: string[]; frames?: (seconds: number[]) => Promise<string[]>; map?: IdMap } = {}): Promise<{ report: Report; ids: IdMap; usd: number }> {
  const plan = p.direction!;
  const narration = p.narration!;
  const source = o.source ?? "";
  const kinds = o.kinds ?? KITS.flatMap((k) => Object.keys(k.kinds ?? {}));
  const attached = attachments(source, kinds);
  const s = sample(scene);
  const list = spans(plan, narration.words, s.fps, s.frames);
  let usd = 0;
  let ids = o.map;
  if (!ids) {
    const cat = catalogue(s, attached);
    const request = mapRequest(plan, list, s, cat);
    const folder = join(dir(p), "critic");
    const file = join(folder, "direction-map.json");
    const key = hash(prompt("direction-check"), request);
    const kept = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    let raw: Mapped = kept?.key === key ? kept.raw : undefined;
    if (!raw) {
      const system = (prompt("direction-check").split(/^# /m).find((x) => x.startsWith("Map")) ?? "").slice(3).trim();
      const r = await json<Mapped>({ system, user: request, schema: mapSchema, schemaName: "direction_map", effort: "low" });
      usd += r.usd;
      raw = r.value;
      mkdirSync(folder, { recursive: true });
      writeFileSync(file, JSON.stringify({ key, raw }, null, 2));
    }
    ids = cleanMap(raw, s, members(source, kinds));
  }
  const audio = join(dir(p), narration.audio);
  const report = runChecks({ plan, narration, samples: s, ids, attached, quiet: existsSync(audio) ? silences(audio) : undefined });
  // The promise, seen: one call on the opening frames, only when the scene data alone did not already find it missing.
  if (o.frames && plan.promise && !report.tickets.some((t) => t.kind === "promise_missing")) {
    const files = await o.frames([0.4, 1.2, 2.2, OPENING]);
    const system = (prompt("direction-check").split(/^# /m).find((x) => x.startsWith("Promise")) ?? "").slice(7).trim();
    const user = [{ type: "input_text", text: `The promise: ${plan.promise}` }, ...files.map((f) => ({ type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(f).toString("base64")}` }))];
    const r = await json<{ shows: "yes" | "partly" | "no"; seen: string }>({ system, user, schema: promiseSchema, schemaName: "promise", effort: "low" });
    usd += r.usd;
    if (r.value.shows !== "yes") report.tickets.unshift(ticket({ event: list[0]?.event.id ?? "", kind: "promise_missing", severity: r.value.shows === "no" ? 2 : 1, from: 0, to: OPENING, note: `The opening should confirm "${plan.promise}". Seen in the first ${OPENING} s (${r.value.shows}): ${r.value.seen}` }));
  }
  return { report, ids, usd };
}

const promiseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["shows", "seen"],
  properties: { shows: { type: "string", enum: ["yes", "partly", "no"] }, seen: { type: "string" } },
} as const;

// A ticket in the critic's format: the event names the place, the action says who acts and how bad it is.
export const asCritic = (t: Ticket) => ({ shotId: t.event, action: `direction:${t.route}:${t.kind}:${t.severity}`, note: `${t.note} [${t.from.toFixed(1)} to ${t.to.toFixed(1)} s]` });
