// Steadiness: the composer never moves, resizes, adds or removes anything on its own. What stays keeps its place and
// size unless a move asks; what is new takes free room; the moment before's words have left before new words arrive;
// a thing the words still name stays; nothing appears that no one asked for; and every move of the vocabulary is
// carried out when an agent picks it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../../core/evaluate.ts";
import type { Resolved, Scene } from "../../core/types.ts";
import { themeFrom } from "../../render/theme.ts";
import { carryAccent, carryChange, carryEnter, carryExit, MOVE_VOCABULARY, Writer } from "../abilities/index.ts";
import type { PropSpec } from "../depict/index.ts";
import { parseIntent } from "../intent/parse.ts";
import { suggestDesign, viewingFrom } from "../suggest.ts";
import type { Design, IntentPlan, MoveChoice, Viewing, Word } from "../types.ts";
import { compose } from "./compose.ts";

const theme = themeFrom("chalkboard");
const view: Viewing = viewingFrom({ width: 1080, height: 1920, fps: 30, screen: "a test screen", frameWidthMm: 300, distanceMm: 600, watch: "on purpose", uiZones: [], why: "a test" });
const ball = (label: string, cm: number, color: string): PropSpec => ({ kind: "body", form: "sphere", label, size: { w: cm, h: cm, unit: "cm" }, colors: { body: color }, colorSources: { body: "known: a test" }, why: "a test" });
const PROPS: Record<string, PropSpec> = { big: ball("big ball", 22, "#202020"), small: ball("small ball", 7, "#d8d020") };
// The words of the narration, one every 0.4 s; some name the balls, as narration does.
const said = "a big ball and a small ball dropped from one height at one moment which lands first they land together gravity speeds up every object at the same rate whatever its mass only air can split them and for these two it barely matters at all in the end".split(" ");
const words: Word[] = said.map((text, i) => ({ text, start: 0.2 + i * 0.4 }));
const frames = Math.ceil((words.at(-1)!.start + 1.5) * 30);
const PLAN = parseIntent(`thing rule "same rate"
thing air "air resistance"
thing barely "barely matters"
object big "a big ball"
object small "a small ball"

@0
  show big
@3
  show small
  keep big
@15
  ask "Which first?"
  show big
  keep small
@19
  reveal big
  keep small
  big small fall
@21
  show rule
  keep big small
@33
  show air
  keep big small
@40
  show barely
  keep air
`);
const run = (edit?: (d: Design) => void, plan: IntentPlan = PLAN, w: Word[] = words) => {
  const d = suggestDesign(plan, view, theme, [], w, PROPS);
  edit?.(d);
  return compose(plan, d, { theme, words: w, frames, props: PROPS });
};
const flat = (scene: Scene, f: number) => {
  const all = new Map<string, Resolved>();
  const walk = (rs: Resolved[]) => rs.forEach((r) => (all.set(r.id, r), walk(r.children)));
  walk(evaluate(scene, f));
  return all;
};
const num = (v: unknown) => Number(v ?? 0);
/** Where a node rests late in moment k (just before the next starts): x, y, scale and opacity. */
const restIn = (out: ReturnType<typeof compose>, k: number, id: string) => {
  const end = out.onsets[k + 1] ?? frames;
  const p = flat(out.scene, Math.max(out.onsets[k]!, end - 3)).get(id)?.props;
  return p ? { x: num(p.x), y: num(p.y), s: num(p.scaleX), op: num(p.opacity ?? 1) } : undefined;
};
const moves = (d: Design, k: number, list: MoveChoice[]) => (d.moments[k]!.moves = { value: list, from: "designer", why: "a test" });

test("what stays and no move asks keeps its box: across moments, the same place and size", () => {
  const out = run();
  // The balls stand on one stage from the first moment on: the room for the small one is kept before it arrives, and
  // neither moves or resizes when a question, words or a caption come and go (only the fall the plan asks moves them).
  const same = (a: ReturnType<typeof restIn>, b: ReturnType<typeof restIn>, what: string) => {
    assert.ok(a && b, what);
    assert.ok(Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.s - b.s) < 1e-6, `${what}: ${JSON.stringify(a)} then ${JSON.stringify(b)}`);
  };
  for (const [a, b] of [[0, 1], [1, 2]] as const) same(restIn(out, a, "t.big"), restIn(out, b, "t.big"), `big from m${a} to m${b}`);
  for (const [a, b] of [[1, 2], [4, 5]] as const) same(restIn(out, a, "t.small"), restIn(out, b, "t.small"), `small from m${a} to m${b}`);
  same(restIn(out, 4, "t.big"), restIn(out, 5, "t.big"), "big after the fall, while words arrive");
  // Words that stay (air, from m5 into m6) keep their box while the next subject takes the free room.
  const b5 = out.boxes.find((m) => m.moment === 5)!.boxes.air!;
  const b6 = out.boxes.find((m) => m.moment === 6)!.boxes.air!;
  assert.deepEqual(b6.map((x) => +x.toFixed(4)), b5.map((x) => +x.toFixed(4)));
  same(restIn(out, 5, "t.air"), restIn(out, 6, "t.air"), "air from m5 to m6");
  assert.ok(out.decisions.some((d) => d.area === "steadiness" && /air keep their place and size/.test(d.choice)));
  assert.deepEqual(out.notes.filter((n) => /overlap/.test(n)), []);
});

