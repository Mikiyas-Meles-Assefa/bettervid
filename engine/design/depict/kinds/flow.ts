// Flows: things that travel along a path. Drops that form, fall under gravity and splash; a stream that pours; particles
// carried along (blood cells, cars, data, ants, current); gas or smoke that rises and spreads. The caller lays the path
// between two other things' anchors (an outlet and a surface, say), in the flow's local units.
import type { NodeSpec, Props } from "../../../core/types.ts";
import type { KindDef } from "../make.ts";
import { clamp, ellipse, flat, lerp, spread } from "../geom.ts";
import { sizeCm } from "../spec.ts";
import type { Change, Part, Pt, StateDef, StateMap, VerbDef } from "../types.ts";

const G = 981; // cm/s^2

export const flow: KindDef = {
  name: "flow",
  about: "things that travel along a path: drops falling, a stream pouring, particles carried along a pipe, wire or road, gas or smoke rising",
  forms: { drops: "drops that form, fall and splash", stream: "a continuous pour", particles: "small things carried along the path", gas: "puffs that rise, spread and fade" },
  params: {
    path: "required. points [x, y] in local units along which it travels (the caller sets it between two things); for gas, from the source upward",
    rate: "how many per second (drops, particles, puffs) when it runs",
    speed: "for particles and gas: centimetres per second along the path",
    width: "for stream: the stream's width in centimetres; for drops, particles and gas: their size in centimetres",
    count: "for particles: how many are on the path at once",
    magnify: "how many times its true size each drop, particle or puff (or the stream's width) is drawn so a viewer sees it; 1 is true size. A design value set with a reason (suggestMagnify gives the viewing's suggestion); the motion stays physical",
  },
  colors: { stuff: "the color of what flows (a fact: water drops are clear, smoke is grey)" },
  required: ["path"],
  build(c) {
    const { id, L } = c;
    const form = c.spec.form ?? "drops";
    const path = c.param<Pt[]>("path") ?? [[0, 0], [0, 1000]];
    const xs = path.map((p) => p[0]);
    const ys = path.map((p) => p[1]);
    const box = { w: Math.max(1, Math.max(...xs) - Math.min(...xs)), h: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
    const segs = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]));
    const len = segs.reduce((a, b) => a + b, 0) || 1;
    const real = sizeCm(c.spec);
    const cmU = real ? Math.max(box.w, box.h) / Math.max(real.w, real.h) : 1000 / 30; // local units per cm
    const along = (u: number): Pt => {
      let d = clamp(u) * len;
      for (let i = 0; i < segs.length; i++) {
        if (d <= segs[i]! || i === segs.length - 1) {
          const t = segs[i]! ? clamp(d / segs[i]!) : 0;
          return [lerp(path[i]![0], path[i + 1]![0], t), lerp(path[i]![1], path[i + 1]![1], t)];
        }
        d -= segs[i]!;
      }
      return path.at(-1)!;
    };
    const stuff = c.col("stuff") ?? "accent";
    const magnify = Math.max(1, c.param<number>("magnify") ?? 1);
    const size = Math.max(L * 1.2, (c.param<number>("width") ?? (form === "gas" ? 2 : 0.5)) * cmU * magnify);
    const rate = c.param<number>("rate") ?? (form === "stream" ? 0 : 2);
    const speed = (c.param<number>("speed") ?? 20) * cmU; // units per second
    const nodes: NodeSpec[] = [];
    const add = (nid: string, kind: "group" | "path", props: Props) => nodes.push({ id: nid, kind, parent: `${id}.body`, props });
    const parts: Record<string, Part> = { source: { node: `${id}.body`, anchor: path[0]!, about: "where it starts" }, end: { node: `${id}.body`, anchor: path.at(-1)!, about: "where it arrives" } };
    // The pool: as many movers as can be on the path at once, reused in turn.
    const travelS = form === "drops" ? Math.sqrt((2 * (len / cmU)) / G) : len / Math.max(1, speed);
    const pool = form === "stream" ? 0 : form === "particles" ? Math.max(1, Math.round(c.param<number>("count") ?? Math.max(3, rate * travelS))) : Math.max(2, Math.ceil(rate * (travelS + 0.5)) + 1);
    const drop: Pt[] = ellipse(0, 0, size / 2, size / 2, 20).map(([x, y]) => [x, y < 0 ? y * (1 + 0.9 * (-y / (size / 2)) ** 2) : y] as Pt);
    if (form === "stream") add(`${id}.stream`, "path", { points: flat(path), stroke: stuff, strokeWidth: size, fill: "none", lineCap: "round", trimStart: 0, trimEnd: 0 });
    for (let i = 0; i < pool; i++) {
      if (form === "drops") {
        add(`${id}.d${i}`, "path", { points: flat(drop), closed: 1, fill: stuff, stroke: "ink", strokeWidth: L * 0.3, opacity: 0, x: path[0]![0], y: path[0]![1] });
        add(`${id}.ripple${i}`, "path", { points: flat(ellipse(0, 0, size, size * 0.3, 24)), closed: 1, fill: "none", stroke: stuff, strokeWidth: L * 0.4, opacity: 0, x: path.at(-1)![0], y: path.at(-1)![1] });
      } else if (form === "particles") add(`${id}.d${i}`, "path", { points: flat(ellipse(0, 0, size / 2, undefined, 14)), closed: 1, fill: stuff, stroke: "none", opacity: 0 });
      else add(`${id}.d${i}`, "path", { points: flat(ellipse(0, 0, size / 2, size * 0.42, 24)), closed: 1, fill: stuff, stroke: "none", opacity: 0, x: path[0]![0], y: path[0]![1] });
    }
    const states: Record<string, StateDef> = {
      on: { type: "bool", about: "whether it runs", initial: false },
      color: { type: "color", about: "the color of what flows", initial: stuff },
    };
    const draw = (s: StateMap): Record<string, Props> => {
      const out: Record<string, Props> = {};
      if (form === "stream") out[`${id}.stream`] = { stroke: String(s.color) };
      for (let i = 0; i < pool; i++) {
        out[`${id}.d${i}`] = { fill: String(s.color) };
        if (form === "drops") out[`${id}.ripple${i}`] = { stroke: String(s.color) };
      }
      return out;
    };
    const animate = (from: StateMap, to: StateMap, t: { frames: number; fps?: number }): Change[] => {
      const fps = t.fps ?? 30;
      const F = t.frames;
      const out: Change[] = [];
      const ch = (nid: string, prop: string, value: number | number[], at: number, frames: number, ease: Change["ease"]) => out.push({ id: nid, prop, value, at: Math.round(at), frames: Math.max(1, Math.round(frames)), ease });
      const travel = Math.max(1, travelS * fps);
      if (form === "stream") {
        if (to.on && !from.on) ch(`${id}.stream`, "trimEnd", 1, 0, travel, "in");
        if (!to.on && from.on) ch(`${id}.stream`, "trimStart", 1, 0, travel, "in");
        return out;
      }
      if (!to.on) return out;
      const every = Math.max(1, fps / Math.max(0.01, rate));
      const [a, b] = [path[0]!, path.at(-1)!];
      if (form === "drops") {
        // Each drop swells at the source, lets go, falls with gravity's ease, and rings out where it lands.
        const swell = Math.min(every * 0.6, fps * 0.4);
        let k = 0;
        for (let at = 0; at + swell + travel <= F; at += every, k++) {
          const d = `${id}.d${k % pool}`;
          const r = `${id}.ripple${k % pool}`;
          ch(d, "x", a[0], at, 1, "step");
          ch(d, "y", a[1], at, 1, "step");
          ch(d, "scaleX", 0.3, at, 1, "step");
          ch(d, "scaleY", 0.3, at, 1, "step");
          ch(d, "opacity", 1, at + 1, 2, "out");
          ch(d, "scaleX", 1, at + 1, swell, "out");
          ch(d, "scaleY", 1, at + 1, swell, "out");
          ch(d, "x", b[0], at + swell, travel, "in");
          ch(d, "y", b[1], at + swell, travel, "in");
          ch(d, "opacity", 0, at + swell + travel, 2, "linear");
          ch(r, "scaleX", 0.2, at + swell + travel, 1, "step");
          ch(r, "scaleY", 0.2, at + swell + travel, 1, "step");
          ch(r, "opacity", 0.9, at + swell + travel + 1, 1, "step");
          ch(r, "scaleX", 1.4, at + swell + travel + 2, fps * 0.35, "out");
          ch(r, "scaleY", 1.4, at + swell + travel + 2, fps * 0.35, "out");
          ch(r, "opacity", 0, at + swell + travel + 2, fps * 0.35, "linear");
        }
        return out;
      }
      // Particles and gas loop along the path, each at its own phase; gas swells and fades as it rises.
      const offs = spread(pool, 7);
      for (let i = 0; i < pool; i++) {
        const d = `${id}.d${i}`;
        const phase = (i / pool) * travel;
        const side = (offs[i]![0] - 0.5) * size * 3;
        for (let at = -phase; at < F; at += travel) {
          const a0 = Math.max(0, at);
          const u0 = at < 0 ? -at / travel : 0;
          const p0 = along(u0);
          ch(d, "x", p0[0] + side, a0, 1, "step");
          ch(d, "y", p0[1], a0, 1, "step");
          ch(d, "opacity", form === "gas" ? 0.55 : 1, a0, 1, "step");
          if (form === "gas") (ch(d, "scaleX", lerp(0.4, 2.6, u0), a0, 1, "step"), ch(d, "scaleY", lerp(0.4, 2.6, u0), a0, 1, "step"));
          // Through each corner of the path in turn, at a steady speed.
          let prevU = u0;
          let tAt = a0 + 1;
          const corners = [...segs.map((_, j) => segs.slice(0, j + 1).reduce((x, y) => x + y, 0) / len)].filter((u) => u > u0);
          for (const u of corners) {
            const p = along(u);
            const fr = (u - prevU) * travel;
            ch(d, "x", p[0] + side * (form === "gas" ? 1 + u * 2 : 1), tAt, fr, "linear");
            ch(d, "y", p[1], tAt, fr, "linear");
            if (form === "gas") {
              ch(d, "scaleX", lerp(0.4, 2.6, u), tAt, fr, "linear");
              ch(d, "scaleY", lerp(0.4, 2.6, u), tAt, fr, "linear");
              ch(d, "opacity", 0.55 * (1 - u), tAt, fr, "linear");
            }
            tAt += fr;
            prevU = u;
          }
        }
      }
      return out;
    };
    const verbs: Record<string, VerbDef> = {
      runs: { about: "starts flowing", sets: [{ state: "on", value: true }] },
      flows: { about: "starts flowing", sets: [{ state: "on", value: true }] },
      starts: { about: "starts flowing", sets: [{ state: "on", value: true }] },
      drips: { about: "starts dripping", sets: [{ state: "on", value: true }] },
      pours: { about: "starts pouring", sets: [{ state: "on", value: true }] },
      rises: { about: "starts rising", sets: [{ state: "on", value: true }] },
      stops: { about: "stops", sets: [{ state: "on", value: false }] },
      turns: { about: "what flows changes color", sets: [{ state: "color", arg: true }], arg: "color" },
    };
    return { box, pivot: [0, 0], nodes, parts, states, verbs, draw, animate, anchors: { source: () => path[0]!, end: () => path.at(-1)! }, notes: [`${c.spec.label}: ${form}, ${pool} on the path at once, ${travelS.toFixed(2)} s from end to end`] };
  },
};
