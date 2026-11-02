// True shape morphing. Two outlines rarely have matching points, so this finds which part of one should become which
// part of the other: the same winding, the best starting point, then a monotone match that pairs like with like, so
// corners go to corners and the shape does not fold over itself on the way.
import { area, centroid, closeRing, densify, isLoop, length, polyline, ring, toFlat, walker, type Pt } from "./geometry.ts";

const uniform = (pts: Pt[], n: number, loop: boolean): Pt[] => {
  const walk = walker(loop ? closeRing(pts) : pts);
  return Array.from({ length: n }, (_, i): Pt => {
    const w = walk(i / (loop ? n : n - 1));
    return [w.x, w.y];
  });
};

// Same size, same middle, so only the form is compared.
function normal(pts: Pt[]): Pt[] {
  const c = centroid(pts);
  const moved = pts.map((p): Pt => [p[0] - c[0], p[1] - c[1]]);
  const size = Math.sqrt(moved.reduce((s, p) => s + p[0] * p[0] + p[1] * p[1], 0) / moved.length) || 1;
  return moved.map((p) => [p[0] / size, p[1] / size]);
}

const directions = (pts: Pt[]): Pt[] =>
  pts.map((_, i): Pt => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  });

// Dynamic time warping: the cheapest in-order pairing of two lists, with both ends pinned.
function warp(a: Pt[], b: Pt[]): { pairs: [number, number][]; cost: number } {
  const [n, m] = [a.length, b.length];
  const [ta, tb] = [directions(a), directions(b)];
  const FACING = 0.35; // how much facing the same way counts, next to being in the same place
  const COLLAPSE = 0.012; // a small price for many points landing on one
  const best = new Float64Array(n * m).fill(Infinity);
  const from = new Uint8Array(n * m);
  const at = (i: number, j: number) => i * m + j;
  const cost = (i: number, j: number) => {
    const [dx, dy] = [a[i]![0] - b[j]![0], a[i]![1] - b[j]![1]];
    return dx * dx + dy * dy + FACING * (1 - (ta[i]![0] * tb[j]![0] + ta[i]![1] * tb[j]![1]));
  };
  best[0] = cost(0, 0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (!i && !j) continue;
      const diag = i && j ? best[at(i - 1, j - 1)]! : Infinity;
      const up = i ? best[at(i - 1, j)]! + COLLAPSE : Infinity;
      const left = j ? best[at(i, j - 1)]! + COLLAPSE : Infinity;
      const low = Math.min(diag, up, left);
      best[at(i, j)] = low + cost(i, j);
      from[at(i, j)] = low === diag ? 0 : low === up ? 1 : 2;
    }
  }
  const pairs: [number, number][] = [];
  let [i, j] = [n - 1, m - 1];
  for (;;) {
    pairs.push([i, j]);
    if (!i && !j) break;
    const f = from[at(i, j)]!;
    if (f !== 2) i--;
    if (f !== 1) j--;
  }
  return { pairs: pairs.reverse(), cost: best[at(n - 1, m - 1)]! / pairs.length };
}

const rotated = (pts: Pt[], k: number): Pt[] => [...pts.slice(k), ...pts.slice(0, k)];
const nearest = (pts: Pt[], p: Pt) => pts.reduce((b, q, i) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(pts[b]![0] - p[0], pts[b]![1] - p[1]) ? i : b), 0);

export type Matched = { a: number[]; b: number[]; closed: boolean };

// Two lines of equal length whose points correspond. `a` still draws exactly the first shape and `b` the second.
export function matchShapes(fromPoints: number[], toPoints: number[], o: { smoothA?: boolean; smoothB?: boolean } = {}): Matched {
  const [rawA, rawB] = [polyline(fromPoints, o.smoothA), polyline(toPoints, o.smoothB)];
  if (rawA.length < 2 || rawB.length < 2) throw new Error("a morph needs two lines with at least two points each");
  const [loopA, loopB] = [isLoop(rawA), isLoop(rawB)];
  const closed = loopA && loopB;
  let A = loopA ? ring(rawA) : rawA;
  let B = loopB ? ring(rawB) : rawB;

  const count = Math.max(48, Math.min(180, Math.max(A.length, B.length) * 2));
  const [lenA, lenB] = [length(loopA ? closeRing(A) : A), length(loopB ? closeRing(B) : B)];
  if (!(lenA > 0) || !(lenB > 0)) throw new Error("a morph needs lines with some length");

  if (closed) {
    if (area(A) * area(B) < 0) B = [...B].reverse();
    const uB = uniform(B, 72, true);
    const [ua, ub] = [normal(uniform(A, 72, true)), normal(uB)];
    const scored = Array.from({ length: 72 }, (_, r) => ({ r, cost: ua.reduce((s, p, i) => s + Math.hypot(p[0] - ub[(i + r) % 72]![0], p[1] - ub[(i + r) % 72]![1]) ** 2, 0) })).sort((x, y) => x.cost - y.cost);
    // Several starts, kept well apart: the cheapest whole-outline fit is not always the best one after warping.
    const starts: number[] = [];
    for (const s of scored) {
      if (starts.every((r) => Math.min(Math.abs(r - s.r), 72 - Math.abs(r - s.r)) > 6)) starts.push(s.r);
      if (starts.length === 3) break;
    }
    const denseA = densify(A, lenA / count, true);
    const [ca, cb] = [centroid(A), centroid(B)];
    let best: { a: Pt[]; b: Pt[]; pairs: [number, number][]; cost: number } | undefined;
    for (const r of starts) {
      const denseB = densify(rotated(B, nearest(B, uB[r]!)), lenB / count, true);
      const scale = Math.sqrt(Math.abs(area(A)) / (Math.abs(area(B)) || 1)) || 1;
      const anchor: Pt = [ca[0] + (denseB[0]![0] - cb[0]) * scale, ca[1] + (denseB[0]![1] - cb[1]) * scale];
      const a = closeRing(rotated(denseA, nearest(denseA, anchor)));
      const b = closeRing(denseB);
      const [na, nb] = [normal(a.slice(0, -1)), normal(b.slice(0, -1))];
      const m = warp([...na, na[0]!], [...nb, nb[0]!]);
      if (!best || m.cost < best.cost) best = { a, b, pairs: m.pairs, cost: m.cost };
    }
    const out = best!;
    return { a: toFlat(out.pairs.map(([i]) => out.a[i]!)), b: toFlat(out.pairs.map(([, j]) => out.b[j]!)), closed: true };
  }

  // One or both are open. A closed one opens at the point nearest the other line's start.
  if (loopA) A = closeRing(rotated(A, nearest(A, B[0]!)));
  if (loopB) B = closeRing(rotated(B, nearest(B, A[0]!)));
  const [ua, ub] = [normal(uniform(A, 48, false)), normal(uniform(B, 48, false))];
  const fit = (x: Pt[], y: Pt[]) => x.reduce((s, p, i) => s + Math.hypot(p[0] - y[i]![0], p[1] - y[i]![1]) ** 2, 0);
  if (fit(ua, [...ub].reverse()) < fit(ua, ub)) B = [...B].reverse();
  const [a, b] = [densify(A, lenA / count, false), densify(B, lenB / count, false)];
  const m = warp(normal(a), normal(b));
  return { a: toFlat(m.pairs.map(([i]) => a[i]!)), b: toFlat(m.pairs.map(([, j]) => b[j]!)), closed: false };
}
