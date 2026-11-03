// The deterministic parts of the scene step: splitting the narration, slicing a draft, joining sections, and the checks
// that keep word numbers global. No model calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "../../engine/language/build.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import type { DirectionEvent, Project } from "../../schemas/project.ts";
import { cleanCast, contract, demoFit, directed, directionText, joinSections, joinWithSpans, needs, truthPlan, overPictures, pieces, severeOf, sliceSource, splitSections, visibleAt } from "./scene.ts";

// Invented narration: beats of given lengths, sentences of about eight words.
function narration(beats: number[]) {
  const words: { text: string; start: number; beatId: string }[] = [];
  beats.forEach((n, b) => {
    for (let i = 0; i < n; i++) words.push({ text: `w${words.length}${i % 8 === 7 || i === n - 1 ? "." : ""}`, start: words.length * 0.4, beatId: `b${b + 1}` });
  });
  return words;
}

test("sections cover every word once, in order, and never cut a short beat", () => {
  const words = narration([30, 58, 15, 20, 49, 39, 22, 14, 30]);
  const s = splitSections(words);
  assert.equal(s[0]!.firstWord, 0);
  assert.equal(s.at(-1)!.lastWord, words.length - 1);
  for (let i = 1; i < s.length; i++) assert.equal(s[i]!.firstWord, s[i - 1]!.lastWord + 1);
  for (const r of s) {
    const len = r.lastWord - r.firstWord + 1;
    assert.ok(len <= 85, `${r.id} has ${len} words`);
    assert.ok(len >= 20 || s.length === 1, `${r.id} has only ${len} words`);
    // A boundary falls between beats unless a beat is longer than a section can be.
    if (r.firstWord > 0) assert.notEqual(words[r.firstWord]!.beatId, words[r.firstWord - 1]!.beatId);
  }
  assert.deepEqual(s.map((r) => r.id), s.map((_, i) => `s${i + 1}`));
});

test("a beat longer than a section splits at a sentence end", () => {
  const words = narration([200]);
  const s = splitSections(words);
  assert.ok(s.length >= 3);
  for (const r of s.slice(0, -1)) assert.match(words[r.lastWord]!.text, /\.$/);
  for (const r of s) assert.ok(r.lastWord - r.firstWord + 1 <= 85);
});

test("a short last beat joins the section before it", () => {
  const s = splitSections(narration([50, 50, 6]));
  assert.equal(s.length, 2);
  assert.equal(s[1]!.lastWord, 105);
});

const A = `bg paper
program dots n=3 doc="Some dots."
  for (let i = 0; i < args.n; i++) path("d" + i, { x: 10 * i, y: 10, points: circle(0, 0, 5), fill: "ink" });
end
@0
text s1_t "First part" size=big
run dots s1_d w=400 h=400
@3 keep
tag s1_t "note"
`;
const B = `program dots n=5 doc="Other dots."
  for (let i = 0; i < args.n; i++) path("e" + i, { x: 20 * i, y: 10, points: circle(0, 0, 8), fill: "accent" });
end
@6
text s1_t "First part" size=big
run dots s2_d w=400 h=400
@8 keep
  drop s2_d
`;

test("pieces finds the background, programs and states with their words", () => {
  const p = pieces(A);
  assert.equal(p.bg, "paper");
  assert.deepEqual(p.programs.map((x) => x.name), ["dots"]);
  assert.deepEqual(p.states.map((x) => x.word), [0, 3]);
  assert.match(p.states[1]!.text, /tag s1_t/);
});

test("joining keeps global word numbers in order and renames a clashing program", () => {
  const joined = joinSections([{ id: "s2", firstWord: 6, source: B }, { id: "s1", firstWord: 0, source: A }]);
  const p = pieces(joined);
  assert.equal(p.bg, "paper");
  assert.deepEqual(p.states.map((x) => x.word), [0, 3, 6, 8]);
  assert.deepEqual(p.programs.map((x) => x.name), ["dots", "dots-s2"]);
  assert.match(joined, /run dots s1_d/);
  assert.match(joined, /run dots-s2 s2_d/);
  // Programs come before the first state, as the language requires.
  assert.ok(joined.indexOf("program dots-s2") < joined.indexOf("@0"));
});

