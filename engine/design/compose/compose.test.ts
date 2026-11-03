import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../../core/evaluate.ts";
import type { Resolved } from "../../core/types.ts";
import { themeFrom } from "../../render/theme.ts";
import { parseIntent } from "../intent/parse.ts";
import { edgeBand, suggestDesign, viewingFrom } from "../suggest.ts";
import type { Design, PartCard, Viewing } from "../types.ts";
import type { PropSpec } from "../depict/index.ts";
import { SAMPLES } from "../depict/samples.ts";
import { compose } from "./compose.ts";
import { when } from "../../core/compile.ts";
import { KITS } from "../../kits/index.ts";
import { build } from "../../language/build.ts";

// The depicter's answers for the plan's objects (in the product the depicter writes these from the user's material).
const sample = (name: string, patch: Partial<PropSpec> = {}): PropSpec => ({ ...(SAMPLES.find((x) => x.name === name)!.spec as PropSpec), ...patch });
const PROPS: Record<string, PropSpec> = {
  jug: sample("tumbler of water", { label: "glass jug of water", size: { w: 12, h: 20, unit: "cm" } }),
  bowl: sample("tumbler of water", { label: "glass bowl", size: { w: 18, h: 8, unit: "cm" }, params: { profile: [[0.3, 0], [0.5, 1]], contents: [{ name: "water", level: 0.1, color: "water" }] } }),
  red: { kind: "body", form: "sphere", label: "red ball", size: { w: 21.8, h: 21.8, unit: "cm" }, colors: { body: "#d23a2a" }, colorSources: { body: "known: the plan says red" }, why: "a test" },
  blue: { kind: "body", form: "sphere", label: "small blue ball", size: { w: 6.7, h: 6.7, unit: "cm" }, colors: { body: "#2a62d2" }, colorSources: { body: "known: the plan says blue" }, why: "a test" },
};

const theme = themeFrom("flat");
// A 30 s clip: 75 words, one every 0.4 s.
const words = Array.from({ length: 75 }, (_, i) => ({ text: `w${i}`, start: 0.2 + i * 0.4 }));
const frames = 30 * 30;
const PLAN = parseIntent(`feel warm
thing before "20 km"
thing after "35 km"
thing note "a short note"
many dots 9 "dot"
object jug "a glass jug of water"
object bowl "a glass bowl"
object red "a red ball"
object blue "a small blue ball"

@0
  show note
@6
  show before
  keep after
@12
  show dots
  dots becomes 14
@18
  show bowl
  jug pours into bowl slow
@28
  ask "Which one first?"
  show red
  keep blue
@34
  reveal note
  red blue fall
@44
  show after
  note becomes "a longer note now"
  wrong before
  stress
@56
  show blue
  keep red
`);
const view = (width: number, height: number, uiZones: Viewing["uiZones"] = []) => viewingFrom({ width, height, fps: 30, screen: "a test screen", frameWidthMm: 300, distanceMm: 600, watch: "on purpose", uiZones, why: "a test" });
const run = (v: Viewing, edit?: (d: Design) => void, plan = PLAN, cards: PartCard[] = [], props = PROPS) => {
  const d = suggestDesign(plan, v, theme, cards, words, props);
  edit?.(d);
  return { d, out: compose(plan, d, { theme, words, frames, cards, props }) };
};
const boxesOf = (out: ReturnType<typeof compose>) => out.boxes;

