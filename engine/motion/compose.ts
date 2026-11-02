// How many changes to one property become one predictable track.
//
// The rules, in the order they apply:
// 1. A change takes over. It starts from wherever the property is at that frame, even mid-move, so nothing jumps, and
//    it ends where it says. If two start on the same frame, the later one in the document wins.
// 2. A change marked `add` does not take over. Its distance is added to whatever else is moving, so two overlapping
//    moves both finish and their speeds sum.
// 3. Tracks marked `multiply` or `add` are offsets on top of all of the above: (base * every multiply) + every add.
//    Offsets sit outside the order, so a shake survives a takeover and two pulses simply stack.
// 4. A constraint (attach, a moving path, the camera) has the last word while it runs, and can read everything else.
//
// When nothing overlaps the result is the same few eased keys a person would write. Otherwise it is baked to one key a
// frame, exact at every frame, then thinned.
import { EASES } from "../core/ease.ts";
import { mix, sample } from "../core/evaluate.ts";
import type { Constraint, Ease, Key, Reader, Track, Value } from "../core/types.ts";
import { IDENTITY, local, mul, type Mat } from "./matrix.ts";

export type Change = { kind: "change"; start: number; frames: number; value: Value; ease: Ease; add?: boolean; seq: number };
export type Written = { kind: "keys"; keys: Key[]; blend?: "add" | "multiply"; seq: number };
export type Layer = Change | Written;
type Curve = (frame: number) => Value;

const startOf = (l: Layer) => (l.kind === "change" ? l.start : l.keys[0]!.at);
const endOf = (l: Layer) => (l.kind === "change" ? l.start + Math.max(1, l.frames) : l.keys.at(-1)!.at);
const order = (a: Layer, b: Layer) => startOf(a) - startOf(b) || a.seq - b.seq;
const firstValue = (l: Layer) => (l.kind === "change" ? l.value : l.keys[0]!.value);
const isOffset = (l: Layer): l is Written => l.kind === "keys" && !!l.blend;

function plus(a: Value, b: Value, who: string): Value {
  if (typeof a === "number" && typeof b === "number") return a + b;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v, i) => v + b[i]!);
  throw new Error(`cannot add an offset to ${who}: it is not a number or a list of the same length`);
}
function times(a: Value, b: Value, who: string): Value {
  if (typeof a === "number" && typeof b === "number") return a * b;
  throw new Error(`cannot multiply ${who}: it is not a number`);
}

// The value over time from a starting value and the layers that replace it, in order.
function baseCurve(initial: Value, layers: Layer[]): Curve {
  let cur: Curve = () => initial;
  let target = initial;
  for (const l of layers) {
    const prev = cur;
    if (l.kind === "keys") {
      const first = l.keys[0]!.at;
      cur = (f) => (f < first ? prev(f) : sample(l.keys, f));
      target = l.keys.at(-1)!.value;
      continue;
    }
    const ease = EASES[l.ease];
    const end = l.start + Math.max(1, l.frames);
    const p = (f: number) => ease((f - l.start) / (end - l.start));
    if (l.add && typeof target === "number" && typeof l.value === "number") {
      const delta = l.value - target;
      cur = (f) => {
        const v = prev(f);
        if (f <= l.start || typeof v !== "number") return v;
        return f >= end ? v + delta : v + delta * p(f);
      };
    } else {
      let from: Value | undefined;
      cur = (f) => {
        if (f <= l.start) return prev(f);
        if (f >= end) return l.value;
        from ??= prev(l.start);
        return mix(from, l.value, p(f));
      };
    }
    target = l.value;
  }
  return cur;
}

const same = (a: Value, b: Value) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]));

