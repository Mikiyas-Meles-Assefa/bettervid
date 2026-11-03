// Steadiness: things that stay on screen across changes keep their place and size, so the eye finds them again (the
// stage: what persists does not wander while words take turns around it). Each thing is read where it rests, on
// sampled frames where it is not changing; between two rests while it stays on screen, a move of its center or a change
// of its size is a jump. Reported with sizes; whether a jump is wanted (a thing that travels on purpose) is the
// agent's reading.
import type { Instrument, MeasureInput, Reading, Viewing } from "../types.ts";
import { framesOf, label, round, sampled, windowOf } from "./sample.ts";

export type SteadinessSettings = {
  perSecond: number;
  shift: number; // share of the frame's shorter side a center may move between rests before it counts as a jump
  resize: number; // relative change of size (square root of area) that counts as a jump
  backdrop: number;
  camera: boolean; // count jumps made by the camera (everything moves together) as jumps
  why?: string;
};

export const steadiness: Instrument<SteadinessSettings> = {
  name: "steadiness",
  describe:
    "Things that stay across changes keep their place and size. Each thing is read where it rests (not changing); between rests while it stays on screen, a move or resize is a jump. " +
    "Values: kept (things on screen at two or more rests), jumps (count), jumpers (things that jumped), maxShift (share of the shorter side), maxResize (relative), steadyShare (share of kept things that never jumped). " +
    "Settings: shift, resize, camera (whether a camera move counts), perSecond.",
  suggest: (v: Viewing) => ({ perSecond: 3, shift: 0.02, resize: 0.1, backdrop: 0.8, camera: false, why: `suggested for ${v.screen}: a move of 2% of the shorter side or a 10% resize is visible as a jump when the eye returns` }),
  measure(input: MeasureInput, set: SteadinessSettings): Reading {
    const s = sampled(input.scene);
    const range = windowOf(input);
    const frames = framesOf(s.fps, range, set.perSecond);
    const short = Math.min(s.W, s.H);
    const last = new Map<number, { f: number; cx: number; cy: number; size: number }>();
    const rests = new Map<number, number>();
    const jumps: { u: number; f: number; shift: number; resize: number }[] = [];
    for (const f of frames) {
      if (!set.camera && s.camera[f]) continue;
      for (const t of s.things(f, set.backdrop)) {
        const u = s.unitIndex.get(t.unit);
        if (u === undefined || s.act[u]![f]) continue;
        const now = { f, cx: (t.box.x0 + t.box.x1) / 2, cy: (t.box.y0 + t.box.y1) / 2, size: Math.sqrt(t.area) };
        const before = last.get(u);
        // Still on screen since the last rest?
        let stayed = !!before;
        if (before) for (let g = before.f; g <= f && stayed; g++) if (!s.vis[u]![g]) stayed = false;
        if (before && stayed) {
          const shift = Math.hypot(now.cx - before.cx, now.cy - before.cy) / short;
          const resize = Math.abs(now.size - before.size) / Math.max(1, before.size);
          if (shift > set.shift || resize > set.resize) jumps.push({ u, f, shift, resize });
        }
        last.set(u, now);
        rests.set(u, (rests.get(u) ?? 0) + 1);
      }
    }
    const kept = [...rests].filter(([, n]) => n >= 2).map(([u]) => u);
    const jumpers = new Set(jumps.map((j) => j.u));
    const values = {
      kept: kept.length,
      jumps: jumps.length,
      jumpers: jumpers.size,
      maxShift: round(Math.max(0, ...jumps.map((j) => j.shift))),
      maxResize: round(Math.max(0, ...jumps.map((j) => j.resize))),
      steadyShare: round(kept.length ? kept.filter((u) => !jumpers.has(u)).length / kept.length : 1),
    };
    const notes = [...jumps]
      .sort((a, b) => b.shift + b.resize - (a.shift + a.resize))
      .slice(0, 5)
      .map((j) => `${label(s, j.u)} jumps by ${(j.shift * 100).toFixed(0)}% of the shorter side${j.resize > set.resize ? ` and ${(j.resize * 100).toFixed(0)}% in size` : ""} by ${(j.f / s.fps).toFixed(1)} s`);
    return { instrument: "steadiness", values, notes };
  },
};
