// How one thing travels and carries weight: morphs, paths, arcs, physics, squash and stretch.
import { EASES } from "../core/ease.ts";
import type { Behavior, Value } from "../core/types.ts";
import { bounds, closeRing, isLoop, polyline, toFlat, toPts, walker, type Pt } from "./geometry.ts";
import { apply, invert, mul, type Mat } from "./matrix.ts";
import { matchShapes } from "./morph.ts";
import { fallAt, flights, springAt, springSettles, type Spring } from "./physics.ts";
import { noise } from "./random.ts";
import { ease, needPath, num, over, pointsArg, str } from "./util.ts";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (t: number) => Math.max(0, Math.min(1, t));
const smooth = EASES.smooth;

export const MOVES: Record<string, Behavior> = {
  // Reshapes a path into another path or point list. Matches like with like, so it never needs equal point counts.
  // args: to (a path id or points), frames, ease
  morph: ({ target, start, args, ctx, now, tools }) => {
    needPath(tools, target, "morph");
    const frames = num(args.frames, ctx.theme.moveFrames * 2);
    let goal = args.to;
    if (typeof goal === "string") {
      const other = goal;
      const m = mul(invert(tools.matrix(target, start) as Mat), tools.matrix(other, start) as Mat);
      goal = toFlat(polyline(needPath(tools, other, "morph"), !!tools.value(other, "smooth", start)).map((p) => apply(m, p)));
    }
    if (!Array.isArray(goal)) throw new Error("morph needs `to`: a path id or a list of points");
    const m = matchShapes(now("points") as number[], goal, { smoothA: !!now("smooth") });
    return [
      { target, prop: "points", keys: [{ at: start, value: m.a }, { at: start + frames, value: m.b, ease: ease(args.ease, ctx.theme.ease) }] },
      { target, prop: "smooth", keys: [{ at: start, value: 0 }] },
      { target, prop: "closed", keys: [{ at: start + frames, value: m.closed || isLoop(toPts(goal)) ? 1 : 0 }] },
    ];
  },

  // Travels along a line, by distance. The line can be a path that is itself moving.
  // args: path (id) or points, smooth, frames, ease, from, to (fractions of the line), orient (face along it), turn
  // (degrees added to that), relative (start from where it is, instead of on the line)
  follow: ({ target, start, args, ctx, now, tools }) => {
    const frames = num(args.frames, ctx.theme.moveFrames * 3);
    const path = args.path;
    const owner = typeof path === "string" ? path : undefined;
    let line: Pt[];
    if (owner) {
      line = polyline(needPath(tools, owner, "follow"), !!tools.value(owner, "smooth", start));
      if (num(tools.value(owner, "closed", start), 0) && !isLoop(line)) line = closeRing(line);
    } else {
      line = polyline(toFlat(pointsArg(args.points, "follow")), !!args.smooth);
    }
    const walk = walker(line);
    const curve = EASES[ease(args.ease, "smooth")];
    const [a, b] = [num(args.from, 0), num(args.to, 1)];
    const orient = !!args.orient;
    const turn = num(args.turn, 0);
    const parent = tools.parent(target);
    const [x0, y0] = [num(now("x"), 0), num(now("y"), 0)];
    const first = walk(a);
    const shift: Pt = args.relative ? [x0 - first.x, y0 - first.y] : [0, 0];
    tools.constrain({
      target,
      props: orient ? ["x", "y", "rotate"] : ["x", "y"],
      start,
      end: start + frames,
      solve: (f, read, own) => {
        const w = walk(lerp(a, b, curve(clamp((f - start) / frames))));
        const toLocal = owner ? mul(parent ? invert(read.matrix(parent, f) as Mat) : [1, 0, 0, 1, 0, 0], read.matrix(owner, f) as Mat) : ([1, 0, 0, 1, 0, 0] as Mat);
        const p = apply(toLocal, [w.x, w.y]);
        const out: Record<string, Value> = { x: p[0] + shift[0] + num(own("x"), x0) - x0, y: p[1] + shift[1] + num(own("y"), y0) - y0 };
        if (orient) {
          const r = (w.angle * Math.PI) / 180;
          out.rotate = (Math.atan2(toLocal[1] * Math.cos(r) + toLocal[3] * Math.sin(r), toLocal[0] * Math.cos(r) + toLocal[2] * Math.sin(r)) * 180) / Math.PI + turn;
        }
        return out;
      },
    });
    return [];
  },

  // Moves to a place along a true circular arc. bend is how far the arc bows, as a share of the distance; its sign picks the side.
  // args: x, y, bend, frames, ease, orient
  arc: ({ target, start, args, ctx, now }) => {
    const frames = num(args.frames, ctx.theme.moveFrames * 2);
    const [x0, y0] = [num(now("x"), 0), num(now("y"), 0)];
    const [x1, y1] = [num(args.x, x0), num(args.y, y0)];
    const chord = Math.hypot(x1 - x0, y1 - y0);
    const bend = num(args.bend, 0.3);
    const sag = bend * chord;
    const curve = EASES[ease(args.ease, ctx.theme.ease)];
    const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const [nx, ny] = chord ? [-(y1 - y0) / chord, (x1 - x0) / chord] : [0, 0];
    let at = (u: number): Pt => [lerp(x0, x1, u), lerp(y0, y1, u)];
    if (Math.abs(sag) > 1e-6 && chord > 0) {
      const R = (chord * chord) / 4 / (2 * Math.abs(sag)) + Math.abs(sag) / 2;
      const side = Math.sign(sag);
      const [cx, cy] = [mx + nx * side * (Math.abs(sag) - R), my + ny * side * (Math.abs(sag) - R)];
      const a0 = Math.atan2(y0 - cy, x0 - cx);
      const half = 2 * Math.atan2(2 * Math.abs(sag), chord);
      const mid = Math.atan2(ny * side, nx * side);
      const dir = Math.sin(mid - a0) >= 0 ? 1 : -1;
      at = (u) => {
        const a = a0 + dir * 2 * half * u;
        return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
      };
    }
    const pos = (t: number) => at(curve(t));
    const tracks = [
      { target, prop: "x", keys: over(start, frames, (t) => (t === 1 ? x1 : pos(t)[0])) },
      { target, prop: "y", keys: over(start, frames, (t) => (t === 1 ? y1 : pos(t)[1])) },
    ];
    if (args.orient) {
      tracks.push({
        target,
        prop: "rotate",
        keys: over(start, frames, (t) => {
          const [p, q] = [at(Math.max(0, t - 0.01)), at(Math.min(1, t + 0.01))];
          return (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
        }),
      });
    }
    return tracks;
  },

  // Circles a point or another part, which may be moving.
  // args: around (id) or cx, cy; radius, turns, frames, ease
  orbit: ({ target, start, args, ctx, now, tools }) => {
    const frames = num(args.frames, ctx.frames - start);
    const curve = EASES[ease(args.ease, "linear")];
    const parent = tools.parent(target);
    const around = typeof args.around === "string" ? args.around : undefined;
    const centre = (read: (id: string) => number[]): Pt => {
      if (!around) return [num(args.cx, 0), num(args.cy, 0)];
      const m = parent ? mul(invert(read(parent) as Mat), read(around) as Mat) : (read(around) as Mat);
      return [m[4], m[5]];
    };
    const c0 = centre((id) => tools.matrix(id, start));
    const [dx, dy] = [num(now("x"), 0) - c0[0], num(now("y"), 0) - c0[1]];
    const radius = num(args.radius, Math.hypot(dx, dy));
    const phase = Math.atan2(dy, dx);
    const turns = num(args.turns, 1);
    tools.constrain({
      target,
      props: ["x", "y"],
      start,
      end: start + frames,
      solve: (f, read) => {
        const c = centre((id) => read.matrix(id, f));
        const a = phase + curve(clamp((f - start) / frames)) * turns * Math.PI * 2;
        return { x: c[0] + radius * Math.cos(a), y: c[1] + radius * Math.sin(a) };
      },
    });
    return [];
  },

  // Real spring physics to one or more values. Keeps whatever speed the property already has, so interrupting a move stays smooth.
  // args: any numeric props to reach, stiffness, damping, mass, velocity, frames (otherwise it runs until it settles)
  spring: ({ target, start, args, ctx, tools }) => {
    const s: Spring = { stiffness: num(args.stiffness, 170), damping: num(args.damping, 18), mass: num(args.mass, 1) };
    const reserved = new Set(["stiffness", "damping", "mass", "velocity", "frames"]);
    const props = Object.keys(args).filter((k) => !reserved.has(k));
    if (!props.length) throw new Error("spring needs at least one value to reach, such as x");
    return props.map((prop) => {
      const to = args[prop];
      const from = tools.value(target, prop, start);
      if (typeof to !== "number") throw new Error(`spring can only reach numbers, and ${prop} is not one`);
      const here = num(from, to);
      const velocity = (here - num(tools.value(target, prop, start - 1), here)) * ctx.fps + num(args.velocity, 0);
      const delta = here - to;
      const tolerance = Math.max(Math.abs(delta), Math.abs(velocity) / 10, 1e-3) * 0.002;
      const frames = num(args.frames, Math.max(2, Math.ceil(springSettles(delta, velocity, s, tolerance) * ctx.fps)));
      return { target, prop, keys: over(start, frames, (t, i) => (t === 1 ? to : to + springAt(i / ctx.fps, delta, velocity, s))) };
    });
  },

  // Falls under gravity and bounces, worked out exactly. Each bounce emits a "bounce" event for sound.
  // args: floor (in the parent's coordinates, for the node's own origin), gravity, vx, vy, bounce, minHop, squash
  fall: ({ target, start, args, ctx, now, tools }) => {
    const y0 = num(now("y"), 0);
    const f = { y: y0, vy: num(args.vy, 0), floor: num(args.floor, ctx.height), gravity: num(args.gravity, 2400), bounce: num(args.bounce, 0.6), minHop: num(args.minHop, 3) };
    const path = flights(f);
    const frames = Math.max(1, Math.ceil(path.rest * ctx.fps));
    const x0 = num(now("x"), 0);
    const vx = num(args.vx, 0);
    const squash = num(args.squash, 0);
    path.list.slice(1).forEach((leg, i) => {
      const at = start + Math.round(leg.start * ctx.fps);
      tools.emit({ name: "bounce", at, data: { target, speed: Math.abs(leg.vy) } });
      if (squash) tools.run("squash", target, at, { amount: squash * f.bounce ** i, frames: 14 });
    });
    const keys = over(start, frames, (_, i) => fallAt(i / ctx.fps, f, path));
    return vx ? [{ target, prop: "y", keys }, { target, prop: "x", keys: over(start, frames, (_, i) => x0 + (vx * i) / ctx.fps) }] : [{ target, prop: "y", keys }];
  },

  // An impact or a beat: flattens, rebounds past normal, settles. Width and height trade off, so the volume looks constant.
  // args: amount, frames, axis ("y" flattens height, "x" flattens width)
  squash: ({ target, start, args, ctx }) => {
    const frames = num(args.frames, ctx.theme.moveFrames + 4);
    const amount = num(args.amount, 0.3);
    const main = str(args.axis, "y") === "x" ? "scaleX" : "scaleY";
    const cross = main === "scaleX" ? "scaleY" : "scaleX";
    const flat = (t: number) => 1 - amount * Math.exp(-3.5 * t) * Math.sin(3 * Math.PI * t);
    return [
      { target, prop: main, blend: "multiply", keys: over(start, frames, (t) => (t === 1 ? 1 : flat(t))) },
      { target, prop: cross, blend: "multiply", keys: over(start, frames, (t) => (t === 1 ? 1 : 1 / flat(t))) },
    ];
  },

  // A whole jump with weight: crouch (anticipation), stretch in flight, squash on landing, then settle (follow-through).
  // The base stays planted while on the ground. args: x, y, height, frames, crouch, land (shares of the time), squash, stretch
  hop: ({ target, start, args, ctx, now, tools }) => {
    const frames = num(args.frames, 40);
    const [x0, y0] = [num(now("x"), 0), num(now("y"), 0)];
    const [x1, y1] = [num(args.x, x0), num(args.y, y0)];
    const height = num(args.height, 160);
    const [crouch, land] = [num(args.crouch, 0.22), num(args.land, 0.28)];
    const [amount, stretch] = [num(args.squash, 0.3), num(args.stretch, 0.22)];
    const air = 1 - crouch - land;
    const points = tools.kind(target) === "path" ? (now("points") as number[]) : undefined;
    const foot = (points ? bounds(toPts(points)).h / 2 : 0) * num(now("scaleY"), 1);
    const tall = (t: number) => {
      if (t < crouch) return 1 - amount * smooth(t / crouch);
      if (t < crouch + air) {
        const p = (t - crouch) / air;
        const shape = 1 + stretch * Math.abs(2 * p - 1) ** 1.5;
        if (p < 0.14) return lerp(1 - amount, shape, smooth(p / 0.14));
        return p > 0.9 ? lerp(shape, 1, (p - 0.9) / 0.1) : shape;
      }
      const u = (t - crouch - air) / land;
      return 1 - amount * Math.exp(-3 * u) * Math.sin(3 * Math.PI * u);
    };
    const flight = (t: number) => clamp((t - crouch) / air);
    const planted = (t: number) => (t < crouch || t >= crouch + air ? 1 : 0);
    return [
      { target, prop: "x", keys: over(start, frames, (t) => (t === 1 ? x1 : lerp(x0, x1, flight(t)))) },
      {
        target,
        prop: "y",
        keys: over(start, frames, (t) => {
          if (t === 1) return y1;
          const p = flight(t);
          return lerp(y0, y1, p) - 4 * height * p * (1 - p) + planted(t) * foot * (1 - tall(t));
        }),
      },
      { target, prop: "scaleY", blend: "multiply", keys: over(start, frames, (t) => (t === 1 ? 1 : tall(t))) },
      { target, prop: "scaleX", blend: "multiply", keys: over(start, frames, (t) => (t === 1 ? 1 : 1 / tall(t))) },
    ];
  },

  // Follow-through on any number: a dying wobble added on top of whatever else it is doing.
  // args: prop, size, cycles, frames
  jiggle: ({ target, start, args, ctx }) => {
    const frames = num(args.frames, ctx.theme.moveFrames * 2);
    const [size, cycles] = [num(args.size, 10), num(args.cycles, 3)];
    return [{ target, prop: str(args.prop, "rotate"), blend: "add", keys: over(start, frames, (t) => (t === 1 ? 0 : size * Math.exp(-4 * t) * Math.sin(2 * Math.PI * cycles * t))) }];
  },

  // Restless motion on any number, added on top, from seeded noise.
  // args: prop, size, speed (wobbles a second), frames, seed
  wiggle: ({ target, start, args, ctx }) => {
    const frames = num(args.frames, ctx.frames - start);
    const [size, speed, seed] = [num(args.size, 8), num(args.speed, 2), num(args.seed, 1)];
    return [{ target, prop: str(args.prop, "y"), blend: "add", keys: over(start, frames, (t, i) => (t === 1 ? 0 : size * Math.min(1, 6 * t, 6 * (1 - t)) * noise((i / ctx.fps) * speed, seed))) }];
  },
};
