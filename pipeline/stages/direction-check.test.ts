// The direction check (pipeline/lib/direction-check.ts) on synthetic scenes and plans. Pure parts only: no renders,
// no audio files and no model calls.
// Run: node --experimental-strip-types --test pipeline/stages/direction-check.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Key, Scene, SceneNode, Track } from "../../engine/core/types.ts";
import type { DirectionEvent, DirectionPlan, Word } from "../../schemas/project.ts";
import { asCritic, attachments, beats, belongs, checkDemo, checkHoldAudio, checkHoldPictures, checkLook, checkPromise, checkTempo, checkWithhold, cleanMap, holds, type IdMap, parseSilences, runChecks, sample, spans } from "../lib/direction-check.ts";

const FPS = 30;
const scene = (frames: number, nodes: SceneNode[], tracks: Track[] = []): Scene => ({ fps: FPS, width: 1080, height: 1920, frames, background: "#000", nodes, tracks, events: [] });
const box = (id: string, x: number, y: number, extra: Record<string, number | string> = {}): SceneNode[] => [
  { id, kind: "group", props: { x, y, ...extra } },
  { id: `${id}.shape`, kind: "path", parent: id, props: { points: [-50, -50, 50, -50, 50, 50, -50, 50], stroke: "#fff" } },
  { id: `${id}.label`, kind: "text", parent: id, props: { text: id.toUpperCase(), size: 60, color: "#fff" } },
];
const track = (target: string, prop: string, keys: [number, number | string][]): Track => ({ target, prop, keys: keys.map(([at, value]): Key => ({ at, value, ease: "linear" })) });
// A thing that moves back and forth for a stretch: a steady pull on the eye.
const wobble = (target: string, from: number, to: number, every = 6): Track => track(target, "y", Array.from({ length: Math.floor((to - from) / every) + 1 }, (_, i): [number, number] => [from + i * every, 500 + (i % 2) * 40]));
// One step of the picture at each frame: a jump of 200 px over 6 frames.
const steps = (target: string, at: number[]): Track => track(target, "x", [[0, 100], ...at.flatMap((f, i): [number, number][] => [[f, 100 + i * 200], [f + 6, 100 + (i + 1) * 200]])]);
const words = (n: number, every = 0.5): Word[] => Array.from({ length: n }, (_, i) => ({ text: `w${i}`, start: i * every, end: i * every + every * 0.8, beatId: "b1" }));
const event = (id: string, firstWord: number, lastWord: number, extra: Partial<DirectionEvent> = {}): DirectionEvent => ({ id, firstWord, lastWord, job: "a job", knows: "", waiting: "", look: "the thing", feel: "calm", rhythm: "long", ...extra });
const plan = (events: DirectionEvent[], promise = "the question"): DirectionPlan => ({ goal: "", promise, arc: "", events, cues: [] });
const ids = (events: Record<string, Partial<IdMap["events"][string]>>, promise: string[] = []): IdMap => ({ promise, events: Object.fromEntries(Object.entries(events).map(([k, v]) => [k, { look: [], withhold: [], demo: [], ...v }])) });

test("sampling marks what moves, fades or changes color, frame by frame, and what is visible", () => {
  const s = sample(scene(90, [...box("a", 100, 500), ...box("b", 500, 500, { opacity: 0 }), ...box("c", 900, 500)], [
    track("a", "x", [[0, 100], [30, 100], [45, 400]]),
    track("b", "opacity", [[0, 0], [60, 0], [70, 1]]),
    track("c.label", "color", [[0, "#ffffff"], [50, "#ffffff"], [51, "#ff0000"]]),
  ]));
  const at = (id: string) => s.ids.indexOf(id);
  assert.deepEqual(s.ids, ["a", "b", "c"]);
  assert.equal(s.active[at("a")]![20], 0);
  assert.equal(s.active[at("a")]![38], 1);
  assert.equal(s.active[at("a")]![70], 0);
  assert.equal(s.visible[at("b")]![30], 0);
  assert.equal(s.visible[at("b")]![80], 1);
  assert.equal(s.active[at("b")]![65], 1);
  assert.equal(s.active[at("c")]![52], 1);
  assert.equal(s.active[at("c")]![80], 0);
  assert.equal(s.text.get("a"), "A");
});

