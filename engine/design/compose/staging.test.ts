// Staging: related things are laid out as one scene. Relations hold in the composed frames, real sizes keep their
// ratios, nothing is turned upside down, and the scene fits the frame (a ground may run past its sides when allowed).
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../../core/evaluate.ts";
import type { Resolved } from "../../core/types.ts";
import { themeFrom } from "../../render/theme.ts";
import { fitScene, solveScene, type SceneThing } from "../abilities/scene.ts";
import { depictionFrom, pointOf, suggestLook, type PropSpec } from "../depict/index.ts";
import { SAMPLES } from "../depict/samples.ts";
import { parseIntent } from "../intent/parse.ts";
import { suggestDesign, viewingFrom } from "../suggest.ts";
import type { Design, Viewing } from "../types.ts";
import { compose } from "./compose.ts";

const theme = themeFrom("flat");
const words = Array.from({ length: 75 }, (_, i) => ({ text: `w${i}`, start: 0.2 + i * 0.4 }));
const frames = 30 * 30;
const view = (width: number, height: number): Viewing => viewingFrom({ width, height, fps: 30, screen: "a test screen", frameWidthMm: 300, distanceMm: 600, watch: "on purpose", uiZones: [], why: "a test" });

// The depicter's answers: plain outlines with the points where each meets the others.
const box = (label: string, w: number, h: number, points: Record<string, [number, number]> = {}, outline: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]): PropSpec => ({
  kind: "outline",
  label,
  size: { w, h, unit: "cm" },
  params: { outline },
  points,
  colors: { body: "#7a7a7a" },
  colorSources: { body: "known: a test" },
  why: "a test",
});
const PROPS: Record<string, PropSpec> = {
  rug: box("rug", 300, 2),
  desk: box("desk", 140, 75, { "left end": [0.12, 0], cat: [0.5, 1] }, [[0, 0], [1, 0], [1, 0.1], [0.95, 0.1], [0.95, 1], [0.9, 1], [0.9, 0.1], [0.1, 0.1], [0.1, 1], [0.05, 1], [0.05, 0.1], [0, 0.1]]),
  lamp: box("lamp", 30, 50, { arm: [0.9, 0.15] }),
  cat: box("cat", 45, 30, { desk: [0.5, 1] }),
  mug: box("mug", 9, 10),
  tag: box("tag", 5, 8, { lamp: [0.5, 0] }),
};
const PLAN = parseIntent(`object rug "a long rug"
object desk "a wooden desk"
object lamp "a reading lamp"
object cat "a cat"
object mug "a mug"
object tag "a paper tag"
thing note "a note"

desk on rug
lamp on desk "left end"
cat sleeps under desk
mug beside lamp
tag hangs from lamp.arm

@0
  show note
@4
  show lamp
@10
  show cat
  keep desk
@16
  show desk
  keep lamp cat mug tag rug
@30
  show note
`);

const late = (word: number, next: number) => Math.round((words[word]!.start + (words[next]!.start - words[word]!.start) * 0.85) * 30);
const nodesAt = (out: ReturnType<typeof compose>, f: number) => {
  const all = new Map<string, Resolved>();
  const order: string[] = [];
  const walk = (rs: Resolved[]) => rs.forEach((r) => (all.set(r.id, r), order.push(r.id), walk(r.children)));
  walk(evaluate(out.scene, f));
  return { all, order };
};
const shapes = Object.fromEntries(Object.entries(PROPS).map(([id, s]) => [id, depictionFrom(s, theme, { id, look: suggestLook(theme, 1) })]));
/** A thing on screen at a frame: its box in frame pixels, a named point of it in frame pixels, its scale and opacity. */
const onScreen = (all: Map<string, Resolved>, id: string) => {
  const p = all.get(`t.${id}`)!.props;
  const [x, y, sx, sy] = [Number(p.x), Number(p.y), Number(p.scaleX), Number(p.scaleY)];
  const d = shapes[id]!;
  return {
    x, y, sx, sy, op: Number(p.opacity),
    box: [x - (d.box.w * sx) / 2, y - d.box.h * sy, x + (d.box.w * sx) / 2, y] as const,
    w: d.box.w * sx,
    point: (name: string) => {
      const q = pointOf(d, name)!;
      return [x + q[0] * sx, y + q[1] * sy] as const;
    },
  };
};
const close = (a: readonly [number, number], b: readonly [number, number], tol = 1.5) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol, `${a.map((v) => v.toFixed(1))} is not at ${b.map((v) => v.toFixed(1))}`);
const run = (v: Viewing, edit?: (d: Design) => void) => {
  const d = suggestDesign(PLAN, v, theme, [], words, PROPS);
  edit?.(d);
  return compose(PLAN, d, { theme, words, frames, props: PROPS });
};

