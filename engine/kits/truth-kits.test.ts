import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "../core/compile.ts";
import { evaluate } from "../core/evaluate.ts";
import type { CompileContext, Resolved, Scene } from "../core/types.ts";
import { build, formatProblems } from "../language/build.ts";
import { languagePrompt } from "../language/author.ts";
import { dijkstraKit } from "./dijkstra.ts";
import { KITS } from "./index.ts";
import { linalgKit, linalgPart } from "./linalg.ts";
import { sortKit, sortPart } from "./sort.ts";
import { traceKit, tracePart } from "./trace.ts";

const words = Array.from({ length: 80 }, (_, i) => ({ start: i * 0.5 }));
const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames: 1500, words, kits: KITS, theme: { colors: { ink: "#111111", accent: "#ff0000", paper: "#ffffff", highlight: "#ffff00", soft: "#111111" }, fonts: { title: "a", body: "b", mono: "m" }, moveFrames: 10, ease: "linear" } };

const find = (list: Resolved[], id: string): Resolved | undefined => {
  for (const r of list) {
    if (r.id === id) return r;
    const hit = find(r.children, id);
    if (hit) return hit;
  }
};
const at = (s: Scene, f: number, id: string) => {
  const r = find(evaluate(s, f), id);
  if (!r) throw new Error(`no ${id} at frame ${f}`);
  return r.props;
};
const ok = async (src: string) => {
  const r = await build(src, { ctx });
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  return r.scene!;
};
const bad = async (src: string) => {
  const r = await build(src, { ctx });
  assert.ok(r.problems.length, "expected problems");
  return formatProblems(r.problems);
};
const end = (s: Scene) => s.frames - 1;

test("every truth kind and the steps behavior teach themselves", () => {
  for (const kit of [linalgKit, sortKit, traceKit, dijkstraKit]) {
    for (const name of [...Object.keys(kit.kinds ?? {}), ...Object.keys(kit.behaviors ?? {})]) {
      assert.ok(kit.docs?.[name] && kit.docs[name]!.length > 40, `${kit.name}.${name} has a doc line`);
      assert.ok(!kit.docs![name]!.includes("—"), "no em dashes");
    }
  }
  const guide = languagePrompt({ ctx });
  for (const kind of ["matrix", "det", "cramer", "matvec", "sort", "trace", "dijkstra"]) assert.ok(guide.includes(`\`${kind}\`:`), kind);
  assert.ok(guide.includes("do steps ID"));
});

test("row operations computed by rref end on the real answer, with every cell addressable", async () => {
  const s = await ok(`@0\nmatrix m data=[[2,1,-1,8],[-3,-1,2,-11],[-2,1,2,-3]] solve=rref aug=1\ndo steps m until=@40\n@50 keep\nlight m.cell.3.4\n`);
  const last = end(s);
  const got = [1, 2, 3].map((r) => [1, 2, 3, 4].map((c) => String(at(s, last, linalgPart.cell("m", r, c)).text)));
  assert.deepEqual(got, [["1", "0", "0", "2"], ["0", "1", "0", "3"], ["0", "0", "1", "−1"]]);
  // Before the first step the matrix shows the input.
  assert.equal(at(s, 1, linalgPart.cell("m", 1, 1)).text, "2");
  assert.equal(at(s, last, linalgPart.cell("m", 3, 4)).color, "#ff0000");
});

test("a swap really moves the rows and leaves each id naming its place", async () => {
  const s = await ok(`@0\nmatrix m data=[[0,1],[3,4]] ops=["R1<->R2"]\n@2 keep\ndo steps m at=@4\n`);
  const t = 4 * 15; // word 4 at 2 s
  const mid = at(s, t + 5, linalgPart.row("m", 1)).y as number;
  assert.ok(mid > 0, "row 1 travels down");
  assert.equal(at(s, end(s), linalgPart.row("m", 1)).y, 0);
  assert.equal(at(s, end(s), linalgPart.cell("m", 1, 1)).text, "3");
  assert.equal(at(s, end(s), linalgPart.cell("m", 2, 2)).text, "1");
});

