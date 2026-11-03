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

const FPS = 30;
const W = 1080;
const H = 1920;
const CUE = 9; // frames a change starts before its word: the eye lands as the word is said

// ---------------------------------------------------------------------------------------------------------------
// 1. Parsing the intent language. Lenient: anything unknown is a note.
// ---------------------------------------------------------------------------------------------------------------
type Def = { id: string; text: string; many?: { n: number; unit: string } };
type Pace = "slow" | "normal" | "fast";
type Mom = {
  word: number; line: number; show?: string; extraShow: string[]; keep: string[]; becomes: { id: string; text?: string; n?: number }[];
  from: { a: string; b: string }[]; compare?: [string, string]; arrows: { a: string; b: string; label: string }[];
  ask?: string; reveal?: string; wrong: string[]; stress: boolean; pace: Pace;
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
      cur = { word: Number(at[1]), line: ln, extraShow: [], keep: [], becomes: [], from: [], arrows: [], wrong: [], stress: false, pace: "normal" };
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
    else if (key === "pace") {
      const p = rest.toLowerCase();
      if (p === "slow" || p === "normal" || p === "fast") cur.pace = p;
      else notes.push(`line ${ln}: pace "${rest}" is not slow, normal or fast, ignored`);
    } else if (key === "ask") cur.ask = quoted(rest) ?? (rest || undefined);
    else {
      let m: RegExpExecArray | null;
      if ((m = /^(\w+)\s+becomes\s+(.*)$/i.exec(line))) {
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
const Y0 = Y_TOP + 0.42 * (Y_BOT - Y_TOP); // optical center
const MIN_FS = 0.045 * W;

// ---------------------------------------------------------------------------------------------------------------
// 3. Timing that follows the voice.
// ---------------------------------------------------------------------------------------------------------------
const wordStart = (n: number) => request.words[Math.min(Math.max(0, n), request.words.length - 1)]!.start;
const paceMul = (p: Pace) => (p === "slow" ? 1.4 : p === "fast" ? 0.7 : 1);
const durMove = (px: number, p: Pace) => Math.max(1, Math.round(Math.min(28, Math.max(10, 10 + 0.35 * Math.sqrt(px))) * paceMul(p) * feelMul));

// Pictures the user gave: a name, a file, a size and named parts (boxes as fractions of the picture).
type Pic = { name: string; src: string; w: number; h: number; about: string; parts: Map<string, [number, number, number, number]> };
const pics = new Map<string, Pic>();
{
  let material: Record<string, { size?: [number, number]; about?: string; parts?: Record<string, { box: [number, number, number, number] }> }> = {};
  try {
    material = JSON.parse(readFileSync(join(dir, "material.json"), "utf8"));
  } catch {}
  for (const [name, file] of Object.entries(request.assets ?? {})) {
    const bytes = readFileSync(join(dir, file));
    const png = bytes.length > 24 && bytes.toString("latin1", 1, 4) === "PNG";
    const size = material[name]?.size ?? (png ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : [1000, 750]);
    const mime = file.toLowerCase().endsWith(".png") ? "png" : "jpeg";
    const parts = new Map(Object.entries(material[name]?.parts ?? {}).map(([k, v]) => [k, v.box] as [string, [number, number, number, number]]));
    pics.set(name, { name, src: `data:image/${mime};base64,${bytes.toString("base64")}`, w: size[0], h: size[1], about: material[name]?.about ?? "", parts });
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
  m.becomes = m.becomes.filter((b) => !pics.has(b.id) || (notes.push(`${w} a picture cannot become something else: ignored`), false));
}
// Declare unknown ids as things whose text is the id.
for (const m of parsed.moments) {
  const used = [m.show, ...m.extraShow, ...m.keep, ...m.becomes.map((b) => b.id), ...m.from.flatMap((f) => [f.a, f.b]), ...(m.compare ?? []), ...m.arrows.flatMap((a) => [a.a, a.b]), m.reveal, ...m.wrong];
  for (const id of used) if (id && !pr(id) && !defs.has(id)) (defs.set(id, { id, text: id }), notes.push(`@${m.word} "${id}" was never declared: made a thing whose text is "${id}"`));
}
for (const m of parsed.moments) if (m.word >= request.words.length || m.word < 0) notes.push(`@${m.word} is not a word of the narration (0 to ${request.words.length - 1}): moved to the nearest word`);
const sorted = parsed.moments.map((m, i) => ({ m, i })).sort((a, b) => Math.min(a.m.word, request.words.length - 1) - Math.min(b.m.word, request.words.length - 1) || a.i - b.i).map((x) => x.m);
if (sorted.some((m, i) => m !== parsed.moments[i])) notes.push("moments were not in word order: sorted by word");

const subjectOf = (m: Mom): string | undefined => m.reveal ?? m.show ?? m.becomes[0]?.id ?? m.arrows[0]?.b ?? m.wrong[0];
const dwellOf = (m: Mom) => Math.round(Math.max(m.pace === "slow" ? 1.5 : m.pace === "fast" ? 0.7 : 1.0, m.reveal || m.ask || m.stress ? 1.4 : 0) * FPS);
const tag = (m: Mom) => `@${m.word}`;

type FM = { m: Mom; onset: number; carry: string[]; becomes: Mom["becomes"]; wrong: string[]; k: number };
const fms: FM[] = [];
for (const m of sorted) {
  const nominal = Math.max(1, Math.round(wordStart(m.word) * FPS) - CUE);
  const fm: FM = { m, onset: nominal, carry: [], becomes: m.becomes, wrong: m.wrong, k: 0 };
  for (;;) {
    const prev = fms.at(-1);
    if (!prev) break;
    const cand = Math.max(nominal, prev.onset + dwellOf(prev.m));
    const delay = cand - nominal;
    // A reveal or ask is a payoff or a pause: it is never merged away, so the next moment may wait a little longer.
    if (delay <= (prev.m.reveal || prev.m.ask ? 27 : 15)) {
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
type Plan = { slots: Slot[]; pair?: [string, string]; arrows: { a: string; b: string; label: string }[]; parrows: PArrow[]; subject?: string; stress: boolean; question?: string; phFor?: string };
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
  if (pair && (pr(pair[0]) || pr(pair[1]))) {
    notes.push(`${tag(m)} compare ${pair[0]} ${pair[1]} involves a picture: both are shown and the part is outlined`);
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
  plans.push({ slots, pair: pair && has(pair[0]) && has(pair[1]) ? (pair as [string, string]) : undefined, arrows: plainArrows, parrows, subject: subj, stress: m.stress, question: q, phFor });
});
// Which pictures ever share the frame with words: those keep the smaller stage in every moment, so the box stays put.
const picRoom = new Set<string>();
for (const p of plans) if (p.slots.some((s) => !pics.has(s.id) && s.cls !== "question") || p.question) for (const s of p.slots) if (pics.has(s.id)) picRoom.add(s.id);
const picParts = new Map<string, Set<string>>();
for (const p of plans) for (const s of p.slots) if (pics.has(s.id)) for (const x of [s.part, ...(s.parts ?? [])]) if (x) (picParts.get(s.id) ?? picParts.set(s.id, new Set()).get(s.id)!).add(x);

// ---------------------------------------------------------------------------------------------------------------
// 5. Entities: what is drawn. Versions (becomes "text") and counts (becomes N) over time.
// ---------------------------------------------------------------------------------------------------------------
type Ent = { id: string; type: "text" | "many" | "ph" | "pic"; texts: string[]; lines: string[][]; ems: number[]; unit: string; maxN: number; n0: number };
const ents = new Map<string, Ent>();
const key = (id: string) => (pics.has(id) ? `p.${id}` : `t.${id}`);
const verAt: Map<string, number>[] = [];
const countAt: Map<string, number>[] = [];
const textsOf = new Map<string, string[]>();
const nOf = new Map<string, number>();
for (const d of defs.values()) {
  if (d.many) nOf.set(d.id, d.many.n);
  else textsOf.set(d.id, [d.text]);
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
  if (d.many) {
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
type St = { x: number; y: number; s: number; op: number; color: string; w: number; h: number; cls: Cls; ver: number; n: number; wrong: boolean; reveal: boolean; fs: number; dotsY: number; labY: number; label: string; len: number; bar: boolean; z: number; ox: number; oy: number; sub?: string; sup?: string[]; pts: number[] };
type Item = { id: string; type: "text" | "ph" | "many" | "strike" | "bar" | "arrow" | "pic" | "parrow" | "card"; st: St; born?: string };
const blank = (): St => ({ x: 0, y: 0, s: 1, op: 1, color: C.subject, w: 0, h: 0, cls: "support", ver: 0, n: 0, wrong: false, reveal: false, fs: 0, dotsY: 0, labY: 0, label: "", len: 0, bar: false, z: 1, ox: 0, oy: 0, pts: [] });
const LINE = 1.12; // line height in em
const PITCH = 40; // dot spacing in the dots group's own units
const gridOf = (e: Ent) => {
  const cols = Math.ceil(Math.sqrt(e.maxN));
  return { cols, rows: Math.ceil(e.maxN / cols) };
};
// A number in a text, and what it counts: a symbol ($ % and the like) is a unit by itself, otherwise the word after it.
const numOf = (t: string) => {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(t);
  if (!m) return undefined;
  const symbols = t.replace(m[0], "").replace(/[^$%\u20ac\u00a3]/g, "");
  const after = t.slice(m.index + m[0].length).trim().split(/\s+/)[0]!.toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");
  return { v: Number(m[0].replace(/,/g, "")), unit: symbols || after };
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
function screenBox(st: St, p: Pic, part: string) {
  const [u0, v0, u1, v1] = p.parts.get(part)!;
  const X = (u: number) => st.x + st.s * (st.ox + st.z * (u - 0.5) * REFW);
  const Y = (v: number) => st.y + st.s * (st.oy + st.z * (v - 0.5) * refH(p));
  return { x0: X(u0), y0: Y(v0), x1: X(u1), y1: Y(v1) };
}
const roundedRect = (x0: number, y0: number, x1: number, y1: number, r: number) => `M${x0 + r} ${y0}H${x1 - r}Q${x1} ${y0} ${x1} ${y0 + r}V${y1 - r}Q${x1} ${y1} ${x1 - r} ${y1}H${x0 + r}Q${x0} ${y1} ${x0} ${y1 - r}V${y0 + r}Q${x0} ${y0} ${x0 + r} ${y0}Z`;

type Placed = { id: string; dx: number; dy: number; w: number; h: number; st: Partial<St> };
type Dec = { type: "bar" | "arrow"; id: string; dx: number; dy: number; len: number; color: string; owner?: string };
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
      const w = Math.min(SW, (lone || !picRoom.has(s.id) ? 0.88 : 0.55) * AVAIL * asp) * cp;
      const h = w / asp;
      const v = viewOf(p, s.part ?? s.parts?.[0], s.part ? "subject" : "support");
      return { rank: -0.5, h, items: [{ id: s.id, dx: 0, dy: h / 2, w, h, st: { cls: s.cls, op: 1, s: w / REFW, ...v, sub: s.part, sup: s.parts } }], decor: [], subjectDy: subjectLike ? h / 2 : undefined };
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
    const si = blocks.findIndex((b) => b.subjectDy !== undefined);
    let top: number;
    if (si >= 0) {
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
      const type = e.type === "many" ? "many" : e.type === "ph" ? "ph" : e.type === "pic" ? "pic" : "text";
      const st = { ...blank(), ...p.st, x: W / 2 + p.dx, y: y + p.dy, w: p.w, h: p.h };
      const id = p.id === "ph" ? "ph" : p.id.startsWith("q.") || p.id.startsWith("lab.") ? p.id : key(p.id);
      items.set(id, { id, type, st, born: slotOf.get(p.id)?.born ? key(sid(slotOf.get(p.id)!.born!)!) : undefined });
      order.push(id);
      if (st.wrong) items.set(`strike.${p.id}`, { id: `strike.${p.id}`, type: "strike", st: { ...blank(), x: st.x, y: st.y, len: p.w + 40, color: C.wrong, op: 1 } });
    }
    for (const d of b.decor) {
      const st = { ...blank(), x: W / 2 + d.dx, y: y + d.dy, len: d.len, color: d.color, op: 1 };
      items.set(d.id, { id: d.id, type: d.type, st });
    }
  }
  // Arrows to or from a part of a picture: drawn from the words to the part's box on screen, through the current zoom.
  plan.parrows.forEach((pa, i) => {
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
  });
  // Born from: the source must be on screen; otherwise it simply enters.
  for (const [id, it] of items) if (it.born && !items.has(it.born)) it.born = undefined;
  return { items, order };
}

const laid: { items: Map<string, Item>; order: string[] }[] = [];
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
const entOfKey = (id: string): Ent | undefined => (id === "ph" ? ents.get("ph") : id.startsWith("q.") || id.startsWith("lab.") ? ents.get(id) : id.startsWith("t.") || id.startsWith("p.") ? ents.get(id.slice(2)) : undefined);
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
  } else makeText(nid, e, id.startsWith("q.") ? "heading" : id.startsWith("lab.") ? "label" : "title");
}
for (const id of used) {
  if (id.startsWith("strike.")) node(id, "path", { points: [-0.5, 0, 0.5, 0], stroke: C.wrong, strokeWidth: 10, lineCap: "butt", opacity: 0, trimEnd: 0, scaleX: 100 });
  else if (id.startsWith("bar.")) node(id, "path", { points: [0, -0.5, 1, -0.5, 1, 0.5, 0, 0.5], closed: 1, fill: C.key, opacity: 0, scaleX: 0, scaleY: 0.022 * W });
  else if (id.startsWith("parrow.")) node(id, "path", { points: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], stroke: C.pointer, strokeWidth: 8, opacity: 0, trimEnd: 0 });
  else if (id.startsWith("arrow.")) node(id, "path", { points: [0, 0, 0, 70, -18, 52, 0, 70, 18, 52], role: "pointer", stroke: C.pointer, strokeWidth: 8, opacity: 0, trimEnd: 0 });
}

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
  else if (it.type === "bar") out.push([id, "x", st.x], [id, "y", st.y], [id, "scaleX", st.len], [id, "opacity", 1], [id, "fill", st.color]);
  else out.push([id, "x", st.x], [id, "y", st.y], [id, "opacity", 1], [id, "trimEnd", 1]);
  return out;
}
const dotRange = (it: Item, from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, j) => `${it.id}.d${from + j}`);

const CAM_PY = Y0;
const camPan = (z: number) => CAM_PY - (CAM_PY - H / 2) / z;
let camZ = 1;
const camOp = (z: number, at: number, frames: number, ease: Ease) => {
  ops.push({ id: "camera", prop: "zoom", value: z, at: Math.round(at), frames: Math.max(1, Math.round(frames)), ease });
  ops.push({ id: "camera", prop: "panY", value: camPan(z), at: Math.round(at), frames: Math.max(1, Math.round(frames)), ease });
  camZ = z;
};

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
  const entering = enters.filter((id) => id !== lastId && cur.get(id)!.type !== "bar" && cur.get(id)!.type !== "strike");
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
    if (it.type === "text" || it.type === "ph" || it.type === "pic") {
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
    if (it.type === "strike") (enterOne(id, subjAt + Math.round(base * 0.7), false), notes.push(`${tag(f.m)} wrong ${id.slice(7)}: a strike line draws across it and it shrinks to 0.85`));
  }

  for (const [id, it] of cur) {
    if (it.type !== "pic") continue;
    const before = prev.get(id)?.st;
    const pic = pics.get(id.slice(2))!;
    const pct = (part: string) => `${Math.round((pic.parts.get(part)![2] - pic.parts.get(part)![0]) * 100)}%`;
    if (it.st.sub && it.st.sub !== before?.sub) notes.push(`${tag(f.m)} picture ${pic.name}.${it.st.sub}: the part is ${pct(it.st.sub)} of the picture width, ${it.st.z > 1.08 ? `so the picture closes in on it (zoom ${it.st.z.toFixed(1)}x), ` : "so no zoom, "}the rest is dimmed to ${Math.round(DIM * 100)}% and an outline draws on`);
    else if (it.st.sup?.length && it.st.sup.join() !== (before?.sup ?? []).join()) notes.push(`${tag(f.m)} picture ${pic.name}: kept part ${it.st.sup.join(", ")} gets a quiet outline${it.st.z > 1.08 ? `, the view eases to zoom ${it.st.z.toFixed(1)}x` : ""}, no dimming`);
    else if (!it.st.sub && !it.st.sup?.length && before && (before.sub || before.sup?.length)) notes.push(`${tag(f.m)} picture ${pic.name}: whole picture again, the zoom eases back and the marks leave`);
  }
  // Camera: stress pushes in slowly; a long still moment gets a very slow push so the frame stays alive.
  const tEnd = subjAt + Math.max(subjDur, base) + 4;
  const nextOn = onsets[k + 1] ?? FRAMES;
  const window = nextOn - tEnd;
  if (plan.stress && window > 20) (camOp(1.05, tEnd - 8, window + 8, "linear"), notes.push(`${tag(f.m)} stress: the subject is one size step larger and the camera pushes in slowly to 1.05 over ${(window / FPS).toFixed(1)} s`));
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
