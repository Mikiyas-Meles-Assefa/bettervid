// The Meta reasoner with a fake Responses call: strict mode only for closed schemas, repairs from schema problems,
// retries on network errors, the budget stop and pictures attached. No model calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { metaReasoner, strictable } from "../lib/reasoner-meta.ts";
import type { AgentTask } from "../../engine/design/types.ts";

const closed = { type: "object", additionalProperties: false, required: ["n"], properties: { n: { type: "integer" } } };
const open = { type: "object", required: ["n"], properties: { n: { type: "integer" }, why: { type: "string" } } };
const reply = (text: string) => ({ status: "completed", usage: { input_tokens: 1000, output_tokens: 100 }, output: [{ type: "message", content: [{ text }] }] });
const task = (schema?: Record<string, unknown>, images?: string[]): AgentTask => ({ role: "designer", id: "designer.m1.r1", system: "sys", request: "req", schema, images });

test("strict only when every object is closed and every property required", () => {
  assert.equal(strictable(closed), true);
  assert.equal(strictable(open), false);
  assert.equal(strictable({ type: "array", items: open }), false);
  assert.equal(strictable({ type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "object", additionalProperties: { type: "number" } } } }), false);
});

test("a valid answer is returned and charged", async () => {
  const bodies: any[] = [];
  const charged: number[] = [];
  const r = metaReasoner({ post: async (_p, b) => (bodies.push(b), reply('{"n": 3}')), charge: (usd) => charged.push(usd) });
  const a = await r.ask<{ n: number }>(task(closed));
  assert.deepEqual(a, { status: "answered", value: { n: 3 } });
  assert.equal(bodies[0].text.format.strict, true);
  assert.equal(r.ledger.calls, 1);
  assert.ok(r.ledger.usd > 0 && charged.length === 1);
});

test("an open schema goes into the request, and a bad answer is repaired", async () => {
  const bodies: any[] = [];
  const answers = ['{"n": "three"}', 'Here it is:\n```json\n{"n": 3}\n```'];
  const r = metaReasoner({ post: async (_p, b) => (bodies.push(b), reply(answers[bodies.length - 1]!)) });
  const a = await r.ask<{ n: number }>(task(open));
  assert.deepEqual(a, { status: "answered", value: { n: 3 } });
  assert.equal(bodies[0].text, undefined);
  assert.match(bodies[0].input[0].content[0].text, /matching this schema/);
  assert.match(bodies[1].input[0].content[0].text, /answer\.n should be integer/);
  assert.equal(r.ledger.tasks[0]!.repairs, 1);
});

test("after the last repair it throws, with no lesser answer", async () => {
  const r = metaReasoner({ repairs: 1, post: async () => reply("not json") });
  await assert.rejects(r.ask(task(open)), /still does not match/);
  assert.equal(r.ledger.calls, 2);
});

test("a network error is tried again", async () => {
  let n = 0;
  const r = metaReasoner({ tries: 2, post: async () => (n++ ? reply('{"n": 1}') : Promise.reject(new Error("ETIMEDOUT"))) });
  assert.deepEqual(await r.ask(task(closed)), { status: "answered", value: { n: 1 } });
  assert.equal(n, 2);
});

test("the budget stops a call before it is made", async () => {
  let n = 0;
  const r = metaReasoner({ budget: { calls: 1 }, post: async () => (n++, reply('{"n": 1}')) });
  await r.ask(task(closed));
  await assert.rejects(r.ask(task(closed)), /reasoner budget/);
  assert.equal(n, 1);
});

test("pictures are attached as image inputs, and a task with no schema answers text", async () => {
  let body: any;
  const r = metaReasoner({ image: (f) => `data:image/png;base64,${f}`, post: async (_p, b) => ((body = b), reply("  plain words  ")) });
  const a = await r.ask<string>(task(undefined, ["a.png", "b.png"]));
  assert.deepEqual(a, { status: "answered", value: "plain words" });
  assert.deepEqual(body.input[0].content.slice(1), [{ type: "input_image", image_url: "data:image/png;base64,a.png" }, { type: "input_image", image_url: "data:image/png;base64,b.png" }]);
});
