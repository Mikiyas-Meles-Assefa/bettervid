// Works out every property of every node for one frame. Pure: the same frame always gives the same picture, in any
// order, which is what lets rendering run in parallel. The index below only caches what the scene already says.
import { EASES } from "./ease.ts";
import type { Key, Props, Resolved, Scene, SceneNode, Track, Value } from "./types.ts";

// Parsed once per distinct color: thousands of parts blend the same few every frame.
const PARSED = new Map<string, number[] | null>();
function hex(c: string): number[] | null {
  let hit = PARSED.get(c);
  if (hit !== undefined) return hit;
  hit = null;
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) {
    const s = c.length < 7 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}${c[4] ?? "f"}${c[4] ?? "f"}` : c;
    hit = [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), s.length > 7 ? parseInt(s.slice(7, 9), 16) : 255];
  }
  PARSED.set(c, hit);
  return hit;
}
const isColor = (v: Value): v is string => typeof v === "string" && hex(v) !== null;
const isClear = (v: Value) => v === "none" || v === "transparent";
const BYTES = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const hexOf = (c: number[]) => `#${c.map((v) => BYTES[v]).join("")}`;

// Colors blend with their alpha. The result drops the alpha when both ends are opaque.
function mixColor(a: string, b: string, t: number): string {
  const [x, y] = [hex(a)!, hex(b)!];
  const c = x.map((v, i) => Math.max(0, Math.min(255, Math.round(v + (y[i]! - v) * t))));
  return hexOf(c[3] === 255 ? c.slice(0, 3) : c);
}
const clearOf = (c: string) => `${hexOf(hex(c)!.slice(0, 3))}00`;

// A paint can be a gradient, written as a string so it fits any color property and any track:
//   linear(angle, color at, color at, ...)     angle 0 runs left to right, 90 runs top to bottom
//   radial(cx, cy, r, color at, color at, ...) cx, cy and r are fractions of the part's bounds
// `at` is 0 to 1 and may be left out, which spaces the stops evenly. Colors may be theme names until a theme is applied.
export type Gradient = { type: "linear" | "radial"; args: number[]; stops: { color: string; at: number }[] };

export function parseGradient(v: Value | undefined): Gradient | undefined {
  if (typeof v !== "string") return undefined;
  const m = /^(linear|radial)\((.*)\)$/s.exec(v.trim());
  if (!m) return undefined;
  const parts = m[2]!.split(",").map((s) => s.trim());
  const count = parts.findIndex((p) => !/^-?[\d.]+$/.test(p));
  const args = (count < 0 ? parts : parts.slice(0, count)).map(Number);
  const raw = count < 0 ? [] : parts.slice(count);
  const type = m[1] as Gradient["type"];
  const want = type === "linear" ? [0] : [0.5, 0.5, 0.5];
  if (raw.length < 2 || (args.length !== 0 && args.length !== want.length)) throw new Error(`bad gradient ${v}: it needs ${want.length} number(s) or none, then at least two colors`);
  const stops = raw.map((p, i) => {
    const [color, at, extra] = p.split(/\s+/);
    if (extra !== undefined || (at !== undefined && !Number.isFinite(Number(at)))) throw new Error(`bad gradient stop "${p}" in ${v}`);
    return { color: color!, at: at === undefined ? i / (raw.length - 1) : Number(at) };
  });
  return { type, args: args.length ? args : want, stops };
}

export const formatGradient = (g: Gradient) => `${g.type}(${[...g.args.map(String), ...g.stops.map((s) => `${s.color} ${s.at}`)].join(", ")})`;

function colorAt(g: Gradient, at: number): string {
  const s = g.stops;
  if (at <= s[0]!.at) return s[0]!.color;
  for (let i = 1; i < s.length; i++) if (at <= s[i]!.at) return mixColor(s[i - 1]!.color, s[i]!.color, (at - s[i - 1]!.at) / (s[i]!.at - s[i - 1]!.at || 1));
  return s.at(-1)!.color;
}

// Two gradients blend whatever their stops: both are read at every stop position either one uses.
function mixGradient(a: Gradient, b: Gradient, t: number): string {
  const ats = [...new Set([...a.stops, ...b.stops].map((s) => s.at))].sort((x, y) => x - y);
  return formatGradient({ type: a.type, args: a.args.map((v, i) => v + (b.args[i]! - v) * t), stops: ats.map((at) => ({ at, color: mixColor(colorAt(a, at), colorAt(b, at), t) })) });
}
// mix sees every string, including captions that merely look like a gradient, so here a bad one is just not a gradient.
const blendable = (v: Value) => {
  try {
    const g = parseGradient(v);
    return g?.stops.every((s) => isColor(s.color)) ? g : undefined;
  } catch {
    return undefined;
  }
};
const solid = (color: string, like: Gradient): Gradient => ({ ...like, stops: like.stops.map((s) => ({ color, at: s.at })) });

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
  if (isColor(a) && isColor(b)) return mixColor(a, b, t);
  if (isColor(a) && isClear(b)) return mixColor(a, clearOf(a), t);
  if (isClear(a) && isColor(b)) return mixColor(clearOf(b), b, t);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === b.length) return a.map((v, i) => v + (b[i]! - v) * t); // dashes, crops and other plain lists
    if (a.length % 2 || b.length % 2) return t < 1 ? a : b;
    const n = Math.max(a.length, b.length) / 2;
    const [x, y] = [resample(a, n), resample(b, n)];
    return x.map((v, i) => v + (y[i]! - v) * t);
  }
  if (typeof a === "string" && typeof b === "string") {
    const [g, h] = [blendable(a), blendable(b)];
    if (g && h && g.type === h.type) return mixGradient(g, h, t);
    if (g && isColor(b)) return mixGradient(g, solid(b, g), t);
    if (h && isColor(a)) return mixGradient(solid(a, h), h, t);
  }
  return t < 1 ? a : b;
}

