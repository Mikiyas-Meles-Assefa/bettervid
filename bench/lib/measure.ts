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
//   memory holds about four chunks; Lang's limited capacity). The share of seconds over either line costs. A stream of
//   look-alike things (drops, particles) counts as one thing and one pull, as every viewer reads it.
// - holds: each silence keeps the picture working on what the event is about (no frozen frame, nothing unrelated
//   pulling), and a predict hold never shows its answer.
// - reveal: withheld things stay off screen until their moment, and the opening shows the promise.
// - read: the layout measures from look.ts on a frame every half second: words cut by the frame, under the style's
//   readable size, writing on writing, a covered picture, a mostly empty frame.
import type { Scene } from "../../engine/core/types.ts";
import { FLAT, attachments, beats, belongs, checkPredict, cleanMap, holds, members, says, runChecks, sample, sourceWords, spans, type IdMap, type Mapped, type Report, type Samples } from "../../pipeline/lib/direction-check.ts";
import { inventory, keptAt, measureLayout, readOf } from "../../pipeline/lib/look.ts";
import { kitKinds } from "../../pipeline/stages/scene.ts";
import type { Project } from "../../schemas/project.ts";
import type { Theme } from "../../engine/core/types.ts";
import { parse, type Item } from "../../engine/language/syntax.ts";
import { DEFAULTS, type Settings } from "./settings.ts";
import { countLoad, sampled, streams } from "../../engine/design/instruments/index.ts";
import { blend, hexRgb, ratio } from "../../engine/design/instruments/color.ts";

export type Scores = { eye?: number; lag: number; pace: number; load: number; holds?: number; reveal?: number; read: number; depict?: number };
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
export function mentions(p: Project, s: Samples, lagSet: Settings["lag"] = DEFAULTS.lag): Mention[] {
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
    const near = first(f0 - Math.round(lagSet.before * s.fps), f0 + Math.round(lagSet.after * s.fps));
    if (near >= 0) return out.push({ word: i, term, ids, outcome: "in_time", lag: round((near - f0) / s.fps, 2) });
    const late = first(f0 + Math.round(lagSet.after * s.fps), f0 + Math.round(lagSet.late * s.fps));
    if (late >= 0) return out.push({ word: i, term, ids, outcome: "late", lag: round((late - f0) / s.fps, 2) });
    if (rows.some((r) => s.visible[r]![Math.min(s.frames - 1, f0)])) return out.push({ word: i, term, ids, outcome: "already" });
    out.push({ word: i, term, ids, outcome: "missing" });
  });
  return out;
}

// Each event's look should start to move or arrive near its first word, and a reveal's thing near the reveal word.
function onsets(p: Project, s: Samples, ids: IdMap, attachedMap: Map<string, string[]>, lagSet: Settings["lag"] = DEFAULTS.lag): { event: string; what: "look" | "reveal"; lag: number | null }[] {
  const words = p.narration!.words;
  const out: { event: string; what: "look" | "reveal"; lag: number | null }[] = [];
  const mine = (named: string[]) => s.ids.map((id, r) => ({ id, r })).filter((x) => named.some((m) => x.id === m || x.id.startsWith(`${m}.`) || (attachedMap.get(x.id) ?? []).some((t) => t === m || t.startsWith(`${m}.`)))).map((x) => x.r);
  const firstMove = (rows: number[], f0: number, limit: number) => {
    for (let f = Math.max(1, f0 - Math.round(lagSet.before * s.fps)); f < Math.min(s.frames, f0 + limit); f++) if (rows.some((r) => s.active[r]![f] || (s.visible[r]![f] && !s.visible[r]![f - 1]))) return f;
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
      const g = firstMove(rows, r0, lagSet.late * s.fps);
      out.push({ event: e.id, what: "reveal", lag: g < 0 ? null : round((g - r0) / s.fps, 2) });
    }
  }
  return out;
}

const lagScore = (lag: number | null, set: Settings["lag"]) => (lag === null ? 0 : lag <= set.full ? 1 : lag <= set.half ? 0.5 : 0.2);

// ---------------------------------------------------------------------------------------------------------------------
// Load.

