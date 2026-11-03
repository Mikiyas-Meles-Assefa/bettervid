import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "../../core/compile.ts";
import type { CompileContext, NodeSpec, SceneDoc, Step } from "../../core/types.ts";
import type { MeasureInput, PartCard, Viewing } from "../types.ts";
import { instruments, measureAll, readingsText, settingsFor } from "./index.ts";

const theme = { colors: { ink: "#111111", accent: "#ff3300", paper: "#ffffff" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" as const };
const ctxOf = (width: number, height: number, frames: number, words?: { start: number }[]): CompileContext => ({ fps: 30, width, height, frames, theme, words });
const square = (s: number) => [-s, -s, s, -s, s, s, -s, s];
const shape = (id: string, x: number, y: number, s: number, fill = "#222222"): NodeSpec => ({ id, kind: "path", props: { x, y, points: square(s), closed: 1, fill, stroke: "none" } });
const text = (id: string, x: number, y: number, words: string, size: number): NodeSpec => ({ id, kind: "text", props: { x, y, text: words, size, color: "#111111" } });

const phone = (w = 1080, h = 1920): Viewing => ({ width: w, height: h, fps: 30, screen: "phone in a feed", frameWidthMm: 65, distanceMm: 400, watch: "glancing in a feed", uiZones: [{ box: [0, 0.82, 1, 1], what: "captions and buttons" }], captions: { show: true, why: "muted feed" }, why: "test" });
const tv = (): Viewing => ({ width: 1920, height: 1080, fps: 30, screen: "TV across a living room", frameWidthMm: 1210, distanceMm: 3000, watch: "watching on purpose", uiZones: [], captions: { show: false, why: "sound on" }, why: "test" });

// A source pours a stream of look-alike pieces: each appears at the source, falls, and is gone. Ids are plain numbers on
// purpose: the grouping must come from structure, not names.
function pouring(n: number, gap: number): SceneDoc {
  const steps: Step[] = [{ at: 0, enter: "none", add: [shape("source", 540, 400, 60, "#555555"), shape("vessel", 540, 1300, 200, "#888888")] }];
  for (let k = 0; k < n; k++) {
    const at = 30 + k * gap;
    steps.push({ at, enter: "fade", move: { frames: 3 }, add: [{ ...shape(`p${k}`, 540, 470, 12, "#3399ff") }] });
    steps.push({ at: at + 4, set: { [`p${k}`]: { y: 1100 } }, move: { frames: 14, ease: "in" } });
    steps.push({ at: at + 18, remove: [`p${k}`], move: { frames: 3 } });
  }
  return { steps };
}

test("a stream of drops is one thing, not a new thing per drop", () => {
  const scene = compile(pouring(20, 6), ctxOf(1080, 1920, 200));
  const input: MeasureInput = { scene, words: [], viewing: phone() };
  const r = instruments.load!.measure(input, settingsFor("load", input));
  assert.equal(r.values.streams, 1);
  assert.equal(r.values.streamMembers, 20);
  // Around the first second: the source, the vessel and the stream's start.
  assert.ok(r.values.peakNew! <= 3, `peakNew ${r.values.peakNew}`);
  assert.ok(r.values.peakPull! <= 3, `peakPull ${r.values.peakPull}`);
  // With grouping off (a stream would need more arrivals than there are), every drop is new.
  const each = instruments.load!.measure(input, settingsFor("load", input, { min: 1000 }));
  assert.equal(each.values.streams, 0);
  assert.ok(each.values.peakNew! >= 8, `peakNew without streams ${each.values.peakNew}`);
  // The eye follows the stream as one thing.
  const eye = instruments.eyePath!.measure(input, settingsFor("eyePath", input));
  assert.ok(eye.values.missed! <= 2, readingsText([eye]));
});

test("two things arriving together are two things, and a still set is not a stream", () => {
  const steps: Step[] = [{ at: 10, add: [shape("a", 300, 600, 80), shape("b", 780, 600, 80)] }, { at: 20, set: { a: { y: 1400 }, b: { y: 1400 } }, move: { frames: 20 } }];
  // Five look-alike marks arriving one by one in a row, not moving: a list being built.
  for (let k = 0; k < 5; k++) steps.push({ at: 60 + k * 8, add: [shape(`m${k}`, 200 + k * 150, 300, 20)] });
  const scene = compile({ steps }, ctxOf(1080, 1920, 150));
  const input: MeasureInput = { scene, words: [], viewing: phone() };
  const r = instruments.load!.measure(input, settingsFor("load", input));
  assert.equal(r.values.streams, 0);
  assert.equal(r.values.peakNew, 5);
});

test("salience: a new, large, contrasting thing takes most attention; spread is reported", () => {
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [shape("small", 200, 300, 30, "#dddddd"), text("note", 540, 1500, "a quiet note", 40)] },
    { at: 30, add: [shape("hero", 540, 900, 250, "#ff3300")] },
  ] }, ctxOf(1080, 1920, 90));
  const input: MeasureInput = { scene, words: [], viewing: phone(), window: [30, 90], ids: { hero: ["hero"], note: ["note"] } };
  const r = instruments.salience!.measure(input, settingsFor("salience", input));
  assert.ok(r.values["share.hero"]! > 0.5, readingsText([r]));
  assert.ok(r.values["share.hero"]! > r.values["share.note"]!);
  assert.ok(r.values.entropy! > 0 && r.values.entropy! < 1);
  assert.match(r.notes[0]!, /hero/);
});

