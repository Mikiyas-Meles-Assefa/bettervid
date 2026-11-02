// The direction's word bookkeeping: events cover every word once, cues become beats of their own, every word number in
// the plan moves to the final script, and a plan that breaks a rule is caught before it reaches the voice.
// Run: node --experimental-strip-types --test pipeline/stages/direction.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompileContext } from "../../engine/core/types.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import type { Script } from "../../schemas/project.ts";
import { truthKindNames } from "../lib/abilities.ts";
import { applyCues, coverage, demoSteps, problems, scriptWords, stripCues, type RawEvent, type RawPlan } from "./direction.ts";
import { SCENE_KITS } from "./scene.ts";

// Words 0 to 5 in b1, 6 to 13 in b2.
const script: Script = {
  title: "T",
  takeaway: "K",
  beats: [
    { id: "b1", role: "hook", text: "Here is a puzzle. Look closely.", claimIds: ["c1"], visual: "the puzzle", emphasis: ["puzzle"] },
    { id: "b2", role: "example", text: "First the left moves. Then the right follows.", claimIds: ["c2"], visual: "both sides", emphasis: ["right"] },
  ],
};

const none = { word: -1, hold: "", cue: "" };
const event = (id: string, firstWord: number, lastWord: number, more: Partial<RawEvent> = {}): RawEvent => ({
  id,
  firstWord,
  lastWord,
  job: "a job",
  knows: "",
  waiting: "",
  look: `look ${id}`,
  feel: "curious",
  rhythm: "short",
  reveal: { word: -1, what: "" },
  withhold: { what: "", until: "" },
  holds: [],
  demo: { what: "", truth: { kind: "", data: "" }, phases: [] },
  sound: "",
  camera: "",
  ...more,
});
const plan = (events: RawEvent[], cues: RawPlan["cues"] = []): RawPlan => ({ goal: "g", promise: "p", arc: "a", events, cues });

test("coverage finds gaps, overlaps and a wrong end", () => {
  assert.deepEqual(coverage([{ id: "e1", firstWord: 0, lastWord: 5 }, { id: "e2", firstWord: 6, lastWord: 13 }], 14), []);
  assert.match(coverage([{ id: "e1", firstWord: 0, lastWord: 4 }, { id: "e2", firstWord: 6, lastWord: 13 }], 14)[0]!, /words 5 to 5 belong to no event/);
  assert.match(coverage([{ id: "e1", firstWord: 0, lastWord: 6 }, { id: "e2", firstWord: 6, lastWord: 13 }], 14)[0]!, /inside the event before it/);
  assert.match(coverage([{ id: "e1", firstWord: 0, lastWord: 10 }], 14)[0]!, /words 11 to 13 belong to no event/);
  assert.match(coverage([{ id: "e1", firstWord: 0, lastWord: 14 }], 14)[0]!, /last word is 13/);
  assert.match(coverage([], 14)[0]!, /no events/);
});

