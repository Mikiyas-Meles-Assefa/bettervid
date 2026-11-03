// The review round after the look (scene.ts reviewRound) and the instrument notes it hands on (lib/instrument-notes.ts).
// Scenes are built for real with a fake theme; every model call and render is a stand-in, so nothing is spent.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "../../engine/language/build.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import { viewingFrom } from "../../engine/design/suggest.ts";
import type { Project } from "../../schemas/project.ts";
import { frameReadings, partNotes, placeOf } from "../lib/instrument-notes.ts";
import { check, REVIEW_ROUNDS, reviewRound, type Job, type ReviewCalls, type Seen, type Written } from "./scene.ts";

const words = Array.from({ length: 20 }, (_, i) => ({ text: i === 6 ? "beta" : `w${i}`, start: i * 0.5 }));
const ctx = { fps: 30, width: 1080, height: 1920, frames: 330, theme: themeFrom("whiteboard"), words };
const viewing = viewingFrom({ width: 1080, height: 1920, fps: 30, screen: "phone in a feed", frameWidthMm: 70, distanceMm: 300, watch: "glancing in a feed", captions: { show: true, box: [0, 1640 / 1920, 1, 1810 / 1920], why: "captions burned in" }, why: "test" });
const PART = `@0\ntext a "Alpha is the first idea" size=big\ntext tiny "small print nobody reads" size=small\n@6\ntext b "Beta"\n@12 keep\ntext c "Gamma arrives"\n`;
const BETTER = `@0\ntext a "Alpha is the first idea" size=big\n@6\ntext b "Beta"\n@12 keep\ntext c "Gamma arrives"\n`;

test("instrument notes say what, where on the frame, at what second and how much, with their settings", async () => {
  const r = await build(PART, { ctx, words: words.map((w) => w.text) });
  assert.deepEqual(r.problems, []);
  const n = partNotes({ scene: r.scene!, words, viewing, window: [0, 300] });
  const text = n.lines.join("\n");
  // Every instrument under its plain name, with the settings the viewing suggests and why.
  for (const title of ["Readability (legibility", "Where attention goes (salience", "Pace and change load (load", "Steadiness of things that stay (steadiness", "Timing against the voice (timing", "Fill and balance (fill"]) assert.ok(text.includes(title), title);
  assert.match(text, /readable 27.*glancing in a feed/);
  // The small print is named, placed on the frame and in time, with its size beside the setting.
  const small = n.lines.find((l) => l.includes("under 27 arcmin"));
  assert.ok(small, text);
  assert.match(small!, /tiny at \d+\.\d s: center \(x \d+-\d+%, y \d+-\d+%\)/);
  // Readings, never verdicts.
  assert.ok(!/\b(pass|fail|passed|failed)\b/i.test(text), text);
  const frame = frameReadings(r.scene!, viewing, 30);
  assert.match(frame, /attention \(salience\): /);
  assert.match(frame, /text "small print nobody reads" \(tiny\) center .*cap height \d+ arcmin \(readable set at 27\), contrast [\d.]+:1/);
  assert.equal(placeOf({ x0: 0, y0: 0, x1: 300, y1: 200 }, 1080, 1920), "top left (x 0-28%, y 0-10%)");
});

// A job for one part covering the whole of the words, with a fake project.
function job(folder: string): Job {
  const p = { input: { prompt: "a short video for a phone feed", style: "whiteboard" }, narration: { words, seconds: 10 } } as unknown as Project;
  return { p, range: { id: "s1", firstWord: 0, lastWord: 19 }, carry: [], handoff: [], system: "SYSTEM", request: "REQUEST", opts: { ctx, words: words.map((w) => w.text), holds: [] }, folder, log: () => {}, review: true };
}

async function written(j: Job, source: string): Promise<Written> {
  const c = await check(j, source);
  return { source, result: c.result, problems: c.problems, warnings: [...c.warnings, ...c.notes], usd: 0, rounds: 1 };
}