// One linear key a frame, dropping keys that a straight line through their neighbours reproduces exactly.
function bake(curve: Curve, last: number): Key[] {
  const keys: Key[] = [];
  for (let f = 0; f <= last; f++) {
    const value = curve(f);
    const [a, b] = [keys.at(-2), keys.at(-1)];
    if (a && b) {
      const steady = same(a.value, b.value) && same(b.value, value);
      const straight = typeof a.value === "number" && typeof b.value === "number" && typeof value === "number" && Math.abs(a.value + ((value - a.value) * (b.at - a.at)) / (f - a.at) - b.value) < 1e-9;
      if (steady || straight) keys.pop();
    }
    keys.push({ at: f, value, ease: "linear" });
  }
  return keys;
}

// The same result as written keys, for the common case where nothing overlaps.
function plain(initial: Value, layers: Layer[]): Key[] {
  const keys: Key[] = [{ at: 0, value: initial }];
  const put = (k: Key) => {
    const last = keys.at(-1)!;
    if (last.at === k.at) keys[keys.length - 1] = { ...last, value: k.value };
    else keys.push(k);
  };
  for (const l of layers) {
    if (l.kind === "change") {
      put({ at: l.start, value: keys.at(-1)!.value });
      keys.push({ at: l.start + Math.max(1, l.frames), value: l.value, ease: l.ease });
    } else {
      l.keys.forEach((k, i) => put(i === 0 ? { ...k, ease: "step" } : k));
    }
  }
  return keys;
}

const TRANSFORM = { x: 0, y: 0, rotate: 0, skew: 0, scaleX: 1, scaleY: 1 };

export class Timeline {
  private layers = new Map<string, { target: string; prop: string; list: Layer[] }>();
  private cache = new Map<string, Curve>();
  private seq = 0;
  private constraints: Constraint[] = [];
  private initial: (target: string, prop: string) => Value | undefined;
  private parent: (id: string) => string | undefined;

  constructor(initial: (target: string, prop: string) => Value | undefined, parent: (id: string) => string | undefined) {
    this.initial = initial;
    this.parent = parent;
  }

  private add(target: string, prop: string, layer: Layer) {
    const key = `${target}\u0000${prop}`;
    const entry = this.layers.get(key) ?? this.layers.set(key, { target, prop, list: [] }).get(key)!;
    entry.list.push(layer);
    this.cache.delete(key);
  }

  change(target: string, prop: string, value: Value, start: number, frames: number, ease: Ease, add?: boolean) {
    this.add(target, prop, { kind: "change", start, frames, value, ease, add, seq: this.seq++ });
  }

  write(track: Track) {
    if (!track.keys.length) throw new Error(`a track for ${track.target}.${track.prop} has no keys`);
    const keys = [...track.keys].sort((a, b) => a.at - b.at);
    this.add(track.target, track.prop, { kind: "keys", keys, blend: track.blend, seq: this.seq++ });
  }

  constrain(c: Constraint) {
    this.constraints.push(c);
  }

  private start(target: string, prop: string, list: Layer[]): Value | undefined {
    const known = this.initial(target, prop);
    if (known !== undefined) return known;
    const first = list.filter((l) => !isOffset(l)).sort(order)[0] as Layer | undefined;
    return first && firstValue(first);
  }

