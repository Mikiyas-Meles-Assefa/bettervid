import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTask, Answer, PartCard, Reasoner, Requirement } from "../types.ts";
import { checkCard, checkRequirements, expectedBar, formatOf, readCode, readDoc, readMaterial, readProject, readTable, resolve, type PictureAnswer } from "./index.ts";

// A reasoner that answers from a list, by task id, and records what it was asked.
function scripted(answers: Record<string, unknown>): Reasoner & { asked: AgentTask[] } {
  const asked: AgentTask[] = [];
  return {
    asked,
    async ask<T>(t: AgentTask): Promise<Answer<T>> {
      asked.push(t);
      return t.id in answers ? { status: "answered", value: answers[t.id] as T } : { status: "pending", file: `${t.id}.md` };
    },
  };
}

// A horizontal bar chart drawn exactly: plot [0.2, 0.2, 0.9, 0.9], ymax 100, bars filling 60% of their slots.
const plot: [number, number, number, number] = [0.2, 0.2, 0.9, 0.9];
const chart = (values: number[], over: Partial<PictureAnswer> = {}): PictureAnswer => {
  const d = { kind: "bars", orient: "h" as const, labels: ["north", "south", "east"], values, ymax: 100, plot, barFrac: 0.6, total: values.reduce((a, b) => a + b, 0), parts: ["n", "s", "e"] };
  const parts: PictureAnswer["parts"] = { title: { box: [0.05, 0.02, 0.6, 0.1], about: "the title", text: "Rain by region" } };
  ["n", "s", "e"].forEach((k, i) => (parts[k] = { box: expectedBar(d as never, i)!, about: `the ${d.labels[i]} bar` }));
  return { kind: "chart", about: "rain by region", parts, words: ["Rain by region"], data: d, ...over };
};
const pictureFile = { name: "chart", file: "rain.png", path: "/nowhere/rain.png", size: [1000, 600] as [number, number] };

test("files go to a reader by their format", () => {
  assert.equal(formatOf({ name: "a", file: "photo.JPG" }), "picture");
  assert.equal(formatOf({ name: "a", file: "data.tsv" }), "table");
  assert.equal(formatOf({ name: "a", file: "main.rs" }), "code");
  assert.equal(formatOf({ name: "a", file: "brief.txt" }), "text");
  assert.equal(formatOf({ name: "a", file: "notes", kind: "code" }), "code");
});

test("a table is read into rows, notes and data", () => {
  const c = readTable({ name: "t", file: "t.csv", text: 'city,people,"area, km2"\nOslo,"1,064,235",454\nBergen,291940,465\n# note: 2024 figures' });
  assert.equal(c.parts["column.3"]!.text, "area, km2");
  assert.equal(c.parts["row.1"]!.text, "Oslo, 1,064,235, 454");
  assert.equal(c.parts["note.1"]!.text, "note: 2024 figures");
  assert.deepEqual(c.data!.labels, ["Oslo", "Bergen"]);
  assert.deepEqual(c.data!.values, [1064235, 291940]);
  assert.ok(c.checked.ok);
});

test("code is read into numbered lines, with a diff's marks", () => {
  const c = readCode({ name: "f", file: "f.py", text: "def f(x):\n-    return x\n+    return x + 1\n" });
  assert.equal(c.parts["line.2"]!.about, "line 2, removed by the change");
  assert.equal(c.parts["line.3"]!.about, "line 3, added by the change");
  assert.ok(c.text!.includes("  3  +    return x + 1"));
  assert.equal(readCode({ name: "g", file: "g.md", text: "- one\n- two" }).parts["line.1"]!.about, "line 1"); // a list is not a diff
});

