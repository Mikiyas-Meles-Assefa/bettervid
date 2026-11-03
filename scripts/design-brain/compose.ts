// The intent composer: the author says what matters, the engine decides composition, size, motion, timing and direction.
// Reads <momentDir>/request.json (words with start seconds, frames) and <momentDir>/intent.txt (the intent language of
// intent-prompt.md), writes <out>.scene.json (a compiled Scene for render.ts) and <out>.notes.txt (parse problems and
// every decision the composer made, one line each).
// Usage: node --experimental-strip-types scripts/design-brain/compose.ts <momentDir> [style=flat] [out=intent]
// Everything here is general: no word, topic or example is special-cased. Output is a SceneDoc of group, path and text
// only, with theme color names and roles, compiled by the engine's own compile().
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "../../engine/core/compile.ts";
import { roleLook } from "../../engine/core/roles.ts";
import type { Ease, NodeSpec, Props, SceneDoc, Step, Value } from "../../engine/core/types.ts";
import { estimate, safeArea, wrap, type Measure } from "../../engine/language/layout.ts";
import { fontMeasure } from "../../engine/language/measure.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import { buretteReading, colorOf, liquidPoly, mouthOf, propNodes, resolve, surfaceY, tipOf, withAlpha, type Prop } from "./depict.ts";

const FPS = 30;
const W = 1080;
const H = 1920;
const CUE = 9; // frames a change starts before its word: the eye lands as the word is said

// ---------------------------------------------------------------------------------------------------------------
// 1. Parsing the intent language. Lenient: anything unknown is a note.
// ---------------------------------------------------------------------------------------------------------------
type Def = { id: string; text: string; many?: { n: number; unit: string }; obj?: Prop; desc?: string };
// What an object does in a moment, in the author's verbs.
type Act = { verb: "flow" | "turns" | "flashes" | "moves" | "falls" | "fills" | "reads" | "runs"; ids: string[]; to?: string; arg?: string; fast?: boolean; slow?: boolean; line: number };
type Pace = "slow" | "normal" | "fast";
type Mom = {
  word: number; line: number; show?: string; extraShow: string[]; keep: string[]; becomes: { id: string; text?: string; n?: number }[];
  from: { a: string; b: string }[]; compare?: [string, string]; arrows: { a: string; b: string; label: string }[];
  ask?: string; reveal?: string; wrong: string[]; stress: boolean; pace: Pace; plain?: boolean; acts: Act[];
};

const quoted = (s: string) => /"([^"]*)"/.exec(s)?.[1];
const ID = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/; // a name, or a picture's name and one of its parts

function parse(src: string, notes: string[]) {
  const defs = new Map<string, Def>();
  let feel = "warm";
  let audience = "new";
  const moments: Mom[] = [];
  let cur: Mom | undefined;
  src.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/[“”]/g, '"').trim();
    const ln = i + 1;
    if (!line || line.startsWith("```") || line.startsWith("#")) return;
    const at = /^@\s*(\d+)/.exec(line);
    if (at) {
      cur = { word: Number(at[1]), line: ln, extraShow: [], keep: [], becomes: [], from: [], arrows: [], wrong: [], stress: false, pace: "normal", acts: [] };
      moments.push(cur);
      return;
    }
    const head = line.split(/\s+/)[0]!;
    const key = head.toLowerCase();
    const rest = line.slice(head.length).trim();
    const ids = (s: string) => s.split(/[\s,]+/).filter(Boolean).filter((x) => (ID.test(x) ? true : (notes.push(`line ${ln}: "${x}" is not an id, ignored`), false)));
    if (key === "feel") feel = rest.split(/\s+/)[0]!.toLowerCase();
    else if (key === "for") audience = rest.split(/\s+/)[0]!.toLowerCase();
    else if (key === "thing") {
      const m = /^(\w+)\s*(.*)$/.exec(rest);
      if (!m) return void notes.push(`line ${ln}: thing needs an id and a text, ignored`);
      defs.set(m[1]!, { id: m[1]!, text: quoted(m[2]!) ?? (m[2]!.trim() || m[1]!) });
    } else if (key === "object") {
      const m = /^(\w+)\s*(.*)$/.exec(rest);
      if (!m) return void notes.push(`line ${ln}: object needs an id and a description, ignored`);
      const desc = quoted(m[2]!) ?? (m[2]!.trim() || m[1]!);
      defs.set(m[1]!, { id: m[1]!, text: m[1]!, obj: resolve(desc), desc });
    } else if (key === "many") {
      const m = /^(\w+)\s+(\d+)\s*(.*)$/.exec(rest);
      if (!m) return void notes.push(`line ${ln}: many needs an id, a count and a unit, ignored`);
      const unit = quoted(m[3]!) ?? (m[3]!.trim() || "item");
      defs.set(m[1]!, { id: m[1]!, text: m[1]!, many: { n: Math.max(1, Number(m[2])), unit } });
    } else if (!cur) notes.push(`line ${ln}: "${line}" comes before the first moment, ignored`);
    else if (key === "show") {
      const [first, ...more] = ids(rest);
      if (!first) return;
      if (cur.show) cur.extraShow.push(first);
      else cur.show = first;
      cur.extraShow.push(...more);
    } else if (key === "keep") cur.keep.push(...ids(rest));
    else if (key === "compare") {
      const [a, b] = ids(rest);
      if (a && b) cur.compare = [a, b];
      else notes.push(`line ${ln}: compare needs two ids, ignored`);
    } else if (key === "reveal") cur.reveal = ids(rest)[0] ?? cur.reveal;
    else if (key === "wrong") cur.wrong.push(...ids(rest));
    else if (key === "stress") cur.stress = true;
    else if (key === "plain") cur.plain = true;
    else if (key === "pace") {
      const p = rest.toLowerCase();
      if (p === "slow" || p === "normal" || p === "fast") cur.pace = p;
      else notes.push(`line ${ln}: pace "${rest}" is not slow, normal or fast, ignored`);
    } else if (key === "ask") cur.ask = quoted(rest) ?? (rest || undefined);
    else {
      let m: RegExpExecArray | null;
      const act = (a: Omit<Act, "line">) => cur!.acts.push({ ...a, line: ln });
      const arg = (t: string | undefined) => (t === undefined ? undefined : quoted(t) ?? (t.trim() || undefined));
      if ((m = /^([\w.]+)\s+(drips|pours|flows|drains|drops)\s+into\s+([\w.]+)\s*(.*)$/i.exec(line))) act({ verb: "flow", ids: [m[1]!], to: m[3]!, fast: /fast|quick|stream/i.test(m[4]!) || /pours|flows/i.test(m[2]!), slow: /slow|one|drop by drop/i.test(m[4]!) });
      else if ((m = /^([\w.]+)\s+(turns|changes to|goes)\s+(.*)$/i.exec(line))) act({ verb: "turns", ids: [m[1]!], arg: arg(m[3]) });
      else if ((m = /^([\w.]+)\s+(flashes|blushes|glows)\s*(.*)$/i.exec(line))) act({ verb: "flashes", ids: [m[1]!], arg: arg(m[3]) });
      else if ((m = /^([\w.]+)\s+(swirls|shakes|spins|rocks|wobbles|stirs)\b.*$/i.exec(line))) act({ verb: "moves", ids: [m[1]!], arg: m[2]!.toLowerCase() });
      else if ((m = /^((?:[\w.]+\s+)+?)(falls?|drops?|fall together|drop together)\s*(together)?\s*$/i.exec(line))) act({ verb: "falls", ids: m[1]!.trim().split(/\s+/) });
      else if ((m = /^([\w.]+)\s+(fills|empties|rises|drains)\s*(.*)$/i.exec(line))) act({ verb: "fills", ids: [m[1]!], arg: /empties|drains/i.test(m[2]!) ? "0%" : arg(m[3]) });
      else if ((m = /^([\w.]+)\s+reads\s*(.*)$/i.exec(line))) act({ verb: "reads", ids: [m[1]!], arg: arg(m[2]) });
      else if ((m = /^([\w.]+)\s+(runs|counts|ticks)\s*(.*)$/i.exec(line))) act({ verb: "runs", ids: [m[1]!], arg: arg(m[3]) });
      else if ((m = /^(\w+)\s+becomes\s+(.*)$/i.exec(line)) && defs.get(m[1]!)?.obj) act({ verb: "turns", ids: [m[1]!], arg: arg(m[2]) });
      else if ((m = /^(\w+)\s+becomes\s+(.*)$/i.exec(line))) {
        const v = m[2]!.trim();
        if (/^\d+(\.\d+)?$/.test(v)) cur.becomes.push({ id: m[1]!, n: Number(v) });
        else cur.becomes.push({ id: m[1]!, text: quoted(v) ?? v });
      } else if ((m = /^([\w.]+)\s+from\s+([\w.]+)\s*$/i.exec(line))) cur.from.push({ a: m[1]!, b: m[2]! });
      else if ((m = /^([\w.]+)\s*->\s*([\w.]+)\s*(.*)$/.exec(line))) cur.arrows.push({ a: m[1]!, b: m[2]!, label: quoted(m[3]!) ?? "" });
      else notes.push(`line ${ln}: unknown line "${line}", ignored`);
    }
  });
  return { defs, feel, audience, moments };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Setup: theme, measuring, colors.
// ---------------------------------------------------------------------------------------------------------------
const [dir, styleArg = "flat", outName = "intent"] = process.argv.slice(2);
if (!dir) throw new Error("usage: compose.ts <momentDir> [style] [out]");
const notes: string[] = [];
const theme = themeFrom(styleArg);
let measure: Measure;
try {
  measure = fontMeasure(theme);
} catch (e) {
  measure = estimate;
  notes.push(`fonts could not be measured (${(e as Error).message.slice(0, 60)}), the built-in estimate is used`);
}
const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8")) as { words: { text: string; start: number }[]; frames: number; assets?: Record<string, string> };
const FRAMES: number = request.frames;
const parsed = parse(readFileSync(join(dir, process.env.INTENT ?? "intent.txt"), "utf8"), notes); // INTENT picks another plan file
const defs = parsed.defs;
const feelMul = /calm|serious/.test(parsed.feel) ? 1.15 : /bold|playful/.test(parsed.feel) ? 0.85 : 1;

const nm = (role: Parameters<typeof roleLook>[1]) => roleLook(theme, role).color ?? "ink";
const FONT = roleLook(theme, "title").font ?? "title";
const C = { subject: nm("title"), answer: nm("answer"), key: nm("key"), wrong: nm("wrong"), heading: nm("heading"), muted: roleLook(theme, "muted").color ?? nm("title"), pointer: nm("pointer") };
const SUP_OP = Math.min(0.8, Math.max(0.55, roleLook(theme, "muted").opacity ?? 0.6));
const em = (t: string) => measure(t, 100, FONT) / 100;

// Layout geometry
const SAFE = safeArea(W, H);
const SW = SAFE.w * 0.94; // a little under the safe width: glow and tracking make real words wider than measured
const Y_TOP = SAFE.y - SAFE.h / 2;
const Y_BOT = Math.min(SAFE.y + SAFE.h / 2, H * 0.78); // the bottom 22% is kept clear for captions and phone UI
const Y0 = Y_TOP + 0.47 * (Y_BOT - Y_TOP); // optical center: just above the middle of the region that is kept clear of UI
const MIN_FS = 0.045 * W;
const STAGE_TOP = Y_TOP + 0.13 * (Y_BOT - Y_TOP);

// ---------------------------------------------------------------------------------------------------------------
// 3. Timing that follows the voice.
// ---------------------------------------------------------------------------------------------------------------
const wordStart = (n: number) => request.words[Math.min(Math.max(0, n), request.words.length - 1)]!.start;
const paceMul = (p: Pace) => (p === "slow" ? 1.4 : p === "fast" ? 0.7 : 1);
const durMove = (px: number, p: Pace) => Math.max(1, Math.round(Math.min(28, Math.max(10, 10 + 0.35 * Math.sqrt(px))) * paceMul(p) * feelMul));

// Pictures the user gave: a name, a file, a size and named parts (boxes as fractions of the picture).
// A picture that is a chart may carry its data (from the user's data file, or read off the picture): then the engine can
// redraw it in the style, every bar addressable, starting exactly on the original's bars.
type ChartData = { kind: "bars"; orient?: "v" | "h"; title?: string; xname?: string; labels: string[]; values: number[]; ymax: number; plot: [number, number, number, number]; barFrac?: number; texts?: Record<string, string> };
type Pic = { name: string; src: string; w: number; h: number; about: string; parts: Map<string, [number, number, number, number]>; data?: ChartData; barsOf: Map<string, number[]> };
const pics = new Map<string, Pic>();
{
  let material: Record<string, { size?: [number, number]; about?: string; parts?: Record<string, { box: [number, number, number, number] }>; data?: ChartData }> = {};
  try {
    material = JSON.parse(readFileSync(join(dir, "material.json"), "utf8"));
  } catch {}
  for (const [name, file] of Object.entries(request.assets ?? {})) {
    const bytes = readFileSync(join(dir, file));
    const png = bytes.length > 24 && bytes.toString("latin1", 1, 4) === "PNG";
    const size = material[name]?.size ?? (png ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : [1000, 750]);
    const mime = file.toLowerCase().endsWith(".png") ? "png" : "jpeg";
    const parts = new Map(Object.entries(material[name]?.parts ?? {}).map(([k, v]) => [k, v.box] as [string, [number, number, number, number]]));
    const data = material[name]?.data;
    // A part of a chart with data is the bars whose centers fall inside the part's box.
    const barsOf = new Map<string, number[]>();
    if (data) {
      const n = data.values.length;
      const [px0, , px1] = data.plot;
      const [, py0, , py1] = data.plot;
      for (const [part, [u0, v0, u1, v1]] of parts) {
        const idx = data.values.map((_, i) => i).filter((i) => {
          // A bar's center in the picture: along the plot for vertical bars, down the plot for horizontal ones.
          const [u, v] = data.orient === "h" ? [px0 + (((data.values[i]! / data.ymax) * (px1 - px0)) / 2), py0 + ((i + 0.5) * (py1 - py0)) / n] : [px0 + ((i + 0.5) * (px1 - px0)) / n, (py0 + py1) / 2];
          return u >= u0 && u <= u1 && (data.orient !== "h" || (v >= v0 && v <= v1));
        });
        if (idx.length) barsOf.set(part, idx);
      }
      notes.push(`picture ${name} is a chart with its data (${n} bars): it is shown as it is first, then redrawn in the style on its own bars`);
    }
    pics.set(name, { name, src: `data:image/${mime};base64,${bytes.toString("base64")}`, w: size[0], h: size[1], about: material[name]?.about ?? "", parts, data, barsOf });
    if (!material[name]) notes.push(`picture ${name} has no material entry: it is a picture with no parts`);
  }
}
// "name" or "name.part" for a picture; undefined for an ordinary thing.
const pr = (id: string | undefined): { name: string; part?: string } | undefined => {
  if (!id) return undefined;
  const [a, b] = id.split(".");
  return pics.has(a!) ? { name: a!, part: b } : undefined;
};
// Unknown parts fall back to the whole picture; dotted ids that are not pictures become plain names.
const canon = (id: string | undefined, where: string): string | undefined => {
  if (!id) return id;
  const r = pr(id);
  if (!r) return id.includes(".") ? (notes.push(`${where} "${id}" is not a picture part: read as "${id.replace(/\./g, "_")}"`), id.replace(/\./g, "_")) : id;
  if (r.part === undefined || pics.get(r.name)!.parts.has(r.part)) return id;
  notes.push(`${where} picture ${r.name} has no part "${r.part}": the whole picture is used`);
  return r.name;
};
for (const m of parsed.moments) {
  const w = `@${m.word}`;
  m.show = canon(m.show, w);
  m.extraShow = m.extraShow.map((x) => canon(x, w)!);
  m.keep = m.keep.map((x) => canon(x, w)!);
  m.reveal = canon(m.reveal, w);
  m.wrong = m.wrong.map((x) => canon(x, w)!);
  m.from = m.from.map((x) => ({ a: canon(x.a, w)!, b: canon(x.b, w)! }));
  m.arrows = m.arrows.map((x) => ({ ...x, a: canon(x.a, w)!, b: canon(x.b, w)! }));
  if (m.compare) m.compare = [canon(m.compare[0], w)!, canon(m.compare[1], w)!];
  m.acts = m.acts.map((a) => ({ ...a, ids: a.ids.map((x) => canon(x, w)!), to: a.to ? canon(a.to, w) : undefined }));
  m.becomes = m.becomes.filter((b) => !pics.has(b.id) || (notes.push(`${w} a picture cannot become something else: ignored`), false));
}
// Declare unknown ids as things whose text is the id.
for (const m of parsed.moments) {
  const used = [m.show, ...m.extraShow, ...m.keep, ...m.becomes.map((b) => b.id), ...m.from.flatMap((f) => [f.a, f.b]), ...(m.compare ?? []), ...m.arrows.flatMap((a) => [a.a, a.b]), m.reveal, ...m.wrong, ...m.acts.flatMap((a) => [...a.ids, a.to])];
  for (const id of used) if (id && !pr(id) && !defs.has(id)) (defs.set(id, { id, text: id }), notes.push(`@${m.word} "${id}" was never declared: made a thing whose text is "${id}"`));
}
for (const m of parsed.moments) if (m.word >= request.words.length || m.word < 0) notes.push(`@${m.word} is not a word of the narration (0 to ${request.words.length - 1}): moved to the nearest word`);
const sorted = parsed.moments.map((m, i) => ({ m, i })).sort((a, b) => Math.min(a.m.word, request.words.length - 1) - Math.min(b.m.word, request.words.length - 1) || a.i - b.i).map((x) => x.m);
if (sorted.some((m, i) => m !== parsed.moments[i])) notes.push("moments were not in word order: sorted by word");

