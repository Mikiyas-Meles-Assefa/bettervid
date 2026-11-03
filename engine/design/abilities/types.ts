// Shared shapes of the abilities: what a placed thing's state is in one moment, and the property changes it asks for.
import type { Value } from "../../core/types.ts";

/** One property of one node: [node id, property, value]. */
export type Triple = [string, string, Value];

export type Cls = "subject" | "support" | "question" | "ph";

/** A placed thing's state in one moment, in frame pixels. Each ability reads the fields it needs. */
export type St = {
  x: number; // center
  y: number;
  s: number; // scale of the thing's group (text: font size / 100)
  op: number;
  color: string;
  w: number; // box on screen
  h: number;
  cls: Cls;
  ver: number; // which version of a text is shown
  n: number; // a count, for many
  wrong: boolean;
  reveal: boolean;
  fs: number; // font size in pixels
  dotsY: number;
  labY: number;
  label: string;
  len: number; // a bar's or line's length; for a falling thing, the distance it falls
  z: number; // a picture's zoom inside its own frame
  ox: number;
  oy: number;
  sub?: string; // a picture's subject part
  sup?: string[]; // a picture's support parts
  pts: number[];
  lit?: string[]; // chart parts lit
  levels?: { part: string; v: number; tag: string }[];
};

export const blankSt = (color: string): St => ({ x: 0, y: 0, s: 1, op: 1, color, w: 0, h: 0, cls: "support", ver: 0, n: 0, wrong: false, reveal: false, fs: 0, dotsY: 0, labY: 0, label: "", len: 0, z: 1, ox: 0, oy: 0, pts: [] });

/** A measure of text width: width in pixels of `text` at `size` px in the font named. */
export type Measure = (text: string, size: number, font?: string) => number;

/** A number in a text, and what it counts: a symbol ($ % and the like) is a unit by itself, otherwise the word after it. */
/**
 * The share a phrase names of something else ("almost half", "a third of", "three quarters", "40%"), when it names one:
 * a share is never a value by itself, only of what it is a share of.
 */
export function fractionOf(t: string): number | undefined {
  const s = t.toLowerCase();
  const pct = /(\d+(?:\.\d+)?)\s*(%|percent|per cent)/.exec(s);
  if (pct) return Number(pct[1]) / 100;
  const count: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  const part: Record<string, number> = { half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4, fourth: 4, fourths: 4, fifth: 5, fifths: 5, tenth: 10, tenths: 10 };
  const m = /\b(?:(a|an|one|two|three|four|five|six|seven|eight|nine)[\s-]+)?(half|halves|thirds?|quarters?|fourths?|fifths?|tenths?)\b/.exec(s);
  if (!m) return undefined;
  return (m[1] ? count[m[1]]! : 1) / part[m[2]!]!;
}

export function numOf(t: string): { v: number; unit: string } | undefined {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(t);
  if (!m) return undefined;
  const symbols = t.replace(m[0], "").replace(/[^$%€£¥]/g, "");
  const after = t.slice(m.index + m[0].length).trim().split(/\s+/)[0]!.toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");
  return { v: Number(m[0].replace(/,/g, "")), unit: symbols || after };
}
