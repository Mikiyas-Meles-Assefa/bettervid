// What a depicted object does in place: its contents change color and stay (turns), rise or fall to a level (fills), it
// rocks or spins (sways), a clock's hand runs, it travels to another thing (moves to). Every duration and amount is a
// parameter.
import { liquidPoly, type Prop } from "../depict/index.ts";
import type { St } from "./types.ts";
import type { Writer } from "./writer.ts";

/** The node whose fill is the object's color: a vessel's liquid, a ball's body. */
export const colorNodeOf = (node: string, p: Prop) => (p.kind === "vessel" ? `${node}.liq` : p.kind === "ball" ? `${node}.ball` : undefined);

export function turns(w: Writer, node: string, p: Prop, color: string, at: number, frames: number) {
  const n = colorNodeOf(node, p);
  if (n) w.put(n, "fill", color, at, frames, "smooth");
  return !!n;
}

export function fills(w: Writer, node: string, p: Prop, level: number, at: number, frames: number) {
  w.put(`${node}.liq`, "points", liquidPoly(p, level), at, frames, "smooth");
  w.put(`${node}.surf`, "points", liquidPoly(p, level).slice(0, 4), at, frames, "smooth");
}

/** Rocks on its base: each swing `degrees` (decaying by `decay`), `frames` per swing; or one full turn when it spins. */
export function sways(w: Writer, node: string, how: string, at: number, p: { degrees: number; swings: number; frames: number; decay: number; spinFrames: number }) {
  if (how === "spins") return void w.put(node, "rotate", 360, at, p.spinFrames, "smooth");
  for (let i = 0; i < p.swings; i++) w.put(node, "rotate", (i % 2 ? -1 : 1) * p.degrees * p.decay ** Math.floor(i / 2), at + i * p.frames, p.frames, "smooth");
  w.put(node, "rotate", 0, at + p.swings * p.frames, p.frames, "smooth");
}

/** A clock's hand sweeps the time it runs (a full turn a minute) from `at` over `frames`, with the time written under it. */
export function runs(w: Writer, node: string, label: string, st: St, seconds: number, at: number, frames: number, p: { fs: number; until: number; fade: number; text: string }) {
  w.put(`${node}.hand`, "rotate", 360 * Math.min(1, seconds / 60), at, frames, "linear");
  w.put(label, "text", p.text, at);
  w.put(label, "x", st.x, at);
  w.put(label, "y", st.y + p.fs * 0.8, at);
  w.put(label, "scaleX", p.fs / 100, at);
  w.put(label, "scaleY", p.fs / 100, at);
  w.put(label, "opacity", 1, at, p.fade, "out");
  w.put(label, "opacity", 0, p.until, p.fade, "in");
}

/** Travels to another thing's place, and stays there for the rest of the moment. */
export function movesTo(w: Writer, node: string, to: { x: number; y: number }, at: number, frames: number) {
  w.put(node, "x", to.x, at, frames, "smooth");
  w.put(node, "y", to.y, at, frames, "smooth");
}