// A number in a text, and what it counts: a symbol ($ % and the like) is a unit by itself, otherwise the word after it.
const numOf = (t: string) => {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(t);
  if (!m) return undefined;
  const symbols = t.replace(m[0], "").replace(/[^$%\u20ac\u00a3]/g, "");
  const after = t.slice(m.index + m[0].length).trim().split(/\s+/)[0]!.toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");
  return { v: Number(m[0].replace(/,/g, "")), unit: symbols || after };
};
const subjectOf = (m: Mom): string | undefined => m.reveal ?? m.show ?? m.becomes[0]?.id ?? m.arrows[0]?.b ?? m.wrong[0];
// A moment that demonstrates (things fall) holds until the demonstration has landed and been seen.
const dwellOf = (m: Mom) => Math.round(Math.max(m.pace === "slow" ? 1.5 : m.pace === "fast" ? 0.7 : 1.0, m.reveal || m.ask || m.stress ? 1.4 : 0) * FPS) + (m.acts.some((a) => a.verb === "falls") ? 60 : 0);
const tag = (m: Mom) => `@${m.word}`;

type FM = { m: Mom; onset: number; carry: string[]; becomes: Mom["becomes"]; wrong: string[]; k: number; acts: Act[] };
const fms: FM[] = [];
for (const m of sorted) {
  const nominal = Math.max(1, Math.round(wordStart(m.word) * FPS) - CUE);
  const fm: FM = { m, onset: nominal, carry: [], becomes: m.becomes, wrong: m.wrong, k: 0, acts: m.acts };
  for (;;) {
    const prev = fms.at(-1);
    if (!prev) break;
    const cand = Math.max(nominal, prev.onset + dwellOf(prev.m));
    const delay = cand - nominal;
    // A reveal or ask is a payoff or a pause: it is never merged away, so the next moment may wait a little longer.
    // A demonstration is never cut short: what follows waits for it to land.
    if (delay <= (prev.m.acts.some((x) => x.verb === "falls") ? 90 : prev.m.reveal || prev.m.ask ? 27 : 15)) {
      fm.onset = cand;
      if (delay > 1) notes.push(`${tag(m)} moved ${(delay / FPS).toFixed(1)} s later so ${tag(prev.m)}${prev.m.reveal ? " (reveal)" : prev.m.ask ? " (ask)" : prev.m.stress ? " (stress)" : ""} holds ${(dwellOf(prev.m) / FPS).toFixed(1)} s`);
      break;
    }
    // Too short even after a small delay: the short moment's subject becomes support in this one.
    const s = subjectOf(prev.m);
    notes.push(`${tag(prev.m)} lasts only ${((nominal - prev.onset) / FPS).toFixed(1)} s before ${tag(m)}: merged into ${tag(m)}${s ? `, "${s}" kept as support` : ""}`);
    fm.carry = [...(s ? [s] : []), ...prev.carry, ...fm.carry].filter((x, i, a) => a.indexOf(x) === i).slice(-3);
    fm.becomes = [...prev.becomes, ...fm.becomes];
    fm.wrong = [...prev.wrong, ...fm.wrong];
    fm.acts = [...prev.acts, ...fm.acts];
    fms.pop();
  }
  fms.push(fm);
}
fms.forEach((f, i) => (f.k = i));
const K = fms.length;
const onsets = fms.map((f) => Math.min(f.onset, FRAMES - 20));
if (!K) throw new Error("the intent has no moments");

// ---------------------------------------------------------------------------------------------------------------
// 4. Plan each moment: who is visible and in what role.
// ---------------------------------------------------------------------------------------------------------------
type Cls = "subject" | "support" | "question" | "ph";
type Slot = { id: string; cls: Cls; wrong: boolean; reveal: boolean; born?: string; ask?: boolean; part?: string; parts?: string[] };
type PArrow = { t: string; pic: string; part: string; to: boolean };
type Plan = { slots: Slot[]; pair?: [string, string]; partPair?: { pic: string; parts: [string, string] }; inferred?: boolean; arrows: { a: string; b: string; label: string }[]; parrows: PArrow[]; subject?: string; stress: boolean; question?: string; phFor?: string };
// Objects that act on each other form one apparatus for the whole piece (found from every moment's verbs).
const apparatus: string[][] = [];
for (const f of fms) for (const a of f.acts) {
  const g = a.verb === "flow" && a.to ? [a.ids[0]!, a.to] : a.verb === "falls" && a.ids.length > 1 ? a.ids : [];
  if (g.length > 1 && g.every((x) => defs.get(x)?.obj) && !apparatus.some((x) => g.every((y) => x.includes(y)))) apparatus.push(g);
}
const sticky = new Set<string>();
const plans: Plan[] = [];
const rank = new Map<string, number>();
const subjectEver = new Set<string>();
const sid = (id: string | undefined) => (id ? pr(id)?.name ?? id : id);
fms.forEach((f, k) => {
  const m = f.m;
  const subjRaw = subjectOf(m);
  const subj = sid(subjRaw);
  f.wrong.forEach((w) => sticky.add(w));
  const slots: Slot[] = [];
  const has = (id: string) => slots.some((s) => s.id === id);
  // Parts of pictures named as the subject or as support in this moment.
  const focusSub = new Map<string, string>();
  const focusSup = new Map<string, Set<string>>();
  const reg = (id: string, subject: boolean) => {
    const r = pr(id);
    if (!r?.part) return;
    if (subject) focusSub.set(r.name, r.part);
    else (focusSup.get(r.name) ?? focusSup.set(r.name, new Set()).get(r.name)!).add(r.part);
  };
  const add = (raw: string, cls: Cls, extra: Partial<Slot> = {}) => {
    const id = sid(raw)!;
    reg(raw, false);
    if (!has(id)) slots.push({ id, cls, wrong: sticky.has(id), reveal: m.reveal === raw, ...extra });
  };
  const q = m.ask;
  let phFor: string | undefined;
  if (q) {
    // The coming reveal (next two moments) gets a placeholder in its slot.
    for (const g of fms.slice(k + 1, k + 3)) if (g.m.reveal) { phFor = sid(g.m.reveal); break; }
    if (!phFor) notes.push(`${tag(m)} ask has no reveal in the next two moments: the question stands alone`);
  }
  if (m.show && m.reveal && m.show !== m.reveal) notes.push(`${tag(m)} has both show and reveal: "${m.show}" becomes support, "${m.reveal}" is the subject`);
  if (m.extraShow.length) notes.push(`${tag(m)} has more than one show: only "${m.show}" is the subject, ${m.extraShow.map((x) => `"${x}"`).join(", ")} kept as support`);
  if (!subj && !m.compare && !q) notes.push(`${tag(m)} has no show: nothing is the subject`);
  let pair = m.compare && m.compare[0] !== m.compare[1] ? m.compare : undefined;
  let partPair: Plan["partPair"];
  if (pair && (pr(pair[0]) || pr(pair[1]))) {
    const [ra, rb] = [pr(pair[0]), pr(pair[1])];
    if (ra?.part && rb?.part && ra.name === rb.name && pics.get(ra.name)!.data) {
      partPair = { pic: ra.name, parts: [ra.part, rb.part] };
      notes.push(`${tag(m)} compare ${pair[0]} ${pair[1]}: two parts of a chart with data, so both are lit and each gets its level line on the chart's own scale`);
    } else notes.push(`${tag(m)} compare ${pair[0]} ${pair[1]} involves a picture: both are shown and the part is outlined`);
    for (const x of pair) add(x, "support");
    pair = undefined;
  }
  const pairIsSubject = !!pair && (!subj || pair.includes(subj));
  if (q) add(`q.${k}`, "question");
  for (const x of f.carry) add(x, "support");
  for (const x of m.from.map((fr) => fr.b)) add(x, "support");
  for (const x of m.keep) add(x, "support");
  if (m.show && sid(m.show) !== subj) add(m.show, "support");
  for (const x of m.extraShow) add(x, "support");
  const plainArrows: Plan["arrows"] = [];
  const parrows: PArrow[] = [];
  for (const a of m.arrows) {
    const ra = pr(a.a);
    const rb = pr(a.b);
    if (ra && rb) {
      notes.push(`${tag(m)} arrow ${a.a} -> ${a.b} joins two picture parts: both are outlined, no arrow`);
      add(a.a, "support");
      add(a.b, "support");
    } else if (ra || rb) {
      const part = (ra ?? rb)!;
      const t = ra ? a.b : a.a;
      add(t, "support");
      add(part.part ? `${part.name}.${part.part}` : part.name, "support");
      if (part.part) parrows.push({ t, pic: part.name, part: part.part, to: !!rb });
      if (a.label) notes.push(`${tag(m)} arrow label "${a.label}" is dropped: words stay off the picture`);
    } else {
      add(a.a, "support");
      add(a.b, "support");
      plainArrows.push(a);
    }
  }
  for (const x of m.wrong) add(x, "support");
  for (const x of m.becomes) add(x.id, "support");
  for (const a of f.acts) for (const x of [...a.ids, ...(a.to ? [a.to] : [])]) if (x && sid(x) !== subj) add(x, "support");
  // An apparatus is one thing: while any part of it is on screen, the rest stays as quiet context.
  for (const g of apparatus) if (g.some((x) => has(x) || x === subj)) for (const x of g) if (!has(x) && x !== subj) (add(x, "support"), notes.push(`${tag(m)} "${x}" stays as context: it belongs to one apparatus with ${g.filter((y) => y !== x).join(", ")}`));
  if (pair) for (const x of pair) add(x, pairIsSubject ? "subject" : "support");
  if (subj) {
    const s = slots.find((x) => x.id === subj);
    if (s) s.cls = "subject";
    else add(subjRaw!, "subject");
    reg(subjRaw!, true);
  }
  if (phFor) slots.push({ id: "ph", cls: "ph", wrong: false, reveal: false });
  for (const fr of m.from) {
    const s = slots.find((x) => x.id === sid(fr.a));
    if (s) s.born = fr.b;
    else add(fr.a, "support", { born: fr.b });
  }
  for (const s of slots) {
    if (pics.has(s.id)) {
      s.part = focusSub.get(s.id);
      s.parts = [...(focusSup.get(s.id) ?? [])].filter((x) => x !== s.part);
    }
    if (s.cls === "subject") subjectEver.add(s.id);
  }
  // First appearance sets the stable order. The placeholder takes the rank its reveal will have.
  for (const s of slots) {
    const key = s.id === "ph" ? phFor! : s.id;
    if (s.cls === "question") continue;
    if (!rank.has(key)) rank.set(key, rank.size);
  }
  // Inferred comparison: two quantities of the same kind on screen together are weighed on one shared scale, unless the
  // author related them already, or a chart with data is on screen (then quantities become levels on the chart).
  let inferred = false;
  const chartOn = slots.some((sl) => pics.get(sl.id)?.data);
  if (!pair && !partPair && !chartOn && !m.plain) {
    const qs = slots
      .filter((sl) => (sl.cls === "subject" || sl.cls === "support") && defs.has(sl.id) && !defs.get(sl.id)!.many)
      .map((sl) => ({ sl, n: numOf(defs.get(sl.id)!.text) }))
      .filter((x) => x.n && x.n.v > 0 && x.n.unit);
    outer: for (let i = 0; i < qs.length; i++)
      for (let j = i + 1; j < qs.length; j++)
        if (qs[i]!.n!.unit === qs[j]!.n!.unit && qs[i]!.n!.v !== qs[j]!.n!.v) {
          const ab = [qs[i]!.sl.id, qs[j]!.sl.id].sort((x, y) => (rank.get(x) ?? 99) - (rank.get(y) ?? 99)) as [string, string];
          pair = ab;
          inferred = true;
          if (subj && ab.includes(subj)) for (const sl of slots) if (ab.includes(sl.id)) sl.cls = "subject";
          notes.push(`${tag(m)} inferred: "${defs.get(ab[0])!.text}" and "${defs.get(ab[1])!.text}" are both in ${qs[i]!.n!.unit} and on screen together, so they are compared on one scale (turn off with plain)`);
          break outer;
        }
  }
  plans.push({ slots, pair: pair && has(pair[0]) && has(pair[1]) ? (pair as [string, string]) : undefined, partPair, inferred, arrows: plainArrows, parrows, subject: subj, stress: m.stress, question: q, phFor });
});
// Which pictures ever share the frame with words: those keep the smaller stage in every moment, so the box stays put.
// Objects that act on each other are composed together in every moment both are on screen: a source over the vessel
// it drips or pours into (the tip above the mouth), things that fall together side by side at one height over a floor.
// Objects keep one size for the whole piece: a thing does not grow or shrink because it matters more now.
const flows = new Map<string, string>();
const fallGroups: string[][] = [];
const isObj = (id: string | undefined) => !!id && !!defs.get(id)?.obj;
const fallenAt: Set<string>[] = []; // per moment: objects that fell in an earlier moment
{
  const fallen = new Set<string>();
  fms.forEach((f) => {
    fallenAt.push(new Set(fallen));
    for (const a of f.acts) {
      if (a.verb === "flow" && a.to && isObj(a.ids[0]) && isObj(a.to) && !flows.has(a.ids[0]!)) (flows.set(a.ids[0]!, a.to), notes.push(`${tag(f.m)} ${a.ids[0]} drips into ${a.to}: they are composed as one apparatus, ${a.ids[0]}'s tip over ${a.to}'s mouth, whenever both are on screen`));
      if (a.verb === "falls") {
        const g = a.ids.filter(isObj);
        if (g.length && !fallGroups.some((x) => g.every((y) => x.includes(y)))) (fallGroups.push(g), notes.push(`${tag(f.m)} ${g.join(" and ")} fall: ${g.length > 1 ? "side by side, bottoms level, " : ""}over a floor with room to fall, in every moment they are on screen`));
        g.forEach((x) => fallen.add(x));
      }
    }
  });
}
const picRoom = new Set<string>();
for (const p of plans) if (p.slots.some((s) => !pics.has(s.id) && s.cls !== "question") || p.question) for (const s of p.slots) if (pics.has(s.id)) picRoom.add(s.id);
const picParts = new Map<string, Set<string>>();
for (const p of plans) for (const s of p.slots) if (pics.has(s.id)) for (const x of [s.part, ...(s.parts ?? [])]) if (x) (picParts.get(s.id) ?? picParts.set(s.id, new Set()).get(s.id)!).add(x);

// ---------------------------------------------------------------------------------------------------------------
// 5. Entities: what is drawn. Versions (becomes "text") and counts (becomes N) over time.
// ---------------------------------------------------------------------------------------------------------------
type Ent = { id: string; type: "text" | "many" | "ph" | "pic" | "obj"; texts: string[]; lines: string[][]; ems: number[]; unit: string; maxN: number; n0: number };
const ents = new Map<string, Ent>();
const key = (id: string) => (pics.has(id) ? `p.${id}` : `t.${id}`);
const verAt: Map<string, number>[] = [];
const countAt: Map<string, number>[] = [];
const textsOf = new Map<string, string[]>();
const nOf = new Map<string, number>();
for (const d of defs.values()) {
  if (d.many) nOf.set(d.id, d.many.n);
  else if (!d.obj) textsOf.set(d.id, [d.text]);
}
const maxN = new Map<string, number>(nOf);
fms.forEach((f, k) => {
  for (const b of f.becomes) {
    const d = defs.get(b.id)!;
    if (d.many) {
      if (b.n === undefined) notes.push(`${tag(f.m)} ${b.id} becomes text, but it is a many thing: ignored`);
      else (nOf.set(b.id, Math.max(0, Math.round(b.n))), maxN.set(b.id, Math.max(maxN.get(b.id) ?? 0, Math.round(b.n))));
    } else {
      const t = b.text ?? String(b.n);
      const list = textsOf.get(b.id)!;
      if (list.at(-1) !== t) list.push(t);
    }
  }
  verAt.push(new Map([...textsOf].map(([id, l]) => [id, 0])));
  countAt.push(new Map(nOf));
});
// versions in effect per moment: replay the becomes in order
{
  const ver = new Map<string, number>();
  fms.forEach((f, k) => {
    for (const b of f.becomes) {
      const d = defs.get(b.id)!;
      if (d.many) continue;
      const t = b.text ?? String(b.n);
      const list = textsOf.get(b.id)!;
      ver.set(b.id, list.indexOf(t, ver.get(b.id) ?? 0));
    }
    for (const id of textsOf.keys()) verAt[k]!.set(id, ver.get(id) ?? 0);
  });
}
const capFor = (chars: number) => Math.min(0.24 * W, Math.max(0.14 * W, 0.24 * W - Math.max(0, chars - 6) * 0.0057 * W));
// Lines are fixed per text so the thing keeps one node tree. A subject goes onto two lines when that makes it clearly larger.
function pickLines(text: string, subject: boolean): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const one = Math.max(0.2, em(text));
  if (words.length < 2) return [text];
  let best: string[] = [text];
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const w = Math.max(em(a), em(b));
    if (w < bestW) (bestW = w, (best = [a, b]));
  }
  if (subject) {
    const s1 = Math.min(capFor(text.length), SW / one);
    const s2 = Math.min(capFor(text.length), SW / bestW);
    return s2 >= 1.2 * s1 ? best : [text];
  }
  return one * 0.065 * W > SW ? best : [text];
}
for (const d of defs.values()) {
  if (d.obj) {
    ents.set(d.id, { id: d.id, type: "obj", texts: [d.text], lines: [[d.text]], ems: [1], unit: "", maxN: 0, n0: 0 });
    notes.push(`object ${d.id}: ${d.obj.why}`);
  } else if (d.many) {
    ents.set(d.id, { id: d.id, type: "many", texts: [d.text], lines: [[d.text]], ems: [1], unit: d.many.unit, maxN: Math.max(1, maxN.get(d.id) ?? d.many.n), n0: d.many.n });
  } else {
    const texts = textsOf.get(d.id)!;
    const subj = subjectEver.has(d.id);
    const lines = texts.map((t) => pickLines(t, subj));
    ents.set(d.id, { id: d.id, type: "text", texts, lines, ems: lines.map((ls) => Math.max(0.2, ...ls.map(em))), unit: "", maxN: 0, n0: 0 });
  }
}
for (const p of pics.values()) if (plans.some((pl) => pl.slots.some((s) => s.id === p.name))) ents.set(p.name, { id: p.name, type: "pic", texts: [], lines: [], ems: [], unit: "", maxN: 0, n0: 0 });
plans.forEach((p, k) => {
  if (p.question) {
    const lines = wrap(p.question, 0.075 * W, SW, measure, FONT);
    ents.set(`q.${k}`, { id: `q.${k}`, type: "text", texts: [p.question], lines: [lines], ems: [Math.max(0.2, ...lines.map(em))], unit: "", maxN: 0, n0: 0 });
  }
  if (p.phFor) ents.set("ph", { id: "ph", type: "ph", texts: ["?"], lines: [["?"]], ems: [Math.max(0.2, em("?"))], unit: "", maxN: 0, n0: 0 });
});