test("an identical program is kept once", () => {
  const joined = joinSections([{ id: "s1", firstWord: 0, source: A }, { id: "s2", firstWord: 6, source: A.replace("@0", "@6").replace("@3", "@8") }]);
  assert.equal(pieces(joined).programs.length, 1);
});

test("a whole-video draft is sliced by the word each state starts on", () => {
  const draft = `${A}@6\ntext x "later"\n@9 keep\ntag x "more"\n`;
  const parts = sliceSource(draft, [{ id: "s1", firstWord: 0, lastWord: 5 }, { id: "s2", firstWord: 6, lastWord: 12 }, { id: "s3", firstWord: 13, lastWord: 20 }]);
  assert.deepEqual(pieces(parts[0]!).states.map((s) => s.word), [0, 3]);
  assert.deepEqual(pieces(parts[0]!).programs.map((s) => s.name), ["dots"]);
  assert.deepEqual(pieces(parts[1]!).states.map((s) => s.word), [6, 9]);
  assert.equal(pieces(parts[1]!).programs.length, 0);
  assert.equal(parts[2], "");
});

test("a section that begins inside a shot opens with that shot's cut", () => {
  const draft = `@0 cut\nimage s1 asset=p frame=fill\ncamera s1 zoom=1.2\n@4 keep\nmark ring s1 at=0.5,0.5\n@7 keep\ntag s1 "x" at=0.2,0.2\n@9 cut\nimage s2 asset=q frame=fill\n`;
  const parts = sliceSource(draft, [{ id: "s1", firstWord: 0, lastWord: 5 }, { id: "s2", firstWord: 6, lastWord: 12 }]);
  const second = pieces(parts[1]!).states;
  assert.deepEqual(second.map((s) => s.word), [6, 7, 9]);
  assert.match(second[0]!.text, /^@6 cut\nimage s1 asset=p frame=fill\ncamera s1 zoom=1.2/);
});

test("the contract catches states outside the range, a keep first state and a missing carried thing", () => {
  const range = { id: "s2", firstWord: 6, lastWord: 12 };
  assert.deepEqual(contract(`@6\ntext moon "Moon"\nnormal: a=1 b=2\n@9 keep\ntag moon "x"\n`, range, [{ id: "moon", what: "a disc" }, { id: "b", what: "an atom" }]), []);
  const bad = contract(`@7 keep\ntag moon "x"\n@20 keep\n`, range, [{ id: "moon", what: "a disc" }]);
  assert.ok(bad.some((x) => x.includes("must be @6")));
  assert.ok(bad.some((x) => x.includes("not keep")));
  assert.ok(bad.some((x) => x.includes("@20 is outside")));
  assert.ok(bad.some((x) => x.includes("leaves moon")));
});

test("visibleAt sees what is on screen at a frame, so hand-offs can be checked", async () => {
  const words = Array.from({ length: 12 }, (_, i) => ({ text: `w${i}`, start: i * 0.5 }));
  const ctx = { fps: 30, width: 1080, height: 1920, frames: 200, theme: themeFrom("whiteboard"), words };
  const r = await build(`@0\ntext a "Alpha" size=big\nnormal: k=1 m=2\n@6\ntext b "Beta"\n`, { ctx, words: words.map((w) => w.text) });
  assert.deepEqual(r.problems, []);
  const early = visibleAt(r.scene!, 60);
  assert.ok(early.has("a") && early.has("k"));
  const late = visibleAt(r.scene!, 190);
  assert.ok(late.has("b") && !late.has("a"));
});

test("cleanCast makes ids valid, keeps one per part, and empties the last hand-off", () => {
  const c = cleanCast([{ shows: "x", handoff: [{ id: "1st thing!", what: "a" }, { id: "thing", what: "b" }, { id: "thing", what: "b" }] }, { shows: "y", handoff: [{ id: "z", what: "c" }] }], 3);
  assert.equal(c.length, 3);
  assert.deepEqual(c[0]!.handoff.map((x) => x.id), ["st_thing_", "thing"]);
  assert.deepEqual(c[2]!.handoff, []);
});

