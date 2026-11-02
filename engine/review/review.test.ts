import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RepairTicket } from "../core/types.ts";
import { BENCHMARK } from "./benchmark.ts";
import { learnerReview } from "./learner.ts";
import type { Ask, Part } from "./model.ts";
import { chunks, contentTiles, frameTimes, frozenSpans, sentenceAt, sentences, type MotionGrid } from "./moments.ts";
import { mergeTickets, passes, repairLoop, score } from "./review.ts";
import { compare, loadResults, runBenchmark, summarize, table } from "./scoreboard.ts";
import { fitScore, rowTickets, sequenceReview } from "./sequence.ts";
import { silentReview } from "./silent.ts";
import { truthReview } from "./truth.ts";
import type { Cut, Report, Scores, SentenceRow, Word } from "./types.ts";

const said = (s: string, gap = 0.5): Word[] => s.split(" ").map((text, i) => ({ text, start: i * gap, end: i * gap + gap * 0.8 }));

const cut = (words: Word[]): Cut => ({ id: "c", request: "r", topic: "t", video: "v.mp4", seconds: words.at(-1)!.end, words, script: words.map((w) => w.text).join(" "), sources: [] });

const pic: Part = { type: "input_image", image_url: "x" };
const clipPart: Part = { type: "input_video", video_url: "x" };

// A fake model: answers by call name, and records what each call was given.
function fake(answers: Record<string, unknown | ((c: any) => unknown)>) {
  const calls: any[] = [];
  const ask = (async (c: any) => {
    calls.push(c);
    const a = answers[c.name];
    if (a === undefined) throw new Error(`no fake for ${c.name}`);
    return typeof a === "function" ? (a as Function)(c) : a;
  }) as Ask;
  return { ask, calls };
}

const row = (id: string, o: Partial<SentenceRow> = {}): SentenceRow => ({ id, seen: "a picture", shown: "yes", gone: "", stale: "", competing: "", unreadable: "", severity: 1, ...o });

test("sentences end on punctuation and keep word ranges", () => {
  const list = sentences(said("One two. Three four five! Six?"));
  assert.deepEqual(list.map((s) => [s.first, s.last]), [[0, 1], [2, 4], [5, 5]]);
  assert.equal(list[1].text, "Three four five!");
});

test("a run-on is split so a finding can still land near its moment", () => {
  const list = sentences(said(Array(60).fill("word").join(" ")));
  assert.ok(list.length > 1);
  assert.ok(list.every((s) => s.to - s.from < 15));
});

test("chunks cover every sentence once and a short tail joins the last chunk", () => {
  const list = sentences(said(Array.from({ length: 30 }, (_, i) => `w${i} x y z.`).join(" ")));
  const c = chunks(list, 10);
  assert.deepEqual(c.flatMap((x) => x.sentences.map((s) => s.id)), list.map((s) => s.id));
  assert.ok(c.at(-1)!.to - c.at(-1)!.from >= 10 / 3);
});

test("frames are taken across a sentence and inside it", () => {
  const s = sentences(said("a b c d e f g h i j k l m n o p."))[0];
  const t = frameTimes(s);
  assert.ok(t.length >= 3);
  assert.ok(t[0] >= s.from && t.at(-1)! <= s.to);
});

test("sentenceAt finds the playing or nearest sentence", () => {
  const list = sentences(said("One two. Three four."));
  assert.equal(sentenceAt(list, 0.2).id, "s1");
  assert.equal(sentenceAt(list, 99).id, "s2");
});

const grid = (steps: number, active: (step: number, tile: number) => number): MotionGrid => ({
  fps: 2,
  rows: 2,
  cols: 2,
  change: Array.from({ length: steps }, (_, s) => [0, 1, 2, 3].map((t) => active(s, t))),
});

test("a moving caption does not hide a frozen picture", () => {
  const g = grid(40, (_, t) => (t === 3 ? 0.2 : 0));
  assert.deepEqual(contentTiles(g), [0, 1, 2]);
  const f = frozenSpans(g, said(Array(30).fill("w").join(" ")));
  assert.equal(f.length, 1);
  assert.ok(f[0].to - f[0].from >= 10);
});

test("a stillness nobody is talking over is not frozen", () => {
  assert.equal(frozenSpans(grid(40, () => 0), said("just three words")).length, 0);
});

test("a change in the picture ends a frozen stretch, and a moving camera says nothing", () => {
  const words = said(Array(40).fill("w").join(" "));
  assert.equal(frozenSpans(grid(40, (s) => (s % 6 === 0 ? 0.3 : 0)), words).length, 0);
  assert.equal(frozenSpans(grid(40, () => 0.1), words).length, 0);
});

