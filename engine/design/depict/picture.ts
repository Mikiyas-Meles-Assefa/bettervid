// Tiers 3 and 4: a real picture (the user's own, or one the picture hunter found) with parts from its PartCard. The same
// interface as a drawn thing: states that crop and zoom to a part, mark a part, tint a part (through its SAM mask when
// there is one, else its box), dim the rest.
import type { NodeSpec, Props, Theme } from "../../core/types.ts";
import type { PartCard } from "../types.ts";
import { makeDepiction, type KindDef } from "./make.ts";
import { flat, roundRect } from "./geom.ts";
import type { PropSpec } from "./spec.ts";
import type { DepictLook, Depiction, Part, StateDef, StateMap, VerbDef } from "./types.ts";

type Box4 = [number, number, number, number];

export function pictureDepiction(id: string, card: PartCard, src: string, theme: Theme, look: DepictLook, opts: { tier: 3 | 4; masks?: Record<string, string>; spec?: Partial<PropSpec> } = { tier: 3 }): Depiction {
  const [iw, ih] = card.size ?? [1000, 1000];
  const W = iw >= ih ? 1000 : (1000 * iw) / ih;
  const H = ih >= iw ? 1000 : (1000 * ih) / iw;
  const names = Object.keys(card.parts).filter((n) => card.parts[n]!.box);
  const boxOf = (name: string): Box4 => (name && card.parts[name]?.box ? (card.parts[name]!.box as Box4) : [0, 0, 1, 1]);
  // The view: the part's box grown to the frame's shape (so the picture is never stretched) and kept inside the picture.
  const viewOf = (name: string): Box4 => {
    const [x0, y0, x1, y1] = boxOf(name);
    let [w, h] = [x1 - x0, y1 - y0];
    const want = W / H / (iw / ih); // the frame's aspect in picture fractions
    if (w / h < want) w = h * want;
    else h = w / want;
    const s = 1 / Math.max(1, w, h);
    [w, h] = [Math.min(1, w * s), Math.min(1, h * s)];
    const cx = Math.min(1 - w / 2, Math.max(w / 2, (x0 + x1) / 2));
    const cy = Math.min(1 - h / 2, Math.max(h / 2, (y0 + y1) / 2));
    return [cx - w / 2, cy - h / 2, w, h];
  };
  // A box in picture fractions to local units under a view.
  const toLocal = (b: Box4, v: Box4): Box4 => {
    const [vx, vy, vw, vh] = v;
    const X = (fx: number) => ((fx - vx) / vw - 0.5) * W;
    const Y = (fy: number) => ((fy - vy) / vh - 1) * H;
    return [X(b[0]), Y(b[1]), X(b[2]), Y(b[3])];
  };
  const L = look.line.value;
  const def: KindDef = {
    name: "picture",
    about: "a real picture with parts",
    params: {},
    colors: {},
    build: () => {
      const nodes: NodeSpec[] = [];
      const add = (nid: string, kind: NodeSpec["kind"], props: Props) => nodes.push({ id: nid, kind, parent: `${id}.body`, props });
      add(`${id}.img`, "image", { src, x: 0, y: -H / 2, w: W, h: H, srcW: iw, srcH: ih, fit: "fill" });
      add(`${id}.dim`, "path", { points: flat(roundRect(-W / 2, -H, W / 2, 0, 0)), closed: 1, fill: "#000000", stroke: "none", opacity: 0 });
      const states: Record<string, StateDef> = {
        view: { type: "text", about: `the part the picture is zoomed to (empty for the whole picture): ${names.join(", ")}`, initial: "" },
        dim: { type: "number", about: "a dark veil over the picture, under the rings, 0 to 1", min: 0, max: 1, initial: 0 },
      };
      const parts: Record<string, Part> = { whole: { node: `${id}.img`, anchor: [0, -H / 2], box: [-W / 2, -H, W / 2, 0], about: card.about } };
      for (const n of names) {
        const lb = toLocal(boxOf(n), [0, 0, 1, 1]);
        parts[n] = { node: `${id}.mark.${n}`, anchor: [(lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2], box: lb, about: card.parts[n]!.about };
        add(`${id}.tint.${n}`, "path", { closed: 1, stroke: "none", blend: "color", ...(opts.masks?.[n] ? { mask: `${id}.mask.${n}`, maskMode: "luminance" } : {}) });
        if (opts.masks?.[n]) add(`${id}.mask.${n}`, "image", { src: opts.masks[n]!, x: 0, y: -H / 2, w: W, h: H, fit: "fill" });
        add(`${id}.mark.${n}`, "path", { closed: 1, fill: "none", stroke: "accent", strokeWidth: L });
        states[`mark.${n}`] = { type: "number", about: `a ring around the ${n}, 0 to 1`, min: 0, max: 1, initial: 0 };
        states[`tint.${n}`] = { type: "color", about: `the color laid over the ${n}`, initial: "#ffffff" };
        states[`tintAmount.${n}`] = { type: "number", about: `how strongly the ${n} takes the tint`, min: 0, max: 1, initial: 0 };
      }
      const verbs: Record<string, VerbDef> = {
        "zooms to": { about: "the picture closes in on a part", sets: [{ state: "view", arg: true }], arg: "text" },
        "zooms out": { about: "shows the whole picture", sets: [{ state: "view", value: "" }] },
        marks: { about: "rings a part", sets: [{ state: "mark.{arg}", value: 1 }], arg: "text" },
        circles: { about: "rings a part", sets: [{ state: "mark.{arg}", value: 1 }], arg: "text" },
        unmarks: { about: "takes the ring off a part", sets: [{ state: "mark.{arg}", value: 0 }], arg: "text" },
        highlights: { about: "rings a part and veils the picture under it", sets: [{ state: "mark.{arg}", value: 1 }, { state: "dim", value: 0.45 }], arg: "text" },
      };
      const draw = (s: StateMap): Record<string, Props> => {
        const view = String(s.view ?? "");
        if (view && !card.parts[view]) throw new Error(`${id}: the picture has no part "${view}" (parts: ${names.join(", ")})`);
        const v = view ? viewOf(view) : ([0, 0, 1, 1] as Box4);
        const out: Record<string, Props> = { [`${id}.img`]: { crop: v.map((x) => Math.round(x * 10000) / 10000) }, [`${id}.dim`]: { opacity: Number(s.dim) } };
        for (const n of names) {
          const [x0, y0, x1, y1] = toLocal(boxOf(n), v);
          const pad = L * 1.5;
          const ring = flat(roundRect(x0 - pad, y0 - pad, x1 + pad, y1 + pad, L * 3));
          out[`${id}.mark.${n}`] = { points: ring, opacity: Number(s[`mark.${n}`]), trimEnd: Number(s[`mark.${n}`]) };
          out[`${id}.tint.${n}`] = { points: flat(roundRect(x0, y0, x1, y1, 0)), fill: String(s[`tint.${n}`]), opacity: Number(s[`tintAmount.${n}`]) };
          if (opts.masks?.[n]) {
            // The mask follows the view as the picture does.
            const [vx, vy, vw, vh] = v;
            out[`${id}.mask.${n}`] = { x: ((0.5 - vx) / vw - 0.5) * W, y: ((0.5 - vy) / vh - 1) * H, w: W / vw, h: H / vh };
          }
        }
        return out;
      };
      return { box: { w: W, h: H }, pivot: [0, -H / 2], nodes, parts, states, verbs, draw };
    },
  };
  const spec: PropSpec = { kind: "picture", label: card.name, why: `the ${opts.tier === 3 ? "user's" : "found"} picture ${card.file}`, tier: opts.tier, ...opts.spec };
  const d = makeDepiction(def, spec, theme, look, { id });
  d.tier = opts.tier;
  d.notes.push(`${card.name}: ${opts.tier === 3 ? "the user's picture" : "a found picture"} with parts ${names.join(", ") || "(none boxed)"}`);
  return d;
}
