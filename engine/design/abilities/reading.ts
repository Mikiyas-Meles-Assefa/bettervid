// Readings: a value read off a drawn scale, brought close. The camera closes in on the liquid's surface, a mark lies on
// it and the value stands beside it, sized so it reads at its size on screen after the zoom.
import { buretteReading, surfaceY, type Prop } from "../depict/index.ts";
import type { St } from "./types.ts";
import type { Writer } from "./writer.ts";

export function readingNodes(w: Writer, id: string, color: string) {
  w.node(`read.${id}`, "text", { text: "", size: 100, role: "title", color, opacity: 0 });
  w.node(`readmark.${id}`, "path", { points: [0, 0, 1, 0], stroke: color, strokeWidth: 6, opacity: 0 });
}

/** The value a scale shows at a level: the author's words when they carry a number, else read off the drawn scale. */
export function readingOf(p: Prop, level: number, said: string | undefined): { value: string; offScale: boolean } {
  if (said && /\d/.test(said)) return { value: said, offScale: false };
  if (p.shape === "burette") return { value: `${buretteReading(level).toFixed(2)} mL`, offScale: true };
  return { value: said ?? "", offScale: false };
}

export type ReadingParams = { zoom: number; textPx: number; markPx: number; moveFrames: number; textAt: number; textFrames: number; markAt: number; gap: number; em: (t: string) => number };

export function readClose(w: Writer, id: string, node: string, p: Prop, st: St, level: number, value: string, at: number, q: ReadingParams) {
  const m = { x: st.x, y: st.y + st.s * surfaceY(p, level) };
  const z = q.zoom;
  const fs = q.textPx / z;
  const wTxt = q.em(value) * fs;
  w.cam(z, m.x + wTxt / 2 + q.gap / z, m.y, at, q.moveFrames, "smooth");
  const R = `read.${id}`;
  const M = `readmark.${id}`;
  w.put(R, "text", value, at);
  w.put(R, "x", m.x + st.w / 2 + q.gap / z + wTxt / 2, at);
  w.put(R, "y", m.y - fs * 0.9, at);
  w.put(R, "scaleX", fs / 100, at);
  w.put(R, "scaleY", fs / 100, at);
  w.put(R, "opacity", 1, at + q.textAt, q.textFrames, "out");
  w.put(M, "points", [m.x - st.w / 2 - q.gap / (2 * z), m.y, m.x + st.w / 2 + q.gap / z, m.y], at);
  w.put(M, "strokeWidth", q.markPx / z, at);
  w.put(M, "opacity", 1, at + q.markAt, q.textFrames, "out");
}
