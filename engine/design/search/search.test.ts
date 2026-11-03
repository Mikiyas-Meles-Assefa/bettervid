import assert from "node:assert/strict";
import { test } from "node:test";
import { themeFrom } from "../../render/theme.ts";
import type { DesignerAnswer, ViewerAnswer } from "../agents/api.ts";
import { parseIntent } from "../intent/parse.ts";
import { suggestDesign, viewingFrom } from "../suggest.ts";
import type { AgentTask, Answer, Goal, Reasoner } from "../types.ts";
import { composeCached, evaluate, layoutReading, newCache, windowOf } from "./evaluate.ts";
import { budgetFor, cameraPlans, generate, onScreen, rng, sampleSpace, viewOf } from "./generate.ts";
import { runSearch } from "./run.ts";
import { missOf, scoreCandidate } from "./score.ts";
import { sheetFrames } from "./sheet.ts";
import { keepDirector, roundOf, standInAgents } from "./stand-in.ts";

const theme = themeFrom("flat");
const words = Array.from({ length: 50 }, (_, i) => ({ text: `w${i}`, start: 0.2 + i * 0.4 }));
const frames = 21 * 30;
const plan = parseIntent(`thing a "first words"
thing b "other words"
object jug "a glass jug of water"
object bowl "a glass bowl"

@0
  show a
@10
  show bowl
  keep jug
@20
  show bowl
  jug pours into bowl slow
@32
  show b
  keep a
`);
const viewing = viewingFrom({ width: 1080, height: 1920, fps: 30, screen: "phone", frameWidthMm: 65, distanceMm: 300, watch: "on purpose", why: "test" });
const base = () => suggestDesign(plan, viewing, theme, [], words);
const ctx = () => ({ plan, compose: { theme, words, frames }, cache: newCache() });
const goal = (k: number, o: Partial<Goal>): Goal => ({ id: "g", scope: "moment", moment: k, says: "", instrument: "layout", value: "area.anchor", want: { min: 0.5 }, weight: 1, why: "", ...o });

test("a miss is 0 inside the band and grows with the band's own size", () => {
  assert.equal(missOf(0.5, { min: 0.3, max: 0.7 }), 0);
  assert.ok(Math.abs(missOf(0.2, { min: 0.3, max: 0.7 }) - 0.25) < 1e-9);
  assert.ok(Math.abs(missOf(0.2, { min: 0.3 }) - 1 / 3) < 1e-9);
  assert.equal(missOf(0, { max: 0 }), 0);
  assert.equal(missOf(2, { max: 0 }), 1);
  assert.equal(missOf(5, { near: 4 }), 0.25);
  assert.equal(missOf(NaN, { min: 0 }), 1);
  const s = scoreCandidate([goal(0, { id: "x", weight: 1 }), goal(0, { id: "y", value: "nope", weight: 3 })], [{ instrument: "layout", values: { "area.anchor": 0.5 }, notes: [] }]);
  assert.equal(s.total, 0.75);
  assert.deepEqual(s.unmeasured.length, 1);
});

test("a small space is tried in full, a large one as a Latin hypercube that covers every value", () => {
  const md = base().moments[1]!;
  const small = sampleSpace(md, { subjectScale: [0.6, 0.8], arrangement: ["stack", "row"] }, 8, "s");
  assert.equal(small.sets.length, 4);
  const big = sampleSpace(md, { subjectScale: [0.5, 0.6, 0.7, 0.8], typeScale: [0.9, 1, 1.1, 1.2], lead: [0, 0.2, 0.4, 0.6] }, 8, "s");
  assert.equal(big.sets.length, 8);
  for (const v of [0.5, 0.6, 0.7, 0.8]) assert.ok(big.sets.some((s) => s.subjectScale === v));
  assert.deepEqual(sampleSpace(md, { subjectScale: [0.5, 0.6, 0.7, 0.8], typeScale: [0.9, 1, 1.1, 1.2], lead: [0, 0.2] }, 8, "s").sets, sampleSpace(md, { subjectScale: [0.5, 0.6, 0.7, 0.8], typeScale: [0.9, 1, 1.1, 1.2], lead: [0, 0.2] }, 8, "s").sets);
  const bad = sampleSpace(md, { supportOpacity: [2, 0.5], camera: [{ zoom: 1.4 }] }, 4, "s");
  assert.ok(bad.notes.some((n) => n.includes("supportOpacity")));
  assert.equal((bad.sets.find((s) => s.camera) as { camera: { move: string } } | undefined)?.camera.move, md.camera.value.move, "a partial camera keeps the rest of the current one");
  const r = rng("x");
  assert.equal(rng("x")(), r());
});

