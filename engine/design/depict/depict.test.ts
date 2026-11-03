import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compile } from "../../core/compile.ts";
import { evaluate } from "../../core/evaluate.ts";
import type { NodeSpec, Resolved, Step, Theme } from "../../core/types.ts";
import { themeFrom } from "../../render/theme.ts";
import type { AgentTask, Answer, Reasoner } from "../types.ts";
import {
  changesToSteps, checkSpec, depict, depicterTask, depictionFrom, getSprite, KINDS, loadSprite, pictureDepiction, propNodes, resolve,
  saveSprite, spriteDepiction, spriteRequest, suggestLook, transfer, type Depiction, type PropSpec, type SpriteMaker,
} from "./index.ts";
import { SAMPLES } from "./samples.ts";

const theme: Theme = themeFrom("flat");
const look = suggestLook(theme, 0.4);
const find = (nodes: Resolved[], id: string): Resolved | undefined => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = find(n.children, id);
    if (hit) return hit;
  }
  return undefined;
};
/** Places a depiction in a frame, runs steps, and returns the scene. */
function scene(d: Depiction, w: number, h: number, steps: Step[] = []) {
  const s = Math.min((w * 0.6) / d.box.w, (h * 0.6) / d.box.h);
  const nodes: NodeSpec[] = d.nodes.map((n) => (n.id === d.id ? { ...n, props: { ...n.props, x: w / 2, y: h * 0.8, scaleX: s, scaleY: s } } : n));
  return compile({ steps: [{ at: 0, add: nodes, enter: "none" }, ...steps] }, { fps: 30, width: w, height: h, frames: 150, theme });
}

test("every kind has a sample, and every sample builds and plays in a tall and a wide frame", () => {
  for (const k of Object.keys(KINDS)) assert.ok(SAMPLES.some((s) => s.spec.kind === k), `no sample for ${k}`);
  for (const s of SAMPLES) {
    for (const [w, h] of [[360, 640], [640, 360]] as const) {
      const d = depictionFrom(s.spec, theme, { id: "t", look, text: 30 });
      const steps: Step[] = [];
      for (const [verb, arg] of s.acts) {
        const r = d.act(verb, arg, { frames: s.frames ?? 30, fps: 30 });
        assert.ok(r.known, `${s.name}: ${r.notes.join("; ")}`);
        steps.push(...changesToSteps(r.changes, 5));
      }
      const sc = scene(d, w, h, steps);
      for (const f of [0, 20, 60, 149]) assert.ok(evaluate(sc, f).length > 0, `${s.name} at ${f}`);
      assert.deepEqual(checkSpec(s.spec, { verbs: s.acts.map(([v]) => v) }), [], s.name);
    }
  }
});

test("verbs map to states as each kind declares them", () => {
  const glass = depictionFrom(SAMPLES[0]!.spec, theme, { id: "g", look });
  assert.equal(glass.act("fills", "80%").known, true);
  assert.equal(glass.state.level, 0.8);
  glass.act("turns", "juice");
  assert.equal(glass.state.color, SAMPLES[0]!.spec.colors!.juice, "a color named in the spec, not a lexicon");
  assert.throws(() => glass.act("turns", "purple"), /not one of its colors/);
  assert.equal(glass.act("explodes").known, false, "an unknown verb is reported, not guessed");
  // The same word means what each kind says: a gauge falls in value, a body falls in space.
  const g = depictionFrom(SAMPLES.find((s) => s.name === "thermometer")!.spec, theme, { id: "th", look });
  g.act("falls", 0);
  assert.equal(g.state.value, 0);
  assert.equal(g.state.y, 0);
  const crate = depictionFrom(SAMPLES.find((s) => s.name === "crate")!.spec, theme, { id: "c", look });
  crate.act("fall", 250); // inflection does not matter
  assert.equal(crate.state.y, 250);
  // A spec maps the plan's own words onto the kind's verbs.
  const spec: PropSpec = { ...SAMPLES[0]!.spec, verbs: { "is topped up": { like: "fills" }, "goes cloudy": { sets: [{ state: "color", value: "#ddddddcc" }] } } };
  const d = depictionFrom(spec, theme, { id: "x", look });
  d.act("is topped up");
  assert.equal(d.state.level, 1);
  d.act("goes cloudy");
  assert.equal(d.state.color, "#ddddddcc");
  // Rolling turns one radian per radius travelled.
  const ball = depictionFrom(SAMPLES.find((s) => s.name === "felt ball")!.spec, theme, { id: "b", look });
  ball.act("rolls", Math.PI * 500);
  assert.ok(Math.abs(Number(ball.state.angle) - 180) < 1e-6);
});

