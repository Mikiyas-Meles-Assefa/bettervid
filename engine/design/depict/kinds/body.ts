// Bodies: rigid things by shape (a sphere, a block, a cylinder, or any outline), at their real size, with surface marks
// (seams, bands, stripes, spots, holes, any lines), a color, and states for cracking and melting. Where they are, their
// angle and how they fall come from the pose every depiction has.
import type { NodeSpec, Props } from "../../../core/types.ts";
import type { KindDef } from "../make.ts";
import { clamp, ellipse, flat, isHex, lerp, mixHex, resample, roundRect, spline, spread } from "../geom.ts";
import { sizeCm } from "../spec.ts";
import type { Part, Pt, StateDef, StateMap, VerbDef } from "../types.ts";

type Mark = { kind: "seam" | "band" | "stripes" | "spots" | "holes" | "lines"; color: string; n?: number; width?: number; size?: number; lines?: Pt[][] };
const N = 72; // points on every outline, so any shape morphs into any other (a melt, a squash)

export const body: KindDef = {
  name: "body",
  about: "a solid thing you see whole, at its real size: spheres, planets, fruit, stones, blocks, boxes, bricks, cans, coins, pucks, drops of a solid; any rigid thing by its outline",
  forms: { sphere: "a ball or any round body", block: "a box or brick, with an optional top face for depth", cylinder: "an upright cylinder: a can, a log end on, a battery", outline: "any other rigid shape, from `outline`" },
  params: {
    outline: "for form outline: points [x, y] tracing the shape, each 0 to 1 of the box (x from the left, y from the top); a smooth curve passes through them",
    depth: "for block and cylinder: how much of the top shows, as a share of the width (0 for a flat front view)",
    corner: "for block: corner rounding as a share of the width",
    marks: "surface marks: [{kind: seam | band | stripes | spots | holes | lines, color (a name in colors), n (how many), width or size (share of the width), lines (for kind lines: point lists, 0 to 1 of the box)}]",
  },
  colors: { body: "the main color of the surface (a fact: a lemon is yellow)", "<mark colors>": "the color of each mark", light: "light around it when lit", "<other names>": "colors it can turn" },
  required: ["outline:outline"],
  build(c) {
    const { id, L } = c;
    const form = c.spec.form ?? "sphere";
    const real = sizeCm(c.spec) ?? { w: 1, h: 1 };
    const aspect = form === "sphere" ? 1 : real.w / real.h;
    const W = aspect >= 1 ? 1000 : 1000 * aspect;
    const H = aspect >= 1 ? 1000 / aspect : 1000;
    const R = Math.min(W, H) / 2;
    const base = c.col("body") ?? "accent";
    const shade = c.look.shade.value;
    const shine = c.look.shine.value;
    const depth = clamp(c.param<number>("depth") ?? 0, 0, 0.6) * W;

    // The silhouette, and the faces that give it depth.
    let shape: Pt[];
    const faces: { id: string; pts: Pt[]; tone: number }[] = [];
    if (form === "sphere") shape = ellipse(0, -R, R, R, N);
    else if (form === "block") {
      const dx = depth * 0.6;
      const dy = depth * 0.45;
      const cr = Math.min(clamp(c.param<number>("corner") ?? 0, 0, 0.3) * W, depth > 0 ? L : Infinity); // faces meet the front at its corners
      shape = resample(roundRect(-W / 2, -H + dy, W / 2 - dx, 0, cr), N, true);
      if (depth > 0) {
        faces.push({ id: "top", pts: [[-W / 2, -H + dy], [-W / 2 + dx, -H], [W / 2, -H], [W / 2 - dx, -H + dy]], tone: 0.22 });
        faces.push({ id: "side", pts: [[W / 2 - dx, -H + dy], [W / 2, -H], [W / 2, -dy], [W / 2 - dx, 0]], tone: -0.25 });
      }
    } else if (form === "cylinder") {
      const ry = Math.max(depth * 0.5, 0.0001);
      const side: Pt[] = [[-W / 2, -H + ry], ...ellipse(0, -ry, W / 2, ry, 24, Math.PI * 1.5, Math.PI * 0.5).reverse(), [W / 2, -H + ry]];
      shape = resample([...side, ...ellipse(0, -H + ry, W / 2, ry, 24, Math.PI * 0.5, -Math.PI * 0.5)], N, true);
      if (depth > 0) faces.push({ id: "top", pts: ellipse(0, -H + ry, W / 2, ry, 36), tone: 0.2 });
    } else {
      const pts = (c.param<Pt[]>("outline") ?? []).map(([x, y]) => [(x - 0.5) * W, (y - 1) * H] as Pt);
      shape = resample(spline(pts, true, 10), N, true);
    }
    const tone = (k: number) => (isHex(base) ? mixHex(base, k > 0 ? "#ffffff" : "#000000", Math.abs(k) * shade) : base);
    const paint = (col: string) => (shade > 0 && isHex(col) ? (form === "sphere" ? `radial(0.36, 0.3, 0.78, ${mixHex(col, "#ffffff", 0.28 * shade)} 0, ${col} 0.5, ${mixHex(col, "#000000", 0.32 * shade)} 1)` : `linear(0, ${col} 0, ${mixHex(col, "#000000", 0.14 * shade)} 1)`) : col);

    const nodes: NodeSpec[] = [];
    const add = (nid: string, kind: "group" | "path", props: Props, parent = `${id}.body`) => nodes.push({ id: nid, kind, parent, props });
    add(`${id}.shape`, "path", { closed: 1, stroke: "ink", strokeWidth: L, lineJoin: "round" });
    for (const f of faces) add(`${id}.face.${f.id}`, "path", { points: flat(f.pts), closed: 1, fill: tone(f.tone), stroke: "ink", strokeWidth: L, lineJoin: "round" });
    // Marks are clipped to the silhouette, so they wrap the surface and never spill.
    add(`${id}.marks`, "group", { clip: flat(shape) });
    const marks = c.param<Mark[]>("marks") ?? [];
    const markCol = (m: Mark) => c.col(m.color) ?? (isHex(m.color) ? m.color : "ink");
    const cy = -H / 2 + (form === "block" ? depth * 0.22 : 0);
    marks.forEach((m, mi) => {
      const col = markCol(m);
      const w = (m.width ?? 0.04) * W;
      const key = `${id}.mark.${mi}`;
      if (m.kind === "seam") {
        const seam = (sx: number) => Array.from({ length: 25 }, (_, i) => {
          const t = (i / 24) * Math.PI - Math.PI / 2;
          return [sx * R * (0.62 - 0.36 * Math.cos(t)), cy + R * 1.02 * Math.sin(t)] as Pt;
        });
        add(`${key}.a`, "path", { points: flat(seam(-1)), stroke: col, strokeWidth: w, fill: "none", lineCap: "round" }, `${id}.marks`);
        add(`${key}.b`, "path", { points: flat(seam(1)), stroke: col, strokeWidth: w, fill: "none", lineCap: "round" }, `${id}.marks`);
      } else if (m.kind === "band") {
        const bw = (m.width ?? 0.18) * H;
        const edge = (dy: number, dir: 1 | -1) => Array.from({ length: 17 }, (_, i) => {
          const u = dir > 0 ? i / 16 : 1 - i / 16;
          const x = lerp(-W / 2, W / 2, u);
          return [x, cy + dy + (form === "sphere" ? R * 0.12 * Math.sqrt(Math.max(0, 1 - (x / R) ** 2)) : 0)] as Pt;
        });
        add(key, "path", { points: flat([...edge(-bw / 2, 1), ...edge(bw / 2, -1)]), closed: 1, fill: col, stroke: "none" }, `${id}.marks`);
      } else if (m.kind === "stripes") {
        const n = Math.max(1, m.n ?? 2);
        for (let i = 0; i < n; i++) {
          const phi = ((i + 0.5) / n - 0.5) * Math.PI;
          const pts = Array.from({ length: 25 }, (_, j) => {
            const y = lerp(-R, R, j / 24);
            return [R * Math.sin(phi) * Math.sqrt(Math.max(0, 1 - (y / R) ** 2)), cy + y] as Pt;
          });
          add(`${key}.${i}`, "path", { points: flat(pts), stroke: col, strokeWidth: w, fill: "none" }, `${id}.marks`);
        }
      } else if (m.kind === "spots" || m.kind === "holes") {
        const n = Math.max(1, m.n ?? (m.kind === "holes" ? 3 : 6));
        const size = (m.size ?? (m.kind === "holes" ? 0.1 : 0.08)) * W;
        const at: Pt[] = m.kind === "holes" ? Array.from({ length: n }, (_, i) => [R * (0.12 + 0.2 * Math.cos(i * 2.1)), cy - R * (0.42 + 0.16 * Math.sin(i * 2.1))] as Pt) : spread(n, mi).map(([u, v]) => [(u - 0.5) * W * 0.8, cy + (v - 0.5) * H * 0.8] as Pt);
        at.forEach(([x, y], i) => add(`${key}.${i}`, "path", { points: flat(ellipse(x, y, size / 2, undefined, 18)), closed: 1, fill: m.kind === "holes" ? mixHex(isHex(col) ? col : "#000000", "#000000", 0.6) : col, stroke: "none" }, `${id}.marks`));
      } else if (m.kind === "lines") {
        (m.lines ?? []).forEach((ln, i) => add(`${key}.${i}`, "path", { points: flat(spline(ln.map(([x, y]) => [(x - 0.5) * W, (y - 1) * H] as Pt), false, 8)), stroke: col, strokeWidth: w, fill: "none", lineCap: "round" }, `${id}.marks`));
      }
    });
    if (shine > 0 && form !== "outline") {
      // A sphere's highlight is an ellipse tipped about its own center (upper left of the body), well inside the outline;
      // tipped about the body's origin it would swing out past the left edge and show as a notch in the clip.
      if (form === "sphere") add(`${id}.shine`, "path", { x: -R * 0.36, y: -R * 1.42, rotate: -30, points: flat(ellipse(0, 0, R * 0.2, R * 0.12, 20)), closed: 1, fill: "#ffffff", stroke: "none", opacity: 0.38 * shine }, `${id}.marks`);
      else add(`${id}.shine`, "path", { points: flat([[-W / 2 + W * 0.1, -H * 0.82], [-W / 2 + W * 0.1, -H * 0.32]] as Pt[]), stroke: "#ffffff", strokeWidth: L * 1.2, fill: "none", opacity: 0.3 * shine }, `${id}.marks`);
    }
    // A crack runs from the top edge into the body.
    const crack: Pt[] = Array.from({ length: 9 }, (_, i) => [W * 0.06 * (i % 2 ? 1 : -1) + W * 0.03 * i * 0.3, lerp(-H * 0.98, -H * 0.38, i / 8)] as Pt);
    add(`${id}.crack`, "path", { points: flat(crack), stroke: "ink", strokeWidth: L * 0.8, fill: "none", lineJoin: "miter", trimEnd: 0 });
    add(`${id}.edge`, "path", { closed: 1, fill: "none", stroke: "ink", strokeWidth: L, lineJoin: "round" });

    // A melted body spreads into a low puddle about as wide as it was, with the same base.
    const puddle = ellipse(0, -Math.min(W, H) * 0.06, W * 0.62, Math.min(W, H) * 0.06, N);
    const states: Record<string, StateDef> = {
      color: { type: "color", about: "the color of its surface", initial: base },
      crack: { type: "number", about: "how far a crack has run, 0 none to 1", min: 0, max: 1, initial: 0 },
      melt: { type: "number", about: "0 solid to 1 a puddle", min: 0, max: 1, initial: 0 },
    };
    const draw = (s: StateMap): Record<string, Props> => {
      const m = Number(s.melt ?? 0);
      const pts = flat(shape.map((p, i) => [lerp(p[0], puddle[i]![0], m), lerp(p[1], puddle[i]![1], m)] as Pt));
      const col = String(s.color);
      return {
        [`${id}.shape`]: { points: pts, fill: paint(col), stroke: "none" },
        [`${id}.edge`]: { points: pts },
        [`${id}.marks`]: { opacity: 1 - m, scaleY: 1 - m * 0.8 },
        [`${id}.crack`]: { trimEnd: Number(s.crack ?? 0), opacity: Number(s.crack ?? 0) > 0 ? 1 : 0 },
        ...Object.fromEntries(faces.map((f) => [`${id}.face.${f.id}`, { opacity: 1 - m, fill: isHex(col) ? mixHex(col, f.tone > 0 ? "#ffffff" : "#000000", Math.abs(f.tone) * shade) : col }])),
      };
    };
    const verbs: Record<string, VerbDef> = {
      turns: { about: "its surface changes to a color", sets: [{ state: "color", arg: true }], arg: "color" },
      "changes to": { about: "its surface changes to a color", sets: [{ state: "color", arg: true }], arg: "color" },
      cracks: { about: "a crack runs across it", sets: [{ state: "crack", value: 1 }] },
      breaks: { about: "a crack runs across it", sets: [{ state: "crack", value: 1 }] },
      melts: { about: "slumps into a puddle", sets: [{ state: "melt", arg: true, value: 1 }], arg: "number" },
      freezes: { about: "sets solid again", sets: [{ state: "melt", value: 0 }] },
      rotates: { about: "turns by an angle about its middle", sets: [{ state: "angle", arg: true, by: 1 }], arg: "angle" },
    };
    if (form === "sphere" || form === "cylinder") {
      // Rolling without slipping: it turns one radian for every radius it travels.
      verbs.rolls = { about: "rolls a distance, turning as it goes", sets: [{ state: "x", arg: true, by: 1 }, { state: "angle", arg: true, by: 180 / (Math.PI * R) }], arg: "number" };
    }
    const parts: Record<string, Part> = {
      surface: { node: `${id}.shape`, anchor: [0, -H / 2], box: [-W / 2, -H, W / 2, 0], about: "the whole body" },
      top: { node: `${id}.shape`, anchor: [0, -H], about: "its top" },
      bottom: { node: `${id}.shape`, anchor: [0, 0], about: "where it rests" },
    };
    if (marks.length) parts.marks = { node: `${id}.marks`, anchor: [0, cy], about: "its surface marks" };
    return { box: { w: W, h: H }, pivot: [0, -H / 2], nodes, parts, states, verbs, draw, anchors: { top: () => [0, -H], bottom: () => [0, 0], center: () => [0, -H / 2] } };
  },
};
