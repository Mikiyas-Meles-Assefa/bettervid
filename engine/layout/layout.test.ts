import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "../core/compile.ts";
import { evaluate } from "../core/evaluate.ts";
import type { CompileContext, Measured, MeasureRequest, Resolved } from "../core/types.ts";
import { textKit } from "../kits/text.ts";
import { graphKit } from "../kits/graph.ts";
import { arrange, inFrame, overlaps, type Item } from "./arrange.ts";
import { boundsOf, layoutKit } from "./kit.ts";
import { buildCast, matchAtoms, type Atom } from "./parts.ts";

const frame = { width: 1080, height: 1920 };
const b = (w: number, h: number) => ({ left: -w / 2, right: w / 2, top: -h / 2, bottom: h / 2 });
const measure = (r: MeasureRequest): Measured => {
  let w = 0;
  return { edges: r.clusters.map((c) => (w += c.length * 0.5)), ascent: 0.8, descent: 0.2 };
};
const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames: 300, kits: [layoutKit, textKit, graphKit], measure, theme: { colors: { ink: "#111111", paper: "#ffffff", accent: "#ff0000" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" } };
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};

test("with no instructions things stack, centered, without touching", () => {
  const items: Item[] = [{ id: "a", box: b(400, 200) }, { id: "b", box: b(600, 300) }, { id: "c", box: b(200, 200) }];
  const p = arrange(items, frame);
  assert.deepEqual(overlaps(items, p), []);
  assert.ok(p[0]!.y < p[1]!.y && p[1]!.y < p[2]!.y);
  for (const q of p) assert.equal(q.x, 540);
  assert.ok(Math.abs((p[0]!.y - 100 + p[2]!.y + 100) / 2 - 960) < 1, "the stack is centered in the frame");
});

test("things can flow sideways as the default", () => {
  const items: Item[] = [{ id: "a", box: b(200, 100) }, { id: "b", box: b(200, 100) }];
  const p = arrange(items, { ...frame, flow: "right" });
  assert.ok(p[1]!.x > p[0]!.x);
  assert.equal(p[0]!.y, p[1]!.y);
});

test("right-of, left-of, above and below place against another thing", () => {
  const items: Item[] = [
    { id: "a", box: b(200, 200), place: { center: true } },
    { id: "r", box: b(100, 100), place: { rightOf: "a", gap: 10 } },
    { id: "l", box: b(100, 100), place: { leftOf: "a", gap: 10 } },
    { id: "u", box: b(100, 100), place: { above: "a", gap: 10 } },
    { id: "d", box: b(100, 100), place: { below: "a", gap: 10, align: "start" } },
  ];
  const p = Object.fromEntries(arrange(items, frame).map((x) => [x.id, x]));
  assert.equal(p.r!.x - p.a!.x, 160);
  assert.equal(p.a!.x - p.l!.x, 160);
  assert.equal(p.a!.y - p.u!.y, 160);
  assert.equal(p.d!.y - p.a!.y, 160);
  assert.equal(p.d!.x - p.a!.x, -50);
  assert.equal(p.r!.y, p.a!.y);
});

test("places work whatever the order, and bad references fail loudly", () => {
  const p = arrange([{ id: "a", box: b(100, 100), place: { rightOf: "b" } }, { id: "b", box: b(100, 100) }], frame);
  assert.ok(p[0]!.x > p[1]!.x);
  assert.throws(() => arrange([{ id: "a", box: b(1, 1), place: { below: "ghost" } }], frame), /does not exist/);
  assert.throws(() => arrange([{ id: "a", box: b(1, 1), place: { below: "b" } }, { id: "b", box: b(1, 1), place: { below: "a" } }], frame), /relative to itself/);
  assert.throws(() => arrange([{ id: "a", box: b(1, 1) }, { id: "a", box: b(1, 1) }], frame), /two things/);
});

test("something pointed at an occupied spot is pushed clear", () => {
  const items: Item[] = [
    { id: "a", box: b(200, 200) },
    { id: "b", box: b(200, 200), place: { rightOf: "a" } },
    { id: "c", box: b(200, 200), place: { rightOf: "a" } },
  ];
  assert.deepEqual(overlaps(items, arrange(items, frame)), []);
});

test("inside centers on the holder and shrinks to fit it", () => {
  const items: Item[] = [{ id: "a", box: b(300, 300) }, { id: "label", box: b(600, 100), place: { inside: "a" } }];
  const p = Object.fromEntries(arrange(items, frame).map((x) => [x.id, x]));
  assert.equal(p.label!.x, p.a!.x);
  assert.equal(p.label!.y, p.a!.y);
  assert.ok(p.label!.scale * 600 <= 300);
});

test("fill takes the room others leave, and inside fill takes the holder", () => {
  const items: Item[] = [{ id: "head", box: b(600, 200) }, { id: "body", box: b(100, 100), place: { fill: true } }];
  const placed = arrange(items, { ...frame, pad: 0, gap: 20 });
  assert.deepEqual(overlaps(items, placed), []);
  assert.ok(placed[1]!.scale > 5);
  assert.ok(inFrame(items, placed, frame));
  const inside: Item[] = [{ id: "a", box: b(500, 500) }, { id: "x", box: b(50, 50), place: { inside: "a", fill: true } }];
  assert.ok(arrange(inside, frame)[1]!.scale > 5);
});

test("too much content shrinks to fit the frame and keeps its order", () => {
  const items: Item[] = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, box: b(1500, 400) }));
  const p = arrange(items, frame);
  assert.ok(inFrame(items, p, frame));
  assert.deepEqual(overlaps(items, p), []);
  assert.ok(p[0]!.scale < 1);
  assert.equal(arrange([{ id: "a", box: b(10, 10) }], { ...frame, grow: true })[0]!.scale > 50, true);
});

