// How many parts relate: attaching, connecting, staggering, splitting one into many and merging many into one.
import type { Behavior, Constraint, Key, MotionTools, NodeSpec, Value } from "../core/types.ts";
import { area, centroid, closeRing, isLoop, ring, slice, toFlat, wedges, type Pt } from "./geometry.ts";
import { apply, decompose, invert, mul, type Mat } from "./matrix.ts";
import { matchShapes } from "./morph.ts";
import { seeded } from "./random.ts";
import { ease, lineOf, num, str, worldAt, worldOutline } from "./util.ts";

const meta = (f: Behavior, selects = true): Behavior => Object.assign(f, { selects });

const STAGGER_ARGS = new Set(["use", "gap", "order", "seed", "from"]);

// The order parts take their turn in, as a delay rank for each. Parts may share a rank.
function ranks(tools: MotionTools, ids: string[], start: number, args: Record<string, Value>): number[] {
  const n = ids.length;
  const order = str(args.order, "index");
  const by = (score: (id: string, i: number) => number) => {
    const scores = ids.map(score);
    const sorted = [...scores].sort((a, b) => a - b);
    return scores.map((s) => sorted.indexOf(s));
  };
  switch (order) {
    case "index": return ids.map((_, i) => i);
    case "reverse": return ids.map((_, i) => n - 1 - i);
    case "center": return ids.map((_, i) => Math.round(Math.abs(i - (n - 1) / 2)));
    case "edges": return ids.map((_, i) => Math.round((n - 1) / 2 - Math.abs(i - (n - 1) / 2)));
    case "x": return by((id) => worldAt(tools, id, start)[0]);
    case "y": return by((id) => worldAt(tools, id, start)[1]);
    case "random": {
      const r = seeded(num(args.seed, 1));
      return by(() => r());
    }
    case "distance": {
      if (typeof args.from !== "string") throw new Error("stagger by distance needs `from`: a part");
      const o = worldAt(tools, args.from, start);
      const far = ids.map((id) => Math.hypot(worldAt(tools, id, start)[0] - o[0], worldAt(tools, id, start)[1] - o[1]));
      const most = Math.max(...far) || 1;
      return far.map((d) => (d / most) * (n - 1));
    }
    default: throw new Error(`unknown stagger order ${order}`);
  }
}

// Fades one thing out and another in over the last frames of a move.
const swapKeys = (at: number, blendFrames: number, from: number, to: number): Key[] => [{ at: at - blendFrames, value: from }, { at, value: to, ease: "smooth" }];

// Slices of `whole` for each part, in the order they sit around it, sized by how big each part is.
function slicesFor(whole: Pt[], parts: { id: string; line: Pt[] }[]) {
  const edge = ring(whole);
  const c = centroid(edge);
  const wind = area(edge) >= 0 ? 1 : -1;
  const first = Math.atan2(edge[0]![1] - c[1], edge[0]![0] - c[0]);
  const turn = (p: Pt) => {
    const a = (wind * (Math.atan2(p[1] - c[1], p[0] - c[0]) - first)) % (Math.PI * 2);
    return a < 0 ? a + Math.PI * 2 : a;
  };
  const sized = parts.map((p) => ({ ...p, angle: turn(centroid(ring(p.line))), size: Math.max(1, Math.abs(area(ring(p.line)))) })).sort((a, b) => a.angle - b.angle);
  // Start the first slice so that it is centred on the first part.
  const total = sized.reduce((s, p) => s + p.size, 0);
  const phase = ((sized[0]!.angle / (Math.PI * 2) - sized[0]!.size / total / 2) % 1 + 1) % 1;
  const cut = wedges(edge, sized.map((p) => p.size), phase);
  return sized.map((p, i) => ({ id: p.id, wedge: cut[i]! }));
}

