import assert from "node:assert/strict";
import { test } from "node:test";
import { themeFrom } from "../../render/theme.ts";
import { depictionFrom, sizeCm, type PropSpec } from "../depict/index.ts";
import { SAMPLES } from "../depict/samples.ts";
import { PLAIN_LOOK } from "../compose/acts.ts";
import { pack, usableRect } from "../compose/pack.ts";
import * as A from "./index.ts";

test("a fall takes physical time from its height and g; playback speed and a replay are parameters", () => {
  assert.ok(Math.abs(A.fallSeconds(1) - 0.4515) < 1e-3);
  assert.equal(A.fallSeconds(0), 0);
  const real = Math.round(A.fallSeconds(1) * 30);
  assert.equal(A.fallPlayFrames(real, 1, undefined, 0), real);
  assert.equal(A.fallPlayFrames(real, 0.25, undefined, 0), Math.round(real / 0.25));
  assert.equal(A.fallPlayFrames(real, 1, { speed: 0.5, pause: 10 }, 5), real + 5 + 10 + 1 + Math.round(real / 0.5));
  const w = new A.Writer(1000, 1000);
  w.node("ball", "group", { y: 100 });
  for (let j = 0; j < 2; j++) w.node(`ghost.ball.${j}`, "path", { points: A.ellipse(1, 1) });
  const res = A.playFall(w, [{ id: "ball", x: 500, y: 100, s: 1, d: 50, len: 400, fill: "" }], 10, { realFrames: real, speed: 1, replay: { speed: 0.5, pause: 6 }, squash: { amount: 0.1, frames: 3, settle: 8 }, trail: { marks: 2, opacity: 0.2, fadeAt: 200, fadeFrames: 10 } });
  assert.deepEqual(res.passes, [real, Math.round(real / 0.5)]);
  assert.equal(w.value("ball", "y"), 500);
});

test("a fall group keeps true relative sizes, bottoms level, room to fall, and a real scale", () => {
  const big: A.ObjShape = { w: 100, h: 100, realCm: { w: 21.8, h: 21.8 } };
  const small: A.ObjShape = { w: 100, h: 100, realCm: { w: 6.7, h: 6.7 } };
  const g = A.fallGroup([{ id: "a", shape: big }, { id: "b", shape: small }], { w: 800, h: 1200 }, new Set(), { bigShare: 0.4, gapShare: 0.1, minShare: 0.01, roomShare: 0.5, floorGap: 20 });
  const [a, b] = g.members;
  assert.ok(Math.abs(a!.w / b!.w - 21.8 / 6.7) < 1e-6);
  assert.equal(a!.dy, b!.dy);
  assert.ok(g.fall >= 0.5 * 1200 - 20 - 1e-6);
  assert.ok(Math.abs(g.pxPerM! - a!.w / 0.218) < 1e-6);
});

test("an apparatus puts the source's outlet over the vessel's mouth, inside its box", () => {
  const theme = themeFrom("flat");
  const shape = (name: string): A.ObjShape => {
    const spec = SAMPLES.find((x) => x.name === name)!.spec as PropSpec;
    const d = depictionFrom(spec, theme, { id: name, look: PLAIN_LOOK });
    const real = sizeCm(spec);
    return { w: d.box.w, h: d.box.h, outlet: d.anchor("outlet"), mouth: d.anchor("mouth"), ...(real ? { realCm: real } : {}) };
  };
  const ap = A.apparatus({ id: "s", shape: shape("burette") }, { id: "v", shape: shape("flask") }, [{ id: "c", shape: shape("stopwatch") }], { w: 900, h: 1400 }, { sourceShare: 0.5, gapShare: 0.04, sourceWidth: 0.5, vesselWidth: 0.7, satelliteShare: 0.2, satelliteGap: 40 });
  assert.ok(ap.h <= 1400 + 1e-6 && ap.w <= 900 + 1e-6);
  const [s, v, c] = ap.members;
  // The burette's outlet (its tip, at x 0) sits over the flask's mouth.
  assert.ok(Math.abs(s!.dx - v!.dx) < 1e-6);
  assert.ok(s!.dy < v!.dy - v!.h, "the source is above the vessel");
  assert.ok(Math.abs(c!.dx) >= v!.w / 2, "a satellite stands beside the vessel");
});

test("columns on one scale are proportional to their values", () => {
  assert.deepEqual(A.columnsOnOneScale([20, 35], 700, 5), [400, 700]);
  assert.deepEqual(A.columnsOnOneScale([0, 10], 100, 8), [8, 100]);
});

