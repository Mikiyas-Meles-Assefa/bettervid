// 2D transforms, in the same order SceneView applies them: translate, rotate, skew, scale.
import type { Pt } from "./geometry.ts";

export type Mat = [number, number, number, number, number, number]; // a b c d e f, as in SVG
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) throw new Error("cannot undo a transform that is scaled to nothing");
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export const apply = (m: Mat, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

export function local(t: { x: number; y: number; rotate: number; skew: number; scaleX: number; scaleY: number }): Mat {
  const r = (t.rotate * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  const k = Math.tan((t.skew * Math.PI) / 180);
  return mul([c, s, -s, c, t.x, t.y], [t.scaleX, 0, k * t.scaleY, t.scaleY, 0, 0]);
}

export function decompose(m: Mat) {
  const scaleX = Math.hypot(m[0], m[1]);
  const [ux, uy] = scaleX > 1e-12 ? [m[0] / scaleX, m[1] / scaleX] : [1, 0];
  const det = m[0] * m[3] - m[1] * m[2];
  const scaleY = scaleX > 1e-12 ? det / scaleX : Math.hypot(m[2], m[3]);
  const shear = ux * m[2] + uy * m[3];
  return { x: m[4], y: m[5], rotate: (Math.atan2(uy, ux) * 180) / Math.PI, skew: (Math.atan2(shear, scaleY) * 180) / Math.PI, scaleX, scaleY };
}