test("a document is read into headings, items, sentences and quotes with their lines", () => {
  const c = readDoc({ name: "d", file: "d.md", text: 'Field notes\n\n# Method\nWe sampled 12 ponds. The guide says "never sample after rain" for a reason.\n- Use sterile jars.\n' });
  assert.equal(c.parts["heading.1"]!.text, "Field notes");
  assert.equal(c.parts["heading.2"]!.text, "Method");
  assert.equal(c.parts["sentence.1"]!.text, "We sampled 12 ponds.");
  assert.equal(c.parts["sentence.1"]!.about, "a sentence (line 4)");
  assert.equal(c.parts["quote.1"]!.text, "never sample after rain");
  assert.equal(c.parts["item.1"]!.text, "Use sterile jars.");
  assert.deepEqual(checkCard(c, { text: c.text! }), []);
});

test("the check finds boxes outside the picture, empty or degenerate", () => {
  const a = chart([40, 70, 20]);
  a.parts.bad = { box: [0.5, 0.5, 1.2, 0.6], about: "too far right" };
  a.parts.flat = { box: [0.3, 0.4, 0.3, 0.5], about: "no width" };
  a.parts.tiny = { box: [0.3, 0.4, 0.3005, 0.5], about: "half a pixel" };
  const p = checkCard({ ...cardOf(a) });
  assert.ok(p.some((x) => x.startsWith("part bad") && x.includes("outside")));
  assert.ok(p.some((x) => x.startsWith("part flat") && x.includes("empty")));
  assert.ok(p.some((x) => x.startsWith("part tiny") && x.includes("pixels")));
});

const cardOf = (a: PictureAnswer): PartCard => ({ name: "chart", file: "rain.png", size: [1000, 600], kind: a.kind, about: a.about, parts: a.parts, data: a.data, text: a.words.join("\n"), requirements: [], checked: { ok: false, notes: [] } });

test("an exact chart reading checks", () => {
  assert.deepEqual(checkCard(cardOf(chart([40, 70, 20]))), []);
});

test("the check finds values that disagree with the total, the bars and the part's own text", () => {
  const a = chart([40, 70, 20]);
  a.data!.values = [40, 75, 20]; // misread: the bar and the total say 70
  a.parts.s!.text = "70";
  a.words.push("70");
  const p = checkCard(cardOf(a));
  assert.ok(p.some((x) => x.includes("add up to 135") && x.includes("130")));
  assert.ok(p.some((x) => x.includes("south bar's box") && x.includes("not where")));
  assert.ok(p.some((x) => x.includes("south is 75") && x.includes('reads "70"')));
});

test("the check finds bars whose lengths are not ordered as their values", () => {
  const a = chart([40, 70, 20]);
  delete a.data!.plot; // no plot: only the order of the lengths can be checked
  [a.parts.n!.box, a.parts.s!.box] = [a.parts.s!.box!, a.parts.n!.box!];
  const p = checkCard(cardOf(a));
  assert.ok(p.some((x) => x.includes("south (70) is larger than north (40)")));
});

test("the check finds words not in the document and data that differs from a table", () => {
  const doc = readDoc({ name: "d", file: "d.txt", text: "The pump runs at 40 litres a minute." });
  doc.parts["sentence.9"] = { about: "made up", text: "The pump runs at 60 litres a minute." };
  assert.ok(checkCard(doc, { text: "The pump runs at 40 litres a minute." }).some((x) => x.includes("not in the file")));
  const p = checkCard(cardOf(chart([40, 70, 20])), { tables: [{ file: "rain.csv", text: "region,mm\nnorth,40\nsouth,72\neast,20" }] });
  assert.deepEqual(p, ["data: south is 70 but rain.csv has 72"]);
  assert.deepEqual(checkCard(cardOf(chart([40, 70, 20])), { tables: [{ file: "other.csv", text: "fruit,kg\napple,3" }] }), []); // not this table
});