test("a redrawn chart starts exactly on the original's bars, in either orientation", () => {
  for (const orient of ["v", "h"] as const) {
    const data = { kind: "bars", orient, labels: ["a", "b"], values: [3, 6], ymax: 8, plot: [0.2, 0.1, 0.9, 0.8] as [number, number, number, number], barFrac: 0.5 };
    const parts = new Map([["left", [0, 0, 0.55, 1] as [number, number, number, number]]]);
    const chart: A.Chart = { name: "c", src: "", w: 1000, h: 500, about: "", parts, data, barsOf: A.barsOfParts(data, parts) };
    const st = { ...A.blankSt("ink"), x: 500, y: 250, w: 1000, h: 500 };
    const L: A.ChartLook = { small: 20, valueFs: 25, headBig: 60, headShare: 0.6, rowLine: 1.4, gap: 10, barFrac: 0.7, photoBarFrac: 0.7, dimBars: 0.2, dimText: 0.4, labelOpacity: 0.8, levelPad: 8, em: (t) => t.length * 0.6 };
    const g = A.chartGeom(st, chart, "photo", L);
    // On the original, bar 1 (value 6 of 8) spans 6/8 of the plot along its value axis.
    if (orient === "v") assert.ok(Math.abs(g.bars[1]!.y1 - g.bars[1]!.y0 - (6 / 8) * 0.7 * 500) < 1e-6);
    else assert.ok(Math.abs(g.bars[1]!.x1 - g.bars[1]!.x0 - (6 / 8) * 0.7 * 1000) < 1e-6);
    const photo = A.chartTargets("p.c", st, chart, "photo", new Set(), L, { subject: "ink", muted: "muted", pointer: "accent" });
    const pts = photo.find(([n, p]) => n === "p.c.bar1" && p === "points")![2] as number[];
    assert.deepEqual(pts.slice(0, 2), [Math.round(g.bars[1]!.x0 * 10) / 10, Math.round(g.bars[1]!.y0 * 10) / 10]);
    assert.ok(chart.barsOf.get("left")!.includes(0));
  }
});

test("a pointer leaves the words toward the part and ends at its edge", () => {
  const pts = A.pointerPoints({ x: 100, y: 800, w: 200, h: 60 }, { x0: 50, y0: 100, x1: 400, y1: 300 }, true, { gap: 10, head: 20, inset: 10 });
  assert.equal(pts[3], 305);
  assert.ok(pts[1]! < 800 - 30);
});

test("the packer keeps clear of UI zones and places blocks without overlap in every arrangement", () => {
  const { rect: U } = usableRect({ width: 1000, height: 1600, uiZones: [{ box: [0, 0.85, 1, 1], what: "captions" }] }, 50);
  assert.ok(U.y1 <= 0.85 * 1600);
  const items = [{ key: "q", w: 600, h: 100, before: true }, { key: "a", w: 500, h: 120, before: false }, { key: "b", w: 300, h: 80, before: false }];
  for (const arr of ["stack", "row", "around", "split", "inset"]) {
    const A0 = { x0: 300, y0: 500, x1: 700, y1: 900 };
    const r = pack(arr, U, arr === "row" ? { x0: 350, y0: 500, x1: 650, y1: 900 } : A0, arr === "row" ? items.map((i) => ({ ...i, w: 250 })) : items, 20);
    assert.ok(r.fits, `${arr}: ${r.over}`);
  }
  // A fixed anchor keeps exactly its place.
  const fixed = pack("stack", U, { x0: 300, y0: 60, x1: 700, y1: 400 }, items, 20, true);
  assert.equal(fixed.anchor.y0, 60);
});

test("the writer skips changes to the value a property already has", () => {
  const w = new A.Writer(100, 100);
  w.node("n", "path", { opacity: 0 });
  w.put("n", "opacity", 0, 5);
  w.put("n", "opacity", 1, 5, 10);
  w.put("n", "opacity", 1, 20);
  assert.equal(w.ops.length, 1);
  assert.equal(w.doc().steps.length, 2);
});