for (const [w, h] of [[1080, 1920], [1920, 1080], [1080, 1080]] as const) {
  test(`any frame shape ${w}x${h}: everything inside the frame and nothing overlapping`, () => {
    const { out } = run(view(w, h));
    assert.equal(out.scene.width, w);
    assert.equal(out.scene.height, h);
    assert.ok(out.scene.nodes.length > 20);
    assert.deepEqual(out.notes.filter((n) => /overlap|does not fit/.test(n)), []);
    for (const m of boxesOf(out))
      for (const [k, [x0, y0, x1, y1]] of Object.entries(m.boxes)) {
        assert.ok(x0 >= -1e-6 && y0 >= -1e-6 && x1 <= 1 + 1e-6 && y1 <= 1 + 1e-6, `${k} in moment ${m.moment} runs out of the frame`);
        const others = Object.entries(m.boxes).filter(([j]) => j !== k);
        for (const [j, b] of others) {
          const ox = Math.min(x1, b[2]) - Math.max(x0, b[0]);
          const oy = Math.min(y1, b[3]) - Math.max(y0, b[1]);
          assert.ok(!(ox * w > 1 && oy * h > 1), `${k} overlaps ${j} in moment ${m.moment}`);
        }
      }
  });
}

test("UI zones are kept clear: no block enters a zone the viewing names", () => {
  const { out } = run(view(1080, 1920, [edgeBand("bottom", 0.2, "captions"), edgeBand("right", 0.15, "buttons")]));
  for (const m of boxesOf(out)) for (const [k, [, , x1, y1]] of Object.entries(m.boxes)) assert.ok(y1 <= 0.8 + 1e-6 && x1 <= 0.85 + 1e-6, `${k} enters a zone`);
});

test("MomentDesign overrides are honoured: subjectAt moves the anchor, typeScale sizes words, supportOpacity dims support", () => {
  const k = 0; // @0: "note" alone
  const base = run(view(1080, 1920)).out;
  const moved = run(view(1080, 1920), (d) => (d.moments[k]!.subjectAt = { value: [0.5, 0.2], from: "search" })).out;
  const yOf = (o: typeof base) => o.boxes.find((b) => b.moment === k)!.boxes.note!;
  assert.ok(yOf(moved)[1] < yOf(base)[1] - 0.1, "the anchor moves up");
  const small = run(view(1080, 1920), (d) => (d.moments[k]!.typeScale = { value: 0.3, from: "search" })).out;
  const wOf = (o: typeof base) => yOf(o)[2] - yOf(o)[0];
  assert.ok(wOf(small) < wOf(base) * 0.7, "a smaller type scale sets smaller words");
  // @44 (plan moment 6): "note" is support; its opacity is the moment's supportOpacity.
  const dim = run(view(1080, 1920), (d) => (d.moments[6]!.supportOpacity = { value: 0.3, from: "designer" })).out;
  const r: Resolved = { id: "root", kind: "group", props: {}, children: evaluate(dim.scene, Math.round(words[50]!.start * 30)) };
  const find = (n: Resolved, id: string): Resolved | undefined => (n.id === id ? n : (n.children ?? []).map((c) => find(c, id)).find(Boolean));
  assert.ok(Math.abs(Number(find(r, "t.note")!.props.opacity) - 0.3) < 0.02);
});

test("style values can be overridden per video and per moment", () => {
  const a = run(view(1080, 1920)).out;
  const b = run(view(1080, 1920), (d) => d.overrides.push({ key: "type.subjectMax", value: 0.05, why: "a test" })).out;
  const c = run(view(1080, 1920), (d) => d.overrides.push({ key: "type.subjectMax@0", value: 0.05, why: "a test" })).out;
  const w = (o: typeof a, k: number, id: string) => { const x = o.boxes.find((m) => m.moment === k)!.boxes[id]!; return x[2] - x[0]; };
  assert.ok(w(b, 0, "note") < w(a, 0, "note") * 0.6);
  assert.ok(w(c, 0, "note") < w(a, 0, "note") * 0.6);
  // @6 (plan moment 1) compares two quantities as the subject: the video override reaches it, the moment override does not.
  assert.ok(w(b, 1, "pair.before.after") < w(a, 1, "pair.before.after") - 1e-6 || JSON.stringify(b.boxes[1]) !== JSON.stringify(a.boxes[1]));
  assert.equal(JSON.stringify(c.boxes[1]), JSON.stringify(a.boxes[1]), "a moment override touches only its moment");
});

