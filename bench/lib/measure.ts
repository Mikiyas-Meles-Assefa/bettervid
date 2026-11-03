// The free measures: everything here is computed from the built scene and the narration timing, with no model. Each
// measure is a number from 0 to 1 with the raw values beside it, so a change to the engine can be read both ways. No
// measure knows what kind of video a case is: they read the direction plan (looks, holds, demos, reveals, withholds)
// and the scene, the same for every case.
//
// - eye: during each event, the share of the picture's change that is on the event's `look` (direction-check's
//   checkLook, Smith's attentional synchrony); an absent or still look scores 0.
// - lag: when the narration names something the screen shows in words, does the picture answer within about a second
//   (it arrives or changes), and does each event's look and reveal start moving near its words (Mayer's temporal
//   contiguity: words and the picture they name belong together in time).
// - pace: the rate of change varies across events (Cutting's 1/f finding; direction-check's checkTempo), long events
//   are not busier than short ones, and demonstrations go slowly where asked, faster later, and come to rest.
// - load: how many new things arrive within two seconds and how many independent changes pull at once (working
//   memory holds about four chunks; Lang's limited capacity). The share of seconds over either line costs.
// - holds: each silence keeps the picture working on what the event is about (no frozen frame, nothing unrelated
//   pulling), and a predict hold never shows its answer.
// - reveal: withheld things stay off screen until their moment, and the opening shows the promise.
// - read: the layout measures from look.ts on a frame every half second: words cut by the frame, under the style's
//   readable size, writing on writing, a covered picture, a mostly empty frame.
import type { Scene } from "../../engine/core/types.ts";
import { FLAT, activity, attachments, beats, cleanMap, members, pulls, runChecks, sample, sourceWords, spans, type IdMap, type Mapped, type Report, type Samples } from "../../pipeline/lib/direction-check.ts";
import { inventory, keptAt, measureLayout, readOf } from "../../pipeline/lib/look.ts";
import { kitKinds } from "../../pipeline/stages/scene.ts";
import type { Project } from "../../schemas/project.ts";
import type { Theme } from "../../engine/core/types.ts";

