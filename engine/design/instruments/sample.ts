// What every instrument reads from a compiled scene, worked out once per scene and cached: the things on screen, when
// each is visible, when it changes, its boxes in frame coordinates through the camera, its text with size and color and
// the contrast against what is drawn behind it, and the camera's moves and cuts.
//
// Speed matters: a search loop calls the instruments many times per moment. So:
// - change and visibility come from the tracks, never from evaluating every frame: a change is any span between two
//   keys whose values differ by more than a viewer could see; visibility multiplies the opacity tracks down the tree.
// - boxes, colors and contrast need the evaluated frame; only the frames an instrument samples are evaluated, and each
//   is cached for every instrument and every later call on the same scene.
//
// A "thing" is a top-level part of the scene (a box with its label, a line of words, a mark), the same unit the bench's
// direction check uses: parts whose ids extend a top-level id belong to it, and a group whose children do not extend
// its id (the camera, a layer) is a frame around things, not a thing.
import type { Key, Props, Resolved, Scene, Value } from "../../core/types.ts";
import { evaluate, NEUTRAL, sample as valueAt } from "../../core/evaluate.ts";
import { estimate } from "../../language/layout.ts";
import type { MeasureInput, Viewing } from "../types.ts";
import { alphaOf, blend, ratio, rgbOf, type RGB } from "./color.ts";

export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** One drawn primitive on one frame, in frame pixels. */
export type Item = {
  id: string;
  unit: string;
  kind: "text" | "image" | "shape";
  text?: string;
  box: Rect; // what shows: through every transform (the camera's included), cut to its clips
  full: Rect; // the same before its clips
  rest: Rect; // where it would be with the camera (and any frame around things) at rest, before clips
  opacity: number; // after every parent's fade
  size?: number; // text size on the frame, in pixels
  paint?: RGB; // text color, a shape's fill (its stroke when it has no fill), after brightness
  filled: boolean;
  muted: boolean;
  order: number; // paint order, later in front
  /** What is drawn behind its center: a color, or a picture (whose colors the scene does not know). */
  behind: RGB | "picture";
  /** WCAG ratio of its paint, after its fade, against what is behind it. Unknown (undefined) for pictures. */
  contrast?: number;
};

/** One thing on one frame: its items together. */
export type Thing = {
  unit: string;
  kind: "text" | "picture" | "shape";
  box: Rect; // the union of its items, clipped to the frame
  area: number; // pixels on the frame it covers (no more than its union box)
  opacity: number;
  contrast?: number; // its most visible item's contrast; undefined when it is only pictures
  text: string;
  chars: number;
  items: Item[];
};

export type CameraJump = { frame: number; zoom: number; shift: number }; // zoom ratio and pan in pixels, within a frame

export type Sampled = {
  scene: Scene;
  fps: number;
  frames: number;
  W: number;
  H: number;
  units: string[];
  unitIndex: Map<string, number>;
  /** Per unit, per frame: 1 when any of it shows. */
  vis: Uint8Array[];
  /** Per unit, per frame: 1 when it moves, grows, fades, recolors or rewrites, while it shows. */
  act: Uint8Array[];
  /** Per frame: 1 while the camera (or any frame around things) moves. */
  camera: Uint8Array;
  jumps: CameraJump[];
  /** Frames where a move of the camera (or any frame around things) starts or ends: where it is closest or farthest. */
  cameraKeys: number[];
  /** Per unit: frames it becomes visible, and frames it starts to change (arrivals included). */
  arrivals: number[][];
  onsets: number[][];
  /** Per unit: every text it shows over the scene. */
  texts: string[];
  /** Per unit: a structural signature (kinds, geometry, size, words; not color), equal for look-alike things. */
  signature: string[];
  /** Per unit: where it is on a frame, in its parent's coordinates (cheap, from tracks). */
  pos(unit: number, frame: number): [number, number];
  items(frame: number): Item[];
  things(frame: number, backdrop: number): Thing[];
};

const CACHE = new WeakMap<Scene, Sampled>();
export const sampled = (scene: Scene): Sampled => CACHE.get(scene) ?? (CACHE.set(scene, build(scene)), CACHE.get(scene)!);