// ---------------------------------------------------------------------------------------------------------------
// 6. Layout: a one-column solve per moment.
// ---------------------------------------------------------------------------------------------------------------
type St = { x: number; y: number; s: number; op: number; color: string; w: number; h: number; cls: Cls; ver: number; n: number; wrong: boolean; reveal: boolean; fs: number; dotsY: number; labY: number; label: string; len: number; bar: boolean; z: number; ox: number; oy: number; sub?: string; sup?: string[]; pts: number[]; lit?: string[]; levels?: Lv[] };
type Lv = { part: string; v: number; tag: string };
type Item = { id: string; type: "text" | "ph" | "many" | "strike" | "bar" | "arrow" | "pic" | "parrow" | "card" | "vbar" | "obj"; st: St; born?: string };
const blank = (): St => ({ x: 0, y: 0, s: 1, op: 1, color: C.subject, w: 0, h: 0, cls: "support", ver: 0, n: 0, wrong: false, reveal: false, fs: 0, dotsY: 0, labY: 0, label: "", len: 0, bar: false, z: 1, ox: 0, oy: 0, pts: [] });
const LINE = 1.12; // line height in em
const PITCH = 40; // dot spacing in the dots group's own units
const gridOf = (e: Ent) => {
  const cols = Math.ceil(Math.sqrt(e.maxN));
  return { cols, rows: Math.ceil(e.maxN / cols) };
};

// Pictures are drawn at a reference size of REFW and scaled as a group. Their content group zooms and pans inside a clip.
const REFW = 1000;
const refH = (p: Pic) => (REFW * p.h) / p.w;
const DIM = 0.45;
const AVAIL = Y_BOT - Y_TOP;
// How far to zoom toward a part, and where the window centers. A small part is closed in on; a large one is only outlined.
function viewOf(p: Pic, part: string | undefined, mode: "subject" | "support") {
  const none = { z: 1, ox: 0, oy: 0 };
  const box = part ? p.parts.get(part) : undefined;
  if (!box) return none;
  const [x0, y0, x1, y1] = box;
  const bw = x1 - x0;
  const bh = y1 - y0;
  let z = bw < 0.35 ? Math.min(3, 0.55 / bw, 0.95 / bh) : 1;
  if (mode === "support") z = Math.min(1.5, z);
  if (z < 1.08) return none;
  const cu = Math.min(Math.max((x0 + x1) / 2, 0.5 / z), 1 - 0.5 / z);
  const cv = Math.min(Math.max((y0 + y1) / 2, 0.5 / z), 1 - 0.5 / z);
  return { z, ox: -z * (cu - 0.5) * REFW, oy: -z * (cv - 0.5) * refH(p) };
}
// Where a part lands on screen, given the picture's placed state.
// A chart with data, redrawn: every bar at its place, in the chart's own box (title row, plot, label row), or exactly
// on the original picture's bars (photo), which is where the redrawn bars start.
type BarR = { x0: number; y0: number; x1: number; y1: number };
function chartGeom(st: St, p: Pic, mode: "own" | "photo") {
  const d = p.data!;
  const n = d.values.length;
  const hz = d.orient === "h";
  const heads = Object.keys(d.texts ?? {});
  if (mode === "photo") {
    const pw = st.w;
    const ph = (pw * p.h) / p.w;
    const left = st.x - pw / 2;
    const top = st.y - ph / 2;
    const [u0, v0, u1, v1] = d.plot;
    const [X0, Y0p, X1, Y1] = [left + u0 * pw, top + v0 * ph, left + u1 * pw, top + v1 * ph];
    const bf = d.barFrac ?? 0.72;
    const bars: BarR[] = d.values.map((v, i) => {
      if (hz) {
        const slot = (Y1 - Y0p) / n;
        const cy = Y0p + (i + 0.5) * slot;
        return { x0: X0, x1: X0 + (v / d.ymax) * (X1 - X0), y0: cy - (slot * bf) / 2, y1: cy + (slot * bf) / 2 };
      }
      const slot = (X1 - X0) / n;
      const cx = X0 + (i + 0.5) * slot;
      return { x0: cx - (slot * bf) / 2, x1: cx + (slot * bf) / 2, y1: Y1, y0: Y1 - (v / d.ymax) * (Y1 - Y0p) };
    });
    const headY = Object.fromEntries(heads.map((h) => [h, p.parts.get(h) ? top + ((p.parts.get(h)![1] + p.parts.get(h)![3]) / 2) * ph : top]));
    return { hz, bars, axis: hz ? { x0: X0, y0: Y0p, x1: X0, y1: Y1 } : { x0: X0, y0: Y1, x1: X1, y1: Y1 }, scale: hz ? (X1 - X0) / d.ymax : (Y1 - Y0p) / d.ymax, labels: bars.map((b) => (hz ? { x: left + 0.03 * pw, y: (b.y0 + b.y1) / 2, left: true } : { x: (b.x0 + b.x1) / 2, y: b.y1 + 0.05 * ph, left: false })), heads: headY, headX: left + 0.04 * pw, pw, ph };
  }
  const left = st.x - st.w / 2;
  const top = st.y - st.h / 2;
  // Header rows: the chart's own words (its title, a total), one row each, above the plot.
  // Room for one row set large (when a header part is the subject) and the rest small, the same in every moment.
  const BIG = 0.11 * W;
  const headH = heads.length ? BIG * 1.2 + (heads.length - 1) * MIN_FS * 1.4 + 16 : 0;
  const headY = Object.fromEntries(heads.map((h, i) => [h, top + BIG * 0.6 + i * MIN_FS * 1.4]));
  if (hz) {
    // Horizontal bars, one row each: the category name above its bar, the value at the bar's end.
    const plotTop = top + headH + 16;
    const slot = (st.y + st.h / 2 - plotTop) / n;
    const valueRoom = em("0000") * MIN_FS * 1.25 + 24;
    const len = st.w - valueRoom;
    const thick = Math.max(20, Math.min(slot - MIN_FS * 1.45, slot * 0.6));
    const bars: BarR[] = d.values.map((v, i) => {
      const y0 = plotTop + i * slot + MIN_FS * 1.25;
      return { x0: left, x1: left + (v / d.ymax) * len, y0, y1: y0 + thick };
    });
    return { hz, bars, axis: { x0: left, y0: plotTop + MIN_FS, x1: left, y1: st.y + st.h / 2 }, scale: len / d.ymax, labels: bars.map((b) => ({ x: left, y: b.y0 - MIN_FS * 0.62, left: true })), heads: headY, headX: left, pw: st.w, ph: st.h };
  }
  const labH = MIN_FS * 1.6;
  const base = top + st.h - labH;
  const plotH = base - (top + headH + 24);
  const slot = st.w / n;
  const bars: BarR[] = d.values.map((v, i) => ({ x0: left + (i + 0.15) * slot, x1: left + (i + 0.85) * slot, y1: base, y0: base - (v / d.ymax) * plotH }));
  return { hz, bars, axis: { x0: left, y0: base, x1: left + st.w, y1: base }, scale: plotH / d.ymax, labels: bars.map((b) => ({ x: (b.x0 + b.x1) / 2, y: base + labH / 2 + 4, left: false })), heads: headY, headX: left, pw: st.w, ph: st.h };
}
function screenBox(st: St, p: Pic, part: string) {
  if (p.data) {
    const g = chartGeom(st, p, "own");
    const bs = (p.barsOf.get(part) ?? []).map((i) => g.bars[i]!);
    if (!bs.length) return { x0: st.x - st.w / 2, y0: st.y - st.h / 2, x1: st.x + st.w / 2, y1: st.y - st.h / 2 + MIN_FS * 1.5 };
    return { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) };
  }
  const [u0, v0, u1, v1] = p.parts.get(part)!;
  const X = (u: number) => st.x + st.s * (st.ox + st.z * (u - 0.5) * REFW);
  const Y = (v: number) => st.y + st.s * (st.oy + st.z * (v - 0.5) * refH(p));
  return { x0: X(u0), y0: Y(v0), x1: X(u1), y1: Y(v1) };
}
const roundedRect = (x0: number, y0: number, x1: number, y1: number, r: number) => `M${x0 + r} ${y0}H${x1 - r}Q${x1} ${y0} ${x1} ${y0 + r}V${y1 - r}Q${x1} ${y1} ${x1 - r} ${y1}H${x0 + r}Q${x0} ${y1} ${x0} ${y1 - r}V${y0 + r}Q${x0} ${y0} ${x0 + r} ${y0}Z`;

type Placed = { id: string; dx: number; dy: number; w: number; h: number; st: Partial<St> };
type Dec = { type: "bar" | "arrow" | "vbar"; id: string; dx: number; dy: number; len: number; color: string; owner?: string; w?: number; op?: number };
type Block = { rank: number; h: number; items: Placed[]; decor: Dec[]; subjectDy?: number };

