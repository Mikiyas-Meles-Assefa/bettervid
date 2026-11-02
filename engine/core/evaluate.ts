// Works out every property of every node for one frame. Pure: the same frame always gives the same picture, in any
// order, which is what lets rendering run in parallel.
import { EASES } from "./ease.ts";
import type { Key, Props, Resolved, Scene, Track, Value } from "./types.ts";

const hex = (c: string) => {
  const s = c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
};
const isColor = (v: Value): v is string => typeof v === "string" && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v);

// A point list resampled to n points, so any shape can morph into any other.
export function resample(p: number[], n: number): number[] {
  const m = p.length / 2;
  if (m === n) return p;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : (i / (n - 1)) * (m - 1);
    const a = Math.floor(f);
    const b = Math.min(m - 1, a + 1);
    const t = f - a;
    out.push(p[a * 2]! + (p[b * 2]! - p[a * 2]!) * t, p[a * 2 + 1]! + (p[b * 2 + 1]! - p[a * 2 + 1]!) * t);
  }
  return out;
}

export function mix(a: Value, b: Value, t: number): Value {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * t;
  if (isColor(a) && isColor(b)) {
    const [x, y] = [hex(a), hex(b)];
    const c = x.map((v, i) => Math.max(0, Math.min(255, Math.round(v + (y[i]! - v) * t))));
    return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length) / 2;
    const [x, y] = [resample(a, n), resample(b, n)];
    return x.map((v, i) => v + (y[i]! - v) * t);
  }
  return t < 1 ? a : b;
}

export function sample(keys: Key[], frame: number): Value {
  if (frame <= keys[0]!.at) return keys[0]!.value;
  for (let i = 1; i < keys.length; i++) {
    const [a, b] = [keys[i - 1]!, keys[i]!];
    if (frame < b.at) return mix(a.value, b.value, EASES[b.ease ?? "smooth"]((frame - a.at) / (b.at - a.at)));
  }
  return keys.at(-1)!.value;
}

export function evaluate(scene: Scene, frame: number): Resolved[] {
  const byTarget = new Map<string, Track[]>();
  for (const t of scene.tracks) (byTarget.get(t.target) ?? byTarget.set(t.target, []).get(t.target)!).push(t);
  const made = new Map<string, Resolved>();
  const roots: Resolved[] = [];
  for (const n of scene.nodes) {
    const props: Props = { ...n.props };
    for (const t of byTarget.get(n.id) ?? []) props[t.prop] = sample(t.keys, frame);
    made.set(n.id, { id: n.id, kind: n.kind, props, children: [] });
  }
  for (const n of scene.nodes) {
    const r = made.get(n.id)!;
    const parent = n.parent ? made.get(n.parent) : undefined;
    (parent ? parent.children : roots).push(r);
  }
  return roots;
}
