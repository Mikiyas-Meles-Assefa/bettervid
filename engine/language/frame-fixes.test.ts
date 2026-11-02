// Frame faults found in the wave 1 reruns, as general abilities: changes between states never leave the board bare
// or old words under new ones, attached words fit the view (two lines, or a callout with a line back), a camera set
// earlier follows words that arrive under it, what still does not fit says exactly what to change, a card sits under
// its words, tables line up, formulas take their role's color, rings hug in tight places, words are measured in the
// style's real fonts, and states that crowd or leave the frame empty are noted.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../core/evaluate.ts";
import type { CompileContext, Resolved, Scene, Theme } from "../core/types.ts";
import { themeFrom } from "../render/theme.ts";
import { mathKit } from "../kits/math.ts";
import { craftNotes, tableRows } from "./author.ts";
import { build, formatProblems } from "./build.ts";
import { estimate, safeArea } from "./layout.ts";
import { tableMeasure, type FontTable } from "./measure.ts";
import { parse } from "./syntax.ts";

const words = Array.from({ length: 80 }, (_, i) => ({ start: i * 0.5 }));
const plain: Theme = { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff", highlight: "#ffff00" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" };
const ctxOf = (theme: Theme = plain): CompileContext => ({ fps: 30, width: 1080, height: 1920, frames: 1200, words, theme, kits: [mathKit] });
const pics = { assets: { photo: "/a.jpg" } };
const ok = async (src: string, extra: Record<string, unknown> = {}, theme?: Theme) => {
  const r = await build(src, { ctx: ctxOf(theme), ...extra });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  return r;
};
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
const opacity = (s: Scene, f: number, id: string) => {
  // Seen opacity: the part's own, times every parent's.
  const walk = (list: Resolved[], o: number): number | undefined => {
    for (const r of list) {
      const here = o * Number(r.props.opacity ?? 1);
      if (r.id === id) return here;
      const deep = walk(r.children, here);
      if (deep !== undefined) return deep;
    }
  };
  return walk(evaluate(s, f), 1) ?? 0;
};

test("a plain state that replaces the board never leaves it empty, and what leaves is nearly gone before what arrives is half in", async () => {
  const { scene } = await ok(`@0\ntext a "The old heading here" size=big\nbox b "old" w=600 h=400\n@10\ntext c "A new heading here" size=big\nbox d "new" w=600 h=400\n`);
  const at = 10 * 15;
  for (let f = at - 2; f <= at + 20; f++) {
    const seen = Math.max(opacity(scene!, f, "a"), opacity(scene!, f, "c"));
    assert.ok(seen >= 0.2, `frame ${f}: the board is nearly empty (${seen.toFixed(2)})`);
  }
  // No ghost: once the new heading is half in, the old one is all but gone.
  const half = Array.from({ length: 30 }, (_, i) => at + i).find((f) => opacity(scene!, f, "c") >= 0.5)!;
  assert.ok(opacity(scene!, half, "a") <= 0.15, `old heading still at ${opacity(scene!, half, "a")}`);
});

test("something dropped where another thing moves in leaves quickly, not under it", async () => {
  const { scene } = await ok(`@0\ntext a "first line of words"\ntext b "second line of words"\ntext c "third line of words"\n@10 keep\ndrop b\n`);
  const at = 10 * 15;
  assert.ok(opacity(scene!, at + 8, "b") <= 0.05, `b still at ${opacity(scene!, at + 8, "b")}`);
  // A formula (any kit) arriving where words leave counts as arriving there too.
  const kit = await ok(`@0\nstack s\n  text a "top line"\n  text n "n - 1 = 4" size=big\n@10 keep\ndrop n\nmath f latex="\\frac{16}{4}=4" into=s\n`);
  assert.ok(opacity(kit.scene!, at + 8, "n") <= 0.05, `n still at ${opacity(kit.scene!, at + 8, "n")}`);
});

test("attached words too long for one line break onto two and stay in view, even with the camera close", async () => {
  const { scene } = await ok(`@0\nimage p asset=photo w=1600 h=1000 frame=fit\ncamera p at=0.2,0.2,0.8,0.8\n@4 keep\ntag p "a long caption that runs well past the width of the frame at this zoom" at=0.5,0.5 role=caption\n`, pics);
  const f = 4 * 15 + 30;
  // A tag at a place is named by its line; its second line follows that name.
  assert.ok(find(evaluate(scene!, f), "tag.p.l5"));
  const two = find(evaluate(scene!, f), "tag.p.l5.l2");
  assert.ok(two, "the caption has a second line");
});

test("a camera set earlier follows words that arrive under it, in a small move of its own", async () => {
  // Words below what the camera frames: it pans to hold them.
  const below = await ok(`@0\nstack s gap=20\n  box a "A" w=500 h=300\n  text t "words below it"\n  box c "C" w=500 h=300\n@2 keep\ncamera a\n@6 keep\ntext t "words below it that grew longer"\n`);
  assert.equal(below.doc!.steps.filter((s) => s.set?.camera).length, 2, "the camera moved again to hold the words");
  // Words beside it that grow too wide for a pan alone: it pulls back as little as it must.
  const beside = await ok(`@0\nrow s gap=20\n  box a "A" w=500 h=300\n  text t "words"\n@2 keep\ncamera a at=0,0,1.25,1\n@6 keep\ntext t "words that grew"\n`);
  const [first, second] = beside.doc!.steps.filter((s) => s.set?.camera).map((s) => Number((s.set!.camera as { zoom: number }).zoom));
  assert.ok(second! < first! && second! > 1, `${first} then ${second}`);
});

test("words that cannot fit say how many characters do, and a cut by the camera names its line and a zoom that holds it", async () => {
  const long = "x".repeat(20).split("").map((_, i) => `word${i}`).join(" ");
  const r = await build(`@0\nimage p asset=photo w=1600 h=1000 frame=fit\ncamera p at=0.4,0.4,0.6,0.6\n@4 keep\ntag p "${long}" at=0.5,0.5 role=caption\n`, { ctx: ctxOf(), ...pics });
  assert.match(formatProblems(r.problems), /Shorten it to \d+ characters or fewer/);
});

test("a tag with no room around its target goes to the nearest free place with a line back to it", async () => {
  const cells = Array.from({ length: 9 }, (_, i) => `    box c${i} "${i}" w=200 h=200`).join("\n");
  const r = await ok(`@0\ngrid g cols=3 gap=10\n${cells}\nspace h=400\n@4 keep\ntag c4 "the middle one"\n`);
  const lead = find(evaluate(r.scene!, 4 * 15 + 30), "tag.c4.lead");
  assert.ok(lead, "a callout line points back");
});

test("a card added under words that were already on screen is drawn beneath them", async () => {
  const r = await ok(`@0\nbox b "thing" w=300 h=200\n@2 keep\ntag b "words" side=right\n@6 keep\ntag b "words" side=right back=paper\n`);
  const order = r.scene!.nodes.map((n) => n.id);
  assert.ok(order.includes("tag.b.back"));
  assert.ok(order.indexOf("tag.b.back") < order.indexOf("tag.b"), order.join(","));
});

test("in a grid, a line with as many values as columns is a row: columns line up, the first row is the header, the line's id names the row", async () => {
  const theme = themeFrom("chalkboard");
  const r = await ok(`@0\ngrid t cols=3\n  small head: h1=Name h2=Leaves h3=Gate\n  normal r1: a1=Express b1=9:05 c1=4\n  normal r2: a2=Local b2=10:20 c2=12\n@4 keep\nlight r2\n`, {}, theme);
  const x = (id: string) => Number(find(evaluate(r.scene!, 100), id)!.props.x);
  const center = (id: string) => {
    const n = find(evaluate(r.scene!, 100), id)!;
    return Number(n.props.x);
  };
  assert.ok(Math.abs(center("b1") - center("b2")) < 1 && Math.abs(center("h2") - center("b1")) < 1, `${x("h2")} ${x("b1")} ${x("b2")}`);
  // Lighting the row lights each of its cells.
  const lit = find(evaluate(r.scene!, 4 * 15 + 30), "c2")!;
  assert.notEqual(lit.props.color, find(evaluate(r.scene!, 30), "c2")!.props.color);
});

test("rows of values typed as separate lines get a note toward a grid, and a grid gets none", () => {
  const typed = `@0\nstack s\n  text r1 "1 | 2 | 3"\n  text r2 "4 | 5 | 6"\n  text r3 "7 | 8 | 9"\n`;
  assert.deepEqual(tableRows(parse(typed).doc.states), { from: 3, to: 5, cols: 3 });
  assert.match(craftNotes(typed).join(" "), /grid id cols=3/);
  const atoms = `@0\nstack s\n  normal r1: a=1 b=2\n  normal r2: c=3 d=4\n  normal r3: e=5 f=6\n`;
  assert.equal(tableRows(parse(atoms).doc.states)?.cols, 2);
  const grid = `@0\ngrid g cols=2\n  normal r1: a=1 b=2\n  normal r2: c=3 d=4\n  normal r3: e=5 f=6\n`;
  assert.equal(tableRows(parse(grid).doc.states), undefined);
});

test("a formula with a role takes that role's color, as words do", async () => {
  const theme = themeFrom("chalkboard");
  const r = await ok(`@0\nmath f latex="\\sqrt{4}=2" role=answer\n`, {}, theme);
  const glyph = r.scene!.nodes.find((n) => n.id.startsWith("f.") && n.props.glyph);
  assert.ok(glyph);
  assert.notEqual(glyph!.props.fill, theme.colors.ink);
});

test("a ring around something in a tight place hugs it rather than running through its neighbor's words", async () => {
  const r = await ok(`@0\nstack s gap=4\n  text t "a label right above"\n  box b "11" w=200 h=160\n@4 keep\nmark ring b\n`);
  const f = 4 * 15 + 30;
  const ring = find(evaluate(r.scene!, f), "mark.ring.b")!;
  const pts = ring.props.points as number[];
  const ys = pts.filter((_, i) => i % 2).map((y) => y + Number(ring.props.y ?? 0));
  const label = find(evaluate(r.scene!, f), "t")!;
  const size = Number(find(evaluate(r.scene!, f), "t.l1")!.props.size);
  assert.ok(Math.min(...ys) > Number(label.props.y) + size * 0.5, `ring top ${Math.min(...ys)} reaches the words at ${label.props.y}`);
});

test("words are measured in the style's fonts, so a wide face still keeps the frame's side margins", async () => {
  // A font twice as wide as the estimate, as a display or chalk face can be.
  const wide = Object.fromEntries([..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 "].map((c) => [c, estimate(c, 1) * 2]));
  const table: FontTable = { body: wide, title: wide, mono: wide };
  const measure = tableMeasure(table, plain);
  const r = await build(`@0\ntext t "Same layout every single time" size=huge\n`, { ctx: ctxOf(), measure });
  const safe = safeArea(1080, 1920);
  for (const n of evaluate(r.scene!, 60).flatMap((x) => x.children.length ? x.children : [x])) {
    if (n.kind !== "text") continue;
    const w = measure(String(n.props.text), Number(n.props.size));
    const parent = find(evaluate(r.scene!, 60), "t")!;
    const x = Number(parent.props.x) + Number(n.props.x ?? 0);
    assert.ok(x - w / 2 >= safe.x - safe.w / 2 - 1 && x + w / 2 <= safe.x + safe.w / 2 + 1, `"${n.props.text}" runs past the margins`);
  }
});

test("a state crowded with sentences, or one that leaves the frame mostly empty, gets a note", async () => {
  const lines = Array.from({ length: 7 }, (_, i) => `text l${i} "this is sentence number ${i} here"`).join("\n");
  const busy = await ok(`@0\n${lines}\n@10\nbox x "x" w=900 h=1400\n`);
  assert.match((busy.notes ?? []).join(" "), /lines of sentences at once/);
  const empty = await ok(`@0\ndot d\n@10\nbox x "x" w=900 h=1400\n`);
  assert.match((empty.notes ?? []).join(" "), /looks empty/);
});
