// The writer every ability draws through: long-lived nodes created hidden, then timed property changes, behaviors and
// camera moves, assembled into a SceneDoc for the engine's own compile(). It has no opinions: every number it writes is
// given to it.
import type { Ease, NodeSpec, Props, SceneDoc, Step, Value } from "../../core/types.ts";

export type Op = { id: string; prop: string; value: Value; at: number; frames: number; ease: Ease };
export type Play = { at: number; target: string; behavior: string; args: Record<string, Value> };

const same = (a: Value | undefined, b: Value) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-4) || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - (b[i] as number)) < 1e-4));

export class Writer {
  specs: NodeSpec[] = [];
  ops: Op[] = [];
  plays: Play[] = [];
  /** The value each property will have once every change written so far has played. */
  known = new Map<string, Props>();
  camera = { zoom: 1, panX: 0, panY: 0 };
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.camera = { zoom: 1, panX: width / 2, panY: height / 2 };
  }
  has(id: string) {
    return this.known.has(id);
  }
  node(id: string, kind: "group" | "path" | "text" | "image", props: Props, parent?: string) {
    if (this.known.has(id)) return;
    const full: Props = { x: 0, y: 0, ...props };
    this.specs.push({ id, kind, parent, props: full });
    this.known.set(id, { opacity: 1, scaleX: 1, scaleY: 1, drawn: 1, rotate: 0, ...full });
  }
  /** Moves a property to a value from frame `at` over `frames`. A change to the value it already has is skipped. */
  put(id: string, prop: string, value: Value, at: number, frames = 1, ease: Ease = "smooth") {
    const kn = this.known.get(id);
    if (!kn) return;
    if (same(kn[prop], value)) return;
    kn[prop] = value;
    this.ops.push({ id, prop, value, at: Math.max(0, Math.round(at)), frames: Math.max(1, Math.round(frames)), ease });
  }
  would(id: string, prop: string, value: Value) {
    return !same(this.known.get(id)?.[prop], value);
  }
  value(id: string, prop: string): Value | undefined {
    return this.known.get(id)?.[prop];
  }
  play(at: number, target: string, behavior: string, args: Record<string, Value>) {
    this.plays.push({ at: Math.max(0, Math.round(at)), target, behavior, args });
  }
  /** The camera: zoom about a point that ends up at the frame's center. */
  cam(zoom: number, panX: number, panY: number, at: number, frames: number, ease: Ease) {
    const f = Math.max(1, Math.round(frames));
    const a = Math.max(0, Math.round(at));
    this.ops.push({ id: "camera", prop: "zoom", value: zoom, at: a, frames: f, ease }, { id: "camera", prop: "panX", value: panX, at: a, frames: f, ease }, { id: "camera", prop: "panY", value: panY, at: a, frames: f, ease });
    this.camera = { zoom, panX, panY };
  }
  doc(): SceneDoc {
    const steps: Step[] = [{ at: 0, add: this.specs, enter: "none", set: { camera: { zoom: 1, panX: this.width / 2, panY: this.height / 2 } } }];
    const grouped = new Map<string, { at: number; frames: number; ease: Ease; set: Record<string, Props> }>();
    for (const o of this.ops) {
      const gk = `${o.at}|${o.frames}|${o.ease}`;
      const g = grouped.get(gk) ?? grouped.set(gk, { at: o.at, frames: o.frames, ease: o.ease, set: {} }).get(gk)!;
      (g.set[o.id] ??= {})[o.prop] = o.value;
    }
    for (const g of grouped.values()) steps.push({ at: g.at, set: g.set, move: { frames: g.frames, ease: g.ease } });
    for (const p of this.plays) steps.push({ at: p.at, play: [{ behavior: p.behavior, target: p.target, args: p.args }] });
    return { steps };
  }
}

export const r1 = (v: number) => Math.round(v * 10) / 10;
export const circlePts = (r: number, n = 16, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [r1(cx + r * Math.cos((i / n) * 2 * Math.PI)), r1(cy + r * Math.sin((i / n) * 2 * Math.PI))]).flat();
export const UNIT_CIRCLE = Array.from({ length: 20 }, (_, i) => [Math.round(Math.cos((i / 20) * 2 * Math.PI) * 1000) / 1000, Math.round(Math.sin((i / 20) * 2 * Math.PI) * 1000) / 1000]).flat();
/** An ellipse by its own points, in pixels. Small round marks are drawn this way, never by stretching a unit circle: a style's hand is in local units and would stretch with it. */
export const ellipse = (rx: number, ry: number, n = 20) => Array.from({ length: n }, (_, i) => [r1(rx * Math.cos((i / n) * 2 * Math.PI)), r1(ry * Math.sin((i / n) * 2 * Math.PI))]).flat();
export const roundedRect = (x0: number, y0: number, x1: number, y1: number, r: number) => `M${x0 + r} ${y0}H${x1 - r}Q${x1} ${y0} ${x1} ${y0 + r}V${y1 - r}Q${x1} ${y1} ${x1 - r} ${y1}H${x0 + r}Q${x0} ${y1} ${x0} ${y1 - r}V${y0 + r}Q${x0} ${y0} ${x0 + r} ${y0}Z`;
