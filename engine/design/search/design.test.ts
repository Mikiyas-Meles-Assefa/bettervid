// runDesign with fake agents and a fake reasoner: pending and resume, the director's repair and corrections as visible
// notes, the depicter's specs reaching every composition, and moments searched side by side.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { themeFrom } from "../../render/theme.ts";
import type { DesignerAnswer, DirectorAnswer } from "../agents/api.ts";
import { applyCorrections } from "../agents/director.ts";
import { compose } from "../compose/compose.ts";
import type { PropSpec } from "../depict/spec.ts";
import { parseIntent } from "../intent/parse.ts";
import { suggestDesign, viewingFrom } from "../suggest.ts";
import type { AgentTask, Answer, Reasoner } from "../types.ts";
import { runDesign, type DesignAgents, type DesignInputs } from "./design.ts";
import type { Repair } from "./settle.ts";
import { standInAgents } from "./stand-in.ts";

const theme = themeFrom("flat");
const words = Array.from({ length: 30 }, (_, i) => ({ text: `w${i}`, start: 0.2 + i * 0.4 }));
const plan = parseIntent(`thing drop "a drop of ten metres"
object ball "a red rubber ball, about 7 cm across"

@0
  show drop
@10
  show ball
  ball falls slow
`);
const viewing = viewingFrom({ width: 1080, height: 1920, fps: 30, screen: "phone", frameWidthMm: 65, distanceMm: 300, watch: "on purpose", why: "test" });
const inputs: DesignInputs = { plan, words, holds: [], frames: 13 * 30, cards: [], requirements: [], assets: {}, brief: "A test video.", theme, styleName: "flat", viewing };

const BALL: PropSpec = { kind: "body", form: "sphere", label: "red rubber ball", size: { w: 7, h: 7, unit: "cm" }, colors: { body: "#c0392b" }, colorSources: { body: "the description: 'a red rubber ball'" }, verbs: { falls: { like: "falls" } }, tier: 1, why: "a sphere at its real size" };

const director = (why: string): DirectorAnswer => ({
  viewing,
  tempo: { value: 1, why: "as the style" },
  moments: [
    { moment: 0, importance: 0.4, know: "how far it drops" },
    { moment: 1, importance: 1, know: "the ball falls" },
  ],
  demos: [],
  goals: [],
  overrides: [],
  budget: { candidatesPerMoment: 3, rounds: 2, calls: 6 },
  corrections: [{ moment: 0, was: "ten metres", now: "twelve metres", source: "the user's notes say twelve" }],
  seats: [],
  why,
});

/** The stand-in designer and viewer with a director that has a repair round and a check, and the real corrections. */
const agents: DesignAgents = {
  ...standInAgents(),
  directorTask: (input, repair?: Repair) => ({ role: "director", id: repair ? `director.r${repair.round}` : "director", system: "direct", request: `${input.brief} ${input.start.moments.length} moments`, ...(repair ? { images: [] } : {}) }),
  checkDirector: (_input, a) => (a.why === "careless" ? ["why: say why, carefully"] : []),
  applyCorrections,
};

const designer = (t: AgentTask): DesignerAnswer => {
  const k = Number(/\.m(\d+)\./.exec(t.id)![1]);
  const first = /^- (m\d+\.r1\.c\d+): total/m.exec(t.request)?.[1];
  const goal = { id: "big", scope: "moment" as const, moment: k, says: "the subject is large", instrument: "layout", value: "area.anchor", want: { min: 0.3 }, weight: 1, why: "it must read" };
  return first ? { goals: [goal], space: {}, overrides: [], proposals: [], pick: first, done: true, why: "the best of round one" } : { goals: [goal], space: { subjectScale: [0.5, 0.9] }, overrides: [], proposals: [], done: false, why: "try sizes" };
};

/** A reasoner that answers what `answer` gives and leaves the rest pending, recording every task it is asked. */
function memory(answer: (t: AgentTask) => unknown): Reasoner & { asked: AgentTask[] } {
  const asked: AgentTask[] = [];
  return {
    asked,
    async ask<T>(t: AgentTask): Promise<Answer<T>> {
      asked.push(t);
      const v = answer(t);
      return v === undefined ? { status: "pending", file: `${t.id}.md` } : { status: "answered", value: v as T };
    },
  };
}

const answers = (through: "none" | "wave1" | "all") => (t: AgentTask): unknown => {
  if (through === "none") return undefined;
  if (t.role === "depicter") return BALL;
  if (t.role === "director") return director(t.id === "director" ? "careless" : "a calm test");
  if (through === "wave1") return undefined;
  if (t.role === "designer") return designer(t);
  return undefined;
};