  // Every layer written so far, with offsets, as one curve.
  private curve(target: string, prop: string): Curve | undefined {
    const key = `${target}\u0000${prop}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const list = this.layers.get(key)?.list ?? [];
    const initial = this.start(target, prop, list);
    if (initial === undefined) return undefined;
    const base = baseCurve(initial, list.filter((l) => !isOffset(l)).sort(order));
    const offsets = list.filter(isOffset);
    const who = `${target}.${prop}`;
    const curve: Curve = !offsets.length
      ? base
      : (f) => {
          let v = base(f);
          for (const o of offsets) if (o.blend === "multiply" && f >= o.keys[0]!.at) v = times(v, sample(o.keys, f), who);
          for (const o of offsets) if (o.blend === "add" && f >= o.keys[0]!.at) v = plus(v, sample(o.keys, f), who);
          return v;
        };
    this.cache.set(key, curve);
    return curve;
  }

  // The value as it stands so far, before constraints. Behaviors use this while the document is still being read.
  value(target: string, prop: string, frame: number): Value | undefined {
    return this.curve(target, prop)?.(Math.max(0, frame));
  }

  matrix(id: string | undefined, frame: number, value: (id: string, prop: string, frame: number) => Value | undefined = (i, p, f) => this.value(i, p, f)): Mat {
    if (!id) return IDENTITY;
    const t = { ...TRANSFORM };
    for (const k of Object.keys(t) as (keyof typeof TRANSFORM)[]) {
      const v = value(id, k, frame);
      if (typeof v === "number") t[k] = v;
    }
    return mul(this.matrix(this.parent(id), frame, value), local(t));
  }

  // Everything has been read: solve the constraints and write one track per property.
  finish(): Track[] {
    const solved = new Map<Constraint, Map<number, Record<string, Value>>>();
    const seen = new Map<string, Value | undefined>();
    const open = new Set<string>();
    const on = new Map<string, Constraint[]>();
    for (const c of this.constraints) {
      for (const p of c.props) {
        const key = `${c.target}\u0000${p}`;
        (on.get(key) ?? on.set(key, []).get(key)!).push(c);
      }
    }
    const solve = (c: Constraint, frame: number) => {
      const memo = solved.get(c) ?? solved.set(c, new Map()).get(c)!;
      const hit = memo.get(frame);
      if (hit) return hit;
      const made = c.solve(frame, reader, (prop) => this.value(c.target, prop, frame));
      memo.set(frame, made);
      return made;
    };
    const read = (id: string, prop: string, frameIn: number): Value | undefined => {
      const frame = Math.max(0, frameIn);
      const list = on.get(`${id}\u0000${prop}`);
      if (!list) return this.value(id, prop, frame);
      const key = `${id}\u0000${prop}\u0000${frame}`;
      if (seen.has(key)) return seen.get(key);
      if (open.has(key)) throw new Error(`motion loop: ${id}.${prop} ends up depending on itself`);
      open.add(key);
      let out = this.value(id, prop, frame);
      for (const c of list) {
        if (frame < c.start && out !== undefined) continue;
        const v = solve(c, Math.max(c.start, Math.min(frame, c.end)))[prop];
        if (v === undefined) continue;
        const [now, then] = [this.value(id, prop, frame), this.value(id, prop, c.end)];
        // Once released, a thing stays where it was left, and its own later moves apply from there.
        out = frame > c.end && typeof v === "number" && typeof now === "number" && typeof then === "number" ? v + now - then : v;
      }
      open.delete(key);
      seen.set(key, out);
      return out;
    };
    const reader: Reader = { value: read, matrix: (id, frame) => this.matrix(id, frame, read) };

    const tracks: Track[] = [];
    for (const [key, { target, prop, list }] of this.layers) {
      const moved = on.get(key);
      const sorted = list.filter((l) => !isOffset(l)).sort(order);
      const crowded = list.length !== sorted.length || sorted.some((l, i) => (l.kind === "change" && l.add) || (i > 0 && startOf(l) < endOf(sorted[i - 1]!)));
      const last = Math.max(...list.map(endOf), ...(moved ?? []).map((c) => c.end + 1));
      if (!moved && !crowded) tracks.push({ target, prop, keys: plain(this.start(target, prop, list)!, sorted) });
      else tracks.push({ target, prop, keys: bake((f) => (moved ? read(target, prop, f)! : this.curve(target, prop)!(f)), last) });
    }
    for (const [key, list] of on) {
      if (this.layers.has(key)) continue;
      const { target } = list[0]!;
      const prop = key.split("\u0000")[1]!;
      tracks.push({ target, prop, keys: bake((f) => read(target, prop, f)!, Math.max(...list.map((c) => c.end + 1))) });
    }
    return tracks;
  }
}