test("one thing wider than the frame shrinks alone", () => {
  const items: Item[] = [{ id: "wide", box: b(3000, 100) }, { id: "small", box: b(200, 100) }];
  const p = arrange(items, frame);
  assert.ok(p[0]!.scale < 0.4);
  assert.equal(p[1]!.scale, 1);
  assert.ok(inFrame(items, p, frame));
});

test("an off-center origin is still placed by its box", () => {
  const items: Item[] = [{ id: "a", box: { left: 0, right: 200, top: 0, bottom: 100 }, place: { center: true } }];
  const [p] = arrange(items, frame);
  assert.equal(p!.x + 100, 540);
  assert.equal(p!.y + 50, 960);
});

test("sizes come from any kit, through its primitives", () => {
  const g = boundsOf({ id: "g", kind: "graph", data: { nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 400, y: 0 }], edges: [{ id: "ab", from: "a", to: "b" }], radius: 50 } }, ctx);
  assert.equal(g.right - g.left, 400 + 100 + 7);
  const t = boundsOf({ id: "t", kind: "words", data: { text: "four", size: 100 } }, ctx);
  assert.equal(t.right - t.left, 200);
  const prim = boundsOf({ id: "p", kind: "text", props: { text: "abcd", size: 100 } }, ctx);
  assert.equal(prim.right - prim.left, 200);
});

test("a layout of mixed things compiles, and things travel between states", () => {
  const items = [
    { id: "title", kind: "words", data: { text: "Tides", size: 120 } },
    { id: "moon", kind: "path", props: { points: [-100, -100, 100, -100, 100, 100, -100, 100], closed: 1, fill: "accent" } },
    { id: "note", kind: "words", data: { text: "pull", size: 60 }, place: { rightOf: "moon" } },
  ];
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [{ id: "page", kind: "layout", data: { items, states: [["title", "moon"], ["title", "moon", "note"]] } }] },
    { at: 30, play: [{ behavior: "become", target: "page", args: { state: 1, frames: 20 } }] },
  ] }, ctx);
  const moon = (f: number) => find(evaluate(scene, f), "moon")!.props.x as number;
  assert.equal(moon(0), 540);
  assert.ok(moon(60) < 540, "the shape makes room for what arrives");
  assert.equal(find(evaluate(scene, 0), "note")!.props.opacity, 0);
  assert.equal(find(evaluate(scene, 60), "note")!.props.opacity, 1);
});

test("the proof scene compiles in more than one style", async () => {
  const { buildProof } = await import("../proof/text-math.ts");
  const { themeFrom } = await import("../render/theme.ts");
  for (const style of ["flat", "whiteboard", "collage"]) {
    const scene = buildProof(themeFrom(style));
    assert.ok(scene.nodes.length > 100);
    assert.equal(JSON.stringify(evaluate(scene, 400)), JSON.stringify(evaluate(scene, 400)));
  }
});

const atom = (key: string, chunk?: string): Atom => ({ key, chunk, x: 0, y: 0, w: 10, h: 10, kind: "text", props: {} });

test("matching keeps order where it can and marks parts that cross", () => {
  const a = ["x", "+", "2", "=", "5"].map((k) => atom(k));
  const b = ["x", "=", "5", "-", "2"].map((k) => atom(k));
  const m = matchAtoms(a, b);
  assert.equal(m.length, 4);
  const two = m.find((p) => p.from === 2)!;
  assert.equal(two.to, 4);
  assert.equal(two.crossed, true);
  assert.equal(m.find((p) => p.from === 0)!.crossed, false);
});

test("chunks match whole, so a repeated letter stays with its word", () => {
  const word = (w: string) => [...w].map((c) => atom(c, w));
  const a = [...word("sun"), ...word("moon")];
  const b = [...word("moon"), ...word("sun")];
  const m = matchAtoms(a, b);
  assert.equal(m.length, 7);
  assert.equal(m.find((p) => p.from === 0)!.to, 4);
  assert.equal(m.find((p) => p.from === 3)!.to, 0);
});

test("a part that leaves and comes back is the same part", () => {
  const s = (keys: string[]) => ({ atoms: keys.map((k) => atom(k)) });
  const c = buildCast("r", [s(["a", "b"]), s(["a"]), s(["a", "b"])], (_, i) => `n${i}`);
  assert.equal(c.actors.length, 2);
});
