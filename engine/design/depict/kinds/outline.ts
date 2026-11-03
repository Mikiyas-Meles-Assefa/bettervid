// Everyday objects from an outline the depicter supplies: a silhouette with named regions (each its own color, able to
// change color, light up, or swing open about a hinge) and detail lines. One kind for the long tail of things: a key,
// a kettle, a shoe, a chair, a car side on, a house, a leaf, a bottle of a particular shape.
import type { NodeSpec, Props } from "../../../core/types.ts";
import type { KindDef } from "../make.ts";
import { flat, isHex, mixHex, spline } from "../geom.ts";
import { sizeCm } from "../spec.ts";
import type { Part, Pt, StateDef, StateMap, VerbDef } from "../types.ts";

type Region = { name: string; points: [number, number][]; color?: string; smooth?: boolean; hinge?: [number, number]; opens?: number; about?: string };
type Detail = { points: [number, number][]; closed?: boolean; smooth?: boolean; width?: number; color?: string };

export const outline: KindDef = {
  name: "outline",
  about: "any everyday object drawn from its outline: tools, furniture, vehicles side on, buildings, clothing, food, kitchen things, signs; regions can change color, light up or swing open",
  params: {
    outline: "required. points [x, y] around the whole silhouette, 0 to 1 of the box (x from the left, y from the top), clockwise",
    smooth: "true to pass a smooth curve through the outline's points (false keeps corners)",
    regions: "named parts drawn over the silhouette: [{name, points (0 to 1 of the box), color (a name in colors), smooth, hinge [x, y] (for a part that swings open), opens (degrees it swings, negative the other way), about}]",
    details: "lines that make it read (a seam, a handle's edge, windows): [{points, closed, smooth, width (share of the box's width), color}]",
  },
  colors: { body: "the silhouette's color (a fact: the real object's color)", "<region colors>": "each region's color", light: "light around a lit region", "<other names>": "colors a region can turn" },
  required: ["outline"],
  build(c) {
    const { id, L } = c;
    const real = sizeCm(c.spec) ?? { w: 1, h: 1 };
    const W = real.w >= real.h ? 1000 : (1000 * real.w) / real.h;
    const H = real.h >= real.w ? 1000 : (1000 * real.h) / real.w;
    const P = ([x, y]: [number, number]): Pt => [(x - 0.5) * W, (y - 1) * H];
    const shape = (pts: [number, number][], smooth: boolean | undefined, closed: boolean) => (smooth ? spline(pts.map(P), closed, 8) : pts.map(P));
    const body = c.col("body") ?? "paper";
    const shade = c.look.shade.value;
    const nodes: NodeSpec[] = [];
    const add = (nid: string, kind: "group" | "path", props: Props, parent = `${id}.body`) => nodes.push({ id: nid, kind, parent, props });
    const line = { stroke: "ink", strokeWidth: L, lineJoin: "round", lineCap: "round" };
    const sil = shape(c.param<[number, number][]>("outline") ?? [], c.param<boolean>("smooth"), true);
    add(`${id}.shape`, "path", { ...line, points: flat(sil), closed: 1, fill: body });
    // A soft shadow side inside the silhouette gives it a little volume when the style shades.
    if (shade > 0 && isHex(body)) add(`${id}.shadow`, "path", { points: flat(sil), closed: 1, fill: `linear(0, #00000000 0.55, #00000033 1)`, stroke: "none", opacity: shade });
    const regions = c.param<Region[]>("regions") ?? [];
    const parts: Record<string, Part> = { whole: { node: `${id}.shape`, anchor: [0, -H / 2], box: [-W / 2, -H, W / 2, 0], about: c.spec.label } };
    const states: Record<string, StateDef> = { color: { type: "color", about: "the silhouette's color", initial: body } };
    const verbs: Record<string, VerbDef> = {
      turns: { about: "changes color", sets: [{ state: "color", arg: true }], arg: "color" },
    };
    for (const r of regions) {
      const pts = shape(r.points, r.smooth, true);
      const col = (r.color && c.col(r.color)) ?? (r.color && isHex(r.color) ? r.color : isHex(body) ? mixHex(body, "#000000", 0.2) : "ink");
      const g = `${id}.r.${r.name}`;
      const hinge = r.hinge ? P(r.hinge) : undefined;
      add(g, "group", hinge ? { x: hinge[0], y: hinge[1] } : {});
      const local = hinge ? pts.map(([x, y]) => [x - hinge[0], y - hinge[1]] as Pt) : pts;
      add(`${g}.shape`, "path", { ...line, points: flat(local), closed: 1, fill: col, strokeWidth: L * 0.8 }, g);
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      parts[r.name] = { node: g, anchor: [cx, cy], about: r.about ?? r.name };
      states[`color.${r.name}`] = { type: "color", about: `the ${r.name}'s color`, initial: col };
      states[`lit.${r.name}`] = { type: "number", about: `light from the ${r.name}, 0 to 1`, min: 0, max: 1, initial: 0 };
      if (hinge) states[`open.${r.name}`] = { type: "number", about: `the ${r.name} swung open, 0 shut to 1`, min: 0, max: 1, initial: 0 };
    }
    const details = c.param<Detail[]>("details") ?? [];
    details.forEach((d, i) => add(`${id}.d${i}`, "path", { ...line, points: flat(shape(d.points, d.smooth, !!d.closed)), closed: d.closed ? 1 : 0, fill: "none", strokeWidth: d.width ? d.width * W : L * 0.7, stroke: (d.color && c.col(d.color)) ?? "ink" }));
    const firstHinged = regions.find((r) => r.hinge);
    if (firstHinged) {
      verbs.opens = { about: `its ${firstHinged.name} swings open`, sets: [{ state: `open.${firstHinged.name}`, value: 1 }] };
      verbs.closes = { about: `its ${firstHinged.name} swings shut`, sets: [{ state: `open.${firstHinged.name}`, value: 0 }] };
    }
    const lightable = regions[0];
    if (lightable) {
      verbs.lights = { about: `its ${lightable.name} lights up`, sets: [{ state: `lit.${lightable.name}`, value: 1 }] };
      verbs.flashes = { about: `its ${lightable.name} flashes`, sets: [{ state: `lit.${lightable.name}`, value: 1 }], motion: "pulse" };
    }
    const draw = (s: StateMap): Record<string, Props> => {
      const out: Record<string, Props> = { [`${id}.shape`]: { fill: String(s.color) } };
      for (const r of regions) {
        const g = `${id}.r.${r.name}`;
        const lit = Number(s[`lit.${r.name}`] ?? 0);
        out[`${g}.shape`] = { fill: String(s[`color.${r.name}`]), glow: lit > 0 ? c.look.glow.value : 0, glowOpacity: lit, glowColor: c.col("light") ?? "highlight", brightness: 1 + lit * 0.35 };
        if (r.hinge) out[g] = { rotate: Number(s[`open.${r.name}`] ?? 0) * (r.opens ?? -100) };
      }
      return out;
    };
    return { box: { w: W, h: H }, pivot: [0, -H / 2], nodes, parts, states, verbs, draw };
  },
};