function layoutMoment(k: number, notes2: string[]): { items: Map<string, Item>; order: string[] } {
  const plan = plans[k]!;
  const f = fms[k]!;
  const slotOf = new Map(plan.slots.map((s) => [s.id, s]));
  const verOf = (id: string) => verAt[k]!.get(id) ?? 0;
  const isStress = plan.stress;
  let FITW = SW; // the width words may fill: the column, or a caption card
  let cp = 1; // how much the picture is shrunk
  let lone = false; // the picture has the column to itself (caption mode)
  const hasExternalSubject = !!plan.subject && !(plan.pair && plan.pair.includes(plan.subject));

  const colorFor = (s: Slot, subjectLike: boolean) => (s.wrong ? C.wrong : s.reveal ? C.answer : s.cls === "question" ? C.heading : subjectLike ? C.subject : C.muted);
  const opFor = (s: Slot, subjectLike: boolean) => (s.wrong ? 0.85 : subjectLike || s.cls === "question" ? 1 : SUP_OP);

  // Text sizes for a role. cs shrinks support, cj shrinks the subject.
  const textFs = (e: Ent, ver: number, role: "subject" | "support" | "question" | "label", cs: number, cj: number, wrong: boolean, boost = false) => {
    const fit = FITW / e.ems[ver]!;
    let fs: number;
    if (role === "subject") {
      fs = Math.min(capFor(e.texts[ver]!.length), fit) * cj;
      if (boost) fs = Math.min(fs * 1.15, fit);
    } else if (role === "support") fs = Math.min(0.065 * W * cs, fit);
    else if (role === "question") fs = Math.min(0.075 * W * cs, fit);
    else fs = Math.min(0.05 * W * cs, fit);
    if (wrong) fs *= 0.85;
    return Math.max(fs, Math.min(MIN_FS, fit));
  };
  const textBox = (e: Ent, ver: number, fs: number) => ({ w: e.ems[ver]! * fs, h: e.lines[ver]!.length * LINE * fs });

  // Quantities on screen together share one dot size, so a 1 beside a 60 is one dot of the same size as the 60's dots.
  const manyZ = (s: Slot, cs: number, cj: number, paired: boolean) => (paired ? (s.cls === "subject" ? 0.3 * W * cj : 0.2 * W * cs) : s.cls === "subject" ? 0.62 * W * cj : 0.22 * W * cs);
  const commonS = (cs: number, cj: number) =>
    Math.min(Infinity, ...plan.slots.filter((s) => ents.get(s.id)?.type === "many").map((s) => manyZ(s, cs, cj, !!plan.pair?.includes(s.id)) / (Math.max(gridOf(ents.get(s.id)!).cols, gridOf(ents.get(s.id)!).rows) * PITCH)));
  let sCommon = Infinity;
  const manyBox = (e: Ent, Z: number, labelFs: number) => {
    const { cols, rows } = gridOf(e);
    const s = Math.min(Z / (Math.max(cols, rows) * PITCH), sCommon);
    const dotsW = cols * PITCH * s;
    const dotsH = rows * PITCH * s;
    const labH = LINE * labelFs;
    const h = dotsH + 24 + labH;
    return { s, w: Math.max(dotsW, 0.5 * W), h, dotsY: -h / 2 + dotsH / 2, labY: h / 2 - labH / 2 };
  };

  const buildSingle = (s: Slot, cs: number, cj: number): Block => {
    const e = ents.get(s.id)!;
    const subjectLike = s.cls === "subject";
    const ver = verOf(s.id);
    const st: Partial<St> = { cls: s.cls, wrong: s.wrong, reveal: s.reveal, ver, color: colorFor(s, subjectLike), op: opFor(s, subjectLike) };
    if (e.type === "pic") {
      // The stage: full width at its own aspect (or limited in height), the same size in every moment it shares with words.
      const p = pics.get(s.id)!;
      const asp = p.w / p.h;
      if (p.data) {
        // A chart with data is redrawn in the style: the full column width, and the same box in every moment.
        const ch = (lone || !picRoom.has(s.id) ? 0.78 : 0.68) * AVAIL * cp;
        const lit = plan.partPair?.pic === s.id ? plan.partPair.parts : s.part ? [s.part] : [];
        return { rank: -0.5, h: ch, items: [{ id: s.id, dx: 0, dy: ch / 2, w: SW, h: ch, st: { cls: s.cls, op: 1, s: 1, z: 1, ox: 0, oy: 0, sub: s.part, sup: s.parts, lit } }], decor: [], subjectDy: subjectLike ? ch / 2 : undefined };
      }
      const w = Math.min(SW, (lone || !picRoom.has(s.id) ? 0.88 : 0.55) * AVAIL * asp) * cp;
      const h = w / asp;
      const v = viewOf(p, s.part ?? s.parts?.[0], s.part ? "subject" : "support");
      return { rank: -0.5, h, items: [{ id: s.id, dx: 0, dy: h / 2, w, h, st: { cls: s.cls, op: 1, s: w / REFW, ...v, sub: s.part, sup: s.parts } }], decor: [], subjectDy: subjectLike ? h / 2 : undefined };
    }
    if (e.type === "obj") {
      const p = defs.get(s.id)!.obj!;
      const sc = Math.min((0.42 * AVAIL) / p.h, (0.8 * SW) / p.w);
      return { rank: rank.get(s.id) ?? 0, h: p.h * sc, items: [{ id: s.id, dx: 0, dy: p.h * sc, w: p.w * sc, h: p.h * sc, st: { ...objCls(s.id), s: sc } }], decor: [], subjectDy: subjectLike ? (p.h * sc) / 2 : undefined };
    }
    if (e.type === "many") {
      const Z = manyZ(s, cs, cj, false) * (s.wrong ? 0.85 : 1);
      const b = manyBox(e, Z, 0.05 * W);
      const n = countAt[k]!.get(s.id) ?? e.n0;
      return { rank: rank.get(s.id) ?? 0, h: b.h, items: [{ id: s.id, dx: 0, dy: b.h / 2, w: b.w, h: b.h, st: { ...st, s: b.s, n, dotsY: b.dotsY, labY: b.labY, label: `${e.unit} × ${n}`, fs: Z } }], decor: [], subjectDy: subjectLike ? b.h / 2 : undefined };
    }
    if (e.type === "ph") {
      const R = ents.get(plan.phFor!)!;
      const rv = verAt[Math.min(K - 1, k + 1)]!.get(R.id) ?? 0;
      let fs: number;
      if (R.type === "many") fs = 0.16 * W * cj;
      else fs = hasExternalSubject ? 0.11 * W * cs : Math.min(0.2 * W, textFs(R, rv, "subject", cs, cj, false));
      const b = textBox(e, 0, fs);
      return { rank: rank.get(plan.phFor!) ?? 0, h: b.h, items: [{ id: s.id, dx: 0, dy: b.h / 2, ...b, st: { ...st, fs, s: fs / 100, color: C.muted, op: 0.8 } }], decor: [], subjectDy: hasExternalSubject ? undefined : b.h / 2 };
    }
    const role = s.cls === "subject" ? "subject" : s.cls === "question" ? "question" : "support";
    const fs = textFs(e, ver, role, cs, cj, s.wrong, isStress && s.cls === "subject");
    const b = textBox(e, ver, fs);
    return { rank: s.cls === "question" ? -1 : rank.get(s.id) ?? 0, h: b.h, items: [{ id: s.id, dx: 0, dy: b.h / 2, ...b, st: { ...st, fs, s: fs / 100 } }], decor: [], subjectDy: subjectLike ? b.h / 2 : undefined };
  };

  const buildPair = (cs: number, cj: number, tell: boolean): Block => {
    const [a, b] = plan.pair!;
    const sa = slotOf.get(a)!;
    const sb = slotOf.get(b)!;
    const ea = ents.get(a)!;
    const eb = ents.get(b)!;
    const subjectLike = sa.cls === "subject";
    const members = [sa, sb];
    const gap = 48;
    const halfW = (SW - gap) / 2;
    const supportFs = 0.065 * W * cs;
    const texts = members.map((s) => ({ s, e: ents.get(s.id)!, ver: verOf(s.id) }));
    const manyIn = texts.some((t) => t.e.type === "many");
    const emMax = Math.max(...texts.filter((t) => t.e.type === "text").map((t) => t.e.ems[t.ver]!), 0.2);
    const nums = texts.map((t) => (t.e.type === "text" ? numOf(t.e.texts[t.ver]!) : undefined));
    const bars = !manyIn && nums[0] && nums[1] && nums[0].unit === nums[1].unit && Math.max(nums[0].v, nums[1].v) > 0;
    if (bars) {
      // Two quantities of one kind: columns side by side on one baseline, heights on one scale, each value standing on
      // its own column. The tall frame has the height for it, and a glance reads the ratio before any word.
      const colW = (SW - gap) / 2;
      const mx = Math.max(nums[0]!.v, nums[1]!.v);
      const Hb = 0.3 * H * (subjectLike ? cj : cs);
      const f0 = subjectLike ? Math.min(0.11 * W * cj, (colW * 0.96) / emMax) : Math.min(supportFs, (colW * 0.96) / emMax);
      const fsC = Math.max(f0, Math.min(MIN_FS, (colW * 0.96) / emMax));
      const sizedC = texts.map((t) => ({ ...t, fs: t.s.wrong ? fsC * 0.9 : fsC, box: textBox(t.e, t.ver, t.s.wrong ? fsC * 0.9 : fsC) }));
      const textH = Math.max(...sizedC.map((t) => t.box.h));
      const hC = textH + 24 + Hb;
      const placedC: Placed[] = [];
      const decorC: Dec[] = [];
      sizedC.forEach((t, i) => {
        const dx = (i === 0 ? -1 : 1) * (colW / 2 + gap / 2);
        const bh = Math.max(8, (nums[i]!.v / mx) * Hb);
        const st: Partial<St> = { cls: subjectLike ? "subject" : "support", wrong: t.s.wrong, reveal: t.s.reveal, ver: t.ver, color: colorFor(t.s, subjectLike), op: opFor(t.s, subjectLike), fs: t.fs, s: t.fs / 100 };
        placedC.push({ id: t.s.id, dx, dy: hC - bh - 24 - t.box.h / 2, w: t.box.w, h: t.box.h, st });
        decorC.push({ type: "vbar", id: `vbar.${t.s.id}`, dx, dy: hC, len: bh, w: colW * 0.62, color: t.s.wrong ? C.wrong : t.s.reveal ? C.answer : subjectLike ? C.subject : C.muted, op: t.s.wrong ? 0.55 : subjectLike ? 1 : 0.6, owner: t.s.id });
      });
      if (tell) notes2.push(`${tag(f.m)} compare ${a} ${b}: ${nums[0]!.v} against ${nums[1]!.v} ${nums[0]!.unit}, as two columns on one baseline and one scale, the value standing on each`);
      return { rank: Math.min(rank.get(a) ?? 0, rank.get(b) ?? 0), h: hC, items: placedC, decor: decorC, subjectDy: subjectLike ? hC - Hb / 2 : undefined };
    }
    // Compared quantities get magnitude bars; the bars need the whole column to span, so the pair is stacked.
    const side = !bars && emMax * supportFs <= halfW;
    if (tell) notes2.push(`${tag(f.m)} compare ${a} ${b}: ${side ? "side by side" : "stacked"}`);
    const region = side ? halfW : SW;
    let fs = subjectLike ? Math.min(0.1 * W * cj, region / emMax) : Math.min(supportFs, region / emMax);
    fs = Math.max(fs, Math.min(MIN_FS, region / emMax));
    if (tell && bars) notes2.push(`${tag(f.m)} compare ${a} ${b}: both are numbers, so magnitude bars were added on one scale (${nums[0]!.v} against ${nums[1]!.v}), the larger spanning most of the column`);
    const barMax = SW * 0.9;
    const barT = 0.03 * W;
    const barGap = 14;
    const extra = bars ? barGap + barT : 0;
    const placed: Placed[] = [];
    const decor: Dec[] = [];
    const sized = texts.map((t) => {
      const wrongF = t.s.wrong;
      if (t.e.type === "many") {
        const Z = (subjectLike ? 0.3 * W : 0.2 * W) * (side ? 1 : 1) * (wrongF ? 0.85 : 1) * (subjectLike ? cj : cs);
        const bx = manyBox(t.e, Math.min(Z, region * 0.9), 0.045 * W);
        return { ...t, box: { w: bx.w, h: bx.h }, many: bx };
      }
      const f2 = wrongF ? fs * 0.85 : fs;
      return { ...t, box: textBox(t.e, t.ver, f2), fs: f2, many: undefined };
    });
    const mk = (i: number, dx: number, dy: number) => {
      const t = sized[i]!;
      const st: Partial<St> = { cls: subjectLike ? "subject" : "support", wrong: t.s.wrong, reveal: t.s.reveal, ver: t.ver, color: colorFor(t.s, subjectLike), op: opFor(t.s, subjectLike) };
      if (t.many) Object.assign(st, { s: t.many.s, n: countAt[k]!.get(t.s.id) ?? t.e.n0, dotsY: t.many.dotsY, labY: t.many.labY, label: `${t.e.unit} × ${countAt[k]!.get(t.s.id) ?? t.e.n0}` });
      else Object.assign(st, { fs: t.fs, s: t.fs! / 100 });
      placed.push({ id: t.s.id, dx, dy, w: t.box.w, h: t.box.h, st });
      if (bars) {
        const mx = Math.max(nums[0]!.v, nums[1]!.v);
        const len = Math.max(10, (nums[i]!.v / mx) * barMax);
        const larger = nums[i]!.v >= Math.max(nums[0]!.v, nums[1]!.v);
        decor.push({ type: "bar", id: `bar.${t.s.id}`, dx: dx - barMax / 2, dy: dy + t.box.h / 2 + barGap + barT / 2, len, color: larger ? C.key : C.muted, owner: t.s.id });
      }
    };
    let h: number;
    if (side) {
      const hm = Math.max(sized[0]!.box.h, sized[1]!.box.h);
      mk(0, -(halfW / 2 + gap / 2), hm / 2);
      mk(1, halfW / 2 + gap / 2, hm / 2);
      h = hm + extra;
    } else {
      const h0 = sized[0]!.box.h;
      const h1 = sized[1]!.box.h;
      mk(0, 0, h0 / 2);
      mk(1, 0, h0 + extra + gap + h1 / 2);
      h = h0 + extra + gap + h1 + extra;
    }
    return { rank: Math.min(rank.get(a) ?? 0, rank.get(b) ?? 0), h, items: placed, decor, subjectDy: subjectLike ? h / 2 : undefined };
  };

  const buildArrow = (ar: { a: string; b: string; label: string }, idx: number, cs: number, cj: number): Block => {
    const A = buildSingle(slotOf.get(ar.a)!, cs, cj);
    const B = buildSingle(slotOf.get(ar.b)!, cs, cj);
    const GA = 100;
    const items: Placed[] = [{ ...A.items[0]!, dy: A.h / 2 }, { ...B.items[0]!, dy: A.h + GA + B.h / 2 }];
    const decor: Dec[] = [{ type: "arrow", id: `arrow.${ar.a}.${ar.b}`, dx: 0, dy: A.h + 15, len: 70, color: C.pointer }];
    if (ar.label) {
      const lid = `lab.${ar.a}.${ar.b}`;
      let e = ents.get(lid);
      if (!e) {
        const lines = [ar.label];
        e = { id: lid, type: "text", texts: [ar.label], lines: [lines], ems: [Math.max(0.2, em(ar.label))], unit: "", maxN: 0, n0: 0 };
        ents.set(lid, e);
      }
      const fs = Math.min(0.05 * W * cs, (SW / 2 - 50) / e.ems[0]!);
      const bx = textBox(e, 0, fs);
      items.push({ id: lid, dx: 40 + bx.w / 2, dy: A.h + GA / 2, ...bx, st: { cls: "support", color: C.muted, op: 1, fs, s: fs / 100, ver: 0 } });
    }
    const subjA = A.subjectDy !== undefined;
    const subjB = B.subjectDy !== undefined;
    return { rank: Math.min(A.rank, B.rank), h: A.h + GA + B.h, items, decor, subjectDy: subjB ? A.h + GA + B.h / 2 : subjA ? A.h / 2 : undefined };
  };

  // The blocks of a moment: a compare is one block, an arrow's two ends are one block, everything else stands alone.
  const objIn = (id: string) => slotOf.has(id) && ents.get(id)?.type === "obj";
  const objCls = (id: string): Partial<St> => ({ cls: slotOf.get(id)!.cls, op: slotOf.get(id)!.cls === "subject" || !plan.subject || !slotOf.has(plan.subject) ? 1 : 0.72, reveal: slotOf.get(id)!.reveal });
  const buildFlow = (src: string, dst: string, sats: string[]): Block => {
    const ps = defs.get(src)!.obj!;
    const pd = defs.get(dst)!.obj!;
    const ss = Math.min((0.42 * AVAIL) / ps.h, (0.5 * SW) / ps.w);
    const sd = Math.min((0.37 * AVAIL) / pd.h, (0.7 * SW) / pd.w);
    const hs = ps.h * ss;
    const hd = pd.h * sd;
    const gap = 0.035 * AVAIL;
    const items: Placed[] = [
      { id: src, dx: 0, dy: hs, w: ps.w * ss, h: hs, st: { ...objCls(src), s: ss } },
      { id: dst, dx: 0, dy: hs + gap + hd, w: pd.w * sd, h: hd, st: { ...objCls(dst), s: sd } },
    ];
    // Objects that are not part of the apparatus but are needed now (a timer, a label card) stand small beside it.
    let side = 1;
    for (const id of sats) {
      const p = defs.get(id)!.obj!;
      const sc = Math.min((0.17 * AVAIL) / p.h, (0.42 * SW - (pd.w * sd) / 2) / p.w);
      items.push({ id, dx: side * ((pd.w * sd) / 2 + 50 + (p.w * sc) / 2), dy: hs + gap + hd, w: p.w * sc, h: p.h * sc, st: { ...objCls(id), s: sc } });
      side = -side;
    }
    const subj = plan.subject && [src, dst].includes(plan.subject) ? plan.subject : undefined;
    // The apparatus is centered as a whole, whichever part is the subject, so it never shifts between moments.
    return { rank: Math.min(rank.get(src) ?? 0, rank.get(dst) ?? 0), h: hs + gap + hd, items, decor: [], subjectDy: subj ? (hs + gap + hd) / 2 : undefined };
  };
  const FALL_H = 0.6 * AVAIL;
  const buildFall = (mem: string[]): Block => {
    const props = mem.map((id) => defs.get(id)!.obj!);
    const big = Math.max(...props.map((p) => p.body?.size ?? 10));
    const D = props.map((p) => Math.max(0.15 * SW, (0.4 * SW * (p.body?.size ?? 10)) / big) * (p.kind === "ball" ? 1 : 0.8));
    const gx = 0.16 * SW;
    const total = D.reduce((a, b) => a + b, 0) + gx * (mem.length - 1);
    const Dmax = Math.max(...D);
    let x = -total / 2;
    const items: Placed[] = mem.map((id, i) => {
      const dx = x + D[i]! / 2;
      x += D[i]! + gx;
      const p = props[i]!;
      const sc = D[i]! / p.w;
      const down = fallenAt[k]!.has(id);
      return { id, dx, dy: down ? FALL_H : Dmax, w: D[i]!, h: p.h * sc, st: { ...objCls(id), s: sc, len: FALL_H - Dmax } };
    });
    const decor: Dec[] = [{ type: "bar", id: `floor.${mem.join(".")}`, dx: -SW * 0.46, dy: FALL_H + 14, len: SW * 0.92, color: C.muted, op: 0.5 }];
    return { rank: Math.min(...mem.map((id) => rank.get(id) ?? 0)), h: FALL_H + 28, items, decor, subjectDy: mem.includes(plan.subject ?? "") ? FALL_H / 2 : undefined };
  };
  const buildAll = (cs: number, cj: number, tell = false) => {
    sCommon = commonS(cs, cj);
    const used = new Set<string>();
    const blocks: Block[] = [];
    if (plan.pair) {
      blocks.push(buildPair(cs, cj, tell));
      plan.pair.forEach((x) => used.add(x));
    }
    plan.arrows.forEach((ar, i) => {
      if (!slotOf.has(ar.a) || !slotOf.has(ar.b) || ar.a === ar.b || used.has(ar.a) || used.has(ar.b)) {
        if (tell) notes2.push(`${tag(f.m)} arrow ${ar.a} -> ${ar.b} skipped: an end is already placed in another relation`);
        return;
      }
      blocks.push(buildArrow(ar, i, cs, cj));
      used.add(ar.a);
      used.add(ar.b);
    });
    for (const [src, dst] of flows) {
      if (!objIn(src) || !objIn(dst) || used.has(src) || used.has(dst)) continue;
      const grouped = new Set([...flows.keys(), ...flows.values(), ...fallGroups.flat()]);
      const sats = plan.slots.filter((sl) => objIn(sl.id) && !grouped.has(sl.id) && !used.has(sl.id)).map((sl) => sl.id);
      blocks.push(buildFlow(src, dst, sats));
      [src, dst, ...sats].forEach((x) => used.add(x));
    }
    for (const g of fallGroups) {
      const mem = g.filter((x) => objIn(x) && !used.has(x));
      if (!mem.length) continue;
      blocks.push(buildFall(mem));
      mem.forEach((x) => used.add(x));
    }
    for (const s of plan.slots) if (!used.has(s.id)) blocks.push(buildSingle(s, cs, cj));
    return blocks.sort((x, y) => x.rank - y.rank);
  };

  // Solve: largest gap on the spacing scale that fits; else shrink support, then the picture, then the subject.
  const avail = AVAIL;
  const hasPic = plan.slots.some((sl) => ents.get(sl.id)?.type === "pic");
  const subjFloor = (hasPic ? 0.09 : 0.11) * W; // with a picture the subject words may be smaller, never below 0.09W
  let chosen: { blocks: Block[]; gap: number; cs: number; cj: number; cp: number } | undefined;
  const sj = plan.slots.find((sl) => sl.cls === "subject");
  const sjEnt = sj ? ents.get(sj.id) : undefined;
  search: for (let cj = 1; cj >= 0.45; cj -= 0.05) {
    if (cj < 0.999 && sjEnt && sjEnt.type === "text" && textFs(sjEnt, verOf(sj!.id), "subject", 1, cj, false) < subjFloor) break;
    for (cp = 1; cp >= (hasPic ? 0.75 : 1) - 1e-6; cp -= 0.05) {
      for (let cs = 1; cs >= 0.69; cs -= 0.05) {
        const blocks = buildAll(cs, cj);
        const sum = blocks.reduce((t, b) => t + b.h, 0);
        for (const gap of [96, 48, 24]) {
          if (sum + gap * (blocks.length - 1) <= avail) {
            chosen = { blocks, gap, cs, cj, cp };
            break search;
          }
        }
      }
    }
  }
  const placements: { b: Block; y: number }[] = [];
  let card: Item | undefined;
  if (chosen) {
    cp = chosen.cp;
    if (chosen.cs < 1 || chosen.cj < 1 || chosen.cp < 1) notes2.push(`${tag(f.m)} column overflowed: ${[chosen.cs < 1 ? `support shrunk to ${chosen.cs.toFixed(2)}` : "", chosen.cp < 1 ? `the picture to ${chosen.cp.toFixed(2)}` : "", chosen.cj < 1 ? `the subject to ${chosen.cj.toFixed(2)}` : ""].filter(Boolean).join(", ")} of its size`);
    buildAll(chosen.cs, chosen.cj, true); // writes the compare notes once
    const { blocks, gap } = chosen;
    const total = blocks.reduce((t, b) => t + b.h, 0) + gap * (blocks.length - 1);
    // The stage (objects, or a picture or chart) stands at one fixed place for the whole piece; words take turns above
    // and below it. Things that stay never move because the words around them changed.
    const stageI = blocks.findIndex((b) => b.items.some((it) => ents.get(it.id)?.type === "obj" || ents.get(it.id)?.type === "pic"));
    const si = stageI >= 0 ? -1 : blocks.findIndex((b) => b.subjectDy !== undefined);
    let top: number;
    if (stageI >= 0) {
      const before = blocks.slice(0, stageI).reduce((t, b) => t + b.h + gap, 0);
      top = Math.max(Y_TOP, STAGE_TOP - before);
    } else if (si >= 0) {
      const before = blocks.slice(0, si).reduce((t, b) => t + b.h + gap, 0);
      top = Y0 - (before + blocks[si]!.subjectDy!);
    } else top = Y0 - total / 2;
    top = Math.min(Math.max(top, Y_TOP), Math.max(Y_TOP, Y_BOT - total));
    let y = top;
    for (const b of blocks) (placements.push({ b, y }), (y += b.h + gap));
  } else if (hasPic) {
    // No room beside the picture: the picture takes the column, and the words sit on a caption card over the part of it
    // away from the subject part.
    lone = true;
    cp = 1;
    const picSlot = plan.slots.find((sl) => ents.get(sl.id)?.type === "pic")!;
    const pb = buildSingle(picSlot, 1, 1);
    const pw = pb.items[0]!.w;
    FITW = pw * 0.94 - 48;
    const words = plan.slots.filter((sl) => !pics.has(sl.id));
    let cs = 0.85;
    let cj = 0.8;
    let tb: Block[] = [];
    for (;;) {
      sCommon = commonS(cs, cj);
      tb = words.map((sl) => buildSingle(sl, cs, cj)).sort((x, y2) => x.rank - y2.rank);
      const need = tb.reduce((t, b) => t + b.h, 0) + 24 * Math.max(0, tb.length - 1) + 40;
      if (need <= 0.42 * pb.h || (cs <= 0.7 && cj <= 0.5)) break;
      if (cs > 0.7) cs -= 0.05;
      else cj -= 0.05;
    }
    notes2.push(`${tag(f.m)} no room for words beside the picture: they sit on a caption card over the picture, away from the subject part`);
    if (plan.pair || plan.arrows.length) notes2.push(`${tag(f.m)} compare and arrows are not drawn on a caption card: the words are shown one by one`);
    const picTop = Math.min(Math.max(Y0 - pb.h / 2, Y_TOP), Math.max(Y_TOP, Y_BOT - pb.h));
    const cardH = tb.reduce((t, b) => t + b.h, 0) + 24 * Math.max(0, tb.length - 1) + 40;
    const partBox = picSlot.part ? pics.get(picSlot.id)!.parts.get(picSlot.part) : undefined;
    const partMid = partBox ? (partBox[1] + partBox[3]) / 2 : 0.7;
    const cardTop = partMid >= 0.5 ? picTop + 18 : picTop + pb.h - 18 - cardH;
    card = { id: "card", type: "card", st: { ...blank(), x: W / 2, y: cardTop + cardH / 2, len: pw * 0.94, h: cardH, op: 1 } };
    placements.push({ b: pb, y: picTop });
    let y = cardTop + 20;
    for (const b of tb) (placements.push({ b, y }), (y += b.h + 24));
  } else {
    chosen = { blocks: buildAll(0.7, 0.6), gap: 24, cs: 0.7, cj: 0.6, cp: 1 };
    notes2.push(`${tag(f.m)} the column does not fit even at the smallest sizes: it runs past the safe area`);
    let y = Y_TOP;
    for (const b of chosen.blocks) (placements.push({ b, y }), (y += b.h + 24));
  }

  const items = new Map<string, Item>();
  const order: string[] = [];
  if (card) items.set("card", card);
  for (const { b, y } of placements) {
    for (const p of b.items) {
      const e = ents.get(p.id)!;
      const type = e.type === "many" ? "many" : e.type === "ph" ? "ph" : e.type === "pic" ? "pic" : e.type === "obj" ? "obj" : "text";
      const st = { ...blank(), ...p.st, x: W / 2 + p.dx, y: y + p.dy, w: p.w, h: p.h };
      const id = p.id === "ph" ? "ph" : p.id.startsWith("q.") || p.id.startsWith("lab.") ? p.id : key(p.id);
      items.set(id, { id, type, st, born: slotOf.get(p.id)?.born ? key(sid(slotOf.get(p.id)!.born!)!) : undefined });
      order.push(id);
      // A wrong thing is struck through its first line (the value), not between its lines.
      const nl = e.type === "text" ? e.lines[st.ver]!.length : 1;
      const firstW = e.type === "text" ? em(e.lines[st.ver]![0]!) * st.fs : p.w;
      if (st.wrong) items.set(`strike.${p.id}`, { id: `strike.${p.id}`, type: "strike", st: { ...blank(), x: st.x, y: st.y - ((nl - 1) / 2) * LINE * st.fs, len: firstW + 40, color: C.wrong, op: 1 } });
    }
    for (const d of b.decor) {
      const st = { ...blank(), x: W / 2 + d.dx, y: y + d.dy, len: d.len, color: d.color, op: d.op ?? 1, w: d.w ?? 0 };
      items.set(d.id, { id: d.id, type: d.type, st });
    }
  }
  // Arrows to or from a part of a picture: drawn from the words to the part's box on screen, through the current zoom.
  const localArrows: PArrow[] = [];
  const drawPArrow = (pa: PArrow, i: number) => {
    const ti = items.get(key(pa.t));
    const pi = items.get(key(pa.pic));
    if (!ti || !pi || card) return;
    const pic = pics.get(pa.pic)!;
    const bx = screenBox(pi.st, pic, pa.part);
    const above = ti.st.y < pi.st.y;
    const clampX = (v: number, lo: number, hi: number) => Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi));
    const px = clampX(ti.st.x, bx.x0 + 10, bx.x1 - 10);
    const py = above ? bx.y1 + 6 : bx.y0 - 6;
    const sx = clampX(px, ti.st.x - ti.st.w / 2 + 12, ti.st.x + ti.st.w / 2 - 12); // leave the words from the point nearest the part
    const sy = above ? ti.st.y + ti.st.h / 2 + 12 : ti.st.y - ti.st.h / 2 - 12;
    const [x1, y1, x2, y2] = pa.to ? [sx, sy, px, py] : [px, py, sx, sy];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const dx = (x2 - x1) / len;
    const dy = (y2 - y1) / len;
    const hd = 24;
    const rot = (a: number) => [x2 - hd * (dx * Math.cos(a) - dy * Math.sin(a)), y2 - hd * (dx * Math.sin(a) + dy * Math.cos(a))];
    const L = rot(0.5);
    const R = rot(-0.5);
    const id = `parrow.${i}.${pa.t}.${pa.part}`;
    items.set(id, { id, type: "parrow", st: { ...blank(), pts: [x1, y1, x2, y2, L[0]!, L[1]!, x2, y2, R[0]!, R[1]!].map((v) => Math.round(v * 10) / 10) } });
  };
  // Charts with data: a quantity said while a part of the chart is in view becomes a level line on that part, on the
  // chart's own scale, and its words take the line's color; a part compared with another gets its remembered level.
  // A word (not a quantity) shown while one part is held is pointed at that part.
  for (const [cid, ci] of items) {
    if (ci.type !== "pic") continue;
    const pic = pics.get(cid.slice(2))!;
    if (!pic.data) continue;
    const parts = [...new Set([...(ci.st.lit ?? []), ci.st.sub, ...(ci.st.sup ?? [])].filter((x): x is string => !!x && pic.barsOf.has(x)))];
    const levels: Lv[] = [];
    for (const [tid, ti] of items) {
      if (ti.type !== "text" || !tid.startsWith("t.")) continue;
      const e = entOfKey(tid)!;
      const nv = numOf(e.texts[ti.st.ver]!);
      if (!nv) continue;
      let best: { part: string; d: number } | undefined;
      for (const part of parts) {
        const vs = pic.barsOf.get(part)!.map((i) => pic.data!.values[i]!);
        const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
        if (nv.v < Math.min(...vs) * 0.75 || nv.v > Math.max(...vs) * 1.25) continue;
        const d = Math.abs(nv.v - mean) / mean;
        if (!best || d < best.d) best = { part, d };
      }
      if (!best || levels.some((l) => l.part === best!.part)) continue;
      levels.push({ part: best.part, v: nv.v, tag: "" });
      anchorMem.set(`${pic.name}.${best.part}`, nv.v);
      ti.st.color = C.pointer;
      notes2.push(`${tag(f.m)} "${e.texts[ti.st.ver]}" is a level of ${pic.name}.${best.part}: a line is drawn at ${nv.v} across its bars, and the words take the line's color`);
    }
    for (const part of plan.partPair?.pic === pic.name ? plan.partPair.parts : []) {
      if (levels.some((l) => l.part === part)) continue;
      const vs = pic.barsOf.get(part)!.map((i) => pic.data!.values[i]!);
      const v = anchorMem.get(`${pic.name}.${part}`) ?? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length);
      levels.push({ part, v, tag: String(v) });
    }
    if (levels.some((l) => l.tag)) notes2.push(`${tag(f.m)} ${pic.name}: compared parts show their levels (${levels.map((l) => `${l.part} ${l.v}`).join(", ")}), the values said earlier are reused`);
    ci.st.levels = levels;
    // Point a lone word at the one part in view.
    const subjT = plan.subject ? items.get(key(plan.subject)) : undefined;
    const held = [ci.st.sub, ...(ci.st.sup ?? [])].filter((x): x is string => !!x && pic.barsOf.has(x));
    if (subjT && subjT.type === "text" && !numOf(entOfKey(subjT.id)!.texts[subjT.st.ver]!) && held.length === 1 && !plan.parrows.length && !card) {
      localArrows.push({ t: plan.subject!, pic: pic.name, part: held[0]!, to: true });
      notes2.push(`${tag(f.m)} inferred: "${entOfKey(subjT.id)!.texts[0]}" is shown while ${pic.name}.${held[0]} is held, so a pointer joins them`);
    }
  }
  [...plan.parrows, ...localArrows].forEach(drawPArrow);
  // Born from: the source must be on screen; otherwise it simply enters.
  for (const [id, it] of items) if (it.born && !items.has(it.born)) it.born = undefined;
  return { items, order };
}