test("cleanCast keeps a carried thing's pieces and what the next part does with it", () => {
  const c = cleanCast([{ shows: "x", handoff: [{ id: "bins", what: "three bins", parts: ["bin-1", "2bad", "bins", "bin-1"], use: " fills them " }] }, { shows: "y", handoff: [] }], 2);
  assert.deepEqual(c[0]!.handoff, [{ id: "bins", what: "three bins", parts: ["bin-1", "bad"], use: "fills them" }]);
});

test("a carried thing kept without its pieces is caught, and leaving it out is the writer's call", () => {
  const range = { id: "s2", firstWord: 6, lastWord: 12 };
  const carry = [{ id: "bins", what: "three bins", parts: ["b1", "b2"] }];
  assert.deepEqual(contract(`@6\nrow bins\n  box b1 "a"\n  box b2 "b"\n`, range, carry), []);
  const renamed = contract(`@6\nrow bins\n  box x1 "a"\n  box b2 "b"\n`, range, carry);
  assert.equal(renamed.length, 1);
  assert.match(renamed[0]!, /you keep bins, but not its pieces b1/);
  assert.match(contract(`@6\ntext other "new thread"\n`, range, carry)[0]!, /If your first words build on it.*it leaves as your part begins/);
});

test("a thing left over picture after picture is noted, and one that leaves with its picture is not", async () => {
  const words = Array.from({ length: 40 }, (_, i) => ({ text: `w${i}`, start: i * 0.5 }));
  const ctx = { fps: 30, width: 1080, height: 1920, frames: 700, theme: themeFrom("whiteboard"), words };
  const assets = { a: "/a.png", b: "/b.png", c: "/c.png" };
  const opts = { ctx, words: words.map((w) => w.text), assets };
  const stuck = `@0\nimage p1 asset=a w=1152 h=2048 frame=fill\ntext list "three reasons" role=caption\n@10 keep\ndrop p1\nimage p2 asset=b w=1152 h=2048 frame=fill\n@20 keep\ndrop p2\nimage p3 asset=c w=1152 h=2048 frame=fill\n`;
  const r = await build(stuck, opts);
  assert.deepEqual(r.problems, []);
  const notes = overPictures(stuck, r.scene!, 0, 600);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /^list \(line 3\) stays over the full-frame pictures for \d+ s, across p1, p2, p3/);
  const clean = `@0\nimage p1 asset=a w=1152 h=2048 frame=fill\ntext list "three reasons" role=caption\n@10\nimage p2 asset=b w=1152 h=2048 frame=fill\ntext about "about this one" role=caption\n@20\nimage p3 asset=c w=1152 h=2048 frame=fill\n`;
  const r2 = await build(clean, opts);
  assert.deepEqual(r2.problems, []);
  assert.deepEqual(overPictures(clean, r2.scene!, 0, 600), []);
});

test("a kept version still severely broken is named, measured or seen, so the section is rewritten or reported", () => {
  const measured = [{ frame: 10, words: [], findings: [{ kind: "covered" as const, ids: ["t"], severity: 3 as const, note: "\"sample\" hidden behind something" }] }, { frame: 20, words: [], findings: [{ kind: "empty" as const, ids: [], severity: 2 as const, note: "40% used" }] }];
  const seen = [{ frames: [1], kind: "overlap" as const, what: "a dark bar crosses the formula", want: "nothing covers it", severity: 3 as const }, { frames: [2], kind: "design" as const, what: "a little plain", want: "more color", severity: 2 as const }];
  const severe = severeOf(seen, measured);
  assert.deepEqual(severe.map((x) => x.source).sort(), ["measured", "seen"]);
  assert.ok(severe.every((x) => x.severity === 3));
  assert.deepEqual(severeOf([], [{ frame: 1, words: [], findings: [] }]), []);
});

