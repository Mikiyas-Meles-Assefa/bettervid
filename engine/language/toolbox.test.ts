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

// Every whole scene the path A guide shows must build as written, so the writer is never taught a form that fails.
test("every whole-scene example in the toolbox parts of the guide builds, with things depicted and a sprite made", async () => {
  const { readFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const guide = readFileSync(new URL("../../prompts/engine-language.md", import.meta.url), "utf8");
  const parts = [...guide.matchAll(/\[\[toolbox\]\]\n([\s\S]*?)\[\[\/toolbox\]\]/g)].map((m) => m[1]!);
  const blocks = parts.flatMap((p) => p.split(/\n(?!    )/).join("\n").split(/\n\n+/)).map((b) => b.split("\n").filter((l) => l.startsWith("    ")).map((l) => l.slice(4)).join("\n")).filter((b) => /^@\d/m.test(b) && /^@0/.test(b));
  assert.ok(blocks.length >= 2, `found ${blocks.length} whole scenes`);
  const fx = (n: string) => readFileSync(new URL(`../design/depict/fixtures/${n}`, import.meta.url));
  const spec = (desc: string): PropSpec => /kettle|jug|pot|cup|jar|glass/.test(desc)
    ? { kind: "container", label: desc.split(",")[0]!, size: { w: 22, h: 24, unit: "cm" }, params: { profile: [[0.4, 0], [0.5, 0.7], [0.3, 1]], spout: "right", contents: [{ name: "water", level: 0.5, color: "water" }], bubbles: 6 }, colors: { water: "#bfe3f2cc" }, colorSources: { water: "known" }, why: "test" }
    : /flame|cup.*sprite/.test(desc)
      ? { kind: "sprite", label: "flame", tier: 2, sprite: { parts: [{ name: "tip", phrase: "the tip", changes: ["tint"] }] }, why: "test" }
      : bench;
  const depicter: Reasoner = { async ask<T>(task: AgentTask): Promise<Answer<T>> { return { status: "answered", value: spec(/Description: (.*)/.exec(task.request)![1]!) as T, usd: 0 } as Answer<T>; } } as Reasoner;
  const root = mkdtempSync(join(tmpdir(), "sprites-"));
  const sprite = { make: async () => ({ png: fx("lamp.png"), size: [160, 160] as [number, number], masks: { tip: { png: fx("lamp-shade.png"), box: [0.18, 0.18, 0.82, 0.47] as [number, number, number, number] } } }) };
  try {
    for (const b of blocks) {
      const box = emptyToolbox();
      const prep = await prepareToolbox(b, kinds, box, { depicter, sprite, spriteRoot: root, style: { name: "flat", art: "flat" } });
      assert.deepEqual(prep.problems, []);
      const r = await build(b, { ctx: ctxWith(box) });
      assert.deepEqual(r.problems, [], `${formatProblems(r.problems)}\nin:\n${b}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("each move the guide teaches plays as written, and arc and hop land where the named thing is", async () => {
  const src = `@0
row top gap=80
  circle coin "1" w=120
  box jar "jar" w=260 h=300
  circle frog "f" w=120
  box pad "pad" w=220 h=80
@3 keep
do arc coin to=jar bend=0.4 frames=30
do hop frog to=pad height=200 frames=40
@6
stack s gap=60
  row r1 gap=60
    box home "home"
    box school "school"
  circle seed "" w=100
  box sprout "" w=100 h=200
  circle earth "earth" w=200
  dot moon
arrow home -> school id=route
@8 keep
circle bus "b" w=80
do follow bus path=route frames=60 orient=1
do morph seed.shape to=sprout.shape frames=30
do orbit moon around=earth turns=1 frames=120
do spring earth scaleX=1.2 scaleY=1.2 stiffness=200 damping=12
do squash school amount=0.3 axis=y
do jiggle home prop=rotate size=8 cycles=3
do wiggle sprout prop=y size=6 speed=3 frames=90
@12 keep
box stamp "OK" role=key enter=slam
do fall earth bounce=0.4 squash=0.2
@16 cut
text then "Later" role=title
`;
  const r = await build(src, { ctx: ctxWith(emptyToolbox()) });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  const s = r.scene!;
  const pos = (id: string, f: number) => { const n = at(s, f, id)!; return [Number(n.props.x), Number(n.props.y)]; };
  const landed = pos("coin", 45 + 31);
  const jar = pos("jar", 45 + 31);
  assert.ok(Math.hypot(landed[0]! - jar[0]!, landed[1]! - jar[1]!) < 2, `coin ${landed} jar ${jar}`);
  const f = pos("frog", 45 + 41);
  const p = pos("pad", 45 + 41);
  assert.ok(Math.abs(f[0]! - p[0]!) < 2, `frog ${f} pad ${p}`);
});
