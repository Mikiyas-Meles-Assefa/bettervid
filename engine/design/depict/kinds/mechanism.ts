// Mechanisms: simple machines and moving parts. A lever on a fulcrum, meshing gears, a wheel with spokes, a spring, a
// piston in its cylinder, a hinge, a rope over a pulley with a load. Each has one state that moves it, and the geometry
// that follows from it (a gear's mate turns the other way by the ratio of teeth; a pulley's wheel turns as the rope runs).
import type { NodeSpec, Props } from "../../../core/types.ts";
import type { KindDef } from "../make.ts";
import { clamp, ellipse, flat, isHex, lerp, mixHex, roundRect } from "../geom.ts";
import type { Part, Pt, StateDef, StateMap, VerbDef } from "../types.ts";

export const mechanism: KindDef = {
  name: "mechanism",
  about: "simple machines and moving parts: levers, seesaws, gears, wheels, springs, pistons, hinges and doors, pulleys",
  forms: { lever: "a beam on a fulcrum that tips", gear: "a toothed wheel, with an optional meshing mate", wheel: "a wheel with spokes on an axle", spring: "a coil that stretches and compresses", piston: "a piston and rod sliding in a cylinder", hinge: "two leaves joined at a pin that open", pulley: "a wheel with a rope over it, a load on one side" },
  params: {
    teeth: "for gear: how many teeth",
    mate: "for gear: teeth of a second gear meshing beside it (0 for none)",
    spokes: "for wheel: how many spokes",
    coils: "for spring: how many turns",
    fulcrum: "for lever: where the fulcrum sits along the beam, 0 left end to 1 right end",
    loads: "for lever: [{at (0 to 1 along the beam), size (share of the beam), color}] things resting on it",
    travel: "for pulley: how far the load can rise, as a share of the height",
  },
  colors: { metal: "the main parts (a fact: steel grey, brass)", accent: "a second part (a mate gear, a load, a rope)", "<load colors>": "colors of loads" },
  build(c) {
    const { id, L } = c;
    const form = c.spec.form ?? "gear";
    const metal = c.col("metal") ?? "paper";
    const second = c.col("accent") ?? "accent";
    const nodes: NodeSpec[] = [];
    const add = (nid: string, kind: "group" | "path", props: Props, parent = `${id}.body`) => nodes.push({ id: nid, kind, parent, props });
    const line = { stroke: "ink", strokeWidth: L, lineJoin: "round", lineCap: "round" };
    const parts: Record<string, Part> = {};
    const states: Record<string, StateDef> = {};
    const verbs: Record<string, VerbDef> = {};
    let W = 1000;
    let H = 1000;
    let draw: (s: StateMap) => Record<string, Props> = () => ({});
    let pivot: Pt = [0, -500];
    const turnVerbs = (state: string, about: string) => {
      verbs.turns = { about: `${about} by an angle`, sets: [{ state, arg: true, by: 1 }], arg: "angle" };
      verbs.spins = { about: `${about} whole turns`, sets: [{ state, arg: true, by: 360 }], arg: "number", ease: "linear" };
      verbs.rotates = verbs.turns;
    };
    const gearPts = (r: number, teeth: number): Pt[] => {
      const out: Pt[] = [];
      const depth = Math.min(r * 0.18, (Math.PI * r) / teeth * 0.7);
      for (let i = 0; i < teeth; i++) {
        for (const [f, rr] of [[0, r - depth], [0.18, r - depth], [0.3, r], [0.7, r], [0.82, r - depth]] as const) {
          const a = ((i + f) / teeth) * Math.PI * 2;
          out.push([rr * Math.sin(a), -rr * Math.cos(a)]);
        }
      }
      return out;
    };

    if (form === "gear" || form === "wheel") {
      const teeth = Math.max(6, Math.round(c.param<number>("teeth") ?? 16));
      const mateT = Math.round(c.param<number>("mate") ?? 0);
      const R = form === "gear" && mateT ? 500 * (teeth / (teeth + mateT)) : 500;
      const r2 = R * (mateT / teeth);
      W = mateT ? 2 * R + 2 * r2 : 1000;
      H = Math.max(2 * R, 2 * r2);
      const cx = mateT ? -W / 2 + R : 0;
      const cy = -H / 2;
      const wheel = (nid: string, r: number, n: number, x: number, col: string, spokes: number) => {
        add(nid, "group", { x, y: cy });
        if (form === "gear") add(`${nid}.rim`, "path", { ...line, points: flat(gearPts(r, n)), closed: 1, fill: col }, nid);
        else {
          add(`${nid}.tyre`, "path", { ...line, points: flat(ellipse(0, 0, r - L / 2, undefined, 64)), closed: 1, fill: "ink" }, nid);
          add(`${nid}.rim`, "path", { ...line, points: flat(ellipse(0, 0, r * 0.8, undefined, 64)), closed: 1, fill: col }, nid);
        }
        const hole = form === "gear" ? r * 0.55 : r * 0.68;
        for (let i = 0; i < spokes; i++) {
          const a = (i / spokes) * 360;
          add(`${nid}.spoke${i}`, "path", { ...line, strokeWidth: form === "gear" ? r * 0.12 : L * 1.2, points: flat([[0, -r * 0.12], [0, -hole]]), rotate: a, fill: "none", stroke: form === "gear" ? (isHex(col) ? mixHex(col, "#000000", 0.25) : "ink") : "ink" }, nid);
        }
        if (form === "gear") add(`${nid}.ring`, "path", { ...line, strokeWidth: L * 0.6, points: flat(ellipse(0, 0, r * 0.6, undefined, 48)), closed: 1, fill: "none", opacity: 0.5 }, nid);
        add(`${nid}.hub`, "path", { ...line, points: flat(ellipse(0, 0, r * 0.16, undefined, 24)), closed: 1, fill: "ink" }, nid);
        // A mark on the rim, so turning shows even when it is round.
        add(`${nid}.mark`, "path", { points: flat(ellipse(0, -r * (form === "gear" ? 0.7 : 0.9), r * 0.05, undefined, 12)), closed: 1, fill: c.col("accent") ?? "accent", stroke: "none" }, nid);
      };
      wheel(`${id}.wheel`, R, teeth, cx, metal, form === "gear" ? 0 : Math.max(2, Math.round(c.param<number>("spokes") ?? 6)));
      if (mateT) wheel(`${id}.mate`, r2, mateT, cx + R + r2 - R * 0.06, second, 0);
      parts.wheel = { node: `${id}.wheel`, anchor: [cx, cy], about: form };
      if (mateT) parts.mate = { node: `${id}.mate`, anchor: [cx + R + r2, cy], about: "the meshing gear" };
      states.angle2 = { type: "angle", about: "how far it has turned, degrees", initial: 0 };
      turnVerbs("angle2", "turns");
      // The mate turns the other way, slower or faster by the ratio of teeth; offset half a tooth so the teeth mesh.
      draw = (s): Record<string, Props> => ({ [`${id}.wheel`]: { rotate: Number(s.angle2) }, ...(mateT ? { [`${id}.mate`]: { rotate: -Number(s.angle2) * (teeth / mateT) + 180 / mateT } } : {}) });
      pivot = [0, -H / 2];
    } else if (form === "lever") {
      W = 1000;
      H = 360;
      const f = clamp(c.param<number>("fulcrum") ?? 0.5);
      const fx = lerp(-W / 2, W / 2, f);
      const beamT = 34;
      const fh = 170;
      add(`${id}.fulcrum`, "path", { ...line, points: flat([[fx, -fh], [fx + fh * 0.62, 0], [fx - fh * 0.62, 0]]), closed: 1, fill: second });
      add(`${id}.beam`, "group", { x: fx, y: -fh });
      add(`${id}.plank`, "path", { ...line, points: flat(roundRect(-W / 2 - fx, -beamT, W / 2 - fx, 0, beamT / 2)), closed: 1, fill: metal }, `${id}.beam`);
      const loads = c.param<{ at: number; size: number; color?: string }[]>("loads") ?? [];
      loads.forEach((ld, i) => {
        const s = clamp(ld.size ?? 0.12, 0.02, 0.5) * W;
        const x = lerp(-W / 2, W / 2, clamp(ld.at)) - fx;
        add(`${id}.load${i}`, "path", { ...line, points: flat(roundRect(x - s / 2, -beamT - s, x + s / 2, -beamT, s * 0.08)), closed: 1, fill: (ld.color && c.col(ld.color)) ?? second }, `${id}.beam`);
        parts[`load${i}`] = { node: `${id}.load${i}`, anchor: [x + fx, -fh - beamT - s / 2], about: `load ${i + 1}` };
      });
      parts.beam = { node: `${id}.beam`, anchor: [0, -fh], box: [-W / 2, -H, W / 2, -fh + 20], about: "the beam" };
      parts.fulcrum = { node: `${id}.fulcrum`, anchor: [fx, -fh], about: "the fulcrum" };
      states.tip = { type: "angle", about: "the beam's tilt, degrees (positive: the right end goes down)", min: -45, max: 45, initial: 0 };
      // The beam can tip until an end touches the ground.
      const maxTip = (Math.asin(Math.min(1, fh / Math.max(1, Math.max(fx + W / 2, W / 2 - fx)))) * 180) / Math.PI;
      verbs.tips = { about: "tips to an angle (to the ground when none is given)", sets: [{ state: "tip", arg: true, value: maxTip }], arg: "angle" };
      verbs.tilts = verbs.tips;
      verbs.balances = { about: "comes level", sets: [{ state: "tip", value: 0 }] };
      verbs.lifts = { about: "its right end lifts as the left goes down", sets: [{ state: "tip", value: -maxTip }] };
      draw = (s): Record<string, Props> => ({ [`${id}.beam`]: { rotate: Number(s.tip) } });
      pivot = [fx, -fh];
    } else if (form === "spring") {
      W = 320;
      H = 1000;
      const coils = Math.max(2, Math.round(c.param<number>("coils") ?? 8));
      const plate = 30;
      const coilPts = (stretch: number): Pt[] => {
        const h = (H - plate * 2) * stretch;
        return Array.from({ length: coils * 2 + 3 }, (_, i) => {
          if (i === 0) return [0, -plate] as Pt;
          if (i === coils * 2 + 2) return [0, -plate - h] as Pt;
          const t = (i - 0.5) / (coils * 2 + 1);
          return [(i % 2 ? 1 : -1) * W * 0.4, -plate - h * t] as Pt;
        });
      };
      add(`${id}.base`, "path", { ...line, points: flat(roundRect(-W / 2, -plate, W / 2, 0, 8)), closed: 1, fill: second });
      add(`${id}.coil`, "path", { ...line, strokeWidth: L * 1.3, fill: "none", stroke: metal === "paper" ? "ink" : metal });
      add(`${id}.top`, "path", { ...line, points: flat(roundRect(-W / 2, -plate, W / 2, 0, 8)), closed: 1, fill: second });
      parts.coil = { node: `${id}.coil`, anchor: [0, -H / 2], about: "the coil" };
      parts.end = { node: `${id}.top`, anchor: [0, -H], about: "the free end" };
      states.stretch = { type: "number", about: "length as a share of its length at rest", min: 0.15, max: 2.5, initial: 1 };
      verbs.stretches = { about: "stretches to a share of its rest length", sets: [{ state: "stretch", arg: true }], arg: "number" };
      verbs.compresses = { about: "compresses to a share of its rest length", sets: [{ state: "stretch", arg: true }], arg: "number" };
      verbs.releases = { about: "springs back to rest", sets: [{ state: "stretch", value: 1 }], ease: "elastic" };
      verbs.bounces = { about: "bounces and settles", sets: [{ state: "stretch", arg: true }], arg: "number", motion: "shake" };
      draw = (s): Record<string, Props> => {
        const st = Number(s.stretch);
        return { [`${id}.coil`]: { points: flat(coilPts(st)) }, [`${id}.top`]: { y: -plate - (H - plate * 2) * st } };
      };
      pivot = [0, 0];
    } else if (form === "piston") {
      W = 420;
      H = 1000;
      const cylH = H * 0.62;
      const headH = 90;
      // A cylinder closed at the top; the rod leaves through the open bottom. Drawn with the piston pulled out.
      const run = cylH - headH - L * 3;
      const headTop = -H + cylH - headH - L;
      add(`${id}.cylback`, "path", { points: flat(roundRect(-W / 2, -H, W / 2, -H + cylH, 0)), closed: 1, fill: "ink", opacity: 0.08, stroke: "none" });
      add(`${id}.gas`, "path", { closed: 1, fill: c.col("gas") ?? "accent", opacity: 0.25, stroke: "none" });
      add(`${id}.ram`, "group", {});
      add(`${id}.rod`, "path", { ...line, points: flat(roundRect(-W * 0.09, headTop + headH, W * 0.09, 0, 10)), closed: 1, fill: metal }, `${id}.ram`);
      add(`${id}.head`, "path", { ...line, points: flat(roundRect(-W / 2 + L, headTop, W / 2 - L, headTop + headH, 14)), closed: 1, fill: second }, `${id}.ram`);
      add(`${id}.cylinder`, "path", { ...line, points: flat([[-W / 2, -H + cylH], [-W / 2, -H], [W / 2, -H], [W / 2, -H + cylH]]), fill: "none" });
      parts.piston = { node: `${id}.ram`, anchor: [0, headTop], about: "the piston head" };
      parts.cylinder = { node: `${id}.cylinder`, anchor: [0, -H + cylH / 2], about: "the cylinder" };
      parts.gas = { node: `${id}.gas`, anchor: [0, -H + cylH / 3], about: "what is trapped above the piston" };
      states.stroke = { type: "number", about: "how far the piston is pushed in, 0 out to 1 in", min: 0, max: 1, initial: 0 };
      verbs.pushes = { about: "pushes in (all the way when no share is given)", sets: [{ state: "stroke", arg: true, value: 1 }], arg: "number" };
      verbs.compresses = verbs.pushes;
      verbs.pulls = { about: "pulls out", sets: [{ state: "stroke", arg: true, value: 0 }], arg: "number" };
      verbs.expands = verbs.pulls;
      draw = (s): Record<string, Props> => {
        const dy = -run * Number(s.stroke);
        return { [`${id}.ram`]: { y: dy }, [`${id}.gas`]: { points: flat([[-W / 2 + L, -H + L], [W / 2 - L, -H + L], [W / 2 - L, headTop + dy], [-W / 2 + L, headTop + dy]]) } };
      };
      pivot = [0, -H / 2];
    } else if (form === "hinge") {
      W = 1000;
      H = 700;
      const leaf = 470;
      const knuckle = 40;
      add(`${id}.fixed`, "path", { ...line, points: flat(roundRect(-leaf, -H, 0, 0, 10)), closed: 1, fill: metal });
      add(`${id}.leaf`, "group", { x: 0, y: 0 });
      add(`${id}.leafshape`, "path", { ...line, points: flat(roundRect(0, -H, leaf, 0, 10)), closed: 1, fill: isHex(metal) ? mixHex(metal, "#ffffff", 0.15) : second }, `${id}.leaf`);
      add(`${id}.pin`, "path", { ...line, points: flat(roundRect(-knuckle / 2, -H, knuckle / 2, 0, knuckle / 2)), closed: 1, fill: "ink" });
      parts.leaf = { node: `${id}.leaf`, anchor: [leaf / 2, -H / 2], about: "the moving leaf" };
      parts.pin = { node: `${id}.pin`, anchor: [0, -H / 2], about: "the pin" };
      states.open = { type: "number", about: "0 closed flat to 1 opened toward the viewer", min: 0, max: 1, initial: 0 };
      verbs.opens = { about: "opens", sets: [{ state: "open", arg: true, value: 1 }], arg: "number" };
      verbs.closes = { about: "closes", sets: [{ state: "open", value: 0 }] };
      // Seen from the front, a leaf swinging toward the viewer narrows as cos(angle).
      draw = (s): Record<string, Props> => ({ [`${id}.leaf`]: { scaleX: Math.max(0.02, Math.cos(Number(s.open) * Math.PI * 0.5)) } });
      pivot = [0, -H / 2];
    } else if (form === "pulley") {
      W = 620;
      H = 1000;
      const r = 150;
      const cy = -H + 70 + r;
      const travel = clamp(c.param<number>("travel") ?? 0.45, 0.05, 0.8) * H;
      const loadS = 200;
      const loadY0 = -loadS; // the load's top at rest on the ground
      add(`${id}.mount`, "path", { ...line, points: flat([[-W / 2, -H], [W / 2, -H]]), fill: "none", strokeWidth: L * 1.6 });
      add(`${id}.hanger`, "path", { ...line, points: flat([[0, -H], [0, cy]]), fill: "none" });
      add(`${id}.ropeL`, "path", { ...line, stroke: second, strokeWidth: L * 0.8, fill: "none" });
      add(`${id}.ropeR`, "path", { ...line, stroke: second, strokeWidth: L * 0.8, fill: "none" });
      add(`${id}.wheel`, "group", { y: cy });
      add(`${id}.wheelrim`, "path", { ...line, points: flat(ellipse(0, 0, r, undefined, 48)), closed: 1, fill: metal }, `${id}.wheel`);
      add(`${id}.wheelspoke`, "path", { ...line, points: flat([[-r * 0.7, 0], [r * 0.7, 0]]), fill: "none" }, `${id}.wheel`);
      add(`${id}.wheelhub`, "path", { ...line, points: flat(ellipse(0, 0, r * 0.18, undefined, 16)), closed: 1, fill: "ink" }, `${id}.wheel`);
      add(`${id}.load`, "path", { ...line, points: flat(roundRect(-r - loadS / 2, 0, -r + loadS / 2, loadS, 14)), closed: 1, fill: c.col("load") ?? second });
      add(`${id}.handle`, "path", { ...line, points: flat(ellipse(r, 0, 26, undefined, 16)), closed: 1, fill: "ink" });
      parts.load = { node: `${id}.load`, anchor: [-r, -loadS / 2], about: "the load" };
      parts.rope = { node: `${id}.ropeR`, anchor: [r, cy + 200], about: "the free end of the rope" };
      parts.wheel = { node: `${id}.wheel`, anchor: [0, cy], about: "the pulley wheel" };
      states.lift = { type: "number", about: "how far the load is raised, 0 on the ground to 1 at the top of its travel", min: 0, max: 1, initial: 0 };
      verbs.lifts = { about: "the load rises (all the way when no share is given)", sets: [{ state: "lift", arg: true, value: 1 }], arg: "number" };
      verbs.raises = verbs.lifts;
      verbs.lowers = { about: "the load comes down", sets: [{ state: "lift", arg: true, value: 0 }], arg: "number" };
      draw = (s): Record<string, Props> => {
        const up = Number(s.lift) * travel;
        const loadTop = loadY0 - up;
        const freeEnd = Math.min(-loadS - 10 + up, -60);
        return {
          [`${id}.load`]: { y: loadTop },
          [`${id}.ropeL`]: { points: flat([[-r, cy], [-r, loadTop]]) },
          [`${id}.ropeR`]: { points: flat([[r, cy], [r, freeEnd]]) },
          [`${id}.handle`]: { y: freeEnd },
          // The wheel turns one radian for every radius of rope that runs over it.
          [`${id}.wheel`]: { rotate: (-up / r) * (180 / Math.PI) },
        };
      };
      pivot = [0, -H / 2];
    }
    return { box: { w: W, h: H }, pivot, nodes, parts, states, verbs, draw, anchors: Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, () => p.anchor])) };
  },
};
