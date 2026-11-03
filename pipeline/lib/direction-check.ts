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
// extend another top-level id ("arrow.head" of "arrow") belong to it. A group whose children do not extend its own id
// (a camera, a layer) is a frame around things, not a thing: the things inside it are looked at one by one.
export type Samples = {
  fps: number;
  frames: number;
  ids: string[];
  visible: Uint8Array[]; // per thing, per frame: 1 when any of it shows
  active: Uint8Array[]; // per thing, per frame: 1 when it moves, grows, fades, changes color or lights
  text: Map<string, string>; // the words a thing carries over the video, for naming it
  rewords: Map<string, { frame: number; text: string }[]>; // when a thing's words change, and to what
  reads: Map<string, { frame: number; text: string }[]>; // the words a thing visibly shows, from each frame they change
};

// What counts as a change between two frames `GAP` apart. Below these a viewer does not see anything happen: a drift of
// under 15 px a second, a fade of under 2 percent.
const GAP = 2;
const TOL: Record<string, number> = { x: 1, y: 1, scaleX: 0.004, scaleY: 0.004, rotate: 0.3, size: 0.5, strokeWidth: 0.15, glowLevel: 0.02, pulse: 0.02, drawn: 0.01, trimStart: 0.01, trimEnd: 0.01, brightness: 0.01, blur: 0.2, glow: 0.02, fillOpacity: 0.02, strokeOpacity: 0.02 };
const NUMS = Object.keys(TOL);
const STRS = ["color", "fill", "stroke", "text", "weight", "src"];
type Sig = { o: number; n: number[]; s: string; words?: string };

// Wrappers: groups with children, none of whose ids extend the group's own id.
export function wrappers(scene: Scene): Set<string> {
  const kids = new Map<string, string[]>();
  for (const n of scene.nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id]);
  return new Set(scene.nodes.filter((n) => n.kind === "group" && kids.get(n.id)?.length && kids.get(n.id)!.every((k) => !k.startsWith(`${n.id}.`))).map((n) => n.id));
}

// Per thing, every part's look on this frame, with the fade of everything above it, wrappers included.
function signatures(list: Resolved[], wrap: Set<string>, unitOf: (id: string) => string): Map<string, Map<string, Sig>> {
  const out = new Map<string, Map<string, Sig>>();
  const walk = (nodes: Resolved[], opacity: number, into: Map<string, Sig>) => {
    for (const r of nodes) {
      const a = r.props;
      const o = opacity * (typeof a.opacity === "number" ? a.opacity : 1);
      const pts = Array.isArray(a.points) ? (a.points as number[]) : [];
      const shape = pts.length ? `${pts.length}:${Math.round(pts.reduce((s, v, i) => s + v * ((i % 7) + 1), 0))}` : "";
      const words = r.kind === "text" && typeof a.text === "string" && o > 0.05 ? a.text : undefined;
      into.set(r.id, { o, n: NUMS.map((k) => (typeof a[k] === "number" ? (a[k] as number) : NaN)), s: `${STRS.map((k) => String(a[k] ?? "")).join("|")}|${shape}`, words });
      walk(r.children, o, into);
    }
  };
  const roots = (nodes: Resolved[], opacity: number) => {
    for (const r of nodes) {
      if (wrap.has(r.id)) {
        roots(r.children, opacity * (typeof r.props.opacity === "number" ? r.props.opacity : 1));
        continue;
      }
      const u = unitOf(r.id);
      const into = out.get(u) ?? new Map<string, Sig>();
      walk([r], opacity, into);
      out.set(u, into);
    }
  };
  roots(list, 1);
  return out;
}

