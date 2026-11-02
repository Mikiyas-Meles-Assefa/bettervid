// Pictures on screen: framed by their subject, never by their middle, with marks that land inside the crop.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../../engine/core/evaluate.ts";
import type { CompileContext, Resolved, Scene } from "../../engine/core/types.ts";
import { build, formatProblems } from "../../engine/language/build.ts";
import type { Asset, Project } from "../../schemas/project.ts";
import { cameraFor, fitMark, frame, laid, seen, shotsToScene, viewAt } from "../lib/shots-scene.ts";
import { agreed, clean } from "./annotate.ts";

const FPS = 30;
const inRect = (b: { x: number; y: number; w: number; h: number }, r: { x0: number; y0: number; x1: number; y1: number }, slack = 0.005) =>
  b.x >= r.x0 - slack && b.y >= r.y0 - slack && b.x + b.w <= r.x1 + slack && b.y + b.h <= r.y1 + slack;

test("a subject that fits the tall frame is cropped around, not cut at the middle", () => {
  // A wide photo whose subject sits near the right edge: a center crop would miss it.
  const subject = { x: 0.7, y: 0.3, w: 0.2, h: 0.4 };
  const f = frame({ iw: 1920, ih: 1080, subject, frames: 120 });
  assert.equal(f.kind, "fill");
  for (const at of [0, 60, 119]) assert.ok(inRect(subject, seen(f.pic, viewAt(f, at), "clear")), `frame ${at}`);
  // The blind middle would not have shown it.
  assert.ok(!inRect(subject, seen(f.pic, cameraFor(f.pic, f.filler, { x0: 0.3, y0: 0, x1: 0.7, y1: 1 }), "frame")));
});

test("a subject wider than the frame is shown whole over its own copy, or travelled across when it is a scene", () => {
  const subject = { x: 0.05, y: 0.3, w: 0.85, h: 0.4 };
  const whole = frame({ iw: 1920, ih: 1200, subject, frames: 150 });
  assert.equal(whole.kind, "whole");
  for (const at of [0, 149]) assert.ok(inRect(subject, seen(whole.pic, viewAt(whole, at), "clear")), `frame ${at}`);
  // As large as the clear area allows: the subject spans most of its width.
  const v = seen(whole.pic, viewAt(whole, 0), "clear");
  assert.ok(subject.w / (v.x1 - v.x0) > 0.8);

  const target = { x: 0.8, y: 0.4, w: 0.08, h: 0.1 };
  const pan = frame({ iw: 1920, ih: 1200, subject, target, pan: true, frames: 150 });
  assert.equal(pan.kind, "pan");
  // It starts at the far end and ends on the target.
  assert.ok(!inRect(target, seen(pan.pic, viewAt(pan, 0))));
  assert.ok(inRect(target, seen(pan.pic, viewAt(pan, 149))));
  // Too short to travel: shown whole instead.
  assert.equal(frame({ iw: 1920, ih: 1200, subject, target, pan: true, frames: 45 }).kind, "whole");
});

test("a push in lands on the target and keeps it in view", () => {
  const subject = { x: 0.3, y: 0.2, w: 0.3, h: 0.5 };
  const target = { x: 0.42, y: 0.3, w: 0.05, h: 0.05 };
  const f = frame({ iw: 1920, ih: 1080, subject, target, zoom: true, frames: 180 });
  assert.equal(f.moves.length, 2);
  const end = viewAt(f, 179);
  assert.ok(end.zoom > viewAt(f, 0).zoom * 1.3);
  assert.ok(inRect(target, seen(f.pic, end, "clear")));
  // Pushing in on the edge of a picture shown whole stays on the picture, rather than showing the backdrop past it.
  const edge = frame({ iw: 1600, ih: 2000, subject: { x: 0.01, y: 0.01, w: 0.98, h: 0.98 }, target: { x: 0.75, y: 0.35, w: 0.15, h: 0.1 }, zoom: true, frames: 150 });
  assert.equal(edge.kind, "whole");
  const v = seen(edge.pic, viewAt(edge, 149));
  assert.ok(v.x1 <= 1.001 && v.x0 >= -0.001, JSON.stringify(v));
  assert.ok(inRect({ x: 0.75, y: 0.35, w: 0.15, h: 0.1 }, v));
});

