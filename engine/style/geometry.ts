// Pure line geometry: turns a primitive's points into a dense line, and that line into what a pen would leave behind.
// Works in the object's own space, so moving or scaling an object never changes its wobble.
import { drift, noise, random } from "./noise.ts";

export type Pt = [number, number];
export type Width = (s: number, total: number, angle: number) => number;

const round = (v: number) => Math.round(v * 10) / 10;

export function toPolyline(points: number[], smooth: boolean, closed: boolean, step: number): Pt[] {
  const raw: Pt[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) raw.push([points[i]!, points[i + 1]!]);
  if (!raw.length) return [];
  const curve: Pt[] = [];
  if (smooth && raw.length >= 3) {
    // Same curve as a plain path: each point pulls a quadratic between the midpoints of its neighbors.
    curve.push(raw[0]!);
    for (let i = 1; i < raw.length - 1; i++) {
      const [a, c] = [curve.at(-1)!, raw[i]!];
      const e: Pt = i === raw.length - 2 ? raw[i + 1]! : [(c[0] + raw[i + 1]![0]) / 2, (c[1] + raw[i + 1]![1]) / 2];
      const n = Math.max(2, Math.ceil((Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(e[0] - c[0], e[1] - c[1])) / step));
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const u = 1 - t;
        curve.push([u * u * a[0] + 2 * u * t * c[0] + t * t * e[0], u * u * a[1] + 2 * u * t * c[1] + t * t * e[1]]);
      }
    }
  } else curve.push(...raw);
  if (closed && (curve[0]![0] !== curve.at(-1)![0] || curve[0]![1] !== curve.at(-1)![1])) curve.push(curve[0]!);
  const out: Pt[] = [curve[0]!];
  for (let i = 1; i < curve.length; i++) {
    const [a, b] = [curve[i - 1]!, curve[i]!];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

export function lengths(p: Pt[]): number[] {
  const s = [0];
  for (let i = 1; i < p.length; i++) s.push(s[i - 1]! + Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]));
  return s;
}

// The line a hand makes. The noise follows distance along the line in pixels, so a line that grows or morphs keeps
// its character. Open lines stay pinned at their ends, so they still meet what they connect.
export function wobble(p: Pt[], closed: boolean, amount: number, seed: number): Pt[] {
  if (!amount || p.length < 2) return p;
  const s = lengths(p);
  const total = s.at(-1)!;
  const seam = Math.min(70, total * 0.25);
  const pin = Math.min(26, total / 4);
  return p.map(([x, y], i) => {
    const at = s[i]!;
    const off = (d: number) => {
      if (closed) {
        const t = Math.max(0, (at - (total - seam)) / (seam || 1));
        return drift(seed + d, at) * (1 - t) + drift(seed + d, at - total) * t; // the ends join exactly
      }
      return drift(seed + d, at) * Math.min(1, at / (pin || 1), (total - at) / (pin || 1));
    };
    return [x + off(0) * amount, y + off(1000) * amount] as Pt;
  });
}

// The part of a line from share a to share b of its length.
export function slice(p: Pt[], a: number, b: number): Pt[] {
  if (p.length < 2) return p;
  const s = lengths(p);
  const total = s.at(-1)!;
  const [from, to] = [Math.max(0, a) * total, Math.min(1, b) * total];
  if (to <= from) return [];
  const at = (d: number): Pt => {
    let i = 1;
    while (i < s.length - 1 && s[i]! < d) i++;
    const t = (d - s[i - 1]!) / (s[i]! - s[i - 1]! || 1);
    return [p[i - 1]![0] + (p[i]![0] - p[i - 1]![0]) * t, p[i - 1]![1] + (p[i]![1] - p[i - 1]![1]) * t];
  };
  return [at(from), ...p.filter((_, i) => s[i]! > from && s[i]! < to), at(to)];
}

export function extend(p: Pt[], by: number): Pt[] {
  if (p.length < 2) return p;
  const end = (a: Pt, b: Pt): Pt => {
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    return [a[0] + ((a[0] - b[0]) / len) * by, a[1] + ((a[1] - b[1]) / len) * by];
  };
  return [end(p[0]!, p[1]!), ...p, end(p.at(-1)!, p.at(-2)!)];
}

export const shift = (p: Pt[], dx: number, dy: number): Pt[] => p.map(([x, y]) => [x + dx, y + dy]);

export function pathOf(p: Pt[], closed = false): string {
  if (!p.length) return "";
  return `${p.map(([x, y], i) => `${i ? "L" : "M"}${round(x)} ${round(y)}`).join("")}${closed ? "Z" : ""}`;
}