// Stand-ins: stills are placeholder files, the reviewer names one issue while `issues` says so, the writer answers from
// `replies`, and the gate keeps a repair while `keep` says so. Every call is recorded.
function fakes(j: Job, o: { issues: (round: number) => boolean; replies: string[]; keep: boolean }) {
  const calls = { review: 0, write: [] as string[], gate: 0 };
  const c: ReviewCalls = {
    see: async (_w, folder) => {
      const file = join(folder, "00030.jpg");
      writeFileSync(file, "jpeg");
      return { moments: [{ frame: 30, why: "settled", words: "w0 w1" }, { frame: 200, why: "settled", words: "w12" }], files: [file, file], measured: [{ frame: 30, findings: [], words: ["Alpha"] }, { frame: 200, findings: [], words: ["Gamma"] }] } satisfies Seen;
    },
    review: async () => {
      calls.review++;
      const issues = o.issues(calls.review) ? [{ frames: [1], kind: "readability" as const, what: "the small print in the middle is too small to read at a glance", want: "only words the viewer can read", severity: 2 as const }] : [];
      return { judged: { issues, design: 3, designNote: "plain" }, usd: 0.01 };
    },
    write: async (user) => {
      calls.write.push((user as { type: string; text?: string }[]).filter((x) => x.type === "input_text").map((x) => x.text).join("\n"));
      return { value: o.replies[calls.write.length - 1] ?? o.replies.at(-1)!, usd: 0.02 };
    },
    compose: (reply) => written(j, reply),
    gate: async () => {
      calls.gate++;
      return { keep: o.keep, usd: 0, why: "stand-in" };
    },
  };
  return { c, calls };
}

test("the instruments' notes and the reviewer's issues reach the writer, and a better repair is kept", async () => {
  const j = job(mkdtempSync(join(tmpdir(), "review-")));
  const start = await written(j, PART);
  const { c, calls } = fakes(j, { issues: (n) => n === 1, replies: [BETTER], keep: true });
  const r = await reviewRound(j, start, c);
  assert.equal(r.w.source, BETTER);
  assert.deepEqual(r.log, ["repaired", "fine"]);
  assert.equal(calls.write.length, 1);
  const asked = calls.write[0]!;
  assert.match(asked, /^REQUEST/);
  assert.match(asked, /the small print in the middle is too small/);
  assert.match(asked, /Readability \(legibility; settings: readable 27/);
  assert.match(asked, /tiny at \d+\.\d s: center/);
  assert.match(asked, /Instruments on this frame:\nattention \(salience\)/);
  assert.ok(r.usd > 0.02);
});

test("a repair that does not build is not kept, and the gate is never asked", async () => {
  const j = job(mkdtempSync(join(tmpdir(), "review-")));
  const start = await written(j, PART);
  const { c, calls } = fakes(j, { issues: () => true, replies: [`@3\ntext a "starts on the wrong word"\n`], keep: true });
  const r = await reviewRound(j, start, c);
  assert.equal(r.w, start);
  assert.equal(calls.gate, 0);
  assert.deepEqual(r.log, ["repair did not build, kept before"]);
});

test("a repair the gate finds worse is not kept", async () => {
  const j = job(mkdtempSync(join(tmpdir(), "review-")));
  const start = await written(j, PART);
  const { c, calls } = fakes(j, { issues: () => true, replies: [BETTER], keep: false });
  const r = await reviewRound(j, start, c);
  assert.equal(r.w.source, PART);
  assert.equal(calls.gate, 1);
  assert.deepEqual(r.log, ["repair not better, kept before"]);
});

test("review rounds are bounded even when the reviewer always finds something", async () => {
  const j = job(mkdtempSync(join(tmpdir(), "review-")));
  const start = await written(j, PART);
  const replies = Array.from({ length: REVIEW_ROUNDS + 3 }, (_, k) => BETTER.replace("Beta", `Beta ${k + 1}`));
  const { c, calls } = fakes(j, { issues: () => true, replies, keep: true });
  const r = await reviewRound(j, start, c);
  assert.equal(calls.write.length, REVIEW_ROUNDS);
  assert.equal(calls.review, REVIEW_ROUNDS);
  assert.equal(r.w.source, replies[REVIEW_ROUNDS - 1]);
  assert.deepEqual(r.log, Array(REVIEW_ROUNDS).fill("repaired"));
});

test("a writer that returns its part unchanged ends the round without a build or a gate", async () => {
  const j = job(mkdtempSync(join(tmpdir(), "review-")));
  const start = await written(j, PART);
  const { c, calls } = fakes(j, { issues: () => true, replies: [PART], keep: true });
  const r = await reviewRound(j, start, c);
  assert.equal(r.w, start);
  assert.equal(calls.gate, 0);
  assert.deepEqual(r.log, ["the writer kept it as it was"]);
});