const entOfKey = (id: string): Ent | undefined => (id === "ph" ? ents.get("ph") : id.startsWith("q.") || id.startsWith("lab.") ? ents.get(id) : id.startsWith("t.") || id.startsWith("p.") ? ents.get(id.slice(2)) : undefined);
const laid: { items: Map<string, Item>; order: string[] }[] = [];
const anchorMem = new Map<string, number>(); // chart part -> the value last said about it
for (let k = 0; k < K; k++) laid.push(layoutMoment(k, notes));

// Think time for each question, and decisions about the column.
fms.forEach((f, k) => {
  if (!f.m.ask) return;
  const next = onsets[k + 1] ?? FRAMES;
  notes.push(`${tag(f.m)} ask: think time ${((next - onsets[k]!) / FPS).toFixed(1)} s${plans[k]!.phFor ? " (a placeholder waits in the slot of the reveal)" : ""}`);
});

// ---------------------------------------------------------------------------------------------------------------
// 7. Nodes: one long-lived node tree per entity, created hidden.
// ---------------------------------------------------------------------------------------------------------------
const specs: NodeSpec[] = [];
const known = new Map<string, Props>();
const node = (id: string, kind: "group" | "path" | "text" | "image", props: Props, parent?: string) => {
  const full: Props = { x: 0, y: 0, ...props };
  specs.push({ id, kind, parent, props: full });
  known.set(id, { opacity: 1, scaleX: 1, scaleY: 1, drawn: 1, ...full });
};
const circle = (r: number) => Array.from({ length: 16 }, (_, i) => [Math.round(r * Math.cos((i / 16) * 2 * Math.PI) * 10) / 10, Math.round(r * Math.sin((i / 16) * 2 * Math.PI) * 10) / 10]).flat();
const used = new Set<string>();
for (const l of laid) for (const id of l.items.keys()) used.add(id);
const makeText = (id: string, e: Ent, role: "title" | "heading" | "label") => {
  node(id, "group", { opacity: 0, scaleX: 0.01, scaleY: 0.01, x: W / 2, y: H / 2 });
  e.lines.forEach((ls, v) =>
    ls.forEach((t, i) => node(`${id}.v${v}.l${i + 1}`, "text", { y: (i - (ls.length - 1) / 2) * LINE * 100, text: t, size: 100, role, color: C.subject, opacity: v === 0 ? 1 : 0 }, id)),
  );
};
// Pictures first, so words and marks drawn later sit in front of them.
for (const [id, e] of ents) {
  if (e.type !== "pic" || !used.has(key(id))) continue;
  const pic = pics.get(id)!;
  const P = key(id);
  const rh = refH(pic);
  node(P, "group", { opacity: 0, scaleX: 0.01, scaleY: 0.01, x: W / 2, y: H / 2, clip: [-REFW / 2, -rh / 2, REFW / 2, -rh / 2, REFW / 2, rh / 2, -REFW / 2, rh / 2] });
  node(`${P}.c`, "group", {}, P);
  node(`${P}.c.img`, "image", { src: pic.src, w: REFW, h: rh }, `${P}.c`);
  if (pic.data) {
    // The redrawn chart: bars, a baseline, labels, a title, and one level line and tag per part that can be lit.
    const d = pic.data;
    // Bars are unit squares from their corner, stretched to their rectangle, so both orientations share one shape.
    d.values.forEach((_, i) => node(`${P}.bar${i}`, "path", { points: [0, 0, 1, 0, 1, 1, 0, 1], closed: 1, fill: C.subject, opacity: 0, scaleX: 1, scaleY: 1 }));
    d.values.forEach((v, i) => node(`${P}.val${i}`, "text", { text: String(v), size: MIN_FS * 1.25, role: "heading", color: C.subject, opacity: 0 }));
    for (const [h, t] of Object.entries(d.texts ?? {})) node(`${P}.hd.${h}`, "text", { text: t, size: 100, role: "title", color: C.subject, opacity: 0 });
    node(`${P}.base`, "path", { points: [0, 0, 1, 1], stroke: C.subject, strokeWidth: 4, opacity: 0, scaleX: 1, scaleY: 1 });
    d.labels.forEach((t, i) => node(`${P}.lab${i}`, "text", { text: t, size: MIN_FS, role: "label", color: C.muted, opacity: 0 }));
    if (d.title && !d.texts) node(`${P}.title`, "text", { text: d.title, size: MIN_FS, role: "label", color: C.muted, opacity: 0 });
    for (const part of pic.barsOf.keys()) {
      node(`${P}.lv.${part}`, "path", { points: [0, 0, 1, 1], stroke: C.pointer, strokeWidth: 7, lineCap: "round", opacity: 0, trimEnd: 0, scaleX: 1 });
      node(`${P}.lt.${part}`, "text", { text: "", size: MIN_FS * 1.25, role: "heading", color: C.pointer, opacity: 0 });
    }
    continue;
  }
  for (const part of picParts.get(id) ?? []) {
    const [u0, v0, u1, v1] = pic.parts.get(part)!;
    const [x0, y0, x1, y1] = [(u0 - 0.5) * REFW, (v0 - 0.5) * rh, (u1 - 0.5) * REFW, (v1 - 0.5) * rh];
    const pad = 6;
    node(`${P}.c.dim.${part}`, "path", { d: `M-6000 -6000H6000V6000H-6000Z${roundedRect(x0 - pad, y0 - pad, x1 + pad, y1 + pad, 14)}`, fill: "paper", fillRule: "evenodd", stroke: "none", opacity: 0 }, `${P}.c`);
    node(`${P}.c.ol.${part}`, "path", { d: roundedRect(x0 - pad, y0 - pad, x1 + pad, y1 + pad, 14), stroke: C.pointer, strokeWidth: 8, opacity: 0, trimEnd: 0 }, `${P}.c`);
  }
}
if (used.has("card")) node("card", "path", { points: [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], closed: 1, fill: "paper", opacity: 0, scaleX: 100, scaleY: 100 });
for (const [id, e] of ents) {
  if (e.type === "pic") continue;
  const nid = id === "ph" ? "ph" : id.startsWith("q.") || id.startsWith("lab.") ? id : key(id);
  if (!used.has(nid)) continue;
  if (e.type === "many") {
    const { cols, rows } = gridOf(e);
    node(nid, "group", { opacity: 0, x: W / 2, y: H / 2 });
    node(`${nid}.dots`, "group", { y: 0, scaleX: 0.1, scaleY: 0.1 }, nid);
    for (let i = 0; i < e.maxN; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      node(`${nid}.d${i}`, "path", { x: (c - (cols - 1) / 2) * PITCH, y: (r - (rows - 1) / 2) * PITCH, points: circle(PITCH * 0.36), closed: 1, fill: C.key, opacity: 0, scaleX: 0.3, scaleY: 0.3 }, `${nid}.dots`);
    }
    node(`${nid}.lab`, "text", { y: 0, text: e.unit, size: 0.05 * W, role: "label", color: C.muted }, nid);
  } else if (e.type === "obj") {
    node(nid, "group", { opacity: 0, scaleX: 0.01, scaleY: 0.01, x: W / 2, y: H / 2 });
    propNodes(nid, defs.get(id)!.obj!, (cid, kind, props, parent) => node(cid, kind, props as Props, parent), C.subject, "paper", 60);
  } else makeText(nid, e, id.startsWith("q.") ? "heading" : id.startsWith("lab.") ? "label" : "title");
}
for (const id of used) {
  if (id.startsWith("strike.")) node(id, "path", { points: [-0.5, 0, 0.5, 0], stroke: C.wrong, strokeWidth: 10, lineCap: "butt", opacity: 0, trimEnd: 0, scaleX: 100 });
  else if (id.startsWith("vbar.")) node(id, "path", { points: [-0.5, 0, 0.5, 0, 0.5, -1, -0.5, -1], closed: 1, fill: C.subject, opacity: 0, scaleX: 1, scaleY: 0 });
  else if (id.startsWith("bar.")) node(id, "path", { points: [0, -0.5, 1, -0.5, 1, 0.5, 0, 0.5], closed: 1, fill: C.key, opacity: 0, scaleX: 0, scaleY: 0.022 * W });
  else if (id.startsWith("parrow.")) node(id, "path", { points: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], stroke: C.pointer, strokeWidth: 8, opacity: 0, trimEnd: 0 });
  else if (id.startsWith("arrow.")) node(id, "path", { points: [0, 0, 0, 70, -18, 52, 0, 70, 18, 52], role: "pointer", stroke: C.pointer, strokeWidth: 8, opacity: 0, trimEnd: 0 });
}

