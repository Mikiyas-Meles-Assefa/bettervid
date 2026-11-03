import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Project } from "../../schemas/project.ts";
import { dir, save, stage } from "../lib/project.ts";

test("unchanged stages are free, changed inputs rerun, and parallel saves keep both checkpoints", async () => {
  const p: Project = { id: `speed-cache-${process.pid}`, createdAt: new Date().toISOString(), input: { prompt: "test", style: "flat", persona: "auto", mode: "explain", seconds: 30 }, stages: {}, costs: [] };
  const folder = dir(p);
  let calls = 0;
  try {
    await save(p);
    const run = async () => { calls++; };
    await stage(p, "plan", ["same"], 0, run);
    await stage(p, "plan", ["same"], 0, run);
    assert.equal(calls, 1);
    await stage(p, "plan", ["changed"], 0, run);
    assert.equal(calls, 2);
    await Promise.all([stage(p, "research", [], 0, run), stage(p, "writer", [], 0, run)]);
    const saved = JSON.parse(await readFile(join(folder, "project.json"), "utf8"));
    assert.ok(saved.stages.research);
    assert.ok(saved.stages.writer);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test("replacing narration at the same path invalidates the audio mix", async () => {
  const p = { id: `speed-mix-cache-${process.pid}`, stages: {}, costs: [], narration: { audio: "narration.mp3" } } as unknown as Project;
  const folder = dir(p);
  let calls = 0;
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "narration.mp3"), "first recording");
    const run = async () => { calls++; };
    await stage(p, "mix", ["same timeline"], 0, run);
    await stage(p, "mix", ["same timeline"], 0, run);
    assert.equal(calls, 1);
    await writeFile(join(folder, "narration.mp3"), "new recording");
    await stage(p, "mix", ["same timeline"], 0, run);
    assert.equal(calls, 2);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test("missing asset files invalidate stage checkpoints", async () => {
  const p = { id: `speed-asset-cache-${process.pid}`, stages: {}, costs: [], assets: [{ shotId: "one", kind: "generated", path: "one.jpg" }] } as unknown as Project;
  const folder = dir(p);
  let calls = 0;
  try {
    await mkdir(folder, { recursive: true });
    const run = async () => { calls++; await writeFile(join(folder, "one.jpg"), "picture"); };
    await stage(p, "assets", ["same"], 0, run);
    await stage(p, "assets", ["same"], 0, run);
    assert.equal(calls, 1);
    await rm(join(folder, "one.jpg"));
    await stage(p, "assets", ["same"], 0, run);
    assert.equal(calls, 2);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
