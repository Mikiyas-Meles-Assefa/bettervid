// Marks that direct the eye or carry a relation: an arrow between two things, a pointer from words to a part of a
// picture or chart, columns and bars on one scale (compare), a dashed level line, a floor.
import type { St, Triple } from "./types.ts";
import type { Writer } from "./writer.ts";

type R = { x0: number; y0: number; x1: number; y1: number };

/** A downward arrow from one thing to the next, drawn on: `len` long with a head `head` wide. */
export function arrowNode(w: Writer, id: string, p: { color: string; width: number; len: number; head: number }) {
  w.node(id, "path", { points: [0, 0, 0, p.len, -p.head, p.len - p.head, 0, p.len, p.head, p.len - p.head], role: "pointer", stroke: p.color, strokeWidth: p.width, opacity: 0, trimEnd: 0 });
}
export const arrowTargets = (id: string, st: St): Triple[] => [[id, "x", st.x], [id, "y", st.y], [id, "opacity", 1], [id, "trimEnd", 1]];

/** Points of a pointer from a box of words to a box of a part, leaving the words at the point nearest the part. */
export function pointerPoints(words: { x: number; y: number; w: number; h: number }, part: R, toPart: boolean, p: { gap: number; head: number; inset: number }): number[] {
  const clampX = (v: number, lo: number, hi: number) => Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi));
  const above = words.y < (part.y0 + part.y1) / 2;
  const px = clampX(words.x, part.x0 + p.inset, part.x1 - p.inset);
  // The pointer stops at the part's nearer edge: its top when the words are above it, its bottom when below.
  const py = above ? part.y0 - p.gap * 0.5 : part.y1 + p.gap * 0.5;
  const sx = clampX(px, words.x - words.w / 2 + p.inset, words.x + words.w / 2 - p.inset);
  const sy = above ? words.y + words.h / 2 + p.gap : words.y - words.h / 2 - p.gap;
  const [x1, y1, x2, y2] = toPart ? [sx, sy, px, py] : [px, py, sx, sy];
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const dx = (x2 - x1) / len;
  const dy = (y2 - y1) / len;
  const rot = (a: number) => [x2 - p.head * (dx * Math.cos(a) - dy * Math.sin(a)), y2 - p.head * (dx * Math.sin(a) + dy * Math.cos(a))];
  const L = rot(0.5);
  const Rr = rot(-0.5);
  return [x1, y1, x2, y2, L[0]!, L[1]!, x2, y2, Rr[0]!, Rr[1]!].map((v) => Math.round(v * 10) / 10);
}
export function pointerNode(w: Writer, id: string, p: { color: string; width: number }) {
  w.node(id, "path", { points: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], stroke: p.color, strokeWidth: p.width, opacity: 0, trimEnd: 0 });
}
export const pointerTargets = (id: string, st: St): Triple[] => [[id, "points", st.pts], [id, "opacity", 1], [id, "trimEnd", 1]];

// Rectangles are drawn by their own points in frame pixels, never by stretching a unit shape: a style's hand (wobble,
// offset, stroke) is in local units, and a stretched shape would stretch it too.
const rp = (v: number) => Math.round(v * 10) / 10;
export const rectPts = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1].map(rp);

/** A column standing on a baseline (compare on one scale): st.x is its center, st.y its base, st.w its width, st.len its height. */
export function columnNode(w: Writer, id: string, fill: string) {
  w.node(id, "path", { points: rectPts(0, 0, 0, 0), closed: 1, fill, opacity: 0 });
}
export const columnPts = (st: St, len = st.len) => rectPts(st.x - st.w / 2, st.y - len, st.x + st.w / 2, st.y);
export const columnTargets = (id: string, st: St): Triple[] => [[id, "points", columnPts(st)], [id, "opacity", st.op], [id, "fill", st.color]];

/** A horizontal bar from its left end st.x, centered on st.y, st.len long and `thick` thick (st.h). */
export function barNode(w: Writer, id: string, p: { fill: string }) {
  w.node(id, "path", { points: rectPts(0, 0, 0, 0), closed: 1, fill: p.fill, opacity: 0 });
}
export const barPts = (st: St, len = st.len) => rectPts(st.x, st.y - st.h / 2, st.x + len, st.y + st.h / 2);
export const barTargets = (id: string, st: St): Triple[] => [[id, "points", barPts(st)], [id, "opacity", st.op], [id, "fill", st.color]];

/** Columns of quantities of one kind on one scale: heights proportional to values, the largest `height` tall. */
export function columnsOnOneScale(values: number[], height: number, floor: number): number[] {
  const mx = Math.max(...values, 1e-9);
  return values.map((v) => Math.max(floor, (v / mx) * height));
}

/** A dashed line that joins things at one level (bottoms of falling things), moved as they move. */
export function levelNode(w: Writer, id: string, p: { color: string; width: number; dash: number[] }) {
  w.node(id, "path", { points: [0, 0, 1, 0], stroke: p.color, strokeWidth: p.width, dash: p.dash, opacity: 0 });
}
