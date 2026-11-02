import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { evaluate } from "../core/evaluate.ts";
import type { CompileContext, Resolved, Scene } from "../core/types.ts";
import { build, formatProblems } from "./build.ts";
import { loadLibrary, saveProgram, testProgram } from "./library.ts";
import { parse, tokenize } from "./syntax.ts";

const words = Array.from({ length: 60 }, (_, i) => ({ start: i * 0.5 }));
const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames: 900, words, theme: { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff", highlight: "#ffff00" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" } };
const ok = async (src: string, extra = {}) => {
  const r = await build(src, { ctx, ...extra });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  return r.scene!;
};
const bad = async (src: string, extra = {}) => {
  const r = await build(src, { ctx, ...extra });
  assert.ok(r.problems.length, "expected problems");
  return formatProblems(r.problems);
};
const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
const at = (s: Scene, f: number, id: string) => find(evaluate(s, f), id);

test("tokens keep quoted spaces and report open quotes", () => {
  assert.deepEqual(tokenize(`text a "two words" size=big`), ["text", "a", `"two words"`, "size=big"]);
  assert.deepEqual(tokenize(`tag a "x y" color="ink"`), ["tag", "a", `"x y"`, `color="ink"`]);
  assert.equal(tokenize(`text a "oops`), null);
});

test("parse errors carry the line, the reason and a suggestion", () => {
  const { problems } = parse(`@0\n  boxx a "hi"\n  big a=1\n  text b "x" colour=ink\n@zz\n`);
  const text = formatProblems(problems);
  assert.match(text, /line 2: Unknown line\. Did you mean box\?/);
  assert.match(text, /line 3: A line of atoms needs a colon/);
  assert.match(text, /line 4: text has no setting "colour"\. Did you mean color\?/);
  assert.match(text, /line 5: "@zz" is not a moment/);
});

test("a thing with the same id travels between states", async () => {
  const s = await ok(`@0\nbig: a=1 b=2\n@2\nnormal: x=9\nbig: b=2 a=1\n`);
  const first = at(s, 15, "a")!.props.x as number;
  const later = at(s, 100, "a")!.props.x as number;
  assert.ok(later > first, `${first} then ${later}`);
  assert.equal(at(s, 100, "x")!.props.text, "9");
});

test("what a plain state does not list leaves, and it can come back", async () => {
  const s = await ok(`@0\nbig: a=1 b=2\n@2\nbig: b=2\n@6\nbig: a=1 b=2\n`);
  assert.equal(at(s, 50, "a")!.props.opacity, 0);
  assert.equal(at(s, 100, "a")!.props.opacity, 1);
});

test("a keep state only says what changes", async () => {
  const s = await ok(`@0\nbig: a=1\n@2 keep\nnormal: b=2\n@6 keep\ndrop a\n`);
  assert.equal(at(s, 50, "a")!.props.opacity, 1);
  assert.equal(at(s, 50, "b")!.props.opacity, 1);
  assert.equal(at(s, 100, "a")!.props.opacity, 0);
  assert.equal(at(s, 100, "b")!.props.opacity, 1);
});

test("mentioning an atom in a new line of a keep state moves it there", async () => {
  const s = await ok(`@0\nbig: a=1 b=2\n@2 keep\nnormal: b=2 c=3\n`);
  assert.ok((at(s, 100, "b")!.props.y as number) > (at(s, 20, "b")!.props.y as number));
  assert.equal(at(s, 100, "a")!.props.opacity, 1);
});

test("light lasts one state; set stays", async () => {
  const s = await ok(`@0\nbox a "x"\nbig: b=1\n@2 keep\nlight b\nset a fill=highlight\n@6 keep\nnormal: c=1\n`);
  assert.equal(at(s, 60, "b")!.props.color, "#ff0000");
  assert.equal(at(s, 300, "b")!.props.color, "#111111");
  assert.equal(at(s, 300, "a.shape")!.props.fill, "#ffff00");
});

test("containers, shapes, fractions and matrices place without overlapping", async () => {
  const s = await ok(`@0\nrow r\n  box a "one"\n  circle b "two"\nbig: { n=1 / d=2 }\nnormal: [ p=1 q=2 ; r2=3 s=4 ]\ngrid g cols=2\n  dot d1\n  dot d2\n  dot d3\nchain c dir=right\n  pill x "in"\n  pill y "out"\n`);
  assert.ok((at(s, 30, "b")!.props.x as number) > (at(s, 30, "a")!.props.x as number));
  assert.ok((at(s, 30, "d")!.props.y as number) > (at(s, 30, "n")!.props.y as number));
  assert.ok(at(s, 30, "bar.n"));
  assert.ok(at(s, 30, "link.x.y.head"));
});

test("arrows follow what they connect", async () => {
  const s = await ok(`@0\nrow r\n  box a "one"\n  box b "two"\narrow a -> b "goes"\n@2 keep\nbox z "new"\n`);
  assert.ok(at(s, 20, "arrow.a.b"));
  assert.ok(at(s, 20, "arrow.a.b.label"));
  assert.notDeepEqual(at(s, 20, "arrow.a.b")!.props.points, at(s, 200, "arrow.a.b")!.props.points);
});

test("everything a mark can do resolves", async () => {
  await ok(`@0\nbig: a=1 b=2\nmark ring a\nmark box b\nmark underline a,b\nmark cross a\nmark brace a,b "sum"\ntag b "note"\n`);
});

test("a graph is laid out by code and its parts can be addressed", async () => {
  const s = await ok(`@0\ngraph g: A-B:4 A-C:2 B-C:1 C-D:8\n@2 keep\nlight g.node.A\ndo flow g.edge.AB\n`);
  assert.equal(at(s, 40, "g.node.A")!.props.stroke, "#ff0000");
  assert.equal(at(s, 40, "g.node.B")!.props.stroke, "#111111");
  const [a, b] = [at(s, 40, "g.node.A")!.props, at(s, 40, "g.node.B")!.props];
  assert.ok(Math.hypot((a.x as number) - (b.x as number), (a.y as number) - (b.y as number)) > 150);
});

test("code lines can each be addressed", async () => {
  const s = await ok(`@0\ncode c\n  | def f(x):\n  |     return x\n@2 keep\nlight c.2\n`);
  assert.equal(at(s, 40, "c.2")!.props.color, "#ff0000");
  assert.equal(at(s, 40, "c.1")!.props.color, "#111111");
  assert.ok((at(s, 40, "c.2")!.props.x as number) > (at(s, 40, "c.1")!.props.x as number));
});

test("kit kinds are written by name, and fit the space given", async () => {
  const kit = { name: "t", kinds: { blob: (n: any) => [{ id: n.id, kind: "group" }, { id: `${n.id}.a`, kind: "path", parent: n.id, props: { points: [0, 0, 5000, 3000], stroke: "ink" } }] } };
  const s = await ok(`@0\nblob b1 size=3\n@2 keep\nset b1.a stroke=accent\n`, { ctx: { ...ctx, kits: [kit] } });
  assert.ok((at(s, 30, "b1")!.props.scaleX as number) < 0.3);
  assert.equal(at(s, 100, "b1.a")!.props.stroke, "#ff0000");
});

test("exact errors: bad ids, words, colors, behaviors and duplicates", async () => {
  assert.match(await bad(`@999\nbig: a=1\n`), /no spoken word 999; the last word is 59/);
  assert.match(await bad(`@0\nbig: a=1\nlight ab\n`), /"ab" is not on the board/);
  assert.match(await bad(`@0\nbox a "x" fill=purple\n`), /"purple" is not a color here/);
  assert.match(await bad(`@0\nbig: a=1\ndo wiggle a\n`), /no behavior called wiggle/);
  assert.match(await bad(`@0\nbig: a=1\nnormal: a=2\n`), /on the board twice/);
  assert.match(await bad(`@0\nimage p asset=x\n`), /assets/);
  assert.match(await bad(`@0\nset a src=http://x\nbig: a=1\n`), /set cannot change "src"/);
});

test("too much on screen is reported instead of drawn too small", async () => {
  const rows = Array.from({ length: 40 }, (_, i) => `normal: a${i}=${"long words here ".repeat(4).replace(/ /g, "_")}`).join("\n");
  assert.match(await bad(`@0\n${rows}\n`), /does not fit|too small/);
});

const orbit = `program orbit n=3 r=200
for (let i = 0; i < args.n; i++) {
  const id = path("p" + i, { points: circle(0, 0, 18), fill: "accent" });
  anim(id, "x", T0, T1, (t) => W / 2 + Math.cos(t * TAU + i) * args.r, 10);
  anim(id, "y", T0, T1, (t) => H / 2 + Math.sin(t * TAU + i) * args.r, 10);
}
emit("spin", T0);
end
`;

test("a program draws in a box, moves on spoken time, and its parts are addressable", async () => {
  const s = await ok(`${orbit}@2\ntext t "above"\nrun orbit o1 n=2 w=800 h=600 until=@40\n@2 keep\nlight o1.p0\n`);
  const a = at(s, 60, "o1.p0")!.props;
  const b = at(s, 100, "o1.p0")!.props;
  assert.notEqual(a.x, b.x);
  assert.equal(b.fill, "#ff0000");
  assert.ok(find(evaluate(s, 60), "o1")!.children.length === 2);
  assert.equal(at(s, 3, "o1")!.props.opacity, 0); // not visible before it starts
  assert.equal(s.events[0]!.name, "spin");
});

test("a program can animate things already on the board", async () => {
  const s = await ok(`program lift\nfor (const id of Object.keys(on)) anim(id, "y", T0, T1, (t) => on[id].y - t * 100, 5);\nend\n@0\nbig: a=1\n@2 keep\nrun lift l1 on=a until=@6\n`);
  const start = at(s, 31, "a")!.props.y as number;
  const end = at(s, 95, "a")!.props.y as number;
  assert.ok(Math.abs(start - end - 100) < 8, `${start} ${end}`);
});

test("program failures come back with the document's line", async () => {
  const text = await bad(`program broke\nconst a = 1;\nnope();\nend\n@0\nrun broke b1\n`);
  assert.match(text, /line 3: The program broke failed: nope is not defined/);
  assert.match(await bad(`program syntax\nconst = 1;\nend\n@0\nrun syntax b1\n`), /line 2: The program syntax failed/);
  assert.match(await bad(`program looped\nfor (;;) {}\nend\n@0\nrun looped b1\n`), /limit/);
  assert.match(await bad(`@0\nrun missing b1\n`), /no program called missing/);
  assert.match(await bad(`${orbit}@0\nrun orbit o1 wings=2\n`), /has no setting "wings"\. It takes: n, r/);
});

test("nothing a program returns can reach outside the video", async () => {
  const hijack = (node: string) => `program h\n}); globalThis.__run = () => JSON.stringify({ nodes: [${node}], tracks: [], events: [] }); (function () {\nend\n@0\nrun h h1\n`;
  assert.match(await bad(hijack(`{ id: "x", kind: "image", props: { src: "http://evil.example/a.png" } }`)), /may only make group, path and text/);
  assert.match(await bad(hijack(`{ id: "x", kind: "path", props: { points: [0, 0, 1, 1], fill: "url(http://evil.example/a.svg#b)" } }`)), /color names/);
  assert.match(await bad(hijack(`{ id: "x", kind: "text", props: { text: "a", font: "evil" } }`)), /not allowed/);
  assert.match(await bad(hijack(`{ id: "__proto__", kind: "text", props: { text: "a" } }`)), /bad id/);
  assert.match(await bad(hijack(`{ id: "x", kind: "text", props: { text: "a", __proto__x: 1 } }`)), /not allowed/);
});

test("the same document always gives the same scene", async () => {
  const src = `${orbit}@0\nrun orbit o1\n`;
  assert.equal(JSON.stringify(await ok(src)), JSON.stringify(await ok(src)));
});

test("the library takes a tested program and refuses a bad one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lib-"));
  try {
    const good = { name: "ripple-rings", doc: "Rings spreading from the center of the box.", params: { n: "4" }, source: `for (let i = 0; i < args.n; i++) { const id = path("r" + i, { x: W / 2, y: H / 2, points: circle(0, 0, 40), stroke: "accent" }); anim(id, "scaleX", T0, T1, (t) => 1 + t * 2, 10); }` };
    assert.deepEqual(await testProgram(good), []);
    assert.ok((await saveProgram(good, dir)).endsWith("ripple-rings.json"));
    assert.equal(loadLibrary(dir)[0]!.name, "ripple-rings");
    await assert.rejects(saveProgram({ name: "shaky", doc: "Gives a different result sometimes.", params: {}, source: `text("x", { text: String(args.missing.y) });` }, dir), /was not saved/);
    await assert.rejects(saveProgram({ name: "wide", doc: "Ignores the box it was given.", params: {}, source: `path("x", { points: [0, 0, 5000, 5000], stroke: "ink" });` }, dir), /outside its box/);
    assert.equal(loadLibrary(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a saved program runs by name", async () => {
  const library = [{ name: "dots", doc: "A row of dots.", params: { n: "2" }, source: `for (let i = 0; i < args.n; i++) path("d" + i, { points: circle(i * 50, 20, 10), fill: "ink" });` }];
  const s = await ok(`@0\nrun dots d1 n=3 w=400 h=100\n`, { library });
  assert.ok(at(s, 40, "d1.d2"));
});
