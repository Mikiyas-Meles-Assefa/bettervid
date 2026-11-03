import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileReasoner, parseAnswer, validate } from "./reasoner.ts";
import type { AgentTask } from "./types.ts";

const schema = { type: "object", required: ["n", "kind"], properties: { n: { type: "number" }, kind: { type: "string", enum: ["a", "b"] }, list: { type: "array", items: { type: "string" } } } };
const task = (request = "count the things"): AgentTask => ({ role: "reader", id: "read.thing", system: "You count.", request, schema, images: ["/x/pic.png"] });

test("validate checks types, required keys, enums and items loosely", () => {
  assert.deepEqual(validate({ n: 2, kind: "a", list: ["x"] }, schema), []);
  assert.deepEqual(validate({ n: 2, kind: "a", extra: true }, schema), []); // unknown keys are fine
  const bad = validate({ n: "2", list: [3] }, schema);
  assert.ok(bad.some((p) => p.includes("answer.kind is missing")));
  assert.ok(bad.some((p) => p.includes("answer.n should be number")));
  assert.ok(bad.some((p) => p.includes("answer.list[0] should be string")));
  assert.ok(validate({ n: 1, kind: "c" }, schema).some((p) => p.includes("one of")));
});

test("parseAnswer reads fenced or bare JSON", () => {
  assert.deepEqual(parseAnswer('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(parseAnswer('Here it is: {"a": [1, 2]} done'), { a: [1, 2] });
  assert.throws(() => parseAnswer("no json here"));
});

test("the file reasoner is pending until answered, then returns the answer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reasoner-"));
  try {
    const r = fileReasoner(dir);
    const a = await r.ask(task());
    assert.equal(a.status, "pending");
    const ask = readFileSync(r.askFile("read.thing"), "utf8");
    for (const want of ["You count.", "count the things", "/x/pic.png", '"required"', r.answerFile("read.thing")]) assert.ok(ask.includes(want), want);
    writeFileSync(r.answerFile("read.thing"), '{"n": 3, "kind": "b"}');
    assert.deepEqual(await r.ask(task()), { status: "answered", value: { n: 3, kind: "b" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an answer that does not match goes back with its problems", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reasoner-"));
  try {
    const r = fileReasoner(dir);
    await r.ask(task());
    writeFileSync(r.answerFile("read.thing"), '{"n": "three"}');
    const a = await r.ask(task());
    assert.equal(a.status, "pending");
    assert.ok(existsSync(r.answerFile("read.thing").replace(/\.json$/, ".bad.json")));
    const ask = readFileSync(r.askFile("read.thing"), "utf8");
    assert.ok(ask.includes("could not be used") && ask.includes("answer.kind is missing"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an answer to an earlier version of the task is set aside", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reasoner-"));
  try {
    const r = fileReasoner(dir);
    await r.ask(task("first request"));
    writeFileSync(r.answerFile("read.thing"), '{"n": 1, "kind": "a"}');
    const a = await r.ask(task("a changed request"));
    assert.equal(a.status, "pending");
    assert.ok(existsSync(r.answerFile("read.thing").replace(/\.json$/, ".stale.json")));
    assert.ok(readFileSync(r.askFile("read.thing"), "utf8").includes("a changed request"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