test("a part whose id extends a top-level id belongs to it, and marks count for what they mark", () => {
  const s = sample(scene(10, [{ id: "arrow", kind: "path", props: { points: [0, 0, 10, 10] } }, { id: "arrow.head", kind: "path", props: { points: [0, 0, 5, 5] } }]));
  assert.deepEqual(s.ids, ["arrow"]);
  const attached = attachments(`@0\nbox a "A"\nbox b "B"\n@1 keep\nmark ring a id=r1\ntag b "bee"\narrow a -> b id=link`);
  assert.deepEqual(attached.get("r1"), ["a"]);
  assert.deepEqual(attached.get("tag.b"), ["b"]);
  assert.deepEqual(attached.get("link"), ["a", "b"]);
  assert.ok(belongs("r1", ["a"], attached));
  assert.ok(belongs("tag.b", ["b"], attached));
  assert.ok(belongs("mark.ring.a", ["a"]));
  assert.ok(!belongs("ab", ["a"], attached));
});

test("look: quiet when the look is what changes, and names the competition when it is not", () => {
  const w = words(20); // 10 s
  const p = plan([event("e1", 0, 9), event("e2", 10, 19)]);
  const sc = scene(300, [...box("a", 100, 500), ...box("b", 500, 500), ...box("c", 900, 500), ...box("d", 500, 900)], [
    wobble("a", 0, 140), // e1: only the look moves
    wobble("b", 150, 290), // e2: three other things move all through, the look moves once
    wobble("c", 150, 290),
    wobble("d", 150, 290),
    track("a", "x", [[0, 100], [200, 100], [206, 140]]),
  ]);
  const s = sample(sc);
  const list = spans(p, w, FPS, sc.frames);
  const r = checkLook(s, list, ids({ e1: { look: ["a"] }, e2: { look: ["a"] } }), new Map());
  assert.equal(r.tickets.length, 1);
  assert.equal(r.tickets[0]!.event, "e2");
  assert.equal(r.tickets[0]!.kind, "competing");
  assert.match(r.tickets[0]!.note, /3 other things/);
  assert.ok(r.rows[0]!.share > 0.9);
});

test("look: a look that never changes while other things do, and a look the scene does not have", () => {
  const w = words(20);
  const p = plan([event("e1", 0, 9), event("e2", 10, 19)]);
  const sc = scene(300, [...box("a", 100, 500), ...box("b", 500, 500)], [wobble("b", 0, 290)]);
  const r = checkLook(sample(sc), spans(p, w, FPS, sc.frames), ids({ e1: { look: ["a"] }, e2: { look: [] } }), new Map());
  assert.deepEqual(r.tickets.map((t) => t.kind), ["look_still", "look_absent"]);
});

test("look: a ring on the look counts as the look being signaled, not as competition", () => {
  const w = words(10);
  const p = plan([event("e1", 0, 9)]);
  const sc = scene(150, [...box("a", 100, 500), { id: "r1", kind: "path", props: { points: [0, 0, 100, 0, 100, 100], stroke: "#f00" } }, ...box("b", 500, 500)], [wobble("r1", 0, 140), wobble("b", 0, 20)]);
  const r = checkLook(sample(sc), spans(p, w, FPS, sc.frames), ids({ e1: { look: ["a"] } }), new Map([["r1", ["a"]]]));
  assert.equal(r.tickets.length, 0);
});

test("withhold: a withheld thing on screen before its event is found, one that waits is not", () => {
  const w = words(30);
  const p = plan([event("e1", 0, 9, { withhold: { what: "the answer", until: "e3" } }), event("e2", 10, 19, { withhold: { what: "the other", until: "e3" } }), event("e3", 20, 29)]);
  const sc = scene(450, [...box("ans", 100, 500, { opacity: 0 }), ...box("other", 500, 500, { opacity: 0 })], [
    track("ans", "opacity", [[0, 0], [150, 0], [160, 1]]), // shows during e2, before e3 at 300
    track("other", "opacity", [[0, 0], [310, 0], [320, 1]]),
  ]);
  const r = checkWithhold(sample(sc), spans(p, w, FPS, sc.frames), ids({ e1: { withhold: ["ans"] }, e2: { withhold: ["other"] } }), new Map());
  assert.equal(r.length, 1);
  assert.equal(r[0]!.kind, "withheld_early");
  assert.equal(r[0]!.event, "e1");
  assert.match(r[0]!.note, /ans .* shows from 5\.0 s/);
});