test("a 16:9 frame on a TV: grid, legibility by angle, cut words, balance", () => {
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [shape("left", 400, 540, 300, "#111111"), text("title", 960, 120, "Across the room", 90), text("tiny", 1500, 900, "fine print", 14), text("edge", 1900, 540, "falls off the edge", 60)] },
  ] }, ctxOf(1920, 1080, 60));
  const input: MeasureInput = { scene, words: [], viewing: tv() };
  const leg = instruments.legibility!.measure(input, settingsFor("legibility", input));
  // 14 px on a 1210 mm wide 1920 px frame at 3 m: about 7 arcmin of cap height; 90 px about 45.
  assert.ok(leg.values.minAngle! > 5 && leg.values.minAngle! < 9, `minAngle ${leg.values.minAngle}`);
  assert.ok(leg.values.shareBelow! > 0 && leg.values.shareBelow! < 0.5);
  assert.ok(leg.values.cut! > 0);
  const fill = instruments.fill!.measure(input, settingsFor("fill", input));
  assert.match(fill.notes[0]!, /16 by 9 cells/);
  assert.ok(fill.values.balanceX! < 0, `balanceX ${fill.values.balanceX}`); // the big dark block sits left
  const vis = instruments.visibility!.measure({ ...input, ids: { edge: ["edge"], title: ["title"] } }, settingsFor("visibility", input));
  assert.ok(vis.values["cut.edge"]! > 0);
  assert.equal(vis.values["cut.title"], 0);
  assert.equal(vis.values["withheld.title"], 0);
});

test("UI zones: a thing under the platform's buttons is reported, and the zone leaves the usable frame", () => {
  const scene = compile({ steps: [{ at: 0, enter: "none", add: [text("cta", 540, 1800, "Tap here", 70), shape("top", 540, 400, 200)] }] }, ctxOf(1080, 1920, 30));
  const input: MeasureInput = { scene, words: [], viewing: phone(), ids: { cta: ["cta"] } };
  const vis = instruments.visibility!.measure(input, settingsFor("visibility", input));
  assert.ok(vis.values["ui.cta"]! > 0);
  const fill = instruments.fill!.measure(input, settingsFor("fill", input));
  assert.match(fill.notes[0]!, /in UI zones left out/);
});

test("timing: onset against the word that names a thing; holds split related from unrelated change", () => {
  const words = [{ text: "Watch", start: 0.2 }, { text: "the", start: 0.5 }, { text: "flask", start: 1 }, { text: "now", start: 1.4 }];
  const scene = compile({ steps: [
    { at: { word: 2, offset: -3 }, add: [shape("flask", 540, 900, 150)] },
    { at: 75, set: { flask: { fill: "#ff3300" } }, move: { frames: 20 } },
    { at: 0, enter: "none", add: [shape("clock", 900, 200, 30)] },
    { at: 100, set: { clock: { rotate: 90 } }, move: { frames: 20 } },
  ] }, ctxOf(1080, 1920, 150, words));
  const input: MeasureInput = { scene, words, viewing: phone(), ids: { flask: ["flask"] }, holds: [{ id: "h1", from: 2.4, to: 4.4 }] };
  const r = instruments.timing!.measure(input, settingsFor("timing", input));
  // Its fade starts 3 frames before the word and shows (over 5% opacity) about as the word starts.
  assert.ok(Math.abs(r.values["lag.flask"]!) <= 0.1, `lag ${r.values["lag.flask"]}`);
  assert.ok(r.values["hold.h1.related"]! > 0.2);
  assert.ok(r.values["hold.h1.unrelated"]! > 0.2);
  assert.ok(r.values["hold.h1.still"]! > 0);
});