export const PARTS: Record<string, Behavior> = {
  // Follows another part wherever it goes, across the tree, without changing the tree. Its own moves still apply on top.
  // args: to, frames (until release; otherwise for the rest of the scene), lag (frames behind, for follow-through),
  // x, y (offset from `to`; otherwise it keeps the gap it had), rotate (turn with it), scale (grow with it)
  attach: ({ target, start, args, ctx, now, tools }) => {
    if (typeof args.to !== "string") throw new Error("attach needs `to`: a part");
    const to = args.to;
    if (!tools.has(to)) throw new Error(`nothing called ${to}`);
    const lag = num(args.lag, 0);
    const end = args.frames === undefined ? ctx.frames : start + num(args.frames, 0);
    const parent = tools.parent(target);
    const [rotates, scales] = [!!args.rotate, !!args.scale];
    const [x0, y0] = [num(now("x"), 0), num(now("y"), 0)];
    const props = ["x", "y", ...(rotates ? ["rotate"] : []), ...(scales ? ["scaleX", "scaleY"] : [])];
    const source0 = tools.matrix(to, start) as Mat;
    const self0 = tools.matrix(target, start) as Mat;
    // The gap at the moment of attaching, held in the source's own space if it turns or scales with it, otherwise in the world.
    const fixed: Pt | undefined = args.x !== undefined || args.y !== undefined ? [num(args.x, 0), num(args.y, 0)] : undefined;
    const carried = rotates || scales;
    const hold: Mat = fixed ? [1, 0, 0, 1, fixed[0], fixed[1]] : carried ? mul(invert(source0), self0) : [1, 0, 0, 1, self0[4] - source0[4], self0[5] - source0[5]];
    const pose0 = decompose(mul(parent ? invert(tools.matrix(parent, start) as Mat) : ([1, 0, 0, 1, 0, 0] as Mat), self0));
    tools.constrain({
      target,
      props,
      start,
      end,
      solve: (f, read, own) => {
        const source = read.matrix(to, Math.max(start, f - lag)) as Mat;
        const world: Mat = carried ? mul(source, hold) : [1, 0, 0, 1, source[4] + hold[4], source[5] + hold[5]];
        const pose = decompose(parent ? mul(invert(read.matrix(parent, f) as Mat), world) : world);
        const out: Record<string, Value> = { x: pose.x + num(own("x"), x0) - x0, y: pose.y + num(own("y"), y0) - y0 };
        if (rotates) out.rotate = pose.rotate;
        if (scales) {
          out.scaleX = pose.scaleX * (fixed ? pose0.scaleX : 1);
          out.scaleY = pose.scaleY * (fixed ? pose0.scaleY : 1);
        }
        return out;
      },
    });
    return [];
  },

  // Keeps a line stretched between two parts as they move, like a graph edge between nodes.
  // args: from, to, gap (space left at each end), frames
  tether: ({ target, start, args, ctx, tools }) => {
    const [a, b] = [args.from, args.to];
    if (typeof a !== "string" || typeof b !== "string") throw new Error("tether needs `from` and `to`: two parts");
    const gap = num(args.gap, 0);
    const self = target;
    const constraint: Constraint = {
      target,
      props: ["points"],
      start,
      end: args.frames === undefined ? ctx.frames : start + num(args.frames, 0),
      solve: (f, read) => {
        const toSelf = invert(read.matrix(self, f) as Mat);
        const [ma, mb] = [read.matrix(a, f) as Mat, read.matrix(b, f) as Mat];
        const [p, q]: Pt[] = [[ma[4], ma[5]], [mb[4], mb[5]]];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        const [ux, uy] = [((q[0] - p[0]) / len) * Math.min(gap, len / 2), ((q[1] - p[1]) / len) * Math.min(gap, len / 2)];
        return { points: toFlat([apply(toSelf, [p[0] + ux, p[1] + uy]), apply(toSelf, [q[0] - ux, q[1] - uy])]) };
      },
    };
    tools.constrain(constraint);
    return [];
  },

  // Runs any behavior across many parts, each a beat after the last.
  // args: use, gap, order (index, reverse, center, edges, x, y, distance, random), from, seed, then anything for `use`
  stagger: meta(({ target, start, args, tools }) => {
    if (typeof args.use !== "string") throw new Error("stagger needs `use`: a behavior");
    const ids = tools.select(target);
    const gap = num(args.gap, 4);
    const rest = Object.fromEntries(Object.entries(args).filter(([k]) => !STAGGER_ARGS.has(k)));
    ranks(tools, ids, start, args).forEach((rank, i) => tools.run(args.use as string, ids[i]!, start + Math.round(rank * gap), rest));
    return [];
  }),

  // Breaks a path into new parts called `<target>.part.<n>`, or reshapes it into parts that already exist.
  // args: parts (how many) and spread (how far they fly), turn (seeded tumble in degrees), seed; or into (a pattern of
  // existing parts, hidden until they arrive). Also frames, ease. A filled shape cuts into slices, a line into lengths.
  split: ({ target, start, args, ctx, tools }) => {
    const frames = num(args.frames, ctx.theme.moveFrames * 2);
    const curve = ease(args.ease, typeof args.into === "string" ? "smooth" : "overshoot");
    const end = start + frames;
    const line = lineOf(tools, target, start);
    const loop = isLoop(line) || !!tools.value(target, "closed", start);
    const random = seeded(num(args.seed, 1));
    const base = { ...tools.props(target) };
    const shown = num(tools.value(target, "opacity", start), 1);
    const name = (i: number) => `${target}.part.${i}`;
    const make = (pts: Pt[], i: number) => {
      const spec: NodeSpec = { id: name(i), kind: "path", parent: tools.parent(target), props: { ...base, x: tools.value(target, "x", start)!, y: tools.value(target, "y", start)!, rotate: tools.value(target, "rotate", start)!, scaleX: tools.value(target, "scaleX", start)!, scaleY: tools.value(target, "scaleY", start)!, points: toFlat(pts), closed: loop ? 1 : 0, smooth: 0, opacity: 0, drawn: 1 } };
      tools.spawn(spec, { before: target });
      tools.write({ target: name(i), prop: "opacity", keys: [{ at: start, value: shown }] });
    };
    tools.write({ target, prop: "opacity", keys: [{ at: start, value: 0 }] });

    if (typeof args.into === "string") {
      const ids = tools.select(args.into);
      const self = tools.matrix(target, start) as Mat;
      const toSelf = invert(self);
      const goals = ids.map((id) => ({ id, line: worldOutline(tools, id, start).map((p) => apply(toSelf, p)) }));
      const cut = loop ? slicesFor(line, goals) : goals.map((g, i) => ({ id: g.id, wedge: slice(line, i / goals.length, (i + 1) / goals.length) }));
      const blend = Math.min(8, Math.max(1, Math.round(frames / 3)));
      cut.forEach(({ id, wedge }, i) => {
        const goal = goals.find((g) => g.id === id)!.line;
        make(wedge, i);
        const m = matchShapes(toFlat(wedge), toFlat(goal));
        tools.write({ target: name(i), prop: "points", keys: [{ at: start, value: m.a }, { at: end, value: m.b, ease: curve }] });
        tools.write({ target: name(i), prop: "opacity", keys: swapKeys(end + blend, blend, shown, 0) });
        tools.write({ target: id, prop: "opacity", keys: [{ at: 0, value: 0 }, ...swapKeys(end + blend, blend, 0, 1)] });
      });
      return [];
    }

    const n = Math.max(2, num(args.parts, 4));
    const sizes = Array.from({ length: n }, () => 0.75 + random() * 0.5);
    const sum = sizes.reduce((s, v) => s + v, 0);
    let at = 0;
    const pieces = loop
      ? wedges(line, sizes)
      : sizes.map((size) => {
          const piece = slice(line, at, Math.min(1, at + size / sum));
          at += size / sum;
          return piece;
        });
    const spread = num(args.spread, 120);
    const tumble = num(args.turn, 0);
    const middle = loop ? centroid(ring(line)) : centroid(line);
    const worldTurn = tools.matrix(target, start) as Mat;
    const parent = tools.parent(target);
    const inParent = (parent ? mul(invert(tools.matrix(parent, start) as Mat), worldTurn) : worldTurn) as Mat;
    pieces.forEach((piece, i) => {
      make(piece, i);
      const c = centroid(ring(piece.length > 2 ? piece : closeRing(piece)));
      const [dx, dy] = [c[0] - middle[0], c[1] - middle[1]];
      const away: Pt = [inParent[0] * dx + inParent[2] * dy, inParent[1] * dx + inParent[3] * dy];
      const size = Math.hypot(away[0], away[1]) || 1;
      const [x, y] = [num(tools.value(target, "x", start), 0), num(tools.value(target, "y", start), 0)];
      tools.write({ target: name(i), prop: "x", keys: [{ at: start, value: x }, { at: end, value: x + (away[0] / size) * spread, ease: curve }] });
      tools.write({ target: name(i), prop: "y", keys: [{ at: start, value: y }, { at: end, value: y + (away[1] / size) * spread, ease: curve }] });
      const rotate = num(tools.value(target, "rotate", start), 0);
      if (tumble) tools.write({ target: name(i), prop: "rotate", keys: [{ at: start, value: rotate }, { at: end, value: rotate + (random() * 2 - 1) * tumble, ease: curve }] });
    });
    return [];
  },

  // Many parts become one. Each path reshapes into its slice of the whole; anything else travels there and shrinks away.
  // The whole stays hidden until they arrive. args: into (a part), frames, ease
  merge: meta(({ target, start, args, ctx, tools }) => {
    if (typeof args.into !== "string") throw new Error("merge needs `into`: the part they become");
    const whole = args.into;
    const ids = tools.select(target);
    const frames = num(args.frames, ctx.theme.moveFrames * 2);
    const curve = ease(args.ease, "smooth");
    const end = start + frames;
    const blend = Math.min(8, Math.max(1, Math.round(frames / 3)));
    const shape = lineOf(tools, whole, start);
    const self = tools.matrix(whole, start) as Mat;
    const toWhole = invert(self);
    const cut = slicesFor(shape, ids.map((id) => ({ id, line: worldOutline(tools, id, start).map((p) => apply(toWhole, p)) })));
    for (const { id, wedge } of cut) {
      const toPart = mul(invert(tools.matrix(id, start) as Mat), self);
      const goal = wedge.map((p) => apply(toPart, p));
      if (tools.kind(id) === "path") {
        const m = matchShapes(tools.value(id, "points", start) as number[], toFlat(goal), { smoothA: !!tools.value(id, "smooth", start) });
        tools.write({ target: id, prop: "points", keys: [{ at: start, value: m.a }, { at: end, value: m.b, ease: curve }] });
        tools.write({ target: id, prop: "smooth", keys: [{ at: start, value: 0 }] });
      } else {
        const middle = apply(self, centroid(ring(wedge)));
        const parent = tools.parent(id);
        const there = parent ? apply(invert(tools.matrix(parent, start) as Mat), middle) : middle;
        for (const [prop, value] of [["x", there[0]], ["y", there[1]], ["scaleX", 0.2], ["scaleY", 0.2]] as const) {
          tools.write({ target: id, prop, keys: [{ at: start, value: tools.value(id, prop, start)! }, { at: end, value, ease: curve }] });
        }
      }
      tools.write({ target: id, prop: "opacity", keys: swapKeys(end + blend, blend, num(tools.value(id, "opacity", start), 1), 0) });
    }
    tools.write({ target: whole, prop: "opacity", keys: [{ at: 0, value: 0 }, ...swapKeys(end + blend, blend, 0, 1)] });
    return [];
  }),
};
