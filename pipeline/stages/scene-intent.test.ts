// The intent path of the scene step without a model: the plan's checks, the request, one composition, and composed
// parts laid over the language scene in their own windows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../../engine/core/evaluate.ts";
import type { Resolved, Scene } from "../../engine/core/types.ts";
import { compose } from "../../engine/design/compose/compose.ts";
import { suggestDesign } from "../../engine/design/suggest.ts";
import { checkPlan, intentSystem, materialText, wholeLanguage } from "../lib/intent-author.ts";
import { parseIntent } from "../../engine/design/intent/parse.ts";
import { viewingFrom } from "../../engine/design/suggest.ts";
import { designRunner } from "../lib/design-run.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import { loadLibrary } from "../../engine/language/library.ts";
import type { PartCard } from "../../engine/design/types.ts";
import type { Project } from "../../schemas/project.ts";
import { gateScenes, intentRequestFor, mapSources, SCENE_KITS, windowKeys } from "./scene.ts";

const words = "A bee visits about fifty flowers on one trip. To make one spoon of honey the hive needs how many trips? Around four hundred.".split(" ").map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35 }));
const range = { id: "s1", firstWord: 0, lastWord: words.length - 1 };
const PLAN = `feel warm
thing trip "one trip"
many flowers 50 "flower"
thing trips "400 trips"
@0
  show trip
@4
  show flowers
  keep trip
@21
  reveal trips
`;

test("a sound plan has no problems; moments outside the part and a late start are reported", () => {
  assert.deepEqual(checkPlan(PLAN, words, [], range).problems, []);
  const late = checkPlan(PLAN.replace("@0", "@1"), words, [], { ...range, lastWord: 10 });
  assert.ok(late.problems.some((x) => /starts at word 0/.test(x)));
  assert.ok(late.problems.some((x) => /@21 is outside your words/.test(x)));
});

test("an answer wholly in the scene language is recognized, so it takes the language path", () => {
  assert.equal(wholeLanguage(parseIntent(`@0\n  text a "Hello" size=big\n@4 keep\n  text b "There"\n`)), true);
  assert.equal(wholeLanguage(parseIntent(PLAN)), false);
  assert.equal(checkPlan(`@0\n  text a "Hello" size=big\n`, words, [], range).language, true);
});

test("the request names the part's words and the material by its parts; the system teaches what may be pinned", () => {
  const p = { narration: { words: words.map((w) => ({ ...w, beatId: "b1" })), holds: [] } } as unknown as Project;
  const card: PartCard = { name: "chart", file: "chart.png", kind: "chart", about: "sales by year", parts: { jump: { box: [0.5, 0.2, 0.1, 0.3], about: "the 2021 bar" } }, requirements: [], checked: { ok: true, notes: [] } };
  const req = intentRequestFor(p, [range], 0, [{ shows: "", handoff: [] }], "Topic: bees\n\n", materialText([card]));
  assert.match(req, /Your first moment is `@0`/);
  assert.match(req, /chart\.jump \(the 2021 bar\)/);
  assert.match(req, /^21 8\.4 Around$/m);
  const system = intentSystem({ kits: SCENE_KITS, programs: loadLibrary() });
  assert.match(system, /# Pinned lines/);
  assert.doesNotMatch(req, /`image id asset=NAME`/);
});

function ids(nodes: Resolved[], out: Map<string, number> = new Map()): Map<string, number> {
  for (const n of nodes) {
    out.set(n.id, Number(n.props.opacity ?? 1));
    ids(n.children, out);
  }
  return out;
}

test("window keys cut in one frame, and touching windows are one", () => {
  assert.deepEqual(windowKeys([{ from: 10, to: 20 }], 1, 0), [{ at: 0, value: 0 }, { at: 9, value: 0 }, { at: 10, value: 1 }, { at: 19, value: 1 }, { at: 20, value: 0 }]);
  assert.deepEqual(windowKeys([{ from: 0, to: 5 }, { from: 5, to: 9 }], 0, 1), [{ at: 0, value: 0 }, { at: 8, value: 0 }, { at: 9, value: 1 }]);
});

test("a composed part shows only in its window, over a language scene hidden there", async () => {
  const theme = themeFrom("flat");
  const viewing = viewingFrom({ width: 1080, height: 1920, fps: 30, screen: "phone", frameWidthMm: 65, distanceMm: 300, watch: "glancing", why: "test" });
  // A composed part (here the style's suggested design, composed once: gating does not depend on how it was designed).
  const plan = parseIntent(PLAN);
  const out = compose(plan, suggestDesign(plan, viewing, theme, [], words), { theme, words, frames: 300 });
  assert.ok(out.scene.nodes.length > 0);
  const base: Scene = { fps: 30, width: 1080, height: 1920, frames: 300, background: "#fff", nodes: [{ id: "title", kind: "text", props: { text: "Hi", opacity: 1 } }], tracks: [], events: [] };
  const whole = gateScenes(base, [{ id: "s2", scene: out.scene, from: 100, to: 200 }]);
  const before = ids(evaluate(whole, 50));
  const during = ids(evaluate(whole, 150));
  const after = ids(evaluate(whole, 250));
  assert.equal(before.get("language__"), 1);
  assert.equal(before.get("s2__"), 0);
  assert.equal(during.get("language__"), 0);
  assert.equal(during.get("s2__"), 1);
  assert.equal(after.get("s2__"), 0);
  assert.ok([...during.keys()].filter((k) => k.startsWith("s2__")).length === out.scene.nodes.length + 1);
});

test("the scene stage's design brain is the whole run with the real agents, not a composition without agents", () => {
  const { run, agents } = designRunner();
  assert.equal(run.length, 4);
  assert.ok(agents?.checkDirector && agents.checkDesigner && agents.checkViewer && agents.applyCorrections);
});

test("image sources map both ways", () => {
  const s: Scene = { fps: 30, width: 10, height: 10, frames: 10, background: "#fff", nodes: [{ id: "a", kind: "image", props: { src: "data:x" } }], tracks: [{ target: "a", prop: "src", keys: [{ at: 0, value: "data:x" }] }], events: [] };
  const m = mapSources(s, (x) => (x === "data:x" ? "pics/a.png" : x));
  assert.equal(m.nodes[0]!.props.src, "pics/a.png");
  assert.equal(m.tracks[0]!.keys[0]!.value, "pics/a.png");
});
