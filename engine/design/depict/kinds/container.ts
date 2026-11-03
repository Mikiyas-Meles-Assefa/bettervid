// Containers: any vessel from a profile (a glass, a flask, a jar, a bucket, a tank, a burette, a funnel, a vial, a
// bottle, a bathtub in section), holding contents in layers with a level and a color, bubbles and a settling solid,
// with an outlet and tap, a scale that can be read, a lid, a spout. The liquid stays level when the vessel tilts.
import type { NodeSpec, Props } from "../../../core/types.ts";
import type { KindDef } from "../make.ts";
import { clamp, ellipse, flat, isHex, lerp, mixHex, rounded, spread } from "../geom.ts";
import { sizeCm } from "../spec.ts";
import type { Change, Part, Pt, StateDef, StateMap, VerbDef } from "../types.ts";

type Layer = { name: string; color: string; level: number };
type Scale = { top: number; bottom: number; from: number; to: number; major: number; minor: number; unit?: string; side?: "left" | "right"; decimals?: number };

export const container: KindDef = {
  name: "container",
  about: "anything that holds contents you can see the level of: glassware, cups, jars, bottles, tanks, tubes, funnels, buckets, anything with an outlet, a tap or a scale on its side",
  params: {
    profile: "required. [halfWidth, height] pairs from the base to the rim: halfWidth as a share of the width (0 to 0.5), height as a share of the body's height (0 base to 1 rim). A tumbler: [[0.42,0],[0.5,1]]; a vase: [[0.3,0],[0.5,0.4],[0.2,0.85],[0.28,1]]",
    contents: "layers from the bottom up: [{name, level (0 to 1 of the inside height, the layer's top), color (a color name from `colors`)}]; empty when absent",
    wall: '"clear" (glass, plastic: contents show) or "solid" (contents hidden unless `cutaway`)',
    cutaway: "true to show the contents of a solid container",
    lip: "a rim that flares out, as a share of the width (0 for none)",
    spout: '"left" or "right": where it pours from',
    outlet: "{length (share of the whole height), width (share of the width), tap (true for a tap that opens and closes)}: a stem at the bottom that liquid leaves from",
    scale: "{top, bottom (the values at the upper and lower marks), from, to (the marks' heights, 0 to 1 of the body), major, minor (steps between ticks), unit, side, decimals}: graduations that can be read at the level",
    bubbles: "how many bubbles can rise through the contents (0 for none)",
    solid: "{color (a color name), count}: grains suspended in the contents that can settle to the bottom",
    lid: "true for a lid hinged at the left of the rim",
  },
  colors: { wall: "the wall, for a solid container", "<layer color names>": "each layer's color: facts from the material, such as the color an indicator turns", light: "the color of light around it when lit" },
  required: ["profile"],
  build(c) {
    const { id, L } = c;
    const real = sizeCm(c.spec) ?? { w: 1, h: 1.4 };
    const W = real.w >= real.h ? 1000 : (1000 * real.w) / real.h;
    const H = real.h >= real.w ? 1000 : (1000 * real.h) / real.w;
    const cmU = H / real.h; // local units per centimetre
    const profile = (c.param<Pt[]>("profile") ?? []).map(([hw, t]) => [clamp(hw, 0, 0.5) * W, clamp(t)] as Pt);
    const outlet = c.param<{ length?: number; width?: number; tap?: boolean }>("outlet");
    const oH = outlet ? clamp(outlet.length ?? 0.2, 0.02, 0.6) * H : 0;
    const oW = outlet ? Math.max(L * 1.6, clamp(outlet.width ?? 0.2, 0.02, 1) * W) / 2 : 0;
    const bodyH = H - oH;
    const yOf = (t: number) => -oH - t * bodyH;
    const hwAt = (t: number) => {
      for (let i = 1; i < profile.length; i++) {
        const [a, b] = [profile[i - 1]!, profile[i]!];
        if (t <= b[1] || i === profile.length - 1) return lerp(a[0], b[0], b[1] > a[1] ? clamp((t - a[1]) / (b[1] - a[1])) : 1);
      }
      return profile[0]?.[0] ?? W / 2;
    };
    const lip = clamp(c.param<number>("lip") ?? 0, 0, 0.3) * W;
    const spout = c.param<"left" | "right">("spout");
    const solidWall = c.param<string>("wall") === "solid";
    const showInside = !solidWall || !!c.param<boolean>("cutaway");
    const rimHW = hwAt(1);
    const r = L * 1.6; // outlines are drawn with soft corners about as round as the line is thick

    // The outline, right side from the base up; the left is its mirror.
    const right: Pt[] = [];
    if (outlet) {
      const taper = Math.min(oH * 0.4, Math.max(hwAt(0) - oW, L) * 1.4);
      right.push([oW * 0.55, 0], [oW, -oH * 0.15], [oW, -oH + taper], [hwAt(0), -oH]);
    } else right.push([0, 0], [hwAt(0), 0]);
    for (const [hw, t] of profile) if (t > 0 || !outlet) right.push([hw, yOf(t)]);
    const top = right.at(-1)!;
    if (spout === "right") right.push([top[0] + Math.max(lip, L * 2.2), top[1] - L * 1.4]);
    else if (lip > 0) right.push([top[0] + lip, top[1]]);
    const left: Pt[] = right.map(([x, y]) => [-x, y] as Pt).reverse();
    if (spout === "right" && lip > 0) left[0] = [-(top[0] + lip), top[1]];
    if (spout === "left") {
      left[0] = [-(top[0] + Math.max(lip, L * 2.2)), top[1] - L * 1.4];
      if (lip > 0) right[right.length - 1] = [top[0] + lip, top[1]];
      else right.pop();
    }
    const outlinePts = rounded([...left, ...right.slice(outlet ? 0 : 1)], r, false);
    // The cavity: inside the walls, for the glass, the contents' clip and the volume.
    const inset = L * 0.9;
    const cav: Pt[] = [];
    const cavBottom = outlet ? -oH - inset : -inset;
    const ts = Array.from({ length: 33 }, (_, i) => i / 32);
    for (const t of ts) cav.push([Math.max(L * 0.3, hwAt(t) - inset), t === 0 ? cavBottom : yOf(t)]);
    const cavity = rounded([...cav.map(([x, y]) => [-x, y] as Pt).reverse(), ...cav], r * 0.8, true);
    const insideH = Math.abs(yOf(1) - cavBottom);
    const yLevel = (lv: number) => cavBottom - clamp(lv) * insideH;
    const tOfY = (y: number) => clamp((-y - oH) / bodyH);

    // Contents
    const layersIn = c.param<{ name: string; level: number; color: string }[]>("contents") ?? [];
    const colorOf = (name: string) => c.col(name) ?? (isHex(name) ? name : name);
    const layers: Layer[] = layersIn.map((l) => ({ name: l.name, level: clamp(l.level), color: colorOf(l.color) }));
    const topLayer = layers.at(-1);
    const nBub = Math.max(0, Math.round(c.param<number>("bubbles") ?? 0));
    const solid = c.param<{ color: string; count: number }>("solid");
    const scale = c.param<Scale>("scale");
    const lid = !!c.param<boolean>("lid");

    const nodes: NodeSpec[] = [];
    const add = (nid: string, kind: "group" | "path" | "text", props: Props, parent = `${id}.body`) => nodes.push({ id: nid, kind, parent, props });
    const ink = "ink";
    const lineP = { stroke: ink, strokeWidth: L, lineJoin: "round", lineCap: "round", fill: "none" };

    // Back of the glass: a faint fill so the inside reads as a volume, not a hole in the page.
    if (!solidWall) add(`${id}.glass`, "path", { points: flat(cavity), closed: 1, fill: ink, opacity: 0.07 * c.look.shine.value + 0.02, stroke: "none" });
    if (solidWall) add(`${id}.wallfill`, "path", { points: flat([...outlinePts]), closed: 1, fill: c.col("wall") ?? "paper", stroke: "none" });
    add(`${id}.contents`, "group", { clip: flat(cavity), opacity: showInside ? 1 : 0 });
    // Layers: each runs from its top to the bottom; lower layers are drawn over the upper ones.
    const ordered = [...layers].reverse();
    ordered.forEach((l) => add(`${id}.liq.${l.name}`, "path", { closed: 1, stroke: "none" }, `${id}.contents`));
    if (topLayer) add(`${id}.surf`, "path", { strokeWidth: L * 0.55, lineCap: "round", fill: "none" }, `${id}.contents`);
    const solidPts = solid ? spread(Math.max(1, Math.round(solid.count))) : [];
    const grainR = Math.max(L * 0.5, 0.12 * cmU);
    if (solid) solidPts.forEach((_, i) => add(`${id}.grain.${i}`, "path", { closed: 1, fill: colorOf(solid.color), stroke: "none", points: flat(ellipse(0, 0, grainR, undefined, 10)) }, `${id}.contents`));
    const bubR = Math.max(L * 0.7, 0.18 * cmU);
    const bubPts = spread(nBub, 3);
    for (let i = 0; i < nBub; i++) add(`${id}.bub.${i}`, "path", { closed: 1, fill: "none", stroke: ink, strokeWidth: L * 0.35, points: flat(ellipse(0, 0, bubR * (0.6 + 0.6 * bubPts[i]![1]), undefined, 12)) }, `${id}.contents`);
    // Highlight down the glass, the outline over everything.
    if (!solidWall && c.look.shine.value > 0) {
      const hx = (t: number) => -(hwAt(t) - inset - L * 1.2);
      const hl: Pt[] = [0.12, 0.3, 0.5, 0.62].map((t) => [hx(t), yOf(t)] as Pt);
      add(`${id}.shine`, "path", { points: flat(hl), stroke: ink, strokeWidth: L * 0.7, lineCap: "round", fill: "none", opacity: 0.32 * c.look.shine.value });
    }
    add(`${id}.outline`, "path", { ...lineP, points: flat(outlinePts) });

    // Scale
    const parts: Record<string, Part> = {
      body: { node: `${id}.outline`, anchor: [0, yOf(0.5)], box: [-W / 2, -H, W / 2, 0], about: "the vessel's wall" },
      mouth: { node: `${id}.outline`, anchor: [spout === "left" ? -rimHW : spout === "right" ? rimHW : 0, yOf(1)], about: "where things go in or pour out" },
    };
    if (topLayer) parts.contents = { node: `${id}.contents`, anchor: [0, yLevel(topLayer.level / 2)], about: "what it holds" };
    if (topLayer) parts.surface = { node: `${id}.surf`, anchor: [0, yLevel(topLayer.level)], about: "the top of the contents" };
    const valueAtT = (t: number) => (scale ? scale.bottom + ((scale.top - scale.bottom) * (t - scale.from)) / (scale.to - scale.from) : 0);
    const tAtValue = (v: number) => (scale ? scale.from + ((v - scale.bottom) * (scale.to - scale.from)) / (scale.top - scale.bottom) : 0);
    if (scale) {
      const side = scale.side === "left" ? -1 : 1;
      const lo = Math.min(scale.top, scale.bottom);
      const hi = Math.max(scale.top, scale.bottom);
      const eps = scale.minor / 1000;
      add(`${id}.scale`, "group", {});
      let i = 0;
      for (let v = lo; v <= hi + eps; v += scale.minor, i++) {
        const t = tAtValue(v);
        const y = yOf(t);
        const big = Math.abs(v / scale.major - Math.round(v / scale.major)) < 1e-6;
        const hw = hwAt(t);
        const len = Math.max(L * 1.5, hw * (big ? 0.55 : 0.32));
        add(`${id}.tick.${i}`, "path", { points: flat([[side * hw, y], [side * (hw - len), y]]), stroke: ink, strokeWidth: L * (big ? 0.5 : 0.3), opacity: 0.85, fill: "none" }, `${id}.scale`);
        if (big) add(`${id}.num.${i}`, "text", { x: side * (hw + (c.text ?? 0) * 0.35 + L) + (side > 0 ? 1 : -1) * (c.text ?? 0) * 0.6, y, text: String(Math.round(v * 1000) / 1000), size: c.text ?? 1, role: "label", color: ink, opacity: c.text ? 0.9 : 0 }, `${id}.scale`);
      }
      parts.scale = { node: `${id}.scale`, anchor: [side * hwAt(0.5), yOf((scale.from + scale.to) / 2)], about: `graduations from ${scale.bottom} to ${scale.top} ${scale.unit ?? ""}`.trim() };
    }
    // Outlet and tap
    if (outlet) {
      parts.outlet = { node: `${id}.outline`, anchor: [0, 0], about: "the tip liquid leaves from" };
      if (outlet.tap) {
        const ty = -oH * 0.55;
        add(`${id}.tapbody`, "path", { points: flat(rounded([[-oW * 1.9, ty - oW * 1.3], [oW * 1.9, ty - oW * 1.3], [oW * 1.9, ty + oW * 1.3], [-oW * 1.9, ty + oW * 1.3]], oW * 0.6, true)), closed: 1, fill: ink, stroke: "none" });
        add(`${id}.tap`, "group", { y: ty });
        const hl = Math.max(oW * 5, W * 0.9);
        add(`${id}.handle`, "path", { points: flat(rounded([[-hl, -oW * 0.55], [-oW, -oW * 0.55], [-oW, oW * 0.55], [-hl, oW * 0.55]], oW * 0.5, true)), closed: 1, fill: ink, stroke: "none" }, `${id}.tap`);
        parts.tap = { node: `${id}.tap`, anchor: [0, ty], about: "the tap that opens and closes the outlet" };
      }
    }
    if (lid) {
      const lt = Math.max(L * 2.4, H * 0.04);
      add(`${id}.lid`, "group", { x: -rimHW - lip, y: yOf(1) });
      add(`${id}.lidshape`, "path", { points: flat(rounded([[0, -lt], [2 * (rimHW + lip), -lt], [2 * (rimHW + lip), 0], [0, 0]], lt * 0.4, true)), closed: 1, fill: c.col("wall") ?? "paper", stroke: ink, strokeWidth: L }, `${id}.lid`);
      parts.lid = { node: `${id}.lid`, anchor: [0, yOf(1) - lt / 2], about: "the lid" };
    }
    if (nBub) parts.bubbles = { node: `${id}.contents`, anchor: [0, yLevel((topLayer?.level ?? 0.5) / 2)], about: "bubbles in the contents" };
    if (solid) parts.solid = { node: `${id}.contents`, anchor: [0, cavBottom], about: "grains in the contents" };

    // States
    const states: Record<string, StateDef> = {};
    if (topLayer) {
      states.level = { type: "number", about: "how full: the top of the contents, 0 to 1 of the inside height", min: 0, max: 1, initial: topLayer.level };
      states.color = { type: "color", about: "the color of the top layer", initial: topLayer.color };
      for (const l of layers.slice(0, -1)) {
        states[`level.${l.name}`] = { type: "number", about: `the top of the ${l.name} layer`, min: 0, max: 1, initial: l.level };
        states[`color.${l.name}`] = { type: "color", about: `the color of the ${l.name} layer`, initial: l.color };
      }
      states.slosh = { type: "angle", about: "how far the surface swings from level, degrees", initial: 0 };
    }
    if (nBub) states.bubbles = { type: "number", about: "how many of the bubbles show, 0 to 1", min: 0, max: 1, initial: 0 };
    if (solid) states.settle = { type: "number", about: "0 grains spread through the contents, 1 settled on the bottom", min: 0, max: 1, initial: 0 };
    if (outlet?.tap || lid) states.open = { type: "number", about: outlet?.tap ? "the tap: 0 closed, 1 open" : "the lid: 0 closed, 1 open", min: 0, max: 1, initial: 0 };

    const lvlOf = (s: StateMap, name: string) => Number(name === topLayer?.name ? s.level : s[`level.${name}`]);
    const colOf = (s: StateMap, name: string) => String(name === topLayer?.name ? s.color : s[`color.${name}`]);
    const shade = c.look.shade.value;
    const paint = (color: string) => (shade > 0 && isHex(color) ? `linear(90, ${mixHex(color, "#ffffff", 0.12 * shade)} 0, ${mixHex(color, "#000000", 0.28 * shade)} 1)` : color);
    const men = L * 0.7; // a meniscus about as deep as the glass is thick
    const span = W; // the liquid's rectangle is wider than the vessel; the cavity clips it
    // The top edge with a meniscus: flat in the middle, climbing the wall at the sides. Fixed point count, so it morphs.
    const US = [1, 0.9, 0.75, 0.5, 0, 0.5, 0.75, 0.9, 1];
    const topEdge = (lv: number): Pt[] => {
      const hwL = Math.max(L * 0.5, hwAt(tOfY(yLevel(lv))) - inset);
      return [[-span, -men], ...US.map((u, i) => [(i < 4 ? -1 : 1) * hwL * u, -men * Math.pow(u, 6)] as Pt), [span, -men]];
    };

    const draw = (s: StateMap): Record<string, Props> => {
      const out: Record<string, Props> = {};
      const tilt = -Number(s.angle ?? 0) + Number(s.slosh ?? 0);
      for (const l of layers) {
        const lv = lvlOf(s, l.name);
        const yl = yLevel(lv);
        const depth = Math.max(0, yl - cavBottom) + insideH + L * 4;
        const shape: Pt[] = [...topEdge(lv), [span, depth], [-span, depth]];
        out[`${id}.liq.${l.name}`] = { x: 0, y: r1(yl), rotate: tilt, points: flat(shape), fill: paint(colOf(s, l.name)), opacity: lv > 0.001 ? 1 : 0 };
      }
      if (topLayer) {
        const lv = Number(s.level);
        const col = String(s.color);
        out[`${id}.surf`] = { x: 0, y: r1(yLevel(lv)), rotate: tilt, points: flat(topEdge(lv).slice(1, -1)), stroke: isHex(col) ? mixHex(col, "#ffffff", 0.45) : "ink", opacity: lv > 0.001 ? 0.9 : 0 };
      }
      if (solid) {
        const lv = topLayer ? Number(s.level) : 1;
        const st = Number(s.settle ?? 0);
        // Settled grains make a low mound: its area is what the grains cover packed loosely (about 60%).
        const hwB = Math.max(L, hwAt(0.02) - inset - grainR);
        const mound = (solidPts.length * Math.PI * grainR * grainR) / 0.6 / ((4 / 3) * hwB);
        solidPts.forEach(([u, v], i) => {
          const susp: Pt = [lerp(-1, 1, u) * (hwAt(v * lv) - inset - L * 1.5), lerp(cavBottom - L, yLevel(lv) + L * 2, v)];
          const x = lerp(-1, 1, u) * hwB;
          const pile: Pt = [x, cavBottom - grainR * 0.8 - v * mound * (1 - (x / hwB) ** 2)];
          out[`${id}.grain.${i}`] = { x: r1(lerp(susp[0], pile[0], st)), y: r1(lerp(susp[1], pile[1], st)) };
        });
      }
      if (nBub) {
        const lv = Number(s.level ?? 0.5);
        const on = Number(s.bubbles ?? 0);
        bubPts.forEach(([u, v], i) => {
          const y = lerp(cavBottom - bubR * 2, yLevel(lv) + bubR * 2, v);
          out[`${id}.bub.${i}`] = { x: r1(lerp(-1, 1, u) * Math.max(0, hwAt(tOfY(y)) - inset - bubR * 2)), y: r1(y), opacity: i < on * nBub - 1e-9 ? 0.8 : 0 };
        });
      }
      if (outlet?.tap) out[`${id}.tap`] = { rotate: Number(s.open ?? 0) * 90 };
      if (lid) out[`${id}.lid`] = { rotate: -Number(s.open ?? 0) * 110 };
      return out;
    };

    // Volume: the profile turned about its axis, in cm^3 (mL), from the real size.
    const cmPerU = 1 / cmU;
    const volTo = (lv: number) => {
      const n = 64;
      let v = 0;
      const yTop = yLevel(lv);
      for (let i = 0; i < n; i++) {
        const y = lerp(cavBottom, yTop, (i + 0.5) / n);
        const rr = hwAt(tOfY(y)) * cmPerU; // the profile is the inside: drawn wall thickness is not physical
        v += Math.PI * rr * rr * (Math.abs(yTop - cavBottom) / n) * cmPerU;
      }
      return v;
    };
    // A scale in a unit of volume is the vessel's own calibration: the volume between two marks is what the marks say,
    // so a transfer and a reading agree. The drawn size gives the shape (where the vessel is wide or narrow); the
    // scale gives the amount. Without a volume scale the real size alone gives the volume.
    const perUnit = scale ? volumeUnit(scale.unit) : undefined;
    const levelAtT = (t: number) => clamp((cavBottom - yOf(t)) / insideH);
    const geomSpan = scale ? Math.abs(volTo(levelAtT(scale.to)) - volTo(levelAtT(scale.from))) : 0;
    const calib = perUnit && geomSpan > 0 && scale!.top !== scale!.bottom ? (Math.abs(scale!.top - scale!.bottom) * perUnit) / geomSpan : 1;
    const volAt = (lv: number) => calib * volTo(lv);
    const full = volAt(1);
    const capacity = { unit: "mL", at: volAt, levelOf: (ml: number) => {
      let [a, b] = [0, 1];
      for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (volAt(m) < ml) a = m; else b = m; }
      return clamp((a + b) / 2);
    } };

    const verbs: Record<string, VerbDef> = {};
    if (topLayer) {
      Object.assign(verbs, {
        fills: { about: "fills to a level (full when none is given)", sets: [{ state: "level", arg: true, value: 1 }], arg: "number" },
        empties: { about: "empties", sets: [{ state: "level", value: 0 }] },
        drains: { about: "drains to a level (empty when none is given)", sets: [{ state: "level", arg: true, value: 0 }], arg: "number" },
        turns: { about: "its contents change to a color and stay", sets: [{ state: "color", arg: true }], arg: "color" },
        "changes to": { about: "its contents change to a color and stay", sets: [{ state: "color", arg: true }], arg: "color" },
        flashes: { about: "its contents flash a color and go back", sets: [{ state: "color", arg: true }], arg: "color", motion: "pulse" },
        swirls: { about: "the contents swing and settle level", sets: [{ state: "slosh", value: "@slosh" }], motion: "shake" },
        sloshes: { about: "the contents swing and settle level", sets: [{ state: "slosh", value: "@slosh" }], motion: "shake" },
        pours: { about: "tips until the contents reach the rim", sets: [{ state: "angle", value: "@pourAngle" }], needs: ["mouth"] },
        "pours into": { about: "pours into another thing (the caller moves the contents)", sets: [{ state: "angle", value: "@pourAngle" }], target: true, needs: ["mouth"] },
        reads: { about: "is read at its level", sets: [], needs: ["scale"] },
      });
      if (outlet) verbs["drips into"] = { about: "drips from its outlet into another thing (the caller moves the contents)", sets: outlet.tap ? [{ state: "open", value: 1 }] : [], target: true, needs: ["outlet"] };
      if (outlet) verbs["runs into"] = { about: "runs from its outlet into another thing", sets: outlet.tap ? [{ state: "open", value: 1 }] : [], target: true, needs: ["outlet"] };
    }
    if (nBub) Object.assign(verbs, { bubbles: { about: "bubbles rise through it", sets: [{ state: "bubbles", value: 1 }], needs: ["bubbles"] }, fizzes: { about: "bubbles rise through it", sets: [{ state: "bubbles", value: 1 }], needs: ["bubbles"] }, boils: { about: "bubbles rise through it", sets: [{ state: "bubbles", value: 1 }], needs: ["bubbles"] } });
    if (solid) Object.assign(verbs, { settles: { about: "its grains settle to the bottom", sets: [{ state: "settle", value: 1 }], needs: ["solid"] }, stirs: { about: "its grains are stirred up", sets: [{ state: "settle", value: 0 }], needs: ["solid"] }, dissolves: { about: "its grains vanish into the contents", sets: [{ state: "settle", value: 0 }], needs: ["solid"] } });
    if (outlet?.tap || lid) Object.assign(verbs, { opens: { about: "opens", sets: [{ state: "open", value: 1 }] }, closes: { about: "closes", sets: [{ state: "open", value: 0 }] } });

    const spillAngle = (s: StateMap) => {
      const room = Math.abs(yOf(1) - yLevel(Number(s.level ?? 0)));
      return (Math.atan2(room, Math.max(1, rimHW)) * 180) / Math.PI;
    };
    return {
      box: { w: W, h: H },
      pivot: [0, 0],
      nodes,
      parts,
      states,
      verbs,
      draw,
      anchors: {
        mouth: () => parts.mouth!.anchor,
        surface: (s) => [0, yLevel(Number(s.level ?? 0))],
        bottom: () => [0, cavBottom],
        outlet: () => (outlet ? [0, 0] : parts.mouth!.anchor),
      },
      computed: {
        // Tipped just far enough that the surface reaches the rim on the pouring side.
        pourAngle: (s) => (spout === "left" ? -1 : 1) * Math.min(100, spillAngle(s) + 4),
        // A swirl swings the surface a third of the way to spilling.
        slosh: (s) => spillAngle(s) / 3,
      },
      read: scale && topLayer ? (s) => {
        const v = valueAtT(tOfY(yLevel(Number(s.level))));
        return `${v.toFixed(scale.decimals ?? 2)}${scale.unit ? ` ${scale.unit}` : ""}`;
      } : undefined,
      levelAt: scale && topLayer ? (v) => levelAtT(tAtValue(v)) : undefined,
      minorLevel: scale && topLayer ? Math.abs(levelAtT(tAtValue(scale.minor)) - levelAtT(tAtValue(0))) : undefined,
      animate: nBub ? (from, to, t) => {
        // Bubbles rise at about 25 cm/s (small bubbles in water); each starts at its own phase and loops.
        if (!(Number(to.bubbles) > 0)) return [];
        const fps = t.fps ?? 30;
        const rise = Math.max(4, Math.round(((insideH * Number(to.level ?? 0.5)) / cmU / 25) * fps));
        const out: Change[] = [];
        bubPts.forEach(([, v], i) => {
          if (!(i < Number(to.bubbles) * nBub)) return;
          const b = `${id}.bub.${i}`;
          const y0 = cavBottom - bubR * 2;
          const y1 = yLevel(Number(to.level ?? 0.5)) + bubR;
          for (let at = Math.round(v * rise) - rise; at < t.frames; at += rise) {
            if (at + rise <= 0) continue;
            const a0 = Math.max(0, at);
            const startY = at < 0 ? lerp(y0, y1, -at / rise) : y0;
            out.push({ id: b, prop: "y", value: r1(startY), at: a0, frames: 1, ease: "step" });
            out.push({ id: b, prop: "y", value: r1(y1), at: a0 + 1, frames: Math.max(1, at + rise - a0 - 1), ease: "linear" });
          }
        });
        return out;
      } : undefined,
      capacity: full > 0 ? capacity : undefined,
      notes: [
        ...(scale && !c.text ? [`${c.spec.label}: scale numbers are hidden until a text size is given`] : []),
        ...(calib !== 1 ? [`${c.spec.label}: volumes follow its ${scale!.unit} scale (the drawn size alone would hold ${(volTo(1) / 1).toFixed(0)} mL, the scale says ${full.toFixed(0)} mL)`] : []),
        `${c.spec.label}: holds about ${full >= 1000 ? `${(full / 1000).toFixed(2)} L` : `${full.toFixed(full < 10 ? 2 : 0)} mL`} when full`,
      ],
    };
  },
};
const r1 = (v: number) => Math.round(v * 10) / 10;

// Units of volume in mL: physical facts, so a scale in any of them calibrates the vessel.
const VOLUME: Record<string, number> = { ml: 1, millilitre: 1, milliliter: 1, cl: 10, dl: 100, l: 1000, litre: 1000, liter: 1000, cm3: 1, cc: 1, m3: 1e6, mm3: 0.001, ul: 0.001, "µl": 0.001, "μl": 0.001, floz: 29.5735, cup: 236.588, pt: 473.176, pint: 473.176, qt: 946.353, gal: 3785.41, gallon: 3785.41, in3: 16.3871, ft3: 28316.8 };
/** mL per unit of a scale's unit, or undefined when it is not a unit of volume. */
export function volumeUnit(unit: string | undefined): number | undefined {
  if (!unit) return undefined;
  const k = unit.toLowerCase().replace(/[\s.]/g, "").replace(/³/g, "3").replace(/s$/, "");
  return VOLUME[k];
}