export type Scores = { eye?: number; lag: number; pace: number; load: number; holds?: number; reveal?: number; read: number };
export type CaseMeasure = {
  id: string;
  built: boolean;
  scores: Scores;
  overall: number;
  raw: Record<string, unknown>;
  tickets: { kind: string; severity: number; note: string }[];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const round = (x: number, d = 3) => +x.toFixed(d);

// ---------------------------------------------------------------------------------------------------------------------
// Lag: named things.

const STOP = new Set("the a an and or but so of to in on at by for with from into onto is are was were be been it its it's that this these those there here then than as if not no yes you your we our they their them he she his her what which who how why when where all any each every one just only very more most can will would could should do does did has have had".split(" "));
const stem = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").replace(/(ing|ed|es|s)$/u, "");
const content = (text: string) => text.split(/[\s_/,.;:!?()"'[\]{}=+\-−×÷]+/).map(stem).filter((w) => w && (w.length >= 3 || /\d/.test(w)) && !STOP.has(w));

// Number words the narration says and the screen writes as digits.
const NUM: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twelve: "12", twenty: "20", thirty: "30", seventy: "70", ninety: "90", hundred: "100" };
const spoken = (w: string) => {
  const s = stem(w);
  return NUM[w.toLowerCase().replace(/[^\p{L}]/gu, "")] ?? s;
};

export type Mention = { word: number; term: string; ids: string[]; outcome: "in_time" | "late" | "already" | "missing"; lag?: number };

// For every spoken word that names something the screen writes, did a thing showing it arrive or change near the
// word? In time: from half a second before to a second after the word starts. Late: up to three seconds after.
// Already: it was on screen and did not answer. Missing: not on screen then, nor within three seconds.
export function mentions(p: Project, s: Samples): Mention[] {
  const words = p.narration!.words;
  const terms = new Map<string, string[]>();
  for (const [id, text] of s.text) for (const t of content(text)) terms.set(t, [...new Set([...(terms.get(t) ?? []), id])]);
  const out: Mention[] = [];
  const seen = new Set<string>();
  words.forEach((w, i) => {
    const term = spoken(w.text);
    const ids = terms.get(term);
    if (!ids || STOP.has(term) || (term.length < 3 && !/\d/.test(term))) return;
    // The first mention per event counts; repeats of a word already answered say little.
    const key = `${w.beatId} ${term}`;
    if (seen.has(key)) return;
    seen.add(key);
    const f0 = Math.round(w.start * s.fps);
    const rows = ids.map((id) => s.ids.indexOf(id)).filter((r) => r >= 0);
    const first = (from: number, to: number) => {
      for (let f = Math.max(1, from); f < Math.min(s.frames, to); f++) if (rows.some((r) => s.active[r]![f] || (s.visible[r]![f] && !s.visible[r]![f - 1]))) return f;
      return -1;
    };
    const near = first(f0 - Math.round(0.5 * s.fps), f0 + Math.round(1.0 * s.fps));
    if (near >= 0) return out.push({ word: i, term, ids, outcome: "in_time", lag: round((near - f0) / s.fps, 2) });
    const late = first(f0 + Math.round(1.0 * s.fps), f0 + Math.round(3.0 * s.fps));
    if (late >= 0) return out.push({ word: i, term, ids, outcome: "late", lag: round((late - f0) / s.fps, 2) });
    if (rows.some((r) => s.visible[r]![Math.min(s.frames - 1, f0)])) return out.push({ word: i, term, ids, outcome: "already" });
    out.push({ word: i, term, ids, outcome: "missing" });
  });
  return out;
}

// Each event's look should start to move or arrive near its first word, and a reveal's thing near the reveal word.
function onsets(p: Project, s: Samples, ids: IdMap, attachedMap: Map<string, string[]>): { event: string; what: "look" | "reveal"; lag: number | null }[] {
  const words = p.narration!.words;
  const out: { event: string; what: "look" | "reveal"; lag: number | null }[] = [];
  const mine = (named: string[]) => s.ids.map((id, r) => ({ id, r })).filter((x) => named.some((m) => x.id === m || x.id.startsWith(`${m}.`) || (attachedMap.get(x.id) ?? []).some((t) => t === m || t.startsWith(`${m}.`)))).map((x) => x.r);
  const firstMove = (rows: number[], f0: number, limit: number) => {
    for (let f = Math.max(1, f0 - Math.round(0.5 * s.fps)); f < Math.min(s.frames, f0 + limit); f++) if (rows.some((r) => s.active[r]![f] || (s.visible[r]![f] && !s.visible[r]![f - 1]))) return f;
    return -1;
  };
  for (const e of p.direction!.events) {
    const look = ids.events[e.id]?.look ?? [];
    if (!look.length) continue;
    const rows = mine(look);
    const f0 = Math.round(words[e.firstWord]!.start * s.fps);
    const end = Math.round(words[e.lastWord]!.end * s.fps);
    const f = firstMove(rows, f0, Math.max(s.fps, end - f0));
    out.push({ event: e.id, what: "look", lag: f < 0 ? null : round((f - f0) / s.fps, 2) });
    if (e.reveal) {
      const r0 = Math.round(words[e.reveal.word]!.start * s.fps);
      const g = firstMove(rows, r0, 3 * s.fps);
      out.push({ event: e.id, what: "reveal", lag: g < 0 ? null : round((g - r0) / s.fps, 2) });
    }
  }
  return out;
}

const lagScore = (lag: number | null) => (lag === null ? 0 : lag <= 1 ? 1 : lag <= 2 ? 0.5 : 0.2);

// ---------------------------------------------------------------------------------------------------------------------
// Load.

export const NEW_LINE = 6; // new things arriving within two seconds
export const PULL_LINE = 3; // independent changes pulling within one second
export function load(s: Samples): { seconds: number; overNew: number; overPull: number; peakNew: number; peakPull: number; newPerSecond: number } {
  // Arrivals: a thing becoming visible. Each counts, even when a whole state arrives at once: six new labels in one
  // beat are still six things to take in.
  const arrivals: number[] = [];
  s.ids.forEach((_, r) => {
    const v = s.visible[r]!;
    for (let f = 0; f < s.frames; f++) if (v[f] && (f === 0 || !v[f - 1])) arrivals.push(f);
  });
  arrivals.sort((a, b) => a - b);
  const groups = arrivals;
  const seconds = Math.max(1, Math.floor(s.frames / s.fps));
  let overNew = 0;
  let overPull = 0;
  let peakNew = 0;
  let peakPull = 0;
  for (let k = 0; k < seconds; k++) {
    const from = k * s.fps;
    const n = groups.filter((f) => f >= from - s.fps && f < from + s.fps).length;
    const pull = pulls(s, activity(s, from, from + s.fps), from, from + s.fps).length;
    peakNew = Math.max(peakNew, n);
    peakPull = Math.max(peakPull, pull);
    if (n > NEW_LINE) overNew++;
    if (pull > PULL_LINE) overPull++;
  }
  return { seconds, overNew, overPull, peakNew, peakPull, newPerSecond: round(groups.length / (s.frames / s.fps), 2) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Readability.

export function readability(scene: Scene, theme: Theme, s: Samples): { frames: number; severe: number; mild: number; kinds: Record<string, number>; examples: string[] } {
  const read = readOf(theme);
  const kinds: Record<string, number> = {};
  const examples: string[] = [];
  let severe = 0;
  let mild = 0;
  let frames = 0;
  for (let f = Math.round(s.fps * 0.5); f < scene.frames; f += Math.round(s.fps / 2)) {
    const changing = s.active.some((a) => a[f]);
    const things = inventory(scene, f).filter((t) => t.opacity >= 0.15 && !(t.kind === "shape" && (t.box.x1 - t.box.x0) * (t.box.y1 - t.box.y0) > scene.width * scene.height * 0.8));
    const found = measureLayout(things, scene.width, scene.height, read, changing, keptAt(scene, f));
    frames++;
    for (const x of found) kinds[x.kind] = (kinds[x.kind] ?? 0) + 1;
    if (found.some((x) => x.severity >= 3)) severe++;
    else if (found.some((x) => x.severity === 2)) mild++;
    for (const x of found.filter((y) => y.severity >= 3)) if (examples.length < 6 && !examples.some((e) => e.startsWith(x.kind))) examples.push(`${x.kind} at ${(f / s.fps).toFixed(1)} s: ${x.note.slice(0, 160)}`);
  }
  return { frames, severe, mild, kinds, examples };
}

// ---------------------------------------------------------------------------------------------------------------------
// Everything for one case.

export function measureCase(p: Project, scene: Scene, source: string, theme: Theme, raw?: Mapped): CaseMeasure {
  const kinds = kitKinds();
  const s = sample(scene);
  for (const [id, words] of sourceWords(source, kinds)) if (s.ids.includes(id) && !s.text.get(id)) s.text.set(id, words);
  const attached = attachments(source, kinds);
  const plan = p.direction!;
  const narration = p.narration!;
  const list = spans(plan, narration.words, s.fps, s.frames);
  const events = list.map((x) => x.event.id);
  const ids: IdMap | undefined = raw ? cleanMap(raw, s, members(source, kinds), events) : undefined;
  const report: Report | undefined = ids ? runChecks({ plan, narration, samples: s, ids, attached }) : undefined;
  const has = (k: string) => (report?.tickets ?? []).filter((t) => t.kind === k);

  // eye
  const eyeRows = report ? report.look.map((r) => ({ ...r, share: has("look_absent").some((t) => t.event === r.event) || has("look_still").some((t) => t.event === r.event) ? 0 : r.share })) : [];
  const unmapped = ids?.unmapped ?? [];
  const eye = report ? mean(eyeRows.filter((r) => !unmapped.includes(r.event)).map((r) => r.share)) : undefined;

  // lag
  const ms = mentions(p, s);
  const named = ms.length ? mean(ms.map((m) => (m.outcome === "in_time" ? 1 : m.outcome === "late" || m.outcome === "already" ? 0.5 : 0))) : undefined;
  const on = ids ? onsets(p, s, ids, attached) : [];
  const onset = on.length ? mean(on.map((x) => lagScore(x.lag))) : undefined;
  const lag = mean([named, onset].filter((x): x is number => x !== undefined));

  // pace
  const tempo = report?.tempo ?? { cv: 0, gapsCv: 0, rates: [] };
  const rates = report ? tempo.rates : list.map(({ event, from, to }) => ({ event: event.id, rhythm: event.rhythm, rate: beats(s, from, to).length / Math.max(0.5, (to - from) / s.fps) }));
  const cvRates = (() => {
    const xs = rates.map((r) => r.rate);
    const m = mean(xs);
    return m ? Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / m : 0;
  })();
  // A plan that mixes long and short events asks for a clearly varied rate; one that does not still should not be a
  // metronome (direction-check FLAT).
  const variation = clamp(cvRates / (new Set(rates.map((r) => r.rhythm)).size > 1 ? 0.4 : FLAT));
  const mismatch = rates.filter((r) => r.rhythm === "long").length ? has("rhythm_mismatch").length / rates.filter((r) => r.rhythm === "long").length : 0;
  const demoRows = report?.demo ?? [];
  const demoBad = ["demo_rushed", "demo_still", "demo_unsettled"].flatMap(has);
  // Slow first, faster later: within each demo, a slow phase's beats per second are below the later phases'.
  const order = (() => {
    const byEvent = new Map<string, typeof demoRows>();
    for (const r of demoRows) byEvent.set(r.event, [...(byEvent.get(r.event) ?? []), r]);
    const all = [...p.direction!.events].flatMap((e) => (byEvent.get(e.id) ?? []).map((r) => ({ ...r, rate: r.beats / Math.max(0.5, r.seconds) })));
    const slow = all.filter((r) => r.pace === "slow");
    const quick = all.filter((r) => r.pace === "fast");
    if (!slow.length || !quick.length) return undefined;
    return mean(quick.map((r) => r.rate)) > mean(slow.map((r) => r.rate)) ? 1 : 0;
  })();
  const demoScore = demoRows.length ? clamp(1 - demoBad.length / demoRows.length) : undefined;
  const pace = mean([variation * (1 - 0.5 * mismatch), demoScore, order].filter((x): x is number => x !== undefined));

  // load
  const ld = load(s);
  const loadScore = clamp(1 - (ld.overNew + ld.overPull) / ld.seconds);

  // holds
  const holdIds = (plan.events.flatMap((e) => e.holds ?? [])).map((h) => h.id);
  const holdTickets = ["hold_frozen", "hold_competing", "predict_answered"].flatMap(has);
  const holdScore = report && holdIds.length ? mean(holdIds.map((h) => {
    const ts = holdTickets.filter((t) => t.note.includes(`Hold ${h} `) || t.note.includes(`hold ${h} `));
    return ts.some((t) => t.kind !== "hold_competing") ? 0 : ts.length ? 0.5 : 1;
  })) : undefined;

  // reveal
  const withholds = plan.events.filter((e) => e.withhold).length;
  const early = has("withheld_early");
  const promise = has("promise_missing");
  const reveal = report ? mean([...(withholds ? [clamp(1 - early.filter((t) => t.severity >= 3).length / withholds)] : []), promise.length ? 0 : 1]) : undefined;

  // read
  const rd = readability(scene, theme, s);
  const read = clamp(1 - (rd.severe + 0.4 * rd.mild) / Math.max(1, rd.frames));

  const scores: Scores = { lag: round(lag), pace: round(pace), load: round(loadScore), read: round(read), ...(eye !== undefined ? { eye: round(eye) } : {}), ...(holdScore !== undefined ? { holds: round(holdScore) } : {}), ...(reveal !== undefined ? { reveal: round(reveal) } : {}) };
  return {
    id: p.id,
    built: true,
    scores,
    overall: round(mean(Object.values(scores))),
    raw: {
      seconds: round(narration.seconds, 1),
      things: s.ids.length,
      eye: eyeRows.map((r) => ({ event: r.event, share: round(r.share, 2), competing: r.competing })),
      unmapped,
      mentions: { total: ms.length, in_time: ms.filter((m) => m.outcome === "in_time").length, late: ms.filter((m) => m.outcome === "late").length, already: ms.filter((m) => m.outcome === "already").length, missing: ms.filter((m) => m.outcome === "missing").length, missed: ms.filter((m) => m.outcome === "missing").slice(0, 8).map((m) => `${narration.words[m.word]!.text} (word ${m.word})`) },
      onsets: on,
      tempo: { cv: round(cvRates, 2), rates: rates.map((r) => ({ ...r, rate: round(r.rate, 2) })) },
      demo: demoRows.map((r) => ({ ...r, seconds: round(r.seconds, 2), ...(r.settled !== undefined ? { settled: round(r.settled, 2) } : {}) })),
      slowThenFaster: order ?? null,
      load: ld,
      read: rd,
    },
    tickets: (report?.tickets ?? []).map((t) => ({ kind: t.kind, severity: t.severity, note: t.note })),
  };
}

export const failed = (id: string, why: string): CaseMeasure => ({ id, built: false, scores: { lag: 0, pace: 0, load: 0, read: 0 }, overall: 0, raw: { why }, tickets: [] });