test("a picture reading is repaired until it checks", async () => {
  const wrong = chart([40, 70, 20]);
  wrong.data!.total = 140;
  const r = scripted({ "read.chart": wrong, "read.chart.r1": chart([40, 70, 20]) });
  const a = await readMaterial(pictureFile, r);
  assert.equal(a.status, "answered");
  if (a.status !== "answered") return;
  assert.ok(a.value.checked.ok);
  assert.deepEqual(a.value.checked.notes, ["checked after 1 repair"]);
  assert.equal(r.asked.length, 2);
  assert.equal(r.asked[0]!.role, "reader");
  assert.deepEqual(r.asked[0]!.images, ["/nowhere/rain.png"]);
  assert.ok(r.asked[1]!.request.includes("the picture's total reads 140"));
});

test("a reading that never checks says so after its rounds", async () => {
  const wrong = chart([40, 70, 20]);
  wrong.data!.total = 140;
  const r = scripted({ "read.chart": wrong, "read.chart.r1": wrong });
  const a = await readMaterial(pictureFile, r, { rounds: 1 });
  assert.ok(a.status === "answered" && !a.value.checked.ok && a.value.checked.notes[0]!.includes("total"));
});

test("a picture not yet answered is pending", async () => {
  assert.equal((await readMaterial(pictureFile, scripted({}))).status, "pending");
});

const cards = (): PartCard[] => [
  cardOf(chart([40, 70, 20])),
  readDoc({ name: "brief", file: "brief.txt", text: "Show the rain chart whole. Use #224466 for headings." }),
];

test("requirements must name real files and parts", () => {
  const ok: Requirement = { id: "r1", source: { file: "brief", where: "sentence.1" }, applies: "chart", kind: "show exactly", detail: "the whole chart", why: "the brief says so" };
  assert.deepEqual(checkRequirements([ok, { ...ok, id: "r2", applies: "chart.s" }, { ...ok, id: "r3", source: { file: "brief.txt", where: "brief.sentence.2" }, applies: undefined }], cards()), []);
  const bad = checkRequirements([ok, { ...ok }, { ...ok, id: "r4", source: { file: "memo", where: "x" } }, { ...ok, id: "r5", source: { file: "brief", where: "sentence.7" } }, { ...ok, id: "r6", applies: "chart.west" }, { ...ok, id: "r7", detail: " " }], cards());
  assert.ok(bad.some((x) => x.includes("r1") && x.includes("twice")));
  assert.ok(bad.some((x) => x.includes("r4") && x.includes('"memo" is not one of the cards')));
  assert.ok(bad.some((x) => x.includes("r5") && x.includes('"sentence.7" is not a part of brief')));
  assert.ok(bad.some((x) => x.includes("r6") && x.includes("chart.west")));
  assert.ok(bad.some((x) => x.includes("r7") && x.includes("no detail")));
  assert.deepEqual(resolve("rain.png.n", cards())?.part, "n");
});

test("a project is read, linked, repaired and its requirements given to the cards they are about", async () => {
  const req = { id: "whole", source: { file: "brief.txt", where: "brief.sentence.1" }, applies: "rain.png", kind: "show exactly", detail: "the whole chart", why: "the brief" };
  const r = scripted({ "read.chart": chart([40, 70, 20]), link: { requirements: [{ ...req, applies: "rain.png.west" }] }, "link.r1": { requirements: [req] } });
  const files = [pictureFile, { name: "brief", file: "brief.txt", kind: "doc", text: "Show the rain chart whole. Use #224466 for headings." }];
  const out = await readProject(files, r, { request: "a clip of my chart" });
  assert.deepEqual(out.pending, []);
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.requirements, [{ ...req, source: { file: "brief", where: "sentence.1" }, applies: "chart" }]);
  assert.equal(out.cards[0]!.requirements.length, 1);
  assert.equal(out.cards[1]!.requirements.length, 0);
  const link = r.asked.find((t) => t.id === "link")!;
  assert.ok(link.request.includes("a clip of my chart") && link.request.includes("brief.sentence.1") && link.request.includes("chart.s"));
});
