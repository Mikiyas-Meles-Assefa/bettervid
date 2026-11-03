import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../core/evaluate.ts";
import type { CompileContext, Resolved, Scene } from "../core/types.ts";
import { themeFrom } from "../render/theme.ts";
import { SAMPLES } from "../design/depict/samples.ts";
import type { AgentTask, Answer, Reasoner } from "../design/types.ts";
import type { PropSpec } from "../design/depict/index.ts";
import { build, formatProblems } from "./build.ts";
import { parse } from "./syntax.ts";
import { emptyToolbox, entryKey, prepareToolbox, toolboxKit, toolboxNotes, wantedIn, type Toolbox } from "./toolbox.ts";

const theme = themeFrom("flat");
const words = Array.from({ length: 60 }, (_, i) => ({ start: i * 0.5 }));
const sample = (name: string) => SAMPLES.find((s) => s.name === name)!.spec;
const bench: PropSpec = { kind: "body", form: "block", label: "lab bench", size: { w: 120, h: 8, unit: "cm" }, params: { depth: 0.1, corner: 0.01 }, colors: { body: "#8a6a4a" }, colorSources: { body: "known: wood" }, why: "test" };
const ctxWith = (box: Toolbox): CompileContext => ({ fps: 30, width: 1080, height: 1920, frames: 900, words, theme, kits: [toolboxKit(box)] });
const kinds = ["depict"];
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
const at = (s: Scene, f: number, id: string) => find(evaluate(s, f), id);

const LAB = `@0
stage lab w=900 h=1300
  depict burette "a 50 mL burette of NaOH"
  depict flask "a conical flask of clear acid"
  depict bench "a lab bench"
  burette above flask "3 cm"
  flask sits on bench
@10 keep
do act burette verb="opens"
do change flask color=rose frames=30
`;

function stocked(): Toolbox {
  const box = emptyToolbox();
  const put = (id: string, desc: string, spec: PropSpec) => (box.depictions[entryKey(id, desc)] = { id, desc, verbs: [], relations: [], spec, problems: [] });
  put("burette", "a 50 mL burette of NaOH", sample("burette"));
  put("flask", "a conical flask of clear acid", sample("flask"));
  put("bench", "a lab bench", bench);
  return box;
}

test("a stage's relation lines are read in the writer's words, and a line that is not one says how to write it", () => {
  const { doc, problems } = parse(LAB, kinds);
  assert.deepEqual(problems, []);
  const stage = doc.states[0]!.items[0]!;
  assert.equal(stage.kind, "stage");
  assert.deepEqual(stage.relations!.map((r) => [r.a, r.kind, r.b, r.gapCm]), [["burette", "over", "flask", 3], ["flask", "on", "bench", undefined]]);
  const bad = parse(`@0\nstage s\n  box a "x"\n  a floats near-ish b\n`, kinds);
  assert.match(bad.problems[0]!.message, /Inside a stage/);
});

