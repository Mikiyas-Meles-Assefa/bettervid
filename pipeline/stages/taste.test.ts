import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project } from "../../schemas/project.ts";
import type { AskCall } from "../../engine/review/model.ts";
import { meansOf, spreadOf, tasteContext, tasteFor, tasteVerdictFor, type Job, type Seen } from "./scene.ts";

const p = {
  id: "t",
  input: { prompt: "how a lock works", style: "neon", persona: "auto", mode: "explain", seconds: 0 },
  plan: { intent: "curious about everyday machines" },
  narration: { words: ["Turn", "the", "key", "and", "the", "pins", "line", "up."].map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.3, beatId: "b1" })), seconds: 4, holds: [] },
  direction: { goal: "see why only one key opens it", promise: "", arc: "", cues: [], events: [{ id: "e1", firstWord: 0, lastWord: 7, job: "show the pins lining up", knows: "", waiting: "", look: "the pins", feel: "", rhythm: "short" }] },
} as unknown as Project;
const job = { p, range: { id: "s1", firstWord: 0, lastWord: 7 } } as unknown as Job;
const fixture = new URL("../../engine/design/depict/fixtures/lamp.png", import.meta.url).pathname;
const seen = { moments: [{ frame: 30, why: "settled", words: "" }, { frame: 75, why: "changing", words: "" }], files: [fixture, fixture], measured: [] } as unknown as Seen;

test("the taste review sees the part's stills with its words, purpose, intent, style and platform, and its fixes become notes", async () => {
  const calls: AskCall[] = [];
  const ask = async <T>(c: AskCall): Promise<T> => (calls.push(c), { verdict: "revise", weakest: "the pins are too small", fixes: ["make the pins fill the frame"], reason: "the eye cannot find them" } as T);
  const notes = await tasteFor(job, seen, ask);
  assert.equal(calls.length, 1, "one call, not a round");
  assert.equal(calls[0]!.model, "muse-spark-1.3");
  const parts = calls[0]!.user as { type: string; text?: string }[];
  const head = parts[0]!.text!;
  assert.match(head, /Turn the key and the pins line up\./);
  assert.match(head, /show the pins lining up/);
  assert.match(head, /curious about everyday machines/);
  assert.match(head, /Style: neon; palette/);
  assert.match(head, /Plays on:/);
  assert.equal(parts.filter((x) => x.type === "input_image").length, 2);
  assert.match(parts.find((x) => x.text?.startsWith("At 1.5"))!.text!, /At 1\.5 s/);
  assert.deepEqual(notes, ["Art director: the weakest element is the pins are too small. the eye cannot find them", "Art director fix: make the pins fill the frame"]);
  const ship = await tasteFor(job, seen, async <T>() => ({ verdict: "ship", weakest: "", fixes: [], reason: "" }) as T);
  assert.deepEqual(ship, []);
  assert.ok(tasteContext(job).style.fonts!.length);
});

test("the art director is told the writer's means, the instruments' readings per frame, and on a check the fixes asked for", async () => {
  const calls: AskCall[] = [];
  const ask = async <T>(c: AskCall): Promise<T> => (calls.push(c), { verdict: "ship", weakest: "", fixes: [], reason: "" } as T);
  await tasteVerdictFor(job, seen, ask, (k) => `fill: largest 0.0${k + 1}`, ["make the pins fill the frame"]);
  const parts = calls[0]!.user as { type: string; text?: string }[];
  const head = parts[0]!.text!;
  assert.match(head, /What the scene's writer can do/);
  assert.match(head, /camera ID zoom=N/);
  assert.match(head, /sort, a computed thing/);
  assert.match(head, /These fixes were asked for[\s\S]*- make the pins fill the frame/);
  assert.match(parts.find((x) => x.text?.startsWith("At 1.5"))!.text!, /What the instruments read on this frame:\nfill: largest 0.02/);
  // The means come from the language and the kits, not from a list: every arrangement and command is named.
  const means = meansOf().join("\n");
  for (const word of ["stage", "board", "light", "dim", "drop", "huge", "note"]) assert.match(means, new RegExp(`\\b${word}\\b`));
});

test("frames spread over a part are evenly spaced, numbered from 1, and never repeat", () => {
  const of = (n: number) => ({ moments: Array.from({ length: n }, (_, k) => ({ frame: k * 10, why: "", words: "" })) }) as unknown as Seen;
  assert.deepEqual(spreadOf(of(3), 4), [1, 2, 3]);
  assert.deepEqual(spreadOf(of(10), 4), [1, 4, 7, 10]);
  assert.deepEqual(spreadOf(of(2), 5), [1, 2]);
});

test("a repair that answers with only the states it changes is merged into the part it repairs", async () => {
  const { mergeReply } = await import("./scene.ts");
  const base = `bg paper\nprogram spin n=3 doc="spins"\n  text("a", { text: "x" });\nend\n@0\n  text t "one" size=big\n@4 keep\n  light t\n@9\n  text u "two" size=big\n@h2 keep\n  dim u`;
  // One state replaced, one added, one removed; the program and the rest stay.
  const merged = mergeReply(base, "@4 keep\n  light t\n  camera t zoom=2\n@6 keep\n  dim t\n@9 remove");
  assert.equal(merged, `bg paper\nprogram spin n=3 doc="spins"\n  text("a", { text: "x" });\nend\n@0\n  text t "one" size=big\n@4 keep\n  light t\n  camera t zoom=2\n@6 keep\n  dim t\n@h2 keep\n  dim u`);
  // A whole part answered is taken as it is, and an answer with no state goes through untouched for the build to judge.
  assert.equal(mergeReply(base, base), base);
  assert.equal(mergeReply(base, "I cannot do this"), "I cannot do this");
  // A changed program replaces the one with its name.
  assert.match(mergeReply(base, 'program spin n=5 doc="spins"\n  text("a", { text: "y" });\nend\n@0\n  text t "uno" size=big'), /n=5[\s\S]*"uno"[\s\S]*@4 keep/);
});

test("a part that will not build ships what of it does build: failing lines cut, never rewritten", async () => {
  const { salvagePart, sceneBuildOptions } = await import("./scene.ts");
  const opts = sceneBuildOptions({ ...p, input: { ...p.input, sceneAuthor: "language" } } as Project);
  const good = "@0\n  text a \"Turn the key\" size=big\n@3 keep\n  text b \"pins line up\" size=normal";
  const r1 = await salvagePart(good, opts);
  assert.equal(r1.source, good);
  assert.deepEqual(r1.cut, []);
  // One bad line: only it goes.
  const bad = "@0\n  text a \"Turn the key\" size=big\n  frobnicate a\n@3 keep\n  text b \"pins line up\" size=normal";
  const r2 = await salvagePart(bad, opts);
  assert.doesNotMatch(r2.source, /frobnicate/);
  assert.match(r2.source, /Turn the key[\s\S]*pins line up/);
  assert.equal(r2.cut.length, 1);
});
