import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "../core/compile.ts";
import { evaluate } from "../core/evaluate.ts";
import type { CompileContext, Resolved } from "../core/types.ts";
import { boundsOf, layoutKit, placeAll } from "../layout/kit.ts";
import { inFrame } from "../layout/arrange.ts";
import { joinRings, glyph, svgRings } from "./math-font.ts";
import { layoutMath, mathKit, mathPart, mathSet } from "./math.ts";

const theme = { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" as const };
const ctx = (): CompileContext => ({ fps: 30, width: 1080, height: 1920, frames: 300, kits: [mathKit], theme });
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
const keys = (latex: string) => layoutMath("m", { latex }, ctx()).scenes[0]!.map((p) => p.atom.key);

test("glyph outlines come from the font: holes and pieces survive joining", () => {
  const a = glyph("KaTeX_Main-Regular", "=");
  assert.equal(a.rings.length, 2);
  assert.ok(a.advance > 0.5);
  const flat = joinRings(a.rings);
  assert.equal(flat.length % 2, 0);
  assert.ok(flat.length > a.rings.flat().length * 2);
  assert.throws(() => glyph("KaTeX_Main-Regular", "中"), /no glyph/);
});

test("path data flattens: lines, curves and relative moves", () => {
  const [r] = svgRings("M0 0H10V10l-10 0z");
  assert.deepEqual(r!.slice(0, 4), [[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.ok(svgRings("M0 0c1 1 2 2 3 3 s1 1 2 2z")[0]!.length > 8);
  assert.throws(() => svgRings("M0 0A1 1 0 0 0 2 2z"), /unsupported/);
});

test("every symbol is a part, in reading order", () => {
  assert.deepEqual(keys("E=mc^2"), ["E", "=", "m", "c", "2"]);
  const s = keys(String.raw`\frac{a+b}{2}`);
  assert.deepEqual(s, ["a", "+", "b", "rule", "2"]);
});

test("symbols are plain paths that can change one by one", () => {
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [{ id: "m", kind: "math", data: { latex: "a^2+b^2=c^2", size: 80 } }] },
    { at: 20, set: { [mathPart.symbol("m", 0)]: { fill: "accent" } } },
  ] }, ctx());
  assert.ok(scene.nodes.filter((n) => n.id !== "m").every((n) => n.kind === "path"));
  const f = evaluate(scene, 40);
  assert.equal(find(f, mathPart.symbol("m", 0))!.props.fill, "#ff0000");
  assert.equal(find(f, mathPart.symbol("m", 1))!.props.fill, "#111111");
});

test("fractions: numerator above the bar, denominator below, both real groups", () => {
  const scene = compile({ steps: [{ at: 0, enter: "none", add: [{ id: "m", kind: "math", data: { latex: String.raw`\frac{p}{q}`, size: 100 } }] }] }, ctx());
  const f = evaluate(scene, 0);
  const top = find(f, mathPart.num("m", 0))!;
  const bottom = find(f, mathPart.den("m", 0))!;
  assert.equal(top.children.length, 1);
  assert.equal(bottom.children.length, 1);
  assert.ok((top.props.y as number) < (bottom.props.y as number));
});

test("nested fractions keep their structure", () => {
  const c = layoutMath("m", { latex: String.raw`\frac{1}{1+\frac{1}{x}}` }, ctx());
  const names = c.groups.map((g) => g.name);
  for (const n of ["frac.0.num", "frac.0.den", "frac.1.num", "frac.1.den"]) assert.ok(names.includes(n), n);
  assert.equal(c.groups.find((g) => g.name === "frac.1")!.parent, "m.frac.0.den");
});

test("matrices: rows and columns are both sets, and rows are real groups", () => {
  const x = ctx();
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [{ id: "m", kind: "math", data: { latex: String.raw`\begin{bmatrix}1&2&3\\4&5&6\end{bmatrix}`, size: 80 } }] },
    { at: 20, play: [{ behavior: "each", target: "m", args: { part: mathSet.col(1), color: "accent" } }] },
    { at: 40, set: { [mathPart.row("m", 1)]: { y: 300 } } },
  ] }, x);
  const f = evaluate(scene, 80);
  const row = find(f, mathPart.row("m", 1))!;
  assert.equal(row.props.y, 300);
  const fills = (r: Resolved): unknown[] => (r.kind === "path" ? [r.props.fill] : r.children.flatMap(fills));
  assert.deepEqual(fills(find(f, mathPart.cell("m", 0, 1))!), ["#ff0000"]);
  assert.deepEqual(fills(find(f, mathPart.cell("m", 1, 1))!), ["#ff0000"]);
  assert.deepEqual(fills(find(f, mathPart.cell("m", 1, 0))!), ["#111111"]);
  assert.equal(find(f, mathPart.row("m", 0))!.children.length, 3);
});

test("stretchy shapes become parts: roots, tall brackets", () => {
  const s = keys(String.raw`\sqrt{\left(\frac{x}{y}\right)}`);
  assert.ok(s.length >= 5);
  const c = layoutMath("m", { latex: String.raw`\sqrt{x}` }, ctx());
  const root = c.scenes[0]!.map((p) => p.atom).find((a) => a.key !== "x")!;
  assert.ok(root.w > 10, "the root sign reaches over its contents");
  assert.ok(root.w < 300, "and stops there, instead of its hidden tail");
});

