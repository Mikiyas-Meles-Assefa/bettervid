// Flows: contents leave a source and land in another thing, as drops or a stream drawn by a flow depiction
// (engine/design/depict/kinds/flow.ts) laid from the source's outlet anchor to the target's surface anchor. The amount
// moved is physical (the source's and the target's capacities, through `transfer`); the rate, the size a drop is drawn
// at and the slow motion are the caller's. While the target flashes, each landing makes a bloom of the flash's color.
import type { Theme } from "../../core/types.ts";
import { depictionFrom, transfer, type ActResult, type Change, type DepictLook, type Depiction, type Pt } from "../depict/index.ts";
import type { Writer } from "./writer.ts";
import { ellipse } from "./writer.ts";

/** A depiction placed on screen: its root at (x, y), scaled by s. */
export type Placed = { d: Depiction; x: number; y: number; s: number };
export const onScreen = (p: Placed, a: Pt): Pt => [p.x + p.s * a[0], p.y + p.s * a[1]];

/** Writes a depiction's changes, started at frame `at`, stretched in time by `stretch` (2 plays at half speed). */
export function putChanges(w: Writer, changes: Change[], at: number, stretch = 1) {
  for (const c of changes) w.put(c.id, c.prop, c.value, at + c.at * stretch, Math.max(1, c.frames * stretch), c.ease);
}

/** The property changes of an act, none when the thing could not do it. */
export const changesOf = (r: ActResult) => (r.known ? r.changes : []);

/** Adds a depiction's nodes, its root group with the given props. */
export function depictionNodes(w: Writer, d: Depiction, root: Record<string, number | string>) {
  for (const n of d.nodes) w.node(n.id, n.kind as "group", n.id === d.id ? { ...(n.props ?? {}), ...root } : n.props ?? {}, n.parent);
}

/** A pool of bloom nodes for a target, reused in turn. */
export function bloomNodes(w: Writer, dst: string, pool: number) {
  for (let j = 0; j < pool; j++) w.node(`bloom.${dst}.${j}`, "path", { points: ellipse(1, 1), closed: 1, fill: "ink", stroke: "none", opacity: 0 });
}

export type FlowParams = {
  id: string; // the flow depiction's id
  verb: string; // the author's verb, which the source acts out (a tap opens)
  form: "drops" | "stream";
  rate: number; // drops per second (drops)
  /** Volume that leaves per drop (drops) or per second (stream), in the source's capacity unit. */
  volume: { perDrop: number; perSecond: number };
  /** How wide what flows is drawn on screen, px: the larger of its true size and what the viewing needs to see it. */
  widthPx: number;
  /** Screen px per centimetre of the source's drawing, so the flow's time under gravity is physical. */
  pxPerCm: number;
  /** Slow motion: changes play `stretch` times longer than real (1 real). */
  stretch: number;
  bloom?: { size: [number, number]; grow: number; fade: number; spread: number; every: number };
  tapFrames: number;
  /** Frames a stream takes to run out once it stops. */
  stopFrames: number;
  fps: number;
  theme: Theme;
  look: DepictLook;
};

/**
 * Plays a flow from `at0` to `end`. `flashAt(frame)` gives the color the target flashes at a frame, if any. Returns the
 * landings, the volume moved and notes; the depictions' states move with it (the source drains, the target fills).
 */
