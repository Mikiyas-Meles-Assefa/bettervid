// The camera follows computed work that would read small, and keeps out of the way of a scene that moves it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../core/evaluate.ts";
import type { CompileContext, Scene, Theme } from "../core/types.ts";
import { KITS } from "../kits/index.ts";
import { build, formatProblems } from "./build.ts";

const words = Array.from({ length: 120 }, (_, i) => ({ start: i * 0.5 }));
const theme: Theme = { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff", highlight: "#ffff00" }, fonts: { title: "TitleFont", body: "b" }, moveFrames: 10, ease: "linear" };
const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames: 1900, words, theme, kits: KITS };
const data = "[12,7,3,15,6,4,11,2,9,1,8,14,5,10,13,16]";
const moves = async (src: string) => {
  const r = await build(src, { ctx });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  return r.doc!.steps.filter((s) => s.set?.camera).map((s) => ({ at: Number(s.at), ...(s.set!.camera as { panX: number; panY: number; zoom: number }) }));
};

test("the camera moves in on the steps of a long demonstration and pulls back to the whole when they end", async () => {
  // Sixteen values come out small; a slow stretch of steps is followed close up, step by step.
  const cams = await moves(`@0\nsort s data=${data} algo=merge order=levels show=boxes\n@4 keep\ndo steps s from=1 to=15 until=@20 pace=fast\n@20 keep\ndo steps s from=16 to=21 until=@40 pace=slow\n@60 keep\n`);
  const close = cams.filter((c) => c.at >= 300 && c.at < 600 && c.zoom > 1.8);
  assert.ok(close.length >= 3, `close moves: ${JSON.stringify(cams)}`);
  assert.ok(new Set(close.map((c) => Math.round(c.panX))).size >= 2, "it follows along the work");
  // The whole is shown at the start, and again once the slow stretch is over.
  assert.ok(!cams.some((c) => c.at < 60), "whole at the start, before any step");
  const last = cams.at(-1)!;
  assert.equal(last.zoom, 1);
  assert.ok(last.at > close.at(-1)!.at);
});

test("the camera stays where the scene puts it, on request stays still, and leaves large work alone", async () => {
  const scene = await moves(`@0\nsort s data=${data} algo=merge order=levels show=boxes\ncamera s zoom=1\n@4 keep\ndo steps s from=1 to=6 until=@40 pace=slow\n`);
  assert.equal(scene.length, 1, "only the scene's own camera line");
  const off = await moves(`@0\nsort s data=${data} algo=merge order=levels show=boxes follow=no\n@4 keep\ndo steps s from=1 to=6 until=@40 pace=slow\n`);
  assert.equal(off.length, 0);
  // Four values already read large: nothing to follow.
  const big = await moves(`@0\nsort s data=[38,27,43,10] algo=merge order=levels show=boxes\n@4 keep\ndo steps s from=1 to=6 until=@40 pace=slow\n`);
  assert.equal(big.length, 0);
});

// Where a part is on screen: inside the camera, the camera's offset plus its own place times the zoom.
const onScreen = (scene: Scene, frame: number, id: string) => {
  const tree = evaluate(scene, frame);
  const cam = tree.find((n) => n.id === "camera");
  const n = (cam?.children ?? tree).find((x) => x.id === id);
  if (!n) return undefined;
  const [x, y, k] = cam ? [Number(cam.props.x ?? 0), Number(cam.props.y ?? 0), Number(cam.props.scaleX ?? 1)] : [0, 0, 1];
  return { x: x + Number(n.props.x ?? 0) * k, y: y + Number(n.props.y ?? 0) * k, scale: Number(n.props.scaleX ?? 1) * k };
};

test("words beside followed work stay pinned on screen while the camera moves in on the work", async () => {
  const r = await build(`@0\ntext t "Sixteen values" role=heading\nsort s data=${data} algo=merge order=levels show=boxes\n@4 keep\ndo steps s from=1 to=15 until=@20 pace=fast\n@20 keep\ntext q "Which comes out first?" role=heading\ntag s.item.1 "starts here"\ndo steps s from=16 to=21 until=@40 pace=slow\n@60 keep\n`, { ctx });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  const cams = r.doc!.steps.filter((s) => s.set?.camera).map((s) => ({ at: Number(s.at), ...(s.set!.camera as { zoom: number }) }));
  const close = cams.find((c) => c.at >= 300 && c.zoom > 1.5);
  assert.ok(close, `the camera moves in: ${JSON.stringify(cams)}`);
  const rest = onScreen(r.scene!, 290, "t")!;
  for (const f of [close.at + 5, close.at + 40]) {
    const now = onScreen(r.scene!, f, "t")!;
    assert.ok(Math.abs(now.x - rest.x) < 2 && Math.abs(now.y - rest.y) < 2 && Math.abs(now.scale - 1) < 0.01, `the heading stays put at frame ${f}: ${JSON.stringify(now)}`);
  }
  assert.ok(Math.abs(onScreen(r.scene!, close.at + 40, "q")!.scale - 1) < 0.01, "the question is drawn at its own size");
});