test("the solver: each relation joins its points, at one real scale, with a back-to-front order and the ground found", () => {
  const things: SceneThing[] = Object.entries(shapes).map(([id, d]) => ({ id, w: d.box.w, h: d.box.h, realCm: { w: PROPS[id]!.size!.w, h: PROPS[id]!.size!.h }, point: (n: string) => pointOf(d, n) }));
  const rels = PLAN.relations!.map((r) => ({ a: r.a, b: r.b, kind: r.kind, words: r.words, ...(r.at ? { at: r.at } : {}) }));
  const s = solveScene(things, rels, { gap: 0.15 });
  assert.ok(s.checks.every((c) => c.held), JSON.stringify(s.checks.map((c) => [c.rel.a, c.rel.b, c.offCm])));
  for (const t of things) assert.ok(Math.abs(s.places.get(t.id)!.k * t.w - PROPS[t.id]!.size!.w) < 1e-6, `${t.id} keeps its real width`);
  // Beside: bottoms level, a gap of 15% of the smaller width, to the right.
  const [lamp, mug] = [s.places.get("lamp")!, s.places.get("mug")!];
  assert.ok(Math.abs(lamp.y - mug.y) < 1e-6);
  assert.ok(Math.abs(mug.x - 4.5 - (lamp.x + 15) - 0.15 * 9) < 1e-6);
  assert.deepEqual(s.grounds, ["rug"]);
  const z = (id: string) => s.z.indexOf(id);
  assert.ok(z("rug") < z("desk") && z("desk") < z("lamp") && z("lamp") < z("tag") && z("cat") < z("desk"), s.z.join(" "));
  // Fitted whole, every thing is inside the box; fitted closer on the tag, it is drawn at its share and the rest runs past.
  const whole = fitScene(s, things, { w: 800, h: 600 }, { bleed: false, margin: 0.1 });
  for (const m of whole.members) assert.ok(m.dx - m.w / 2 >= -whole.w / 2 - 0.5 && m.dx + m.w / 2 <= whole.w / 2 + 0.5 && m.dy - m.h >= -0.5 && m.dy <= whole.h + 0.5, m.id);
  const near = fitScene(s, things, { w: 800, h: 600 }, { bleed: true, margin: 0.1, focus: { id: "tag", share: 0.3 } });
  const tag = near.members.find((m) => m.id === "tag")!;
  assert.ok(near.closer && near.spills && Math.max(tag.w / 800, tag.h / 600) >= 0.3 - 1e-6);
});

test("a related scene composes as one: relations hold in the frames, at true scale, upright, and a support stays with what rests on it", () => {
  for (const [W, H] of [[1080, 1920], [1920, 1080]] as const) {
    const out = run(view(W, H));
    assert.ok(out.decisions.filter((d) => d.area === "staging" && / held$/.test(d.choice)).length === 5, out.decisions.filter((d) => d.area === "staging").map((d) => d.choice).join("; "));
    assert.deepEqual(out.problems, []);
    // Closer on a small thing (the cat), the rest of the scene runs past the stage and is cut to it.
    assert.ok(out.decisions.some((d) => d.area === "staging" && /closes in on cat/.test(d.choice)));
    assert.ok(JSON.stringify(out.scene.tracks).includes('"clip"'));
    // m1 shows only the lamp: the desk it stands on and the rug under the desk stay, and the lamp stands on the desk's left end.
    {
      const { all } = nodesAt(out, late(4, 10));
      const [lamp, desk, rug] = ["lamp", "desk", "rug"].map((id) => onScreen(all, id));
      assert.ok(desk!.op > 0.05 && rug!.op > 0.05, "what the lamp stands on is on screen");
      close([lamp!.x, lamp!.y], desk!.point("left end"));
    }
    // m2, closer on the cat, keeps it where it is under the desk.
    {
      const { all } = nodesAt(out, late(10, 16));
      close(onScreen(all, "cat").point("desk"), onScreen(all, "desk").point("cat"));
    }
    // m3 shows all: every relation holds where the things are drawn.
    const { all, order } = nodesAt(out, late(16, 30));
    const t = Object.fromEntries(["rug", "desk", "lamp", "cat", "mug", "tag"].map((id) => [id, onScreen(all, id)]));
    close([t.desk!.x, t.desk!.y], t.rug!.point("top"));
    close([t.lamp!.x, t.lamp!.y], t.desk!.point("left end"));
    close(t.cat!.point("desk"), t.desk!.point("cat"));
    close(t.tag!.point("lamp"), t.lamp!.point("arm"));
    assert.ok(Math.abs(t.mug!.y - t.lamp!.y) < 1.5 && t.mug!.box[0] > t.lamp!.box[2], "the mug beside the lamp, on one level");
    // True relative sizes, and nothing flipped or squashed.
    assert.ok(Math.abs(t.desk!.w / t.lamp!.w - 140 / 30) < 0.02 * (140 / 30));
    assert.ok(Math.abs(t.cat!.w / t.desk!.w - 45 / 140) < 0.02 * (45 / 140));
    for (const [id, x] of Object.entries(t)) {
      assert.ok(x.sx > 0 && x.sy > 0 && Math.abs(x.sx - x.sy) < 1e-6 * x.sx, `${id} upright, not stretched`);
      assert.equal(Number(all.get(`t.${id}.pose`)!.props.rotate ?? 0), 0, `${id} not turned`);
    }
    // What stands on the rug fits the frame; the rug, the ground, may run past its sides.
    for (const id of ["desk", "lamp", "cat", "mug", "tag"]) {
      const [x0, y0, x1, y1] = t[id]!.box;
      assert.ok(x0 >= -0.5 && y0 >= -0.5 && x1 <= W + 0.5 && y1 <= H + 0.5, `${id} inside ${W}x${H}: ${[x0, y0, x1, y1].map(Math.round)}`);
    }
    // Back to front: the rug, then the desk with the cat behind it, then the lamp, then its tag.
    const z = (id: string) => order.indexOf(`t.${id}`);
    assert.ok(z("rug") < z("desk") && z("cat") < z("desk") && z("desk") < z("lamp") && z("lamp") < z("tag"));
  }
});