test("fit is zero when the screen adds nothing, and a competing picture costs more than a blank", () => {
  const list = sentences(said("One two three. Four five six."));
  assert.equal(fitScore([row("s1"), row("s2")], list), 1);
  assert.equal(fitScore([row("s1", { shown: "no" }), row("s2", { shown: "no" })], list), 0);
  const shownOne = fitScore([row("s1"), row("s2", { shown: "no" })], list);
  const fights = fitScore([row("s1"), row("s2", { shown: "no", competing: "a boat" })], list);
  assert.ok(fights < shownOne);
});

test("lines that need nothing shown do not count against fit", () => {
  const list = sentences(said("One two three. Four five six."));
  assert.equal(fitScore([row("s1"), row("s2", { shown: "na" })], list), 1);
});

test("each sequence problem becomes a ticket on the right words, with no fix in it", () => {
  const list = sentences(said("One two three. Four five six."));
  const t = rowTickets([row("s2", { shown: "no", gone: "the equation", stale: "still the title", competing: "a boat", unreadable: "cut off", severity: 3 })], list);
  assert.deepEqual(t.map((x) => x.problem).sort(), ["competing", "frozen", "left_screen", "not_shown", "unreadable"]);
  assert.ok(t.every((x) => JSON.stringify(x.at) === JSON.stringify({ word: 3 }) && JSON.stringify(x.until) === JSON.stringify({ word: 5 })));
  assert.ok(t.every((x) => !("fix" in x)));
});

test("the sequence review carries the screen forward so it can see across time", async () => {
  const words = said(Array.from({ length: 12 }, (_, i) => `a${i} b c d e f g h i j k l m n o.`).join(" "));
  const { ask, calls } = fake({
    sequence: (c: any) => ({ rows: [], screen_claims: [{ sentence: "s1", text: "2+2=5" }], board: `board after call ${calls.length}` }),
  });
  const r = await sequenceReview(cut(words), { ask, grabFrame: () => pic });
  assert.ok(calls.length > 1);
  assert.match(calls[1].user[0].text, /board after call 1/);
  assert.equal(r.claims.length, calls.length);
});

test("sound-off viewer gets no words and no topic, and the grader sees no video", async () => {
  const words = said("Alpha beta gamma. Delta epsilon zeta.");
  const { ask, calls } = fake({
    "sound-off": { followed: [], lost: [{ second: 2, what: "why the shape moved" }], account: "a shape moved" },
    "sound-off-grade": { recovered: [{ id: "i1", score: 1, note: "" }, { id: "i2", score: 0, note: "" }] },
  });
  const r = await silentReview({ ...cut(words), topic: "SECRET", request: "SECRET" }, [{ id: "i1", sentence: "s1", idea: "alpha" }, { id: "i2", sentence: "s2", idea: "delta" }], { ask, silentClip: () => clipPart });
  const viewer = JSON.stringify(calls.filter((c) => c.name === "sound-off"));
  assert.ok(!viewer.includes("SECRET") && !viewer.includes("Alpha"));
  assert.ok(!JSON.stringify(calls.at(-1)).includes("input_video"));
  assert.equal(r.score, 0.5);
  assert.ok(r.tickets.some((t) => t.problem === "viewer_lost"));
  assert.ok(r.tickets.some((t) => t.problem === "idea_missing" && t.from === sentences(words)[1].from));
});

const quiz = { questions: [{ id: "q1", kind: "transfer" as const, question: "Q one", answer: "A" }, { id: "q2", kind: "why" as const, question: "Q two", answer: "B" }] };

// Grades depend on which notes were used, so each arm can be told apart.
function learnerFake() {
  return fake({
    "learner-notes-video": { notes: "VIDEO" },
    "learner-notes-narration": { notes: "AUDIO" },
    "learner-answer": (c: any) => ({ answers: [{ id: "q1", answer: c.user.includes("VIDEO") ? "bad" : c.user.includes("AUDIO") ? "good" : "not covered" }, { id: "q2", answer: "good" }] }),
    "learner-grade": (c: any) => ({
      grades: [{ id: "q1", score: c.user.includes("Given answer: good") && c.user.indexOf("Given answer: good") < c.user.indexOf("q2\n") ? 1 : 0, sentence: "s1" }, { id: "q2", score: 1, sentence: "s1" }],
    }),
  });
}