test("the budget is shared by importance and every moment gets at least two candidates", () => {
  const d = base();
  d.budget.candidatesPerMoment = 6;
  d.moments[2]!.importance.value = 1;
  d.moments[0]!.importance.value = 0.1;
  assert.ok(budgetFor(d, 2) > budgetFor(d, 0));
  assert.ok(budgetFor(d, 0) >= 2);
});

test("a view puts a box in the middle of the usable frame and keeps it on screen", () => {
  const b: [number, number, number, number] = [0.6, 0.6, 0.8, 0.7];
  const v = viewOf(b, [0.06, 0.06, 0.94, 0.94], 1)!;
  assert.ok(v.zoom > 1);
  const s = onScreen(b, v);
  assert.ok(s[0] >= -1e-3 && s[1] >= -1e-3 && s[2] <= 1 + 1e-3 && s[3] <= 1 + 1e-3);
  assert.equal(viewOf([0, 0, 1, 1], [0, 0, 1, 1], 1), undefined);
});

test("generators give packer, camera and timing options; no camera moves while things change", () => {
  const d = base();
  const c = composeCached(plan, d, ctx());
  const g = generate(2, {}, 30, { plan, design: d, words, theme, boxes: c.boxes });
  const sources = new Set(g.candidates.map((x) => x.source));
  for (const s of ["current", "packer", "timing"]) assert.ok(sources.has(s as never), s);
  const cams = cameraPlans(2, { plan, design: d, words, theme, boxes: c.boxes });
  assert.ok(cams.every((x) => !["push", "follow", "drift"].includes((x.set.camera as { move: string }).move)), "moment 2 pours: no camera move during it");
  assert.equal(new Set(g.candidates.map((x) => JSON.stringify(x.design))).size, g.candidates.length, "candidates are distinct");
});

test("evaluation composes each candidate into the video, measures its window and ranks by miss", () => {
  const d = base();
  const c = ctx();
  const comp = composeCached(plan, d, c);
  const w = windowOf(plan, d, words, 1, frames);
  assert.ok(w[0] < w[1] && w[1] <= frames);
  const lr = layoutReading(comp, plan, 1);
  assert.ok((lr.values["area.anchor"] ?? 0) > 0);
  const g = generate(1, { subjectScale: [0.3, 1] }, 6, { plan, design: d, words, theme, boxes: comp.boxes });
  const want = lr.values["area.anchor"]! * 1.3;
  const ev = evaluate(d, 1, g.candidates, [goal(1, { want: { min: want } }), goal(1, { id: "h", instrument: "legibility", value: "minAngle", want: { min: 1 }, weight: 0.2 })], c);
  assert.equal(ev.ranked.length, g.candidates.length);
  for (let i = 1; i < ev.ranked.length; i++) assert.ok(ev.ranked[i - 1]!.total <= ev.ranked[i]!.total);
  assert.ok(ev.ranked[0]!.total <= ev.ranked.find((x) => x.source === "current")!.total);
  assert.ok(ev.ranked.every((x) => x.scores.length === 2 && x.ms >= 0));
  const again = evaluate(d, 1, g.candidates, [goal(1, { want: { min: want } })], c);
  assert.ok(again.ranked.length === g.candidates.length);
});

/** A Reasoner answering from a function; undefined leaves the task pending. */
function memory(answer: (t: AgentTask) => unknown): Reasoner & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async ask<T>(t: AgentTask): Promise<Answer<T>> {
      asked.push(t.id);
      const v = answer(t);
      return v === undefined ? { status: "pending", file: `${t.id}.md` } : { status: "answered", value: v as T };
    },
  };
}

test("the loop asks the designer, searches, takes the designer's pick and records the decision", async () => {
  const d = base();
  d.moments[1]!.importance.value = 0.9;
  const answers = (t: AgentTask): DesignerAnswer | undefined => {
    const k = Number(t.id.match(/\.m(\d+)\./)![1]);
    const r = Number(t.id.match(/\.r(\d+)$/)![1]);
    if (r === 1) return { goals: [{ ...goal(k, { id: "big", want: { min: 0.4 } }) }], space: { subjectScale: [0.5, 1] }, overrides: [], proposals: [], done: false, why: "the bowl must read" };
    const m = t.request.match(/^- (m\d+\.r1\.c\d+): total/m);
    return { goals: [{ ...goal(k, { id: "big", want: { min: 0.4 } }) }], space: {}, overrides: [], proposals: [], pick: m![1], done: true, why: "the best of round one" };
  };
  const r = await runSearch({ plan, design: d, director: keepDirector(d, "test"), cards: [], words, holds: [], theme, frames, agents: standInAgents(), reasoner: memory(answers), dir: "/tmp/unused", only: [1] });
  assert.equal(r.status, "done");
  const o = r.moments.find((m) => m.moment === 1)!;
  assert.equal(o.status, "done");
  assert.equal(o.pick?.by, "designer");
  assert.equal(r.calls, 2);
  const rec = r.design.decisions.find((x) => x.area === "search" && x.moment === 1)!;
  assert.ok(rec.goals.includes("m1.big"));
  assert.ok(r.design.goals.some((g) => g.id === "m1.big" && g.moment === 1));
});