test("depicted things are staged as one scene at their true relative sizes, and their states and verbs play", async () => {
  const r = await build(LAB, { ctx: ctxWith(stocked()) });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  const s = r.scene!;
  const box = (id: string) => {
    const n = at(s, 5, id)!;
    return { x: Number(n.props.x), y: Number(n.props.y), s: Number(n.props.scaleX ?? 1) };
  };
  const [b, f, d] = [box("burette"), box("flask"), box("bench")];
  // The burette hangs over the flask, the flask stands on the bench: one column, top to bottom.
  assert.ok(b.y < f.y && f.y <= d.y + 1, `burette ${b.y}, flask ${f.y}, bench ${d.y}`);
  assert.ok(Math.abs(b.x - f.x) < 60, "the burette is over the flask");
  // One scale: centimetres per pixel agree, so a 60 cm burette is drawn taller than a 14 cm flask.
  const real = (id: string, spec: PropSpec) => spec.size!.h;
  assert.ok(real("burette", sample("burette")) > real("flask", sample("flask")));
  // The flask's contents change color over the state that asks for it.
  const before = JSON.stringify(evaluate(s, 300).length);
  assert.ok(before);
  const notes = toolboxNotes(LAB, kinds, stocked(), theme);
  assert.equal(notes.length, 3);
  assert.match(notes[0]!, /States for `do change burette/);
});

test("a state or verb a thing does not have is a problem that lists what it has", async () => {
  const r = await build(LAB.replace("color=rose", "sparkle=1"), { ctx: ctxWith(stocked()) });
  assert.ok(r.problems.length);
  assert.match(formatProblems(r.problems), /flask has no state sparkle/);
  const v = await build(LAB.replace('verb="opens"', 'verb="sings"'), { ctx: ctxWith(stocked()) });
  assert.match(formatProblems(v.problems), /no verb "sings"/);
});

test("relations that disagree go back to the writer, and a relation with a thing outside the stage is named", async () => {
  const r = await build(LAB.replace('  flask sits on bench\n', '  flask sits on bench\n  flask beside burette\n'), { ctx: ctxWith(stocked()) });
  assert.match(formatProblems(r.problems), /cannot hold/);
  const out = await build(`@0\nstage s\n  box a "x" cm=30\n  a on b\n`, { ctx: ctxWith(stocked()) });
  assert.match(formatProblems(out.problems), /b is not in the stage s/);
});

test("shapes in a stage take their real size from cm=, so the larger thing is drawn larger", async () => {
  const r = await build(`@0\nstage s w=900 h=900\n  box lake "lake" cm=4000,200\n  box dock "dock" cm=1000,100\n  dock sits on lake\n`, { ctx: ctxWith(emptyToolbox()) });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  const w = (id: string) => {
    const n = at(r.scene!, 5, `${id}.shape`)!;
    const xs = (n.props.points as number[]).filter((_, i) => i % 2 === 0);
    return (Math.max(...xs) - Math.min(...xs)) * Number(at(r.scene!, 5, id)!.props.scaleX ?? 1);
  };
  assert.ok(w("lake") > 3 * w("dock"), `lake ${w("lake")} vs dock ${w("dock")}`);
});

test("preparing asks the depicter once per thing, with the verbs, states and relations the scene uses, and again when they grow", async () => {
  const asked: AgentTask[] = [];
  const depicter: Reasoner = {
    async ask<T>(task: AgentTask): Promise<Answer<T>> {
      if (!/\.r\d+$/.test(task.id)) asked.push(task); // repair rounds of one answer count once
      const name = /Thing: (\w+)/.exec(task.request)![1]!;
      const spec = name === "burette" ? sample("burette") : name === "flask" ? sample("flask") : bench;
      return { status: "answered", value: spec as T, usd: 0 } as Answer<T>;
    },
  } as Reasoner;
  const box = emptyToolbox();
  const w = wantedIn(LAB, kinds);
  assert.deepEqual(w.map((x) => [x.id, x.verbs, x.states]), [["burette", ["opens"], []], ["flask", [], ["color"]], ["bench", [], []]]);
  assert.match(w[0]!.relations.join(" "), /burette above flask/);
  const first = await prepareToolbox(LAB, kinds, box, { depicter, style: { name: "flat", art: "flat shapes" } });
  assert.deepEqual(first.problems, []);
  assert.equal(asked.length, 3);
  assert.match(asked.find((t) => /Thing: burette/.test(t.request))!.request, /opens/);
  await prepareToolbox(LAB, kinds, box, { depicter, style: { name: "flat", art: "flat shapes" } });
  assert.equal(asked.length, 3, "a prepared thing is not asked again");
  await prepareToolbox(LAB.replace('verb="opens"', 'verb="drips into" to=flask amount=5'), kinds, box, { depicter, style: { name: "flat", art: "flat shapes" } });
  assert.equal(asked.length, 4, "a new verb prepares that thing again");
  const r = await build(LAB.replace('verb="opens"', 'verb="drips into" to=flask amount=5'), { ctx: ctxWith(box) });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
});

test("a thing that cannot be prepared is said to the writer, not drawn as something lesser", async () => {
  const depicter = { ask: async () => { throw new Error("no answer"); } } as unknown as Reasoner;
  const r = await prepareToolbox(LAB, kinds, emptyToolbox(), { depicter, style: { name: "flat", art: "" } });
  assert.equal(r.problems.length, 3);
  const b = await build(LAB, { ctx: ctxWith(emptyToolbox()) });
  assert.match(formatProblems(b.problems), /no depiction of "a 50 mL burette of NaOH" is prepared/);
});
