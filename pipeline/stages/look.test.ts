// The look step's measuring and settling (pipeline/lib/look.ts). Pure parts only: no renders and no model calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Scene, SceneNode } from "../../engine/core/types.ts";
import { better, hide, inkOf, inventory, issuesFrom, lookFrames, measureLayout, measurePixels, type Pixels, type Thing, wordsOnScreen } from "../lib/look.ts";

const W = 1080;
const H = 1920;
const READ = { text: 0.03, dim: 0.5 };
const scene = (nodes: SceneNode[], tracks: Scene["tracks"] = []): Scene => ({ fps: 30, width: W, height: H, frames: 300, background: "#000", nodes, tracks, events: [] });
const text = (id: string, x: number, y: number, t: string, size = 70, extra: Record<string, number | string> = {}): SceneNode => ({ id, kind: "text", props: { x, y, text: t, size, ...extra } });
const thing = (o: Partial<Thing> & { box: Thing["box"] }): Thing => ({ id: "t", owner: "t", kind: "text", text: "words", opacity: 1, size: 70, order: 0, ...o });

test("inventory places text through its parents, with their fade and scale", () => {
  const s = scene([{ id: "card", kind: "group", props: { x: 540, y: 400, scaleX: 2, scaleY: 2, opacity: 0.5 } }, { ...text("card.l1", 0, 0, "Hello", 40), parent: "card" }]);
  const [t] = inventory(s, 0);
  assert.equal(t!.kind, "text");
  assert.equal(t!.owner, "card");
  assert.equal(t!.opacity, 0.5);
  assert.equal(t!.size, 80);
  assert.ok(Math.abs((t!.box.x0 + t!.box.x1) / 2 - 540) < 1 && Math.abs((t!.box.y0 + t!.box.y1) / 2 - 400) < 1);
});

test("inventory skips what has faded out and paints in z order", () => {
  const s = scene([text("a", 100, 100, "A", 70, { z: 2 }), text("b", 100, 100, "B"), text("gone", 100, 100, "C", 70, { opacity: 0 })]);
  const list = inventory(s, 0);
  assert.deepEqual(list.map((t) => t.id), ["b", "a"]);
  assert.deepEqual(wordsOnScreen(list), ["B", "A"]);
});

test("measureLayout finds writing on writing, off the frame, and below the size floor", () => {
  const found = measureLayout([
    thing({ id: "a", owner: "a", box: { x0: 100, y0: 100, x1: 500, y1: 180 } }),
    thing({ id: "b", owner: "b", box: { x0: 150, y0: 120, x1: 450, y1: 200 } }),
    thing({ id: "c", owner: "c", box: { x0: 900, y0: 600, x1: 1300, y1: 680 } }),
    thing({ id: "d", owner: "d", size: 18, box: { x0: 400, y0: 900, x1: 500, y1: 920 } }),
  ], W, H, READ);
  const kinds = found.map((f) => f.kind);
  assert.ok(kinds.includes("overlap"));
  assert.ok(kinds.includes("off_frame"));
  assert.ok(kinds.includes("small_text"));
  assert.deepEqual(found.find((f) => f.kind === "overlap")!.ids.sort(), ["a", "b"]);
});

test("lines of one thing never count as overlapping each other", () => {
  const found = measureLayout([thing({ id: "a.l1", owner: "a", box: { x0: 100, y0: 100, x1: 500, y1: 180 } }), thing({ id: "a.l2", owner: "a", box: { x0: 100, y0: 150, x1: 500, y1: 230 } })], W, H, READ);
  assert.ok(!found.some((f) => f.kind === "overlap"));
});

test("measureLayout reports an empty lower frame and a mostly dimmed one, but not on a frame caught changing", () => {
  const top = [0, 1, 2].map((i) => thing({ id: `t${i}`, owner: `t${i}`, opacity: 0.5, box: { x0: 80, y0: 120 + i * 120, x1: 1000, y1: 200 + i * 120 } }));
  const kinds = measureLayout(top, W, H, READ).map((f) => f.kind);
  assert.ok(kinds.includes("empty"));
  assert.ok(kinds.includes("dimmed"));
  assert.ok(!measureLayout(top, W, H, READ, true).some((f) => f.kind === "empty" || f.kind === "dimmed"));
});

test("a picture under an opaque shape painted after it is hidden", () => {
  const found = measureLayout([
    thing({ id: "pic", kind: "image", order: 0, box: { x0: 200, y0: 300, x1: 880, y1: 900 } }),
    thing({ id: "card", kind: "shape", filled: true, order: 1, box: { x0: 150, y0: 250, x1: 930, y1: 950 } }),
  ], W, H, READ);
  assert.deepEqual(found.find((f) => f.kind === "hidden_picture")?.ids, ["pic", "card"]);
});

