import assert from "node:assert/strict";
import { test } from "node:test";
import { dijkstra } from "./dijkstra.ts";

test("finds the true shortest path, not the fewest hops", () => {
  const log = dijkstra(["a", "b", "c", "d"], [{ id: "ab", from: "a", to: "b", weight: 1 }, { id: "bc", from: "b", to: "c", weight: 1 }, { id: "cd", from: "c", to: "d", weight: 1 }, { id: "ad", from: "a", to: "d", weight: 9 }], "a", "d");
  const done = log.at(-1)!;
  assert.deepEqual(done.path, ["a", "b", "c", "d"]);
  assert.equal(done.total, 3);
});