// The value at a frame, found by binary search. Keys must be in time order, which evaluate guarantees for scene tracks.
export function sample(keys: Key[], frame: number): Value {
  if (frame <= keys[0]!.at) return keys[0]!.value;
  let [lo, hi] = [0, keys.length - 1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keys[mid]!.at <= frame) lo = mid;
    else hi = mid - 1;
  }
  if (lo === keys.length - 1) return keys[lo]!.value;
  const [a, b] = [keys[lo]!, keys[lo + 1]!];
  return mix(a.value, b.value, EASES[b.ease ?? "smooth"]((frame - a.at) / (b.at - a.at)));
}

// What a property means when a node never set it. A change to such a property starts here rather than jumping.
export const NEUTRAL: Props = {
  blur: 0, glow: 0, shadowX: 0, shadowY: 0, shadowBlur: 0, shadowOpacity: 0, glowOpacity: 0,
  brightness: 1, saturation: 1, contrast: 1, hue: 0, tintAmount: 0,
  strokeOpacity: 1, fillOpacity: 1, dashOffset: 0, trimStart: 0, trimEnd: 1,
  z: 0, layer: 0, feather: 0, tracking: 0, crop: [0, 0, 1, 1],
};

const ordered = (keys: Key[]) => {
  for (let i = 1; i < keys.length; i++) {
    if (keys[i]!.at < keys[i - 1]!.at) return keys.map((k, i) => ({ k, i })).sort((x, y) => x.k.at - y.k.at || x.i - y.i).map((x) => x.k);
  }
  return keys;
};

// compile holds an unset property at its new value until the change arrives. Hold it at neutral instead.
function fromNeutral(keys: Key[], neutral: Value): Key[] {
  const arrive = keys.findIndex((k) => k.ease !== undefined);
  if (arrive < 1 || keys.slice(0, arrive).some((k) => k.value !== keys[arrive]!.value)) return keys;
  return keys.map((k, i) => (i < arrive ? { ...k, value: neutral } : k));
}

type Entry = { node: SceneNode; tracks: Track[]; parent: number };
const INDEX = new WeakMap<Scene, Entry[]>();

function indexOf(scene: Scene): Entry[] {
  const hit = INDEX.get(scene);
  if (hit) return hit;
  const slots = new Map<string, number>();
  scene.nodes.forEach((n, i) => slots.set(n.id, i));
  const entries: Entry[] = scene.nodes.map((node) => {
    const parent = node.parent === undefined ? -1 : slots.get(node.parent);
    if (parent === undefined) throw new Error(`nothing called ${node.parent}, the parent of ${node.id}`);
    return { node, tracks: [], parent };
  });
  for (const t of scene.tracks) {
    const slot = slots.get(t.target);
    if (slot === undefined) throw new Error(`nothing called ${t.target}, the target of a ${t.prop} track`);
    const entry = entries[slot]!;
    const keys = ordered(t.keys);
    const neutral = NEUTRAL[t.prop];
    entry.tracks.push({ ...t, keys: neutral !== undefined && entry.node.props[t.prop] === undefined ? fromNeutral(keys, neutral) : keys });
  }
  INDEX.set(scene, entries);
  return entries;
}

// Nodes with no tracks share their props object with the scene, so treat a Resolved as read-only.
export function evaluate(scene: Scene, frame: number): Resolved[] {
  const entries = indexOf(scene);
  const made = new Array<Resolved>(entries.length);
  const roots: Resolved[] = [];
  for (let i = 0; i < entries.length; i++) {
    const { node, tracks } = entries[i]!;
    let props: Props = node.props;
    if (tracks.length) {
      props = { ...props };
      for (const t of tracks) props[t.prop] = sample(t.keys, frame);
    }
    made[i] = { id: node.id, kind: node.kind, props, children: [] };
  }
  for (let i = 0; i < entries.length; i++) {
    const parent = entries[i]!.parent;
    (parent < 0 ? roots : made[parent]!.children).push(made[i]!);
  }
  return roots;
}