const shows = (m: Map<string, Sig> | undefined) => !!m && [...m.values()].some((x) => x.o > 0.05);
const wordsOf = (m: Map<string, Sig> | undefined) => (m ? [...m.values()].flatMap((x) => (x.words ? [x.words] : [])).join(" ") : "");

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
  const wrap = wrappers(scene);
  const parent = new Map(scene.nodes.map((n) => [n.id, n.parent]));
  // Roots: parts with nothing above them but wrappers.
  const isRoot = (id: string) => {
    if (wrap.has(id)) return false;
    for (let p = parent.get(id); p; p = parent.get(p)) if (!wrap.has(p)) return false;
    return true;
  };
  const top = new Set(scene.nodes.filter((n) => isRoot(n.id)).map((n) => n.id));
  // A root whose id extends another root's id belongs to it.
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
  // Every text a thing shows over the video, including words that change later (an empty slot that fills with a value),
  // so a thing can be named by what it comes to show.
  const shown = new Map<string, string[]>();
  const rootOf = (id: string) => {
    let root = id;
    for (let p = parent.get(id); p && !wrap.has(p); p = parent.get(p)) root = p;
    return unitOf(root);
  };
  const say = (id: string, v: unknown) => {
    if (typeof v !== "string" || !v.trim()) return;
    const u = rootOf(id);
    const list = shown.get(u) ?? [];
    if (!list.includes(v.trim())) list.push(v.trim());
    shown.set(u, list);
  };
  for (const n of scene.nodes) if (n.kind === "text") say(n.id, n.props.text);
  const rewords = new Map<string, { frame: number; text: string }[]>();
  for (const t of scene.tracks) {
    if (t.prop !== "text") continue;
    t.keys.forEach((k, i) => {
      say(t.target, k.value);
      if (i && k.value !== t.keys[i - 1]!.value && typeof k.value === "string") rewords.set(rootOf(t.target), [...(rewords.get(rootOf(t.target)) ?? []), { frame: k.at, text: k.value }]);
    });
  }
  const text = new Map([...shown].map(([u, list]) => [u, list.join(" ")]));
  const reads = new Map<string, { frame: number; text: string }[]>();
  const history: Map<string, Map<string, Sig>>[] = [];
  for (let f = 0; f < frames; f++) {
    const now = signatures(evaluate(scene, f), wrap, unitOf);
    history.push(now);
    const before = history[f - GAP];
    for (const [u, i] of index) {
      const m = now.get(u);
      if (shows(m)) visible[i]![f] = 1;
      if (before && changed(before.get(u), m)) active[i]![f] = 1;
      const w = wordsOf(m);
      const list = reads.get(u) ?? [];
      if ((list.at(-1)?.text ?? "") !== w) reads.set(u, [...list, { frame: f, text: w }]);
    }
    if (f >= GAP) history[f - GAP] = undefined as never; // only the last few frames are needed
  }
  return { fps: scene.fps, frames, ids, visible, active, text, rewords, reads };
}