// A redrawn chart whose words are long for its box: labels, values and header rows must fit, never print over bars.
const longChart = (orient: "h" | "v"): A.Chart => {
  const data = { kind: "bars", orient, labels: ["Login / password resets", "Billing", "Shipping delays", "Other"], values: [412, 268, 97, 63], ymax: 412, plot: [0.25, 0.25, 0.9, 0.9] as [number, number, number, number], texts: { subtitle: "Total: 840 tickets over three months (Jul to Sep)", source: "Source: helpdesk export, Oct 2" } };
  const parts = new Map([["subtitle", [0, 0.05, 1, 0.12] as [number, number, number, number]], ["source", [0, 0.92, 1, 0.98] as [number, number, number, number]]]);
  return { name: "c", src: "", w: 1280, h: 720, about: "", parts, data, barsOf: new Map([["bar-a", [0]]]) };
};
const em = (t: string) => t.length * 0.58;
const look = (k = 1): A.ChartLook => ({ small: 30 * k, min: 24, valueFs: 37 * k, headBig: 80 * k, headShare: 0.6, rowLine: 1.4, gap: 14, barFrac: 0.7, photoBarFrac: 0.7, dimBars: 0.2, dimText: 0.4, labelOpacity: 0.8, levelPad: 8, em });
const overlaps = (a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;

test("a redrawn chart fits its words in its box: lines wrap, nothing prints over a bar or another word, and no text is shortened", () => {
  for (const orient of ["h", "v"] as const) {
    const p = longChart(orient);
    const st = { ...A.blankSt("ink"), x: 400, y: 600, w: 520, h: 900 };
    const g = A.chartGeom(st, p, "own", look());
    assert.ok(g.fits, `${orient}: fits`);
    const boxes: { x0: number; y0: number; x1: number; y1: number; what: string }[] = [];
    const row = (t: A.ChartText, what: string) =>
      t.lines.forEach((l, j) => {
        const w = em(l) * t.fs;
        const x0 = t.left ? t.x : t.x - w / 2;
        boxes.push({ x0, x1: x0 + w, y0: t.y + j * t.lh - t.fs / 2, y1: t.y + j * t.lh + t.fs / 2, what: `${what} line ${j}` });
      });
    g.labels.forEach((t, i) => row(t, `label ${i}`));
    for (const [h, t] of Object.entries(g.heads)) row(t, h);
    // Every word of the data is still there, in order.
    assert.deepEqual(g.labels.map((t) => t.lines.join(" ")), p.data.labels);
    assert.deepEqual(Object.values(g.heads).map((t) => t.lines.join(" ")).sort(), Object.values(p.data.texts!).sort());
    g.bars.forEach((b, i) => {
      const vw = em(String(p.data.values[i])) * g.valueFs;
      const v = g.hz ? { x0: b.x1 + 14, x1: b.x1 + 14 + vw, y0: (b.y0 + b.y1) / 2 - g.valueFs / 2, y1: (b.y0 + b.y1) / 2 + g.valueFs / 2 } : { x0: (b.x0 + b.x1) / 2 - vw / 2, x1: (b.x0 + b.x1) / 2 + vw / 2, y0: b.y0 - g.valueFs * 1.2, y1: b.y0 - g.valueFs * 0.2 };
      boxes.push({ ...b, what: `bar ${i}` }, { ...v, what: `value ${i}` });
    });
    for (const b of boxes) assert.ok(b.x0 >= st.x - st.w / 2 - 0.5 && b.x1 <= st.x + st.w / 2 + 0.5 && b.y0 >= st.y - st.h / 2 - 0.5 && b.y1 <= st.y + st.h / 2 + 0.5, `${orient}: ${b.what} leaves the chart's box`);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlaps(boxes[i]!, boxes[j]!), `${orient}: ${boxes[i]!.what} overlaps ${boxes[j]!.what}`);
  }
});

test("a redrawn chart turns its layout when its labels do not fit its own orientation, and says what height it needs when nothing fits", () => {
  const p = longChart("v");
  const narrow = A.chartFit({ w: 520, h: 900 }, p, look());
  assert.equal(narrow.hz, true, "upright bars with long labels turn into rows");
  const short = { ...p, data: { ...p.data, labels: ["Mon", "Tue", "Wed", "Thu"] } };
  assert.equal(A.chartFit({ w: 520, h: 900 }, short, look()).hz, false, "short labels keep the original's upright bars");
  const tiny = A.chartFit({ w: 520, h: 200 }, p, look());
  assert.equal(tiny.fits, false);
  assert.ok(tiny.needH > 200);
  const st = { ...A.blankSt("ink"), x: 400, y: 600, w: 520, h: tiny.needH };
  assert.ok(A.chartGeom(st, p, "own", look()).fits, "the height it asked for is enough");
});

test("a redrawn chart's words follow the design's type sizes while the box has room", () => {
  const p = longChart("h");
  const st = { ...A.blankSt("ink"), x: 600, y: 900, w: 1000, h: 1700 };
  const one = A.chartGeom(st, p, "own", look(1));
  const big = A.chartGeom(st, p, "own", look(1.3));
  assert.ok(big.small > one.small * 1.25 && big.valueFs > one.valueFs * 1.25, `${one.small} then ${big.small}`);
  // With no room, sizes step down, but never below the smallest size.
  const cramped = A.chartGeom({ ...st, w: 520, h: 700 }, p, "own", look(1.3));
  assert.ok(cramped.small < big.small && cramped.small >= 24);
});