test("states animate: apply gives changes the engine plays, and pulses come back", () => {
  const dial = depictionFrom(SAMPLES.find((s) => s.name === "dial")!.spec, theme, { id: "dl", look });
  const changes = dial.apply({ value: 8 }, { frames: 40 });
  assert.ok(changes.some((c) => c.id === "dl.needle" && c.prop === "rotate"));
  const sc = scene(dial, 360, 640, changesToSteps(changes, 10));
  const at = (f: number) => Number(find(evaluate(sc, f), "dl.needle")!.props.rotate);
  assert.ok(at(30) > at(10) && at(30) < at(50), "the needle sweeps through the middle");
  // A flash goes and comes back; the state ends where it began.
  const glass = depictionFrom(SAMPLES[0]!.spec, theme, { id: "g", look });
  const before = glass.state.color;
  const r = glass.act("flashes", "juice", { frames: 20 });
  assert.ok(r.known && r.changes.length >= 2);
  assert.equal(glass.state.color, before);
  // Processes run over time: drops fall, a clock's digits step.
  const drops = depictionFrom(SAMPLES.find((s) => s.name === "drops")!.spec, theme, { id: "dr", look });
  const dr = drops.act("drips", undefined, { frames: 90, fps: 30 });
  assert.ok(dr.known && dr.changes.filter((c) => c.prop === "y").length > 4);
});

test("containers hold real volumes, and transfer moves an amount between two", () => {
  const bur = depictionFrom(SAMPLES.find((s) => s.name === "burette")!.spec, theme, { id: "b", look });
  const glass = depictionFrom(SAMPLES[0]!.spec, theme, { id: "g", look });
  const vb = bur.capacity!.at(Number(bur.state.level));
  const vg = glass.capacity!.at(Number(glass.state.level));
  const t = transfer(bur, glass, 12, { frames: 60 });
  assert.equal(t.moved, 12);
  assert.ok(Math.abs(bur.capacity!.at(Number(bur.state.level)) - (vb - 12)) < 0.05);
  assert.ok(Math.abs(glass.capacity!.at(Number(glass.state.level)) - (vg + 12)) < 0.05);
  assert.match(bur.read!()!, /mL$/);
  assert.ok(t.changes.length > 0);
});

test("checkSpec finds problems a repair round can fix", () => {
  const ok = SAMPLES[0]!.spec;
  const paths = (s: PropSpec, verbs?: string[]) => checkSpec(s, { verbs }).map((p) => p.path);
  assert.deepEqual(paths({ ...ok, kind: "beaker" }), ["kind"]);
  assert.ok(paths({ ...ok, params: { ...ok.params, profile: undefined } }).includes("params.profile"));
  assert.ok(paths({ ...ok, params: { ...ok.params, profile: [[0.5, 0.5], [0.5, 0.2]] } }).some((p) => p.startsWith("params.profile")));
  assert.ok(paths({ ...ok, size: { w: 0.01, h: 50, unit: "m" } }).includes("size"));
  assert.ok(paths({ ...ok, colors: { ...ok.colors, x: "pink" } }).includes("colors.x"));
  assert.ok(paths({ ...ok, colorSources: {} }).some((p) => p.startsWith("colorSources.")));
  assert.ok(paths(ok, ["drips into"]).includes("verbs.drips into"), "drips into needs an outlet this glass has not got");
  assert.ok(paths(ok, ["levitates"]).includes("verbs.levitates"));
  assert.ok(paths({ kind: "body", form: "outline", label: "x", why: "" }).includes("params.outline"));
});

test("the depicter asks through a Reasoner and repairs its answer with the problems", async () => {
  const bad: PropSpec = { kind: "vessel", label: "vase", why: "" };
  const good: PropSpec = { kind: "container", label: "vase", size: { w: 12, h: 30, unit: "cm" }, params: { profile: [[0.3, 0], [0.5, 0.4], [0.2, 0.85], [0.28, 1]], contents: [{ name: "water", level: 0.5, color: "water" }] }, colors: { water: "#bfe3f2cc" }, colorSources: { water: "known: water is clear" }, why: "a vase with water" };
  const asked: AgentTask[] = [];
  const reasoner: Reasoner = { ask: async <T,>(t: AgentTask) => (asked.push(t), { status: "answered", value: (asked.length === 1 ? bad : good) as T } as Answer<T>) };
  const req = { id: "depict.vase", name: "vase", desc: "a tall vase half full of water", acts: [{ verb: "empties" }] };
  const a = await depict(reasoner, req, 3);
  assert.equal(a.status, "answered");
  if (a.status === "answered") (assert.equal(a.rounds, 2), assert.deepEqual(a.problems, []));
  assert.equal(asked[0]!.role, "depicter");
  assert.ok(asked[0]!.schema && asked[0]!.system.includes("container"));
  assert.match(asked[1]!.request, /problems/);
  assert.equal(asked[1]!.id, "depict.vase.r2");
  const pending: Reasoner = { ask: async () => ({ status: "pending", file: "x.json" }) };
  assert.deepEqual(await depict(pending, req, 3), { status: "pending", file: "x.json" });
  assert.ok(!/titrat|burette|tennis|bowling|ticket/i.test(depicterTask(req).system), "the prompt's examples stay off the bench topics");
});

