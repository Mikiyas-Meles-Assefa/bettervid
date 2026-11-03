import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { themeFrom } from "../../render/theme.ts";
import { parseIntent } from "../intent/parse.ts";
import { instruments } from "../instruments/index.ts";
import { validate } from "../reasoner.ts";
import { styleValues, suggestDesign, viewingFrom } from "../suggest.ts";
import type { Candidate, Viewing } from "../types.ts";
import type { DesignerAnswer, DesignerInput, DirectorAnswer, DirectorInput, ViewerAnswer, ViewerInput } from "./api.ts";
import { valueNames } from "./common.ts";
import { agents, allocate, applyCorrections, checkDesigner, checkDirector, checkViewer, PROMPTS, prompt, seatsOf, instrumentInfo } from "./index.ts";

// A small plan on a topic unlike the bench's: a kettle that boils, a question, a reveal.
const SRC = `feel calm
for new

object kettle "a steel kettle on a stove"
thing temp "100 degrees"
thing q "when does it boil?"

@0
    show kettle
    ask "When does it boil?"
@4
    reveal temp
    keep kettle
    kettle turns "steaming"
@8
    show kettle
    plain
`;
const words = "The kettle sits on the stove. At one hundred degrees the water boils. Then it whistles loudly".split(" ").map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.3 }));
const plan = parseIntent(SRC);
const theme = themeFrom("flat");
const viewing: Viewing = viewingFrom({ width: 1080, height: 1920, fps: 30, screen: "phone in a feed", frameWidthMm: 65, distanceMm: 380, watch: "glancing", why: "test" });
const start = suggestDesign(plan, viewing, theme, [], words);
const holds = [{ id: "h1", afterWord: 7, seconds: 2, purpose: "look" }];
const dirInput: DirectorInput = { plan, words, holds, cards: [], requirements: [], brief: "A short clip for a cooking channel.", theme, styleName: "flat", start };

const goodDirector = (): DirectorAnswer => ({
  viewing: { ...viewing, uiZones: [{ box: [0, 0.85, 1, 1], what: "app controls" }], captions: { show: true, box: [0.05, 0.72, 0.95, 0.82], why: "sound off in a feed" } },
  tempo: { value: 1.1, why: "calm" },
  moments: [
    { moment: 0, importance: 0.4, know: "a kettle is heating", waiting: "when it boils", focus: "one" },
    { moment: 1, importance: 1, know: "it boils at 100 degrees", feel: "satisfied" },
    { moment: 2, importance: 0.3, know: "it whistles" },
  ],
  demos: [{ moment: 1, act: 0, speed: "real", replay: { speed: "slow" }, why: "steam is quick" }],
  goals: [{ id: "read", scope: "video", says: "words read at a glance", instrument: "legibility", settings: { readable: 27 }, value: "shareBelow", want: { max: 0.05 }, weight: 0.6, why: "feed" }],
  overrides: [{ key: "type.support@1", value: 0.07, why: "larger at the payoff" }],
  budget: { candidatesPerMoment: 3, rounds: 2, calls: 12 },
  corrections: [],
  seats: [{ who: "a home cook", why: "knows kettles" }],
  why: "a calm payoff",
});

test("prompts carry no bench topic words", () => {
  const dir = join(import.meta.dirname, "..", "..", "..", "bench", "cases");
  // General words that appear in topics but name no topic.
  const general = new Set("about after along also does down earth fall falls faster finding from have heavier into joins mattered much number objects over since some something step stops than that their them then this under when where which while whole with your works fresh water zone fraction half point rule support trail memory life cover cause".split(" "));
  const words = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const c = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const w of `${c.id.replace(/-/g, " ")} ${c.topic}`.toLowerCase().match(/[a-z]{4,}/g) ?? []) if (!general.has(w)) words.add(w.replace(/s$/, ""));
  }
  for (const name of PROMPTS) {
    const text = prompt(name).toLowerCase();
    const hits = [...words].filter((w) => new RegExp(`\\b${w}s?\\b`).test(text));
    assert.deepEqual(hits, [], `prompts/${name}.md names bench topic words: ${hits.join(", ")}`);
  }
});

test("value names are read from every instrument's description", () => {
  for (const i of Object.values(instruments)) assert.ok(valueNames(i.describe).length > 0, `${i.name} lists values`);
  assert.ok(valueNames(instruments.salience!.describe).includes("share.<plan name>"));
  assert.ok(valueNames(instruments.timing!.describe).includes("hold.<id>.related"));
});

test("a sound director answer has no problems and fits the schema", () => {
  const a = goodDirector();
  assert.deepEqual(checkDirector(dirInput, a), []);
  const task = agents.directorTask(dirInput);
  assert.equal(task.role, "director");
  assert.deepEqual(validate(a, task.schema), []);
  assert.ok(task.request.includes("m0") && task.request.includes("legibility"));
});

