// Many: countable marks of one kind in a grid, with a label "unit × n". Counts change mark by mark.
import { circlePts } from "./writer.ts";
import type { St, Triple } from "./types.ts";
import type { Writer } from "./writer.ts";

export type ManyEnt = { id: string; unit: string; maxN: number; n0: number };

/** Mark spacing in the marks group's own units. Geometry of the drawing, scaled as a group. */
export const PITCH = 40;

export const gridOf = (e: ManyEnt) => {
  const cols = Math.ceil(Math.sqrt(e.maxN));
  return { cols, rows: Math.ceil(e.maxN / cols) };
};

/**
 * The box of the marks at a size: `extent` is the longer side of the grid in pixels, `labelFs` the label's size; a mark
 * scale `cap` lets quantities on screen together share one mark size. `gap` is the space between grid and label.
 */
export function manyBox(e: ManyEnt, p: { extent: number; labelFs: number; cap: number; gap: number; minW: number; lineHeight: number }) {
  const { cols, rows } = gridOf(e);
  const s = Math.min(p.extent / (Math.max(cols, rows) * PITCH), p.cap);
  const dotsW = cols * PITCH * s;
  const dotsH = rows * PITCH * s;
  const labH = p.lineHeight * p.labelFs;
  const h = dotsH + p.gap + labH;
  return { s, w: Math.max(dotsW, p.minW), h, dotsY: -h / 2 + dotsH / 2, labY: h / 2 - labH / 2 };
}

export function manyNodes(w: Writer, id: string, e: ManyEnt, p: { fill: string; labelColor: string; labelFs: number }) {
  const { cols, rows } = gridOf(e);
  w.node(id, "group", { opacity: 0, x: w.width / 2, y: w.height / 2 });
  w.node(`${id}.dots`, "group", { y: 0, scaleX: 0.1, scaleY: 0.1 }, id);
  for (let i = 0; i < e.maxN; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    w.node(`${id}.d${i}`, "path", { x: (c - (cols - 1) / 2) * PITCH, y: (r - (rows - 1) / 2) * PITCH, points: circlePts(PITCH * 0.36), closed: 1, fill: p.fill, opacity: 0, scaleX: 0.3, scaleY: 0.3 }, `${id}.dots`);
  }
  w.node(`${id}.lab`, "text", { y: 0, text: e.unit, size: p.labelFs, role: "label", color: p.labelColor }, id);
}

export const manyTargets = (id: string, st: St): Triple[] => [[id, "x", st.x], [id, "y", st.y], [id, "opacity", st.op], [`${id}.dots`, "y", st.dotsY], [`${id}.dots`, "scaleX", st.s], [`${id}.dots`, "scaleY", st.s], [`${id}.lab`, "y", st.labY], [`${id}.lab`, "text", st.label]];

const range = (id: string, from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, j) => `${id}.d${from + j}`);

/** Marks appear (or leave) one by one: `step` frames apart, each over `frames`. */
export function countMarks(w: Writer, id: string, e: ManyEnt, from: number, to: number, at: number, p: { step: number; frames: number; hiddenScale: number }) {
  const grow = to > from;
  const list = grow ? range(id, from, Math.min(to, e.maxN)) : range(id, to, Math.min(from, e.maxN)).reverse();
  list.forEach((dn, j) => {
    const when = at + Math.round(j * p.step);
    w.put(dn, "opacity", grow ? 1 : 0, when, p.frames, "out");
    w.put(dn, "scaleX", grow ? 1 : p.hiddenScale, when, p.frames, "out");
    w.put(dn, "scaleY", grow ? 1 : p.hiddenScale, when, p.frames, "out");
  });
  return list.length;
}

/** All marks hidden at `prep`, then the first n appear one by one from `at`. */
export function enterMarks(w: Writer, id: string, e: ManyEnt, n: number, prep: number, at: number, p: { step: number; frames: number; hiddenScale: number }) {
  range(id, 0, e.maxN).forEach((dn) => {
    w.put(dn, "opacity", 0, prep);
    w.put(dn, "scaleX", p.hiddenScale, prep);
    w.put(dn, "scaleY", p.hiddenScale, prep);
  });
  countMarks(w, id, e, 0, Math.min(n, e.maxN), at, p);
}
