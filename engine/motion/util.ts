// Small helpers shared by the behaviors.
import { EASES } from "../core/ease.ts";
import type { Ease, Key, MotionTools, Value } from "../core/types.ts";
import { polyline, type Pt, toPts } from "./geometry.ts";
import { apply, type Mat } from "./matrix.ts";

export const num = (v: Value | undefined, d: number) => (typeof v === "number" ? v : d);
export const str = (v: Value | undefined, d: string) => (typeof v === "string" ? v : d);

export function ease(v: Value | undefined, d: Ease): Ease {
  if (v === undefined) return d;
  if (typeof v !== "string" || !(v in EASES)) throw new Error(`unknown ease ${String(v)}`);
  return v as Ease;
}

// One key a frame from `start`, for motion that no eased pair of keys can describe.
export function over(start: number, frames: number, value: (t: number, i: number) => Value): Key[] {
  const n = Math.max(1, Math.round(frames));
  return Array.from({ length: n + 1 }, (_, i) => ({ at: start + i, value: value(i / n, i), ease: "linear" as const }));
}

export const unique = (tools: MotionTools, base: string) => {
  if (!tools.has(base)) return base;
  let i = 2;
  while (tools.has(`${base}.${i}`)) i++;
  return `${base}.${i}`;
};

export function needPath(tools: MotionTools, id: string, what: string): number[] {
  if (tools.kind(id) !== "path") throw new Error(`${what} needs a path, and ${id} is a ${tools.kind(id)}`);
  const points = tools.value(id, "points", 0);
  if (!Array.isArray(points)) throw new Error(`${what} needs points on ${id}`);
  return points;
}

// The line a path draws at a frame, in its own coordinates.
export function lineOf(tools: MotionTools, id: string, frame: number): Pt[] {
  needPath(tools, id, "this");
  const smooth = tools.value(id, "smooth", frame);
  return polyline(tools.value(id, "points", frame) as number[], !!smooth);
}

// An outline in the node's own coordinates, for anything: a path's line, or a box for text and images. Text boxes are an
// estimate, as text is not measured here.
export function outlineOf(tools: MotionTools, id: string, frame: number): Pt[] {
  const kind = tools.kind(id);
  if (kind === "path") return lineOf(tools, id, frame);
  if (kind === "group") return [[0, 0]];
  const [w, h] = kind === "image"
    ? [num(tools.value(id, "w", frame), 100), num(tools.value(id, "h", frame), 100)]
    : [String(tools.value(id, "text", frame) ?? "").length * num(tools.value(id, "size", frame), 60) * 0.55, num(tools.value(id, "size", frame), 60) * 1.1];
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]];
}

export const worldOutline = (tools: MotionTools, id: string, frame: number): Pt[] => {
  const m = tools.matrix(id, frame) as Mat;
  return outlineOf(tools, id, frame).map((p) => apply(m, p));
};

export const worldAt = (tools: MotionTools, id: string, frame: number): Pt => apply(tools.matrix(id, frame) as Mat, [0, 0]);

export const pointsArg = (v: Value | undefined, what: string): Pt[] => {
  if (!Array.isArray(v) || v.length < 4) throw new Error(`${what} needs a list of points`);
  return toPts(v);
};