test("demonstrations follow the director's plan: real speed is quicker than slow, a replay adds a second pass", () => {
  const fall = (speed: "real" | "slow", replay: boolean) => {
    const { out } = run(view(1080, 1920), (d) => {
      const dm = d.demos.find((x) => PLAN.moments[x.moment]!.acts[x.act]!.verb === "fall")!;
      dm.speed = { value: speed, from: "director" };
      dm.replay = replay ? { value: { speed: "slow" }, from: "director" } : undefined;
    });
    return out.decisions.find((x) => x.area === "demonstration" && /fall/.test(x.choice))!;
  };
  const real = fall("real", false);
  const slow = fall("slow", false);
  const both = fall("real", true);
  assert.ok(real.readings!.realSeconds! > 0.1 && real.readings!.realSeconds! < 1.5, "a fall a viewer knows lasts under a second and a half");
  assert.match(both.choice, / then /);
  assert.ok(/played ([\d.]+) s/.exec(slow.choice)![1]! > /played ([\d.]+) s/.exec(real.choice)![1]!);
});

test("pinned lines are kept: a pinned camera and a pinned set win in their moment", () => {
  const plan = parseIntent(`thing a "alpha"\nthing b "beta"\n@0\n  show a\n  camera zoom=1.6 at=0.5,0.5 frames=0\n@10\n  show b\n  set t.b opacity=0.4\n  link a b`);
  const { out } = run(view(1080, 1920), undefined, plan);
  const zoom = out.scene.tracks.find((t) => t.target === "camera" && t.prop === "zoom")!;
  assert.ok(zoom.keys.some((k) => Math.abs(Number(k.value) - 1.6) < 1e-6));
  const op = out.scene.tracks.find((t) => t.target === "t.b" && t.prop === "opacity")!;
  assert.ok(Math.abs(Number(op.keys.at(-1)!.value) - 0.4) < 1e-6);
  assert.ok(out.decisions.some((d) => d.area === "pinned" && d.from === "author"));
  assert.ok(out.notes.some((n) => /link a b/.test(n)), "a pinned line it cannot draw is reported");
});

test("ids map every plan name and material part to the scene ids that draw it", () => {
  const card: PartCard = { name: "chart", file: "x.png", size: [800, 600], kind: "chart", about: "bars", parts: { big: { box: [0.1, 0.1, 0.55, 0.9], about: "the big bars" } }, data: { kind: "bars", labels: ["a", "b", "c"], values: [5, 9, 2], plot: [0.1, 0.1, 0.9, 0.9] }, requirements: [], checked: { ok: true, notes: [] } };
  const plan = parseIntent(`thing v "9 units"\n@0\n  show chart\n@10\n  show chart.big\n  keep v`);
  const { out } = run(view(1080, 1920), undefined, plan, [card]);
  assert.deepEqual(out.ids.chart, ["p.chart"]);
  assert.ok(out.ids["chart.big"]!.includes("p.chart.bar0") && out.ids["chart.big"]!.includes("p.chart.bar1"));
  assert.deepEqual(out.ids.v, ["t.v"]);
  const all = run(view(1080, 1920)).out;
  for (const t of PLAN.things) assert.ok(all.ids[t.id]?.length, `${t.id} has scene ids`);
  for (const ids of Object.values(all.ids)) for (const id of ids) assert.ok(all.scene.nodes.some((n) => n.id === id), `${id} is a node`);
});

test("recomposing a 30 s clip after a change to one moment is fast", () => {
  const { d } = run(view(1080, 1920));
  compose(PLAN, d, { theme, words, frames, props: PROPS });
  const t = performance.now();
  for (let i = 0; i < 5; i++) {
    d.moments[3]!.subjectScale = { value: 0.6 + i * 0.05, from: "search" };
    compose(PLAN, d, { theme, words, frames, props: PROPS });
  }
  const ms = (performance.now() - t) / 5;
  assert.ok(ms < 300, `recompose took ${ms.toFixed(0)} ms`);
});