test("steps can be bound to spoken words one by one, or played a few at a time", async () => {
  const s = await ok(`@0\ndet d data=[[3,8],[4,6]]\n@2 keep\ndo steps d at=@3,@6,@9\n`);
  assert.equal(at(s, 3 * 15 - 2, linalgPart.line("d", 1)).opacity, 0);
  assert.equal(at(s, 6 * 15 - 1, linalgPart.line("d", 1)).opacity, 1);
  assert.equal(at(s, 6 * 15 - 1, linalgPart.total("d")).opacity, 0);
  assert.equal(at(s, end(s), linalgPart.total("d")).text, "det = 18 − 32 = −14");
  assert.equal(at(s, end(s), linalgPart.total("d")).opacity, 1);
  // Later steps alone: the earlier ones are put in place first.
  const p = await ok(`@0\ndet d data=[[3,8],[4,6]]\n@2 keep\ndo steps d from=3 to=3 at=@5\n`);
  assert.equal(at(p, end(p), linalgPart.line("d", 1)).opacity, 1);
  assert.equal(at(p, end(p), linalgPart.total("d")).opacity, 1);
});

test("wrong step timing is reported with the step list, so it can be repaired", async () => {
  const msg = await bad(`@0\ndet d data=[[3,8],[4,6]]\n@2 keep\ndo steps d at=@3,@6\n`);
  assert.match(msg, /plays 3 steps \(1 to 3\) but at= gives 2 moments/);
  assert.match(msg, /1 3 × 6 = 18; 2 8 × 4 = 32/);
  assert.match(await bad(`@0\ndet d data=[[3,8],[4,6]]\ndo steps d from=2 to=9\n`), /steps 1 to 3/);
  assert.match(await bad(`@0\nbox b "x"\ndo steps b\n`), /not one/);
  // Playing the same steps twice is caught, and the message says where to go on from.
  assert.match(await bad(`@0\ndet d data=[[3,8],[4,6]]\ndo steps d to=2 each=5\n@4 keep\ndo steps d each=5\n`), /already played steps 1 to 2.*from=3/);
  await ok(`@0\ndet d data=[[3,8],[4,6]]\ndo steps d to=2 each=5\n@4 keep\ndo steps d from=3 each=5\n`);
});

test("bad input fails loudly with a reason", async () => {
  assert.match(await bad(`@0\nmatrix m data=[[1,2],[3]]\n`), /same length/);
  assert.match(await bad(`@0\nmatrix m data=[[1,2],[3,4]] ops=["R1+R5"]\n`), /rows run from 1 to 2/);
  assert.match(await bad(`@0\ncramer c a=[[1,2],[2,4]] b=[1,2]\n`), /determinant of a is 0/);
  assert.match(await bad(`@0\nsort s data=[3,1] algo=bogo\n`), /algo must be one of/);
  assert.match(await bad(`@0\nsort s data=[3,1] colour=red\n`), /no setting "colour"/);
  assert.match(await bad(`@0\ntrace t code=["let x = y"]\n`), /y is not defined/);
  assert.match(await bad(`@0\ndijkstra g edges=A-B:1,C-D:2 from=A to=D\n`), /cannot be reached/);
});

test("Cramer's rule writes the real determinants and answers", async () => {
  const s = await ok(`@0\ncramer c a=[[2,1],[1,3]] b=[3,5]\ndo steps c until=@30\n`);
  const f = end(s);
  assert.equal(at(s, f, "c.result.1").text, "x = 4 ÷ 5 = 4/5");
  assert.equal(at(s, f, "c.result.2").text, "y = 7 ÷ 5 = 7/5");
  assert.equal(at(s, f, "c.result.2").opacity, 1);
  // The worked matrix ends with b in the second column.
  assert.equal(at(s, f, "c.w.cell.1.2").text, "3");
  assert.equal(at(s, f, "c.w.cell.1.1").text, "2");
});