test("the director's mistakes become problems, never silent drops", () => {
  const a = goodDirector();
  a.moments[2]!.moment = 7;
  a.demos.push({ moment: 0, act: 3, speed: "slow", why: "x" });
  a.goals.push({ id: "g2", scope: "moment", moment: 1, says: "x", instrument: "salience", value: "share.teapot", want: { min: 0.5 }, weight: 2, why: "x" });
  a.goals.push({ id: "g3", scope: "video", says: "x", instrument: "glance", value: "x", want: {}, weight: 0.5, why: "x" }, { id: "g4", scope: "video", says: "x", instrument: "fill", value: "filled", want: {}, weight: 0.5, why: "x" });
  a.overrides.push({ key: "type.nothing", value: 1, why: "x" }, { key: "type.support@9", value: 0.1, why: "x" }, { key: "motion.move", value: 3, why: "x" });
  a.corrections.push({ moment: 1, was: "200 degrees", now: "100 degrees", source: "physics" });
  a.budget.rounds = 0;
  const p = checkDirector(dirInput, a).join("\n");
  for (const bit of ["moment 7 does not exist", "missing m2", "no act a3", "scope is \"moment\"", "teapot", "weight", "no instrument \"glance\"", "want needs", "type.nothing", "moment 9 does not exist", "list of 3", "not in the plan", "budget"]) assert.ok(p.includes(bit), `reports ${bit}:\n${p}`);
});

test("applying the director decides from the director, with reasons", () => {
  const d = agents.applyDirector(start, goodDirector());
  assert.equal(d.tempo.value, 1.1);
  assert.equal(d.tempo.from, "director");
  assert.equal(d.moments[1]!.importance.value, 1);
  assert.equal(d.moments[1]!.importance.from, "director");
  assert.equal(d.moments[0]!.focus.from, "director");
  assert.ok(d.viewing.uiZones.some((z) => z.what === "captions"), "the captions' box is kept clear");
  assert.equal(d.demos.find((x) => x.moment === 1)!.replay!.value.speed, "slow");
  assert.ok(d.goals.every((g) => g.scope === "video"));
  assert.ok(d.overrides.some((o) => o.key === "type.support@1"));
  assert.ok(d.decisions.every((x) => x.from === "director" && x.why.length > 0));
});

test("corrections are visible notes", () => {
  const a = goodDirector();
  const p2 = parseIntent(SRC.replace("100 degrees", "90 degrees"));
  a.corrections = [{ moment: 1, was: "90 degrees", now: "100 degrees", source: "water boils at 100 C at sea level" }];
  assert.deepEqual(checkDirector({ ...dirInput, plan: p2 }, a), []);
  const out = applyCorrections(p2, a);
  assert.equal(out.plan.things.find((t) => t.id === "temp")!.text, "100 degrees");
  assert.equal(out.notes.length, 1);
  assert.ok(out.plan.notes.some((n) => n.includes("90 degrees")));
  assert.equal(p2.things.find((t) => t.id === "temp")!.text, "90 degrees", "the input plan is not changed");
});

test("the budget is spent by importance and sums to the budget", () => {
  const d = agents.applyDirector(start, goodDirector());
  const a = allocate(d);
  assert.equal(a.reduce((s, x) => s + x.candidates, 0), 9);
  assert.equal(a.reduce((s, x) => s + x.calls, 0), 12);
  assert.ok(a[1]!.candidates > a[2]!.candidates);
  assert.ok(a.every((x) => x.candidates >= 1 && x.calls >= 1 && x.rounds >= 1));
  assert.equal(a[1]!.rounds, 2);
});

const design = agents.applyDirector(start, goodDirector());
const desInput = (k = 1, round?: DesignerInput["round"]): DesignerInput => ({ plan, moment: k, design, director: goodDirector(), cards: [], words, styleValues: styleValues(theme, design.viewing), instruments: instrumentInfo(design.viewing), holds, brief: dirInput.brief, ...(round ? { round } : {}) });
const goodDesigner = (): DesignerAnswer => ({
  goals: [{ id: "temp-first", scope: "moment", moment: 1, says: "the temperature takes the eye", instrument: "salience", value: "share.temp", want: { min: 0.5 }, weight: 0.8, why: "payoff" }],
  space: { subjectScale: [0.7, 0.85], lead: [0.3] },
  reasons: { subjectScale: "room for the kettle", lead: "eye lands on the word" },
  overrides: [{ key: "type.support@1", value: 0.08, why: "larger" }],
  proposals: [],
  done: false,
  why: "the payoff",
});

test("a sound designer answer has no problems and fits the schema", () => {
  const a = goodDesigner();
  assert.deepEqual(checkDesigner(desInput(), a), []);
  const task = agents.designerTask(desInput());
  assert.deepEqual(validate(a, task.schema), []);
  assert.ok(task.request.includes("This moment: m1"));
  assert.ok(task.request.includes("combinations"));
});

