// Falls: things drop under gravity in physical time. The time comes from the height (from the drawing's real scale) and
// g; how it plays (real speed, slowed, a number, a replay) is a parameter the director sets. Things that fall together
// keep a dashed line joining their bottoms and leave faint marks where they passed, so the eye can see they stay level.
import type { Writer } from "./writer.ts";
import { ellipse } from "./writer.ts";
import { levelNode } from "./marks.ts";

/** Gravity at the Earth's surface, m/s². A physical fact, not a choice. */
export const G = 9.81;
/** Seconds to fall `metres` from rest. */
export const fallSeconds = (metres: number, g = G) => Math.sqrt((2 * Math.max(0, metres)) / g);

/** Playback speed as a multiplier of real time (1 real, below 1 slowed). */
export type Speed = number;

export type Faller = { id: string; x: number; y: number; s: number; d: number; len: number; fill: string };

export type FallParams = {
  /** Frames for the fall at real speed (from fallSeconds and the fps). */
  realFrames: number;
  speed: Speed;
  replay?: { speed: Speed; pause: number };
  squash: { amount: number; frames: number; settle: number };
  trail: { marks: number; opacity: number; fadeAt: number; fadeFrames: number };
  level?: { id: string; opacity: number; holdAfter: number; fadeFrames: number };
};

export function fallNodes(w: Writer, ids: { id: string; fill: string }[], trailMarks: number, level: { id: string; color: string; width: number; dash: number[] } | undefined) {
  for (const { id, fill } of ids) for (let j = 0; j < trailMarks; j++) w.node(`ghost.${id}.${j}`, "path", { points: ellipse(1, 1), closed: 1, fill, stroke: "none", opacity: 0 });
  if (level) levelNode(w, level.id, level);
}

/** One drop of the group from where they hang: returns the frame they land. */
function drop(w: Writer, items: Faller[], t: number, frames: number, p: FallParams, trailOn: boolean): number {
  for (const it of items) {
    w.put(it.id, "y", it.y + it.len, t, frames, "in");
    w.put(it.id, "scaleY", it.s * (1 - p.squash.amount), t + frames, p.squash.frames, "out");
    w.put(it.id, "scaleX", it.s * (1 + p.squash.amount * 0.6), t + frames, p.squash.frames, "out");
    w.put(it.id, "scaleY", it.s, t + frames + p.squash.frames, p.squash.settle, "spring");
    w.put(it.id, "scaleX", it.s, t + frames + p.squash.frames, p.squash.settle, "spring");
    if (!trailOn) continue;
    const r = it.d / 2;
    for (let j = 0; j < p.trail.marks; j++) {
      const fr = (j + 1) / (p.trail.marks + 1);
      const gh = `ghost.${it.id}.${j}`;
      // Under gravity a thing has covered a share fr of the distance after sqrt(fr) of the time.
      const when = t + Math.round(frames * Math.sqrt(fr));
      w.put(gh, "x", it.x, t - 1);
      w.put(gh, "y", it.y - r + it.len * fr, t - 1);
      w.put(gh, "points", ellipse(r, r), t - 1);
      w.put(gh, "opacity", p.trail.opacity, when, 3, "out");
    }
  }
  if (p.level && items.length > 1) {
    const x0 = Math.min(...items.map((i) => i.x - i.d / 2));
    const x1 = Math.max(...items.map((i) => i.x + i.d / 2));
    w.put(p.level.id, "points", [x0, 0, x1, 0], t - 1);
    w.put(p.level.id, "y", items[0]!.y, t - 1);
    w.put(p.level.id, "opacity", p.level.opacity, t, 4, "out");
    w.put(p.level.id, "y", items[0]!.y + items[0]!.len, t, frames, "in");
  }
  return t + frames;
}

/**
 * Plays the fall at the chosen speed, then, when asked, puts the things back where they hung and plays it again at the
 * replay speed. Returns the frame the last landing happens and the frames of each pass.
 */
export function playFall(w: Writer, items: Faller[], t0: number, p: FallParams) {
  const first = Math.max(1, Math.round(p.realFrames / p.speed));
  let land = drop(w, items, t0, first, p, !p.replay);
  const passes = [first];
  if (p.replay) {
    const t1 = land + p.squash.frames + p.squash.settle + p.replay.pause;
    for (const it of items) w.put(it.id, "y", it.y, t1, 1, "step");
    if (p.level && items.length > 1) w.put(p.level.id, "opacity", 0, t1, 1, "step");
    const second = Math.max(1, Math.round(p.realFrames / p.replay.speed));
    land = drop(w, items, t1 + 1, second, p, true);
    passes.push(second);
  }
  if (p.level && items.length > 1) w.put(p.level.id, "opacity", 0, land + p.level.holdAfter, p.level.fadeFrames, "smooth");
  for (const it of items) for (let j = 0; j < p.trail.marks; j++) w.put(`ghost.${it.id}.${j}`, "opacity", 0, Math.max(land + 1, p.trail.fadeAt), p.trail.fadeFrames, "smooth");
  return { land, passes };
}

/** The frames a fall plan takes from its start to its last landing, for timing before anything is drawn. */
export function fallPlayFrames(realFrames: number, speed: Speed, replay: { speed: Speed; pause: number } | undefined, settle: number) {
  const first = Math.max(1, Math.round(realFrames / speed));
  return replay ? first + settle + replay.pause + 1 + Math.max(1, Math.round(realFrames / replay.speed)) : first;
}
