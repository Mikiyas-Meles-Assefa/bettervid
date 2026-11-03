// Checks a reading against its source without a model, wherever code can: boxes inside the picture and not degenerate,
// a chart's values against the totals and texts the card itself reads and against its own bars, words found in the
// document they claim to come from, data matching a table in the project. It returns problems in plain words, for the
// reader to repair; it never changes the reading.
import type { Box, PartCard } from "../types.ts";
import { numberOf, parseTable } from "./text.ts";

export type CheckSettings = {
  /** How far a box may sit from where the chart's own numbers put it, as a share of the plot's length: the precision of
   * a box drawn by eye on a picture, not a matter of taste. */
  tolerance: number;
  /** A box under this many pixels across is not a part. */
  minPixels: number;
};
export const CHECK: CheckSettings = { tolerance: 0.02, minPixels: 2 };

export type Source = {
  /** The file's text, for a card read from text: every part's words must be found in it. */
  text?: string;
  /** Tables elsewhere in the project (CSV text by file name): a chart that shows one must match it. */
  tables?: { file: string; text: string }[];
};

const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const numbersIn = (s: string) => [...s.matchAll(/[+-]?\d[\d,]*\.?\d*/g)].map((m) => numberOf(m[0])).filter((x): x is number => x !== undefined);
const decimals = (x: number) => (String(x).split(".")[1] ?? "").length;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function boxProblems(name: string, b: Box | undefined, size?: [number, number], set: CheckSettings = CHECK): string[] {
  if (!b) return [];
  if (!Array.isArray(b) || b.length !== 4 || b.some((x) => typeof x !== "number" || !Number.isFinite(x))) return [`${name}: the box must be four numbers`];
  const out: string[] = [];
  const [x0, y0, x1, y1] = b;
  if (b.some((x) => x < -0.005 || x > 1.005)) out.push(`${name}: the box [${b.map(r3).join(", ")}] reaches outside the picture (fractions run from 0 to 1)`);
  if (x1 <= x0 || y1 <= y0) out.push(`${name}: the box [${b.map(r3).join(", ")}] is empty or reversed (x0 < x1 and y0 < y1)`);
  else if (size && ((x1 - x0) * size[0] < set.minPixels || (y1 - y0) * size[1] < set.minPixels)) out.push(`${name}: the box is under ${set.minPixels} pixels across`);
  return out;
}

/** Where the chart's own numbers put each bar, as a box in the picture. */
export function expectedBar(d: NonNullable<PartCard["data"]>, i: number): Box | undefined {
  if (!d.plot || !d.ymax || d.ymax <= 0) return undefined;
  const [px0, py0, px1, py1] = d.plot;
  const n = d.values.length;
  const share = d.values[i]! / d.ymax;
  const half = (d.barFrac ?? 1) / 2;
  if (d.orient === "h") {
    const slot = (py1 - py0) / n;
    const c = py0 + (i + 0.5) * slot;
    return [px0, c - half * slot, px0 + share * (px1 - px0), c + half * slot];
  }
  const slot = (px1 - px0) / n;
  const c = px0 + (i + 0.5) * slot;
  return [c - half * slot, py1 - share * (py1 - py0), c + half * slot, py1];
}