test("steadiness: a thing that jumps between rests is reported", () => {
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [shape("kept", 300, 600, 100), shape("still", 800, 600, 100)] },
    { at: 40, set: { kept: { x: 700, scaleX: 1.5, scaleY: 1.5 } }, move: { frames: 6 } },
  ] }, ctxOf(1080, 1920, 90));
  const input: MeasureInput = { scene, words: [], viewing: phone() };
  const r = instruments.steadiness!.measure(input, settingsFor("steadiness", input));
  assert.equal(r.values.jumpers, 1);
  assert.equal(r.values.kept, 2);
  assert.match(r.notes[0]!, /kept/);
});

test("eye path: a change during a camera move is likely missed", () => {
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [shape("main", 540, 900, 250, "#111111"), shape("side", 900, 300, 30, "#cccccc")], set: { camera: { zoom: 1 } } },
    { at: 30, set: { camera: { zoom: 1.4 } }, move: { frames: 40 } },
    { at: 45, set: { side: { fill: "#bbbbbb" } }, move: { frames: 4 } },
  ] }, ctxOf(1080, 1920, 120));
  const input: MeasureInput = { scene, words: [], viewing: phone() };
  const r = instruments.eyePath!.measure(input, settingsFor("eyePath", input));
  assert.ok(r.values.missedCamera! >= 1, readingsText([r]));
});

test("requirement: the required part of the user's picture, its time on screen and size", () => {
  const scene = compile({ steps: [{ at: 0, enter: "none", add: [{ id: "slide", kind: "image", props: { x: 540, y: 800, w: 1000, h: 600, src: "x.png" } }] }] }, ctxOf(1080, 1920, 90));
  const card: PartCard = { name: "deck", file: "deck.png", kind: "slide", about: "a slide", parts: { total: { box: [0.1, 0.1, 0.4, 0.2], about: "the total" } }, requirements: [{ id: "r1", source: { file: "brief.md" }, applies: "deck.total", kind: "on screen for", detail: "the total stays readable for 2 s", why: "the client asked" }], checked: { ok: true, notes: [] } };
  const input: MeasureInput = { scene, words: [], viewing: phone(), ids: { deck: ["slide"] } };
  const r = instruments.requirement!.measure(input, settingsFor("requirement", input, { requirement: card.requirements[0], card }));
  assert.ok(Math.abs(r.values.seconds! - 3) < 0.2, `seconds ${r.values.seconds}`);
  // The part is 0.1 of a 600 px tall picture: 60 px on a 1080 px frame 65 mm wide at 40 cm, about 31 arcmin.
  assert.ok(r.values.angle! > 25 && r.values.angle! < 35, `angle ${r.values.angle}`);
  assert.ok(r.values.firstSeen! >= 0 && r.values.firstSeen! < 0.2);
});

test("every instrument suggests settings with a reason, and all of them run fast on a 5 s window", () => {
  const scene = compile(pouring(30, 8), ctxOf(1080, 1920, 300));
  const input: MeasureInput = { scene, words: [], viewing: phone(), window: [60, 210] };
  for (const [name, inst] of Object.entries(instruments)) {
    const s = inst.suggest(input.viewing) as { why?: string };
    assert.ok(s.why && s.why.length > 10, `${name} suggests no reason`);
    assert.ok(inst.describe.length > 40);
  }
  const t = performance.now();
  const readings = measureAll(input);
  const ms = performance.now() - t;
  assert.equal(readings.length, Object.keys(instruments).length - 1); // requirement runs only with a requirement
  assert.ok(ms < 500, `took ${ms.toFixed(0)} ms`);
  const lines = readingsText(readings);
  assert.match(lines, /^salience: top /m);
  assert.match(lines, /^load: .*streams 1/m);
  for (const r of readings) for (const v of Object.values(r.values)) assert.ok(Number.isFinite(v), `${r.instrument} has a value that is not a number`);
});

