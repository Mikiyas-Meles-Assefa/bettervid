// Simple living things as general outlines with parts: a plant (stem, leaves, a flower, roots, a pot) that grows, blooms,
// wilts and sways; a cell (membrane, nucleus, small bodies inside) that can divide. General shapes, never a species.
import type { NodeSpec, Props } from "../../../core/types.ts";
import type { KindDef } from "../make.ts";
import { clamp, ellipse, flat, isHex, lerp, mixHex, rotate, spline, spread } from "../geom.ts";
import type { Part, Pt, StateDef, StateMap, VerbDef } from "../types.ts";

export const plant: KindDef = {
  name: "plant",
  about: "a plant as a general outline: a seedling, a houseplant, a flower, a sapling; it grows, blooms, wilts and sways",
  params: {
    leaves: "how many leaves along the stem",
    flower: "true for a flower at the top",
    petals: "how many petals",
    pot: "true to stand in a pot",
    roots: "true to show roots below the ground line",
    leafShape: "leaf width as a share of its length (narrow grass 0.15, broad 0.6)",
  },
  colors: { stem: "the stem", root: "the roots", leaf: "the leaves", flower: "the petals (a fact from the material)", center: "the flower's middle", pot: "the pot", wilted: "the leaves' color when wilted" },
  build(c) {
    const { id, L } = c;
    const W = 700;
    const H = 1000;
    const potH = c.param<boolean>("pot") ? 240 : 0;
    const roots = !!c.param<boolean>("roots");
    const ground = -potH - (roots ? 160 : 0);
    const stemTop = -H + 120;
    const nLeaves = Math.max(0, Math.round(c.param<number>("leaves") ?? 4));
    const flower = !!c.param<boolean>("flower");
    const nPetals = Math.max(3, Math.round(c.param<number>("petals") ?? 6));
    const leafW = clamp(c.param<number>("leafShape") ?? 0.42, 0.08, 0.9);
    const stemCol = c.col("stem") ?? "accent";
    const leafCol = c.col("leaf") ?? stemCol;
    const nodes: NodeSpec[] = [];
    const add = (nid: string, kind: "group" | "path", props: Props, parent = `${id}.body`) => nodes.push({ id: nid, kind, parent, props });
    const line = { stroke: "ink", strokeWidth: L, lineJoin: "round", lineCap: "round" };
    if (roots) {
      for (let i = 0; i < 5; i++) {
        const a = (i - 2) * 22;
        const pts = [[0, ground], rotate([0, ground + 60], a, [0, ground]), rotate([0, ground + 130], a * 1.4, [0, ground])] as Pt[];
        add(`${id}.root${i}`, "path", { ...line, strokeWidth: L * 0.6, points: flat(spline(pts, false, 6)), fill: "none", stroke: c.col("root") ?? stemCol });
      }
      add(`${id}.ground`, "path", { ...line, points: flat([[-W / 2, ground], [W / 2, ground]]), strokeWidth: L * 0.6, fill: "none", opacity: 0.6 });
    }
    add(`${id}.stem`, "path", { ...line, fill: "none", strokeWidth: L * 1.4 });
    // Points up the stem as it grows; the stem bends as it wilts and sways.
    const N = 12;
    const stemPts = (s: StateMap): Pt[] => {
      const g = clamp(Number(s.grow));
      const wilt = clamp(Number(s.wilt));
      const top = lerp(ground - 30, stemTop, g);
      return Array.from({ length: N }, (_, i) => {
        const u = i / (N - 1);
        const y = lerp(ground, top, u);
        const bend = (wilt * 70 + Number(s.sway ?? 0)) * u * u;
        return rotate([Math.sin(u * 2.4) * 18 * g, y], bend, [0, ground]);
      });
    };
    const leafPts = (len: number): Pt[] => spline([[0, 0], [len * 0.35, -len * leafW * 0.5], [len, 0], [len * 0.35, len * leafW * 0.42]], true, 8);
    for (let i = 0; i < nLeaves; i++) {
      add(`${id}.leaf${i}`, "group", {});
      add(`${id}.leaf${i}.blade`, "path", { ...line, points: flat(leafPts(lerp(200, 140, i / Math.max(1, nLeaves)))), closed: 1, fill: leafCol, rotate: 0 }, `${id}.leaf${i}`);
      add(`${id}.leaf${i}.vein`, "path", { ...line, strokeWidth: L * 0.4, points: flat([[0, 0], [lerp(200, 140, i / Math.max(1, nLeaves)) * 0.8, 0]]), fill: "none", opacity: 0.5 }, `${id}.leaf${i}`);
    }
    if (flower) {
      add(`${id}.flower`, "group", {});
      const pc = c.col("flower") ?? "accent";
      for (let i = 0; i < nPetals; i++) add(`${id}.petal${i}`, "path", { ...line, points: flat(spline([[0, 0], [-38, -60], [0, -110], [38, -60]], true, 6)), closed: 1, fill: pc, rotate: (360 * i) / nPetals }, `${id}.flower`);
      add(`${id}.center`, "path", { ...line, points: flat(ellipse(0, 0, 34, undefined, 20)), closed: 1, fill: c.col("center") ?? "highlight" }, `${id}.flower`);
    }
    if (potH) {
      const potCol = c.col("pot") ?? "paper";
      add(`${id}.pot`, "path", { ...line, points: flat([[-W * 0.3, -potH], [W * 0.3, -potH], [W * 0.24, 0], [-W * 0.24, 0]]), closed: 1, fill: potCol });
      add(`${id}.potrim`, "path", { ...line, points: flat([[-W * 0.34, -potH - 50], [W * 0.34, -potH - 50], [W * 0.34, -potH], [-W * 0.34, -potH]]), closed: 1, fill: isHex(potCol) ? mixHex(potCol, "#ffffff", 0.12) : potCol });
    }
    const states: Record<string, StateDef> = {
      grow: { type: "number", about: "how grown, 0 a shoot to 1 full", min: 0, max: 1, initial: 1 },
      bloom: { type: "number", about: "how open the flower is, 0 a bud to 1", min: 0, max: 1, initial: flower ? 1 : 0 },
      wilt: { type: "number", about: "how wilted, 0 fresh to 1 drooping", min: 0, max: 1, initial: 0 },
      sway: { type: "angle", about: "how far the stem leans in a breeze, degrees", initial: 0 },
    };
    const draw = (s: StateMap): Record<string, Props> => {
      const pts = stemPts(s);
      const g = clamp(Number(s.grow));
      const wilt = clamp(Number(s.wilt));
      const out: Record<string, Props> = { [`${id}.stem`]: { points: flat(pts), stroke: isHex(stemCol) && wilt > 0 && c.col("wilted") ? mixHex(stemCol, c.col("wilted")!, wilt) : stemCol } };
      for (let i = 0; i < nLeaves; i++) {
        const u = 0.25 + (0.6 * i) / Math.max(1, nLeaves - (flower ? 0 : 1));
        const k = Math.min(N - 2, Math.round(u * (N - 1)));
        const p = pts[k]!;
        const side = i % 2 ? -1 : 1;
        const show = clamp((g - i / (nLeaves + 1)) * 3);
        const droop = wilt * 55;
        const leafC = c.col("wilted") && isHex(leafCol) ? mixHex(leafCol, c.col("wilted")!, wilt) : leafCol;
        out[`${id}.leaf${i}`] = { x: p[0], y: p[1], scaleX: side * show, scaleY: show, rotate: side * (-35 + droop) };
        out[`${id}.leaf${i}.blade`] = { fill: leafC };
      }
      if (flower) {
        const top = pts[N - 1]!;
        const b = clamp(Number(s.bloom));
        out[`${id}.flower`] = { x: top[0], y: top[1], scaleX: g * lerp(0.35, 1, b), scaleY: g * lerp(0.35, 1, b), rotate: wilt * 60 + Number(s.sway ?? 0), opacity: g > 0.6 ? 1 : 0 };
      }
      return out;
    };
    const parts: Record<string, Part> = { stem: { node: `${id}.stem`, anchor: [0, (ground + stemTop) / 2], about: "the stem" } };
    if (nLeaves) parts.leaves = { node: `${id}.leaf0`, anchor: [0, lerp(ground, stemTop, 0.4)], about: "the leaves" };
    if (flower) parts.flower = { node: `${id}.flower`, anchor: [0, stemTop], about: "the flower" };
    if (potH) parts.pot = { node: `${id}.pot`, anchor: [0, -potH / 2], about: "the pot" };
    if (roots) parts.roots = { node: `${id}.root2`, anchor: [0, ground + 80], about: "the roots" };
    const verbs: Record<string, VerbDef> = {
      grows: { about: "grows (to full when no share is given)", sets: [{ state: "grow", arg: true, value: 1 }], arg: "number" },
      sprouts: { about: "comes up from the ground", sets: [{ state: "grow", arg: true, value: 0.3 }], arg: "number" },
      blooms: { about: "its flower opens", sets: [{ state: "bloom", value: 1 }], needs: ["flower"] },
      opens: { about: "its flower opens", sets: [{ state: "bloom", value: 1 }], needs: ["flower"] },
      closes: { about: "its flower closes", sets: [{ state: "bloom", value: 0 }], needs: ["flower"] },
      wilts: { about: "droops", sets: [{ state: "wilt", arg: true, value: 1 }], arg: "number" },
      droops: { about: "droops", sets: [{ state: "wilt", arg: true, value: 1 }], arg: "number" },
      recovers: { about: "stands up again", sets: [{ state: "wilt", value: 0 }] },
      sways: { about: "sways in a breeze and settles", sets: [{ state: "sway", arg: true, value: 12 }], arg: "angle", motion: "shake" },
    };
    return { box: { w: W, h: H }, pivot: [0, 0], nodes, parts, states, verbs, draw };
  },
};

