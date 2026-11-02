// Motion that shows something passing through: trails, ripples, waves, wipes, counting, color spreading.
import { EASES } from "../core/ease.ts";
import type { Behavior, Key, MotionTools, NodeSpec, Value } from "../core/types.ts";
import { circle } from "../kits/shapes.ts";
import { bounds, clipLine, clipLoop, closeRing, densify, isLoop, length, ring, toFlat, walker, type Pt } from "./geometry.ts";
import { apply, invert, type Mat } from "./matrix.ts";
import { ease, lineOf, num, over, str, unique, worldAt, worldOutline } from "./util.ts";

const clamp = (t: number) => Math.max(0, Math.min(1, t));

function descendants(tools: MotionTools, id: string): string[] {
  return tools.children(id).flatMap((c) => [c, ...descendants(tools, c)]);
}

// A copy of a node and everything inside it, so a trail or echo can be made of anything.
function cloneTree(tools: MotionTools, id: string, as: string, parent: string | undefined, props: Record<string, Value>, before?: string) {
  tools.spawn({ id: as, kind: tools.kind(id), parent, props: { ...tools.props(id), ...props } } as NodeSpec, { before });
  for (const c of tools.children(id)) cloneTree(tools, c, `${as}.${c.split(".").at(-1)}`, as, {});
}

// Colors a line from one end to the other, as a copy of it drawn over the top that hands over when it is done.
function fillLine(tools: MotionTools, edge: string, start: number, frames: number, color: Value, reverse: boolean) {
  const id = unique(tools, `${edge}.spread`);
  const line = lineOf(tools, edge, start);
  const props: Record<string, Value> = { points: toFlat(reverse ? [...line].reverse() : line), stroke: color, strokeWidth: num(tools.value(edge, "strokeWidth", start), 6), opacity: 0, drawn: 0 };
  tools.spawn({ id, kind: "path", parent: edge, props });
  const end = start + Math.max(1, Math.round(frames));
  tools.write({ target: id, prop: "opacity", keys: [{ at: start, value: 1 }, { at: end + 1, value: 0, ease: "step" }] });
  tools.write({ target: id, prop: "drawn", keys: [{ at: start, value: 0 }, { at: end, value: 1, ease: "linear" }] });
  tools.write({ target: edge, prop: "stroke", keys: [{ at: end, value: color }] });
}