test("nothing appears that no one asked for: the style's placeholder is a suggestion until an agent keeps it", () => {
  const plain = run();
  assert.ok(!plain.scene.nodes.some((n) => n.id === "ph"), "no placeholder drawn on the style's say-so");
  assert.ok(plain.decisions.some((d) => d.area === "proposal" && /suggested, not drawn: placeholder/.test(d.choice)));
  const asked = run((d) => (d.moments[2]!.proposals = d.moments[2]!.proposals.map((p) => ({ ...p, from: "designer" as const }))));
  assert.ok(asked.scene.nodes.some((n) => n.id === "ph"), "kept by the designer, it is drawn");
  // Every node shown in a moment is a thing the plan or an agent names there, its parts, or what an ability it asked for draws.
  const named = new Set(PLAN.things.map((t) => t.id));
  const tops = plain.scene.nodes.filter((x) => !x.parent || !plain.scene.nodes.some((y) => y.id === x.parent && y.id !== "camera" && !y.id.startsWith("__")));
  assert.ok(tops.length > 5);
  for (const n of tops) {
    const base = n.id.replace(/^[tpk]\./, "").split(".")[0]!;
    assert.ok(named.has(base) || /^(q|floor|level|fall|trail|ghost|camera|bloom|flow|read|readmark|strike|vbar|arrow|parrow|lab)$/.test(n.id.split(".")[0]!), `${n.id} is asked for by someone`);
  }
});

test("the moment before's words have left before new words arrive", () => {
  const out = run();
  const texts = out.scene.nodes.filter((n) => /^(t\.(rule|air|barely)|q\.\d+)$/.test(n.id)).map((n) => n.id);
  assert.equal(texts.length, 4);
  let checked = 0;
  for (let k = 1; k < out.onsets.length; k++) {
    const t0 = out.onsets[k]!;
    const end = out.onsets[k + 1] ?? frames;
    const seen = (id: string, f: number) => num(flat(out.scene, f).get(id)?.props.opacity) > 0.02;
    const leaving = texts.filter((id) => seen(id, t0 - 1) && !seen(id, end - 2));
    const arriving = texts.filter((id) => !seen(id, t0 - 1) && seen(id, end - 2));
    if (!leaving.length || !arriving.length) continue;
    checked++;
    const first = (f0: number, ok: (f: number) => boolean) => {
      for (let f = f0; f < end; f++) if (ok(f)) return f;
      return end;
    };
    const gone = first(t0, (f) => leaving.every((id) => !seen(id, f)));
    const shown = first(t0, (f) => arriving.some((id) => seen(id, f)));
    assert.ok(gone <= shown, `m${k}: ${leaving.join(", ")} still on screen at ${shown} when ${arriving.join(", ")} arrive (gone at ${gone})`);
  }
  assert.ok(checked >= 1, "a moment where words leave and others arrive");
});

test("a thing the words still name, or refer to, stays while they are about it", () => {
  // The last moment's words say "these two" and the plan drops the balls: they stay when an agent says the words
  // still refer to them, and leave when no one does.
  const gone = run();
  assert.ok(num(restIn(gone, 6, "t.big")?.op) < 0.02, "dropped by the plan, and nobody says the words refer to it");
  const kept = run((d) => (d.moments[6]!.refers = { value: ["big", "small"], from: "director", why: "for these two" }));
  assert.ok(num(restIn(kept, 6, "t.big")?.op) > 0.5 && num(restIn(kept, 6, "t.small")?.op) > 0.5);
  assert.ok(kept.decisions.some((d) => d.area === "continuity" && /big stays/.test(d.choice)));
  // Words that name a thing keep it: here the last words say "the big ball".
  const w2 = words.map((x, i) => (i === words.length - 3 ? { ...x, text: "big" } : i === words.length - 2 ? { ...x, text: "ball" } : x));
  const named = run(undefined, PLAN, w2);
  assert.ok(num(restIn(named, 6, "t.big")?.op) > 0.5, "the words name the big ball: it stays");
  assert.ok(named.decisions.some((d) => d.area === "continuity" && /big stays/.test(d.choice) && /still name it/.test(d.why)));
});

test("a re-layout is asked with a move and carried out by it; without one, nothing travels", () => {
  // Spring the balls into this moment's own layout at m5: the stage is composed again and they go there on a spring.
  const out = run((d) => moves(d, 4, [{ move: "spring", ids: ["big", "small"], why: "settle into the new picture" }]));
  assert.ok(out.decisions.some((d) => d.area === "stage" && /composed again/.test(d.choice)));
  assert.ok(out.doc.steps.some((s) => s.play?.some((p) => p.behavior === "spring" && p.target === "t.big")));
  assert.ok(out.decisions.some((d) => d.area === "motion" && /big changes by spring/.test(d.choice)));
  // Without the move no spring is played anywhere.
  assert.ok(!run().doc.steps.some((s) => s.play?.some((p) => p.behavior === "spring")));
});