// Pools for what objects do: drops for each source that drips, blooms for each vessel that flashes, a trail and a level
// line for things that fall together, a reading for a scale that is read, a label for a clock that runs, a think line
// for each question.
const readNums: [string, number][] = []; // a scale's numbers: written only when the scale is read up close
const circleU = Array.from({ length: 20 }, (_, i) => [Math.round(Math.cos((i / 20) * 2 * Math.PI) * 1000) / 1000, Math.round(Math.sin((i / 20) * 2 * Math.PI) * 1000) / 1000]).flat();
const POOL = 8;
for (const [src, dst] of flows) {
  for (let j = 0; j < POOL; j++) node(`drop.${src}.${j}`, "path", { points: circleU.map((v, i) => (i % 2 ? v * 1.25 : v)), closed: 1, fill: withAlpha("#9fd3e6", 0.95), stroke: C.subject, strokeWidth: 0.12, opacity: 0, scaleX: 11, scaleY: 11 });
  for (let j = 0; j < POOL; j++) node(`bloom.${dst}.${j}`, "path", { points: circleU, closed: 1, fill: "#e8559a", stroke: "none", opacity: 0, scaleX: 40, scaleY: 14 });
}
for (const g of fallGroups) {
  for (const id of g) for (let j = 0; j < 3; j++) node(`ghost.${id}.${j}`, "path", { points: circleU, closed: 1, fill: defs.get(id)!.obj!.body?.fill ?? C.subject, stroke: "none", opacity: 0, scaleX: 50, scaleY: 50 });
  if (g.length > 1) node(`level.${g.join(".")}`, "path", { points: [0, 0, 1, 0], stroke: C.pointer, strokeWidth: 6, dash: [24, 16], opacity: 0, scaleX: 1 });
}
fms.forEach((f, k) => {
  for (const a of f.acts) {
    if (a.verb === "reads") for (let ml = 0; ml <= 50; ml += 10) readNums.push([`${key(a.ids[0]!)}.num${ml}`, k]);
    if (a.verb === "reads") (node(`read.${k}`, "text", { text: "", size: 100, role: "title", color: C.pointer, opacity: 0 }), node(`readmark.${k}`, "path", { points: [0, 0, 1, 0], stroke: C.pointer, strokeWidth: 6, opacity: 0, scaleX: 1 }));
    if (a.verb === "runs") node(`run.${k}`, "text", { text: a.arg ?? "", size: 100, role: "heading", color: C.pointer, opacity: 0 });
  }
  if (plans[k]!.question) node(`think.${k}`, "path", { points: [0, 0, 1, 0], stroke: C.pointer, strokeWidth: 8, lineCap: "round", opacity: 0, trimEnd: 0, scaleX: 1 });
});

// ---------------------------------------------------------------------------------------------------------------
// 8. Transitions: staged exits, moves, entrances, with attention effects. All become timed `set` operations.
// ---------------------------------------------------------------------------------------------------------------
type Op = { id: string; prop: string; value: Value; at: number; frames: number; ease: Ease };
const ops: Op[] = [];
const plays: { at: number; target: string; behavior: string; args: Record<string, Value> }[] = [];
const same = (a: Value | undefined, b: Value) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-4);
const put = (id: string, prop: string, value: Value, at: number, frames = 1, ease: Ease = "smooth") => {
  const kn = known.get(id);
  if (!kn) return;
  if (same(kn[prop], value)) return;
  kn[prop] = value;
  ops.push({ id, prop, value, at: Math.max(0, Math.round(at)), frames: Math.max(1, Math.round(frames)), ease });
};
const would = (id: string, prop: string, value: Value) => !same(known.get(id)?.[prop], value);

type Triple = [string, string, Value];
function target(it: Item): Triple[] {
  const { id, st } = it;
  const out: Triple[] = [];
  if (it.type === "text" || it.type === "ph") {
    const e = entOfKey(id)!;
    out.push([id, "x", st.x], [id, "y", st.y], [id, "scaleX", st.s], [id, "scaleY", st.s], [id, "opacity", st.op]);
    e.lines.forEach((ls, v) =>
      ls.forEach((_, i) => {
        out.push([`${id}.v${v}.l${i + 1}`, "opacity", v === st.ver ? 1 : 0]);
        if (v === st.ver) out.push([`${id}.v${v}.l${i + 1}`, "color", st.color]);
      }),
    );
  } else if (it.type === "many") {
    out.push([id, "x", st.x], [id, "y", st.y], [id, "opacity", st.op], [`${id}.dots`, "y", st.dotsY], [`${id}.dots`, "scaleX", st.s], [`${id}.dots`, "scaleY", st.s], [`${id}.lab`, "y", st.labY], [`${id}.lab`, "text", st.label]);
  } else if (it.type === "obj") {
    out.push([id, "x", st.x], [id, "y", st.y], [id, "scaleX", st.s], [id, "scaleY", st.s], [id, "opacity", st.op]);
  } else if (it.type === "pic" && pics.get(id.slice(2))!.data) {
    out.push(...chartTargets(it, "own"));
  } else if (it.type === "pic") {
    const P = id;
    out.push([P, "x", st.x], [P, "y", st.y], [P, "scaleX", st.s], [P, "scaleY", st.s], [P, "opacity", st.op], [`${P}.c`, "x", st.ox], [`${P}.c`, "y", st.oy], [`${P}.c`, "scaleX", st.z], [`${P}.c`, "scaleY", st.z]);
    for (const part of picParts.get(id.slice(2)) ?? []) {
      const sub = st.sub === part;
      const sup = !sub && !!st.sup?.includes(part);
      out.push([`${P}.c.dim.${part}`, "opacity", sub ? DIM : 0], [`${P}.c.ol.${part}`, "opacity", sub ? 1 : sup ? 0.55 : 0], [`${P}.c.ol.${part}`, "trimEnd", sub || sup ? 1 : 0], [`${P}.c.ol.${part}`, "strokeWidth", 8 / st.z]);
    }
  } else if (it.type === "parrow") out.push([id, "points", st.pts], [id, "opacity", 1], [id, "trimEnd", 1]);
  else if (it.type === "card") out.push([id, "x", st.x], [id, "y", st.y], [id, "scaleX", st.len], [id, "scaleY", st.h], [id, "opacity", 0.94]);
  else if (it.type === "strike") out.push([id, "x", st.x], [id, "y", st.y], [id, "scaleX", st.len], [id, "opacity", 1], [id, "trimEnd", 1]);
  else if (it.type === "vbar") out.push([id, "x", st.x], [id, "y", st.y], [id, "scaleX", st.w], [id, "scaleY", st.len], [id, "opacity", st.op], [id, "fill", st.color]);
  else if (it.type === "bar") out.push([id, "x", st.x], [id, "y", st.y], [id, "scaleX", st.len], [id, "opacity", 1], [id, "fill", st.color]);
  else out.push([id, "x", st.x], [id, "y", st.y], [id, "opacity", 1], [id, "trimEnd", 1]);
  return out;
}
// The redrawn chart's targets. In "own" the original picture is hidden and the bars stand in the chart's box, lit by
// what the moment holds; in "photo" the original shows and the bars wait, unseen, exactly on its bars.
const chartSeen = new Map<string, Set<number>>(); // bars whose part has been looked at, so their values stay written
function chartTargets(it: Item, mode: "own" | "photo"): Triple[] {
  const P = it.id;
  const pic = pics.get(P.slice(2))!;
  const d = pic.data!;
  const st = it.st;
  const g = chartGeom(st, pic, mode);
  const out: Triple[] = [];
  const pg = chartGeom(st, pic, "photo");
  const own = mode === "own";
  out.push([P, "x", st.x], [P, "y", st.y], [P, "scaleX", pg.pw / REFW], [P, "scaleY", pg.pw / REFW], [P, "opacity", own ? 0 : 1]);
  const lit = new Set((st.lit ?? []).flatMap((x) => pic.barsOf.get(x) ?? []));
  const held = new Set([st.sub, ...(st.sup ?? [])].flatMap((x) => (x ? pic.barsOf.get(x) ?? [] : [])));
  const seen = chartSeen.get(P) ?? new Set<number>();
  const focus = lit.size > 0 || held.size > 0;
  g.bars.forEach((b, i) => {
    const on = lit.has(i);
    out.push([`${P}.bar${i}`, "x", b.x0], [`${P}.bar${i}`, "y", b.y0], [`${P}.bar${i}`, "scaleX", Math.max(0.5, b.x1 - b.x0)], [`${P}.bar${i}`, "scaleY", Math.max(0.5, b.y1 - b.y0)], [`${P}.bar${i}`, "fill", on ? C.pointer : C.subject], [`${P}.bar${i}`, "opacity", !own ? 0 : !focus || on || held.has(i) ? 1 : 0.22]);
    const L = g.labels[i]!;
    const lw = em(d.labels[i]!) * MIN_FS * 1.12;
    out.push([`${P}.lab${i}`, "x", L.left ? L.x + lw / 2 : L.x], [`${P}.lab${i}`, "y", L.y], [`${P}.lab${i}`, "opacity", !own ? 0 : on ? 1 : focus && !held.has(i) ? 0.45 : 0.8], [`${P}.lab${i}`, "color", on ? C.pointer : C.muted]);
    // A bar's value is written once its part has been looked at, and stays.
    const vfs = MIN_FS * 1.25;
    const vw = em(String(d.values[i])) * vfs;
    const show = own && (on || held.has(i) || seen.has(i));
    out.push([`${P}.val${i}`, "x", g.hz ? b.x1 + 16 + vw / 2 : (b.x0 + b.x1) / 2], [`${P}.val${i}`, "y", g.hz ? (b.y0 + b.y1) / 2 : b.y0 - vfs * 0.7], [`${P}.val${i}`, "opacity", show ? (on || !focus || held.has(i) ? 1 : 0.45) : 0], [`${P}.val${i}`, "color", on ? C.pointer : C.subject]);
  });
  const A = g.axis;
  // Lines are drawn by their own points, never by stretching a unit line: a stretched stroke stretches its caps too.
  out.push([`${P}.base`, "points", [A.x0, A.y0, A.x1, A.y1].map((v) => Math.round(v * 10) / 10)], [`${P}.base`, "opacity", own ? 1 : 0]);
  if (d.title && !d.texts) out.push([`${P}.title`, "x", st.x], [`${P}.title`, "y", st.y - st.h / 2 + MIN_FS * 0.9], [`${P}.title`, "opacity", own ? 1 : 0]);
  // The chart's own words: a header row each; the one that is the subject now is set large in the pointer color.
  for (const h of Object.keys(d.texts ?? {})) {
    const isSub = st.sub === h || st.lit?.includes(h);
    const isHeld = st.sup?.includes(h);
    const fs = isSub ? Math.min(0.11 * W, (st.w * 0.62) / em(d.texts![h]!)) : MIN_FS * 1.1;
    const w = em(d.texts![h]!) * fs * 1.12; // heavy type runs wider than measured; left-aligned words keep a margin
    // A large row takes the first line of the header; the others step below it.
    const keys = Object.keys(d.texts!);
    const subI = keys.findIndex((x) => st.sub === x || st.lit?.includes(x));
    const i = keys.indexOf(h);
    const y = own && subI >= 0 ? (i === subI ? st.y - st.h / 2 + 0.11 * W * 0.6 : st.y - st.h / 2 + 0.11 * W * 1.2 + 8 + MIN_FS * 0.7 + (i < subI ? i : i - 1) * MIN_FS * 1.4) : g.heads[h]!;
    // A large row is centered on the chart; small rows align to the bars' edge.
    out.push([`${P}.hd.${h}`, "x", isSub && own ? st.x : g.headX + w / 2], [`${P}.hd.${h}`, "y", y], [`${P}.hd.${h}`, "scaleX", fs / 100], [`${P}.hd.${h}`, "scaleY", fs / 100], [`${P}.hd.${h}`, "opacity", own ? (isSub || isHeld || !focus ? 1 : 0.55) : 0], [`${P}.hd.${h}`, "color", isSub ? C.pointer : C.subject]);
  }
  for (const part of pic.barsOf.keys()) {
    const lv = own ? st.levels?.find((l) => l.part === part) : undefined;
    const bs = pic.barsOf.get(part)!.map((i) => g.bars[i]!);
    const lo = g.hz ? Math.min(...bs.map((b) => b.y0)) - 12 : Math.min(...bs.map((b) => b.x0)) - 12;
    const hi = g.hz ? Math.max(...bs.map((b) => b.y1)) + 12 : Math.max(...bs.map((b) => b.x1)) + 12;
    const at = lv ? (g.hz ? A.x0 + lv.v * g.scale : A.y0 - lv.v * g.scale) : g.hz ? A.x0 : A.y0;
    const [x, y, sx, sy] = g.hz ? [at, lo, 0, hi - lo] : [lo, at, hi - lo, 0];
    out.push([`${P}.lv.${part}`, "points", [x, y, x + sx, y + sy].map((v) => Math.round(v * 10) / 10)], [`${P}.lv.${part}`, "opacity", lv ? 1 : 0], [`${P}.lv.${part}`, "trimEnd", lv ? 1 : 0]);
    out.push([`${P}.lt.${part}`, "x", g.hz ? at : (lo + hi) / 2], [`${P}.lt.${part}`, "y", g.hz ? lo - MIN_FS * 0.8 : at - MIN_FS * 1.1], [`${P}.lt.${part}`, "opacity", lv?.tag ? 1 : 0]);
    if (lv?.tag) out.push([`${P}.lt.${part}`, "text", lv.tag]);
  }
  return out;
}
const dotRange = (it: Item, from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, j) => `${it.id}.d${from + j}`);

const CAM_PY = Y0;
const camPan = (z: number) => CAM_PY - (CAM_PY - H / 2) / z;
let camZ = 1;
const camOp = (z: number, at: number, frames: number, ease: Ease) => {
  ops.push({ id: "camera", prop: "panX", value: W / 2, at: Math.round(at), frames: Math.max(1, Math.round(frames)), ease });
  ops.push({ id: "camera", prop: "zoom", value: z, at: Math.round(at), frames: Math.max(1, Math.round(frames)), ease });
  ops.push({ id: "camera", prop: "panY", value: camPan(z), at: Math.round(at), frames: Math.max(1, Math.round(frames)), ease });
  camZ = z;
};