test("tempo: a flat rate of change is found, a varied one is not, and a long event busier than the short ones is named", () => {
  const w = words(40); // 20 s, four events of 5 s
  const p = plan([event("e1", 0, 9, { rhythm: "long" }), event("e2", 10, 19, { rhythm: "short" }), event("e3", 20, 29, { rhythm: "long" }), event("e4", 30, 39, { rhythm: "short" })]);
  const every = (step: number) => Array.from({ length: Math.floor(600 / step) }, (_, i) => 5 + i * step);
  const flat = sample(scene(600, box("a", 100, 500), [steps("a", every(30))]));
  const t1 = checkTempo(flat, spans(p, w, FPS, 600));
  assert.ok(t1.cv < 0.25);
  assert.ok(t1.tickets.some((t) => t.kind === "flat_rhythm" && t.route === "scene"));
  // Long events calm, short events busy.
  const varied = [...[5, 75], ...every(15).filter((f) => f >= 150 && f < 290), 330, 400, ...every(12).filter((f) => f >= 450 && f < 590)];
  const t2 = checkTempo(sample(scene(600, box("a", 100, 500), [steps("a", varied)])), spans(p, w, FPS, 600));
  assert.ok(t2.cv > 0.5);
  assert.equal(t2.tickets.length, 0);
  // The reverse: the long events are the busy ones.
  const reversed = [...every(12).filter((f) => f < 140), 170, 240, ...every(12).filter((f) => f >= 300 && f < 440), 470, 540];
  const t3 = checkTempo(sample(scene(600, box("a", 100, 500), [steps("a", reversed)])), spans(p, w, FPS, 600));
  assert.deepEqual(t3.tickets.map((t) => `${t.kind} ${t.event}`), ["rhythm_mismatch e1", "rhythm_mismatch e3"]);
});

test("a plan that never varies its rhythm sends a flat video back to the direction stage", () => {
  const w = words(40);
  const p = plan([0, 1, 2, 3].map((i) => event(`e${i + 1}`, i * 10, i * 10 + 9, { rhythm: "short" })));
  const s = sample(scene(600, box("a", 100, 500), [steps("a", Array.from({ length: 20 }, (_, i) => 5 + i * 30))]));
  assert.equal(checkTempo(s, spans(p, w, FPS, 600)).tickets[0]!.route, "direction");
});

test("holds: placed where the voice left them, or where they should have been", () => {
  const w = words(10);
  const p = plan([event("e1", 0, 9, { holds: [{ id: "h1", afterWord: 3, seconds: 2, purpose: "look", does: "x" }, { id: "h2", afterWord: 6, seconds: 1, purpose: "predict", does: "y" }] })]);
  const hs = holds(p, { words: w, holds: [{ id: "h1", afterWord: 3, start: 1.9, seconds: 2.1 }] });
  assert.deepEqual(hs.map((h) => [h.id, h.start, +h.end.toFixed(2), h.voiced]), [["h1", 1.9, 4, true], ["h2", 3.4, 4.4, false]]);
});

test("hold pictures: a frozen hold, a hold that keeps working, and a hold where something unrelated moves", () => {
  const w = words(30);
  const mk = (tracks: Track[]) => sample(scene(450, [...box("a", 100, 500), ...box("b", 500, 500)], tracks));
  const p = plan([event("e1", 0, 29, { holds: [{ id: "h1", afterWord: 5, seconds: 3, purpose: "look", does: "the thing pulses" }] })]);
  const hs = holds(p, { words: w, holds: [{ id: "h1", afterWord: 5, start: 3, seconds: 3 }] });
  const list = spans(p, w, FPS, 450);
  const map = ids({ e1: { look: ["a"] } });
  assert.equal(checkHoldPictures(mk([]), hs, list, map, new Map())[0]!.kind, "hold_frozen");
  assert.equal(checkHoldPictures(mk([wobble("a", 90, 180)]), hs, list, map, new Map()).length, 0);
  assert.equal(checkHoldPictures(mk([wobble("a", 90, 100), wobble("b", 90, 180)]), hs, list, map, new Map())[0]!.kind, "hold_competing");
});

test("hold audio: silence found in the voice, a missing hold and a short one", () => {
  const log = ["[silencedetect @ 0x1] silence_start: 1.95", "[silencedetect @ 0x1] silence_end: 4.02 | silence_duration: 2.07", "[silencedetect @ 0x1] silence_start: 6.5", "[silencedetect @ 0x1] silence_end: 6.9 | silence_duration: 0.4", "[silencedetect @ 0x1] silence_start: 9.5"].join("\n");
  const quiet = parseSilences(log);
  assert.deepEqual(quiet.slice(0, 2), [{ start: 1.95, end: 4.02 }, { start: 6.5, end: 6.9 }]);
  assert.equal(quiet[2]!.end, Infinity);
  const base = { event: "e1", afterWord: 1, purpose: "look", does: "" };
  const r = checkHoldAudio([
    { ...base, id: "h1", seconds: 2, start: 2, end: 4, voiced: true },
    { ...base, id: "h2", seconds: 2, start: 6.5, end: 8.5, voiced: false },
    { ...base, id: "h3", seconds: 2, start: 6.5, end: 8.5, voiced: true },
  ], quiet);
  assert.deepEqual(r.tickets.map((t) => `${t.kind} ${t.route} ${t.severity}`), ["hold_missing voice 3", "hold_short voice 3"]);
  assert.equal(+r.rows[0]!.silent.toFixed(2), 2);
});

