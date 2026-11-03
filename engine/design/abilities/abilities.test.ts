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