test("every arrangement packs without overlaps", () => {
  for (const a of ["stack", "row", "around", "split", "inset", "something new"]) {
    const { out } = run(view(1920, 1080), (d) => d.moments.forEach((m) => (m.arrangement = { value: a, from: "search" })));
    assert.deepEqual(out.notes.filter((n) => /overlap/.test(n)), [], a);
    if (a === "something new") assert.ok(out.notes.some((n) => /not one the packer knows/.test(n)));
  }
});

test("acts are what the depiction says they are: a flow pours, a fall falls, an unknown verb is a task for the depicter", () => {
  const { out } = run(view(1080, 1920));
  assert.deepEqual(out.problems, []);
  assert.ok(out.decisions.some((d) => d.area === "demonstration" && /^jug pours into bowl/.test(d.choice)), "the jug pours into the bowl");
  assert.ok(out.decisions.some((d) => d.area === "demonstration" && /^red and blue fall/.test(d.choice)));
  const odd = parseIntent(`object red "a red ball"\n@0\n  show red\n  red evaporates`);
  const r = run(view(1080, 1920), undefined, odd).out;
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0]!.who, "depicter");
  assert.match(r.problems[0]!.problem, /no verb "evaporates"/);
});

test("an object with no depiction is a task for the depicter, and stands as its words meanwhile", () => {
  const { out } = run(view(1080, 1920), undefined, PLAN, [], { ...PROPS, jug: undefined as unknown as PropSpec });
  assert.ok(out.problems.some((p) => p.thing === "jug" && p.task === "depict.jug"));
  assert.ok(out.scene.nodes.some((n) => n.id === "t.jug"));
});

test("focus: none keeps support at full strength, hidden withholds the subject", () => {
  const at = Math.round(words[50]!.start * 30);
  const opOf = (o: ReturnType<typeof compose>, id: string) => {
    const r: Resolved = { id: "root", kind: "group", props: {}, children: evaluate(o.scene, at) };
    const find = (n: Resolved): Resolved | undefined => (n.id === id ? n : (n.children ?? []).map(find).find(Boolean));
    return Number(find(r)!.props.opacity);
  };
  const none = run(view(1080, 1920), (d) => (d.moments[6]!.focus = { value: "none", from: "designer" })).out;
  assert.ok(opOf(none, "t.note") > 0.98);
  const hidden = run(view(1080, 1920), (d) => (d.moments[6]!.focus = { value: "hidden", from: "designer" })).out;
  assert.ok(opOf(hidden, "t.after") < 0.02);
});

test("captions: their box is kept clear only while they show", () => {
  const box: [number, number, number, number] = [0, 0.8, 1, 0.92];
  const on = viewingFrom({ width: 1080, height: 1920, fps: 30, screen: "a phone", frameWidthMm: 65, distanceMm: 300, watch: "on purpose", uiZones: [], captions: { show: true, box, why: "a test" }, why: "a test" });
  for (const m of run(on).out.boxes) for (const [k, b] of Object.entries(m.boxes)) assert.ok(b[3] <= 0.8 + 1e-6 || b[1] >= 0.92 - 1e-6, `${k} enters the captions`);
  const off = { ...on, captions: { ...on.captions, show: false } };
  const low = Math.max(...run(off).out.boxes.flatMap((m) => Object.values(m.boxes).map((b) => b[3])));
  assert.ok(low > 0.8, "without captions the frame's bottom is used");
});

