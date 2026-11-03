// The instruments see what the viewer sees: through the camera at each sampled frame, cut to clips, and with a camera
// move reported apart from things changing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "../../core/compile.ts";
import type { CompileContext, NodeSpec, Step } from "../../core/types.ts";
import type { MeasureInput, Viewing } from "../types.ts";
import { valueProblem } from "../agents/common.ts";
import { instruments, readingsText, settingsFor } from "./index.ts";

const theme = { colors: { ink: "#111111", accent: "#ff3300", paper: "#ffffff" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" as const };
const ctxOf = (frames: number, words?: { start: number }[]): CompileContext => ({ fps: 30, width: 1080, height: 1920, frames, theme, words });
const rect = (w: number, h: number) => [-w, -h, w, -h, w, h, -w, h];
const shape = (id: string, x: number, y: number, w: number, h = w, fill = "#222222"): NodeSpec => ({ id, kind: "path", props: { x, y, points: rect(w, h), closed: 1, fill, stroke: "none" } });
const phone = (): Viewing => ({ width: 1080, height: 1920, fps: 30, screen: "phone", frameWidthMm: 65, distanceMm: 300, watch: "on purpose", uiZones: [], captions: { show: false, why: "" }, why: "test" });

// A tall thing above the middle and a wide one below: a push to 2x about the middle crops both at the push's end.
const pushed = (zoom: number): Step[] => [
  { at: 0, enter: "none", add: [shape("tall", 540, 700, 60, 420), shape("wide", 540, 1300, 300, 80)], set: { camera: { zoom: 1, panX: 540, panY: 960 } } },
  { at: 30, set: { camera: { zoom, panX: 540, panY: 960 } }, move: { frames: 60, ease: "linear" } },
];

test("visibility sees things through the camera: a push that crops them reads as cut, at its closest frame too", () => {
  const ids = { tall: ["tall"], wide: ["wide"] };
  const still = compile({ steps: pushed(1) }, ctxOf(91));
  const push = compile({ steps: pushed(2) }, ctxOf(91));
  // The window ends as the push reaches its closest: the sampled frames include it.
  const at = (scene: typeof still) => {
    const input: MeasureInput = { scene, words: [], viewing: phone(), ids, window: [30, 91] };
    return instruments.visibility!.measure(input, settingsFor("visibility", input));
  };
  assert.equal(at(still).values["cut.tall"], 0);
  const r = at(push);
  assert.ok(r.values["cut.tall"]! > 0 && r.values["cut.wide"]! > 0, readingsText([r]));
  assert.ok(r.values.cutShare! > 0);
});

test("a thing a push makes fill the frame is still a thing, not a backdrop", () => {
  const steps: Step[] = [
    { at: 0, enter: "none", add: [shape("subject", 540, 960, 380, 600)], set: { camera: { zoom: 1, panX: 540, panY: 960 } } },
    { at: 10, set: { camera: { zoom: 1.6, panX: 540, panY: 960 } }, move: { frames: 10 } },
  ];
  const scene = compile({ steps }, ctxOf(60));
  const input: MeasureInput = { scene, words: [], viewing: phone(), ids: { subject: ["subject"] }, window: [30, 60] };
  const r = instruments.visibility!.measure(input, settingsFor("visibility", input));
  assert.equal(r.values["withheld.subject"], 0, readingsText([r]));
  assert.ok(r.values["cut.subject"]! > 0, readingsText([r]));
  const f = instruments.fill!.measure(input, settingsFor("fill", input));
  assert.ok(f.values.filled! > 0.5, readingsText([f]));
});

test("a part cut to its clip counts only as big as what shows: a liquid clipped by its vessel is not cut by the frame", () => {
  const steps: Step[] = [{ at: 0, enter: "none", add: [
    { id: "jar", kind: "group", props: { x: 540, y: 960 } },
    { id: "jar.inside", kind: "group", parent: "jar", props: { clip: rect(200, 300) } },
    { id: "jar.liquid", kind: "path", parent: "jar.inside", props: { points: rect(2000, 150), y: 150, closed: 1, fill: "#3366ff", stroke: "none" } },
    { id: "jar.wall", kind: "path", parent: "jar", props: { points: rect(205, 305), closed: 1, fill: "none", stroke: "#111111", strokeWidth: 6 } },
  ] }];
  const scene = compile({ steps }, ctxOf(30));
  const input: MeasureInput = { scene, words: [], viewing: phone(), ids: { jar: ["jar"] } };
  const r = instruments.visibility!.measure(input, settingsFor("visibility", input));
  assert.equal(r.values["cut.jar"], 0, readingsText([r]));
  assert.ok(r.values["seen.jar"]! > 0.9);
});

test("legibility reads text at its size through the camera", () => {
  const steps = (zoom: number): Step[] => [
    { at: 0, enter: "none", add: [{ id: "words", kind: "text", props: { x: 540, y: 960, text: "small words", size: 30, color: "#111111" } }], set: { camera: { zoom, panX: 540, panY: 960 } } },
  ];
  const read = (zoom: number) => {
    const scene = compile({ steps: steps(zoom) }, ctxOf(30));
    const input: MeasureInput = { scene, words: [], viewing: phone() };
    return instruments.legibility!.measure(input, settingsFor("legibility", input)).values.medianAngle!;
  };
  assert.ok(Math.abs(read(2) / read(1) - 2) < 0.05, `${read(1)} then ${read(2)}`);
});

test("timing: a camera move in a hold is the camera's share, not an unrelated change", () => {
  const steps: Step[] = [
    { at: 0, enter: "none", add: [shape("flask", 540, 960, 150), shape("other", 200, 300, 40)], set: { camera: { zoom: 1, panX: 540, panY: 960 } } },
    { at: 30, set: { camera: { zoom: 1.2, panX: 540, panY: 960 } }, move: { frames: 60 } },
    { at: 40, set: { flask: { fill: "#ff3300" } }, move: { frames: 20 } },
  ];
  const scene = compile({ steps }, ctxOf(120));
  const input: MeasureInput = { scene, words: [], viewing: phone(), ids: { flask: ["flask"] }, holds: [{ id: "h", from: 1, to: 3 }] };
  const r = instruments.timing!.measure(input, settingsFor("timing", input));
  assert.equal(r.values["hold.h.unrelated"], 0, readingsText([r]));
  assert.ok(r.values["hold.h.camera"]! > 0.9, readingsText([r]));
  assert.ok(r.values["hold.h.related"]! > 0.2);
  assert.ok(r.values.holdCamera! > 0.9);
});

test("timing: a thing whose name is never spoken is timed against its moment's word, and the notes say so", () => {
  const words = [{ text: "now", start: 0.2 }, { text: "watch", start: 0.6 }, { text: "it", start: 1.0 }, { text: "change", start: 1.5 }];
  const steps: Step[] = [{ at: 0, enter: "none", add: [shape("t.vessel", 540, 960, 150)] }, { at: 44, set: { "t.vessel": { fill: "#ff3300" } }, move: { frames: 10 } }];
  const scene = compile({ steps }, ctxOf(90, words));
  const base: MeasureInput = { scene, words, viewing: phone(), ids: { vessel: ["t.vessel"] } };
  const none = instruments.timing!.measure(base, settingsFor("timing", base));
  assert.equal(none.values["lag.vessel"], undefined);
  const input = { ...base, cues: { vessel: [3] } };
  const r = instruments.timing!.measure(input, settingsFor("timing", input));
  assert.ok(Math.abs(r.values["lag.vessel"]! - (44 / 30 - 1.5)) < 0.05, readingsText([r]));
  assert.equal(r.values.cued, 1);
  assert.ok(r.notes.some((n) => /name is not spoken/.test(n) && /"change"/.test(n)), r.notes.join(" | "));
});

test("each describe names every value its instrument reports, so an agent can set a goal on any of them", () => {
  const words = [{ text: "the", start: 0.2 }, { text: "box", start: 0.6 }];
  const steps: Step[] = [...pushed(1.5), { at: 40, set: { tall: { fill: "#ff3300" } }, move: { frames: 10 } }];
  const scene = compile({ steps }, ctxOf(91, words));
  const input: MeasureInput = { scene, words, viewing: phone(), ids: { tall: ["tall"], wide: ["wide"] }, holds: [{ id: "h", from: 1, to: 2 }], cues: { tall: [1] } };
  const names = new Set(["tall", "wide"]);
  for (const [n, inst] of Object.entries(instruments)) {
    if (n === "requirement") continue;
    const r = inst.measure(input, settingsFor(n, input));
    for (const key of Object.keys(r.values)) assert.equal(valueProblem(inst.describe, key, names, new Set(["h"])), undefined, `${n}: ${key} is not in its describe`);
    assert.ok(inst.describe.length < 700, `${n}: describe is ${inst.describe.length} characters`);
  }
});