test("a scene keeps one place: a thing shown in two moments stays where it was while the scene holds", () => {
  const out = run(view(1080, 1920), (d) => d.overrides.push({ key: "scene.subjectShare", value: 0, why: "hold the whole scene" }));
  const a = onScreen(nodesAt(out, late(10, 16)).all, "desk");
  const b = onScreen(nodesAt(out, late(16, 30)).all, "desk");
  close([a.x, a.y], [b.x, b.y]);
  assert.ok(Math.abs(a.sx - b.sx) < 1e-6 * a.sx);
});

test("the ground runs past only when the design allows it, and a missing size or place is the depicter's to give", () => {
  const whole = run(view(1080, 1920), (d) => d.overrides.push({ key: "scene.bleed", value: false, why: "show it whole" }, { key: "scene.subjectShare", value: 0, why: "hold the whole scene" }));
  const rug = onScreen(nodesAt(whole, late(16, 30)).all, "rug");
  assert.ok(rug.box[0] >= -0.5 && rug.box[2] <= 1080.5, "the rug whole inside the frame");
  const props = { ...PROPS, mug: { ...PROPS.mug!, size: undefined }, desk: { ...PROPS.desk!, points: { cat: [0.5, 1] as [number, number] } } };
  const d = suggestDesign(PLAN, view(1080, 1920), theme, [], words, props);
  const out = compose(PLAN, d, { theme, words, frames, props });
  assert.ok(out.problems.some((p) => p.thing === "mug" && p.who === "depicter" && /real size/.test(p.problem)), JSON.stringify(out.problems));
  assert.ok(out.problems.some((p) => p.thing === "desk" && /"left end"/.test(p.problem)), JSON.stringify(out.problems));
});

test("a plan with no relations composes as it did: no scene, no clip", () => {
  const plan = parseIntent(`object lamp "a reading lamp"\nobject mug "a mug"\n@0\n  show lamp\n  keep mug\n`);
  const out = compose(plan, suggestDesign(plan, view(1080, 1920), theme, [], words, PROPS), { theme, words, frames, props: PROPS });
  assert.ok(!out.decisions.some((d) => d.area === "staging"));
  assert.ok(!JSON.stringify(out.scene.tracks).includes('"clip"'));
});

test("a source that pours into a thing of a scene joins it: its outlet held over the mouth, at the scene's one scale", () => {
  const glass = SAMPLES.find((x) => x.name === "tumbler of water")!.spec as PropSpec;
  const props: Record<string, PropSpec> = { ...PROPS, jug: { ...glass, label: "jug", size: { w: 12, h: 20, unit: "cm" } }, bowl: { ...glass, label: "bowl", size: { w: 18, h: 8, unit: "cm" }, params: { profile: [[0.3, 0], [0.5, 1]], contents: [{ name: "water", level: 0.1, color: "water" }] } } };
  const plan = parseIntent(`object desk "a desk"\nobject jug "a jug of water"\nobject bowl "a bowl"\n\nbowl on desk\n\n@0\n  show bowl\n  keep desk\n@10\n  show bowl\n  jug pours into bowl slow\n@30\n  show desk\n`);
  const out = compose(plan, suggestDesign(plan, view(1080, 1920), theme, [], words, props), { theme, words, frames, props });
  assert.ok(out.decisions.some((d) => d.area === "staging" && /jug over bowl, in the scene/.test(d.choice)), out.decisions.filter((d) => d.area === "staging").map((d) => d.choice).join("; "));
  const { all } = nodesAt(out, Math.round(words[10]!.start * 30) + 2);
  const at = (id: string, name: string) => {
    const p = all.get(`t.${id}`)!.props;
    const d = depictionFrom(props[id]!, theme, { id, look: suggestLook(theme, 1) });
    const q = pointOf(d, name)!;
    return [Number(p.x) + q[0] * Number(p.scaleX), Number(p.y) + q[1] * Number(p.scaleY)] as const;
  };
  const [tip, mouth] = [at("jug", "outlet"), at("bowl", "mouth")];
  assert.ok(Math.abs(tip[0] - mouth[0]) < 1.5 && tip[1] < mouth[1], `the outlet ${tip.map(Math.round)} over the mouth ${mouth.map(Math.round)}`);
  close(at("bowl", "bottom"), at("desk", "top"));
});
