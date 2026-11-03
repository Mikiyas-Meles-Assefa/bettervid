import { test } from "node:test";
import assert from "node:assert/strict";
import { dependencies, parallelMap, schedule } from "../lib/scheduler.ts";

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };
test("dependencies finish before children and independent tasks overlap", async () => {
  const gate = deferred();
  const started = deferred();
  const events: string[] = [];
  const run = schedule([
    { name: "parent", needs: [], run: async () => { events.push("parent"); await gate.promise; events.push("done"); } },
    { name: "sibling", needs: [], run: async () => { events.push("sibling"); started.resolve(); } },
    { name: "child", needs: ["parent"], run: async () => { events.push("child"); } },
  ]);
  await started.promise;
  assert.deepEqual(events, ["parent", "sibling"]);
  gate.resolve();
  await run;
  assert.deepEqual(events, ["parent", "sibling", "done", "child"]);
});
test("failure prevents dependants and drains in-flight work", async () => {
  const gate = deferred();
  let child = false;
  let drained = false;
  const run = schedule([
    { name: "failure", needs: [], run: async () => { throw new Error("broken"); } },
    { name: "running", needs: [], run: async () => { await gate.promise; drained = true; } },
    { name: "child", needs: ["failure"], run: async () => { child = true; } },
  ]);
  gate.resolve();
  await assert.rejects(run, /broken/);
  assert.equal(child, false);
  assert.equal(drained, true);
});
test("serial mode, missing dependencies and cycles", async () => {
  const events: number[] = [];
  await schedule([1, 2].map((n) => ({ name: String(n), needs: [], run: async () => { events.push(n); await Promise.resolve(); events.push(-n); } })), false);
  assert.deepEqual(events, [1, -1, 2, -2]);
  await assert.rejects(schedule([{ name: "a", needs: ["missing"], run: async () => {} }]), /missing/);
  await assert.rejects(schedule([{ name: "a", needs: ["a"], run: async () => {} }]), /cycle/);
});
test("worker pool replenishes immediately and preserves result order", async () => {
  const gate = deferred();
  const third = deferred();
  const run = parallelMap([0, 1, 2], 2, async (n) => { if (n === 0) await gate.promise; if (n === 2) third.resolve(); return n; });
  await third.promise;
  gate.resolve();
  assert.deepEqual(await run, [0, 1, 2]);
});

test("the video graph keeps script, word timing, images and audio dependencies", async () => {
  const seen = new Set<string>();
  const tasks = Object.entries(dependencies).map(([name, needs]) => ({ name, needs, run: async () => {
    for (const dep of needs) assert.ok(seen.has(dep), `${name} ran before ${dep}`);
    if (name === "voice") assert.ok(seen.has("direction"));
    if (name === "scene") assert.ok(seen.has("annotate"));
    if (name === "render") assert.ok(seen.has("mix"));
    seen.add(name);
  } }));
  await schedule(tasks);
  assert.equal(seen.size, tasks.length);
});