test("the designer's mistakes become problems", () => {
  const a = goodDesigner();
  (a.space as Record<string, unknown>).size = [1];
  a.space.arrangement = ["diagonal"];
  a.space.camera = [{ zoom: 1, at: [0.5, 0.5], move: "zoom" }];
  a.space.typeScale = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7];
  a.overrides.push({ key: "type.support", value: 0.08, why: "x" }, { key: "type.support@2", value: 0.08, why: "x" });
  a.proposals.push({ kind: "pointer", ids: ["the hot water", "kettle"], why: "x" }, { kind: "sparkle", ids: ["kettle"], why: "x" }, { kind: "pointer", ids: ["temp", "kettle"], why: "x" });
  a.goals.push({ id: "read", scope: "moment", moment: 1, says: "x", instrument: "legibility", value: "shareBelow", want: { max: 0.1 }, weight: 0.5, why: "x" });
  a.pick = "c1";
  const p = checkDesigner(desInput(), a).join("\n");
  for (const bit of ["space.size", "diagonal", "camera.move", "combinations", "would change the whole video", "only override moment 1", "not a name", "sparkle", "ids [thing, card.part]", "video goal read", "no search round", "reasons.typeScale"]) assert.ok(p.includes(bit), `reports ${bit}:\n${p}`);
  const plain = { ...goodDesigner(), proposals: [{ kind: "placeholder", ids: ["temp"], why: "x" }] };
  assert.ok(checkDesigner(desInput(2), plain).some((x) => x.includes("plain")));
});

test("applying the designer decides from the designer; a pick takes the candidate", () => {
  const d = agents.applyDesigner(design, 1, goodDesigner());
  const md = d.moments[1]!;
  assert.equal(md.lead.value, 0.3);
  assert.equal(md.lead.from, "designer");
  assert.equal(md.lead.why, "eye lands on the word");
  assert.equal(md.subjectScale.from, design.moments[1]!.subjectScale.from, "a field with several values stays for the search");
  assert.ok(d.goals.some((g) => g.scope === "moment" && g.moment === 1 && g.id === "temp-first"));
  assert.ok(d.goals.some((g) => g.scope === "video"), "video goals stay");
  assert.equal(d.overrides.filter((o) => o.key === "type.support@1").length, 1, "the designer's override replaces the director's for this moment");
  const cand: Candidate = { id: "c2", moment: 1, design: { ...md, subjectScale: { value: 0.85, from: "search", why: "tried" } }, readings: [], scores: [{ goal: "temp-first", value: 0.6, miss: 0 }], total: 0 };
  const round = { candidates: [cand], readings: [] };
  const pick: DesignerAnswer = { ...goodDesigner(), space: {}, reasons: {}, pick: "c2", done: true };
  assert.deepEqual(checkDesigner(desInput(1, round), pick), []);
  assert.ok(agents.designerTask(desInput(1, round)).request.includes("Candidate c2"));
  const picked = agents.applyDesigner(d, 1, pick, cand);
  assert.equal(picked.moments[1]!.subjectScale.value, 0.85);
  assert.ok(picked.decisions.some((x) => x.area === "pick" && x.from === "designer"));
  assert.ok(checkDesigner(desInput(1, round), { ...pick, pick: "c9" }).some((x) => x.includes("not a candidate")));
});

const vInput: ViewerInput = { sheets: [{ candidate: "a", image: "/x/a.jpg" }, { candidate: "b", image: "/x/b.jpg" }], transcript: "the kettle boils", seats: [{ who: "a home cook", why: "knows kettles" }], goals: design.goals, moments: 3 };
const goodViewer = (): ViewerAnswer => ({
  seats: seatsOf(vInput).flatMap((s) => ["a", "b"].map((c) => ({ who: s.who, candidate: c, saw: "the kettle", remembers: "it boils at 100", problems: [], wouldKeepWatching: true }))),
  pick: "b",
  fixes: [{ candidate: "b", field: "typeScale", value: 1.2, why: "small words" }, { candidate: "b", field: "type.support@1", value: 0.08, why: "small" }],
});

test("the viewer panel: standing seats plus the director's, every seat on every finalist", () => {
  assert.equal(seatsOf(vInput).length, 4);
  const a = goodViewer();
  assert.deepEqual(checkViewer(vInput, a), []);
  const task = agents.viewerTask(vInput);
  assert.deepEqual(validate(a, task.schema), []);
  assert.deepEqual(task.images, ["/x/a.jpg", "/x/b.jpg"]);
  const bad = goodViewer();
  bad.seats.pop();
  bad.seats[0]!.who = "first-time viewer: knows nothing";
  bad.pick = "z";
  bad.fixes.push({ candidate: "b", field: "typeScale", value: "larger", why: "x" }, { candidate: "b", field: "motion.move", value: 1, why: "x" }, { candidate: "b", field: "type.support@5", value: 0.1, why: "x" }, { candidate: "b", field: "glow", value: 1, why: "x" });
  const p = checkViewer(vInput, bad).join("\n");
  for (const bit of ["not a seat name", "missing", "pick", "typeScale \"larger\"", "list of 3", "moment 5", "glow"]) assert.ok(p.includes(bit), `reports ${bit}:\n${p}`);
});