test("cues become beats and every word number moves to the final script", () => {
  const raw = plan(
    [
      event("e1", 0, 5, { holds: [{ id: "h1", afterWord: 3, afterCue: "", seconds: 1.5, purpose: "look", does: "the puzzle turns", shows: "" }] }),
      event("e2", 6, 13, {
        reveal: { word: 12, what: "the right side" },
        holds: [
          { id: "h2", afterWord: -1, afterCue: "c3", seconds: 3, purpose: "predict", does: "both sides pulse", shows: "Which moves?" },
          { id: "h3", afterWord: 13, afterCue: "", seconds: 2, purpose: "recap", does: "everything at once", shows: "" },
        ],
        demo: { what: "two sides moving", truth: { kind: "", data: "" }, phases: [
          { from: 0, to: 0, pace: "slow", at: { word: 6, hold: "", cue: "" }, until: { word: -1, hold: "", cue: "c3" }, replay: false, why: "first" },
          { from: 0, to: 0, pace: "fast", at: { word: -1, hold: "h2", cue: "" }, until: none, replay: false, why: "rest" },
        ] },
      }),
    ],
    [
      { id: "c1", beforeWord: 0, text: "Ready" }, // opens the video
      { id: "c2", beforeWord: 6, text: "Watch this." }, // at the start of b2 and of e2
      { id: "c3", beforeWord: 10, text: "Now guess." }, // inside b2, at a sentence start
      { id: "c4", beforeWord: 14, text: "That is all." }, // after the last word
    ],
  );
  assert.deepEqual(problems(raw, scriptWords(script)), []);
  const { script: out, plan: d } = applyCues(script, raw);
  const words = scriptWords(out);
  assert.equal(words.join(" "), "Ready. Here is a puzzle. Look closely. Watch this. First the left moves. Now guess. Then the right follows. That is all.");
  assert.deepEqual(out.beats.map((b) => [b.id, b.cue ?? false, b.of ?? ""]), [
    ["cue1", true, ""],
    ["b1", false, ""],
    ["cue2", true, ""],
    ["b2", false, ""],
    ["cue3", true, ""],
    ["b2.2", false, "b2"],
    ["cue4", true, ""],
  ]);
  // Cue beats take the role of the beat they precede, add no claims, and show their event's look.
  assert.deepEqual(out.beats[2], { id: "cue2", role: "example", text: "Watch this.", claimIds: [], visual: "look e2", emphasis: [], cue: true });
  assert.deepEqual(out.beats[3]!.emphasis, ["right"]); // the first part keeps the beat's list, so stripping restores it
  assert.deepEqual(out.beats[5]!.emphasis, ["right"]);
  // Events: the cue before e2's first word opens e2; the cue after the last word closes the last event.
  assert.deepEqual(d.events.map((e) => [e.firstWord, e.lastWord]), [[0, 6], [7, 21]]);
  assert.deepEqual(coverage(d.events, words.length), []);
  const at = (i: number) => words[i];
  // h1 after "puzzle." (old 3, new 4); h2 after the cue "Now guess." ; h3 after the last script word, before c4.
  const [h1] = d.events[0]!.holds!;
  const [h2, h3] = d.events[1]!.holds!;
  assert.equal(at(h1!.afterWord), "puzzle.");
  assert.equal(at(h2!.afterWord), "guess.");
  assert.equal(at(h3!.afterWord), "follows.");
  assert.equal(h2!.shows, "Which moves?");
  assert.equal(at(d.events[1]!.reveal!.word), "right");
  assert.equal(d.events[1]!.reveal!.word, 17);
  const [p1, p2] = d.events[1]!.demo!.phases;
  assert.deepEqual(p1!.at, { word: 9 });
  assert.equal(at(9), "First");
  assert.deepEqual(p1!.until, { word: 13 });
  assert.equal(at(13), "Now");
  assert.deepEqual(p2!.at, { hold: "h2" });
  assert.equal(p2!.until, undefined);
  assert.equal(p1!.steps, undefined);
  // The cues keep the writer's numbering, as the plan type says.
  assert.deepEqual(d.cues.map((c) => c.beforeWord), [0, 6, 10, 14]);
});

test("stripping the cues gives back the writer's script, so a rerun plans from the same words", () => {
  const raw = plan([event("e1", 0, 13)], [{ id: "c1", beforeWord: 2, text: "Wait." }, { id: "c2", beforeWord: 10, text: "Now." }]);
  // "Wait." before word 2 sits mid-sentence: allowed by applyCues, but the checks refuse it.
  assert.ok(problems(raw, scriptWords(script)).some((x) => /middle of a sentence/.test(x)));
  const { script: out } = applyCues(script, raw);
  assert.deepEqual(stripCues(out), script);
  assert.deepEqual(stripCues(script), script);
});

test("two cues before the same word keep their order", () => {
  const raw = plan([event("e1", 0, 5), event("e2", 6, 13, { holds: [{ id: "h1", afterWord: -1, afterCue: "c1", seconds: 1, purpose: "look", does: "x", shows: "" }] })], [
    { id: "c1", beforeWord: 6, text: "One." },
    { id: "c2", beforeWord: 6, text: "Two more." },
  ]);
  const { script: out, plan: d } = applyCues(script, raw);
  const words = scriptWords(out);
  assert.equal(words.slice(6, 10).join(" "), "One. Two more. First");
  assert.equal(d.events[1]!.firstWord, 6);
  assert.equal(words[d.events[1]!.holds![0]!.afterWord], "One.");
});