test("real or redrawn: a real proposal keeps the user's chart as it is", () => {
  const card: PartCard = { name: "chart", file: "x.png", size: [800, 600], kind: "chart", about: "bars", parts: {}, data: { kind: "bars", labels: ["a", "b"], values: [5, 9], plot: [0.1, 0.1, 0.9, 0.9] }, requirements: [], checked: { ok: true, notes: [] } };
  const plan = parseIntent(`@0\n  show chart`);
  const real = run(view(1080, 1920), (d) => d.moments[0]!.proposals.push({ value: { kind: "real", ids: ["chart"] }, from: "designer", why: "evidence to recognise" }), plan, [card]).out;
  assert.ok(real.decisions.some((d) => d.area === "material" && /kept real/.test(d.choice)));
  const redrawn = run(view(1080, 1920), undefined, plan, [card]).out;
  assert.ok(redrawn.decisions.some((d) => d.area === "material" && /redrawn/.test(d.choice)));
});

test("a flow can be replayed when the director asks and there is room", () => {
  const plan = parseIntent(`object jug "a glass jug of water"\nobject bowl "a glass bowl"\n@0\n  show bowl\n  jug pours into bowl\n@60\n  show jug`);
  const { out } = run(view(1080, 1920), (d) => (d.demos.find((x) => x.moment === 0)!.replay = { value: { speed: "slow" }, from: "director" }), plan);
  const dm = out.decisions.find((d) => d.area === "demonstration")!;
  assert.match(dm.choice, /replayed/);
});

// A real plan from the bench (insertion sort, 2026-11-03), with moments that show the computed thing and one of its parts.
const SORT_PLAN = `feel calm
for new

thing sortedpart "sorted part"
thing slide "slides past bigger cards"
thing stop "stops at a smaller card"
thing done "sorted: 1 2 3 4"
thing rule "compared only with sorted cards"

@0
  sort demo1 data=[4,1,3,2] algo=insertion show=boxes
  show sortedpart
  pace slow
@15
  show demo1
  keep slide sortedpart
  do steps demo1 from=1 to=1
  pace slow
  stress
@28
  show demo1.item.2
  keep stop sortedpart
  do steps demo1 from=2 to=3
@40
  show done
  keep sortedpart
  do steps demo1 from=4 to=6
  pace fast
@50
  show rule
  keep done
`;
const SORT_WORDS = Array.from({ length: 59 }, (_, i) => ({ text: `w${i}`, start: 0.2 + i * 0.4 }));
const SORT_FRAMES = 25 * 30;
const sortRun = (src: string, v = view(1080, 1920)) => {
  const plan = parseIntent(src);
  const d = suggestDesign(plan, v, theme, [], SORT_WORDS, {});
  return compose(plan, d, { theme, words: SORT_WORDS, frames: SORT_FRAMES });
};

