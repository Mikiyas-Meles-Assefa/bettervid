// Clocks and timers: anything that shows time passing. A clock face with hands, a stopwatch with a sweep hand and the
// elapsed time as an arc, a ring timer that empties, an hourglass whose sand falls, a digital display. Time is a state
// in seconds; running it turns the hands at the true rate.
import type { NodeSpec, Props } from "../../../core/types.ts";
import type { KindDef } from "../make.ts";
import { clamp, ellipse, flat, lerp, rounded, roundRect } from "../geom.ts";
import type { Change, Part, Pt, StateDef, StateMap, VerbDef } from "../types.ts";

const mmss = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`;
};

export const clock: KindDef = {
  name: "clock",
  about: "anything that shows time: wall clocks, watches, stopwatches, kitchen timers, countdown rings, hourglasses, digital displays",
  forms: { analog: "a face with hour and minute hands (and seconds when `seconds`)", stopwatch: "a sweep hand over a face, with the elapsed time as an arc", timer: "a ring that empties as time runs down", hourglass: "sand that falls from the top bulb to the bottom", digital: "a display of numbers" },
  params: {
    duration: "for timer and hourglass: seconds until it is done; for stopwatch: seconds for one turn of the hand (60 when absent)",
    seconds: "for analog: true to show a seconds hand",
    numerals: "for analog: true to show the hour numbers (when a text size is given)",
  },
  colors: { face: "the face", case: "the case or frame", hand: "the sweep hand, arc or remaining ring", sand: "the sand" },
  required: ["duration:timer", "duration:hourglass"],
  build(c) {
    const { id, L } = c;
    const form = c.spec.form ?? "analog";
    const dur = c.param<number>("duration") ?? 60;
    const W = form === "hourglass" ? 640 : form === "digital" ? 1000 : 1000;
    const H = form === "hourglass" ? 1000 : form === "digital" ? 460 : form === "stopwatch" ? 1120 : 1000;
    const face = c.col("face") ?? "paper";
    const hand = c.col("hand") ?? "accent";
    const kase = c.col("case") ?? "ink";
    const fg = c.inkOn(face);
    const nodes: NodeSpec[] = [];
    const add = (nid: string, kind: "group" | "path" | "text", props: Props, parent = `${id}.body`) => nodes.push({ id: nid, kind, parent, props });
    const parts: Record<string, Part> = {};
    let draw: (s: StateMap) => Record<string, Props>;
    let anchors: Record<string, (s: StateMap) => Pt> = {};
    let animate: ((from: StateMap, to: StateMap, t: { frames: number; fps?: number }) => Change[]) | undefined;

    if (form === "analog" || form === "stopwatch" || form === "timer") {
      const R = 470;
      const cy = -R - (form === "stopwatch" ? 120 : 15);
      const P = (deg: number, r: number): Pt => [r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)];
      if (form === "stopwatch") {
        add(`${id}.crown`, "path", { points: flat(roundRect(-55, cy - R - 105, 55, cy - R + 10, 18)), closed: 1, fill: kase, stroke: "ink", strokeWidth: L });
        add(`${id}.button`, "path", { points: flat(roundRect(-35, -40, 35, 60, 14)), closed: 1, fill: kase, stroke: "ink", strokeWidth: L, rotate: 45, x: P(45, R + 40)[0], y: P(45, R + 40)[1] });
      }
      add(`${id}.case`, "path", { points: flat(ellipse(0, cy, R, undefined, 72)), closed: 1, fill: kase, stroke: "ink", strokeWidth: L });
      add(`${id}.face`, "path", { points: flat(ellipse(0, cy, R * 0.88, undefined, 72)), closed: 1, fill: face, stroke: "none" });
      const ringR = R * 0.62;
      if (form === "stopwatch" || form === "timer") {
        add(`${id}.track`, "path", { points: flat(ellipse(0, cy, ringR, undefined, 73, 0, Math.PI * 2 + 0.0001)), fill: "none", stroke: "ink", strokeWidth: R * 0.1, opacity: 0.12 });
        add(`${id}.arc`, "path", { points: flat(Array.from({ length: 73 }, (_, i) => P((360 * i) / 72, ringR))), fill: "none", stroke: hand, strokeWidth: R * 0.1, lineCap: "butt", trimEnd: 0 });
      }
      for (let i = 0; i < 60; i++) {
        const big = i % 5 === 0;
        if (!big && form === "timer") continue;
        add(`${id}.tick.${i}`, "path", { points: flat([P(i * 6, R * 0.84), P(i * 6, R * (big ? 0.72 : 0.78))]), stroke: fg, strokeWidth: L * (big ? (i % 15 === 0 ? 0.9 : 0.6) : 0.3), fill: "none" });
      }
      if (form === "analog" && c.param<boolean>("numerals") && c.text) for (let h = 1; h <= 12; h++) add(`${id}.num.${h}`, "text", { x: P(h * 30, R * 0.58)[0], y: P(h * 30, R * 0.58)[1], text: String(h), size: c.text, role: "label", color: fg });
      const handNode = (name: string, len: number, width: number, color: string, tail = 0.12) => {
        add(`${id}.${name}`, "group", { y: cy });
        add(`${id}.${name}.line`, "path", { points: flat([[0, R * tail], [0, -len]]), stroke: color, strokeWidth: width, lineCap: "round", fill: "none" }, `${id}.${name}`);
      };
      if (form === "analog") {
        handNode("hour", R * 0.45, L * 2.2, fg);
        handNode("minute", R * 0.7, L * 1.5, fg);
        if (c.param<boolean>("seconds")) handNode("second", R * 0.78, L * 0.7, hand, 0.2);
      } else handNode("sweep", R * 0.78, L * 1.2, form === "timer" ? fg : hand, 0.18);
      add(`${id}.hub`, "path", { points: flat(ellipse(0, cy, L * 2.2, undefined, 16)), closed: 1, fill: fg, stroke: "none" });
      parts.face = { node: `${id}.face`, anchor: [0, cy], box: [-R, cy - R, R, cy + R], about: "the face" };
      parts.hands = { node: form === "analog" ? `${id}.minute` : `${id}.sweep`, anchor: [0, cy], about: "the hands" };
      if (form !== "analog") parts.arc = { node: `${id}.arc`, anchor: P(90, ringR), about: form === "timer" ? "the time left, as a ring" : "the time elapsed, as an arc" };
      const turn = form === "stopwatch" ? Math.max(1, c.param<number>("duration") ?? 60) : dur;
      draw = (s): Record<string, Props> => {
        const t = Number(s.time);
        if (form === "analog") {
          return {
            [`${id}.hour`]: { rotate: (t / 43200) * 360 },
            [`${id}.minute`]: { rotate: (t / 3600) * 360 },
            ...(c.param<boolean>("seconds") ? { [`${id}.second`]: { rotate: (t / 60) * 360 } } : {}),
          };
        }
        const f = form === "timer" ? clamp(1 - t / dur) : clamp(t / turn);
        return { [`${id}.sweep`]: { rotate: form === "timer" ? (1 - f) * 360 : (t / turn) * 360 }, [`${id}.arc`]: { trimEnd: form === "timer" ? f : f, trimStart: 0 } };
      };
      anchors = { center: () => [0, cy], top: () => [0, cy - R] };
    } else if (form === "hourglass") {
      const cap = 60;
      const g = (y: number) => {
        // The glass's half-width at a height: two bulbs meeting at a narrow waist.
        const u = Math.abs((y - -H / 2) / (H / 2 - cap));
        return lerp(W * 0.035, W * 0.4, Math.sin(clamp(u) * Math.PI * 0.5) ** 0.8);
      };
      const ys = Array.from({ length: 41 }, (_, i) => lerp(-cap - 8, -H + cap + 8, i / 40));
      const right = ys.map((y) => [g(y), y] as Pt);
      const glass = [...right, ...right.map(([x, y]) => [-x, y] as Pt).reverse()];
      add(`${id}.glass`, "path", { points: flat(glass), closed: 1, fill: "ink", opacity: 0.06, stroke: "none" });
      add(`${id}.sand`, "group", { clip: flat(glass) });
      const sand = c.col("sand") ?? "accent";
      add(`${id}.top`, "path", { closed: 1, fill: sand, stroke: "none" }, `${id}.sand`);
      add(`${id}.pile`, "path", { closed: 1, fill: sand, stroke: "none" }, `${id}.sand`);
      add(`${id}.stream`, "path", { points: flat([[0, -H / 2], [0, -cap - 10]]), stroke: sand, strokeWidth: L * 0.6, fill: "none", opacity: 0 }, `${id}.sand`);
      add(`${id}.outline`, "path", { points: flat(glass), closed: 1, fill: "none", stroke: "ink", strokeWidth: L });
      add(`${id}.capTop`, "path", { points: flat(roundRect(-W / 2, -H, W / 2, -H + cap, 16)), closed: 1, fill: c.col("case") ?? "ink", stroke: "ink", strokeWidth: L });
      add(`${id}.capBot`, "path", { points: flat(roundRect(-W / 2, -cap, W / 2, 0, 16)), closed: 1, fill: c.col("case") ?? "ink", stroke: "ink", strokeWidth: L });
      parts.sand = { node: `${id}.sand`, anchor: [0, -H / 2], about: "the sand" };
      const topSand = (f: number): Pt[] => {
        // Sand left in the top bulb: its surface sinks toward the waist, dipping in the middle as it drains.
        const y0 = lerp(-H + cap + H * 0.16, -H / 2 - 4, f);
        const dip = lerp(0, H * 0.06, Math.min(1, f * 3)) * (1 - f);
        return [...Array.from({ length: 9 }, (_, i) => [lerp(-W / 2, W / 2, i / 8), y0 + dip * Math.cos(((i / 8) * 2 - 1) * Math.PI * 0.5)] as Pt), [W / 2, -H / 2], [-W / 2, -H / 2]];
      };
      const pile = (f: number): Pt[] => {
        const h = lerp(0, H * 0.3, Math.sqrt(f));
        return [...Array.from({ length: 9 }, (_, i) => { const x = lerp(-W / 2, W / 2, i / 8); return [x, -cap - h * (1 - 0.55 * (x / (W * 0.4)) ** 2)] as Pt; }), [W / 2, -cap + 4], [-W / 2, -cap + 4]];
      };
      draw = (s): Record<string, Props> => {
        const f = clamp(Number(s.time) / dur);
        return { [`${id}.top`]: { points: flat(topSand(f)), opacity: f < 1 ? 1 : 0 }, [`${id}.pile`]: { points: flat(pile(f)), opacity: f > 0 ? 1 : 0 }, [`${id}.stream`]: { opacity: s.running && f < 1 ? 1 : 0 } };
      };
      anchors = { center: () => [0, -H / 2] };
    } else {
      // Digital
      add(`${id}.case`, "path", { points: flat(rounded([[-W / 2, -H], [W / 2, -H], [W / 2, 0], [-W / 2, 0]], H * 0.16, true)), closed: 1, fill: kase, stroke: "ink", strokeWidth: L });
      add(`${id}.screen`, "path", { points: flat(roundRect(-W / 2 + H * 0.12, -H + H * 0.12, W / 2 - H * 0.12, -H * 0.12, H * 0.08)), closed: 1, fill: face, stroke: "none" });
      add(`${id}.digits`, "text", { y: -H / 2, size: H * 0.5, font: "mono", color: hand, text: mmss(0) });
      parts.screen = { node: `${id}.screen`, anchor: [0, -H / 2], box: [-W / 2, -H, W / 2, 0], about: "the display" };
      draw = (s): Record<string, Props> => ({ [`${id}.digits`]: { text: mmss(Number(s.time)) } });
      // Digits change once a second while it runs: one step each.
      animate = (from, to, t) => {
        const fps = t.fps ?? 30;
        const [a, b] = [Number(from.time), Number(to.time)];
        const out: Change[] = [];
        const n = Math.floor(Math.abs(b - a));
        for (let i = 1; i < n; i++) {
          const at = Math.round((i / Math.abs(b - a)) * t.frames);
          if (at > 0 && at < t.frames) out.push({ id: `${id}.digits`, prop: "text", value: mmss(a + Math.sign(b - a) * i), at, frames: 1, ease: "step" });
        }
        void fps;
        return out;
      };
      anchors = { center: () => [0, -H / 2] };
    }
    const states: Record<string, StateDef> = {
      time: { type: "number", about: form === "analog" ? "the time of day in seconds after twelve" : "seconds elapsed", min: 0, initial: 0 },
      running: { type: "bool", about: "whether it is running", initial: false },
    };
    const verbs: Record<string, VerbDef> = {
      runs: { about: "time passes by a number of seconds (the hands move at the true rate over the caller's timing)", sets: [{ state: "time", arg: true, by: 1 }, { state: "running", value: true }], arg: "number", ease: "linear" },
      ticks: { about: "time passes by a number of seconds", sets: [{ state: "time", arg: true, by: 1 }], arg: "number", ease: "linear" },
      starts: { about: "starts running", sets: [{ state: "running", value: true }] },
      stops: { about: "stops", sets: [{ state: "running", value: false }] },
      shows: { about: "shows a time in seconds", sets: [{ state: "time", arg: true }], arg: "number" },
      "is set to": { about: "is set to a time in seconds", sets: [{ state: "time", arg: true }], arg: "number" },
      resets: { about: "goes back to zero", sets: [{ state: "time", value: 0 }, { state: "running", value: false }] },
    };
    if (form === "hourglass") verbs.flips = { about: "is turned over and starts again", sets: [{ state: "time", value: 0 }, { state: "angle", by: 180, value: 1 }] };
    const W2 = form === "hourglass" ? W : 1000;
    return { box: { w: W2, h: H }, pivot: [0, -H / 2], nodes, parts, states, verbs, draw, anchors, animate, read: (s) => mmss(Number(s.time)) };
  },
};
