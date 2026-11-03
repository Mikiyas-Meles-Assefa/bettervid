// The user's picture with named parts: shown whole, or closed in on a part inside its own frame, with the rest dimmed
// and the part outlined. Drawn at a reference width and scaled as a group; its content group zooms and pans in a clip.
import type { Box } from "../types.ts";
import { roundedRect } from "./writer.ts";
import type { St, Triple } from "./types.ts";
import type { Writer } from "./writer.ts";

/** The reference width a picture is drawn at (local units), scaled as a group to its place. */
export const REFW = 1000;

export type Pic = { name: string; src: string; w: number; h: number; about: string; parts: Map<string, Box> };
export const refH = (p: Pic) => (REFW * p.h) / p.w;

export type ViewParams = {
  /** Parts narrower than this share of the picture are closed in on; wider ones are only outlined. */
  closeUnder: number;
  /** How much of the window the part should take when closed in on (width and height shares). */
  fillW: number;
  fillH: number;
  zoomMax: number;
  /** Zoom never beyond this for a part kept as support. */
  zoomSupportMax: number;
  /** Zooms below this are not worth the move: the whole picture stays. */
  zoomMin: number;
};

/** How far to zoom toward a part and where the window centers. */
export function viewOf(p: Pic, part: string | undefined, mode: "subject" | "support", v: ViewParams) {
  const none = { z: 1, ox: 0, oy: 0 };
  const box = part ? p.parts.get(part) : undefined;
  if (!box) return none;
  const [x0, y0, x1, y1] = box;
  const bw = x1 - x0;
  const bh = y1 - y0;
  let z = bw < v.closeUnder ? Math.min(v.zoomMax, v.fillW / bw, v.fillH / bh) : 1;
  if (mode === "support") z = Math.min(v.zoomSupportMax, z);
  if (z < v.zoomMin) return none;
  const cu = Math.min(Math.max((x0 + x1) / 2, 0.5 / z), 1 - 0.5 / z);
  const cv = Math.min(Math.max((y0 + y1) / 2, 0.5 / z), 1 - 0.5 / z);
  return { z, ox: -z * (cu - 0.5) * REFW, oy: -z * (cv - 0.5) * refH(p) };
}

/** Where a part lands on screen, given the picture's placed state. */
export function partOnScreen(st: St, p: Pic, part: string) {
  const [u0, v0, u1, v1] = p.parts.get(part)!;
  const X = (u: number) => st.x + st.s * (st.ox + st.z * (u - 0.5) * REFW);
  const Y = (v: number) => st.y + st.s * (st.oy + st.z * (v - 0.5) * refH(p));
  return { x0: X(u0), y0: Y(v0), x1: X(u1), y1: Y(v1) };
}

/** The picture's nodes: a clipped group, its content, and a dim cover and an outline for each part that is ever held. */
export function pictureNodes(w: Writer, id: string, p: Pic, parts: Iterable<string>, look: { pointer: string; pad: number; radius: number }) {
  const rh = refH(p);
  w.node(id, "group", { opacity: 0, scaleX: 0.01, scaleY: 0.01, x: w.width / 2, y: w.height / 2, clip: [-REFW / 2, -rh / 2, REFW / 2, -rh / 2, REFW / 2, rh / 2, -REFW / 2, rh / 2] });
  w.node(`${id}.c`, "group", {}, id);
  w.node(`${id}.c.img`, "image", { src: p.src, w: REFW, h: rh }, `${id}.c`);
  for (const part of parts) {
    const box = p.parts.get(part);
    if (!box) continue;
    const [u0, v0, u1, v1] = box;
    const [x0, y0, x1, y1] = [(u0 - 0.5) * REFW - look.pad, (v0 - 0.5) * rh - look.pad, (u1 - 0.5) * REFW + look.pad, (v1 - 0.5) * rh + look.pad];
    w.node(`${id}.c.dim.${part}`, "path", { d: `M-6000 -6000H6000V6000H-6000Z${roundedRect(x0, y0, x1, y1, look.radius)}`, fill: "paper", fillRule: "evenodd", stroke: "none", opacity: 0 }, `${id}.c`);
    w.node(`${id}.c.ol.${part}`, "path", { d: roundedRect(x0, y0, x1, y1, look.radius), stroke: look.pointer, strokeWidth: 8, opacity: 0, trimEnd: 0 }, `${id}.c`);
  }
}

/** Targets: placement, the view inside, and per part: the subject part dims the rest and is outlined; support parts get a quieter outline. */
export function pictureTargets(id: string, st: St, parts: Iterable<string>, p: { dim: number; supportOutline: number; outlineWidth: number }): Triple[] {
  const out: Triple[] = [[id, "x", st.x], [id, "y", st.y], [id, "scaleX", st.s], [id, "scaleY", st.s], [id, "opacity", st.op], [`${id}.c`, "x", st.ox], [`${id}.c`, "y", st.oy], [`${id}.c`, "scaleX", st.z], [`${id}.c`, "scaleY", st.z]];
  for (const part of parts) {
    const sub = st.sub === part;
    const sup = !sub && !!st.sup?.includes(part);
    out.push([`${id}.c.dim.${part}`, "opacity", sub ? p.dim : 0], [`${id}.c.ol.${part}`, "opacity", sub ? 1 : sup ? p.supportOutline : 0], [`${id}.c.ol.${part}`, "trimEnd", sub || sup ? 1 : 0], [`${id}.c.ol.${part}`, "strokeWidth", p.outlineWidth / Math.max(1e-6, st.s * st.z)]);
  }
  return out;
}
