// The camera is an ordinary node called "camera", so every change and behavior works on it: set it, spring it, shake it.
// It looks at (panX, panY) in the scene, at `zoom`, leaning by `tilt` degrees, and tipped back by `pitch` degrees. Pitch
// is a flat foreshortening, not true 3D. A scene that never mentions the camera does not have one.
import type { CompileContext, Constraint, Props, SceneDoc } from "../core/types.ts";
import { apply, decompose, local, mul } from "./matrix.ts";

export const CAMERA = "camera";

export const usesCamera = (doc: SceneDoc) => doc.steps.some((s) => s.set?.[CAMERA] || s.play?.some((p) => p.target === CAMERA));

export const cameraProps = (ctx: CompileContext): Props => ({ panX: ctx.width / 2, panY: ctx.height / 2, zoom: 1, tilt: 0, pitch: 0 });

export function cameraConstraint(ctx: CompileContext): Constraint {
  return {
    target: CAMERA,
    props: ["x", "y", "rotate", "scaleX", "scaleY"],
    start: 0,
    end: ctx.frames,
    solve: (frame, read) => {
      const get = (prop: string, d: number) => {
        const v = read.value(CAMERA, prop, frame);
        return typeof v === "number" ? v : d;
      };
      const zoom = get("zoom", 1);
      const lean = local({ x: 0, y: 0, rotate: get("tilt", 0), skew: 0, scaleX: zoom, scaleY: zoom * Math.max(0.05, Math.cos((get("pitch", 0) * Math.PI) / 180)) });
      const seen = apply(lean, [get("panX", ctx.width / 2), get("panY", ctx.height / 2)]);
      const m = decompose(mul([1, 0, 0, 1, ctx.width / 2 - seen[0], ctx.height / 2 - seen[1]], lean));
      return { x: m.x, y: m.y, rotate: m.rotate, scaleX: m.scaleX, scaleY: m.scaleY };
    },
  };
}