// What a viewer cannot see change between two frames two apart (as the bench's direction check): a drift under 15 px a
// second, a fade under 2 percent. Unlisted numbers use `OTHER`.
const GAP = 2;
const TOL: Record<string, number> = { x: 1, y: 1, scaleX: 0.004, scaleY: 0.004, rotate: 0.3, size: 0.5, strokeWidth: 0.15, opacity: 0.015, drawn: 0.01, trimStart: 0.01, trimEnd: 0.01, brightness: 0.01, blur: 0.2, glow: 0.02, fillOpacity: 0.02, strokeOpacity: 0.02, w: 1, h: 1, panX: 1, panY: 1, zoom: 0.004, z: 0.5, layer: 0.5 };
const OTHER = 0.02;
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function differs(prop: string, a: Value, b: Value, span: number): boolean {
  if (typeof a === "number" && typeof b === "number") return (Math.abs(b - a) * GAP) / Math.max(GAP, span) > (TOL[prop] ?? OTHER);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return true;
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(b[i]! - a[i]!));
    return (d * GAP) / Math.max(GAP, span) > 1;
  }
  return a !== b;
}

// compile holds an unset property at its new value until its change arrives; evaluate holds it at neutral instead.
function fromNeutral(keys: Key[], neutral: Value): Key[] {
  const arrive = keys.findIndex((k) => k.ease !== undefined);
  if (arrive < 1 || keys.slice(0, arrive).some((k) => k.value !== keys[arrive]!.value)) return keys;
  return keys.map((k, i) => (i < arrive ? { ...k, value: neutral } : k));
}
const ordered = (keys: Key[]) => (keys.every((k, i) => !i || k.at >= keys[i - 1]!.at) ? keys : [...keys].sort((x, y) => x.at - y.at));