test("timing: a silence is read only in the window that holds it; shown is what is tied to it on screen", () => {
  const words = [{ text: "Guess", start: 0.2 }, { text: "now", start: 0.6 }, { text: "then", start: 4.6 }];
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [shape("bars", 540, 900, 150), text("q", 540, 300, "how many?", 60)] },
    { at: 60, remove: ["q"], move: { frames: 3 } },
  ] }, ctxOf(1080, 1920, 180, words));
  const holds = [{ id: "h1", from: 1, to: 3, names: ["bars", "q"] }];
  const ids = { bars: ["bars"], q: ["q"] };
  const at = (window: [number, number]) => {
    const input: MeasureInput = { scene, words, viewing: phone(), ids, holds, window };
    return instruments.timing!.measure(input, settingsFor("timing", input));
  };
  // In the window that holds the silence: little changes (only the question leaving) while it shows for half of it.
  const inside = at([0, 120]);
  assert.ok(inside.values["hold.h1.related"]! <= 0.1, `related ${inside.values["hold.h1.related"]}`);
  assert.ok(inside.values["hold.h1.still"]! >= 0.9);
  assert.ok(Math.abs(inside.values["hold.h1.shown"]! - 0.5) < 0.1, `shown ${inside.values["hold.h1.shown"]}`);
  assert.ok(inside.notes.some((n) => /bars, q/.test(n)), "the notes name what is tied to the silence");
  // In a window without it: no value, and the reading says the silence's values do not apply there.
  const outside = at([120, 180]);
  assert.equal(outside.values["hold.h1.related"], undefined);
  assert.ok(outside.outside?.includes("hold.h1.related") && outside.outside.includes("holdRelated"));
});

test("steadiness: a close-in that holds moves nothing on the stage when camera moves are left out", () => {
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [shape("a", 300, 700, 80), shape("b", 780, 1200, 80)], set: { camera: { zoom: 1, panX: 540, panY: 960 } } },
    { at: 30, set: { camera: { zoom: 2.4, panX: 300, panY: 700 } }, move: { frames: 20 } },
  ] }, ctxOf(1080, 1920, 120));
  const input: MeasureInput = { scene, words: [], viewing: phone() };
  const off = instruments.steadiness!.measure(input, settingsFor("steadiness", input));
  assert.equal(off.values.jumps, 0, off.notes.join("; "));
  // Counting the camera, the same close-in is a jump of everything it moved.
  const on = instruments.steadiness!.measure(input, settingsFor("steadiness", input, { camera: true }));
  assert.ok(on.values.jumps! >= 1, `jumps with the camera ${on.values.jumps}`);
});

test("load: a stream is the same stream whatever part of it a window starts on", () => {
  // Five look-alike drops 0.5 s apart: one stream. A window that starts on its last two drops still sees that stream.
  const scene = compile(pouring(5, 15), ctxOf(1080, 1920, 200));
  const read = (window: [number, number]) => {
    const input: MeasureInput = { scene, words: [], viewing: phone(), window };
    return instruments.load!.measure(input, settingsFor("load", input));
  };
  const whole = read([0, 200]);
  const late = read([88, 200]);
  assert.equal(whole.values.streams, 1);
  assert.equal(late.values.streams, 1, late.notes.join("; "));
  assert.ok(late.values.peakNew! <= 1, `the stream's late drops are not new things: peakNew ${late.values.peakNew}`);
});

test("fill reads how big the biggest single thing is, apart from how much is on screen", () => {
  const sceneOf = (adds: NodeSpec[]) => compile({ steps: [{ at: 0, enter: "none", add: adds }] }, ctxOf(1080, 1920, 60));
  // One small row of numbers in the middle of a tall frame: little of the frame holds anything, and the biggest thing is small.
  const small = sceneOf([shape("a", 400, 960, 40), shape("b", 500, 960, 40), shape("c", 600, 960, 40)]);
  const si: MeasureInput = { scene: small, words: [], viewing: phone(), window: [0, 30] };
  const s = instruments.fill!.measure(si, settingsFor("fill", si));
  assert.ok(s.values.largest! < 0.05, `largest ${s.values.largest}`);
  assert.match(s.notes[0]!, /biggest single thing covers \d+% of the usable frame/);
  // The same three, each filling most of a third of the frame: the biggest thing is a large share.
  const big = sceneOf([shape("a", 540, 300, 250), shape("b", 540, 850, 250), shape("c", 540, 1400, 250)]);
  const bi: MeasureInput = { scene: big, words: [], viewing: phone(), window: [0, 30] };
  const b = instruments.fill!.measure(bi, settingsFor("fill", bi));
  assert.ok(b.values.largest! > 0.1, `largest ${b.values.largest}`);
});