// A small directed project: 120 words, a hold after word 40, a demonstration in event e2 and a withhold until e3.
function directedProject(): Project {
  const words = narration([60, 60]).map((w, i) => ({ ...w, start: w.start + (i > 40 ? 3 : 0), end: w.start + 0.35 + (i > 40 ? 3 : 0) }));
  const event = (id: string, firstWord: number, lastWord: number, more: Partial<DirectionEvent> = {}): DirectionEvent => ({ id, firstWord, lastWord, job: `job of ${id}`, knows: "", waiting: "", look: `the thing in ${id}`, feel: "curious", rhythm: "long", ...more });
  const events = [
    event("e1", 0, 29, { withhold: { what: "the finished result", until: "e3" } }),
    event("e2", 30, 89, {
      holds: [{ id: "h1", afterWord: 40, seconds: 3, purpose: "predict", does: "the two fronts pulse and nothing else moves", shows: "Which goes first?" }],
      demo: { what: "the process on four values", phases: [{ steps: [1, 2], pace: "slow", at: { word: 30 }, until: { hold: "h1" }, why: "first time" }, { steps: [3, 4], pace: "normal", at: { hold: "h1" }, why: "let them guess" }, { steps: [5, 17], pace: "fast", at: { word: 41 }, until: { word: 80 }, why: "pattern is known" }] },
    }),
    event("e3", 90, 119, { reveal: { word: 95, what: "the finished result" } }),
  ];
  return { id: "t", createdAt: "", input: { prompt: "", style: "whiteboard", persona: "", mode: "explain", seconds: 0 }, stages: {}, costs: [], direction: { goal: "understand it", promise: "", arc: "", events, cues: [] }, narration: { audio: "", voiceId: "", model: "", seconds: 52, words, holds: [{ id: "h1", afterWord: 40, start: words[40]!.end, seconds: 3 }] } };
}

test("with a direction, sections end on event boundaries and a demonstration stays whole", () => {
  const p = directedProject();
  const s = splitSections(p.narration!.words, undefined, p.direction!.events);
  const bounds = new Set(p.direction!.events.map((e) => e.firstWord));
  for (const r of s) assert.ok(bounds.has(r.firstWord), `${r.id} starts on an event`);
  assert.ok(s.some((r) => r.firstWord <= 30 && r.lastWord >= 89), "the 60 word demonstration is one section");
});

test("the direction reaches the author as events, holds with frames, phases and withholds", () => {
  const p = directedProject();
  const text = directionText(p, { id: "s2", firstWord: 30, lastWord: 89 });
  assert.match(text, /Event e2, words 30 to 89: job of e2/);
  assert.match(text, /Hold h1, predict: 3\.0 s \(90 frames\) of silence after word 40 .*@h1 to @h1\.end.*On screen: "Which goes first\?"/);
  assert.match(text, /1\. steps 1 to 2, slow, from @30 until @h1, about/);
  assert.match(text, /2\. steps 3 to 4, normal, from @h1 until @h1\.end/);
  assert.match(text, /withhold IDS until=@90/);
  assert.equal(directionText(p, { id: "s3", firstWord: 90, lastWord: 119 }).includes("Withheld"), false);
  assert.equal(directionText({ ...p, direction: undefined }, { id: "s1", firstWord: 0, lastWord: 29 }), "");
});

test("a part must declare what it withholds and play a demonstration with the kit", () => {
  const p = directedProject();
  const range = { id: "s2", firstWord: 30, lastWord: 89 };
  const hand = directed(`@30\nrow r\n  box a "3"\n  box b "1"\n`, p, range);
  assert.equal(hand.withholds.length, 1);
  assert.match(hand.withholds[0]!, /withhold IDS until=@90|until=@90/);
  assert.equal(hand.demos.length, 1);
  assert.match(hand.demos[0]!, /`sort`/);
  const kit = directed(`withhold none until=@90\n@30\nsort s data=[3,1,4,2] algo=merge\ndo steps s from=1 to=2 pace=slow until=@h1\n`, p, range);
  assert.deepEqual(kit, { withholds: [], demos: [], truth: [] });
});

test("hold moments split into states, and a hold too short is noted for the direction", () => {
  const p = pieces(`@30\ntext a "x"\n@h1 keep\ntext b "y"\n@h1.end keep\ndrop b\n`);
  assert.deepEqual(p.states.map((x) => x.word), [30, 30, 30]);
  assert.deepEqual(needs(`@0\n# needs h1 6s: four slow steps\ntext a "x"\n`), ["hold h1 too short: needs 6 s, four slow steps"]);
});