test("a pinned computed thing is drawn by its kit, placed like any thing, and plays its steps on its moments' words", async () => {
  for (const [w, h] of [[1080, 1920], [1920, 1080]] as const) {
    const out = sortRun(SORT_PLAN, view(w, h));
    assert.deepEqual(out.problems, []);
    assert.deepEqual(out.notes.filter((n) => /demo1|does not draw|overlap|does not fit/.test(n)), []);
    // The sort's own parts, under the thing's scene id, addressable by the plan's names.
    const ids = new Set(out.scene.nodes.map((n) => n.id));
    for (const k of [1, 2, 3, 4]) for (const part of ["", ".shape", ".value"]) assert.ok(ids.has(`k.demo1.item.${k}${part}`), `k.demo1.item.${k}${part}`);
    assert.deepEqual(out.ids["demo1"], ["k.demo1"]);
    assert.deepEqual(out.ids["demo1.item.2"], ["k.demo1.item.2"]);
    // It gets a box from the layout in every moment it is on screen (as the stage), inside the frame, and leaves after.
    const stage = out.boxes.map((m) => m.boxes.stage);
    assert.ok(stage.slice(0, 4).every((b) => b && b[0] >= 0 && b[1] >= 0 && b[2] <= 1 && b[3] <= 1), "on screen from @0 to @40");
    assert.equal(stage[4], undefined, "@50 does not name it, so it leaves");
    // On screen while it plays: the group is visible at each moment's word.
    const find = (n: Resolved): Resolved | undefined => (n.id === "k.demo1" ? n : (n.children ?? []).map(find).find(Boolean));
    const op = (f: number) => (find({ id: "root", kind: "group", props: {}, children: evaluate(out.scene, f) })?.props.opacity ?? 0) as number;
    for (const word of [15, 28, 40]) assert.ok(op(when({ word }, { fps: 30, width: w, height: h, frames: SORT_FRAMES, theme, words: SORT_WORDS }) + 2) > 0.3, `visible at @${word}`);
    assert.ok(op(SORT_FRAMES - 1) < 0.02);
    // The steps play exactly as the scene language plays the same lines: same parts, same frames, same values.
    const ctx = { fps: 30, width: w, height: h, frames: SORT_FRAMES, theme, words: SORT_WORDS, kits: KITS };
    const old = await build("@0\nsort demo1 data=[4,1,3,2] algo=insertion show=boxes\n@15 keep\ndo steps demo1 from=1 to=1\n@28 keep\ndo steps demo1 from=2 to=3\n@40 keep\ndo steps demo1 from=4 to=6\n", { ctx });
    assert.deepEqual(old.problems, []);
    const moves = (tracks: { target: string; prop: string; keys: { at: number; value: unknown }[] }[], prefix: string) =>
      tracks.filter((t) => t.target.startsWith(`${prefix}.item.`) && ["x", "y", "fill", "stroke", "color"].includes(t.prop)).map((t) => `${t.target.slice(prefix.length)}.${t.prop} ${t.keys.map((k) => `${k.at}:${JSON.stringify(k.value)}`).join(" ")}`).sort();
    const mine = moves(out.scene.tracks, "k.demo1");
    assert.ok(mine.length > 4);
    assert.deepEqual(mine, moves(old.scene!.tracks, "demo1"));
    // Step 1 starts on word 15, not before.
    const first = Math.min(...out.scene.tracks.filter((t) => t.target.startsWith("k.demo1.item.") && t.prop === "x").flatMap((t) => t.keys.slice(1).map((k) => k.at)));
    assert.ok(first >= when({ word: 15 }, ctx) && first < when({ word: 28 }, ctx), `first step move at ${first}`);
  }
});

test("a computed thing's mistakes are the author's to repair, and the rest still composes", () => {
  const bad = sortRun(SORT_PLAN.replace("from=4 to=6", "from=4 to=9").replace("show demo1.item.2", "show demo1.item.7"));
  const said = bad.problems.map((p) => p.problem).join("\n");
  assert.match(said, /demo1 has steps 1 to 6, so from=4 to=9 does not fit/);
  assert.match(said, /demo1 has no part "item.7"/);
  assert.ok(bad.scene.nodes.some((n) => n.id === "k.demo1.item.4"), "the thing is still drawn");
  const unmade = sortRun(SORT_PLAN.replace("algo=insertion", "algo=nosuch"));
  assert.ok(unmade.problems.some((p) => p.who === "author" && /line 11/.test(p.problem)), unmade.problems.map((p) => p.problem).join("\n"));
});

test("any kind the kits make composes the same way: a graph and a formula", () => {
  const src = `thing note "a note"\n@0\n  graph net: A-B:4 B-C:1\n  show net.node.A\n  keep note\n@20\n  math f latex="x^2 + 1"\n  show f\n  keep note\n`;
  const out = sortRun(src);
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.ids["net.node.A"], ["k.net.node.A"]);
  assert.ok(out.ids["f"]?.length);
  assert.ok(out.boxes[0]!.boxes.stage && out.boxes[1]!.boxes.stage);
  // A part the kit does not make is named back to the author with the parts it does make.
  const wrong = sortRun(src.replace("net.node.A", "net.A")).problems.map((p) => p.problem).join("\n");
  assert.match(wrong, /net has no part "A". Its parts include: .*node\.A/);
});
