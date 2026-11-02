// Plain geometry on point lists. Every function is pure, so anything built on it stays frame-pure.
export type Pt = [number, number];

export const toPts = (flat: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
};
export const toFlat = (pts: Pt[]): number[] => pts.flat();
const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

// The line a path really draws, matching how SceneView curves a smooth path.
export function polyline(points: number[], smooth = false): Pt[] {
  const p = toPts(points);
  if (!smooth || p.length < 3) return p;
  const out: Pt[] = [p[0]!];
  let from = p[0]!;
  for (let i = 1; i < p.length - 1; i++) {
    const c = p[i]!;
    const n = p[i + 1]!;
    const to: Pt = [(c[0] + n[0]) / 2, (c[1] + n[1]) / 2];
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      out.push([u * u * from[0] + 2 * u * t * c[0] + t * t * to[0], u * u * from[1] + 2 * u * t * c[1] + t * t * to[1]]);
    }
    from = to;
  }
  out.push(p.at(-1)!);
  return out;
}

// A closed outline without its repeated last point.
export function ring(pts: Pt[]): Pt[] {
  const out = pts.filter((p, i) => i === 0 || !near(p, pts[i - 1]!));
  if (out.length > 1 && near(out[0]!, out.at(-1)!)) out.pop();
  return out;
}
export const closeRing = (pts: Pt[]): Pt[] => [...pts, pts[0]!];
export const isLoop = (pts: Pt[]) => pts.length > 2 && near(pts[0]!, pts.at(-1)!);

export function length(pts: Pt[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return sum;
}

function cumulative(pts: Pt[]): number[] {
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  return seg;
}

// Walks a line by distance, so speed along it never depends on how its points are spaced.
export function walker(pts: Pt[]): (t: number) => { x: number; y: number; angle: number } {
  const seg = cumulative(pts);
  const total = seg.at(-1)!;
  return (t) => {
    const d = Math.max(0, Math.min(1, t)) * total;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (seg[mid]! <= d) lo = mid;
      else hi = mid;
    }
    const [a, b] = [pts[lo]!, pts[hi]!];
    const span = seg[hi]! - seg[lo]!;
    const u = span > 0 ? (d - seg[lo]!) / span : 0;
    return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI };
  };
}

// More points along each edge, keeping every original point so corners stay sharp.
export function densify(pts: Pt[], step: number, loop: boolean): Pt[] {
  const out: Pt[] = [];
  const last = loop ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const [a, b] = [pts[i]!, pts[(i + 1) % pts.length]!];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  if (!loop) out.push(pts.at(-1)!);
  return out;
}

export function area(pts: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i]!, pts[(i + 1) % pts.length]!];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

export function centroid(pts: Pt[]): Pt {
  const a = area(pts);
  if (Math.abs(a) < 1e-9) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  let [x, y] = [0, 0];
  for (let i = 0; i < pts.length; i++) {
    const [p, q] = [pts[i]!, pts[(i + 1) % pts.length]!];
    const c = p[0] * q[1] - q[0] * p[1];
    x += (p[0] + q[0]) * c;
    y += (p[1] + q[1]) * c;
  }
  return [x / (6 * a), y / (6 * a)];
}

export function bounds(pts: Pt[]) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

// The stretch of a line between two fractions of its length, with exact cut points.
export function slice(pts: Pt[], from: number, to: number): Pt[] {
  const walk = walker(pts);
  const seg = cumulative(pts);
  const total = seg.at(-1)!;
  const [a, b] = [walk(from), walk(to)];
  const out: Pt[] = [[a.x, a.y]];
  for (let i = 0; i < pts.length; i++) if (seg[i]! > from * total + 1e-9 && seg[i]! < to * total - 1e-9) out.push(pts[i]!);
  out.push([b.x, b.y]);
  return out;
}

// Cuts a filled shape into pie slices from its middle. Each slice takes its share of the outline, in order.
export function wedges(outline: Pt[], sizes: number[], phase = 0): Pt[][] {
  const edge = ring(outline);
  const loop = closeRing(edge);
  const c = centroid(edge);
  const sum = sizes.reduce((s, v) => s + v, 0);
  const out: Pt[][] = [];
  let at = phase % 1;
  for (const size of sizes) {
    const b = at + size / sum;
    const arc = b <= 1 ? slice(loop, at, b) : [...slice(loop, at, 1), ...slice(loop, 0, b - 1).slice(1)];
    out.push([c, ...arc, c]);
    at = b >= 1 ? b - 1 : b;
  }
  return out;
}

// What is left of a shape on one side of a line (points where nx*x + ny*y <= d). A filled shape stays one outline.
export function clipLoop(pts: Pt[], nx: number, ny: number, d: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i]!, pts[(i + 1) % pts.length]!];
    const [da, db] = [nx * a[0] + ny * a[1] - d, nx * b[0] + ny * b[1] - d];
    if (da <= 0) out.push(a);
    if (da < 0 !== db < 0 && da !== db) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// The longest unbroken run of an open line on one side of a line.
export function clipLine(pts: Pt[], nx: number, ny: number, d: number): Pt[] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const da = nx * a[0] + ny * a[1] - d;
    if (da <= 0) run.push(a);
    const b = pts[i + 1];
    if (!b) break;
    const db = nx * b[0] + ny * b[1] - d;
    if (da < 0 !== db < 0 && da !== db) {
      const t = da / (da - db);
      const cut: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (da <= 0) {
        run.push(cut);
        runs.push(run);
        run = [];
      } else run = [cut];
    }
  }
  if (run.length) runs.push(run);
  return runs.reduce((best, r) => (length(r) > length(best) ? r : best), [] as Pt[]);
}