test("the learner answers from its notes alone, and every arm sits the same quiz", async () => {
  const { ask, calls } = learnerFake();
  const r = await learnerReview(cut(said("One two three.")), quiz, { ask, videoClip: () => clipPart, audioClip: () => clipPart, silentNotes: "SILENT" });
  const answers = calls.filter((c) => c.name === "learner-answer");
  assert.equal(answers.length, 4);
  assert.ok(answers.every((c) => typeof c.user === "string" && !c.user.includes("input_video")));
  assert.deepEqual(Object.keys(r.arms).sort(), ["audio", "nothing", "silent", "video"]);
  assert.equal(calls.find((c) => c.name.startsWith("learner-notes")).model, "muse-spark-1.2");
});

test("a question lost to the picture but passed on audio alone is the worst kind of ticket", async () => {
  const { ask } = learnerFake();
  const r = await learnerReview(cut(said("One two three.")), quiz, { ask, videoClip: () => clipPart, audioClip: () => clipPart });
  const t = r.tickets.find((x) => x.wrong.includes("Q one"))!;
  assert.equal(t.severity, 3);
  assert.match(t.wrong, /made this worse/);
  assert.ok(!r.tickets.some((x) => x.wrong.includes("Q two")));
});

test("shared arms are reused, not paid for again", async () => {
  const { ask, calls } = learnerFake();
  await learnerReview(cut(said("One two three.")), quiz, {
    ask,
    videoClip: () => clipPart,
    audioClip: () => clipPart,
    shared: { audio: { notes: "n", result: { score: 1, byQuestion: { q1: 1, q2: 1 } } }, nothing: { notes: "", result: { score: 0, byQuestion: {} } } },
  });
  assert.equal(calls.filter((c) => c.name === "learner-notes-narration").length, 0);
  assert.equal(calls.filter((c) => c.name === "learner-answer").length, 1);
});

test("truth: a flagged claim that fails a second look is not reported false", async () => {
  const words = said("One two three.");
  const { ask } = fake({
    truth: { checks: [{ n: 0, verdict: "contradicted", why: "wrong" }, { n: 1, verdict: "contradicted", why: "wrong too" }, { n: 2, verdict: "unsupported", why: "no source" }, { n: 3, verdict: "ok", why: "" }] },
    "truth-confirm": (c: any) => ({ reads: "x", wrong: c.user[0].text.includes("real") }),
  });
  const r = await truthReview(cut(words), [{ sentence: "s1", text: "real error" }, { sentence: "s1", text: "misread" }, { sentence: "s1", text: "odd fact" }, { sentence: "s1", text: "fine" }], { ask, bigFrame: () => pic });
  assert.equal(r.falseClaims, 1);
  assert.equal(r.unsupported, 1);
  assert.deepEqual(r.tickets.map((t) => t.problem).sort(), ["false_claim", "unsupported_claim"]);
});

test("truth logs reach the checker, and repeated claims are checked once", async () => {
  const { ask, calls } = fake({ truth: { checks: [] } });
  await truthReview({ ...cut(said("One.")), truth: [{ type: "visit", node: "Z" }] }, [{ sentence: "s1", text: "A" }, { sentence: "s1", text: "a " }], { ask, bigFrame: () => pic });
  assert.match(calls[0].user, /"node":"Z"/);
  assert.equal(calls[0].user.match(/^\d+: /gm).length, 1);
});

test("truth with nothing on screen makes no call", async () => {
  const { ask, calls } = fake({});
  assert.equal((await truthReview(cut(said("One.")), [], { ask, bigFrame: () => pic })).tickets.length, 0);
  assert.equal(calls.length, 0);
});

const ticket = (o: Partial<RepairTicket>): RepairTicket => ({ reviewer: "sequence", problem: "not_shown", at: { word: 0 }, until: { word: 1 }, from: 0, to: 1, said: "a", seen: "", wrong: "w", severity: 1, ...o });

test("touching tickets of one kind merge, keeping the worst severity, and severe ones come first", () => {
  const m = mergeTickets([ticket({ from: 0, to: 2, said: "a" }), ticket({ from: 2.5, to: 4, said: "b", severity: 2, until: { word: 9 } }), ticket({ from: 30, to: 31 }), ticket({ problem: "false_claim", reviewer: "truth", from: 20, to: 21, severity: 3 })]);
  assert.equal(m.length, 3);
  assert.equal(m[0].problem, "false_claim");
  assert.equal(m[1].to, 4);
  assert.equal(m[1].severity, 2);
  assert.deepEqual(m[1].until, { word: 9 });
});