test("demo: a slow phase that rushes, a slow phase at a readable rate, and a fast phase that never rests", () => {
  const w = words(40); // 20 s
  const ev = (phases: NonNullable<DirectionEvent["demo"]>["phases"]) => plan([event("e1", 0, 39, { demo: { what: "the values", phases } })]);
  const run = (at: number[], phases: NonNullable<DirectionEvent["demo"]>["phases"]) => {
    const p = ev(phases);
    const s = sample(scene(600, [...box("v", 100, 500), ...box("other", 900, 900)], [steps("v", at), wobble("other", 0, 590)]));
    return checkDemo(s, spans(p, w, FPS, 600), [], w, ids({ e1: { demo: ["v"] } }), new Map());
  };
  // Four slow steps in 2 s: 0.5 s each.
  const rushed = run([5, 20, 35, 50], [{ steps: [1, 4], pace: "slow", at: { word: 0 }, until: { word: 3 }, why: "" }]);
  assert.equal(rushed.tickets[0]!.kind, "demo_rushed");
  assert.match(rushed.tickets[0]!.note, /4 steps get 0\.\d+ s each/);
  // Four slow steps 1.5 s apart over 6 s, then a fast phase that settles 2 s before it ends.
  const fine = run([5, 50, 95, 140, 190, 196, 202, 208, 214], [{ steps: [1, 4], pace: "slow", at: { word: 0 }, why: "" }, { steps: [5, 9], pace: "fast", at: { word: 12 }, until: { word: 19 }, why: "" }]);
  assert.deepEqual(fine.tickets, []);
  assert.ok(fine.rows[1]!.settled! > 1);
  // The fast phase still moving when it ends.
  const busy = run([190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290], [{ steps: [5, 9], pace: "fast", at: { word: 12 }, until: { word: 18 }, why: "" }]);
  assert.equal(busy.tickets[0]!.kind, "demo_unsettled");
});

test("promise: found from the scene when something it names shows in the first seconds", () => {
  const p = plan([event("e1", 0, 9)], "why the thing happens");
  const s = sample(scene(150, [...box("q", 100, 500, { opacity: 0 })], [track("q", "opacity", [[0, 0], [30, 0], [36, 1]])]));
  assert.equal(checkPromise(s, p, ids({}, ["q"]), new Map(), "e1"), undefined);
  assert.equal(checkPromise(s, p, ids({}, []), new Map(), "e1")!.kind, "promise_missing");
  const late = sample(scene(150, [...box("q", 100, 500, { opacity: 0 })], [track("q", "opacity", [[0, 0], [120, 0], [126, 1]])]));
  assert.match(checkPromise(late, p, ids({}, ["q"]), new Map(), "e1")!.note, /first 3 s/);
});

test("the id map keeps only ids the scene has, and a container stands for what it holds", () => {
  const s = sample(scene(10, [...box("a", 100, 500), ...box("b", 500, 500)]));
  const m = cleanMap({ promise: ["row1", "ghost"], events: [{ id: "e1", look: ["a", "nope"], withhold: [], demo: ["row1"] }] }, s, new Map([["row1", ["a", "b", "a.label"]]]));
  assert.deepEqual(m.promise, ["a", "b"]);
  assert.deepEqual(m.events.e1, { look: ["a"], withhold: [], demo: ["a", "b"] });
});

test("everything together: tickets in time order, in the critic's format with the event and who acts", () => {
  const w = words(20);
  const p = plan([event("e1", 0, 9, { holds: [{ id: "h1", afterWord: 4, seconds: 2, purpose: "look", does: "pulse" }] }), event("e2", 10, 19)]);
  const s = sample(scene(300, box("a", 100, 500)));
  const r = runChecks({ plan: p, narration: { words: w }, samples: s, ids: ids({ e1: { look: ["a"] }, e2: { look: ["a"] } }, ["a"]), quiet: [] });
  const kinds = r.tickets.map((t) => t.kind);
  assert.ok(kinds.includes("hold_frozen") && kinds.includes("hold_missing"));
  assert.deepEqual([...r.tickets.map((t) => t.from)], [...r.tickets.map((t) => t.from)].sort((a, b) => a - b));
  const c = asCritic(r.tickets.find((t) => t.kind === "hold_missing")!);
  assert.equal(c.shotId, "e1");
  assert.equal(c.action, "direction:voice:hold_missing:3");
  assert.equal(beats(s, 0, 300).length, 0);
});