function build(scene: Scene): Sampled {
  const { fps, frames, width: W, height: H } = scene;
  const nodes = scene.nodes;
  const slot = new Map(nodes.map((n, i) => [n.id, i]));
  const parentOf = nodes.map((n) => (n.parent === undefined ? -1 : (slot.get(n.parent) ?? -1)));
  const kids = new Map<string, string[]>();
  for (const n of nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id]);
  const wrap = new Set(nodes.filter((n) => n.kind === "group" && kids.get(n.id)?.length && kids.get(n.id)!.every((k) => !k.startsWith(`${n.id}.`))).map((n) => n.id));
  const isRoot = (i: number) => {
    if (wrap.has(nodes[i]!.id)) return false;
    for (let p = parentOf[i]!; p >= 0; p = parentOf[p]!) if (!wrap.has(nodes[p]!.id)) return false;
    return true;
  };
  const top = new Set(nodes.filter((_, i) => isRoot(i)).map((n) => n.id));
  const unitOfRoot = (id: string) => {
    const parts = id.split(".");
    for (let k = 1; k < parts.length; k++) {
      const head = parts.slice(0, k).join(".");
      if (top.has(head)) return head;
    }
    return id;
  };
  const nodeUnit: (string | undefined)[] = nodes.map((n, i) => {
    if (wrap.has(n.id)) return undefined;
    let r = i;
    for (let p = parentOf[i]!; p >= 0 && !wrap.has(nodes[p]!.id); p = parentOf[p]!) r = p;
    return unitOfRoot(nodes[r]!.id);
  });
  const units = [...new Set(nodeUnit.filter((u): u is string => !!u))];
  const unitIndex = new Map(units.map((u, i) => [u, i]));
  const uOf = nodeUnit.map((u) => (u === undefined ? -1 : unitIndex.get(u)!));

  // Tracks by node and prop.
  const tracks = nodes.map(() => new Map<string, Key[]>());
  for (const t of scene.tracks) {
    const i = slot.get(t.target);
    if (i === undefined) continue;
    const neutral = NEUTRAL[t.prop];
    const keys = ordered(t.keys);
    tracks[i]!.set(t.prop, neutral !== undefined && nodes[i]!.props[t.prop] === undefined ? fromNeutral(keys, neutral) : keys);
  }
  const prop = (i: number, p: string, f: number): Value | undefined => {
    const k = tracks[i]!.get(p);
    return k ? valueAt(k, f) : nodes[i]!.props[p];
  };

  // Parents before children.
  const order: number[] = [];
  const seen = new Uint8Array(nodes.length);
  const visit = (i: number) => {
    if (seen[i]) return;
    seen[i] = 1;
    if (parentOf[i]! >= 0) visit(parentOf[i]!);
    order.push(i);
  };
  nodes.forEach((_, i) => visit(i));
  const leaf = nodes.map((n) => n.kind !== "group");

  // Visibility: opacity multiplied down the tree, a path drawn at least a little, a text with words.
  const vis = units.map(() => new Uint8Array(frames));
  const opTracked = nodes.map((_, i) => tracks[i]!.has("opacity"));
  const staticOp = nodes.map((n) => num(n.props.opacity, 1));
  const eff = new Float32Array(nodes.length);
  for (let f = 0; f < frames; f++) {
    for (const i of order) {
      const own = opTracked[i] ? num(valueAt(tracks[i]!.get("opacity")!, f), 1) : staticOp[i]!;
      eff[i] = own * (parentOf[i]! >= 0 ? eff[parentOf[i]!]! : 1);
    }
    for (let i = 0; i < nodes.length; i++) {
      const u = uOf[i]!;
      if (u < 0 || !leaf[i] || eff[i]! <= 0.05 || vis[u]![f]) continue;
      const n = nodes[i]!;
      if (n.kind === "path") {
        if (num(prop(i, "drawn", f), 1) <= 0.01) continue;
        const pts = prop(i, "points", f);
        if (!(Array.isArray(pts) && pts.length >= 4) && typeof prop(i, "d", f) !== "string") continue;
      } else if (n.kind === "text") {
        if (!String(prop(i, "text", f) ?? "").trim()) continue;
      } else if (n.kind === "image" && !(num(prop(i, "w", f)) > 0 && num(prop(i, "h", f)) > 0)) continue;
      vis[u]![f] = 1;
    }
  }

  // Change: spans between keys that differ, while the thing shows (or just stopped showing).
  const act = units.map(() => new Uint8Array(frames));
  const camera = new Uint8Array(frames);
  const jumps: CameraJump[] = [];
  const camKeys: Record<string, Key[]> = {};
  tracks.forEach((byProp, i) => {
    const u = uOf[i]!;
    for (const [p, keys] of byProp) {
      const into = u >= 0 ? act[u]! : camera;
      if (u < 0) camKeys[`${i}.${p}`] = keys;
      for (let k = 1; k < keys.length; k++) {
        const [a, b] = [keys[k - 1]!, keys[k]!];
        const span = b.at - a.at;
        if (!differs(p, a.value, b.value, span)) continue;
        // Words switch once, at the end of their span.
        const [from, to] = p === "text" ? [b.at - 1, b.at + 1] : [a.at, Math.max(a.at + 1, b.at)];
        for (let f = Math.max(0, from); f < Math.min(frames, to); f++) into[f] = 1;
      }
    }
  });
  act.forEach((bits, u) => {
    const v = vis[u]!;
    for (let f = 0; f < frames; f++) if (bits[f] && !v[f] && !(f && v[f - 1])) bits[f] = 0;
  });
  // Camera jumps: a frame-to-frame change of zoom or pan much larger than a move would make.
  {
    const wrappers = nodes.map((n, i) => ({ n, i })).filter((x) => wrap.has(x.n.id));
    for (const { i } of wrappers) {
      const sx = (f: number) => num(prop(i, "scaleX", f), 1);
      const tx = (f: number) => [num(prop(i, "x", f)), num(prop(i, "y", f))];
      if (!tracks[i]!.size) continue;
      for (let f = 1; f < frames; f++) {
        if (!camera[f]) continue;
        const zoom = Math.max(sx(f), 1e-6) / Math.max(sx(f - 1), 1e-6);
        const [a, b] = [tx(f), tx(f - 1)];
        const shift = Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
        jumps.push({ frame: f, zoom: Math.max(zoom, 1 / zoom), shift });
      }
    }
  }

  const arrivals = units.map((_, u) => {
    const out: number[] = [];
    const v = vis[u]!;
    for (let f = 0; f < frames; f++) if (v[f] && (f === 0 || !v[f - 1])) out.push(f);
    return out;
  });
  const onsets = units.map((_, u) => {
    const out = new Set(arrivals[u]);
    const a = act[u]!;
    for (let f = 1; f < frames; f++) if (a[f] && !a[f - 1]) out.add(f);
    return [...out].sort((x, y) => x - y);
  });

  // Words each thing shows over the scene.
  const texts = units.map(() => new Set<string>());
  nodes.forEach((n, i) => {
    if (n.kind !== "text" || uOf[i]! < 0) return;
    const say = (v: unknown) => typeof v === "string" && v.trim() && texts[uOf[i]!]!.add(v.trim());
    say(n.props.text);
    for (const k of tracks[i]!.get("text") ?? []) say(k.value);
  });

  // Look-alike signature: what kinds of parts, their geometry and size, and the words; never color or id.
  const signature = units.map((_, u) => {
    const parts: string[] = [];
    nodes.forEach((n, i) => {
      if (uOf[i] !== u) return;
      const pts = n.props.points;
      const geo = Array.isArray(pts) ? `${pts.length}:${Math.round(Math.max(...pts.map(Math.abs)) / 4)}` : "";
      const size = n.kind === "text" ? Math.round(num(n.props.size) / 4) : Math.round(num(n.props.w) / 8) + "x" + Math.round(num(n.props.h) / 8);
      parts.push(`${n.kind}|${geo}|${size}|${Math.round(num(n.props.scaleX, 1) * 10)}|${n.kind === "text" ? String(n.props.text ?? "") : ""}`);
    });
    return parts.sort().join(";");
  });

  // Position: the mean of its leaves' offsets within the unit, from the tracks.
  const leavesOf = units.map(() => [] as number[][]);
  nodes.forEach((_, i) => {
    const u = uOf[i]!;
    if (u < 0 || !leaf[i]) return;
    const chain: number[] = [];
    for (let p = i; p >= 0 && uOf[p] === u; p = parentOf[p]!) chain.push(p);
    leavesOf[u]!.push(chain);
  });
  const pos = (u: number, f: number): [number, number] => {
    const ls = leavesOf[u]!;
    if (!ls.length) return [0, 0];
    let [x, y] = [0, 0];
    for (const chain of ls) for (const i of chain) (x += num(prop(i, "x", f))), (y += num(prop(i, "y", f)));
    return [x / ls.length, y / ls.length];
  };

  const paper = rgbOf(scene.background) ?? [255, 255, 255];
  const itemCache = new Map<number, Item[]>();
  const items = (f: number) => {
    const hit = itemCache.get(f);
    if (hit) return hit;
    const made = inventory(scene, f, nodeUnit, slot, paper);
    itemCache.set(f, made);
    return made;
  };
  const thingCache = new Map<string, Thing[]>();
  const things = (f: number, backdrop: number) => {
    const key = `${f}|${backdrop}`;
    const hit = thingCache.get(key);
    if (hit) return hit;
    const made = gather(items(f), W, H, backdrop);
    thingCache.set(key, made);
    return made;
  };
  const cameraKeys = [...new Set(Object.values(camKeys).flatMap((ks) => ks.map((k) => Math.round(k.at))))].filter((f) => f >= 0 && f < frames).sort((x, y) => x - y);
  return { scene, fps, frames, W, H, units, unitIndex, vis, act, camera, jumps, cameraKeys, arrivals, onsets, texts: texts.map((s) => [...s].join(" ")), signature, pos, items, things };
}

