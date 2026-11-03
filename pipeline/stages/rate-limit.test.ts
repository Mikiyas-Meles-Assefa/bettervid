import { test } from "node:test";
import assert from "node:assert/strict";
import { requestGate } from "../lib/rate-limit.ts";

test("concurrent requests wait at the 150-request rolling limit", async () => {
  let now = 0;
  const waits: number[] = [];
  const gate = requestGate(150, 60_000, { now: () => now, sleep: async (ms) => { waits.push(ms); now += ms; } });
  await Promise.all(Array.from({ length: 150 }, () => gate()));
  assert.deepEqual(waits, []);
  await gate();
  assert.deepEqual(waits, [60_000]);
  await Promise.all(Array.from({ length: 149 }, () => gate()));
  assert.deepEqual(waits, [60_000]);
  await gate();
  assert.deepEqual(waits, [60_000, 60_000]);
});
