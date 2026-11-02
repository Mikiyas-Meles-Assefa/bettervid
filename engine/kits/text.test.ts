import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "../core/compile.ts";
import { evaluate } from "../core/evaluate.ts";
import type { CompileContext, Measured, MeasureRequest, Resolved } from "../core/types.ts";
import { idsOf } from "../layout/parts.ts";
import { measure } from "./text-browser.ts";
import { layoutText, textKit, textPart, textSet } from "./text.ts";

const theme = { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff" }, fonts: { title: "Arial Black", body: "Georgia" }, moveFrames: 10, ease: "linear" as const };
const ctx = (): CompileContext => ({ fps: 30, width: 1080, height: 1920, frames: 300, kits: [textKit], theme });
const fake = (r: MeasureRequest): Measured => {
  let w = 0;
  return { edges: r.clusters.map((c) => (w += c.length * 0.5)), ascent: 0.8, descent: 0.2 };
};
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
const atoms = (t: ReturnType<typeof layoutText>, s = 0) => t.scenes[s]!.map((p) => p.atom);
const clear = (list: ReturnType<typeof atoms>) => {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i]!, list[j]!];
      const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 - 0.01 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2 - 0.01;
      assert.ok(apart, `${a.key} and ${b.key} overlap`);
    }
  }
};

test("widths are real: a wide letter measures wider than a thin one, in the browser", () => {
  const i = measure({ clusters: ["i"], font: "Georgia", weight: 400 }).edges[0]!;
  const m = measure({ clusters: ["m"], font: "Georgia", weight: 400 }).edges[0]!;
  assert.ok(m > i * 2);
  assert.ok(i > 0.1 && i < 0.5);
  const black = measure({ clusters: ["m"], font: "Arial Black", weight: 400 }).edges[0]!;
  assert.notEqual(black, m);
});

test("kerning is kept: letters that tuck together sit closer than their own widths", () => {
  const pair = measure({ clusters: ["A", "V"], font: "Arial", weight: 400 }).edges[1]!;
  const one = measure({ clusters: ["A"], font: "Arial", weight: 400 }).edges[0]! + measure({ clusters: ["V"], font: "Arial", weight: 400 }).edges[0]!;
  assert.ok(pair < one);
});

test("every letter and word is addressable, and spaces take no part", () => {
  const c = ctx();
  const scene = compile({ steps: [{ at: 0, enter: "none", add: [{ id: "t", kind: "words", data: { text: "Bees dance", size: 80 } }] }, { at: 20, set: { [textPart.letter("t", 4)]: { color: "accent" } } }] }, c);
  const f = evaluate(scene, 40);
  assert.equal(find(f, textPart.letter("t", 4))!.props.text, "d");
  assert.equal(find(f, textPart.letter("t", 4))!.props.color, "#ff0000");
  assert.equal(find(f, textPart.letter("t", 3))!.props.color, "#111111");
  assert.equal(find(f, textPart.word("t", 1))!.children.length, 5);
  assert.equal(idsOf(c, "t", textSet.word(0)).length, 4);
  assert.equal(scene.nodes.filter((n) => n.kind === "text").length, 9);
});

test("no letters overlap, in real fonts, across scripts", () => {
  for (const text of ["Mitochondria make ATP", "WAVE AVATAR", "Über Größe café", "Ελληνικά λέξεις", "русский текст", "光合作用的过程"]) {
    for (const role of ["body", "title"] as const) clear(atoms(layoutText("t", { text, size: 90, role, width: 700 }, ctx())));
  }
});

test("wrapping uses measured widths and keeps words whole", () => {
  const c = ctx();
  const t = layoutText("t", { text: "the quick brown fox jumps over a lazy dog", size: 80, width: 500 }, c);
  const lines = new Set(atoms(t).map((a) => a.y));
  assert.ok(lines.size >= 3);
  for (const y of lines) {
    const row = atoms(t).filter((a) => a.y === y);
    const width = Math.max(...row.map((a) => a.x + a.w / 2)) - Math.min(...row.map((a) => a.x - a.w / 2));
    assert.ok(width <= 500);
  }
  for (const words of new Set(atoms(t).map((a) => a.home![0]))) assert.equal(new Set(atoms(t).filter((a) => a.home![0] === words).map((a) => a.y)).size, 1);
  clear(atoms(t));
});

test("wrapped lines are balanced unless told otherwise", () => {
  const c = { ...ctx(), measure: fake };
  const lines = (balance?: boolean) => {
    const a = atoms(layoutText("t", { text: "aaa aaa aaa aaa a", size: 100, width: 800, balance }, c));
    return [...new Set(a.map((p) => p.y))].map((y) => a.filter((p) => p.y === y).length);
  };
  assert.deepEqual(lines(false), [9, 4].map((n) => (n === 9 ? 12 : 1)));
  assert.deepEqual(lines(), [6, 7]);
});