// ---------------------------------------------------------------------------------------------------------------------
// One frame: every visible primitive with its box through every transform (the camera's included), paint order, fade,
// and contrast against what is behind its center.

type M = [number, number, number, number, number, number];
const times = (m: M, o: M): M => [m[0] * o[0] + m[2] * o[1], m[1] * o[0] + m[3] * o[1], m[0] * o[2] + m[2] * o[3], m[1] * o[2] + m[3] * o[3], m[0] * o[4] + m[2] * o[5] + m[4], m[1] * o[4] + m[3] * o[5] + m[5]];
function local(a: Props): M {
  const r = (num(a.rotate) * Math.PI) / 180;
  const skew = Math.tan((num(a.skew) * Math.PI) / 180);
  const rot: M = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), num(a.x), num(a.y)];
  return times(times(rot, [1, 0, skew, 1, 0, 0]), [num(a.scaleX, 1), 0, 0, num(a.scaleY, 1), 0, 0]);
}
function place(m: M, r: Rect): Rect {
  const pts = [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => [m[0] * x! + m[2] * y! + m[4], m[1] * x! + m[3] * y! + m[5]]);
  return { x0: Math.min(...pts.map((p) => p[0]!)), y0: Math.min(...pts.map((p) => p[1]!)), x1: Math.max(...pts.map((p) => p[0]!)), y1: Math.max(...pts.map((p) => p[1]!)) };
}
export const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
export const meet = (a: Rect, b: Rect): Rect => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const painted = (v: unknown) => typeof v === "string" && v !== "none" && v !== "transparent" && alphaOf(v) > 0.05;
const inside = (r: Rect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

function inventory(scene: Scene, frame: number, nodeUnit: (string | undefined)[], slot: Map<string, number>, paper: RGB): Item[] {
  const out: (Omit<Item, "behind" | "contrast"> & { layer: number; seq: number })[] = [];
  let seq = 0;
  // A part's clip (a shape in its own coordinates) bounds what it and its children draw; a part lifted to its own layer
  // leaves its parents' clips, as the renderer draws it. Boxes are cut to the clip, so a liquid clipped by its vessel
  // is as big as what shows, not as big as its rectangle.
  const clipped = (box: Rect, clip: Rect | undefined): Rect | undefined => {
    if (!clip) return box;
    const b = meet(box, clip);
    return b.x1 > b.x0 && b.y1 > b.y0 ? b : undefined;
  };
  // `m` places a part on the frame through every transform, the camera's included; `mr` leaves out the frames around
  // things (the camera, layers), so `rest` is where the part would be with the camera at rest.
  const walk = (list: Resolved[], m: M, mr: M, opacity: number, muted: boolean, layer: number, inherited: Rect | undefined) => {
    const sorted = list.map((r, i) => ({ r, i })).sort((a, b) => num(a.r.props.z) - num(b.r.props.z) || a.i - b.i).map((x) => x.r);
    for (const r of sorted) {
      const a = r.props;
      const o = opacity * num(a.opacity, 1);
      if (o <= 0.02) continue;
      const w = times(m, local(a));
      const frameAround = r.kind === "group" && nodeUnit[slot.get(r.id) ?? -1] === undefined;
      const wr = frameAround ? mr : times(mr, local(a));
      const boxes = (rect: Rect) => ({ full: place(w, rect), rest: place(wr, rect) });
      const lay = num(a.layer) || layer;
      let clip = num(a.layer) ? undefined : inherited;
      if (Array.isArray(a.clip) && a.clip.length >= 6) {
        const c = a.clip as number[];
        let [cx0, cy0, cx1, cy1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i + 1 < c.length; i += 2) [cx0, cy0, cx1, cy1] = [Math.min(cx0, c[i]!), Math.min(cy0, c[i + 1]!), Math.max(cx1, c[i]!), Math.max(cy1, c[i + 1]!)];
        const own = place(w, { x0: cx0, y0: cy0, x1: cx1, y1: cy1 });
        clip = clip ? meet(clip, own) : own;
      }
      const dull = muted || num(a.brightness, 1) < 0.8 || num(a.saturation, 1) < 0.6 || (num(a.blur) > 2 && r.kind !== "image");
      const unit = nodeUnit[slot.get(r.id) ?? -1] ?? r.id;
      const light = (c: RGB | undefined): RGB | undefined => (c ? (c.map((v) => Math.min(255, v * num(a.brightness, 1))) as RGB) : undefined);
      if (r.kind === "text" && String(a.text ?? "").trim()) {
        const size = num(a.size, 60);
        const width = estimate(String(a.text), size, typeof a.font === "string" && /mono|courier/i.test(a.font) ? "mono" : undefined);
        const anchor = String(a.anchor ?? "middle");
        const x0 = anchor === "start" ? 0 : anchor === "end" ? -width : -width / 2;
        const b = boxes({ x0, y0: -size * 0.6, x1: x0 + width, y1: size * 0.6 });
        const box = clipped(b.full, clip);
        if (box) out.push({ id: r.id, unit, kind: "text", text: String(a.text), box, ...b, opacity: o * alphaOf(a.color), size: size * Math.hypot(w[0], w[1]), paint: light(rgbOf(a.color)), filled: false, muted: dull, order: 0, layer: lay, seq: seq++ });
      } else if (r.kind === "image") {
        const [iw, ih] = [num(a.w), num(a.h)];
        const b = boxes({ x0: -iw / 2, y0: -ih / 2, x1: iw / 2, y1: ih / 2 });
        const box = iw > 0 && ih > 0 ? clipped(b.full, clip) : undefined;
        if (box) out.push({ id: r.id, unit, kind: "image", box, ...b, opacity: o, filled: true, muted: dull, order: 0, layer: lay, seq: seq++ });
      } else if (r.kind === "path" && Array.isArray(a.points) && a.points.length >= 4 && num(a.drawn, 1) > 0.01) {
        const p = a.points as number[];
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i + 1 < p.length; i += 2) [x0, y0, x1, y1] = [Math.min(x0, p[i]!), Math.min(y0, p[i + 1]!), Math.max(x1, p[i]!), Math.max(y1, p[i + 1]!)];
        const hasFill = painted(a.fill) && num(a.fillOpacity, 1) > 0.05;
        const pad = num(a.strokeWidth) / 2;
        const b = boxes({ x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad });
        const box = clipped(b.full, clip);
        const paintOf = hasFill ? a.fill : a.stroke;
        const alpha = hasFill ? alphaOf(a.fill) * num(a.fillOpacity, 1) : painted(a.stroke) ? alphaOf(a.stroke) * num(a.strokeOpacity, 1) : 0;
        if (alpha <= 0.02 || !box) {
          walk(r.children, w, wr, o, dull, lay, clip);
          continue;
        }
        out.push({ id: r.id, unit, kind: "shape", box, ...b, opacity: o * alpha, paint: light(rgbOf(paintOf)), filled: hasFill && o * alpha > 0.85, muted: dull, order: 0, layer: lay, seq: seq++ });
      }
      walk(r.children, w, wr, o, dull, lay, clip);
    }
  };
  walk(evaluate(scene, frame), [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0], 1, false, 0, undefined);
  const list = out.sort((a, b) => a.layer - b.layer || a.seq - b.seq).map(({ layer: _l, seq: _s, ...t }, i) => ({ ...t, order: i }));
  // What lies behind each item's center: the topmost filled shape or picture painted before it, over the background.
  return list.map((t) => {
    const [cx, cy] = [(t.box.x0 + t.box.x1) / 2, (t.box.y0 + t.box.y1) / 2];
    let under: (typeof list)[number] | undefined;
    for (let j = t.order - 1; j >= 0; j--) {
      const u = list[j]!;
      if (u.unit === t.unit && u.kind === "shape" && t.kind === "shape") continue; // a shape's own outline and fill
      if ((u.kind === "image" || (u.kind === "shape" && u.paint && u.opacity > 0.3 && area(u.box) > area(t.box) * 0.5)) && inside(u.box, cx, cy)) {
        under = u;
        break;
      }
    }
    const behind: RGB | "picture" = under?.kind === "image" ? "picture" : under?.paint ? blend(under.paint, paper, Math.min(1, under.opacity)) : paper;
    const contrast = t.kind === "image" || behind === "picture" || !t.paint ? undefined : ratio(blend(t.paint, behind, Math.min(1, t.opacity * (t.muted ? 0.6 : 1))), behind);
    return { ...t, behind, contrast };
  });
}