// The words a thing visibly shows on a frame.
export function readsAt(s: Samples, id: string, frame: number): string {
  return (s.reads.get(id) ?? []).filter((r) => r.frame <= frame).at(-1)?.text ?? "";
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

// What each item says in the source. Typeset math and other drawn words are paths in the compiled scene, with no text
// to read, so their source (`latex=`, `states=`) is the only place their words are written down.
export function sourceWords(source: string, kitKinds: string[] = []): Map<string, string> {
  const out = new Map<string, string[]>();
  const walk = (items: Item[]) => {
    for (const i of items) {
      const said = [i.text, i.attrs.latex, i.attrs.states, i.attrs.text, i.attrs.label].filter((x): x is string => !!x?.trim());
      if (said.length) out.set(i.id, [...new Set([...(out.get(i.id) ?? []), ...said])]);
      walk(i.children);
    }
  };
  for (const s of parse(source, kitKinds).doc.states) walk(s.items);
  return new Map([...out].map(([k, v]) => [k, v.join(" ")]));
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

export type Hold = { id: string; event: string; afterWord: number; seconds: number; purpose: string; does: string; shows?: string; start: number; end: number; voiced: boolean };
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
      return { id: h.id, event: e.id, afterWord: h.afterWord, seconds: h.seconds, purpose: h.purpose, does: h.does, shows: h.shows, start, end: start + (v ? v.seconds : h.seconds), voiced: !!v };
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Tickets.

export type Route = "scene" | "voice" | "direction" | "check";
export type Kind = "look_absent" | "look_still" | "competing" | "withheld_early" | "predict_answered" | "flat_rhythm" | "rhythm_mismatch" | "hold_frozen" | "hold_competing" | "hold_missing" | "hold_short" | "demo_rushed" | "demo_still" | "demo_unsettled" | "promise_missing" | "map_failed";
export type Ticket = { event: string; kind: Kind; route: Route; severity: 1 | 2 | 3; from: number; to: number; note: string };

// Who can act on each kind. The scene stage fixes what the picture does in a stretch of words; the voice stage fixes
// silences; the direction stage fixes the plan itself (a rhythm it never varied, a hold too short to do its job).
// `check`: the check itself could not judge (the plan's words could not be matched to the scene); nothing in the video
// is known to be wrong, and no stage should act on it as if it were.
export const ROUTE: Record<Kind, Route> = {
  look_absent: "scene", look_still: "scene", competing: "scene", withheld_early: "scene", predict_answered: "scene", flat_rhythm: "scene", rhythm_mismatch: "scene",
  hold_frozen: "scene", hold_competing: "scene", hold_missing: "voice", hold_short: "voice", demo_rushed: "scene", demo_still: "scene", demo_unsettled: "scene", promise_missing: "scene", map_failed: "check",
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

// Things that change on the same frames are seen as one (common fate): four boxes lit together are one pull on the
// eye, not four. Groups things whose changing frames in the stretch overlap by 80 percent or more.
export function pulls(s: Samples, list: { id: string; frames: number }[], from: number, to: number): { ids: string[]; frames: number }[] {
  const out: { ids: string[]; frames: number; bits: Uint8Array }[] = [];
  for (const x of list) {
    const bits = s.active[s.ids.indexOf(x.id)]!.subarray(Math.max(0, from), Math.min(s.frames, to));
    const same = out.find((g) => {
      let both = 0;
      let either = 0;
      for (let f = 0; f < bits.length; f++) {
        both += bits[f]! & g.bits[f]!;
        either += bits[f]! | g.bits[f]!;
      }
      return either && both / either >= 0.8;
    });
    if (same) same.ids.push(x.id);
    else out.push({ ids: [x.id], frames: x.frames, bits });
  }
  return out.map(({ ids, frames }) => ({ ids, frames }));
}
const pullName = (s: Samples, g: { ids: string[]; frames: number }) => `${g.ids.length > 1 ? `${g.ids.slice(0, 4).join(", ")}${g.ids.length > 4 ? ` and ${g.ids.length - 4} more` : ""} together` : name(s, g.ids[0]!)} for ${sec(g.frames, s.fps)}`;

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

// `withhold`: sets of ids, each showing the withheld thing whole. `lookNone`: the map's reason when nothing in the scene
// shows the look. `holds`: per hold, the ids its `does` is about, and for a predict hold the answer and the ids that
// show it. `unmapped`: events the map could not answer at all, which the check reports as its own failure.
export type IdMap = {
  events: Record<string, { look: string[]; withhold: string[][]; demo: string[]; lookNone?: string; holds?: Record<string, { does: string[]; answer: string; ids: string[] }> }>;
  promise: string[];
  unmapped?: string[];
};

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
    const lookFrames = pulls(s, act.filter((x) => mine(x.id)), from, to).reduce((n, x) => n + x.frames, 0);
    const others = pulls(s, act.filter((x) => !mine(x.id) && x.frames >= s.fps * PULL), from, to);
    const otherFrames = others.reduce((n, x) => n + x.frames, 0);
    const share = lookFrames + otherFrames ? lookFrames / (lookFrames + otherFrames) : 1;
    rows.push({ event: event.id, share, competing: others.length });
    const where = { event: event.id, from: from / s.fps, to: to / s.fps };
    const list3 = others.slice(0, 5).map((g) => pullName(s, g)).join(", ");
    // An event the map could not answer is the check's own failure, reported once for the map, never as "absent".
    if (!look.length && ids.unmapped?.includes(event.id)) continue;
    if (!look.length || !seen) {
      const why = look.length ? `${look.join(", ")} never shows` : `nothing in the scene shows it (${ids.events[event.id]?.lookNone ?? "no reason given"})`;
      tickets.push(ticket({ ...where, kind: "look_absent", severity: 2, note: `The eye should be on "${event.look}", but ${why} during ${event.id} (${where.from.toFixed(1)} to ${where.to.toFixed(1)} s, "${event.job}").` }));
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
    const sets = (ids.events[event.id]?.withhold ?? []).filter((x) => x.length);
    if (until === undefined || !sets.length) continue;
    // The withheld thing is a whole: it shows when every part of one set is on screen at once.
    let found: { set: string[]; frame: number } | undefined;
    for (const set of sets) {
      const rows = set.map((id) => s.ids.indexOf(id)).filter((i) => i >= 0);
      if (!rows.length) continue;
      for (let f = 0; f < until; f++) {
        if (rows.every((i) => s.visible[i]![f])) {
          if (!found || f < found.frame) found = { set, frame: f };
          break;
        }
      }
    }
    if (!found) continue;
    const early = found.set.map((id) => ({ id, first: s.visible[s.ids.indexOf(id)]!.indexOf(1) })).filter((x) => x.first >= 0).sort((a, b) => a.first - b.first);
    const firstAt = found.frame;
    // A thing whose words change before the moment (a slot that fills) is named with when it changed and to what.
    const told = (x: { id: string; first: number }) => {
      const change = (s.rewords.get(x.id) ?? []).filter((c) => c.frame >= x.first && c.frame < until).at(-1);
      return `${name(s, x.id)} shows from ${sec(x.first, s.fps)}${change ? ` and reads "${change.text.slice(0, 24)}" from ${sec(change.frame, s.fps)}` : ""}`;
    };
    // When an earlier event's own look or demo is the withheld thing, the plan contradicts itself: the scene did what
    // that event asked, so the plan has to decide, not the scene.
    // Things that read the same words, in the same order, as what the event is asked to show are that thing again under
    // new ids (a column redrawn in the next part). Order counts, so the same values rearranged are not the same thing,
    // and one short word alone is too common to tell.
    const last = (id: string) => (s.reads.get(id) ?? []).filter((r) => r.text).at(-1)?.text.replace(/[−–]/g, "-").replace(/\s+/g, "") ?? "";
    const seq = (list: string[]) => list.map((id, k) => ({ id, k, at: s.visible[s.ids.indexOf(id)]?.indexOf(1) ?? -1 })).sort((a, b) => a.at - b.at || a.k - b.k).map((x) => last(x.id));
    const mine = seq(found.set);
    const distinct = mine.every(Boolean) && (mine.length > 1 || mine[0]!.length >= 4);
    const asker = list.find((x) => {
      if (x.event.id === event.id || x.from >= until) return false;
      const asked = [...new Set([...(ids.events[x.event.id]?.look ?? []), ...(ids.events[x.event.id]?.demo ?? [])])];
      if (found!.set.every((id) => asked.includes(id))) return true;
      return distinct && `|${seq(asked).join("|")}|`.includes(`|${mine.join("|")}|`);
    });
    if (asker) {
      out.push(ticket({ event: event.id, kind: "withheld_early", route: "direction", severity: 2, from: firstAt / s.fps, to: until / s.fps, note: `The plan withholds "${event.withhold.what}" until ${event.withhold.until} (${sec(until, s.fps)}), but also asks ${asker.event.id} ("${asker.event.job}") to show ${found.set.join(", ")}, which the scene does from ${sec(firstAt, s.fps)}. One of the two has to change.` }));
      continue;
    }
    out.push(ticket({ event: event.id, kind: "withheld_early", severity: 3, from: firstAt / s.fps, to: until / s.fps, note: `"${event.withhold.what}" is withheld until ${event.withhold.until} (${sec(until, s.fps)}), but all of it is on screen together from ${sec(firstAt, s.fps)}: ${early.slice(0, 4).map(told).join(", ")}${early.length > 4 ? ` and ${early.length - 4} more` : ""}.` }));
  }
  return out;
}

// A predict hold asks the viewer to guess, so its answer must not be on screen while it lasts (Brod: the gain comes from
// generating the prediction). The map names the answer and the things that show it. When the answer is words, a thing
// counts only while it reads them (a slot showing "?" is fine, the same slot showing the answer is not); when the
// answer never appears as words, a thing that shows it counts while it is visible at all.
const squash = (t: string) => t.toLowerCase().replace(/\s+/g, "");
export function says(text: string, answer: string): boolean {
  const a = squash(answer);
  if (!a) return false;
  // A short answer that is one word or number ("2") must stand alone, so "12" or "x2" do not count.
  if (a.length <= 3 && /^[\p{L}\p{N}.]+$/u.test(a)) return (text.toLowerCase().match(/[\p{L}\p{N}.]+/gu) ?? ([] as string[])).includes(a);
  return squash(text).includes(a);
}
export function checkPredict(s: Samples, hs: Hold[], ids: IdMap): Ticket[] {
  const out: Ticket[] = [];
  for (const h of hs.filter((x) => x.purpose === "predict")) {
    const a = ids.events[h.event]?.holds?.[h.id];
    if (!a?.ids.length) continue;
    const [from, to] = [Math.round(h.start * s.fps), Math.round(h.end * s.fps)];
    // A thing that ever reads the answer counts only while it reads it; a drawn thing with no words (typeset math, a
    // picture) counts while it is visible.
    const literal = new Set(a.ids.filter((id) => a.answer && (s.reads.get(id) ?? []).some((r) => says(r.text, a.answer))));
    let hit: { id: string; frame: number; text: string } | undefined;
    for (let f = from; f < to && !hit; f++) {
      for (const id of a.ids) {
        const i = s.ids.indexOf(id);
        if (i < 0 || !s.visible[i]![f]) continue;
        // An answer arrives: words that were already on screen well before the hold (the question's own setup, such as
        // "compare 27 vs 10") are what the viewer predicts from, not the answer given away.
        const reading = (s.reads.get(id) ?? []).filter((r) => r.frame <= f).at(-1);
        const text = reading?.text ?? "";
        const arrived = (reading?.frame ?? 0) >= from - s.fps;
        const drawn = !(s.reads.get(id) ?? []).some((r) => r.text);
        if (literal.has(id) ? says(text, a.answer) && arrived : drawn) {
          hit = { id, frame: f, text };
          break;
        }
      }
    }
    if (!hit) continue;
    const shown = hit.text ? ` reads "${hit.text.slice(0, 40)}"` : s.text.get(hit.id) ? ` shows "${s.text.get(hit.id)!.slice(0, 40)}"` : "";
    out.push(ticket({ event: h.event, kind: "predict_answered", severity: 3, from: h.start, to: h.end, note: `Hold ${h.id} asks the viewer to predict${h.shows ? ` ("${h.shows}")` : ""}, but the answer${a.answer ? ` (${a.answer})` : ""} is already on screen at ${sec(hit.frame, s.fps)}, during the hold (${h.start.toFixed(1)} to ${h.end.toFixed(1)} s): ${hit.id}${shown}.` }));
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
  // A hold the voice never left is not a hold the viewer gets; the audio check reports it, and its picture is not judged.
  for (const h of hs.filter((x) => x.voiced)) {
    const [from, to] = [Math.round(h.start * s.fps), Math.round(h.end * s.fps)];
    if (to <= from) continue;
    const act = activity(s, from, to);
    const look = ids.events[h.event]?.look ?? [];
    const demo = ids.events[h.event]?.demo ?? [];
    const does = ids.events[h.event]?.holds?.[h.id]?.does ?? [];
    // The on-screen prompt a hold asks for ("shows") is part of the hold, whatever the map said.
    const prompts = h.shows ? s.ids.filter((id) => (s.reads.get(id) ?? []).some((r) => says(r.text, h.shows!))) : [];
    const related = (id: string) => belongs(id, [...look, ...demo, ...does, ...prompts], attached);
    const where = { event: h.event, from: h.start, to: h.end };
    if (!act.length) {
      out.push(ticket({ ...where, kind: "hold_frozen", severity: h.end - h.start >= 2 ? 3 : 2, note: `Hold ${h.id} (${h.purpose}, ${h.seconds.toFixed(1)} s after word ${h.afterWord}) should show: "${h.does}". Nothing on screen changes from ${h.start.toFixed(1)} to ${h.end.toFixed(1)} s: a frozen frame.` }));
      continue;
    }
    const others = pulls(s, act.filter((x) => !related(x.id) && x.frames >= s.fps * PULL), from, to);
    const mineFrames = pulls(s, act.filter((x) => related(x.id)), from, to).reduce((n, x) => n + x.frames, 0);
    const otherFrames = others.reduce((n, x) => n + x.frames, 0);
    if (look.length && others.length && otherFrames > mineFrames) {
      out.push(ticket({ ...where, kind: "hold_competing", severity: 2, note: `During hold ${h.id} (${h.start.toFixed(1)} to ${h.end.toFixed(1)} s, "${h.does}") the change is mostly away from the event's look (${look.join(", ")}): ${others.slice(0, 4).map((g) => pullName(s, g)).join(", ")}.` }));
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
        // Settled: how long the demo holds still before the phase ends, from its last change inside the phase. What
        // starts after the end belongs to whatever comes next.
        const last = (() => {
          for (let f = Math.min(s.frames, to) - 1; f >= from; f--) if (s.ids.some((id, i) => (!only || only(id)) && s.active[i]![f])) return f;
          return from;
        })();
        const settled = (to - 1 - last) / s.fps;
        row.settled = settled;
        if (settled < 0.4) tickets.push(ticket({ ...where, kind: "demo_unsettled", severity: 2, note: `${label[0]!.toUpperCase()}${label.slice(1)} should end on the finished state, but "${demo.what}" is still changing at ${(last / s.fps).toFixed(1)} s, ${settled.toFixed(2)} s before it ends; it never rests on the result.` }));
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

export type Catalogue = { id: string; words: string; reads: string; on: string[]; shown: [number, number] | null }[];

export function catalogue(s: Samples, attached: Map<string, string[]>): Catalogue {
  return s.ids.map((id, i) => {
    const v = s.visible[i]!;
    const first = v.indexOf(1);
    // When what a thing reads changes while it shows, the reader needs the order: "?" then "2" is a slot that fills.
    const seq = (s.reads.get(id) ?? []).filter((r) => r.text);
    const reads = seq.length > 1 ? seq.slice(0, 5).map((r) => `"${r.text.slice(0, 30)}" from ${(r.frame / s.fps).toFixed(1)} s`).join(", ") : "";
    return { id, words: (s.text.get(id) ?? "").slice(0, 60), reads, on: attached.get(id) ?? [], shown: first < 0 ? null : [first / s.fps, v.lastIndexOf(1) / s.fps] as [number, number] };
  }).filter((x) => x.shown);
}

export function mapRequest(plan: DirectionPlan, list: Span[], s: Samples, cat: Catalogue, hs: Hold[] = []): string {
  const describe = (c: Catalogue[number]) => `${c.id}${c.words ? ` "${c.words}"` : ""}${c.reads ? ` (reads ${c.reads})` : ""}${c.on.length ? ` (marks ${c.on.join(", ")})` : ""}, on screen ${c.shown![0].toFixed(1)} to ${c.shown![1].toFixed(1)} s`;
  const events = list.map(({ event, from, to }) => {
    const here = cat.filter((c) => c.shown![0] * s.fps < to && c.shown![1] * s.fps >= from).map((c) => c.id);
    const mine = hs.filter((h) => h.event === event.id);
    return [
      `Event ${event.id}, ${(from / s.fps).toFixed(1)} to ${(to / s.fps).toFixed(1)} s. Job: ${event.job}`,
      `  look: ${event.look}`,
      event.withhold ? `  withhold: ${event.withhold.what}` : "",
      event.demo ? `  demo: ${event.demo.what}` : "",
      event.reveal ? `  reveals: ${event.reveal.what}` : "",
      ...mine.map((h) => `  ${h.purpose} hold ${h.id}, ${h.start.toFixed(1)} to ${h.end.toFixed(1)} s: the picture ${h.does}${h.purpose === "predict" ? `; asks the viewer ${h.shows ? `"${h.shows}"` : "to predict"}` : ""}`),
      `  on screen during it: ${here.join(", ") || "(nothing)"}`,
    ].filter(Boolean).join("\n");
  });
  return `Promise of the opening: ${plan.promise}\n\nEverything the scene shows, with its words and when:\n${cat.map(describe).join("\n")}\n\nEvents:\n${events.join("\n\n")}`;
}

const idList = { type: "array", items: { type: "string" } } as const;
export const mapSchema = {
  type: "object",
  additionalProperties: false,
  required: ["promise", "events"],
  properties: {
    promise: idList,
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "look", "lookNone", "withhold", "demo", "holds"],
        properties: {
          id: { type: "string" },
          look: idList,
          lookNone: { type: "string" },
          withhold: { type: "array", items: idList },
          demo: idList,
          holds: { type: "array", items: { type: "object", additionalProperties: false, required: ["hold", "does", "answer", "ids"], properties: { hold: { type: "string" }, does: idList, answer: { type: "string" }, ids: idList } } },
        },
      },
    },
  },
} as const;
export type Mapped = { promise: string[]; events: { id: string; look: string[]; lookNone: string; withhold: string[][]; demo: string[]; holds: { hold: string; does: string[]; answer: string; ids: string[] }[] }[] };

// Keeps only ids the scene has; a container's name stands for what it holds. An event the map left without a look
// and without saying why is not an answer: it is listed in `unmapped`, so it is repaired or reported, never taken as
// "nothing in the scene matches".
export function cleanMap(raw: Mapped, s: Samples, groups: Map<string, string[]> = new Map(), events: string[] = raw.events.map((e) => e.id)): IdMap {
  const known = new Set(s.ids);
  const fix = (xs: string[]) => [...new Set(xs.flatMap((x) => (known.has(x) ? [x] : (groups.get(x) ?? []).filter((m) => known.has(m)))))];
  const byId = new Map(raw.events.map((e) => [e.id, e]));
  const out: IdMap = { promise: fix(raw.promise), events: {}, unmapped: [] };
  for (const id of events) {
    const e = byId.get(id);
    const look = fix(e?.look ?? []);
    const none = (e?.lookNone ?? "").trim();
    out.events[id] = { look, lookNone: look.length ? undefined : none || undefined, withhold: (e?.withhold ?? []).map(fix).filter((x) => x.length), demo: fix(e?.demo ?? []), holds: Object.fromEntries((e?.holds ?? []).map((x) => [x.hold, { does: fix(x.does), answer: x.answer, ids: fix(x.ids) }])) };
    if (!look.length && !none) out.unmapped!.push(id);
  }
  return out;
}

// Takes the repaired answers for the events that came back without a look.
export function mergeMaps(first: Mapped, again: Mapped): Mapped {
  const redo = new Map(again.events.map((e) => [e.id, e]));
  return { promise: first.promise.length ? first.promise : again.promise, events: first.events.map((e) => redo.get(e.id) ?? e) };
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

// Each hold cut to the silence that covers its start, when the voice spoke again before the hold should have ended.
// A hold with no silence at its start keeps its planned window: the audio check already reports it.
export function silentHolds(hs: Hold[], quiet: { start: number; end: number }[]): Hold[] {
  return hs.map((h) => {
    const q = quiet.find((x) => x.start <= h.start + 0.15 && x.end > h.start + 0.15);
    return q && q.end < h.end ? { ...h, end: Math.max(h.start + 0.1, q.end) } : h;
  });
}

export function runChecks(o: { plan: DirectionPlan; narration: Pick<Narration, "words" | "holds">; samples: Samples; ids: IdMap; attached?: Map<string, string[]>; quiet?: { start: number; end: number }[] }): Report {
  const { plan, narration, samples: s, ids } = o;
  const attached = o.attached ?? new Map();
  const list = spans(plan, narration.words, s.fps, s.frames);
  const hs = holds(plan, narration);
  const look = checkLook(s, list, ids, attached);
  const tempo = checkTempo(s, list);
  const audio = o.quiet ? checkHoldAudio(hs, o.quiet) : { tickets: [], rows: [] };
  const demo = checkDemo(s, list, hs, narration.words, ids, attached);
  const promise = list.length && !ids.unmapped?.length ? checkPromise(s, plan, ids, attached, list[0]!.event.id) : undefined;
  const failed: Ticket[] = ids.unmapped?.length
    ? [ticket({ event: ids.unmapped.join(","), kind: "map_failed", severity: 3, from: 0, to: s.frames / s.fps, note: `The check could not match the plan's words to the scene for ${ids.unmapped.join(", ")} (${ids.unmapped.length} of ${list.length} events), even after asking again. Look, demo and promise were not judged there; this says nothing about the video. ${s.ids.length} things on screen in all.` })]
    : [];
  // The picture is judged over the silence the viewer really got: a hold the voice cut short ends where speech resumes.
  const heard = o.quiet ? silentHolds(hs, o.quiet) : hs;
  const tickets = [...failed, ...look.tickets, ...checkWithhold(s, list, ids, attached), ...checkPredict(s, heard, ids), ...tempo.tickets, ...checkHoldPictures(s, heard, list, ids, attached), ...audio.tickets, ...demo.tickets, ...(promise ? [promise] : [])];
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
  for (const [id, words] of sourceWords(source, kinds)) if (s.ids.includes(id) && !s.text.get(id)) s.text.set(id, words);
  const list = spans(plan, narration.words, s.fps, s.frames);
  let usd = 0;
  let ids = o.map;
  const hs = holds(plan, narration);
  if (!ids) {
    const cat = catalogue(s, attached);
    const groups = members(source, kinds);
    const events = list.map((x) => x.event.id);
    const request = mapRequest(plan, list, s, cat, hs);
    const folder = join(dir(p), "critic");
    const file = join(folder, "direction-map.json");
    const key = hash(prompt("direction-check"), request);
    const kept = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    let raw: Mapped | undefined = kept?.key === key ? kept.raw : undefined;
    if (!raw) {
      const system = (prompt("direction-check").split(/^# /m).find((x) => x.startsWith("Map")) ?? "").slice(3).trim();
      const r = await json<Mapped>({ system, user: request, schema: mapSchema, schemaName: "direction_map", effort: "low" });
      usd += r.usd;
      raw = r.value;
      // Repair: events that came back with no look and no reason are asked again, once, with what was wrong.
      const empty = cleanMap(raw, s, groups, events).unmapped ?? [];
      if (empty.length) {
        console.warn(`  direction check: the id map left ${empty.join(", ")} without a look or a reason; asking again`);
        const again = await json<Mapped>({ system, user: `${request}\n\nYour last answer gave events ${empty.join(", ")} no look ids and no reason. For each of them, pick the ids that show its look from the things on screen during it, or, only if none of them shows it, say in lookNone what is on screen instead. Answer for those events only.`, schema: mapSchema, schemaName: "direction_map", effort: "medium" });
        usd += again.usd;
        raw = mergeMaps(raw, again.value);
      }
      mkdirSync(folder, { recursive: true });
      writeFileSync(file, JSON.stringify({ key, raw }, null, 2));
    }
    ids = cleanMap(raw, s, groups, events);
    // Fewer things than events means the scene could not be told apart (everything inside one part): nothing the map
    // says can be trusted, so every event is reported as unmatched rather than judged.
    if (cat.length < Math.min(3, events.length)) ids.unmapped = events;
    if (ids.unmapped?.length) console.warn(`  DIRECTION CHECK COULD NOT MATCH ${ids.unmapped.length} of ${events.length} events to the scene (${ids.unmapped.join(", ")}); they are reported as map_failed, not judged`);
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