test("sprites: request, cache round trip, and a depiction with tints and moving parts", async () => {
  const root = mkdtempSync(join(tmpdir(), "sprites-"));
  try {
    const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
    const spec: PropSpec = { kind: "sprite", label: "desk lamp", tier: 2, sprite: { parts: [{ name: "shade", phrase: "the lamp shade", changes: ["tint", "turn"] }, { name: "base", phrase: "the round base", changes: ["tint"] }] }, colors: { warm: "#ffcf66" }, colorSources: { warm: "known" }, why: "sample" };
    const req = spriteRequest(spec, "a desk lamp with a cone shade", { name: "flat", art: "flat vector, bold outlines, two tones" });
    assert.match(req.prompt, /flat vector/);
    assert.deepEqual(req.parts.map((p) => p.phrase), ["the lamp shade", "the round base"]);
    let made = 0;
    const maker: SpriteMaker = { make: async () => (made++, { png: fx("lamp.png"), size: [160, 160], masks: { shade: { png: fx("lamp-shade.png"), box: [0.18, 0.18, 0.82, 0.47], anchor: [0.5, 0.47] }, base: { png: fx("lamp-base.png"), box: [0.25, 0.8, 0.75, 0.91] } } }) };
    await assert.rejects(getSprite(req, maker, { value: false, from: "designer", why: "not the subject" }, root), /not allowed/);
    const s1 = await getSprite(req, maker, { value: true, from: "designer", why: "the lamp carries the moment" }, root);
    const s2 = await getSprite(req, maker, { value: false, from: "designer" }, root);
    assert.equal(made, 1, "made once, then reused from the cache");
    assert.equal(s2.key, s1.key);
    assert.deepEqual(s2.parts.shade, s1.parts.shade);
    assert.deepEqual(loadSprite(req.desc, "flat", root)?.parts.shade?.box, [0.18, 0.18, 0.82, 0.47]);
    void saveSprite;
    const d = spriteDepiction("lamp", s1, spec, theme, look);
    assert.equal(d.tier, 2);
    assert.ok(d.parts.shade && d.parts.base);
    const r = d.act("turns", "warm");
    assert.ok(r.known && r.changes.some((c) => c.id === "lamp.tint.shade" && c.prop === "opacity"));
    const turn = d.apply({ "angle.shade": -20 }, { frames: 10 });
    assert.ok(turn.some((c) => c.id === "lamp.part.shade" && c.prop === "rotate"));
    for (const [w, h] of [[360, 640], [640, 360]] as const) assert.ok(evaluate(scene(d, w, h, changesToSteps(turn, 2)), 20).length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pictures: the user's picture zooms to a part, rings it and tints it", () => {
  const card = { name: "dashboard", file: "shot.png", size: [1600, 900] as [number, number], kind: "screenshot", about: "a dashboard", parts: { total: { box: [0.05, 0.1, 0.35, 0.3] as [number, number, number, number], about: "the total" }, chart: { box: [0.4, 0.2, 0.95, 0.9] as [number, number, number, number], about: "the chart" } }, requirements: [], checked: { ok: true, notes: [] } };
  const d = pictureDepiction("pic", card, "shot.png", theme, look, { tier: 3 });
  assert.equal(d.tier, 3);
  const z = d.act("zooms to", "total", { frames: 20 });
  assert.ok(z.known && z.changes.some((c) => c.id === "pic.img" && c.prop === "crop"));
  const crop = z.changes.find((c) => c.prop === "crop")!.value as number[];
  assert.ok(crop[2]! < 1 && crop[0]! <= 0.05 && crop[0]! + crop[2]! >= 0.35, "the view holds the part");
  assert.ok(Math.abs(crop[2]! / crop[3]! - 1) < 1e-3, "the view keeps the picture's shape");
  assert.equal(d.act("marks", "chart").known, true);
  assert.equal(d.state["mark.chart"], 1);
  assert.throws(() => d.act("zooms to", "nothing"), /no part/);
});

test("the prototype's exports still work for the composer", () => {
  const p = resolve("a burette of sodium hydroxide");
  assert.equal(p.shape, "burette");
  const ids: string[] = [];
  propNodes("x", p, (id) => ids.push(id), "ink", "paper", 40);
  assert.ok(ids.length > 10);
});