// The state of every object as the piece plays: how full, what color, what it flashes when something lands.
const objState = new Map<string, { level: number; color?: string }>();
for (const d of defs.values()) if (d.obj) objState.set(d.id, { level: d.obj.level, color: d.obj.liquid });
const visibleIn = (k: number, id: string) => plans[k]!.slots.some((sl) => sl.id === id);
// Flashes last from their moment until the vessel turns for good.
const flashes: { dst: string; color: string; from: number; to: number }[] = [];
fms.forEach((f, k) => {
  for (const a of f.acts) {
    if (a.verb !== "flashes") continue;
    const c = colorOf(a.arg ?? "") ?? { hex: "#e8559a", alpha: 0.8 };
    let to = FRAMES;
    for (let m = k + 1; m < K; m++) if (fms[m]!.acts.some((b) => b.verb === "turns" && b.ids.includes(a.ids[0]!))) (to = onsets[m]!, (m = K));
    flashes.push({ dst: a.ids[0]!, color: c.hex, from: onsets[k]!, to });
  }
});
const flashAt = (dst: string, t: number) => flashes.find((x) => x.dst === dst && t >= x.from && t < x.to)?.color;
const poolAt = new Map<string, number>();
const nextOf = (name: string) => {
  const j = poolAt.get(name) ?? 0;
  poolAt.set(name, j + 1);
  return `${name}.${j % POOL}`;
};
const toScreen = (it: Item, x: number, y: number) => ({ x: it.st.x + it.st.s * x, y: it.st.y + it.st.s * y });
const ML_PER_S = 2.6;
// A line that fills under a question while the viewer thinks: an ability, off unless asked for (the bench's eye
// instrument showed it pulling the eye away from what the viewer should be predicting about).
const THINK_LINE = process.env.THINK_LINE === "1"; // a quick stream from a burette
function scheduleActs(k: number, at0: number, cur: Map<string, Item>) {
  const f = fms[k]!;
  const nextOn = onsets[k + 1] ?? FRAMES;
  const pace = f.m.pace;
  for (const a of f.acts) {
    const A = a.ids[0]!;
    const itA = cur.get(key(A));
    const pa = defs.get(A)?.obj;
    if (!itA || !pa) {
      notes.push(`${tag(f.m)} "${A}" ${a.verb}: it is not an object on screen, so nothing moves`);
      continue;
    }
    const st = objState.get(A)!;
    if (a.verb === "flow") {
      const B = a.to!;
      const itB = cur.get(key(B));
      const pb = defs.get(B)?.obj;
      if (!itB || !pb) continue;
      let end = FRAMES - 6;
      for (let m = k + 1; m < K; m++) {
        const stop = fms[m]!.acts.some((b) => (b.verb === "flow" && b.ids[0] === A) || (b.verb === "turns" && b.ids.includes(B))) || !visibleIn(m, A) || !visibleIn(m, B);
        if (stop) (end = onsets[m]!, (m = K));
      }
      end = Math.max(at0 + 20, end - 18); // the flow stops a little before what follows, so the result is seen at rest
      const slow = a.slow || (!a.fast && pace === "slow");
      const every = slow ? 22 : 5;
      const fallF = slow ? 12 : 9;
      const hang = slow ? 14 : 0;
      const tip = toScreen(itA, tipOf(pa).x, tipOf(pa).y);
      const sB = objState.get(B)!;
      const startA = st.level;
      const startB = sB.level;
      const n = Math.max(1, Math.floor((end - at0 - hang - fallF) / every));
      const ml = slow ? 0.05 * n : (ML_PER_S * (end - at0)) / FPS;
      const levelA = pa.shape === "burette" ? Math.max(0.05, startA - (ml / 50) * (0.96 - 0.0)) : Math.max(0, startA - 0.15);
      const levelB = Math.min(0.78, startB + (slow ? 0.004 * n : 0.12));
      for (let i = 0; i < n; i++) {
        const t = at0 + i * every;
        const tl = t + hang + fallF;
        const u = (tl - at0) / Math.max(1, end - at0);
        const land = toScreen(itB, 0, surfaceY(pb, startB + (levelB - startB) * u));
        const d = nextOf(`drop.${A}`);
        put(d, "x", tip.x, t - 1);
        put(d, "y", tip.y + (slow ? 10 : 14), t - 1);
        put(d, "scaleX", slow ? 2 : 10, t - 1);
        put(d, "scaleY", slow ? 2 : 10, t - 1);
        put(d, "opacity", 1, t, 2, "out");
        if (slow) (put(d, "scaleX", 13, t, hang, "out"), put(d, "scaleY", 13, t, hang, "out"));
        put(d, "y", land.y - 6, t + hang, fallF, "in");
        put(d, "opacity", 0, tl, 2, "linear");
        const fc = flashAt(B, tl);
        const halfW = Math.abs(liquidPoly(pb, startB)[2]! - liquidPoly(pb, startB)[0]!) * itB.st.s * 0.5;
        if (fc) {
          const b = nextOf(`bloom.${B}`);
          const jx = (((i * 37) % 9) - 4) / 4;
          put(b, "fill", withAlpha(fc, 0.85), tl - 1);
          put(b, "x", land.x + jx * halfW * 0.3, tl - 1);
          put(b, "y", land.y + 14, tl - 1);
          put(b, "scaleX", 0.25 * halfW, tl - 1);
          put(b, "scaleY", 12, tl - 1);
          put(b, "opacity", 1, tl, 3, "out");
          put(b, "scaleX", 0.5 * halfW, tl, 10, "out");
          put(b, "scaleY", 30, tl, 10, "out");
          put(b, "opacity", 0, tl + 5, slow ? 40 : 18, "smooth");
        }
      }
      // The levels move with the flow: the source drains, the vessel fills.
      const dur = Math.max(1, end - at0);
      put(`${key(A)}.liq`, "points", liquidPoly(pa, levelA), at0, dur, "linear");
      put(`${key(A)}.surf`, "points", liquidPoly(pa, levelA).slice(0, 4), at0, dur, "linear");
      put(`${key(B)}.liq`, "points", liquidPoly(pb, levelB), at0, dur, "linear");
      put(`${key(B)}.surf`, "points", liquidPoly(pb, levelB).slice(0, 4), at0, dur, "linear");
      st.level = levelA;
      sB.level = levelB;
      notes.push(`${tag(f.m)} ${A} drips into ${B} ${slow ? "one drop at a time (each drop hangs at the tip, then falls)" : "in a quick stream"}: ${n} drops until ${(end / FPS).toFixed(1)} s${pa.shape === "burette" ? `, about ${ml.toFixed(2)} mL, so the reading moves to ${buretteReading(levelA).toFixed(2)} mL` : ""}${flashes.some((x) => x.dst === B) ? `; drops that land while ${B} flashes make a bloom of color that fades` : ""}`);
    } else if (a.verb === "flashes") {
      if (![...flows.entries()].some(([, d]) => d === A)) notes.push(`${tag(f.m)} ${A} flashes, but nothing lands in it: the flash shows on its own`);
      else notes.push(`${tag(f.m)} ${A} flashes ${a.arg ?? ""}: from here every drop that lands blooms and fades`);
    } else if (a.verb === "turns" || a.verb === "fills") {
      if (a.verb === "turns") {
        const c = colorOf(a.arg ?? "");
        if (!c) {
          notes.push(`${tag(f.m)} ${A} turns "${a.arg}": no color in it, so it only pulses`);
          plays.push({ at: at0 + 4, target: key(A), behavior: "pulse", args: { size: 1.05, frames: 16 } });
          continue;
        }
        const col = withAlpha(c.hex, c.alpha);
        const node2 = pa.kind === "vessel" ? `${key(A)}.liq` : pa.kind === "ball" ? `${key(A)}.ball` : undefined;
        if (node2) put(node2, "fill", col, at0 + 4, pace === "slow" ? 40 : 26, "smooth");
        st.color = col;
        notes.push(`${tag(f.m)} ${A} turns ${a.arg}: its contents shift to that color over ${pace === "slow" ? "1.3" : "0.9"} s and stay`);
      } else {
        const pct = Number(/(\d+(?:\.\d+)?)/.exec(a.arg ?? "")?.[1] ?? "50") / 100;
        put(`${key(A)}.liq`, "points", liquidPoly(pa, pct), at0 + 4, 30, "smooth");
        put(`${key(A)}.surf`, "points", liquidPoly(pa, pct).slice(0, 4), at0 + 4, 30, "smooth");
        st.level = pct;
      }
    } else if (a.verb === "moves") {
      const g = key(A);
      const amp = a.arg === "spins" ? 0 : 7;
      if (a.arg === "spins") put(g, "rotate", 360, at0 + 2, 40, "smooth");
      else [amp, -amp, amp * 0.8, -amp * 0.8, amp * 0.4, 0].forEach((v, i) => put(g, "rotate", v, at0 + 2 + i * 8, 8, "smooth"));
      notes.push(`${tag(f.m)} ${A} ${a.arg}: it rocks on its base, ${amp} degrees each way, settling in 1.6 s`);
    } else if (a.verb === "falls") {
      const mem = a.ids.filter((x) => cur.has(key(x)));
      const Fd = Math.round((pace === "slow" || f.m.reveal ? 54 : 36) * feelMul);
      const t = at0 + 2;
      for (const id of mem) {
        const it = cur.get(key(id))!;
        const drop = it.st.len;
        put(key(id), "y", it.st.y + drop, t, Fd, "in");
        put(key(id), "scaleY", it.st.s * 0.9, t + Fd, 3, "out");
        put(key(id), "scaleX", it.st.s * 1.06, t + Fd, 3, "out");
        put(key(id), "scaleY", it.st.s, t + Fd + 3, 8, "spring");
        put(key(id), "scaleX", it.st.s, t + Fd + 3, 8, "spring");
        const r = it.st.w / 2;
        [0.3, 0.55, 0.8].forEach((fr, j) => {
          const gh = `ghost.${id}.${j}`;
          const when = t + Math.round(Fd * Math.cbrt(fr));
          put(gh, "x", it.st.x, t - 1);
          put(gh, "y", it.st.y - r + drop * fr, t - 1);
          put(gh, "scaleX", r, t - 1);
          put(gh, "scaleY", r, t - 1);
          put(gh, "opacity", 0.16, when, 3, "out");
          put(gh, "opacity", 0, nextOn - 6, 10, "smooth");
        });
      }
      const g = fallGroups.find((x) => mem.every((y) => x.includes(y)));
      if (g && g.length > 1 && mem.length > 1) {
        const its = mem.map((id) => cur.get(key(id))!);
        const x0 = Math.min(...its.map((i) => i.st.x));
        const x1 = Math.max(...its.map((i) => i.st.x));
        const yb = its[0]!.st.y;
        const L = `level.${g.join(".")}`;
        put(L, "points", [x0, 0, x1, 0], t - 1);
        put(L, "y", yb, t - 1);
        put(L, "opacity", 0.85, t, 4, "out");
        put(L, "y", yb + its[0]!.st.len, t, Fd, "in");
        put(L, "opacity", 0, t + Fd + 30, 14, "smooth");
        notes.push(`${tag(f.m)} ${mem.join(" and ")} fall together over ${(Fd / FPS).toFixed(1)} s with gravity's ease; a dashed line joins their bottoms the whole way down and faint marks stay where they passed, so the eye sees they stay level`);
      }
    } else if (a.verb === "reads") {
      const R = `read.${k}`;
      const M = `readmark.${k}`;
      const yLoc = surfaceY(pa, st.level);
      const m = toScreen(itA, 0, yLoc);
      const value = /\d/.test(a.arg ?? "") ? a.arg! : pa.shape === "burette" ? `${buretteReading(st.level).toFixed(2)} mL` : a.arg ?? "";
      for (const [nn, kk] of readNums) if (kk === k) put(nn, "opacity", 0.9, at0 + 14, 12, "out");
      const z = 2.4;
      const fsW = (0.085 * W) / z;
      const wTxt = em(value) * fsW;
      ops.push({ id: "camera", prop: "zoom", value: z, at: at0 + 2, frames: 30, ease: "smooth" });
      ops.push({ id: "camera", prop: "panX", value: m.x + wTxt / 2 + 20 / z, at: at0 + 2, frames: 30, ease: "smooth" });
      ops.push({ id: "camera", prop: "panY", value: m.y, at: at0 + 2, frames: 30, ease: "smooth" });
      camZ = z;
      put(R, "text", value, at0);
      put(R, "x", m.x + (itA.st.w / 2 + 40 / z) + wTxt / 2, at0);
      put(R, "y", m.y - fsW * 0.9, at0);
      put(R, "scaleX", fsW / 100, at0);
      put(R, "scaleY", fsW / 100, at0);
      put(R, "opacity", 1, at0 + 24, 10, "out");
      put(M, "points", [m.x - itA.st.w / 2 - 14 / z, m.y, m.x + itA.st.w / 2 + 44 / z, m.y], at0);
      put(M, "strokeWidth", 6 / z, at0);
      put(M, "opacity", 1, at0 + 20, 8, "out");
      notes.push(`${tag(f.m)} ${A} reads: the camera closes in ${z}x on the liquid's surface and the reading ${value} stands beside it${/\d/.test(a.arg ?? "") ? "" : " (read off the drawn scale, which the drops really emptied)"}`);
    } else if (a.verb === "runs") {
      const secs = Number(/(\d+(?:\.\d+)?)/.exec(a.arg ?? "")?.[1] ?? "30");
      const deg = 360 * Math.min(1, secs / 60);
      const hand = `${key(A)}.hand`;
      const lab = `run.${k}`;
      const fsr = 0.07 * W;
      put(hand, "rotate", deg, at0 + 6, Math.max(20, nextOn - at0 - 12), "linear");
      put(lab, "x", itA.st.x, at0);
      put(lab, "y", itA.st.y + fsr * 0.8, at0);
      put(lab, "scaleX", fsr / 100, at0);
      put(lab, "scaleY", fsr / 100, at0);
      put(lab, "opacity", 1, at0 + 4, 8, "out");
      put(lab, "opacity", 0, nextOn, 8, "in");
      notes.push(`${tag(f.m)} ${A} runs ${a.arg ?? ""}: its hand sweeps ${Math.round(deg)} degrees until the next moment, the time written under it`);
    }
  }
  // A question gets a line under it that fills while the viewer thinks.
  const q = THINK_LINE ? cur.get(`q.${k}`) : undefined;
  if (q) {
    const T = `think.${k}`;
    put(T, "points", [q.st.x - q.st.w / 2, q.st.y + q.st.h / 2 + 22, q.st.x + q.st.w / 2, q.st.y + q.st.h / 2 + 22], at0);
    put(T, "opacity", 0.8, at0 + 10, 6, "out");
    put(T, "trimEnd", 1, at0 + 12, Math.max(10, nextOn - at0 - 16), "linear");
    put(T, "opacity", 0, nextOn, 6, "in");
  }
}