// A line as a filled shape, which is what lets its width change along the way. A closed line becomes two loops wound
// opposite ways, so it stays a ring.
export function outline(p: Pt[], closed: boolean, width: Width): string {
  if (p.length < 2) return "";
  const s = lengths(p);
  const total = s.at(-1)!;
  const [left, right]: [Pt[], Pt[]] = [[], []];
  const last = p.length - 1;
  p.forEach(([x, y], i) => {
    const a = closed && (i === 0 || i === last) ? p[last - 1]! : p[Math.max(0, i - 1)]!;
    const b = closed && (i === 0 || i === last) ? p[1]! : p[Math.min(last, i + 1)]!;
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const w = Math.max(0.2, width(s[i]!, total, angle)) / 2;
    const [nx, ny] = [-Math.sin(angle), Math.cos(angle)];
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
  });
  if (closed) return `${pathOf(left, true)}${pathOf(right.reverse(), true)}`;
  const cap = (c: Pt, from: Pt): Pt[] => {
    const [dx, dy] = [from[0] - c[0], from[1] - c[1]];
    return [0.25, 0.5, 0.75].map((t) => {
      const a = -Math.PI * t;
      return [c[0] + dx * Math.cos(a) - dy * Math.sin(a), c[1] + dx * Math.sin(a) + dy * Math.cos(a)];
    });
  };
  const back = right.slice().reverse();
  return pathOf([...left, ...cap(p[last]!, left[last]!), ...back, ...cap(p[0]!, right[0]!)], true);
}

// Where evenly spaced strokes cross a shape. Rows sit at fixed positions, so they stay put while the shape changes.
export function scan(poly: Pt[], spacing: number, degrees: number): { row: number; spans: [Pt, Pt][] }[] {
  const a = (degrees * Math.PI) / 180;
  const [c, si] = [Math.cos(a), Math.sin(a)];
  const turned = poly.map(([x, y]): Pt => [x * c + y * si, -x * si + y * c]);
  const back = ([x, y]: Pt): Pt => [x * c - y * si, x * si + y * c];
  const ys = turned.map((q) => q[1]);
  const out: { row: number; spans: [Pt, Pt][] }[] = [];
  for (let row = Math.ceil(Math.min(...ys) / spacing); row * spacing <= Math.max(...ys); row++) {
    const y = row * spacing;
    const hits: number[] = [];
    for (let i = 0; i < turned.length; i++) {
      const [p, q] = [turned[i]!, turned[(i + 1) % turned.length]!];
      if (p[1] <= y !== q[1] <= y) hits.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    hits.sort((m, n) => m - n);
    const spans: [Pt, Pt][] = [];
    for (let i = 0; i + 1 < hits.length; i += 2) spans.push([back([hits[i]!, y]), back([hits[i + 1]!, y])]);
    if (spans.length) out.push({ row, spans });
  }
  return out;
}

// Separate strokes, each a little uneven, stopping short of the edge as a hand does.
export function hatchPath(poly: Pt[], spacing: number, degrees: number, seed: number): string {
  let d = "";
  for (const { row, spans } of scan(poly, spacing, degrees)) {
    spans.forEach(([a, b], k) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 2) return;
      const pull = (i: number) => (random(seed, row * 7 + k * 3 + i) * 0.1 + 0.015) * Math.min(len, 90);
      const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const bow = noise(seed, row * 0.37) * Math.min(3, len * 0.02);
      const [p, q]: Pt[] = [[a[0] + ux * pull(0), a[1] + uy * pull(0)], [b[0] - ux * pull(1), b[1] - uy * pull(1)]];
      d += `M${round(p[0])} ${round(p[1])}Q${round((p[0] + q[0]) / 2 - uy * bow)} ${round((p[1] + q[1]) / 2 + ux * bow)} ${round(q[0])} ${round(q[1])}`;
    });
  }
  return d;
}

// One continuous back-and-forth stroke, as when filling a shape with the side of a stick.
export function scribblePath(poly: Pt[], spacing: number, degrees: number, seed: number): string {
  const pts: Pt[] = [];
  let d = "";
  const flush = () => {
    if (pts.length > 1) d += pathOf(pts);
    pts.length = 0;
  };
  const along = (from: Pt, to: Pt, t: number): Pt => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
  scan(poly, spacing, degrees).forEach(({ row, spans }, i) => {
    if (spans.length !== 1) { // a shape with a dent: lift the stick rather than cross the gap
      flush();
      for (const [a, b] of spans) d += pathOf([a, b]);
      return;
    }
    const [a, b] = i % 2 ? [spans[0]![1], spans[0]![0]] : spans[0]!;
    pts.push(along(a, b, 0.02 + random(seed, row) * 0.05), along(b, a, 0.02 + random(seed, row + 500) * 0.05));
  });
  flush();
  return d;
}