export const EFFECTS: Record<string, Behavior> = {
  // Leaves a wake behind a moving part: fading copies of it, or a line of where it has been.
  // args: mode ("ghost" or "line"), count, gap (frames between copies), frames, fade; for a line: length (frames), color, width
  trail: ({ target, start, args, ctx, tools }) => {
    const frames = num(args.frames, ctx.frames - start);
    const end = start + frames;
    const parent = tools.parent(target);
    if (str(args.mode, "ghost") === "line") {
      const reach = num(args.length, 30);
      const id = unique(tools, `${target}.trail`);
      const color = args.color ?? tools.value(target, "stroke", start) ?? "accent";
      tools.spawn({ id, kind: "path", parent, props: { points: [0, 0, 0, 0], smooth: 1, stroke: color, strokeWidth: num(args.width, 6), opacity: 0 } }, { before: target });
      tools.write({ target: id, prop: "opacity", keys: [{ at: start, value: num(args.fade, 0.7) }, { at: end + 12, value: 0, ease: "smooth" }] });
      const n = Math.min(24, Math.max(2, reach));
      tools.constrain({
        target: id,
        props: ["points"],
        start,
        end: end + 12,
        solve: (f, read) => {
          const back = parent ? invert(read.matrix(parent, f) as Mat) : ([1, 0, 0, 1, 0, 0] as Mat);
          const list: Pt[] = [];
          for (let i = 0; i <= n; i++) {
            const m = read.matrix(target, Math.min(end, Math.max(start, f - (i / n) * reach))) as Mat;
            list.push(apply(back, [m[4], m[5]]));
          }
          return { points: toFlat(list) };
        },
      });
      return [];
    }
    const count = num(args.count, 5);
    const gap = num(args.gap, 3);
    const fade = num(args.fade, 0.5);
    const isPath = tools.kind(target) === "path";
    for (let i = count; i >= 1; i--) {
      const id = unique(tools, `${target}.ghost.${i}`);
      cloneTree(tools, target, id, parent, { opacity: 0 }, target);
      const delay = i * gap;
      const strength = fade * (1 - (i - 1) / count);
      const props = ["x", "y", "rotate", "scaleX", "scaleY", "opacity", ...(isPath ? ["points"] : [])];
      tools.constrain({
        target: id,
        props,
        start,
        end: end + delay,
        solve: (f, read) => {
          const at = Math.max(start, f - delay);
          const out: Record<string, Value> = {};
          for (const p of props) out[p] = read.value(target, p, at)!;
          out.opacity = f >= end + delay ? 0 : num(out.opacity, 1) * strength;
          return out;
        },
      });
    }
    return [];
  },

  // Rings spreading out from a part and fading, like a drop in water.
  // args: count, gap, frames, size (final radius), color, width
  ripple: ({ target, start, args, now, tools }) => {
    const count = num(args.count, 3);
    const gap = num(args.gap, 9);
    const frames = num(args.frames, 40);
    const line = tools.kind(target) === "path" ? bounds(lineOf(tools, target, start)) : undefined;
    const r0 = Math.max(4, line ? Math.max(line.w, line.h) / 2 : 20);
    const size = num(args.size, r0 * 3);
    const width = num(args.width, 6);
    const parent = tools.parent(target);
    for (let i = 0; i < count; i++) {
      const id = unique(tools, `${target}.ripple.${i}`);
      const at = start + i * gap;
      tools.spawn({ id, kind: "path", parent, props: { x: now("x")!, y: now("y")!, points: circle(0, 0, r0), closed: 1, stroke: args.color ?? "accent", strokeWidth: width, opacity: 0 } }, { before: target });
      const grow = size / r0;
      tools.write({ target: id, prop: "opacity", keys: [{ at, value: 0.9 }, { at: at + frames, value: 0, ease: "in" }] });
      for (const prop of ["scaleX", "scaleY"]) tools.write({ target: id, prop, keys: [{ at, value: 1 }, { at: at + frames, value: grow, ease: "out" }] });
      // Scaling a ring scales its stroke too, so this undoes that frame by frame and the line stays one width on screen.
      tools.write({ target: id, prop: "strokeWidth", keys: over(at, frames, (t) => width / (1 + (grow - 1) * EASES.out(t))) });
    }
    return [];
  },

  // A wave. Across many parts it travels outward from a source, each part moved in turn. On one path, a bump runs along the line itself.
  // args: from (a part) or x, y; prop (a number, or "scale"), size, speed (units a frame), cycles, period (frames)
  wave: Object.assign(
    (({ target, start, args, ctx, tools }) => {
      const size = num(args.size, 30);
      if (!target.includes("*")) {
        const original = tools.value(target, "points", start);
        const frames = num(args.frames, 45);
        const drawn = lineOf(tools, target, start);
        const line = densify(drawn, length(drawn) / 120, false);
        const walk = walker(line);
        const total = line.length - 1;
        const width = num(args.width, 0.14);
        const curve = EASES[ease(args.ease, "linear")];
        const normals = line.map((_, i): Pt => {
          const r = (walk(i / total).angle * Math.PI) / 180;
          return [-Math.sin(r), Math.cos(r)];
        });
        const keys: Key[] = over(start, frames, (t) => {
          const head = -width * 3 + curve(t) * (1 + width * 6);
          return toFlat(line.map((p, i): Pt => {
            const d = (i / total - head) / width;
            const bump = size * Math.exp(-d * d);
            return [p[0] + normals[i]![0] * bump, p[1] + normals[i]![1] * bump];
          }));
        });
        keys.push({ at: start + frames + 1, value: original!, ease: "step" });
        return [{ target, prop: "points", keys }];
      }
      const ids = tools.select(target);
      const origin: Pt = typeof args.from === "string" ? worldAt(tools, args.from, start) : [num(args.x, ctx.width / 2), num(args.y, ctx.height / 2)];
      const speed = num(args.speed, 12);
      const cycles = num(args.cycles, 1.5);
      const period = num(args.period, 24);
      const prop = str(args.prop, "y");
      const frames = Math.round(cycles * period);
      for (const id of ids) {
        const p = worldAt(tools, id, start);
        const at = start + Math.round(Math.hypot(p[0] - origin[0], p[1] - origin[1]) / speed);
        const swing = (t: number) => Math.exp(-2 * t) * Math.sin(2 * Math.PI * cycles * t);
        if (prop === "scale") {
          for (const q of ["scaleX", "scaleY"]) tools.write({ target: id, prop: q, blend: "multiply", keys: over(at, frames, (t) => (t === 1 ? 1 : 1 + size * swing(t))) });
        } else tools.write({ target: id, prop, blend: "add", keys: over(at, frames, (t) => (t === 1 ? 0 : size * swing(t))) });
      }
      return [];
    }) as Behavior,
    { selects: true },
  ),

  // A hard edge sweeps across and reveals (or, with out, removes) a shape, or everything in a group. Paths are truly cut.
  // Text and images have no cut yet, so they fade in as the edge crosses them. args: angle (the way it sweeps), frames, ease, out
  wipe: ({ target, start, args, ctx, tools }) => {
    const frames = num(args.frames, ctx.theme.moveFrames * 2);
    const curve = EASES[ease(args.ease, "smooth")];
    const out = !!args.out;
    const angle = (num(args.angle, 0) * Math.PI) / 180;
    const [nx, ny] = [Math.cos(angle), Math.sin(angle)];
    const leaves = [target, ...descendants(tools, target)].filter((id) => tools.kind(id) !== "group");
    if (!leaves.length) throw new Error(`nothing to wipe in ${target}`);
    const spans = new Map(leaves.map((id) => {
      const along = worldOutline(tools, id, start).map((p) => p[0] * nx + p[1] * ny);
      return [id, [Math.min(...along), Math.max(...along)] as const];
    }));
    const lo = Math.min(...[...spans.values()].map((s) => s[0]));
    const hi = Math.max(...[...spans.values()].map((s) => s[1]));
    const edge = (t: number) => lo - 1 + (hi - lo + 2) * curve(t);
    const hideEarly: Key[] = out ? [] : [{ at: 0, value: 0 }];
    for (const id of leaves) {
      if (tools.kind(id) !== "path") {
        const [a, b] = spans.get(id)!;
        const shown = (t: number) => {
          const seen = clamp((edge(t) - a) / (b - a || 1));
          return out ? 1 - seen : seen;
        };
        tools.write({ target: id, prop: "opacity", blend: "multiply", keys: [...hideEarly, ...over(start, frames, (t) => (t === 1 ? (out ? 0 : 1) : shown(t)))] });
        continue;
      }
      const m = tools.matrix(id, start) as Mat;
      const back = invert(m);
      const line = lineOf(tools, id, start);
      const loop = isLoop(line) || !!tools.value(id, "closed", start);
      const world = (loop ? ring(line) : line).map((p) => apply(m, p));
      const n = Math.max(1, Math.round(frames));
      const cuts: Pt[][] = [];
      for (let i = 0; i <= n; i++) {
        const d = edge(i / n);
        const part = out ? (loop ? clipLoop(world, -nx, -ny, -d) : clipLine(world, -nx, -ny, -d)) : loop ? clipLoop(world, nx, ny, d) : clipLine(world, nx, ny, d);
        const local = part.map((p) => apply(back, p));
        cuts.push(loop && local.length ? closeRing(local) : local);
      }
      // Every frame gets the same number of points, as blending lists of different lengths would disturb the corners.
      const most = Math.max(2, ...cuts.map((c) => c.length));
      const rest = line[0]!;
      const even = cuts.map((c) => toFlat([...c, ...Array.from({ length: most - c.length }, () => c.at(-1) ?? rest)]));
      const keys: Key[] = even.map((value, i) => ({ at: start + i, value, ease: "linear" as const }));
      if (!out) keys.push({ at: start + n + 1, value: tools.value(id, "points", start)!, ease: "step" });
      tools.write({ target: id, prop: "points", keys });
      tools.write({ target: id, prop: "smooth", keys: [{ at: start, value: 0 }] });
      if (!out) tools.write({ target: id, prop: "smooth", keys: [{ at: start + n + 1, value: tools.value(id, "smooth", start) ?? 0 }] });
      tools.write({ target: id, prop: "opacity", blend: "multiply", keys: [...hideEarly, ...cuts.map((c, i) => ({ at: start + i, value: c.length ? 1 : 0, ease: "step" as const }))] });
    }
    return [];
  },

  // Text appearing letter by letter. It is hidden until `start`. args: frames, ease
  type: ({ target, start, args, now }) => {
    const letters = Array.from(String(now("text") ?? ""));
    const frames = num(args.frames, Math.max(1, letters.length * 2));
    const curve = EASES[ease(args.ease, "linear")];
    const keys: Key[] = [{ at: 0, value: "" }];
    for (let i = 0; i <= frames; i++) {
      const shown = letters.slice(0, Math.round(clamp(curve(i / frames)) * letters.length)).join("");
      if (shown !== keys.at(-1)!.value) keys.push({ at: start + i, value: shown, ease: "step" });
    }
    return [{ target, prop: "text", keys }];
  },

  // A number counting to a value. The numbers come from the caller; this only animates them.
  // args: to, from (otherwise the number showing now), frames, ease, decimals, prefix, suffix, sep (group thousands)
  count: ({ target, start, args, ctx, now }) => {
    if (typeof args.to !== "number") throw new Error("count needs `to`: a number");
    const showing = parseFloat(String(now("text") ?? "").replace(/[^0-9.-]/g, ""));
    const from = num(args.from, Number.isFinite(showing) ? showing : 0);
    const frames = num(args.frames, ctx.theme.moveFrames * 3);
    const curve = EASES[ease(args.ease, "out")];
    const decimals = num(args.decimals, 0);
    const [prefix, suffix] = [str(args.prefix, ""), str(args.suffix, "")];
    const show = (v: number) => {
      const fixed = v.toFixed(decimals);
      const [whole, part] = fixed.split(".") as [string, string | undefined];
      const grouped = args.sep ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
      return `${prefix}${grouped}${part ? `.${part}` : ""}${suffix}`;
    };
    const keys: Key[] = [{ at: start, value: show(from) }];
    for (let i = 1; i <= frames; i++) {
      const text = show(i === frames ? args.to : from + (args.to - from) * curve(i / frames));
      if (text !== keys.at(-1)!.value) keys.push({ at: start + i, value: text, ease: "step" });
    }
    return [{ target, prop: "text", keys }];
  },

  // Color spreads along a line, or from one part through a whole network at a steady speed. A network is read from the
  // drawing itself: closed paths are places and open paths joining them are routes, whichever kit made them. Each
  // arrival emits an "arrive" event. args: color, speed (units a frame) or frames; through (a pattern of parts), reverse
  spread: ({ target, start, args, ctx, tools }) => {
    const color = args.color ?? "accent";
    if (typeof args.through !== "string") {
      const len = length(lineOf(tools, target, start));
      fillLine(tools, target, start, num(args.frames, len / num(args.speed, 18)), color, !!args.reverse);
      return [];
    }
    const ids = tools.select(args.through);
    const isPlace = (id: string) => {
      if (tools.kind(id) !== "path") return false;
      return isLoop(lineOf(tools, id, start)) || !!tools.value(id, "closed", start);
    };
    const places = ids.filter(isPlace);
    if (!places.includes(target)) throw new Error(`spread starts from a closed shape in the network, and ${target} is not one`);
    const routes = ids.filter((id) => tools.kind(id) === "path" && !isPlace(id));
    const spots = new Map(places.map((id) => {
      const b = bounds(worldOutline(tools, id, start));
      return [id, { x: b.cx, y: b.cy, r: Math.max(b.w, b.h) / 2 }];
    }));
    const closest = (p: Pt) => {
      let best: string | undefined;
      let far = Infinity;
      for (const [id, s] of spots) {
        const d = Math.hypot(p[0] - s.x, p[1] - s.y);
        if (d < s.r * 1.5 + 8 && d < far) [best, far] = [id, d];
      }
      return best;
    };
    const links = routes.flatMap((id) => {
      const line = worldOutline(tools, id, start);
      const [a, b] = [closest(line[0]!), closest(line.at(-1)!)];
      return a && b && a !== b ? [{ id, a, b, len: length(line) }] : [];
    });
    // Arrival distances, by the real length of each route.
    const reach = new Map<string, number>([[target, 0]]);
    const left = new Set(places);
    while (left.size) {
      let next: string | undefined;
      for (const id of left) if (reach.has(id) && (next === undefined || reach.get(id)! < reach.get(next)!)) next = id;
      if (next === undefined) break;
      left.delete(next);
      for (const l of links) {
        const other = l.a === next ? l.b : l.b === next ? l.a : undefined;
        if (other && reach.get(next)! + l.len < (reach.get(other) ?? Infinity)) reach.set(other, reach.get(next)! + l.len);
      }
    }
    const furthest = Math.max(...reach.values(), 1);
    const speed = args.frames !== undefined ? furthest / num(args.frames, 1) : num(args.speed, 18);
    const arrive = (d: number) => start + Math.round(d / speed);
    const fade = Math.max(2, ctx.theme.moveFrames / 2);
    for (const [id, d] of reach) {
      const at = arrive(d);
      const fill = tools.value(id, "fill", at) ?? color;
      tools.write({ target: id, prop: "fill", keys: [{ at, value: fill }, { at: at + fade, value: color, ease: "smooth" }] });
      tools.emit({ name: "arrive", at, data: { target: id } });
    }
    for (const l of links) {
      const [da, db] = [reach.get(l.a), reach.get(l.b)];
      if (da === undefined && db === undefined) continue;
      const fromA = db === undefined || (da !== undefined && da <= db);
      fillLine(tools, l.id, arrive(fromA ? da! : db!), l.len / speed, color, !fromA);
    }
    return [];
  },
};