test("explicit line breaks and alignment work", () => {
  const c = { ...ctx(), measure: fake };
  const left = atoms(layoutText("t", { text: "aaaa\nbb", size: 100, align: "left" }, c));
  assert.equal(left[0]!.x, left[4]!.x);
  const mid = atoms(layoutText("u", { text: "aaaa\nbb", size: 100 }, c));
  assert.ok(mid[4]!.x > mid[0]!.x);
  assert.ok(new Set(mid.map((a) => a.y)).size === 2);
});

test("mixed sizes in a line share a baseline", () => {
  const c = { ...ctx(), measure: fake };
  const a = atoms(layoutText("t", { text: [{ text: "E", size: 200 }, { text: "x", size: 100 }] }, c));
  const base = (p: (typeof a)[number], size: number) => p.y + (0.8 - 0.2) * size / 2;
  assert.ok(Math.abs(base(a[0]!, 200) - base(a[1]!, 100)) < 0.01);
});

test("letters joined by their script stay whole, and right-to-left reads from the right", () => {
  const t = layoutText("t", { text: "سلام دنیا", size: 80 }, ctx());
  const a = atoms(t);
  assert.equal(a.length, 2);
  assert.equal(a[0]!.props.text, "سلام");
  assert.ok(a[0]!.x > a[1]!.x);
});

test("word cuts can be asked for", () => {
  assert.equal(atoms(layoutText("t", { text: "two words", split: "word", size: 80 }, ctx())).length, 2);
});

test("no real font or color comes from a plan: fonts follow the style's role", () => {
  const a = atoms(layoutText("t", { text: "hi", role: "title" }, ctx()));
  assert.equal(a[0]!.props.font, "Arial Black");
  assert.equal(a[0]!.props.color, "ink");
});

test("rearranged words travel, and a word that stays is the same letters", () => {
  const c = { ...ctx(), measure: fake };
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [{ id: "t", kind: "words", data: { states: ["rivers carve canyons", "canyons carve rivers"], size: 80 } }] },
    { at: 30, play: [{ behavior: "become", target: "t", args: { state: 1, frames: 20 } }] },
  ] }, c);
  assert.equal(scene.nodes.filter((n) => n.kind === "text").length, 18, "no new letters were needed");
  const r = textPart.letter("t", 0);
  const abs = (f: number) => {
    const l = find(evaluate(scene, f), r)!;
    const w = find(evaluate(scene, f), textPart.word("t", 0))!;
    return (l.props.x as number) + (w.props.x as number);
  };
  assert.ok(abs(60) > abs(0) + 200, "the first word ends up last");
  assert.ok(abs(40) > abs(0) && abs(40) < abs(60), "and it travels there");
});

test("a word keeps its identity wherever it sits in the sentence, and crossing words arc", () => {
  const c = { ...ctx(), measure: fake };
  const t = layoutText("t", { states: ["ice melts into water", "water melts into ice"], size: 80 }, c);
  const moved = t.scenes[1]!.filter((p) => p.crossed).map((p) => p.atom.key).join("");
  assert.equal(moved, "waterice");
  assert.equal(t.actors.length, 17);
});

test("sets can be recolored and reveal one by one", () => {
  const c = { ...ctx(), measure: fake };
  const scene = compile({ steps: [
    { at: 0, enter: "none", add: [{ id: "t", kind: "words", data: { text: "one two", size: 80 } }] },
    { at: 0, play: [{ behavior: "reveal", target: "t", args: { stagger: 5, frames: 5 } }] },
    { at: 50, play: [{ behavior: "each", target: "t", args: { part: textSet.word(1), color: "accent" } }] },
  ] }, c);
  const l = (n: number, f: number) => find(evaluate(scene, f), textPart.letter("t", n))!.props;
  assert.equal(l(5, 5).opacity, 0);
  assert.equal(l(0, 5).opacity, 1);
  assert.equal(l(0, 49).color, "#111111");
  assert.equal(l(3, 49).color, "#111111");
  assert.equal(l(3, 80).color, "#ff0000");
  assert.equal(l(0, 80).color, "#111111");
});

test("an unknown set fails loudly", () => {
  const c = { ...ctx(), measure: fake };
  assert.throws(() => compile({ steps: [{ at: 0, add: [{ id: "t", kind: "words", data: { text: "x" } }], play: [{ behavior: "each", target: "t", args: { part: "word.9", color: "accent" } }] }] }, c), /no part called/);
  assert.throws(() => compile({ steps: [{ at: 0, add: [{ id: "t", kind: "words", data: {} }] }] }, c), /needs text/);
});