export function playFlow(w: Writer, src: Placed, dst: Placed, at0: number, end: number, p: FlowParams, bloom: () => string, flashAt: (frame: number) => string | undefined) {
  const notes: string[] = [];
  const opened = src.d.act(p.verb, undefined, { frames: p.tapFrames, fps: p.fps });
  if (opened.known) putChanges(w, opened.changes, at0);
  else notes.push(...opened.notes);
  const from = onScreen(src, src.d.anchor("outlet") ?? src.d.anchor("mouth") ?? [0, -src.d.box.h]);
  const to = onScreen(dst, dst.d.anchor("surface") ?? dst.d.anchor("mouth") ?? [0, -dst.d.box.h]);
  const box = { w: Math.max(1, Math.abs(to[0] - from[0])), h: Math.max(1, Math.abs(to[1] - from[1])) };
  const stuff = String(src.d.state.color ?? "");
  const fd = depictionFrom(
    {
      kind: "flow",
      form: p.form,
      label: `${src.d.label} into ${dst.d.label}`,
      size: { w: box.w / p.pxPerCm, h: box.h / p.pxPerCm, unit: "cm" },
      params: { path: [from, to], rate: p.rate, width: p.widthPx / p.pxPerCm },
      ...(/^#/.test(stuff) ? { colors: { stuff }, colorSources: { stuff: `the contents of ${src.d.label}, from its spec` } } : {}),
      why: "laid by the composer between the source's outlet and the target's surface",
    },
    p.theme,
    { id: p.id, look: p.look },
  );
  depictionNodes(w, fd, { x: 0, y: 0 });
  const span = Math.max(1, Math.round((end - at0) / p.stretch));
  const run = fd.act("runs", undefined, { frames: span, fps: p.fps });
  putChanges(w, changesOf(run), at0, p.stretch);
  const stop = fd.act("stops", undefined, { frames: p.stopFrames, fps: p.fps });
  putChanges(w, changesOf(stop), end);
  // Where drops land: each ripple that rings out; a stream lands all along, every `bloom.every` frames once it arrives.
  let lands: number[] = changesOf(run).filter((c) => c.id.includes(".ripple") && c.prop === "opacity" && Number(c.value) > 0).map((c) => Math.round(at0 + c.at * p.stretch));
  if (p.form === "stream") {
    const reach = Math.round(at0 + Math.sqrt((2 * (box.h / p.pxPerCm)) / 981) * p.fps * p.stretch);
    const every = Math.max(1, p.bloom?.every ?? p.fps / Math.max(0.1, p.rate));
    lands = [];
    for (let t = reach; t < end; t += every) lands.push(Math.round(t));
  }
  const real = (end - at0) / p.stretch / p.fps;
  const amount = p.form === "drops" ? lands.length * p.volume.perDrop : p.volume.perSecond * real;
  let moved = 0;
  if (src.d.capacity && dst.d.capacity) {
    const tr = transfer(src.d, dst.d, amount, { frames: Math.max(1, end - at0), fps: p.fps });
    putChanges(w, tr.changes, at0);
    moved = tr.moved;
    notes.push(...tr.notes);
  } else notes.push(`${src.d.label} into ${dst.d.label}: ${!src.d.capacity ? src.d.label : dst.d.label} holds no contents with a level, so nothing is moved between them`);
  const half = ((dst.d.parts.surface?.box ? dst.d.parts.surface.box[2] - dst.d.parts.surface.box[0] : dst.d.box.w * 0.6) * dst.s) / 2;
  if (p.bloom) {
    lands.forEach((tl, i) => {
      const fc = flashAt(tl);
      if (!fc) return;
      const bl = bloom();
      const jx = (((i * 37) % 9) - 4) / 4; // spread landings across the surface, the same every time
      const ty = onScreen(dst, dst.d.anchor("surface") ?? [0, 0])[1];
      w.put(bl, "fill", fc, tl - 1);
      w.put(bl, "x", to[0] + jx * half * p.bloom!.spread, tl - 1);
      w.put(bl, "y", ty + p.bloom!.size[1], tl - 1);
      w.put(bl, "points", ellipse(p.bloom!.size[0] * half, p.bloom!.size[1]), tl - 1);
      w.put(bl, "opacity", 1, tl, 3, "out");
      w.put(bl, "points", ellipse(2 * p.bloom!.size[0] * half, 2.5 * p.bloom!.size[1]), tl, p.bloom!.grow, "out");
      w.put(bl, "opacity", 0, tl + 5, p.bloom!.fade, "smooth");
    });
  }
  return { flow: fd, lands, moved, notes: [...notes, ...fd.notes] };
}

/** Plays the flow again (a replay: nothing moves a second time), from `at` over `frames`, stretched for slow motion. */
export function replayFlow(w: Writer, fd: Depiction, at: number, frames: number, stretch: number, fps: number, stopFrames: number) {
  const run = fd.act("runs", undefined, { frames: Math.max(1, Math.round(frames / stretch)), fps });
  putChanges(w, changesOf(run), at, stretch);
  const stop = fd.act("stops", undefined, { frames: stopFrames, fps });
  putChanges(w, changesOf(stop), at + frames);
}
