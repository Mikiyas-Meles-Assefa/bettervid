// Scales and gauges: anything read off marks. A graduated tube with a column, a thermometer, a ruler or slider with a
// marker, a dial with a needle (a speedometer, a pressure gauge, a meter). The value is a state in the scale's units.
import type { NodeSpec, Props } from "../../../core/types.ts";
import type { KindDef } from "../make.ts";
import { clamp, ellipse, flat, isHex, lerp, mixHex, rounded, roundRect } from "../geom.ts";
import { sizeCm } from "../spec.ts";
import type { Part, Pt, StateDef, StateMap, VerbDef } from "../types.ts";

type Scale = { from: number; to: number; major: number; minor: number; unit?: string; decimals?: number; labels?: (string | number)[] };

export const gauge: KindDef = {
  name: "gauge",
  about: "anything read off a scale: thermometers, measuring tubes, rulers, sliders, level bars, dials and meters with a needle",
  forms: { tube: "an upright graduated tube with a column that rises and falls", thermometer: "a tube with a bulb at the bottom", ruler: "a straight scale with a marker that slides along it", dial: "a round face with a needle that swings" },
  params: {
    scale: "required. {from, to (the ends' values), major, minor (steps between ticks), unit, decimals (for readings), labels (words for the major ticks, in order, instead of numbers)}",
    sweep: "for dial: the angle the scale spans in degrees (a full circle is 360)",
    horizontal: "for tube or ruler: true to lie flat",
  },
  colors: { column: "the column or needle color (a fact: mercury is silver, alcohol thermometers are red)", face: "the face or body color", "<zone names>": "colors it can turn" },
  required: ["scale"],
  build(c) {
    const { id, L } = c;
    const form = c.spec.form ?? "tube";
    const sc = c.param<Scale>("scale") ?? { from: 0, to: 1, major: 1, minor: 0.1 };
    const real = sizeCm(c.spec) ?? (form === "dial" ? { w: 10, h: 10 } : form === "ruler" ? { w: 30, h: 3 } : { w: 2, h: 20 });
    const flatLie = form === "ruler" || !!c.param<boolean>("horizontal");
    const aspect = form === "dial" ? 1 : real.w / real.h;
    const W = aspect >= 1 ? 1000 : 1000 * aspect;
    const H = aspect >= 1 ? 1000 / aspect : 1000;
    const colCol = c.col("column") ?? "accent";
    const face = c.col("face") ?? "paper";
    const fg = c.inkOn(face);
    const nodes: NodeSpec[] = [];
    const add = (nid: string, kind: "group" | "path" | "text", props: Props, parent = `${id}.body`) => nodes.push({ id: nid, kind, parent, props });
    const parts: Record<string, Part> = {};
    const frac = (v: number) => clamp((v - sc.from) / (sc.to - sc.from));
    const ticks: { v: number; big: boolean; i: number }[] = [];
    const lo = Math.min(sc.from, sc.to);
    const hi = Math.max(sc.from, sc.to);
    let ti = 0;
    for (let v = lo; v <= hi + sc.minor / 1000; v += sc.minor) ticks.push({ v, big: Math.abs(v / sc.major - Math.round(v / sc.major)) < 1e-6, i: ti++ });
    const label = (t: { v: number }, k: number) => String(sc.labels?.[k] ?? Math.round(t.v * 1000) / 1000);
    const T = c.text ?? 0;
    let drawFn: (s: StateMap) => Record<string, Props>;
    let anchors: Record<string, (s: StateMap) => Pt> = {};

    if (form === "dial") {
      const R = W / 2;
      const cy = -R;
      const sweep = clamp(c.param<number>("sweep") ?? 240, 10, 360);
      const a0 = -sweep / 2;
      const ang = (v: number) => a0 + frac(v) * sweep;
      const P = (a: number, r: number): Pt => [r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
      add(`${id}.face`, "path", { points: flat(ellipse(0, cy, R - L / 2, undefined, 64)), closed: 1, fill: face, stroke: "ink", strokeWidth: L });
      add(`${id}.arc`, "path", { points: flat(Array.from({ length: 41 }, (_, i) => P(a0 + (sweep * i) / 40, R * 0.8))), fill: "none", stroke: fg, strokeWidth: L * 0.45, opacity: 0.5 });
      add(`${id}.ticks`, "group", {});
      let k = 0;
      for (const t of ticks) {
        const a = ang(t.v);
        add(`${id}.tick.${t.i}`, "path", { points: flat([P(a, R * 0.8), P(a, R * (t.big ? 0.66 : 0.73))]), stroke: fg, strokeWidth: L * (t.big ? 0.6 : 0.35), fill: "none" }, `${id}.ticks`);
        if (t.big) add(`${id}.num.${t.i}`, "text", { x: P(a, R * 0.52)[0], y: P(a, R * 0.52)[1], text: label(t, k++), size: T || 1, role: "label", color: fg, opacity: T ? 0.9 : 0 }, `${id}.ticks`);
      }
      add(`${id}.needle`, "group", { y: cy });
      add(`${id}.needleline`, "path", { points: flat([[0, R * 0.14], [-L * 0.7, 0], [0, -R * 0.78], [L * 0.7, 0]]), closed: 1, fill: colCol, stroke: "none" }, `${id}.needle`);
      add(`${id}.hub`, "path", { points: flat(ellipse(0, cy, Math.max(L * 1.6, R * 0.07), undefined, 20)), closed: 1, fill: fg, stroke: "none" });
      parts.face = { node: `${id}.face`, anchor: [0, cy], box: [-R, -W, R, 0], about: "the dial face" };
      parts.needle = { node: `${id}.needle`, anchor: [0, cy], about: "the needle" };
      parts.scale = { node: `${id}.ticks`, anchor: [0, cy - R * 0.7], about: "the scale" };
      drawFn = (s): Record<string, Props> => ({ [`${id}.needle`]: { rotate: ang(Number(s.value)) }, [`${id}.needleline`]: { fill: String(s.color) } });
      anchors = { needle: (s) => P(ang(Number(s.value)), R * 0.78), center: () => [0, cy] };
    } else if (form === "ruler") {
      const bh = Math.min(H, W * 0.12);
      add(`${id}.bar`, "path", { points: flat(roundRect(-W / 2, -bh, W / 2, 0, L * 1.2)), closed: 1, fill: face, stroke: "ink", strokeWidth: L });
      const xOf = (v: number) => lerp(-W / 2 + L * 3, W / 2 - L * 3, frac(v));
      add(`${id}.ticks`, "group", {});
      let k = 0;
      for (const t of ticks) {
        const x = xOf(t.v);
        add(`${id}.tick.${t.i}`, "path", { points: flat([[x, -bh], [x, -bh + bh * (t.big ? 0.5 : 0.28)]]), stroke: fg, strokeWidth: L * (t.big ? 0.5 : 0.3), fill: "none" }, `${id}.ticks`);
        if (t.big) add(`${id}.num.${t.i}`, "text", { x, y: -bh * 0.3, text: label(t, k++), size: T || 1, role: "label", color: fg, opacity: T ? 0.9 : 0 }, `${id}.ticks`);
      }
      const mh = Math.max(bh * 0.9, L * 4);
      add(`${id}.marker`, "group", { y: -bh });
      add(`${id}.markershape`, "path", { points: flat([[0, 0], [-mh * 0.45, -mh], [mh * 0.45, -mh]]), closed: 1, fill: colCol, stroke: "ink", strokeWidth: L * 0.6 }, `${id}.marker`);
      parts.scale = { node: `${id}.ticks`, anchor: [0, -bh / 2], box: [-W / 2, -bh, W / 2, 0], about: "the scale" };
      parts.marker = { node: `${id}.marker`, anchor: [xOf(sc.from), -bh - mh], about: "the marker" };
      drawFn = (s): Record<string, Props> => ({ [`${id}.marker`]: { x: xOf(Number(s.value)) }, [`${id}.markershape`]: { fill: String(s.color) } });
      anchors = { marker: (s) => [xOf(Number(s.value)), -bh] };
    } else {
      // Tube and thermometer: upright (or lying flat, drawn upright and turned by the caller's pose).
      const tw = form === "thermometer" ? Math.min(W * 0.42, H * 0.06) : Math.min(W * 0.8, H * 0.2);
      const bulbR = form === "thermometer" ? tw * 1.25 : 0;
      const yb = form === "thermometer" ? -bulbR * 2 + bulbR * 0.3 : -L;
      const yt = -H + tw / 2 + L;
      const yOf = (v: number) => lerp(yb - tw * 0.4, yt + tw * 0.5, frac(v));
      const outline: Pt[] = form === "thermometer"
        ? ellipse(0, -bulbR, bulbR, undefined, 40, Math.asin(tw / 2 / bulbR), Math.PI * 2 - Math.asin(tw / 2 / bulbR))
        : [];
      const tube = rounded([[-tw / 2, form === "thermometer" ? -bulbR * 1.8 : 0], [-tw / 2, -H], [tw / 2, -H], [tw / 2, form === "thermometer" ? -bulbR * 1.8 : 0]], tw / 2, form !== "thermometer", 8);
      const outlinePts = form === "thermometer" ? [...tube, ...outline] : tube;
      add(`${id}.glass`, "path", { points: flat(outlinePts), closed: 1, fill: face, stroke: "none" });
      const cw = tw * 0.42;
      add(`${id}.column`, "path", { closed: 1, stroke: "none" });
      if (form === "thermometer") add(`${id}.bulb`, "path", { points: flat(ellipse(0, -bulbR, bulbR * 0.72, undefined, 32)), closed: 1, stroke: "none" });
      add(`${id}.outline`, "path", { points: flat(outlinePts), closed: 1, fill: "none", stroke: "ink", strokeWidth: L });
      add(`${id}.ticks`, "group", {});
      let k = 0;
      for (const t of ticks) {
        const y = yOf(t.v);
        add(`${id}.tick.${t.i}`, "path", { points: flat([[tw / 2 + L * 0.8, y], [tw / 2 + L * 0.8 + tw * (t.big ? 0.7 : 0.4), y]]), stroke: "ink", strokeWidth: L * (t.big ? 0.5 : 0.3), fill: "none" }, `${id}.ticks`);
        if (t.big) add(`${id}.num.${t.i}`, "text", { x: tw / 2 + L * 1.6 + tw * 0.7 + T * 0.9, y, text: label(t, k++), size: T || 1, role: "label", color: "ink", opacity: T ? 0.9 : 0 }, `${id}.ticks`);
      }
      const colPts = (v: number): Pt[] => [[-cw / 2, yOf(v)], [cw / 2, yOf(v)], [cw / 2, yb + (form === "thermometer" ? bulbR : 0)], [-cw / 2, yb + (form === "thermometer" ? bulbR : 0)]];
      parts.column = { node: `${id}.column`, anchor: [0, yOf(sc.from)], about: "the column" };
      parts.scale = { node: `${id}.ticks`, anchor: [tw, (yb + yt) / 2], box: [-tw / 2, -H, W / 2, 0], about: "the scale" };
      if (form === "thermometer") parts.bulb = { node: `${id}.bulb`, anchor: [0, -bulbR], about: "the bulb" };
      drawFn = (s): Record<string, Props> => ({
        [`${id}.column`]: { points: flat(colPts(Number(s.value))), fill: String(s.color) },
        ...(form === "thermometer" ? { [`${id}.bulb`]: { fill: String(s.color) } } : {}),
      });
      anchors = { top: (s) => [0, yOf(Number(s.value))] };
      if (flatLie) parts.scale.about += " (lying flat)";
    }
    const states: Record<string, StateDef> = {
      value: { type: "number", about: `the reading, ${sc.from} to ${sc.to}${sc.unit ? ` ${sc.unit}` : ""}`, min: lo, max: hi, initial: sc.from },
      color: { type: "color", about: "the column, needle or marker color", initial: colCol },
    };
    const go = (about: string): VerbDef => ({ about, sets: [{ state: "value", arg: true }], arg: "number" });
    const verbs: Record<string, VerbDef> = {
      rises: go("its reading goes up to a value"),
      climbs: go("its reading goes up to a value"),
      falls: go("its reading goes down to a value"),
      drops: go("its reading goes down to a value"),
      "goes to": go("its reading moves to a value"),
      reads: { about: "shows a value (its reading moves there when one is given)", sets: [{ state: "value", arg: true, value: "@value" }], arg: "number", needs: ["scale"] },
      swings: { about: "its reading swings to a value and settles back", sets: [{ state: "value", arg: true }], arg: "number", motion: "shake" },
      turns: { about: "its column or needle changes color", sets: [{ state: "color", arg: true }], arg: "color" },
    };
    const dec = sc.decimals ?? Math.max(0, Math.ceil(-Math.log10(sc.minor)));
    void isHex;
    void mixHex;
    return {
      box: { w: W, h: H },
      pivot: [0, -H / 2],
      nodes,
      parts,
      states,
      verbs,
      draw: drawFn,
      anchors,
      computed: { value: (s) => Number(s.value) },
      read: (s) => `${Number(s.value).toFixed(dec)}${sc.unit ? ` ${sc.unit}` : ""}`,
      notes: T ? [] : [`${c.spec.label}: scale numbers are hidden until a text size is given`],
    };
  },
};