for (let k = 0; k < K; k++) {
  const f = fms[k]!;
  const cur = laid[k]!.items;
  const prev = k ? laid[k - 1]!.items : new Map<string, Item>();
  const plan = plans[k]!;
  const t0 = onsets[k]!;
  const pace = f.m.pace;
  const base = durMove(0, pace) + 4; // a typical entrance
  const dEx = Math.max(5, Math.round(0.7 * base));
  const exits = [...prev.keys()].filter((id) => !cur.has(id));
  const stays = [...cur.keys()].filter((id) => prev.has(id));
  const enters = [...cur.keys()].filter((id) => !prev.has(id));
  const order = laid[k]!.order;
  const isPhItem = (id: string) => id === "ph";
  const revealKey = plan.slots.find((s) => s.reveal)?.id;
  const revealId = revealKey ? key(revealKey) : undefined;
  const phDip = prev.has("ph") && revealId !== undefined && cur.has(revealId) && !prev.has(revealId);

  // Which entity carries the moment: its arrival is the last onset.
  let lastId: string | undefined = plan.subject ? key(plan.subject) : plan.pair ? key(plan.pair[1]) : undefined;
  if (lastId && !cur.has(lastId)) lastId = undefined;
  if (!lastId && cur.has("ph")) lastId = "ph";

  // Moves: things that stay and whose target differs.
  const pxOf = (id: string) => {
    const a = prev.get(id)!.st;
    const b = cur.get(id)!.st;
    return Math.hypot(a.x - b.x, a.y - b.y) + Math.abs(a.h - b.h) + Math.abs(a.fs - b.fs) * 0.5 + Math.abs(a.z - b.z) * 250;
  };
  const textual = (it: Item) => it.type === "text" || it.type === "ph" || it.type === "many";
  const verChanged = (id: string) => textual(cur.get(id)!) && cur.get(id)!.type === "text" && cur.get(id)!.st.ver !== prev.get(id)!.st.ver;
  const movers = stays.filter((id) => target(cur.get(id)!).some(([n, p, v]) => would(n, p, v)) && id !== lastId);
  const maxMove = Math.max(0, ...movers.map((id) => durMove(pxOf(id), pace)));
  const mvOff0 = exits.length ? Math.round(dEx * 0.6) : 0;
  const enOff0 = mvOff0 + (movers.length ? Math.round(maxMove * 0.5) : 0);
  const entering = enters.filter((id) => id !== lastId && cur.get(id)!.type !== "bar" && cur.get(id)!.type !== "vbar" && cur.get(id)!.type !== "strike");
  entering.sort((a, b) => {
    const rankOf = (id: string) => (cur.get(id)!.type === "card" ? -1 : cur.get(id)!.type === "arrow" || cur.get(id)!.type === "parrow" ? 1000 : order.indexOf(id) < 0 ? 999 : order.indexOf(id));
    return rankOf(a) - rankOf(b);
  });
  const STAG = 3;
  const avail = CUE - STAG * entering.length;
  const scale = enOff0 === 0 ? 1 : avail >= enOff0 ? 1 : Math.max(0, avail) / enOff0;
  const mvOff = Math.round(mvOff0 * scale);
  // The old subject finishes leaving (nearly) before the new one enters, so words never overlap during a change.
  const enOff = exits.length ? Math.max(Math.round(enOff0 * scale), Math.round(dEx * 0.9)) : Math.round(enOff0 * scale);
  let subjAt = t0 + enOff + STAG * entering.length;
  if (phDip) subjAt = Math.max(subjAt, t0 + 5);
  // When a moment both demonstrates (things fall) and reveals words, the words wait for the landing: the viewer sees
  // the answer happen, and the words confirm it.
  const actAt = subjAt;
  if (f.acts.some((a) => a.verb === "falls") && revealId && cur.get(revealId)?.type === "text") {
    const wait = Math.round((f.m.pace === "slow" || f.m.reveal ? 54 : 36) * feelMul) + 4;
    subjAt += wait;
    notes.push(`${tag(f.m)} the revealed words wait ${(wait / FPS).toFixed(1)} s for the landing they describe`);
  }
  const subjDur = lastId && prev.has(lastId) ? durMove(pxOf(lastId), pace) : base;

  // Exits: fade and slight shrink, accelerating.
  for (const id of exits) {
    const it = prev.get(id)!;
    if (isPhItem(id) && phDip) {
      put(id, "scaleX", it.st.s * 0.94, t0, 5, "out");
      put(id, "scaleY", it.st.s * 0.94, t0, 5, "out");
      put(id, "opacity", 0, t0 + 5, 4, "in");
      continue;
    }
    put(id, "opacity", 0, t0, dEx, "in");
    if (it.type === "text" || it.type === "ph" || it.type === "pic" || it.type === "obj") {
      put(id, "scaleX", it.st.s * 0.92, t0, dEx, "in");
      put(id, "scaleY", it.st.s * 0.92, t0, dEx, "in");
    } else if (it.type === "many") put(`${id}.dots`, "scaleX", it.st.s * 0.92, t0, dEx, "in"), put(`${id}.dots`, "scaleY", it.st.s * 0.92, t0, dEx, "in");
  }

  // Camera back to rest while things move.
  if (camZ !== 1) camOp(1, t0 + mvOff, 14, "smooth");

  // Stays: moves and resizes, standard ease; the subject's change is the last onset.
  const becomesNow: string[] = [];
  for (const id of stays) {
    const it = cur.get(id)!;
    const at = id === lastId ? subjAt : t0 + mvOff;
    const frames = durMove(pxOf(id), pace);
    if (verChanged(id)) {
      becomesNow.push(id);
      // Same node: the old words lift and fade while the new rise in the same place, then a brief pulse.
      const e = entOfKey(id)!;
      const from = prev.get(id)!.st.ver;
      e.lines[from]!.forEach((_, i) => {
        const ln = `${id}.v${from}.l${i + 1}`;
        put(ln, "y", (i - (e.lines[from]!.length - 1) / 2) * LINE * 100 - 34, at, 10, "in");
        put(ln, "opacity", 0, at, 10, "in");
      });
      const to = it.st.ver;
      const accent = C.key;
      e.lines[to]!.forEach((_, i) => {
        const ln = `${id}.v${to}.l${i + 1}`;
        const y = (i - (e.lines[to]!.length - 1) / 2) * LINE * 100;
        put(ln, "y", y + 34, t0 - 1);
        put(ln, "color", accent, t0 - 1);
        put(ln, "y", y, at + 3, 14, "out");
        put(ln, "opacity", 1, at + 3, 10, "out");
        put(ln, "color", it.st.color, at + 20, 20, "smooth");
      });
      plays.push({ at: at + 9, target: id, behavior: "pulse", args: { size: 1.08, frames: 14 } });
    }
    for (const [n, p, v] of target(it)) {
      if (n.includes(".v") && (p === "opacity" || p === "color") && verChanged(id)) continue;
      if (n.endsWith(".lab") && p === "text") {
        const before = prev.get(id)!.st.label;
        if (before !== it.st.label) put(n, p, v, at + Math.round(frames / 2), 1, "step");
        continue;
      }
      put(n, p, v, at, frames, "smooth");
    }
    if (it.type === "many") {
      const a = prev.get(id)!.st.n;
      const b = it.st.n;
      const e = entOfKey(id)!;
      if (a !== b) {
        const stepF = Math.min(3, 30 / Math.abs(b - a));
        const grow = b > a;
        const list = grow ? dotRange(it, a, Math.min(b, e.maxN)) : dotRange(it, b, Math.min(a, e.maxN)).reverse();
        list.forEach((dn, j) => {
          const when = at + Math.round(j * stepF);
          put(dn, "opacity", grow ? 1 : 0, when, 8, "out");
          put(dn, "scaleX", grow ? 1 : 0.3, when, 8, "out");
          put(dn, "scaleY", grow ? 1 : 0.3, when, 8, "out");
        });
        notes.push(`${tag(f.m)} ${entOfKey(id)!.id} ${grow ? "adds" : "removes"} ${Math.abs(b - a)} dots one by one over ${((list.length * stepF) / FPS).toFixed(1)} s`);
      }
    }
  }

  // Entrances: decelerate, staggered; the carrier of the moment arrives last.
  const enterOne = (id: string, at: number, isLast: boolean) => {
    const it = cur.get(id)!;
    if (it.type === "pic" && pics.get(id.slice(2))!.data) {
      // The user's chart arrives as it is. When the moment is long enough to see it, its bars are then redrawn in place
      // (the new bars appear exactly on the old ones), the original fades, and the chart grows into the stage, every
      // bar keeping its identity. When it is short, the bars grow in one by one, left to right.
      const photo = chartTargets(it, "photo");
      const own = chartTargets(it, "own");
      const room = (onsets[k + 1] ?? FRAMES) - at;
      const pic = pics.get(id.slice(2))!;
      const nextHas = k + 1 < K && laid[k + 1]!.items.has(id);
      if (room < 70 && nextHas) {
        // Too short to see the original and its redrawing in one moment: the original holds, and the next moment's
        // own change is the redrawing (its bars move from the original's bars to their new places).
        for (const [n, p, v] of photo) put(n, p, v, t0 - 1);
        put(id, "opacity", 0, t0 - 1);
        put(id, "opacity", 1, at, 10, "out");
        notes.push(`${tag(f.m)} ${pic.name}: the user's own chart shows as it is; the next moment redraws it on its own bars`);
      } else if (room >= 30) {
        for (const [n, p, v] of photo) put(n, p, v, t0 - 1);
        put(id, "opacity", 0, t0 - 1);
        put(id, "opacity", 1, at, 10, "out");
        const tm = at + Math.max(22, Math.min(60, room - 40)); // every part of the redraw ends before the next moment
        pic.data!.values.forEach((_, i) => put(`${id}.bar${i}`, "opacity", 1, tm, 6, "out"));
        put(id, "opacity", 0, tm + 6, 10, "in");
        for (const [n, p, v] of own) {
          if (n === id && p === "opacity") continue;
          const late = /\.(lv|lt|lab\d+|val\d+|hd\.|title|base)/.test(n) || p === "fill";
          put(n, p, v, late ? tm + 22 : tm + 6, late ? 14 : 24, "smooth");
        }
        notes.push(`${tag(f.m)} ${pic.name}: the user's own chart shows as it is for ${((tm - at) / FPS).toFixed(1)} s, then its ${pic.data!.values.length} bars are redrawn on top of the originals and the chart grows to fill the stage`);
      } else {
        const hz = pic.data!.orient === "h";
        const base = new Map(own.filter(([n, p]) => /\.base$/.test(n) && p === "y").map(([, , v]) => ["y", v as number]));
        const tri = new Map(own.map(([n, p, v]) => [`${n}|${p}`, v]));
        for (const [n, p, v] of own) {
          const bar = /\.bar(\d+)$/.exec(n);
          const delay = bar ? 4 * Number(bar[1]) : 0;
          if (bar && p === (hz ? "scaleX" : "scaleY")) {
            put(n, p, 0.5, t0 - 1);
            put(n, p, v, at + delay, 16, "out");
          } else if (bar && !hz && p === "y") {
            const bottom = (v as number) + ((tri.get(`${n}|scaleY`) as number) ?? 0);
            put(n, p, bottom, t0 - 1);
            put(n, p, v, at + delay, 16, "out");
          } else if (bar && p === "opacity") {
            put(n, p, 0, t0 - 1);
            put(n, p, v, at + delay, 6, "out");
          } else put(n, p, v, at + (/\.(val|lv|lt)/.test(n) ? 20 : 0), 10, "out");
        }
        void base;
        notes.push(`${tag(f.m)} ${pic.name}: the chart is redrawn in the style, its bars growing in one by one`);
      }
      return;
    }
    const e = entOfKey(id);
    const born = it.born ? (prev.get(it.born) ?? cur.get(it.born)) : undefined;
    const reveal = it.st.reveal && (it.type === "text" || it.type === "many");
    const dur = reveal ? 16 : Math.max(10, base);
    for (const [n, p, v] of target(it)) {
      let from: Value = v;
      let frames = dur;
      let ease: Ease = "out";
      let atN = at;
      if (it.type === "text" || it.type === "ph") {
        if (n === id && p === "opacity") (from = 0, (frames = reveal ? 6 : 10));
        if (n === id && (p === "scaleX" || p === "scaleY")) from = (v as number) * (reveal ? 0.6 : 0.9);
        if (reveal && n === id && (p === "scaleX" || p === "scaleY")) ease = "overshoot";
        if (born && n === id) {
          if (p === "x") from = born.st.x;
          if (p === "y") from = born.st.y;
          if (p === "scaleX" || p === "scaleY") from = Math.max(0.15 * (v as number), Math.min(born.st.h / (e!.lines[it.st.ver]!.length * LINE * 100), 1.5 * (v as number)));
        }
      } else if (it.type === "many") {
        if (n === id && p === "opacity") (from = 0, (frames = 10));
        if (n === `${id}.dots` && (p === "scaleX" || p === "scaleY")) from = (v as number) * 0.9;
        if (n.endsWith(".lab") && p === "text") (from = v);
        if (born && n === id && (p === "x" || p === "y")) from = p === "x" ? born.st.x : born.st.y;
      } else if (it.type === "obj") {
        if (n === id && p === "opacity") (from = 0, (frames = 12));
        if (n === id && (p === "scaleX" || p === "scaleY")) from = (v as number) * 0.92;
      } else if (it.type === "pic") {
        // The picture arrives whole, then its content closes in on the part and the marks draw on.
        if (n === id && p === "opacity") (from = 0, (frames = 10));
        else if (n === id && (p === "scaleX" || p === "scaleY")) from = (v as number) * 0.9;
        else if (n === `${id}.c`) (from = p === "x" || p === "y" ? 0 : 1, (atN = at + 6), (frames = Math.max(dur, 22)), (ease = "smooth"));
        else if (p === "opacity" || p === "trimEnd") (from = 0, (atN = at + 10), (frames = 14), (ease = "smooth"));
      } else if (it.type === "card") {
        if (p === "opacity") (from = 0, (frames = 8));
      } else if (it.type === "strike" || it.type === "arrow" || it.type === "parrow") {
        if (p === "opacity") from = 1;
        if (p === "trimEnd") (from = 0, (ease = "smooth"), (frames = 14));
      } else if (it.type === "vbar") {
        if (p === "scaleY") (from = 0, (ease = "smooth"), (frames = 20));
        if (p === "opacity") (from = 0, (frames = 6));
      } else if (it.type === "bar") {
        if (p === "scaleX") (from = 0, (ease = "smooth"), (frames = 16));
        if (p === "opacity") (from = 0, (frames = 6));
      }
      put(n, p, from, t0 - 1);
      put(n, p, v, atN, frames, ease);
    }
    if (it.type === "many") {
      const e2 = e!;
      const nDots = Math.min(it.st.n, e2.maxN);
      const step = Math.min(1.5, 24 / Math.max(1, nDots));
      dotRange(it, 0, e2.maxN).forEach((dn, j) => {
        put(dn, "opacity", 0, t0 - 1);
        put(dn, "scaleX", 0.3, t0 - 1);
        put(dn, "scaleY", 0.3, t0 - 1);
        if (j < nDots) {
          const when = at + 4 + Math.round(j * step);
          put(dn, "opacity", 1, when, 8, "out");
          put(dn, "scaleX", 1, when, 8, "out");
          put(dn, "scaleY", 1, when, 8, "out");
        }
      });
    }
    if (it.type === "ph") plays.push({ at: at + 22, target: id, behavior: "pulse", args: { size: 1.06, frames: 40 } });
    if (reveal) notes.push(`${tag(f.m)} reveal ${e!.id}: ${phDip ? "the placeholder dips for 5 frames, then " : ""}it pops in with an overshoot in the answer color`);
    if (born) notes.push(`${tag(f.m)} ${e?.id ?? id} is born from ${it.born!.replace(/^t\./, "")}: it starts at that thing's place and size`);
    void isLast;
  };
  entering.forEach((id, i) => enterOne(id, t0 + enOff + STAG * i, false));
  if (lastId && enters.includes(lastId)) enterOne(lastId, subjAt, true);
  for (const id of enters) {
    const it = cur.get(id)!;
    if (it.type === "bar") enterOne(id, subjAt + 4, false);
    if (it.type === "vbar") enterOne(id, subjAt + 2, false);
    if (it.type === "strike") (enterOne(id, subjAt + Math.round(base * 0.7), false), notes.push(`${tag(f.m)} wrong ${id.slice(7)}: a strike line draws across it and it shrinks to 0.85`));
  }

  for (const [id, it] of cur) {
    if (it.type !== "pic" || pics.get(id.slice(2))!.data) continue;
    const before = prev.get(id)?.st;
    const pic = pics.get(id.slice(2))!;
    const pct = (part: string) => `${Math.round((pic.parts.get(part)![2] - pic.parts.get(part)![0]) * 100)}%`;
    if (it.st.sub && it.st.sub !== before?.sub) notes.push(`${tag(f.m)} picture ${pic.name}.${it.st.sub}: the part is ${pct(it.st.sub)} of the picture width, ${it.st.z > 1.08 ? `so the picture closes in on it (zoom ${it.st.z.toFixed(1)}x), ` : "so no zoom, "}the rest is dimmed to ${Math.round(DIM * 100)}% and an outline draws on`);
    else if (it.st.sup?.length && it.st.sup.join() !== (before?.sup ?? []).join()) notes.push(`${tag(f.m)} picture ${pic.name}: kept part ${it.st.sup.join(", ")} gets a quiet outline${it.st.z > 1.08 ? `, the view eases to zoom ${it.st.z.toFixed(1)}x` : ""}, no dimming`);
    else if (!it.st.sub && !it.st.sup?.length && before && (before.sub || before.sup?.length)) notes.push(`${tag(f.m)} picture ${pic.name}: whole picture again, the zoom eases back and the marks leave`);
  }
  scheduleActs(k, actAt, cur);
  for (const [id, it] of cur) {
    if (it.type !== "pic" || !pics.get(id.slice(2))!.data) continue;
    const pic = pics.get(id.slice(2))!;
    const set = chartSeen.get(id) ?? chartSeen.set(id, new Set()).get(id)!;
    for (const part of [...(it.st.lit ?? []), it.st.sub, ...(it.st.sup ?? [])]) if (part) for (const i of pic.barsOf.get(part) ?? []) set.add(i);
  }
  if (f.m.reveal && cur.get(key(sid(f.m.reveal)!))?.type === "obj") plays.push({ at: subjAt + 6, target: key(sid(f.m.reveal)!), behavior: "pulse", args: { size: 1.05, frames: 18 } });
  // Camera: stress pushes in slowly; a long still moment gets a very slow push so the frame stays alive.
  const tEnd = subjAt + Math.max(subjDur, base) + 4;
  const nextOn = onsets[k + 1] ?? FRAMES;
  const window = nextOn - tEnd;
  if (f.acts.some((a) => a.verb === "reads")) {
    /* the camera is busy reading */
  } else if (plan.stress && window > 20) (camOp(1.05, tEnd - 8, window + 8, "linear"), notes.push(`${tag(f.m)} stress: the subject is one size step larger and the camera pushes in slowly to 1.05 over ${(window / FPS).toFixed(1)} s`));
  else if (window > 60 && (nextOn - t0) / FPS > 3 && !plan.question) (camOp(1.02, tEnd, window, "linear"), notes.push(`${tag(f.m)} still for ${((nextOn - t0) / FPS).toFixed(1)} s: a very slow push 1 to 1.02 keeps the frame alive`));
  if (becomesNow.length) notes.push(`${tag(f.m)} ${becomesNow.map((i) => entOfKey(i)!.id).join(", ")} changes in place (old words lift and fade, new words rise, then a pulse)`);
}

// ---------------------------------------------------------------------------------------------------------------
// 9. Assemble the SceneDoc and compile.
// ---------------------------------------------------------------------------------------------------------------
const steps: Step[] = [{ at: 0, add: specs, enter: "none", set: { camera: { zoom: 1, panX: W / 2, panY: H / 2 } } }];
const grouped = new Map<string, { at: number; frames: number; ease: Ease; set: Record<string, Props> }>();
for (const o of ops) {
  const gk = `${o.at}|${o.frames}|${o.ease}`;
  const g = grouped.get(gk) ?? grouped.set(gk, { at: o.at, frames: o.frames, ease: o.ease, set: {} }).get(gk)!;
  (g.set[o.id] ??= {})[o.prop] = o.value;
}
for (const g of grouped.values()) steps.push({ at: g.at, set: g.set, move: { frames: g.frames, ease: g.ease } });
for (const p of plays) steps.push({ at: p.at, play: [{ behavior: p.behavior, target: p.target, args: p.args }] });
const doc: SceneDoc = { steps };
const scene = compile(doc, { fps: FPS, width: W, height: H, frames: FRAMES, theme, words: request.words });
writeFileSync(join(dir, `${outName}.scene.json`), JSON.stringify(scene));
writeFileSync(join(dir, `${outName}.notes.txt`), `${[`feel ${parsed.feel}, for ${parsed.audience}, style ${styleArg}, ${K} moments, ${scene.nodes.length} nodes`, ...notes].join("\n")}\n`);
console.log(`${dir}: ${K} moments, ${scene.nodes.length} nodes, ${scene.tracks.length} tracks, ${notes.length} notes`);