// A flat frame of one color, with an optional block of another.
function pixels(w: number, h: number, back: number[], block?: { x0: number; y0: number; x1: number; y1: number; rgb: number[] }): Pixels {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = block && x >= block.x0 && x < block.x1 && y >= block.y0 && y < block.y1 ? block.rgb : back;
      rgb.set(c, (y * w + x) * 3);
    }
  }
  return { w, h, rgb };
}

test("inkOf measures the contrast of the words' own pixels against what is behind them", () => {
  const box = { x0: 10, y0: 10, x1: 50, y1: 30 };
  const bare = pixels(60, 40, [30, 40, 35]);
  const strong = inkOf(pixels(60, 40, [30, 40, 35], { x0: 20, y0: 15, x1: 40, y1: 25, rgb: [240, 240, 230] }), bare, box, 1);
  assert.ok(strong.ratio > 7);
  const cream = pixels(60, 40, [235, 228, 205]);
  const weak = inkOf(pixels(60, 40, [235, 228, 205], { x0: 20, y0: 15, x1: 40, y1: 25, rgb: [244, 201, 93] }), cream, box, 1);
  assert.ok(weak.ratio < 2, `ratio ${weak.ratio}`);
});

test("measurePixels reports faint writing, and writing that does not show at all", () => {
  const bare = pixels(108, 192, [235, 228, 205]);
  const faint = pixels(108, 192, [235, 228, 205], { x0: 20, y0: 20, x1: 80, y1: 30, rgb: [244, 201, 93] });
  const words = [thing({ id: "w.l1", owner: "w", box: { x0: 150, y0: 150, x1: 850, y1: 350 } })];
  assert.equal(measurePixels(words, faint, bare, undefined, W)[0]?.kind, "faint");
  assert.equal(measurePixels(words, bare, bare, undefined, W)[0]?.kind, "covered");
  assert.equal(measurePixels([{ ...words[0]!, opacity: 0.5 }], bare, bare, undefined, W, true).length, 0);
});

test("hide turns words invisible and drops the tracks that would fade them back in", () => {
  const s = scene([text("a", 1, 1, "A"), { id: "p", kind: "path", props: { points: [0, 0, 1, 1] } }], [{ target: "a", prop: "opacity", keys: [{ at: 0, value: 1 }] }, { target: "a", prop: "x", keys: [{ at: 0, value: 5 }] }]);
  const h = hide(s, ["text"]);
  assert.equal(h.nodes[0]!.props.opacity, 0);
  assert.equal(h.nodes[1]!.props.opacity, undefined);
  assert.deepEqual(h.tracks.map((t) => t.prop), ["x"]);
  assert.equal(s.nodes[0]!.props.opacity, undefined);
});

test("lookFrames sees every state settled and some changes, within the cap", () => {
  const frames = lookFrames([0, 90, 180, 270], 0, 359, 30, 12);
  assert.deepEqual(frames.filter((f) => f.why === "settled").map((f) => f.frame), [88, 178, 268, 358]);
  assert.ok(frames.some((f) => f.why === "changing" && f.frame > 90 && f.frame < 120));
  const many = lookFrames(Array.from({ length: 30 }, (_, i) => i * 20), 0, 620, 30, 10);
  assert.ok(many.length <= 10);
  assert.deepEqual(many.map((f) => f.frame), [...many.map((f) => f.frame)].sort((a, b) => a - b));
});

test("issuesFrom keeps what matters and groups measured findings by kind across frames", () => {
  const issues = issuesFrom(
    [{ frames: [1], kind: "design", what: "a blemish", want: "", severity: 1 }, { frames: [2], kind: "words", what: "label says another year", want: "agree with the narration", severity: 3 }],
    [{ frame: 10, findings: [{ kind: "faint", ids: ["a"], note: "faint a", severity: 3 }] }, { frame: 20, findings: [{ kind: "faint", ids: ["b"], note: "faint b", severity: 2 }, { kind: "dimmed", ids: [], note: "light", severity: 1 }] }],
  );
  assert.equal(issues.length, 2);
  assert.equal(issues[0]!.kind, "words");
  assert.deepEqual(issues[1]!.frames, [1, 2]);
  assert.equal(issues[1]!.severity, 3);
  const once = issuesFrom([], [{ frame: 10, findings: [{ kind: "empty", ids: [], note: "empty", severity: 2 }] }, { frame: 20, findings: [] }]);
  assert.equal(once.length, 0);
});

test("a fix is kept only when it is better and breaks nothing badly", () => {
  const base = { measuredBefore: 6, measuredAfter: 3, seenBefore: 4, seenAfter: 1, newSevere: 0, prefer: "after" as const };
  assert.ok(better(base));
  assert.ok(!better({ ...base, newSevere: 1 }));
  assert.ok(!better({ ...base, prefer: "before" }));
  assert.ok(!better({ ...base, measuredAfter: 7 }));
  assert.ok(!better({ ...base, seenAfter: 9 }));
  assert.ok(!better({ ...base, measuredAfter: 6, seenAfter: 4, prefer: "same" }));
});