export function load(s: Samples, lines: Settings["load"] = DEFAULTS.load, scene?: Scene): { seconds: number; overNew: number; overPull: number; peakNew: number; peakPull: number; newPerSecond: number; streams: { ids: string[]; arrivals: number }[] } {
  // Arrivals: a thing becoming visible. Each counts, even when a whole state arrives at once: six new labels in one
  // beat are still six things to take in. A stream of look-alike things (drops, particles, a flock) is one thing that
  // arrives when it starts, and one pull (the instruments' stream grouping, engine/design/instruments/load.ts).
  const found = scene ? streams(sampled(scene), lines.stream) : [];
  const rows = s.ids.map((id, r) => ({ id, visible: s.visible[r]!, active: s.active[r]! }));
  const c = countLoad(rows, s.fps, s.frames, found.map((x) => x.ids), { gap: Math.round(lines.stream.gap * s.fps), span: 2 * s.fps, sameFate: 0.8 });
  let overNew = 0;
  let overPull = 0;
  for (const p of c.perSecond) {
    if (p.new > lines.newLine) overNew++;
    if (p.pull > lines.pullLine) overPull++;
  }
  return { seconds: c.seconds, overNew, overPull, peakNew: c.peakNew, peakPull: c.peakPull, newPerSecond: c.newPerSecond, streams: found.map((x) => ({ ids: x.ids, arrivals: x.arrivals })) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Holds: a silence is time the viewer gives the picture. It earns that time only while something on screen works toward
// the hold's purpose: the event's look, its demonstration, the things the hold's `does` names, or the prompt it shows.
// Per hold:
// - work: the share of the hold's frames in which one of those things is changing. A frozen frame, a lone pulse in a
//   three second hold, or a clock ticking beside a still picture is dead air. `holds.work` of the hold working is full
//   marks (0.5 by default: a settle hold may rest once it has moved); none scores 0.
// - focus: when unrelated things change more than the related ones, the eye is pulled off the purpose (x `distracted`).
// - a hold the case declares still (`holds.still`: the plan wants the picture to wait) is not judged on change: it scores
//   on nothing unrelated moving, 1 when nothing does, 0 when unrelated change fills `holds.work` of it.
// - a predict hold that shows its answer scores 0.
// A hold the voice talks over is not a hold the viewer gets and is not judged here (the audio check reports it).

export type HoldWork = { id: string; purpose: string; seconds: number; still: boolean; work: number; other: number; answered: boolean; score: number };

export function holdWork(p: Project, s: Samples, ids: IdMap, attached: Map<string, string[]>, set: Settings["holds"] = DEFAULTS.holds): HoldWork[] {
  const out: HoldWork[] = [];
  const answered = new Set(checkPredict(s, holds(p.direction!, p.narration!), ids).map((t) => t.note.match(/Hold (\S+) /)?.[1]));
  for (const h of holds(p.direction!, p.narration!).filter((x) => x.voiced)) {
    const [from, to] = [Math.round(h.start * s.fps), Math.min(s.frames, Math.round(h.end * s.fps))];
    if (to <= from) continue;
    const ev = ids.events[h.event];
    const prompts = h.shows ? s.ids.filter((id) => (s.reads.get(id) ?? []).some((r) => says(r.text, h.shows!))) : [];
    const named = [...(ev?.look ?? []), ...(ev?.demo ?? []), ...(ev?.holds?.[h.id]?.does ?? []), ...prompts];
    const related = s.ids.map((id, r) => ({ id, r })).filter((x) => belongs(x.id, named, attached));
    const others = s.ids.map((id, r) => ({ id, r })).filter((x) => !belongs(x.id, named, attached));
    let mine = 0;
    let other = 0;
    for (let f = from; f < to; f++) {
      if (related.some((x) => s.active[x.r]![f])) mine++;
      if (others.some((x) => s.active[x.r]![f])) other++;
    }
    const n = to - from;
    const work = mine / n;
    const isAnswered = answered.has(h.id);
    const still = set.still.includes(h.id);
    const score = isAnswered ? 0 : still ? clamp(1 - other / n / set.work) : clamp(work / set.work) * (other > mine ? set.distracted : 1);
    out.push({ id: h.id, purpose: h.purpose, seconds: round(n / s.fps, 1), still, work: round(work, 2), other: round(other / n, 2), answered: isAnswered, score: round(score, 2) });
  }
  return out;
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
// Phone reading: the frame as a tired viewer sees it, on a phone held at arm's length. A 1080 px wide frame is about
// 65 mm across on a phone, so 1 px is about 0.06 mm. Words a viewer reads at a glance need a cap height of about 3 mm
// at 40 cm: text of 7% of the frame's width (75 px at 1080) reads comfortably, 3.5% (38 px) not at all. The style's
// own floor (`read.text`, 3%) is a hard limit for any text; this is the bar for text meant to be read in passing.
//
// The numbers below are the defaults (settings.ts); each case's `measure.read` may set its own.
//
// Per sampled settled frame:
// - words: every line of text, weighted by its length, scores its size (3.5% to 7% of the width) times its contrast
//   against what is drawn behind it (WCAG ratio 1.5 to 4.5, after its fade), so a long line of small or faint text
//   costs more than a one-word tag.
// - density: how many characters are on screen at once (up to about 140 reads at a glance; 360 or more is a page).
// - subject: the share of the usable frame the thing to look at covers (the event's look, from the id map; without a
//   map, everything but the text). A main subject under a quarter of the frame reads as small on a phone.
// - space: the share of the usable frame with anything in it, and the tallest empty band (a frame whose bottom half is
//   empty under a small cluster looks unfinished and wastes the screen).
// - broken: words cut by the frame edge, writing on writing, or a covered picture multiply the frame by 0.4.
// - pictures: a picture shown narrower than the frame shrinks its detail with it; it counts as a short line of words,
//   legible at 95% of the frame's width and not at all at half.
// The frame scores words x (0.5 + 0.5 x (0.3 density + 0.35 subject + 0.35 space)), times 0.4 when broken: words that
// cannot be read are not saved by a good layout. `read` is the mean over settled frames.


// Colors and contrast are the instruments' (engine/design/instruments/color.ts); hex only, as this measure always read.
const rgbOf = hexRgb;
const boxArea = (r: { x0: number; y0: number; x1: number; y1: number }) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
const overlap = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a) => boxArea({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

export type PhoneFrame = { t: number; words: number; density: number; subject: number; space: number; broken: boolean; score: number; chars: number; small: string[]; faint: string[] };

export function phoneRead(scene: Scene, theme: Theme, s: Samples, lookAt?: (frame: number) => string[], PHONE: Settings["read"] = DEFAULTS.read): { frames: number; score: number; words: number; density: number; subject: number; space: number; broken: number; smallShare: number; faintShare: number; filledShare: number; emptyBand: number; examples: string[]; worst: PhoneFrame[] } {
  const W = scene.width;
  const H = scene.height;
  const paper = rgbOf(scene.background) ?? rgbOf(theme.colors.paper) ?? [255, 255, 255];
  const read = readOf(theme);
  const top = H * 0.047;
  const bottom = H * 0.812; // the bottom is left for captions
  const [cols, rows] = [9, 16];
  const cells = Array.from({ length: rows * cols }, (_, k) => {
    const [r, c] = [Math.floor(k / cols), k % cols];
    return { x0: (c * W) / cols, x1: ((c + 1) * W) / cols, y0: top + (r * (bottom - top)) / rows, y1: top + ((r + 1) * (bottom - top)) / rows };
  });
  const cellArea = boxArea(cells[0]!);
  const out: PhoneFrame[] = [];
  const raws: { filled: number; band: number }[] = [];
  let smallChars = 0;
  let faintChars = 0;
  let allChars = 0;
  for (let f = Math.round(s.fps * 0.5); f < scene.frames; f += Math.round(s.fps / 2)) {
    // A frame caught mid-change is not judged: a viewer reads what settles.
    if (s.ids.filter((_, r) => s.active[r]![f]).length > 2) continue;
    const things = inventory(scene, f).filter((t) => t.opacity >= 0.15 && !(t.kind === "shape" && boxArea(t.box) > W * H * 0.8));
    const texts = things.filter((t) => t.kind === "text" && t.opacity >= 0.5 && (t.text ?? "").trim());
    let wsum = 0;
    let wscore = 0;
    let chars = 0;
    const small: string[] = [];
    const faint: string[] = [];
    for (const t of texts) {
      const n = Math.max(4, (t.text ?? "").trim().length);
      chars += (t.text ?? "").trim().length;
      const size = clamp(((t.size ?? 0) / W - PHONE.small) / (PHONE.comfortable - PHONE.small));
      const cx = (t.box.x0 + t.box.x1) / 2;
      const cy = (t.box.y0 + t.box.y1) / 2;
      const under = things.filter((u) => u.kind === "shape" && u.filled && u.order < t.order && cx >= u.box.x0 && cx <= u.box.x1 && cy >= u.box.y0 && cy <= u.box.y1).at(-1);
      const bg = (under && rgbOf(under.color) ? blend(rgbOf(under.color)!, paper, under.opacity) : paper);
      const fg = rgbOf(t.color);
      const c = fg ? ratio(blend(fg, bg, t.opacity * (t.muted ? 0.6 : 1)), bg) : 4.5;
      const con = clamp((c - PHONE.contrastLow) / (PHONE.contrastOk - PHONE.contrastLow));
      if (size < 0.5) small.push(`"${(t.text ?? "").slice(0, 24)}" ${Math.round(((t.size ?? 0) * 1080) / W)} px`);
      if (con < 0.5) faint.push(`"${(t.text ?? "").slice(0, 24)}" ${c.toFixed(1)}:1`);
      wsum += n;
      wscore += n * size * con;
      allChars += n;
      if (size < 0.5) smallChars += n;
      if (con < 0.5) faintChars += n;
    }
    // A picture is read too: shown narrower than the frame, its detail (a sketch's labels, a slide's lines) shrinks with
    // it. Each counts as much as a short line of words, full at 95% of the width, nothing at half.
    for (const t of things.filter((u) => u.kind === "image" && u.opacity >= 0.5 && boxArea(u.box) > W * H * 0.02)) {
      const share = clamp(((t.box.x1 - t.box.x0) / W - PHONE.pictureLow) / (PHONE.pictureFull - PHONE.pictureLow));
      if (share < 0.5) small.push(`picture ${t.id} ${Math.round(((t.box.x1 - t.box.x0) / W) * 100)}% wide`);
      wsum += PHONE.pictureWeight;
      wscore += PHONE.pictureWeight * share;
      allChars += PHONE.pictureWeight;
      if (share < 0.5) smallChars += PHONE.pictureWeight;
    }
    const words = wsum ? wscore / wsum : 1;
    const density = clamp(1 - (chars - PHONE.glance) / (PHONE.page - PHONE.glance));
    const covered = (list: typeof things) => cells.filter((cell) => list.some((t) => overlap(t.box, cell) > cellArea * 0.15)).length / cells.length;
    const look = lookAt?.(f) ?? [];
    const lookThings = look.length ? things.filter((t) => look.some((id) => t.id === id || t.id.startsWith(`${id}.`))) : things.filter((t) => t.kind !== "text");
    const subject = clamp(covered(lookThings.length ? lookThings : things) / PHONE.subject);
    const used = cells.map((cell) => things.some((t) => overlap(t.box, cell) > cellArea * 0.15) || keptAt(scene, f).some((k) => overlap(k, cell) > cellArea * 0.15));
    const filled = used.filter(Boolean).length / cells.length;
    let band = 0;
    for (let r = 0, run = 0; r < rows; r++) {
      run = used.slice(r * cols, (r + 1) * cols).some(Boolean) ? 0 : run + 1;
      band = Math.max(band, run);
    }
    const space = clamp((filled - PHONE.filledLow) / (PHONE.filledFull - PHONE.filledLow)) * clamp(1 - Math.max(0, band / rows - PHONE.band) / PHONE.bandSpan);
    const found = measureLayout(things, W, H, read, false, keptAt(scene, f));
    const broken = found.some((x) => (x.kind === "off_frame" || x.kind === "overlap" || x.kind === "hidden_picture") && x.severity >= 3);
    // Words that cannot be read are not saved by a good layout: the layout scales what the words give, from half to all.
    const wt = PHONE.weights;
    const score = words * (PHONE.layoutFloor + (1 - PHONE.layoutFloor) * (wt.density * density + wt.subject * subject + wt.space * space)) * (broken ? PHONE.broken : 1);
    raws.push({ filled, band: band / rows });
    out.push({ t: round(f / s.fps, 1), words: round(words, 2), density: round(density, 2), subject: round(subject, 2), space: round(space, 2), broken, score: round(score, 2), chars, small: small.slice(0, 4), faint: faint.slice(0, 4) });
  }
  const avg = (k: keyof PhoneFrame) => round(mean(out.map((x) => Number(x[k]))), 3);
  const examples = [...new Set(out.flatMap((x) => [...x.small.map((y) => `small ${y}`), ...x.faint.map((y) => `faint ${y}`)]))].slice(0, 6);
  return {
    frames: out.length,
    score: out.length ? avg("score") : 0,
    words: avg("words"), density: avg("density"), subject: avg("subject"), space: avg("space"),
    broken: round(mean(out.map((x) => (x.broken ? 1 : 0))), 3),
    smallShare: round(allChars ? smallChars / allChars : 0, 3), faintShare: round(allChars ? faintChars / allChars : 0, 3),
    filledShare: round(mean(raws.map((x) => x.filled)), 3), emptyBand: round(mean(raws.map((x) => x.band)), 3),
    examples,
    worst: [...out].sort((a, b) => a.score - b.score).slice(0, 3),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Depiction: does the picture show the thing, or a box with its name in it? Two signals from the scene source, the same
// for every case; the watch test (`watch-depict.md`) asks a viewer the same question of the finished clip.
//
// - drawn: each thing the picture holds is scored as itself (1), a bare symbol (0.5) or a word in a shape (0). Itself:
//   a drawing made by a program, a picture, a graph, a kit's notation or code (code and notation are the things they
//   show). A symbol: a shape with no name on it (a dot for a drop, a ring for a cell). A word in a shape: a box, circle,
//   pill, diamond or triangle whose label, or a tag on it, names it in a few words ("HEART", "flask"). Values are not
//   names: a shape holding a number or a formula is a cell of a diagram, a symbol.
// - changes: each change of state the scene makes is shown (a move, a recolor, a level, a drawing that grows, a kit's
//   step) or told (a shape's label rewritten, a tag added to a thing already on screen, a counter). Emphasis (a pulse, a
//   shake) is neither. The share shown is the signal.
// `free` is their mean; a scene with no picture at all scores 0 on `drawn` (every thing is a word).

const NAMED_SHAPES = new Set(["box", "circle", "pill", "diamond", "tri"]);
const EMPHASIS = new Set(["pulse", "shake", "wiggle", "jiggle", "bounce", "nod", "glow", "flash", "blink"]);
const TELLING = new Set(["count", "type", "write", "spell"]);
const isName = (text: string | undefined) => {
  const t = (text ?? "").trim();
  if (!t || !/\p{L}{2}/u.test(t)) return false;
  if (/[=×÷<>^]/.test(t) || /\d/.test(t.replace(/\d+(st|nd|rd|th)\b/g, ""))) return false;
  return t.split(/\s+/).length <= 4;
};

export type Depict = { drawn?: number; changes?: number; free?: number; units: { id: string; kind: string; as: "itself" | "symbol" | "word"; text?: string }[]; shown: string[]; told: string[] };

export function depictFree(source: string, kinds: string[], set: Settings["depict"] = DEFAULTS.depict): Depict {
  const { doc } = parse(source, kinds);
  const units = new Map<string, Depict["units"][number]>();
  const firstState = new Map<string, number>();
  const lastText = new Map<string, string | undefined>();
  const lastAttrs = new Map<string, string>();
  const shown: string[] = [];
  const told: string[] = [];
  const LOOKS = ["fill", "color", "stroke", "w", "h", "x", "y", "at", "size", "rotate", "opacity", "scale"];
  doc.states.forEach((st, k) => {
    const walk = (items: Item[]) => {
      for (const it of items) {
        if (it.children?.length && !NAMED_SHAPES.has(it.kind)) walk(it.children);
        const leaf = NAMED_SHAPES.has(it.kind) || it.kind === "dot" || ["image", "graph", "run", "code"].includes(it.kind) || kinds.includes(it.kind);
        if (!leaf) continue;
        const looks = LOOKS.map((a) => `${a}=${it.attrs[a] ?? ""}`).join(" ");
        if (!units.has(it.id)) {
          const as = NAMED_SHAPES.has(it.kind) ? (isName(it.text) ? "word" : "symbol") : it.kind === "dot" ? "symbol" : "itself";
          units.set(it.id, { id: it.id, kind: it.kind, as, ...(it.text ? { text: it.text } : {}) });
          firstState.set(it.id, k);
        } else {
          if ((it.text ?? "") !== (lastText.get(it.id) ?? "") && it.text) told.push(`${it.id} relabelled "${it.text}"`);
          else if (looks !== lastAttrs.get(it.id)) shown.push(`${it.id} redrawn`);
        }
        if (it.kind === "run") shown.push(`${it.id} runs ${it.program ?? ""}`.trim());
        lastText.set(it.id, it.text);
        lastAttrs.set(it.id, looks);
      }
    };
    walk(st.items);
    for (const c of st.commands) {
      if (c.do === "tag") {
        const u = units.get(c.target);
        if (u && u.as === "symbol" && NAMED_SHAPES.has(u.kind) && isName(c.text) && firstState.get(c.target) === k) u.as = "word";
        else if (u && (firstState.get(c.target) ?? k) < k) told.push(`tag "${c.text}" on ${c.target}`);
      } else if (c.do === "set") {
        if (Object.keys(c.attrs).some((a) => a !== "text")) shown.push(`set ${c.targets.join(",")}`);
        if (c.attrs.text) told.push(`set text on ${c.targets.join(",")}`);
      } else if (c.do === "play") {
        if (EMPHASIS.has(c.behavior)) continue;
        (TELLING.has(c.behavior) ? told : shown).push(`do ${c.behavior} ${c.targets.join(",")}`);
      }
    }
  });
  const list = [...units.values()];
  const score = { itself: 1, symbol: set.symbol, word: 0 };
  const drawn = list.length ? mean(list.map((u) => score[u.as])) : source.trim() ? 0 : undefined;
  const changes = shown.length + told.length ? shown.length / (shown.length + told.length) : undefined;
  const parts = [drawn, changes].filter((x): x is number => x !== undefined);
  return { drawn: drawn === undefined ? undefined : round(drawn), changes: changes === undefined ? undefined : round(changes), free: parts.length ? round(mean(parts)) : undefined, units: list, shown: shown.slice(0, 12), told: told.slice(0, 12) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Everything for one case.

export function measureCase(p: Project, scene: Scene, source: string, theme: Theme, raw?: Mapped, set: Settings = DEFAULTS): CaseMeasure {
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
  const eye = report ? mean(eyeRows.filter((r) => !unmapped.includes(r.event) && !set.look.hidden.includes(r.event)).map((r) => r.share)) : undefined;

  // lag
  const ms = mentions(p, s, set.lag);
  const named = ms.length ? mean(ms.map((m) => (m.outcome === "in_time" ? 1 : m.outcome === "late" || m.outcome === "already" ? 0.5 : 0))) : undefined;
  const on = ids ? onsets(p, s, ids, attached, set.lag) : [];
  const onset = on.length ? mean(on.map((x) => lagScore(x.lag, set.lag))) : undefined;
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
  const variation = clamp(cvRates / (new Set(rates.map((r) => r.rhythm)).size > 1 ? set.pace.varied : FLAT));
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
  const ld = load(s, set.load, scene);
  const loadScore = clamp(1 - (ld.overNew + ld.overPull) / ld.seconds);

  // holds
  const hw = ids ? holdWork(p, s, ids, attached, set.holds) : [];
  const holdScore = hw.length ? mean(hw.map((h) => h.score)) : undefined;

  // reveal
  const withholds = plan.events.filter((e) => e.withhold).length;
  const early = has("withheld_early");
  const promise = has("promise_missing");
  const reveal = report ? mean([...(withholds ? [clamp(1 - early.filter((t) => t.severity >= 3).length / withholds)] : []), promise.length ? 0 : 1]) : undefined;

  // read: the layout checks (kept as `layout` for comparison) and the phone reading, which is the score.
  const rd = readability(scene, theme, s);
  const layoutScore = clamp(1 - (rd.severe + 0.4 * rd.mild) / Math.max(1, rd.frames));
  const eventAt = (f: number) => list.find((x) => f >= x.from && f < x.to)?.event.id;
  const phone = phoneRead(scene, theme, s, ids ? (f) => ids.events[eventAt(f) ?? ""]?.look ?? [] : undefined, set.read);
  const read = phone.score;

  // depict (the free signals; the report blends in the watch test)
  const dp = depictFree(source, kinds, set.depict);

  const scores: Scores = { lag: round(lag), pace: round(pace), load: round(loadScore), read: round(read), ...(dp.free !== undefined ? { depict: dp.free } : {}), ...(eye !== undefined ? { eye: round(eye) } : {}), ...(holdScore !== undefined ? { holds: round(holdScore) } : {}), ...(reveal !== undefined ? { reveal: round(reveal) } : {}) };
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
      depict: dp,
      holds: hw,
      read: { ...phone, layout: { score: round(layoutScore), ...rd } },
    },
    tickets: (report?.tickets ?? []).map((t) => ({ kind: t.kind, severity: t.severity, note: t.note })),
  };
}

export const failed = (id: string, why: string): CaseMeasure => ({ id, built: false, scores: { lag: 0, pace: 0, load: 0, read: 0 }, overall: 0, raw: { why }, tickets: [] });