test("the checks catch broken plans", () => {
  const words = scriptWords(script);
  const has = (raw: RawPlan, re: RegExp) => assert.ok(problems(raw, words).some((x) => re.test(x)), `expected ${re} in ${JSON.stringify(problems(raw, words))}`);
  has(plan([event("e1", 0, 13)], [{ id: "c1", beforeWord: 6, text: "Watch this one now and then that one too." }]), /at most 8/);
  has(plan([event("e1", 0, 13)], [{ id: "c1", beforeWord: 6, text: "Watch all 12." }]), /never adds a fact/);
  has(plan([event("e1", 0, 13)], [{ id: "c1", beforeWord: 15, text: "Done." }]), /does not exist/);
  has(plan([event("e1", 0, 13)], [{ id: "c1", beforeWord: 6, text: "Which side first?" }]), /asks the viewer a question but no hold follows it/);
  has(plan([event("e1", 0, 5, { holds: [{ id: "h1", afterWord: 9, afterCue: "", seconds: 1, purpose: "look", does: "x", shows: "" }] }), event("e2", 6, 13)]), /outside its event/);
  has(plan([event("e1", 0, 5, { holds: [{ id: "h1", afterWord: 2, afterCue: "", seconds: 30, purpose: "look", does: "x", shows: "" }] }), event("e2", 6, 13)]), /lasts 30 s/);
  has(plan([event("e1", 0, 5, { holds: [{ id: "h1", afterWord: 2, afterCue: "", seconds: 1, purpose: "look", does: "", shows: "" }] }), event("e2", 6, 13)]), /empty pause/);
  has(plan([event("e1", 0, 5, { holds: [{ id: "h1", afterWord: -1, afterCue: "c1", seconds: 1, purpose: "look", does: "x", shows: "" }] }), event("e2", 6, 13)], [{ id: "c1", beforeWord: 6, text: "Now." }]), /belongs to another event/);
  has(plan([event("e1", 0, 5), event("e2", 6, 13, { withhold: { what: "the answer", until: "e1" } })]), /an earlier event/);
  has(plan([event("e1", 0, 5), event("e2", 6, 13, { reveal: { word: 3, what: "it" } })]), /outside the event/);
  has(plan([event("e1", 0, 5), event("e1", 6, 13)]), /share the id "e1"/);
  has(plan([event("e1", 0, 13, { demo: { what: "x", truth: { kind: "", data: "" }, phases: [{ from: 1, to: 2, pace: "slow", at: { word: 1, hold: "", cue: "" }, until: none, replay: false, why: "" }] } })]), /no truth thing/);
  has(plan([event("e1", 0, 13, { demo: { what: "x", truth: { kind: "", data: "" }, phases: [{ from: 0, to: 0, pace: "slow", at: { word: 1, hold: "h9", cue: "" }, until: none, replay: false, why: "" }] } })]), /exactly one of word, hold or cue/);
});

test("demonstrations are checked against the steps the kit really computes", () => {
  const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames: 1, theme: themeFrom("neon"), kits: SCENE_KITS };
  const kinds = truthKindNames();
  const words = scriptWords(script);
  const data = JSON.stringify({ data: [3, 1, 2], algo: "insertion" });
  const demo = (from: number, to: number, replay = false) => ({ from, to, pace: "slow" as const, at: { word: 7, hold: "", cue: "" }, until: none, replay, why: "" });
  const raw = (phases: ReturnType<typeof demo>[], later: ReturnType<typeof demo>[] = []) =>
    plan([
      event("e1", 0, 5),
      event("e2", 6, 9, { demo: { what: "sorting three", truth: { kind: "sort", data }, phases } }),
      event("e3", 10, 13, { demo: { what: "sorting three, on", truth: { kind: "sort", data }, phases: later.map((p) => ({ ...p, at: { word: 11, hold: "", cue: "" } })) } }),
    ]);
  const first = demoSteps(raw([demo(1, 1)]), ctx, kinds);
  assert.deepEqual(first.problems, []);
  const n = [...first.steps.values()][0]!.length;
  assert.ok(n >= 2, `insertion sort of three values has steps: ${n}`);
  assert.deepEqual(problems(raw([demo(1, 1)], [demo(2, n)]), words, first.steps), []);
  assert.ok(problems(raw([demo(1, n + 1)]), words, first.steps).some((x) => new RegExp(`computes steps 1 to ${n}`).test(x)));
  assert.ok(problems(raw([demo(1, 2)], [demo(2, n)]), words, first.steps).some((x) => /already played/.test(x)));
  assert.deepEqual(problems(raw([demo(1, n)], [demo(1, n, true)]), words, first.steps), []);
  // Applied, the demo carries its kind, data and real steps.
  const { plan: d } = applyCues(script, raw([demo(1, 1)], [demo(2, n)]), first.steps);
  assert.equal(d.events[1]!.demo!.truth!.kind, "sort");
  assert.deepEqual(d.events[1]!.demo!.truth!.data, { data: [3, 1, 2], algo: "insertion" });
  assert.equal(d.events[1]!.demo!.truth!.steps.length, n);
  assert.deepEqual(d.events[2]!.demo!.phases[0]!.steps, [2, n]);
  // Data the kit refuses, and a kind the engine does not have, come back as problems for the model.
  const bad = plan([event("e1", 0, 13, { demo: { what: "x", truth: { kind: "sort", data: '{"data":[1]}' }, phases: [] } })]);
  assert.match(demoSteps(bad, ctx, kinds).problems[0]!, /refuses/);
  const extra = plan([event("e1", 0, 13, { demo: { what: "x", truth: { kind: "sort", data: '{"data":[3,1,2],"id":"s"}' }, phases: [] } })]);
  assert.match(demoSteps(extra, ctx, kinds).problems[0]!, /no setting "id"/);
  const unknown = plan([event("e1", 0, 13, { demo: { what: "x", truth: { kind: "teleport", data: "{}" }, phases: [] } })]);
  assert.match(demoSteps(unknown, ctx, kinds).problems[0]!, /does not have/);
});
