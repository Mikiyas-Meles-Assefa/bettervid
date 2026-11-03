// Camera moves: hold, push in over the moment, a slow drift, a cut, or a follow to a point. Zoom happens about a point
// of the frame (`at`, fractions) that stays where it is on screen.
import type { CameraPlan } from "../types.ts";
import type { Writer } from "./writer.ts";

/** The pan that keeps point (px, py) fixed on screen at zoom z. */
export const panFor = (z: number, px: number, py: number, W: number, H: number) => ({ x: px - (px - W / 2) / z, y: py - (py - H / 2) / z });

/**
 * Plays a camera plan over a moment's window [from, to). `rest` is how many frames a return to the plan's start takes.
 * Returns what it did, in words, for the notes.
 */
export function cameraMove(w: Writer, plan: CameraPlan, from: number, to: number, rest: number): string {
  const W = w.width;
  const H = w.height;
  const px = plan.at[0] * W;
  const py = plan.at[1] * H;
  const span = Math.max(1, to - from);
  const frames = Math.max(1, Math.min(span, plan.frames ?? span));
  const pan = panFor(plan.zoom, px, py, W, H);
  switch (plan.move) {
    case "cut":
      w.cam(plan.zoom, pan.x, pan.y, from, 1, "step");
      return `cut to zoom ${plan.zoom}`;
    case "push":
    case "drift": {
      if (Math.abs(w.camera.zoom - 1) > 1e-3) {
        const p1 = panFor(1, px, py, W, H);
        w.cam(1, p1.x, p1.y, from, rest, "smooth");
      }
      w.cam(plan.zoom, pan.x, pan.y, Math.max(from, to - frames), frames, "linear");
      return `${plan.move} to zoom ${plan.zoom} over ${frames} frames`;
    }
    case "follow":
      w.cam(plan.zoom, pan.x, pan.y, from, Math.min(frames, rest * 2), "smooth");
      return `follow to zoom ${plan.zoom} at ${plan.at.map((v) => v.toFixed(2)).join(", ")}`;
    default:
      if (Math.abs(w.camera.zoom - plan.zoom) > 1e-3 || Math.abs(w.camera.panX - pan.x) > 0.5 || Math.abs(w.camera.panY - pan.y) > 0.5) {
        w.cam(plan.zoom, pan.x, pan.y, from, rest, "smooth");
        return `hold at zoom ${plan.zoom}`;
      }
      return "hold";
  }
}
