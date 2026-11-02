import assert from "node:assert/strict";
import { test } from "node:test";
import { graphKit, part } from "../kits/graph.ts";
import { compile, when } from "./compile.ts";
import { evaluate, mix, resample } from "./evaluate.ts";
import type { CompileContext, Resolved } from "./types.ts";

const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames: 300, kits: [graphKit], words: [{ start: 0 }, { start: 2 }], theme: { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" } };
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};

test("moments follow spoken words", () => {
  assert.equal(when({ word: 1, offset: 3 }, ctx), 63);
  assert.equal(when(12, ctx), 12);
});

test("values blend: numbers, colors and shapes with different point counts", () => {
  assert.equal(mix(0, 10, 0.5), 5);
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal((mix([0, 0, 10, 0], [0, 0, 5, 0, 10, 0], 0.5) as number[]).length, 6);
  assert.deepEqual(resample([0, 0, 10, 0], 3), [0, 0, 5, 0, 10, 0]);
});

test("any part of a kit's object can change on its own", () => {
  const edge = part.edge("g", "ab");
  const other = part.edge("g", "bc");
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [{ id: "g", kind: "graph", data: { nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 500, y: 0 }, { id: "c", x: 900, y: 0 }], edges: [{ id: "ab", from: "a", to: "b" }, { id: "bc", from: "b", to: "c" }] } }] },
    { at: 20, set: { [edge]: { stroke: "accent" } } },
  ] }, ctx);
  assert.equal(find(evaluate(scene, 40), edge)!.props.stroke, "#ff0000");
  assert.equal(find(evaluate(scene, 40), other)!.props.stroke, "#111111");
  assert.equal(find(evaluate(scene, 20), edge)!.props.stroke, "#111111");
});

test("frames are pure: order of evaluation changes nothing", () => {
  const scene = compile({ steps: [{ at: 0, add: [{ id: "t", kind: "text", props: { text: "hi", x: 10 } }] }, { at: 30, set: { t: { x: 500 } } }] }, ctx);
  const a = JSON.stringify(evaluate(scene, 35));
  evaluate(scene, 200);
  assert.equal(JSON.stringify(evaluate(scene, 35)), a);
});

test("later changes pick up from where the last one ended", () => {
  const scene = compile({ steps: [{ at: 0, enter: "none", add: [{ id: "t", kind: "text", props: { x: 0 } }] }, { at: 10, set: { t: { x: 100 } } }, { at: 50, set: { t: { x: 200 } } }] }, ctx);
  assert.equal(find(evaluate(scene, 30), "t")!.props.x, 100);
  assert.equal(find(evaluate(scene, 55), "t")!.props.x, 150);
});

test("bad references fail loudly instead of drawing nothing", () => {
  assert.throws(() => compile({ steps: [{ at: 0, set: { missing: { x: 1 } } }] }, ctx), /nothing called/);
  assert.throws(() => compile({ steps: [{ at: 0, add: [{ id: "x", kind: "hologram" }] }] }, ctx), /unknown kind/);
});
