// Geometry for drawn depictions: outlines as flat point lists with fixed counts, so shapes morph point for point.
import type { Pt } from "./types.ts";

export const r1 = (v: number) => Math.round(v * 10) / 10;
export const flat = (pts: Pt[]) => pts.flatMap(([x, y]) => [r1(x), r1(y)]);
export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;

/** An ellipse (or circle) as `n` points, starting at the top and going clockwise on screen. */
export function ellipse(cx: number, cy: number, rx: number, ry = rx, n = 48, a0 = 0, a1 = TAU): Pt[] {
  const whole = Math.abs(a1 - a0 - TAU) < 1e-9;
  const k = whole ? n : n - 1;
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / k;
    return [cx + rx * Math.sin(a), cy - ry * Math.cos(a)] as Pt;
  });
}

/** A rectangle with round corners, `n` points per corner. */
export function roundRect(x0: number, y0: number, x1: number, y1: number, r: number, n = 6): Pt[] {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  const out: Pt[] = [];
  const corner = (cx: number, cy: number, start: number) => {
    for (let i = 0; i < n; i++) {
      const a = start + (Math.PI / 2) * (i / (n - 1));
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  };
  corner(x1 - rr, y0 + rr, -Math.PI / 2);
  corner(x1 - rr, y1 - rr, 0);
  corner(x0 + rr, y1 - rr, Math.PI / 2);
  corner(x0 + rr, y0 + rr, Math.PI);
  return out;
}

/** Resample a polyline (open) or polygon (closed) to exactly `n` points spaced evenly along its length. */
export function resample(pts: Pt[], n: number, closed: boolean): Pt[] {
  const ring = closed ? [...pts, pts[0]!] : pts;
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i]![0] - ring[i - 1]![0], ring[i]![1] - ring[i - 1]![1]);
    seg.push(d);
    total += d;
  }
  if (total === 0) return Array.from({ length: n }, () => [...pts[0]!] as Pt);
  const out: Pt[] = [];
  const steps = closed ? n : n - 1;
  let j = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const want = (total * i) / steps;
    while (j < seg.length - 1 && acc + seg[j]! < want) acc += seg[j++]!;
    const t = seg[j]! > 0 ? clamp((want - acc) / seg[j]!) : 0;
    out.push([lerp(ring[j]![0], ring[j + 1]![0], t), lerp(ring[j]![1], ring[j + 1]![1], t)]);
  }
  return out;
}

/** Corner rounding: replaces each corner of a polyline with a short arc, so drawn outlines are never jagged. */
export function rounded(pts: Pt[], r: number, closed: boolean, n = 5): Pt[] {
  if (r <= 0 || pts.length < 3) return pts;
  const out: Pt[] = [];
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    const p = pts[i]!;
    const isEnd = !closed && (i === 0 || i === m - 1);
    if (isEnd) {
      out.push(p);
      continue;
    }
    const a = pts[(i - 1 + m) % m]!;
    const b = pts[(i + 1) % m]!;
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const k = Math.min(r, la / 2, lb / 2);
    if (k < 1e-6) {
      out.push(p);
      continue;
    }
    const pa: Pt = [p[0] + ((a[0] - p[0]) * k) / la, p[1] + ((a[1] - p[1]) * k) / la];
    const pb: Pt = [p[0] + ((b[0] - p[0]) * k) / lb, p[1] + ((b[1] - p[1]) * k) / lb];
    for (let s = 0; s < n; s++) {
      const t = s / (n - 1);
      // A quadratic through the corner: smooth, and it stays inside the corner.
      out.push([(1 - t) ** 2 * pa[0] + 2 * (1 - t) * t * p[0] + t * t * pb[0], (1 - t) ** 2 * pa[1] + 2 * (1 - t) * t * p[1] + t * t * pb[1]]);
    }
  }
  return out;
}

/** A Catmull-Rom curve through the points: smooth outlines from a few control points (an outline the depicter gives). */
export function spline(pts: Pt[], closed: boolean, per = 8): Pt[] {
  if (pts.length < 3) return pts;
  const m = pts.length;
  const at = (i: number) => (closed ? pts[(i + m) % m]! : pts[Math.max(0, Math.min(m - 1, i))]!);
  const out: Pt[] = [];
  const last = closed ? m : m - 1;
  for (let i = 0; i < last; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push(pts[m - 1]!);
  return out;
}

export const rotate = ([x, y]: Pt, deg: number, [cx, cy]: Pt = [0, 0]): Pt => {
  const a = (deg * Math.PI) / 180;
  const [dx, dy] = [x - cx, y - cy];
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
};
export const shift = (pts: Pt[], dx: number, dy: number): Pt[] => pts.map(([x, y]) => [x + dx, y + dy]);

/** A deterministic, even spread of points in the unit square (a low-discrepancy sequence): no randomness, frames stay pure. */
export function spread(n: number, seed = 0): Pt[] {
  const g = 1.32471795724474602596; // the plastic number: the 2D analogue of the golden ratio
  const [a1, a2] = [1 / g, 1 / (g * g)];
  return Array.from({ length: n }, (_, i) => [((0.5 + a1 * (i + 1 + seed)) % 1) as number, ((0.5 + a2 * (i + 1 + seed)) % 1) as number] as Pt);
}

// Colors: mixing toward white or black for shading. The color itself is a fact from the spec; this is light on it.
const hex2 = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
export const isHex = (c: string) => /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(c);
export function mixHex(c: string, toward: string, k: number): string {
  if (!isHex(c) || !isHex(toward)) return c;
  const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  const alpha = c.length === 9 ? c.slice(7) : "";
  return `#${[1, 3, 5].map((i) => hex2(ch(c, i) * (1 - k) + ch(toward, i) * k)).join("")}${alpha}`;
}
export const withAlpha = (hex: string, a: number) => (isHex(hex) ? `${hex.slice(0, 7)}${hex2(clamp(a) * 255)}` : hex);
/** Relative luminance of a hex color, 0 dark to 1 light. */
export function luminance(c: string): number {
  if (!isHex(c)) return 0.5;
  const ch = (i: number) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
}
