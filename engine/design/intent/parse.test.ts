import assert from "node:assert/strict";
import { test } from "node:test";
import type { PartCard } from "../types.ts";
import { checkIntent, parseIntent } from "./parse.ts";

const SRC = `feel calm
for new

thing price "$100"
many seeds 12 "seed"
object jar "a glass jar of water"

@1
  show price
  keep seeds
  pace slow
@4
  ask "How many?"
  show jar
@6
  reveal price
  price becomes "$120"
  jar turns "faint blue"
  jar wobbles slowly
  stress
`;

test("parses things, moments, relations and verbs", () => {
  const p = parseIntent(SRC);
  assert.equal(p.feel, "calm");
  assert.equal(p.audience, "new");
  assert.deepEqual(p.things.map((t) => [t.id, t.kind]), [["price", "thing"], ["seeds", "many"], ["jar", "object"]]);
  assert.equal(p.things[1]!.many!.n, 12);
  assert.equal(p.moments.length, 3);
  assert.equal(p.moments[0]!.pace, "slow");
  assert.equal(p.moments[1]!.ask, "How many?");
  const m = p.moments[2]!;
  assert.equal(m.reveal, "price");
  assert.equal(m.stress, true);
  assert.deepEqual(m.becomes, [{ id: "price", text: "$120" }]);
  assert.deepEqual(m.acts.map((a) => [a.verb, a.ids, a.arg, a.speed]), [["turns", ["jar"], "faint blue", undefined], ["wobbles", ["jar"], undefined, "slow"]]);
  assert.deepEqual(p.notes, []);
});

test("verbs are the author's own words, with their particles, other things, arguments and speed words", () => {
  const p = parseIntent(`object a "a jug"\nobject b "a bowl"\nobject c "a ball"\nobject d "a ball"\n@0\n  show b\n  a pours into b\n  c d fall together\n  c moves to b fast\n  a lights up`);
  const acts = p.moments[0]!.acts;
  assert.deepEqual(acts[0], { verb: "pours into", ids: ["a"], to: "b", line: 7 });
  assert.deepEqual(acts[1], { verb: "fall", ids: ["c", "d"], line: 8 });
  assert.deepEqual([acts[2]!.verb, acts[2]!.to, acts[2]!.speed], ["moves to", "b", "fast"]);
  assert.equal(acts[3]!.verb, "lights up");
});

test("lines of today's scene language inside a moment are pinned, with what is indented under them", () => {
  const p = parseIntent(`thing x "x"\n@0\n  show x\n  camera zoom=1.4 at=x\n  row r1\n    text a "A" size=big\n  set t.x opacity=0.5\n@3 keep\n  show x`);
  assert.deepEqual(p.moments[0]!.pinned.map((l) => l.text), ["camera zoom=1.4 at=x", "row r1", 'text a "A" size=big', "set t.x opacity=0.5"]);
  assert.deepEqual(p.moments[1]!.pinned.map((l) => l.text), ["@3 keep"]);
  assert.equal(p.moments[0]!.show, "x");
});

test("any verb is kept as an act for the depicter to map; a line about no thing is reported", () => {
  const p = parseIntent(`object kite "a paper kite"\n@0\n  show kite\n  kite flutters "in the wind"\n  wind blows`);
  assert.deepEqual(p.moments[0]!.acts.map((a) => [a.verb, a.ids, a.arg]), [["flutters", ["kite"], "in the wind"]]);
  assert.match(p.notes.join("\n"), /wind blows/);
  const problems = checkIntent(p, Array.from({ length: 4 }, (_, i) => ({ text: "w", start: i })));
  assert.doesNotMatch(problems.map((x) => x.message).join("\n"), /flutters/);
});

test("checkIntent reports what an author can repair", () => {
  const card: PartCard = { name: "pic", file: "pic.png", kind: "photo", about: "", parts: { left: { box: [0, 0, 0.5, 1], about: "left" } }, requirements: [], checked: { ok: true, notes: [] } };
  const p = parseIntent(`thing a "a"\n@5\n  show a\n@2\n  keep a\n@40\n  show ghost\n  keep pic.right pic.left\n  pic becomes "x"`);
  const msgs = checkIntent(p, Array.from({ length: 10 }, (_, i) => ({ text: "w", start: i })), [card]).map((x) => `${x.line}: ${x.message}`).join("\n");
  assert.match(msgs, /@2 comes after @5/);
  assert.match(msgs, /@2 has no show/);
  assert.match(msgs, /@40 is not a word/);
  assert.match(msgs, /"ghost" was never declared/);
  assert.match(msgs, /pic has no part "right"/);
  assert.doesNotMatch(msgs, /part "left"/);
  assert.match(msgs, /cannot become something else/);
});

test("lenient: a second show becomes support, unknown lines before moments are noted", () => {
  const p = parseIntent(`withhold a until=@3\nthing a "a"\nthing b "b"\n@0\n  show a\n  show b`);
  assert.equal(p.moments[0]!.show, "a");
  assert.deepEqual(p.moments[0]!.keep, ["b"]);
  assert.equal(p.notes.length, 2);
});

test("names may carry inner hyphens and any script's letters, as a reader agent names material parts", () => {
  const plan = parseIntent(`object cross-section "a cut through a pipe"
thing año "the year's total"
many day-trips 3 "trip"
@0
  show slide14.bar-asphalt
  keep cross-section año
  cross-section fills into slide14.bar-asphalt
@4
  slide14.bar-asphalt -> año "highest"
  day-trips becomes 5
  año from slide14.bar-asphalt
@6
  show a->b
`);
  assert.deepEqual(plan.things.map((t) => t.id), ["cross-section", "año", "day-trips"]);
  const [m0, m1, m2] = plan.moments;
  assert.equal(m0!.show, "slide14.bar-asphalt");
  assert.deepEqual(m0!.keep, ["cross-section", "año"]);
  assert.deepEqual(m0!.acts.map((a) => [a.ids, a.verb, a.to]), [[["cross-section"], "fills into", "slide14.bar-asphalt"]]);
  assert.deepEqual(m1!.arrows, [{ a: "slide14.bar-asphalt", b: "año", label: "highest" }]);
  assert.deepEqual(m1!.becomes, [{ id: "day-trips", n: 5 }]);
  assert.deepEqual(m1!.from, [{ a: "año", b: "slide14.bar-asphalt" }]);
  assert.equal(m2!.show, undefined, "a->b is not one name: a hyphen never starts or ends a name");
  assert.deepEqual(checkIntent(parseIntent(`thing x-y "z"\n@0\n  show x-y\n`), [{ text: "a", start: 0 }]), []);
});