test("matvec fills in each entry of the answer", async () => {
  const s = await ok(`@0\nmatvec p m=[[1,2],[3,4]] v=[5,6]\ndo steps p each=12\n`);
  assert.equal(at(s, end(s), "p.out.cell.2.1").text, "39");
  assert.equal(at(s, end(s), "p.out.cell.2.1").opacity, 1);
  assert.equal(at(s, end(s), "p.line.1").text, "3 × 5 + 4 × 6 = 39");
});

test("a sort ends with every value in its sorted place", async () => {
  for (const algo of ["bubble", "insertion", "selection", "merge", "quick"]) {
    const data = [5, 2, 8, 1, 9];
    const s = await ok(`@0\nsort s data=[${data}] algo=${algo} show=boxes\ndo steps s until=@60\n`);
    const xs = data.map((_, i) => at(s, end(s), sortPart.item("s", i + 1)).x as number);
    const order = data.map((v, i) => ({ v, x: xs[i]! })).sort((a, b) => a.x - b.x).map((o) => o.v);
    assert.deepEqual(order, [1, 2, 5, 8, 9], algo);
    for (let i = 1; i <= data.length; i++) assert.equal(at(s, end(s), sortPart.item("s", i)).y, 0, `${algo} back in the row`);
    assert.equal(at(s, end(s), sortPart.shape("s", 1)).stroke, "#ffff00", `${algo} marks finished places`);
    assert.equal(at(s, end(s), sortPart.value("s", 1)).color, "#ffff00", `${algo} keeps finished values readable`);
  }
});

test("a trace lights each line and shows the real variables and output", async () => {
  const code = `["function sum(xs) {","  let total = 0","  for (const n of xs) {","    total += n","  }","  return total","}","console.log(sum([3, 5, 2]))"]`;
  const s = await ok(`@0\ntrace t code=${code}\ndo steps t until=@70\n`);
  assert.equal(at(s, end(s), tracePart.out("t", 1)).text, "10");
  assert.equal(at(s, end(s), tracePart.out("t", 1)).opacity, 1);
  assert.equal(at(s, end(s), tracePart.variable("t", "total")).opacity, 0, "locals leave with their call");
  // Somewhere in the middle total really is 8 and the call is on the stack.
  const frames = Array.from({ length: end(s) }, (_, f) => f);
  assert.ok(frames.some((f) => at(s, f, tracePart.variable("t", "total")).text === "total = 8"));
  assert.ok(frames.some((f) => at(s, f, tracePart.frame("t", 2)).text === "sum(xs=[3, 5, 2])"));
  assert.ok(frames.some((f) => at(s, f, tracePart.variable("t", "n")).text === "n = 5"), "loop variables show too");
});

test("dijkstra is callable like the others and ends on the real shortest path", async () => {
  const s = await ok(`@0\ndijkstra d edges=A-B:4,A-C:2,B-C:1,B-D:5,C-E:8,C-F:10,D-E:2,E-F:3 from=A to=F\ndo steps d until=@60\n`);
  assert.equal(at(s, end(s), "d.total").text, "A → C → F = 12");
  assert.equal(at(s, end(s), "d.dist.F").text, "12");
  assert.equal(at(s, end(s), "d.dist.B").text, "3");
  assert.equal(at(s, end(s), "d.edge.CF").stroke, "#ff0000");
});

test("truth kinds also compile directly, outside the language", () => {
  const s = compile({ steps: [{ at: 0, add: [{ id: "m", kind: "matrix", data: { data: [[1, 2], [3, 4]], ops: ["R2-3R1"] } }] }, { at: 5, play: [{ behavior: "steps", target: "m" }] }] }, { ...ctx, frames: 90 });
  assert.equal(at(s, 89, linalgPart.cell("m", 2, 2)).text, "−2");
});