test("marks are moved inside the crop, or left out when they point at what cannot be seen", () => {
  const view = { x0: 0.3, y0: 0, x1: 0.7, y1: 0.8 };
  assert.equal(fitMark({ tool: "ring", points: [[0.05, 0.1], [0.2, 0.2]], word: 0 }, view), undefined);
  // Around most of the screen: it says nothing.
  assert.equal(fitMark({ tool: "box", points: [[0.31, 0.01], [0.69, 0.79]], word: 0 }, view), undefined);
  const ring = fitMark({ tool: "ring", points: [[0.4, 0.4], [0.5, 0.5]], word: 0 }, view)!;
  assert.deepEqual(ring.points, [[0.4, 0.4], [0.5, 0.5]]);
  const label = fitMark({ tool: "label", points: [[0.9, 0.5]], word: 0, text: "x" }, view)!;
  assert.ok(label.points[0]![0] < 0.7);
  const arrow = fitMark({ tool: "arrow", points: [[0.0, 0.5], [0.5, 0.5]], word: 0 }, view)!;
  assert.ok(arrow.points[0]![0] > 0.3 && arrow.points[1]![0] === 0.5);
  assert.equal(fitMark({ tool: "arrow", points: [[0.5, 0.5], [0.95, 0.5]], word: 0 }, view), undefined);
  assert.deepEqual(fitMark({ tool: "dots", points: [[0.1, 0.1], [0.5, 0.5]], word: 0 }, view)!.points, [[0.5, 0.5]]);
});

// A small project: a wide picture with its subject at the right, a mark, the same picture again, then one shown whole.
function project(): Project {
  const words = Array.from({ length: 40 }, (_, i) => ({ text: `w${i}`, start: i * 0.4, end: i * 0.4 + 0.35 }));
  const shot = (id: string, from: number, to: number) => ({ id, beatId: "b", type: "photo_kenburns" as const, start: words[from]!.start, end: words[to]!.start });
  const assets: (Asset & { subject?: object; pan?: boolean })[] = [
    { shotId: "a", kind: "real", path: "assets/wide.jpg", size: [1920, 1080], subject: { x: 0.7, y: 0.3, w: 0.2, h: 0.4 }, focus: { x: 0.75, y: 0.35, w: 0.1, h: 0.1 }, marks: [{ tool: "ring", points: [[0.75, 0.35], [0.85, 0.45]], word: 3 }, { tool: "ring", points: [[0.05, 0.1], [0.15, 0.2]], word: 4 }] },
    { shotId: "b", kind: "real", path: "assets/wide.jpg", size: [1920, 1080], subject: { x: 0.7, y: 0.3, w: 0.2, h: 0.4 }, focus: { x: 0.75, y: 0.35, w: 0.1, h: 0.1 }, zoom: true },
    { shotId: "c", kind: "real", path: "assets/plane.jpg", size: [1920, 1200], subject: { x: 0.05, y: 0.3, w: 0.85, h: 0.4 }, marks: [{ tool: "label", points: [[0.5, 0.2]], word: 25, text: "the thing" }] },
  ];
  return {
    id: "t",
    createdAt: "",
    input: { prompt: "t", style: "collage", persona: "auto", mode: "explain", seconds: 0 },
    stages: {},
    costs: [],
    narration: { words, seconds: 16 } as Project["narration"],
    shots: [shot("a", 0, 10), shot("b", 10, 20), shot("c", 20, 39)],
    assets,
  } as Project;
}

const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
// Where a point of a picture lands on the screen, read from the engine's own frame.
function onScreen(s: Scene, at: number, id: string, fx: number, fy: number): [number, number] {
  const tree = evaluate(s, at);
  const cam = find(tree, "camera")!.props;
  const img = find(tree, id)!.props;
  const [x, y] = [(img.x as number) + (fx - 0.5) * (img.w as number), (img.y as number) + (fy - 0.5) * (img.h as number)];
  return [(cam.x as number) + (cam.scaleX as number) * x, (cam.y as number) + (cam.scaleY as number) * y];
}

