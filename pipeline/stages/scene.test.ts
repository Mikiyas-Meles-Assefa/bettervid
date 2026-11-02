// The deterministic parts of the scene step: splitting the narration, slicing a draft, joining sections, and the checks
// that keep word numbers global. No model calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "../../engine/language/build.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import { cleanCast, contract, joinSections, pieces, sliceSource, splitSections, visibleAt } from "./scene.ts";

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
