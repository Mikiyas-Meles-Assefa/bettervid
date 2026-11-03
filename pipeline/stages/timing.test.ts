import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { post } from "../lib/meta.ts";
import { effort, inStage, timedRun } from "../lib/timing.ts";
import { hash } from "../lib/util.ts";

test("timing captures overlapping calls, actual effort, tokens, and failure without request data", async () => {
  const folder = join("projects", `timing-test-${process.pid}`);
  const fetch0 = globalThis.fetch;
  const key0 = process.env.META_API_KEY;
  const effort0 = process.env.PIPELINE_EFFORT_WRITER;
  const sent: any[] = [];
  await mkdir(folder, { recursive: true });
  try {
    process.env.META_API_KEY = "test";
    process.env.PIPELINE_EFFORT_WRITER = "medium";
    globalThis.fetch = (async (_url, opts) => {
      sent.push(JSON.parse(String(opts?.body)));
      return new Response(JSON.stringify({ status: "completed", usage: { input_tokens: 12, output_tokens: 34 } }));
    }) as typeof fetch;
    await timedRun(folder, async () => {
      await Promise.all(["writer", "director"].map((name) => inStage(name, () => post("/responses", { model: "muse-spark-1.3", reasoning: { effort: "high" }, instructions: "private prompt" }))));
    });
    const result = JSON.parse(await readFile(join(folder, "timings.json"), "utf8"));
    assert.equal(result.status, "done");
    assert.equal(result.records.length, 2);
    assert.deepEqual(result.records.map((r: any) => [r.name, r.effort, r.inputTokens, r.outputTokens]), [["writer", "medium", 12, 34], ["director", "high", 12, 34]]);
    assert.deepEqual(sent.map((r) => r.reasoning.effort), ["medium", "high"]);
    const log = await readFile(join(folder, "run.log"), "utf8");
    assert.ok(!log.includes("private prompt"));
    assert.ok(!log.includes('"authorization"'));
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    await assert.rejects(timedRun(folder, () => inStage("critic", () => post("/responses", { model: "muse-spark-1.3" }, 1))), /offline/);
    const failure = JSON.parse(await readFile(join(folder, "timings.json"), "utf8"));
    assert.equal(failure.status, "failed");
    assert.equal(failure.records[0].status, "failed");
  } finally {
    globalThis.fetch = fetch0;
    if (key0 === undefined) delete process.env.META_API_KEY; else process.env.META_API_KEY = key0;
    if (effort0 === undefined) delete process.env.PIPELINE_EFFORT_WRITER; else process.env.PIPELINE_EFFORT_WRITER = effort0;
    await rm(folder, { recursive: true, force: true });
  }
});
test("defaults stay unchanged and effort overrides invalidate partial hashes", async () => {
  const previous = process.env.PIPELINE_EFFORT_WRITER;
  try {
    delete process.env.PIPELINE_EFFORT_WRITER;
    await inStage("writer", async () => {
      const before = hash("saved draft");
      assert.equal(effort("high"), "high");
      process.env.PIPELINE_EFFORT_WRITER = "low";
      assert.equal(effort("high"), "low");
      assert.notEqual(hash("saved draft"), before);
      process.env.PIPELINE_EFFORT_WRITER = "invalid";
      assert.throws(() => effort("high"), /invalid reasoning effort/);
    });
  } finally {
    if (previous === undefined) delete process.env.PIPELINE_EFFORT_WRITER; else process.env.PIPELINE_EFFORT_WRITER = previous;
  }
});
