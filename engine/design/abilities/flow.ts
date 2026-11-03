// Flows: liquid leaves a source and lands in a vessel, as single drops that hang at the tip and fall, or as a quick
// stream. The rate, the volume and how the levels move are parameters; the source's scale (a burette's mL) is physical.
// While the vessel flashes, each drop that lands makes a bloom of color that fades.
import { buretteLevelOf, buretteReading, liquidPoly, surfaceY, tipOf, withAlpha, type Prop } from "../depict/index.ts";
import type { St } from "./types.ts";
import type { Writer } from "./writer.ts";
import { ellipse } from "./writer.ts";

const dropPts = (r: number) => ellipse(r, r * 1.25);

export type FlowPlaced = { node: string; prop: Prop; st: St };
const toScreen = (it: St, x: number, y: number) => ({ x: it.x + it.s * x, y: it.y + it.s * y });

/** Pools of drop and bloom nodes for a source and its vessel, reused in turn. */
export function flowNodes(w: Writer, src: string, dst: string, p: { pool: number; dropFill: string; dropStroke: string; bloomFill: string }) {
  for (let j = 0; j < p.pool; j++) w.node(`drop.${src}.${j}`, "path", { points: dropPts(1), closed: 1, fill: p.dropFill, stroke: p.dropStroke, strokeWidth: 1.5, opacity: 0 });
  for (let j = 0; j < p.pool; j++) w.node(`bloom.${dst}.${j}`, "path", { points: ellipse(1, 1), closed: 1, fill: p.bloomFill, stroke: "none", opacity: 0 });
}

export type FlowParams = {
  /** drops: one at a time, each hangs at the tip, then falls; stream: a quick run of drops with no hang. */
  mode: "drops" | "stream";
  every: number; // frames between drops
  fallFrames: number; // frames a drop takes from the tip to the surface
  hang: number; // frames a drop hangs at the tip before it falls (drops)
  size: { start: number; hang: number; fall: number }; // drop radius in px when it appears, when it hangs, when it falls
  /** Volume that leaves the source per drop (drops) or per second (stream), in the source's own unit when it has a scale. */
  volume: { perDrop: number; perSecond: number };
  /** For a source with no scale: the share of its contents the whole flow drains. */
  drainShare: number;
  /** How the vessel fills: per drop (drops), for the whole flow (stream), and at most. */
  fill: { perDrop: number; whole: number; max: number };
  bloom?: { size: [number, number]; grow: number; fade: number; spread: number };
  fps: number;
};

/**
 * Schedules the flow from `at0` to `end`. `flashAt(frame)` gives the color the vessel flashes at a frame, if any.
 * Returns how many drops fell, the levels it leaves, and the volume moved when the source has a scale.
 */
export function playFlow(w: Writer, a: FlowPlaced, b: FlowPlaced, levels: { a: number; b: number }, at0: number, end: number, p: FlowParams, pool: { drop: () => string; bloom: () => string }, flashAt: (frame: number) => string | undefined) {
  const slow = p.mode === "drops";
  const hang = slow ? p.hang : 0;
  const tip = toScreen(a.st, tipOf(a.prop).x, tipOf(a.prop).y);
  const n = Math.max(1, Math.floor((end - at0 - hang - p.fallFrames) / p.every));
  const scaled = a.prop.shape === "burette";
  const vol = slow ? p.volume.perDrop * n : (p.volume.perSecond * (end - at0)) / p.fps;
  const levelA = scaled ? Math.max(0.02, buretteLevelOf(buretteReading(levels.a) + vol)) : Math.max(0, levels.a - p.drainShare);
  const levelB = Math.min(p.fill.max, levels.b + (slow ? p.fill.perDrop * n : p.fill.whole));
  const halfW = Math.abs(liquidPoly(b.prop, levels.b)[2]! - liquidPoly(b.prop, levels.b)[0]!) * b.st.s * 0.5;
  for (let i = 0; i < n; i++) {
    const t = at0 + i * p.every;
    const tl = t + hang + p.fallFrames;
    const u = (tl - at0) / Math.max(1, end - at0);
    const land = toScreen(b.st, 0, surfaceY(b.prop, levels.b + (levelB - levels.b) * u));
    const d = pool.drop();
    w.put(d, "x", tip.x, t - 1);
    w.put(d, "y", tip.y + p.size.start, t - 1);
    w.put(d, "points", dropPts(slow ? p.size.start : p.size.fall), t - 1);
    w.put(d, "opacity", 1, t, 2, "out");
    if (slow) w.put(d, "points", dropPts(p.size.hang), t, hang, "out");
    w.put(d, "y", land.y - p.size.fall * 0.5, t + hang, p.fallFrames, "in");
    w.put(d, "opacity", 0, tl, 2, "linear");
    const fc = flashAt(tl);
    if (fc && p.bloom) {
      const bl = pool.bloom();
      const jx = (((i * 37) % 9) - 4) / 4; // spread landings across the surface, the same every time
      w.put(bl, "fill", withAlpha(fc, 0.85), tl - 1);
      w.put(bl, "x", land.x + jx * halfW * p.bloom.spread, tl - 1);
      w.put(bl, "y", land.y + p.bloom.size[1], tl - 1);
      w.put(bl, "points", ellipse(p.bloom.size[0] * halfW, p.bloom.size[1]), tl - 1);
      w.put(bl, "opacity", 1, tl, 3, "out");
      w.put(bl, "points", ellipse(2 * p.bloom.size[0] * halfW, 2.5 * p.bloom.size[1]), tl, p.bloom.grow, "out");
      w.put(bl, "opacity", 0, tl + 5, p.bloom.fade, "smooth");
    }
  }
  // The levels move with the flow: the source drains, the vessel fills.
  const dur = Math.max(1, end - at0);
  w.put(`${a.node}.liq`, "points", liquidPoly(a.prop, levelA), at0, dur, "linear");
  w.put(`${a.node}.surf`, "points", liquidPoly(a.prop, levelA).slice(0, 4), at0, dur, "linear");
  w.put(`${b.node}.liq`, "points", liquidPoly(b.prop, levelB), at0, dur, "linear");
  w.put(`${b.node}.surf`, "points", liquidPoly(b.prop, levelB).slice(0, 4), at0, dur, "linear");
  return { n, levelA, levelB, volume: scaled ? vol : undefined };
}