export const cell: KindDef = {
  name: "cell",
  about: "a cell or any soft round body with things inside: a cell, a droplet with contents, a blob, a seed in section; it can divide in two",
  params: {
    bodies: "how many small bodies float inside",
    nucleus: "true for a nucleus",
    wobble: "how uneven the outline is, 0 round to 0.2",
  },
  colors: { membrane: "the outline's fill (a fact from the material, a stain's color)", nucleus: "the nucleus", bodies: "the small bodies" },
  build(c) {
    const { id, L } = c;
    const W = 1000;
    const H = 760;
    const R = 340;
    const cy = -H / 2;
    const NP = 80;
    const wob = clamp(c.param<number>("wobble") ?? 0.06, 0, 0.25);
    const mem = c.col("membrane") ?? "accent";
    const nodes: NodeSpec[] = [];
    const add = (nid: string, kind: "group" | "path", props: Props, parent = `${id}.body`) => nodes.push({ id: nid, kind, parent, props });
    // The outline as a function of division: a circle pinching at the middle into two (a peanut, then two rounds).
    const outline = (d: number): Pt[] => Array.from({ length: NP }, (_, i) => {
      const a = (i / NP) * Math.PI * 2;
      const rr = R * (1 + wob * Math.sin(a * 3 + 1) * 0.6 + wob * Math.sin(a * 5) * 0.4);
      let x = rr * Math.sin(a) * (1 + d * 0.9);
      let y = -rr * Math.cos(a);
      const pinch = Math.exp(-((x / (R * 0.55)) ** 2));
      y *= 1 - d * 0.92 * pinch;
      x += Math.sign(x) * d * R * 0.12;
      return [x, cy + y] as Pt;
    });
    const fill = isHex(mem) ? mixHex(mem, "#ffffff", 0.55) : mem;
    add(`${id}.membrane`, "path", { closed: 1, fill, stroke: "ink", strokeWidth: L, lineJoin: "round" });
    add(`${id}.inner`, "path", { closed: 1, fill: "none", stroke: isHex(mem) ? mem : "ink", strokeWidth: L * 0.6, opacity: 0.6 });
    const nb = Math.max(0, Math.round(c.param<number>("bodies") ?? 7));
    const pos = spread(nb, 11);
    const bc = c.col("bodies") ?? (isHex(mem) ? mixHex(mem, "#000000", 0.25) : "ink");
    pos.forEach((_, i) => add(`${id}.b${i}`, "path", { points: flat(spline([[-30, 0], [0, -14], [30, 0], [0, 14]], true, 5)), closed: 1, fill: bc, stroke: "none", opacity: 0.85 }));
    const nuc = c.param<boolean>("nucleus") !== false;
    const nc = c.col("nucleus") ?? (isHex(mem) ? mixHex(mem, "#000000", 0.35) : "ink");
    if (nuc) {
      add(`${id}.nucA`, "path", { points: flat(ellipse(0, 0, R * 0.3, R * 0.27, 32)), closed: 1, fill: nc, stroke: "ink", strokeWidth: L * 0.6 });
      add(`${id}.nucB`, "path", { points: flat(ellipse(0, 0, R * 0.3, R * 0.27, 32)), closed: 1, fill: nc, stroke: "ink", strokeWidth: L * 0.6 });
    }
    const states: Record<string, StateDef> = {
      divide: { type: "number", about: "0 one cell to 1 two cells", min: 0, max: 1, initial: 0 },
      color: { type: "color", about: "the fill color", initial: fill },
    };
    const draw = (s: StateMap): Record<string, Props> => {
      const d = clamp(Number(s.divide));
      const o = outline(d);
      const inner = o.map(([x, y]) => [x * 0.94, cy + (y - cy) * 0.92] as Pt);
      const out: Record<string, Props> = { [`${id}.membrane`]: { points: flat(o), fill: String(s.color) }, [`${id}.inner`]: { points: flat(inner) } };
      const half = R * (1 + d * 0.9) * 0.55;
      pos.forEach(([u, v], i) => {
        const side = i % 2 ? -1 : 1;
        const x0 = (u - 0.5) * R * 1.3;
        const y0 = cy + (v - 0.5) * R * 1.1;
        const x = lerp(x0, side * half + (u - 0.5) * R * 0.6, d);
        const y = lerp(y0, cy + (v - 0.5) * R * 0.8 * (1 - d * 0.3), d);
        out[`${id}.b${i}`] = { x, y, rotate: u * 180 };
      });
      if (nuc) {
        out[`${id}.nucA`] = { x: -half * d, y: cy - R * 0.08 };
        out[`${id}.nucB`] = { x: half * d, y: cy - R * 0.08, opacity: d > 0.15 ? 1 : 0 };
      }
      return out;
    };
    const parts: Record<string, Part> = { membrane: { node: `${id}.membrane`, anchor: [R, cy], box: [-W / 2, -H, W / 2, 0], about: "the outline" } };
    if (nuc) parts.nucleus = { node: `${id}.nucA`, anchor: [0, cy - R * 0.08], about: "the nucleus" };
    if (nb) parts.bodies = { node: `${id}.b0`, anchor: [R * 0.4, cy], about: "the small bodies inside" };
    const verbs: Record<string, VerbDef> = {
      divides: { about: "pinches in the middle and splits into two", sets: [{ state: "divide", value: 1 }] },
      splits: { about: "splits into two", sets: [{ state: "divide", value: 1 }] },
      turns: { about: "changes color", sets: [{ state: "color", arg: true }], arg: "color" },
      pulses: { about: "swells and settles", sets: [{ state: "scale", value: 1.08 }], motion: "pulse" },
    };
    return { box: { w: W, h: H }, pivot: [0, -H / 2], nodes, parts, states, verbs, draw };
  },
};
