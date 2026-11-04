import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project } from "../../schemas/project.ts";
import { collectMoments, placements, type SoundPlan } from "../lib/sound.ts";
import { graph } from "./mix.ts";

const project = { narration: { words: [{ start: 0, end: 1 }, { start: 2, end: 3 }], holds: [{ id: "h1", start: 1, seconds: 1 }] }, direction: { events: [{ id: "e1", firstWord: 0, lastWord: 1, job: "show a change", look: "result", feel: "anticipation", reveal: { word: 1, what: "result" } }] }, timeline: { fps: 30, clips: [{ from: 0, scene: { nodes: [{ id: "calc", props: { truth: "sort" } }], events: [{ name: "swap", at: 20 }], tracks: [{ target: "calc.a", prop: "x", keys: [{ at: 30, value: 0 }, { at: 45, value: 100 }] }, { target: "answer", prop: "opacity", keys: [{ at: 60, value: 0 }, { at: 70, value: 1 }] }] } }] } } as unknown as Project;

test("collects compiled emits, computed changes, entrances, holds and directed reveals", () => {
  const moments = collectMoments(project);
  assert.ok(moments.some((m) => m.frame === 20 && m.what.includes("Emit swap")));
  assert.ok(moments.some((m) => m.frame === 30 && m.what.includes("calc.a.x")));
  assert.ok(moments.some((m) => m.frame === 60 && m.what.includes("answer.opacity")));
  assert.ok(moments.some((m) => m.what.includes("Directed reveal")));
  assert.equal(moments.filter((m) => m.what.startsWith("Hold")).length, 2);
});

test("fake reasoner selects moments; spacing includes full effect duration with no impact exemption", async () => {
  const moments = [0, 1, 1.5, 3.2].map((at, i) => ({ id: `m${i}`, frame: at * 30, what: "change", feel: "", sound: "" }));
  const fakeReasoner = async (): Promise<SoundPlan> => ({ additions: [], effects: moments.map((m) => ({ moment: m.id, name: "impact", level: 0, why: "support" })), music: [{ moment: "m0", name: "focus", level: -5, why: "quiet start" }, { moment: "m2", name: "tension", level: -80, why: "leave room for reveal" }, { moment: "m3", name: "curious", level: -3, why: "release" }] });
  const { hits, music } = placements(await fakeReasoner(), moments, 30, 5);
  assert.deepEqual(hits.map((h) => h.at), [0, 3.2]);
  assert.ok(hits.every((h) => h.level === -18));
  assert.deepEqual(music.map((m) => [m.at, m.level]), [[0, -5], [1.5, -80], [3.2, -3]]);
  const filter = graph(hits, music, 5, "anull");
  assert.ok(filter.includes("volume=-80dB"));
  assert.ok(filter.includes("sidechaincompress"));
  assert.ok(filter.includes("afade=t=out"));
});

test("rejects invented moments and unsafe music plans", () => {
  const moments = collectMoments(project);
  assert.deepEqual(placements({ additions: [], effects: [{ moment: "missing", name: "pop", level: -20, why: "" }], music: [] }, moments, 30, 4).hits, []); // a cue on a missing moment is dropped
  const quiet = placements({ additions: [], effects: [], music: [] }, moments, 30, 4).music;
  assert.equal(quiet[0]!.at, 0); // a plan with no bed starts in silence instead of failing
  assert.equal(quiet[0]!.level, -80);
});