export function chartProblems(card: PartCard, set: CheckSettings = CHECK): string[] {
  const d = card.data;
  if (!d) return [];
  const out: string[] = [];
  if (!Array.isArray(d.labels) || !Array.isArray(d.values)) return ["data: labels and values must be lists"];
  if (d.labels.length !== d.values.length) out.push(`data: ${d.labels.length} labels but ${d.values.length} values`);
  if (d.values.some((v) => typeof v !== "number" || !Number.isFinite(v))) out.push("data: every value must be a number");
  if (out.length) return out;
  const n = d.values.length;
  if (d.ymax !== undefined && d.ymax < Math.max(...d.values)) out.push(`data: ymax ${d.ymax} is below the largest value ${Math.max(...d.values)}; ymax is the value at the axis's end`);
  if (d.plot) out.push(...boxProblems("data.plot", d.plot, card.size, set));
  if (d.barFrac !== undefined && !(d.barFrac > 0 && d.barFrac <= 1)) out.push(`data: barFrac ${d.barFrac} must be above 0 and at most 1`);
  // A stated total: the values must add up to it, within the rounding of values read to their printed precision.
  if (d.total !== undefined) {
    const sum = d.values.reduce((a, b) => a + b, 0);
    const slack = 0.5 * n * 10 ** -Math.max(0, ...d.values.map(decimals)) + 1e-9;
    if (Math.abs(sum - d.total) > slack) out.push(`data: the values add up to ${r3(sum)} but the picture's total reads ${d.total}`);
  }
  if (d.parts) {
    if (d.parts.length !== n) out.push(`data.parts: ${d.parts.length} names for ${n} values`);
    const boxes: (Box | undefined)[] = d.parts.map((p, i) => {
      const part = card.parts[p];
      if (!part) {
        out.push(`data.parts[${i}]: "${p}" is not one of the card's parts`);
        return undefined;
      }
      // A number written in the value's own part must be the value.
      const nums = part.text ? numbersIn(part.text) : [];
      if (nums.length && !nums.some((x) => Math.abs(x - d.values[i]!) <= 0.5 * 10 ** -decimals(d.values[i]!) + 1e-9)) out.push(`data: ${d.labels[i]} is ${d.values[i]} but its part "${p}" reads "${part.text}"`);
      return part.box;
    });
    // Bars: their lengths in the picture are ordered as their values, and sit where the chart's own numbers put them.
    if ((d.orient || /bar|column|histogram/i.test(d.kind)) && boxes.every(Boolean) && boxes.length === n) {
      const len = boxes.map((b) => (d.orient === "h" ? b![2] - b![0] : b![3] - b![1]));
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          if (d.values[i]! > d.values[j]! && len[i]! <= len[j]!) out.push(`data: ${d.labels[i]} (${d.values[i]}) is larger than ${d.labels[j]} (${d.values[j]}) but its bar is not longer in the boxes`);
      if (d.plot && d.ymax) {
        const span = d.orient === "h" ? [d.plot[2] - d.plot[0], d.plot[3] - d.plot[1]] : [d.plot[3] - d.plot[1], d.plot[2] - d.plot[0]];
        boxes.forEach((b, i) => {
          const e = expectedBar(d, i)!;
          const [along, across] = d.orient === "h" ? [[0, 2], [1, 3]] : [[1, 3], [0, 2]];
          const offAlong = Math.max(...along.map((k) => Math.abs(b![k]! - e[k]!))) / span[0]!;
          const centre = (x: Box, k: number[]) => (x[k[0]!]! + x[k[1]!]!) / 2;
          const offAcross = Math.abs(centre(b!, across) - centre(e, across)) / span[1]!;
          if (offAlong > set.tolerance || offAcross > set.tolerance)
            out.push(`data: the ${d.labels[i]} bar's box [${b!.map(r3).join(", ")}] is not where the plot, ymax and value put it ([${e.map(r3).join(", ")}]); one of the box, the plot area, ymax or the value is misread`);
        });
      }
    }
  }
  return out;
}

/** A chart that shows a table in the project: labels found in the table's first column must carry the same value. */
export function tableProblems(card: PartCard, tables: Source["tables"] = []): string[] {
  const d = card.data;
  if (!d || !tables.length) return [];
  const out: string[] = [];
  for (const t of tables) {
    const tab = parseTable(t.text);
    const rows = new Map(tab.rows.map((r) => [squash(r.cells[0] ?? ""), r.cells.slice(1).map(numberOf)]));
    const shared = d.labels.filter((l) => rows.has(squash(l)));
    if (shared.length * 2 < d.labels.length) continue; // not this table
    d.labels.forEach((l, i) => {
      const cells = rows.get(squash(l));
      if (!cells) return void out.push(`data: ${l} is not a row of ${t.file}`);
      const v = d.values[i]!;
      if (!cells.some((c) => c !== undefined && Math.abs(c - v) <= 0.5 * 10 ** -decimals(c) + 1e-9)) out.push(`data: ${l} is ${v} but ${t.file} has ${cells.filter((c) => c !== undefined).join(", ")}`);
    });
  }
  return out;
}

/** Every problem code can find with a reading. An empty list means the reading checks. */
export function checkCard(card: PartCard, source: Source = {}, set: CheckSettings = CHECK): string[] {
  const out: string[] = [];
  if (!card.kind?.trim()) out.push("the card says nothing about what kind of thing it is");
  if (!card.about?.trim()) out.push("the card says nothing about what it shows");
  for (const [k, p] of Object.entries(card.parts ?? {})) {
    if (!/^[\w.-]+$/.test(k)) out.push(`part "${k}": a name is letters, digits, dots and dashes`);
    if (!p.about?.trim()) out.push(`part ${k}: no about`);
    out.push(...boxProblems(`part ${k}`, p.box, card.size, set));
  }
  out.push(...chartProblems(card, set));
  out.push(...tableProblems(card, source.tables));
  // Words a card says a document holds must be in the document.
  if (source.text !== undefined) {
    const doc = squash(source.text);
    for (const [k, p] of Object.entries(card.parts ?? {})) if (p.text && !doc.includes(squash(p.text))) out.push(`part ${k}: "${p.text}" is not in the file`);
  } else if (card.text) {
    // A picture's card: the words a part holds must be among the words it says the picture has.
    const words = squash(card.text);
    for (const [k, p] of Object.entries(card.parts ?? {})) if (p.text && !words.includes(squash(p.text))) out.push(`part ${k}: its text "${p.text}" is not in the card's list of words in the picture`);
  }
  return out;
}