test("a design run waits on its waves, resumes from answers, and writes the corrections first as visible notes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "design-"));
  try {
    const w0 = await runDesign(dir, inputs, memory(answers("none")), agents);
    assert.equal(w0.status, "pending");
    assert.deepEqual(w0.status === "pending" && [...w0.waiting].sort(), ["depict.ball.md", "director.md"], "the depicter and the director go out in the same wave");

    const r1 = memory(answers("wave1"));
    const w1 = await runDesign(dir, inputs, r1, agents);
    assert.equal(w1.status, "pending");
    assert.ok(r1.asked.some((t) => t.id === "director.r1"), "the director's answer the check refused went back as a repair");
    assert.deepEqual(w1.status === "pending" && [...w1.waiting].sort(), ["designer.m0.r1.md", "designer.m1.r1.md"], "every moment's designer is asked side by side");

    const r2 = memory(answers("all"));
    const done = await runDesign(dir, inputs, r2, agents);
    assert.equal(done.status, "done");
    if (done.status !== "done") return;
    assert.match(done.notes[0]!, /^corrected at m0: "ten metres" is now "twelve metres"/);
    assert.ok(readFileSync(join(dir, "notes.txt"), "utf8").startsWith("corrected at m0"));
    for (const f of ["design.json", "decisions.json", "composed.scene.json", "ids.json", "props.json", "report.txt"]) assert.ok(existsSync(join(dir, f)), f);
    assert.equal(done.corrections.length, 1);
    // The corrected words are what the video says.
    assert.ok(JSON.stringify(done.scene).includes("twelve metres"));
    assert.ok(!JSON.stringify(done.scene).includes("ten metres"));
    // Both moments were searched and their picks kept, each with its decision: the moment that carries the video had
    // the rounds for the designer to pick; the other had one round, whose lowest miss the search kept.
    assert.ok(done.decisions.some((d) => d.area === "search" && d.moment === 1 && d.from === "designer"));
    assert.ok(done.decisions.some((d) => d.area === "search" && d.moment === 0 && d.from === "search"));
    assert.deepEqual(done.design.goals.filter((g) => g.scope === "moment").map((g) => g.moment).sort(), [0, 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the depicter's spec reaches the composer in the search and in the final composition", async () => {
  const dir = mkdtempSync(join(tmpdir(), "design-"));
  try {
    const seen: string[] = [];
    const watching: DesignAgents = { ...agents, designerTask: (input, repair?: Repair) => (seen.push(input.design.demos.map((d) => `${d.moment}.${d.act}`).join()), agents.designerTask(input, repair)) };
    const done = await runDesign(dir, inputs, memory(answers("all")), watching);
    assert.equal(done.status, "done");
    if (done.status !== "done") return;
    assert.deepEqual(done.props.ball, BALL);
    assert.ok(!done.notes.some((n) => /no PropSpec/.test(n)), "no thing is left undepicted");
    // Without the spec the ball stands as its own words; with it the scene draws it (and its fall is a demonstration).
    const corrected = applyCorrections(plan, director("x")).plan;
    const bare = compose(corrected, suggestDesign(corrected, viewing, theme, [], words), { theme, words, frames: inputs.frames });
    assert.ok(bare.problems.some((p) => p.thing === "ball" && p.who === "depicter"));
    assert.notDeepEqual(done.ids.ball, bare.ids.ball);
    assert.ok(seen.every((s) => s === "1.0"), "the designer works on a design whose fall was read off the depiction");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the designer's checks accept what the search offers: the layout reading and the question's own name", async () => {
  const { checkGoals, planNames } = await import("../agents/common.ts");
  const p = parseIntent(`thing a "a"\n@0\n  show a\n  ask "Which one?"\n`);
  const g = (instrument: string, value: string) => ({ id: value, scope: "moment" as const, moment: 0, says: "x", instrument, value, want: { max: 0 }, weight: 1, why: "y" });
  const ctx = { viewing, names: planNames(p), holds: new Set<string>(), requirements: new Set<string>(), scope: "moment" as const, moment: 0 };
  assert.deepEqual(checkGoals([g("layout", "area.anchor"), g("layout", "w.anchor"), g("layout", "w.a"), g("visibility", "cut.ask@0")], ctx, "goals"), []);
  assert.equal(checkGoals([g("layout", "w.nothing")], ctx, "goals").length, 1);
});