test("varied notation typesets: calculus, sets, chemistry, statistics", () => {
  for (const tex of [String.raw`\int_0^\infty e^{-x^2}\,dx=\frac{\sqrt\pi}{2}`, String.raw`\forall x\in\mathbb{R},\ x^2\ge0`, String.raw`\text{H}_2\text{O}\rightarrow\text{H}^+ + \text{OH}^-`, String.raw`\bar{x}=\frac{1}{n}\sum_{i=1}^n x_i`, String.raw`\begin{cases}x&x>0\\-x&x\le0\end{cases}`, String.raw`\hat{y}=\mathbf{w}^\top\mathbf{x}`]) {
    assert.ok(keys(tex).length > 3, tex);
  }
});

test("bad latex fails loudly", () => {
  assert.throws(() => layoutMath("m", { latex: String.raw`\frac{1}{` }, ctx()));
  assert.throws(() => layoutMath("m", {}, ctx()), /needs latex/);
});

test("an equation rearranges: matching symbols keep their identity and travel", () => {
  const data = { states: ["x+2=5", "x=5-2", "x=3"], size: 100, keep: "=" };
  const c = layoutMath("m", data, ctx());
  const id = (s: number, key: string) => c.scenes[s]!.find((p) => p.atom.key === key)!.actor.id;
  assert.equal(id(0, "x"), id(1, "x"));
  assert.equal(id(0, "2"), id(1, "2"), "the 2 is the same 2 on the other side");
  assert.equal(id(0, "5"), id(1, "5"));
  assert.ok(c.scenes[1]!.find((p) => p.atom.key === "2")!.crossed);
  const eq = (s: number) => c.scenes[s]!.find((p) => p.atom.key === "=")!.atom.x;
  assert.equal(eq(0), eq(1));
  assert.equal(eq(1), eq(2));

  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [{ id: "m", kind: "math", data }] },
    { at: 10, play: [{ behavior: "become", target: "m", args: { state: 1, frames: 20 } }] },
    { at: 50, play: [{ behavior: "become", target: "m", args: { state: 2, frames: 20 } }] },
  ] }, ctx());
  const at = (i: string, f: number) => find(evaluate(scene, f), i)!.props;
  assert.equal(at(id(0, "+"), 0).opacity, 1);
  assert.equal(at(id(0, "+"), 40).opacity, 0, "the plus leaves");
  assert.ok(Math.abs((at(id(0, "2"), 40).x as number) - c.scenes[1]!.find((p) => p.atom.key === "2")!.atom.x) < 0.01);
  const mid = at(id(0, "2"), 20).y as number;
  assert.ok(Math.abs(mid - (at(id(0, "2"), 0).y as number)) > 40, "a symbol changing sides lifts over the others");
  assert.equal(at(id(2, "3"), 0).opacity, 0);
  assert.equal(at(id(2, "3"), 90).opacity, 1, "the answer arrives");
});

test("a symbol changing size stays itself, by changing its outline", () => {
  const data = { states: ["x^2", "2x"], size: 100 };
  const c = layoutMath("m", data, ctx());
  const two = (s: number) => c.scenes[s]!.find((p) => p.atom.key === "2")!;
  assert.equal(two(0).actor.id, two(1).actor.id);
  assert.ok(two(1).atom.h > two(0).atom.h);
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [{ id: "m", kind: "math", data }] },
    { at: 0, play: [{ behavior: "become", target: "m", args: { state: 1, frames: 10 } }] },
  ] }, ctx());
  const pts = (f: number) => find(evaluate(scene, f), two(0).actor.id)!.props.points as number[];
  assert.ok(Math.max(...pts(30)) > Math.max(...pts(0)));
});

test("layout makes room for every state of an equation, even one pinned off center", () => {
  const c = { ...ctx(), kits: [mathKit, layoutKit] };
  const data = { states: ["x+200=5", "x=5-200000000"], size: 170, keep: "=" };
  const cast = layoutMath("m", data, c);
  const box = boundsOf({ id: "m", kind: "math", data }, c);
  const reach = Math.max(...cast.scenes.flat().map((p) => p.atom.x + p.atom.w / 2));
  assert.ok(box.right >= reach - 0.01);
  const { items, placed } = placeAll({ items: [{ id: "m", kind: "math", data }] }, c);
  assert.ok(inFrame(items, placed, c));
});

test("parts moving up or down arc sideways, so swapped rows do not pass through each other", () => {
  const data = { states: [String.raw`\begin{matrix}1\\2\end{matrix}`, String.raw`\begin{matrix}2\\1\end{matrix}`], size: 200 };
  const cast = layoutMath("m", data, ctx());
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [{ id: "m", kind: "math", data }] },
    { at: 0, play: [{ behavior: "become", target: "m", args: { state: 1, frames: 24 } }] },
  ] }, ctx());
  const moved = cast.scenes[1]!.filter((p) => p.crossed);
  assert.ok(moved.length >= 1);
  const shift = (id: string) => {
    const start = cast.scenes[0]!.find((p) => p.actor.id === id)!.atom.x;
    return (find(evaluate(scene, 12), id)!.props.x as number) - start;
  };
  assert.ok(Math.abs(shift(moved[0]!.actor.id)) > 40, "an up or down move bends sideways");
});

test("named parts match across states whatever they contain", () => {
  const c = layoutMath("m", { states: [String.raw`\part{a}{xy}+1`, String.raw`1+\part{a}{xy}`] }, ctx());
  const x = (s: number) => c.scenes[s]!.find((p) => p.atom.key.codePointAt(0) === "x".codePointAt(0) || p.atom.key === "𝑥")!;
  assert.equal(x(0).actor.id, x(1).actor.id);
  assert.equal(c.scenes[0]!.filter((p) => p.atom.of?.includes(mathSet.named("a"))).length, 2);
});
