// Readings: a value read off a depicted thing's scale, brought close. The camera closes in on the part read (a liquid's
// surface), a mark lies on it and the value stands beside it, sized so it reads at its size on screen after the zoom.
import { onScreen, type Placed } from "./flow.ts";
import type { Writer } from "./writer.ts";

export function readingNodes(w: Writer, id: string, color: string) {
  w.node(`read.${id}`, "text", { text: "", size: 100, role: "title", color, opacity: 0 });
  w.node(`readmark.${id}`, "path", { points: [0, 0, 1, 0], stroke: color, strokeWidth: 6, opacity: 0 });
}

/** The value a thing shows: the author's words when they carry a number, else what the depiction reads at its state. */
export function readingOf(p: Placed, said: string | undefined): { value: string; fromScale: boolean } {
  if (said && /\d/.test(said)) return { value: said, fromScale: false };
  const r = p.d.read?.();
  return r ? { value: r, fromScale: true } : { value: said ?? "", fromScale: false };
}

export type ReadingParams = { zoom: number; textPx: number; markPx: number; moveFrames: number; textAt: number; textFrames: number; markAt: number; gap: number; em: (t: string) => number };

/**
 * The level a stated reading sits at on the thing's own scale ("24.30 mL" on a burette), when it has a scale and the
 * words carry a number; undefined otherwise.
 */
export function levelOfReading(p: Placed, said: string | undefined): number | undefined {
  const n = said ? /-?\d+(?:\.\d+)?/.exec(said.replace(/,/g, "")) : null;
  if (!n || !p.d.levelAt) return undefined;
  const lv = p.d.levelAt(Number(n[0]));
  return lv !== undefined && Number.isFinite(lv) ? lv : undefined;
}

/**
 * Where a reading is taken on screen: the surface (or the scale) and the width of the part read. With `level`, the
 * point is where that level is on the scale, so a stated value sits at its own graduation.
 */
export function readingPoint(p: Placed, level?: number): { x: number; y: number; w: number } {
  const a = p.d.anchor("surface", level === undefined ? undefined : { ...p.d.state, level }) ?? p.d.parts.scale?.anchor ?? [0, -p.d.box.h / 2];
  const [x, y] = onScreen(p, a);
  const box = p.d.parts.body?.box ?? [-p.d.box.w / 2, -p.d.box.h, p.d.box.w / 2, 0];
  return { x, y, w: (box[2] - box[0]) * p.s };
}

export function readClose(w: Writer, id: string, p: Placed, value: string, at: number, q: ReadingParams, level?: number) {
  const m = readingPoint(p, level);
  const z = q.zoom;
  const fs = q.textPx / z;
  const wTxt = q.em(value) * fs;
  // The value stands on the side away from the scale's own numbers, so it never prints over them.
  const s = (p.d.parts.scale?.anchor[0] ?? -1) > 0 ? -1 : 1;
  w.cam(z, m.x + s * (wTxt / 2 + q.gap / z), m.y, at, q.moveFrames, "smooth");
  const R = `read.${id}`;
  const M = `readmark.${id}`;
  w.put(R, "text", value, at);
  w.put(R, "x", m.x + s * (m.w / 2 + q.gap / z + wTxt / 2), at);
  w.put(R, "y", m.y - fs * 0.9, at);
  w.put(R, "scaleX", fs / 100, at);
  w.put(R, "scaleY", fs / 100, at);
  w.put(R, "opacity", 1, at + q.textAt, q.textFrames, "out");
  w.put(M, "points", [m.x - s * (m.w / 2 + q.gap / (2 * z)), m.y, m.x + s * (m.w / 2 + q.gap / z), m.y], at);
  w.put(M, "strokeWidth", q.markPx / z, at);
  w.put(M, "opacity", 1, at + q.markAt, q.textFrames, "out");
}
