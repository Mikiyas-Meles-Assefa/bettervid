// The writer's guide and the feedback a built scene gets: roles taught only once the language takes them, and craft
// notes that point at computed truth and real math where a scene types them by hand.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLES } from "../core/types.ts";
import { KITS } from "../kits/index.ts";
import { themeFrom } from "../render/theme.ts";
import { craftNotes, languagePrompt, reviewText, roleDocs, rolesSupported, truthKinds, typedResults, withLooks } from "./author.ts";
import { build } from "./build.ts";

const words = Array.from({ length: 40 }, (_, i) => ({ text: `w${i}`, start: i * 0.4 }));
const ctx = { fps: 30, width: 1080, height: 1920, frames: 600, theme: themeFrom("whiteboard"), words, kits: KITS };

test("looks blocks keep the one the engine supports", () => {
  const t = "a [[roles]]R {{x}}[[/roles]][[looks]]L[[/looks]] b\nbox q{{as key|fill=accent}}\ntext t{{as title|}}\n";
  assert.equal(withLooks(t, true), "a R {{x}} b\nbox q role=key\ntext t role=title\n");
  assert.equal(withLooks(t, false), "a L b\nbox q fill=accent\ntext t\n");
});

test("every role is named in the guide with what it is for, once the language takes roles", () => {
  const docs = roleDocs();
  assert.deepEqual(docs.map((r) => r.name), [...ROLES]);
  assert.ok(docs.every((r) => r.doc.length > 5), "each role has its meaning from the contract");
  const guide = languagePrompt({ ctx });
  assert.doesNotMatch(guide, /\[\[\/?(roles|looks)\]\]|\{\{\w|\{\{as /);
  if (rolesSupported()) for (const r of ROLES) assert.ok(guide.includes(`\`${r}\``), r);
  else assert.doesNotMatch(guide, /role=/, "no role= taught before the language accepts it");
});

test("the guide names the kits that compute their steps", () => {
  assert.deepEqual(truthKinds(KITS).sort(), ["cramer", "det", "dijkstra", "matrix", "matvec", "sort", "trace"]);
  assert.ok(languagePrompt({ ctx }).includes("(`matrix`, `det`"));
});

test("a formula typed as characters gets a note when math is there, and none when it is not", () => {
  const src = `@0\ntext f "a² + b² = c²" size=big\ntext plain "three apples" size=big\n@5 keep\ntag f "c = √(a² + b²)"\n`;
  const notes = craftNotes(src, { math: true });
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /line 2: "a² \+ b² = c²"/);
  assert.match(notes[0]!, /math id latex/);
  assert.doesNotMatch(notes[0]!, /three apples/);
  assert.deepEqual(craftNotes(src, { math: false }), []);
});

test("values put in a new order by hand get a note naming the kits that compute, unless a kit is used", () => {
  const src = `@0\nrow r\n  box a "7"\n  box b "3"\n  box c "9"\n@5\nrow r2\n  box b "3"\n  box a "7"\n  box c "9"\n`;
  const notes = craftNotes(src, { truthKinds: ["sort", "trace"] });
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /7, 3, 9.*3, 7, 9/);
  assert.match(notes[0]!, /`sort`, `trace`/);
  assert.deepEqual(craftNotes(`@0\nbig: a=7 b=3 c=9\n@5\nbig: a=7 b=3 c=9\n`, { truthKinds: ["sort"] }), [], "the same order is not a reorder");
  assert.equal(craftNotes(`@0\nbig: a=7 b=3 c=9\n@5 keep\nrow out\n  box x "3"\n  box y "7"\n`, { truthKinds: ["sort"] }).length, 1, "values written again as new things in a new order");
  assert.deepEqual(craftNotes(`@0\ngrid t cols=2\n  box a "4"\n  box b "1"\n  box c "1"\n  box d "9"\n@5 keep\nrow out\n  box x "1"\n  box y "4"\n`, { truthKinds: ["sort"] }), [], "repeated numbers in a table are not copies");
  assert.deepEqual(craftNotes(`${src}@9\nsort s data=[7,3,9]\n`, { truthKinds: ["sort"], kitKinds: ["sort"] }), [], "a scene that uses a kit already computes");
});

test("typed copies of computed numbers are named in the review, and a clean scene gets no review", async () => {
  const src = `@0\nsort s data=[30,10,20]\n@2 keep\ndo steps s until=@20\n@25 keep\ntext done "10 20 30"\n`;
  const r = await build(src, { ctx });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(typedResults(src, r.truth!, ["sort"]), [`line 6: "10 20 30"`]);
  assert.match(reviewText(src, r, { kitKinds: ["sort"] }), /type numbers that the truth things compute/);
  const plain = `@0\nbox a "hello" w=900 h=1400\n`;
  assert.equal(reviewText(plain, await build(plain, { ctx }), { math: true, truthKinds: ["sort"] }), "");
});

test("steps spread evenly by until= get a note, and steps placed on their words do not", () => {
  const kinds = ["sort"];
  const spread = craftNotes("@0\nsort s data=[3,1,2] algo=bubble\n@2 keep\ndo steps s from=1 to=3 pace=slow until=@30\n", { kitKinds: kinds });
  assert.equal(spread.length, 1);
  assert.match(spread[0]!, /Line 4 plays 3 steps of s spread evenly until @30/);
  assert.match(spread[0]!, /at=@\.\.\., one per step/);
  const placed = craftNotes("@0\nsort s data=[3,1,2] algo=bubble\n@2 keep\ndo steps s from=1 to=3 at=@4,@9,@14\n", { kitKinds: kinds });
  assert.deepEqual(placed, []);
  // Many steps to a moment is a stretch the words sum up, not steps called out one by one.
  const many = craftNotes("@0\nsort s data=[9,8,7,6,5,4,3,2,1] algo=bubble\n@2 keep\ndo steps s from=1 to=30 pace=fast until=@40\n", { kitKinds: kinds });
  assert.deepEqual(many, []);
});
