import assert from "node:assert/strict";
import { test } from "node:test";
import type { PartCard } from "../types.ts";
import { checkIntent, computedOf, parseIntent } from "./parse.ts";

// A real plan from the bench (insertion sort, 2026-11-03), with moments that show the computed thing and one of its parts.
const SORT_PLAN = `feel calm
for new

thing sortedpart "sorted part"
thing slide "slides past bigger cards"
thing stop "stops at a smaller card"
thing done "sorted: 1 2 3 4"
thing rule "compared only with sorted cards"

@0
  sort demo1 data=[4,1,3,2] algo=insertion show=boxes
  show sortedpart
  pace slow
@15
  show demo1
  keep slide sortedpart
  do steps demo1 from=1 to=1
  pace slow
  stress
@28
  show demo1.item.2
  keep stop sortedpart
  do steps demo1 from=2 to=3
@40
  show done
  keep sortedpart demo1
  do steps demo1 from=4 to=6
  pace fast
@50
  show rule
  keep done
`;
const WORDS59 = Array.from({ length: 59 }, (_, i) => ({ text: `w${i}`, start: i * 0.4 }));

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

test("a pinned line that computes a thing declares it and its parts, for any kind the kits make", () => {
  const p = parseIntent(SORT_PLAN);
  assert.deepEqual(p.notes, []);
  assert.equal(p.moments[0]!.pinned[0]!.text, "sort demo1 data=[4,1,3,2] algo=insertion show=boxes", "the line is pinned, not dropped as a line about nothing");
  assert.equal(p.moments[1]!.show, "demo1");
  assert.equal(p.moments[2]!.show, "demo1.item.2", "a part of a computed thing is one name, however deep");
  assert.deepEqual([...computedOf(p).values()].map((c) => [c.id, c.kind, c.moment]), [["demo1", "sort", 0]]);
  assert.deepEqual(checkIntent(p, WORDS59), [], "show demo1, keep demo1 and show demo1.item.2 are declared names");
  // The kinds come from the kits: a kind no kit makes is not a computed thing, so its names are undeclared.
  const none = checkIntent(parseIntent(SORT_PLAN, []), WORDS59, [], []).map((x) => x.message).join("\n");
  assert.match(none, /"demo1" was never declared/);
  assert.match(none, /"demo1.item.2" names a part of "demo1"/);
  // A graph, a formula: any kit kind pins and declares the same way.
  const g = parseIntent(`@0\n  graph net: A-B:4 B-C:1\n  show net.node.A\n@3\n  math f latex="x^2"\n  show f`);
  assert.deepEqual(checkIntent(g, WORDS59), []);
  assert.deepEqual([...computedOf(g).keys()], ["net", "f"]);
  // A name that is still undeclared is still reported, and one name cannot be two things.
  assert.match(checkIntent(parseIntent(`${SORT_PLAN}@55\n  show demo2.item.1\n`), WORDS59).map((x) => x.message).join("\n"), /"demo2.item.1" names a part of "demo2"/);
  const clash = checkIntent(parseIntent(`thing demo1 "x"\n${SORT_PLAN}`), WORDS59).map((x) => x.message).join("\n");
  assert.match(clash, /demo1 is made here by a sort line and is also declared at line 1/);
});

// Where things are: one line per relation, before the moments, in the author's words.
const PLACED = `object desk "a wooden desk, 140 cm wide"
object lamp "a small reading lamp"
object cat "a sleeping cat"
object mug "a mug"
object tag "a paper tag"
object rug "a long rug"
thing note "a note"

lamp on desk "left end"
cat sleeps under desk
mug next to lamp
tag hangs from lamp.arm
desk stands on rug
note on desk
mug above rug "1 m"
lamp in front of rug
flag at the top of desk

@0
  show lamp
`;

test("relations: the author's words end in a relation, with a place on the other thing or a distance", () => {
  const p = parseIntent(PLACED);
  const rel = (a: string, b: string) => p.relations!.find((r) => r.a === a && r.b === b);
  assert.deepEqual(rel("lamp", "desk"), { a: "lamp", kind: "on", b: "desk", words: "on", at: "left end", line: 9 });
  assert.equal(rel("cat", "desk")!.kind, "under");
  assert.equal(rel("cat", "desk")!.words, "sleeps under");
  assert.equal(rel("mug", "lamp")!.kind, "beside");
  assert.deepEqual([rel("tag", "lamp")!.kind, rel("tag", "lamp")!.at], ["to", "arm"]);
  assert.equal(rel("desk", "rug")!.kind, "on");
  assert.deepEqual([rel("mug", "rug")!.kind, rel("mug", "rug")!.gapCm, rel("mug", "rug")!.at], ["over", 100, undefined]);
  assert.equal(rel("lamp", "rug")!.kind, "front");
  // A line about a thing that is not an object is read, and checkIntent says why it places nothing.
  assert.ok(rel("note", "desk"));
  const words = Array.from({ length: 4 }, (_, i) => ({ text: `w${i}`, start: i }));
  const problems = checkIntent(p, words);
  assert.ok(problems.some((x) => /note is a thing, not an object/.test(x.message)), JSON.stringify(problems));
  // "flag" was never declared: the line is not a relation, it is a note.
  assert.ok(!p.relations!.some((r) => r.a === "flag"));
  assert.ok(p.notes.some((n) => /flag at the top of desk/.test(n)));
});

test("relations: a place named with 'at the ... of' and every kind the language has", () => {
  const kinds = (line: string) => parseIntent(`object a "a"\nobject b "b"\n${line}\n@0\n  show a\n`).relations?.[0];
  assert.deepEqual([kinds("a at the far end of b")!.kind, kinds("a at the far end of b")!.at], ["at", "far end"]);
  assert.deepEqual([kinds("a on the edge of b")!.kind, kinds("a on the edge of b")!.at], ["on", "edge"]);
  const cases: [string, string][] = [["a on top of b", "on"], ["a rests upon b", "on"], ["a floats over b", "over"], ["a is beneath b", "under"], ["a below b", "under"], ["a inside b", "in"], ["a tied to b", "to"], ["a beside b", "beside"], ["a leans against b", "against"], ["a left of b", "left"], ["a to the right of b", "right"], ["a behind b", "behind"], ["a in front of b", "front"], ["a around b", "around"], ["a at b", "at"]];
  for (const [line, kind] of cases) assert.equal(kinds(line)?.kind, kind, line);
  // Inside a moment the same words are what a thing does, not where it is.
  const p = parseIntent(`object a "a"\nobject b "b"\n@0\n  show a\n  a moves to b\n`);
  assert.equal(p.relations, undefined);
  assert.equal(p.moments[0]!.acts[0]!.verb, "moves to");
});

test("relations: placing one thing on another twice is the author's to repair", () => {
  const p = parseIntent(`object a "a"\nobject b "b"\na on b\na under b\n@0\n  show a\n`);
  const problems = checkIntent(p, [{ text: "w", start: 0 }]);
  assert.ok(problems.some((x) => /placed relative to b again/.test(x.message)), JSON.stringify(problems));
});