test("the draft builds, the engine shows each subject, and an off-crop mark is left out", async () => {
  const p = project();
  const draft = shotsToScene(p);
  const ctx: CompileContext = { fps: FPS, width: 1080, height: 1920, frames: 17 * FPS, words: p.narration!.words, theme: { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff", highlight: "#ffff00" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" } };
  const r = await build(draft.source, { ctx, assets: { wide: "/a.jpg", plane: "/b.jpg" }, words: p.narration!.words.map((w) => w.text) });
  assert.deepEqual(r.problems, [], `${formatProblems(r.problems)}\n${draft.source}`);
  const s = r.scene!;
  // The ring on empty sky far from the crop is not drawn; the one on the subject is.
  assert.equal(draft.notes.length, 1, draft.notes.join("\n"));
  assert.match(draft.source, /mark ring s1 at=0\.75,0\.35,0\.85,0\.45/);
  // The subject's corners are on screen while shot a plays, and again (same picture, closer) in shot b.
  for (const t of [1, 3.5, 5, 7.5]) {
    for (const [fx, fy] of [[0.7, 0.3], [0.9, 0.7]] as const) {
      const [x, y] = onScreen(s, Math.round(t * FPS), "s1", fx, fy);
      assert.ok(x >= 0 && x <= 1080 && y >= 0 && y <= 1920, `at ${t}s (${fx},${fy}) lands at ${x.toFixed(0)},${y.toFixed(0)}`);
    }
  }
  // The same picture again stays the same thing: no cut to a copy.
  assert.doesNotMatch(draft.source, /image s2 /);
  // The wide subject is shown whole: both ends on screen.
  for (const [fx, fy] of [[0.05, 0.3], [0.9, 0.7]] as const) {
    const [x, y] = onScreen(s, Math.round(12 * FPS), "s3", fx, fy);
    assert.ok(x >= 0 && x <= 1080 && y >= 0 && y <= 1920, `whole (${fx},${fy}) lands at ${x.toFixed(0)},${y.toFixed(0)}`);
  }
  assert.match(draft.source, /image s3bk asset=plane .* frame=fill/);
  assert.match(draft.source, /image s3 asset=plane .* frame=fit/);
});

test("the camera mirror agrees with the engine", async () => {
  const pic = laid(1920, 1080, "fill");
  const v = cameraFor(pic, pic, { x0: 0.6, y0: 0.2, x1: 0.8, y1: 0.6 });
  const ctx: CompileContext = { fps: FPS, width: 1080, height: 1920, frames: 60, words: [{ start: 0 }], theme: { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff", highlight: "#ffff00" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" } };
  const r = await build(`@0 cut\nimage p asset=x w=1920 h=1080 frame=fill\ncamera p at=0.6,0.2,0.8,0.6\n`, { ctx, assets: { x: "/a.jpg" } });
  const cam = find(evaluate(r.scene!, 30), "camera")!.props;
  assert.ok(Math.abs((cam.scaleX as number) - v.zoom) < 0.01, `${cam.scaleX} vs ${v.zoom}`);
  // The screen's center shows the canvas point the mirror says it does.
  assert.ok(Math.abs((540 - (cam.x as number)) / (cam.scaleX as number) - v.panX) < 1);
  assert.ok(Math.abs((960 - (cam.y as number)) / (cam.scaleY as number) - v.panY) < 1);
});

test("annotate keeps SAM's outline only when it is the same thing as Spark's box", () => {
  const spark = { x: 0.1, y: 0.3, w: 0.6, h: 0.3 };
  const tight = { x: 0.08, y: 0.32, w: 0.6, h: 0.26 };
  assert.deepEqual(agreed(spark, tight), tight);
  // A small part of the subject, or something else, is not the subject.
  assert.deepEqual(agreed(spark, { x: 0.3, y: 0.4, w: 0.05, h: 0.05 }), spark);
  assert.deepEqual(agreed(spark, { x: 0.75, y: 0.1, w: 0.2, h: 0.2 }), spark);
  assert.deepEqual(clean({ x: -0.1, y: 0.5, w: 0.5, h: 0.8 }), { x: 0, y: 0.5, w: 0.4, h: 0.5 });
  assert.equal(clean({ x: 0.5, y: 0.5, w: 0, h: 0.2 }), undefined);
});
