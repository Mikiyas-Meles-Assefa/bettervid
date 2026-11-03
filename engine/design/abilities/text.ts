// Text blocks: words that keep one node tree for their whole life, with versions (A becomes "..."), lines chosen once per
// text, a change in place, a strike through (wrong), and birth from another thing's place and size.
import type { Value } from "../../core/types.ts";
import type { Measure, St, Triple } from "./types.ts";
import type { Writer } from "./writer.ts";

export type TextEnt = { id: string; texts: string[]; lines: string[][]; ems: number[] };

/** The best two-line split of a text: the one whose longer line is shortest. */
export function twoLines(text: string, em: (t: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text];
  let best: string[] = [text];
  let bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const w = Math.max(em(a), em(b));
    if (w < bestW) (bestW = w), (best = [a, b]);
  }
  return best;
}

/**
 * Lines for a text, fixed for the text's life so it keeps one node tree. On two lines when that makes it larger by at
 * least `gain` at the given width and size cap (a subject), or when one line would not fit at `size` (support).
 */
export function pickLines(text: string, em: (t: string) => number, p: { width: number; cap: number; size: number; gain: number; subject: boolean }): string[] {
  const two = twoLines(text, em);
  if (two.length < 2) return two;
  const one = Math.max(0.2, em(text));
  const w2 = Math.max(...two.map(em));
  if (p.subject) return Math.min(p.cap, p.width / w2) >= p.gain * Math.min(p.cap, p.width / one) ? two : [text];
  return one * p.size > p.width ? two : [text];
}

export const emOf = (measure: Measure, font: string) => (t: string) => measure(t, 100, font) / 100;

export function textEnt(id: string, texts: string[], linesOf: (t: string) => string[], em: (t: string) => number): TextEnt {
  const lines = texts.map(linesOf);
  return { id, texts, lines, ems: lines.map((ls) => Math.max(0.2, ...ls.map(em))) };
}

/** The box of a text version at a font size. `lineHeight` is in em. */
export const textBox = (e: TextEnt, ver: number, fs: number, lineHeight: number) => ({ w: e.ems[ver]! * fs, h: e.lines[ver]!.length * lineHeight * fs });

/** Creates the text's node tree hidden: a group, then one text node per line per version, drawn at 100 px. */
export function textNodes(w: Writer, id: string, e: TextEnt, role: string, color: string, lineHeight: number) {
  w.node(id, "group", { opacity: 0, scaleX: 0.01, scaleY: 0.01, x: w.width / 2, y: w.height / 2 });
  e.lines.forEach((ls, v) => ls.forEach((t, i) => w.node(`${id}.v${v}.l${i + 1}`, "text", { y: (i - (ls.length - 1) / 2) * lineHeight * 100, text: t, size: 100, role, color, opacity: v === 0 ? 1 : 0 }, id)));
}

export function textTargets(id: string, e: TextEnt, st: St): Triple[] {
  const out: Triple[] = [[id, "x", st.x], [id, "y", st.y], [id, "scaleX", st.s], [id, "scaleY", st.s], [id, "opacity", st.op]];
  e.lines.forEach((ls, v) =>
    ls.forEach((_, i) => {
      out.push([`${id}.v${v}.l${i + 1}`, "opacity", v === st.ver ? 1 : 0]);
      if (v === st.ver) out.push([`${id}.v${v}.l${i + 1}`, "color", st.color]);
    }),
  );
  return out;
}

export type BecomesParams = { at: number; prepAt: number; lift: number; outFrames: number; inFrames: number; inDelay: number; accent: string; settleColor: string; settleAfter: number; settleFrames: number; lineHeight: number; pulse?: { at: number; size: number; frames: number } };

/** A in place becomes its next version: the old words lift and fade while the new rise into the same place. */
export function becomes(w: Writer, id: string, e: TextEnt, from: number, to: number, p: BecomesParams) {
  e.lines[from]!.forEach((_, i) => {
    const ln = `${id}.v${from}.l${i + 1}`;
    w.put(ln, "y", (i - (e.lines[from]!.length - 1) / 2) * p.lineHeight * 100 - p.lift, p.at, p.outFrames, "in");
    w.put(ln, "opacity", 0, p.at, p.outFrames, "in");
  });
  e.lines[to]!.forEach((_, i) => {
    const ln = `${id}.v${to}.l${i + 1}`;
    const y = (i - (e.lines[to]!.length - 1) / 2) * p.lineHeight * 100;
    w.put(ln, "y", y + p.lift, p.prepAt);
    w.put(ln, "color", p.accent, p.prepAt);
    w.put(ln, "y", y, p.at + p.inDelay, p.inFrames, "out");
    w.put(ln, "opacity", 1, p.at + p.inDelay, p.inFrames, "out");
    w.put(ln, "color", p.settleColor, p.at + p.settleAfter, p.settleFrames, "smooth");
  });
  if (p.pulse) w.play(p.pulse.at, id, "pulse", { size: p.pulse.size, frames: p.pulse.frames });
}

/** The entrance of a text: where it starts from (born from another thing, or in place at a smaller scale). */
export function textEntryFrom(n: string, p: string, v: Value, id: string, born: St | undefined, e: TextEnt, ver: number, q: { fromScale: number; lineHeight: number }): Value {
  if (n !== id) return v;
  if (p === "opacity") return 0;
  if (born) {
    if (p === "x") return born.x;
    if (p === "y") return born.y;
    if (p === "scaleX" || p === "scaleY") return Math.max(0.15 * (v as number), Math.min(born.h / (e.lines[ver]!.length * q.lineHeight * 100), 1.5 * (v as number)));
  }
  if (p === "scaleX" || p === "scaleY") return (v as number) * q.fromScale;
  return v;
}

/** A strike line: drawn across a wrong thing's first line, and it stays. */
export function strikeNode(w: Writer, id: string, color: string, width: number) {
  w.node(id, "path", { points: [-0.5, 0, 0.5, 0], stroke: color, strokeWidth: width, lineCap: "butt", opacity: 0, trimEnd: 0, scaleX: 100 });
}
export const strikeTargets = (id: string, st: St): Triple[] => [[id, "x", st.x], [id, "y", st.y], [id, "scaleX", st.len], [id, "opacity", 1], [id, "trimEnd", 1]];