/** A shape over `share` of the frame with the camera at rest is a backdrop, not a thing; a push that makes a thing
 * fill the frame does not make it a backdrop. */
export const isBackdrop = (t: Item, W: number, H: number, share: number) => t.kind === "shape" && area(meet(t.rest, { x0: 0, y0: 0, x1: W, y1: H })) > W * H * share;

function gather(items: Item[], W: number, H: number, backdrop: number): Thing[] {
  const frame: Rect = { x0: 0, y0: 0, x1: W, y1: H };
  const by = new Map<string, Item[]>();
  for (const t of items) {
    if (isBackdrop(t, W, H, backdrop)) continue;
    by.set(t.unit, [...(by.get(t.unit) ?? []), t]);
  }
  return [...by].map(([unit, list]) => {
    const u = list.reduce((b, t) => ({ x0: Math.min(b.x0, t.box.x0), y0: Math.min(b.y0, t.box.y0), x1: Math.max(b.x1, t.box.x1), y1: Math.max(b.y1, t.box.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    const box = meet(u, frame);
    const sum = list.reduce((s, t) => s + area(meet(t.box, frame)), 0);
    const kinds = new Set(list.map((t) => t.kind));
    const kind = kinds.has("image") ? "picture" : kinds.size === 1 && kinds.has("text") ? "text" : list.filter((t) => t.kind === "text").reduce((s, t) => s + area(t.box), 0) > sum / 2 ? "text" : "shape";
    const cs = list.map((t) => t.contrast).filter((c): c is number => c !== undefined);
    const text = list.filter((t) => t.kind === "text").map((t) => t.text).join(" ");
    return { unit, kind, box, area: Math.min(sum, area(box)), opacity: Math.max(...list.map((t) => t.opacity)), contrast: cs.length ? Math.max(...cs) : undefined, text, chars: text.replace(/\s+/g, "").length, items: list };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared helpers.

/** The frames to measure: inclusive start, exclusive end. */
export function windowOf(input: MeasureInput): [number, number] {
  const n = input.scene.frames;
  const [a, b] = input.window ?? [0, n];
  return [Math.max(0, Math.min(n, Math.round(a))), Math.max(0, Math.min(n, Math.round(b)))];
}

/** Evenly spaced frames, `perSecond` of them a second, half a step in, plus any extra frames inside the window. */
export function framesOf(fps: number, [a, b]: [number, number], perSecond: number, extra: number[] = []): number[] {
  const step = Math.max(1, Math.round(fps / Math.max(0.1, perSecond)));
  const out = new Set<number>();
  for (let f = a + Math.floor(step / 2); f < b; f += step) out.add(f);
  for (const f of extra) if (f >= a && f < b) out.add(Math.round(f));
  if (!out.size && b > a) out.add(a);
  return [...out].sort((x, y) => x - y);
}

/**
 * The frames an instrument that reads the picture samples: evenly spaced, plus where camera moves start and end and the
 * window's last frame, so a push is read at its closest and not only between samples.
 */
export const pictureFrames = (s: Sampled, range: [number, number], perSecond: number): number[] => framesOf(s.fps, range, perSecond, [...s.cameraKeys.flatMap((f) => [f - 1, f]), range[1] - 1]);

/** Text height in arcminutes for a viewer: the frame's physical width and distance turn pixels into angle. */
export function arcmin(px: number, viewing: Viewing, frameWidthPx: number): number {
  const mm = (px / frameWidthPx) * viewing.frameWidthMm;
  return ((2 * Math.atan(mm / 2 / Math.max(1, viewing.distanceMm)) * 180) / Math.PI) * 60;
}

/** How wide the whole frame looks, in degrees. */
export const frameDegrees = (v: Viewing) => (2 * Math.atan(v.frameWidthMm / 2 / Math.max(1, v.distanceMm)) * 180) / Math.PI;

/** Does a scene id (a unit or one of its parts) cover this item? */
export const covers = (id: string, item: { id: string; unit: string }) => item.id === id || item.id.startsWith(`${id}.`) || item.unit === id || item.unit.startsWith(`${id}.`);

/** Units a list of scene ids touches, wholly or in part. */
export function unitsOf(s: Sampled, ids: string[]): number[] {
  const out = new Set<number>();
  s.units.forEach((u, i) => {
    if (ids.some((x) => u === x || u.startsWith(`${x}.`) || x.startsWith(`${u}.`))) out.add(i);
  });
  return [...out];
}

/** The plan's names, or every unit by its own id when no names are given. */
export function namesOf(s: Sampled, input: MeasureInput): Record<string, string[]> {
  return input.ids && Object.keys(input.ids).length ? input.ids : Object.fromEntries(s.units.map((u) => [u, [u]]));
}

export const UI = (v: Viewing, W: number, H: number): Rect[] => v.uiZones.map((z) => ({ x0: z.box[0] * W, y0: z.box[1] * H, x1: z.box[2] * W, y1: z.box[3] * H }));

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
export const round = (x: number, d = 3) => (Number.isFinite(x) ? +x.toFixed(d) : x);
export const sec = (frames: number, fps: number) => `${(frames / fps).toFixed(1)} s`;
/** A short name for a unit: its id and the first words it shows. */
export const label = (s: Sampled, u: number) => (s.texts[u] ? `${s.units[u]} ("${s.texts[u]!.slice(0, 24)}")` : s.units[u]!);