test("an unanswered task stops the run as pending; the call budget leaves the least important moments as they are", async () => {
  const d = base();
  d.budget = { candidatesPerMoment: 3, rounds: 1, calls: 2 };
  d.moments.forEach((m, i) => (m.importance.value = [0.2, 0.9, 0.5, 0.1][i]!));
  const done = (t: AgentTask): DesignerAnswer => ({ goals: [goal(Number(t.id.match(/\.m(\d+)\./)![1]), {})], space: {}, overrides: [], proposals: [], done: true, why: "" });
  const pend = await runSearch({ plan, design: d, director: keepDirector(d, "t"), cards: [], words, holds: [], theme, frames, agents: standInAgents(), reasoner: memory(() => undefined), dir: "/tmp/unused" });
  assert.equal(pend.status, "pending");
  assert.equal(pend.pending.length, 1);
  assert.equal(pend.moments.find((m) => m.status === "pending")?.moment, 1, "the most important moment is asked first");
  const r = await runSearch({ plan, design: d, director: keepDirector(d, "t"), cards: [], words, holds: [], theme, frames, agents: standInAgents(), reasoner: memory(done), dir: "/tmp/unused" });
  assert.equal(r.status, "done");
  assert.deepEqual(r.moments.filter((m) => m.status === "done").map((m) => m.moment).sort(), [1, 2]);
  assert.ok(r.moments.filter((m) => m.status === "skipped").every((m) => m.why.includes("calls")));
});

test("the viewer panel's pick and fixes are measured and kept", async () => {
  const d = base();
  d.budget = { candidatesPerMoment: 4, rounds: 1, calls: 4 };
  const reasoner = memory((t) => {
    if (t.role === "designer") return { goals: [goal(1, {})], space: { subjectScale: [0.5, 0.9] }, overrides: [], proposals: [], done: true, why: "" } satisfies DesignerAnswer;
    const ids = t.request.match(/Candidates: (.*)\./)![1]!.split(", ");
    return { seats: [{ who: "a scroller", candidate: ids.at(-1)!, saw: "the bowl", remembers: "the bowl", problems: [], wouldKeepWatching: true }], pick: ids.at(-1)!, fixes: [{ candidate: ids.at(-1)!, field: "supportOpacity", value: 0.4, why: "the jug competes" }] } satisfies ViewerAnswer;
  });
  const stills = { async stills(_s: unknown, fs: number[], _d: string, tag: string) { return fs.map((f) => `${tag}-${f}.jpg`); } };
  const joined: string[][] = [];
  const join = (rows: { label: string; files: string[] }[], _t: string[], out: string) => (joined.push(rows.map((x) => x.label)), out);
  const r = await runSearch({ plan, design: d, director: keepDirector(d, "t"), cards: [], words, holds: [], theme, frames, agents: standInAgents(), reasoner, dir: "/tmp/unused", only: [1], viewers: true, stills, sheet: { finalists: 3, frames: 2, join } });
  assert.equal(r.status, "done");
  assert.equal(joined.length, 1);
  assert.equal(joined[0]!.length, 3);
  const o = r.moments.find((m) => m.moment === 1)!;
  assert.equal(o.pick?.by, "viewer");
  assert.ok(o.pick?.id.includes(".v0"), "the viewer's fix of its pick is kept");
  assert.equal(r.design.moments[1]!.supportOpacity.value, 0.4);
  assert.equal(r.design.moments[1]!.supportOpacity.from, "viewer");
  assert.equal(roundOf({ round: { candidates: [{ id: "m1.r2.c3" } as never], readings: [] } }), 3);
});

test("sheet frames spread over the window and end on its last frame", () => {
  assert.deepEqual(sheetFrames([0, 90], 3), [15, 45, 89]);
  assert.deepEqual(sheetFrames([10, 11], 3), [10]);
});