test("score is a plain mean, and truth errors block a pass however good the mean", () => {
  const s = score({ silent: { score: 0.6 } as any, learner: { arms: { video: { score: 0.9, byQuestion: {} } } } as any, sequence: { fit: 0.6 } as any, truth: { falseClaims: 1 } as any, tickets: [] });
  assert.ok(Math.abs(s.overall - 0.7) < 1e-9);
  assert.equal(passes(s), false);
});

const scores = (overall: number, truthErrors = 0, worst = 0): Scores => ({ overall, soundOff: overall, learned: overall, audioAlone: 0.5, nothing: 0, fit: overall, truthErrors, worst, tickets: 0 });
const report = (s: Scores): Report => ({ cut: "c", request: "r", at: "", usd: 0.1, scores: s, tickets: [ticket({})] });

test("repair loop stops on a pass", async () => {
  const seen: number[] = [];
  const r = await repairLoop({ first: 0, review: async (v) => report(v === 0 ? scores(0.3, 0, 2) : scores(0.8)), repair: async (v, t) => (seen.push(t.length), v + 1) });
  assert.equal(r.best, 1);
  assert.equal(r.history.length, 2);
  assert.deepEqual(seen, [1]);
});

test("repair loop keeps the earlier version if a repair made things worse", async () => {
  const r = await repairLoop({ first: 0, review: async (v) => report(v === 0 ? scores(0.5, 0, 1) : scores(0.4, 0, 1)), repair: async (v) => v + 1, rounds: 3 });
  assert.equal(r.best, 0);
  assert.equal(r.history.length, 2);
});

test("repair loop stops after its rounds", async () => {
  const r = await repairLoop({ first: 0, review: async (v) => report(scores(0.1 + v / 10, 0, 1)), repair: async (v) => v + 1, rounds: 2 });
  assert.equal(r.best, 2);
  assert.equal(r.history.length, 3);
});

test("the benchmark holds 100 distinct requests across every kit", () => {
  assert.equal(BENCHMARK.length, 100);
  assert.equal(new Set(BENCHMARK.map((r) => r.id)).size, 100);
  assert.equal(new Set(BENCHMARK.map((r) => r.prompt)).size, 100);
  for (const k of ["math", "algorithms", "code", "ml", "science", "history", "economics", "language"]) assert.ok(BENCHMARK.filter((r) => r.kit === k).length >= 7, k);
});

test("runner resumes, records failures, and does not score what it could not make", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-"));
  try {
    const requests = BENCHMARK.slice(0, 4);
    const reviewed: string[] = [];
    const go = (fail: boolean) =>
      runBenchmark({
        version: "v",
        dir,
        requests,
        make: async (r) => {
          if (r === requests[1]) return null;
          if (fail && r === requests[2]) throw new Error("render broke");
          return cut(said("One."));
        },
        review: async (_, r) => (reviewed.push(r.id), report(scores(0.5))),
      });
    await go(true);
    assert.equal(reviewed.length, 2);
    assert.equal(summarize(loadResults(dir, "v")).failed, 1);
    await go(false);
    assert.equal(reviewed.length, 3);
    const s = summarize(loadResults(dir, "v"));
    assert.equal(s.run, 3);
    assert.equal(s.failed, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runner stops when told to", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-"));
  try {
    let n = 0;
    await runBenchmark({ version: "v", dir, requests: BENCHMARK.slice(0, 5), make: async () => cut(said("One.")), review: async () => report(scores(0.5)), stopped: () => (n++ >= 2 ? "cap" : null) });
    assert.equal(loadResults(dir, "v").entries.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compare uses shared requests only, ignores noise, and flags new truth errors", () => {
  const e = (id: string, s: Scores) => ({ id, kit: "math" as const, scores: s });
  const a = { version: "a", entries: [e("1", scores(0.5)), e("2", scores(0.5)), e("3", scores(0.5)), e("4", scores(0.9))] };
  const b = { version: "b", entries: [e("1", scores(0.8)), e("2", scores(0.52)), e("3", scores(0.51, 1)), { id: "5", kit: "math" as const, scores: scores(1) }] };
  const c = compare(a, b);
  assert.equal(c.shared, 3);
  assert.deepEqual(c.better, ["1"]);
  assert.deepEqual(c.worse, ["3"]);
  assert.deepEqual(c.onlyBefore, ["4"]);
});

test("the scoreboard prints a row per version", () => {
  const t = table([summarize({ version: "v1", entries: [{ id: "1", kit: "math", scores: { ...scores(0.5), learned: 0.7 } }, { id: "2", kit: "math", failed: "x" }] })]);
  assert.match(t, /\| v1 \| 1 \| 1 \| 0\.50 \| 0\.50 \| 0\.70 \| 0\.50 \| 100% \|/);
});