test("each move of the vocabulary is carried out when picked", () => {
  const ctx = { fps: 30, width: 1080, height: 1920, frames: 12 };
  const fresh = () => {
    const w = new Writer(1080, 1920);
    w.node("a", "group", { x: 100, y: 100, scaleX: 1, scaleY: 1, opacity: 1 });
    w.node("bar", "path", { points: [0, 0, 10, 0, 10, 10, 0, 10], opacity: 1 });
    w.node("b", "group", { x: 900, y: 900 });
    return w;
  };
  const to: [string, string, number][] = [["a", "x", 500], ["a", "y", 700], ["a", "scaleX", 2], ["a", "scaleY", 2], ["a", "opacity", 1]];
  const plays = (w: Writer, b: string) => w.plays.some((p) => p.behavior === b);
  const xOps = (w: Writer) => w.ops.filter((o) => o.id === "a" && o.prop === "x");
  const used = new Set<string>();
  for (const m of MOVE_VOCABULARY) {
    for (const use of m.uses) {
      const w = fresh();
      const c: MoveChoice = { move: m.name, ids: [], as: use, args: m.name === "follow" ? { via: [[0.5, 0.2]] } : use === "enter" && (m.name === "travel" || m.name === "arc") ? { from: "left" } : use === "exit" && m.name === "travel" ? { to: "right" } : m.name === "orbit" ? { radius: 0.05 } : {}, why: "a test" };
      if (use === "change") {
        if (m.name === "morph") {
          const r = carryChange(w, "bar", [["bar", "points", [0, 0, 20, 0, 20, 20, 0, 20]]], c, 10, ctx);
          assert.ok(plays(w, "morph") && r.frames > 0, "morph reshapes the outline");
        } else {
          const r = carryChange(w, "a", to, c, 10, ctx);
          if (m.name === "stay") assert.equal(w.ops.length + w.plays.length, 0, "stay changes nothing");
          else if (m.name === "travel") assert.ok(xOps(w)[0]!.frames > 1);
          else if (m.name === "cut") assert.equal(xOps(w)[0]!.frames, 1);
          else if (m.name === "fade") assert.ok(w.ops.some((o) => o.id === "a" && o.prop === "opacity" && o.value === 0));
          else assert.ok(plays(w, m.name), `${m.name} plays its behavior`);
          assert.ok(m.name === "stay" || r.frames > 0);
        }
      } else if (use === "enter") {
        const r = carryEnter(w, "a", to, c, 10, 9, 50, ctx);
        if (m.name === "fade") assert.equal(r.frames, 0, "fade is the usual way in, left to the composer");
        else if (m.name === "drop") assert.ok(plays(w, "fall") && w.ops.some((o) => o.prop === "y" && (o.value as number) < 700));
        else if (m.name === "spring") assert.ok(plays(w, "spring"));
        else if (m.name === "arc") assert.ok(plays(w, "arc"));
        else if (m.name === "travel") assert.ok(w.ops.some((o) => o.prop === "x" && o.value === -50));
        else if (m.name === "cut") assert.equal(xOps(w)[0]!.frames, 1);
        assert.ok(m.name === "fade" || r.frames > 0, `${m.name} in`);
      } else if (use === "exit") {
        const r = carryExit(w, "a", c, 10, 50, ctx);
        if (m.name === "fade") assert.equal(r.frames, 0);
        else assert.ok(r.frames > 0 && w.ops.some((o) => o.prop === "opacity" && o.value === 0), `${m.name} out`);
      } else {
        const r = carryAccent(w, "a", c, 10, 100, ctx, m.name === "orbit" ? "b" : undefined);
        assert.ok(plays(w, m.name) && r.frames > 0, `${m.name} as an accent`);
      }
      used.add(`${m.name}:${use}`);
    }
  }
  assert.equal(used.size, MOVE_VOCABULARY.reduce((s, m) => s + m.uses.length, 0));
});

test("moves picked in a design are carried out by the composer: drop in, squash, wiggle, cut out", () => {
  const out = run((d) => {
    moves(d, 4, [{ move: "drop", ids: ["rule"], why: "land the rule" }, { move: "squash", ids: ["big"], why: "a beat" }]);
    moves(d, 5, [{ move: "wiggle", ids: ["air"], args: { size: 4 }, why: "restless air" }, { move: "cut", ids: ["rule"], why: "gone at once" }]);
  });
  const played = (b: string, t: string) => out.doc.steps.some((s) => s.play?.some((p) => p.behavior === b && p.target === t));
  assert.ok(played("fall", "t.rule"), "the rule drops in");
  assert.ok(played("squash", "t.big"), "the big ball squashes");
  assert.ok(played("wiggle", "t.air"), "air wiggles");
  assert.ok(out.decisions.some((d) => d.area === "motion" && /rule leaves by cut/.test(d.choice)));
});