// The same project with its demonstration computed, played across three parts.
function computedProject(): Project {
  const p = directedProject();
  const steps = Array.from({ length: 17 }, (_, i) => `step ${i + 1} on 3 and 1`);
  const truth = { kind: "sort", data: { data: [3, 1, 4, 2], algo: "merge", show: "boxes" }, steps };
  const events = p.direction!.events.map((e) => (e.id === "e2" ? { ...e, lastWord: 59, demo: { ...e.demo!, truth, phases: [{ steps: [1, 4] as [number, number], pace: "slow" as const, at: { word: 30 }, why: "first" }] } } : e));
  events.splice(2, 0, { ...events[1]!, id: "e2b", firstWord: 60, lastWord: 89, holds: [], demo: { what: "the rest", truth, phases: [{ steps: [5, 17], pace: "fast", at: { word: 60 }, why: "known" }] } });
  return { ...p, direction: { ...p.direction!, events } };
}

test("each part is told the steps it plays and where the demonstration stands as it begins", () => {
  const p = computedProject();
  const first = truthPlan(p, { id: "s2", firstWord: 30, lastWord: 59 })[0]!;
  assert.equal(first.line, "sort demo1 data=[3,1,4,2] algo=merge show=boxes");
  assert.deepEqual([first.done, first.plays.map((x) => [x.from, x.to])], [0, [[1, 4]]]);
  const second = truthPlan(p, { id: "s3", firstWord: 60, lastWord: 89 })[0]!;
  assert.deepEqual([second.done, second.plays.map((x) => [x.from, x.to])], [4, [[5, 17]]]);
  assert.match(directionText(p, { id: "s3", firstWord: 60, lastWord: 89 }), /`sort demo1 data=\[3,1,4,2\] algo=merge show=boxes done=4`.*plays exactly steps 5 to 17/s);
});

test("a part that plays another part's steps, starts in the wrong state or changes the thing is sent back", () => {
  const p = computedProject();
  const range = { id: "s3", firstWord: 60, lastWord: 89 };
  const good = directed(`withhold none until=@90\n@60\nsort demo1 data=[3,1,4,2] algo=merge show=boxes done=4\ndo steps demo1 from=5 to=17 pace=fast until=@89\n`, p, range);
  assert.deepEqual(good.truth, []);
  const twice = directed(`withhold none until=@90\n@60\nsort demo1 data=[3,1,4,2] algo=merge show=boxes\ndo steps demo1 from=3 to=17 until=@89\n`, p, range).truth.join("\n");
  assert.match(twice, /stands after step 4.*done=4/);
  assert.match(twice, /plays 3, 4, which another part plays/);
  const other = directed(`withhold none until=@90\n@60\nsort demo1 data=[3,1,4,2] algo=merge order=levels show=boxes done=4\ndo steps demo1 from=5 to=17 until=@89\n`, p, range).truth.join("\n");
  assert.match(other, /must be the very thing the other parts show/);
});

test("joined lines map back to the part that wrote them", () => {
  const { text, spans } = joinWithSpans([{ id: "s1", firstWord: 0, source: A }, { id: "s2", firstWord: 6, source: B }]);
  const lines = text.split("\n");
  const s2 = spans.find((x) => x.id === "s2")!;
  assert.equal(lines[s2.from - 1], "@6");
  assert.match(lines[s2.to - 1]!, /drop s2_d/);
  assert.equal(lines[spans[0]!.from - 1], "@0");
});

test("a phase whose words name values its steps never show does not fit", () => {
  const p = computedProject();
  const words = p.narration!.words.map((w, i) => (i >= 60 && i < 64 ? { ...w, text: ["4", "and", "2,", "merge."][i - 60]! } : w));
  const steps = Array.from({ length: 17 }, (_, i) => (i < 4 ? "split 3 1 4 2" : "merge 3 with 1"));
  const q: Project = { ...p, narration: { ...p.narration!, words }, direction: { ...p.direction!, events: p.direction!.events.map((e) => (e.demo?.truth ? { ...e, demo: { ...e.demo, truth: { ...e.demo.truth, steps } } } : e)) } };
  const found = demoFit(q);
  assert.equal(found.length, 1);
  assert.match(found[0]!, /event e2b, phase 1: its words \(60 to 89\) name 4, 2/);
});
