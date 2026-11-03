import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../../core/evaluate.ts";
import type { Resolved } from "../../core/types.ts";
import { themeFrom } from "../../render/theme.ts";
import { parseIntent } from "../intent/parse.ts";
import { edgeBand, suggestDesign, viewingFrom } from "../suggest.ts";
import type { Design, PartCard, Viewing } from "../types.ts";
import { compose } from "./compose.ts";

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
const run = (v: Viewing, edit?: (d: Design) => void, plan = PLAN, cards: PartCard[] = []) => {
  const d = suggestDesign(plan, v, theme, cards, words);
  edit?.(d);
  return { d, out: compose(plan, d, { theme, words, frames, cards }) };
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
      const dm = d.demos.find((x) => PLAN.moments[x.moment]!.acts[x.act]!.verb === "falls")!;
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
  compose(PLAN, d, { theme, words, frames });
  const t = performance.now();
  for (let i = 0; i < 5; i++) {
    d.moments[3]!.subjectScale = { value: 0.6 + i * 0.05, from: "search" };
    compose(PLAN, d, { theme, words, frames });
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
