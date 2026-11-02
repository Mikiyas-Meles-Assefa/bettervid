import assert from "node:assert/strict";
import { test } from "node:test";
import { dijkstra } from "./dijkstra.ts";
import { Frac, toMatrix, toVector } from "./fraction.ts";
import { applyOp, cramer, det, determinant, eliminate, matVec, parseOp, rowOps } from "./linalg.ts";
import { sort, SORTS } from "./sort.ts";
import { trace } from "./tracer.ts";

const F = (s: string | number) => Frac.of(s);
const txt = (m: Frac[][]) => m.map((r) => r.map(String));

test("fractions are exact and read the way a person writes them", () => {
  assert.equal(String(F("0.1").add(F("0.2"))), "3/10");
  assert.equal(String(F("4/6")), "2/3");
  assert.equal(String(F(-3).div(F(6))), "−1/2");
  assert.equal(String(F("1e-3")), "1/1000");
  assert.equal(F("-1/2").paren(), "(−1/2)");
  assert.throws(() => F("abc"), /not a number/);
  assert.throws(() => F(1).div(F(0)), /division by zero/);
  assert.throws(() => toMatrix([[1, 2], [3]]), /same length/);
});

test("row operations read every usual way of writing them", () => {
  assert.deepEqual(parseOp("R1<->R2", 3), { type: "swap", a: 1, b: 2 });
  assert.deepEqual(parseOp("R1 ↔ R3", 3), { type: "swap", a: 1, b: 3 });
  const scale = parseOp("R2/3", 3);
  assert.ok(scale.type === "scale" && String(scale.k) === "1/3");
  const scale2 = parseOp("1/2R1", 3);
  assert.ok(scale2.type === "scale" && String(scale2.k) === "1/2");
  const add = parseOp("R3-2R1", 3);
  assert.ok(add.type === "add" && add.row === 3 && add.src === 1 && String(add.k) === "−2");
  const add2 = parseOp("R2 = R2 + 1/2 R1", 3);
  assert.ok(add2.type === "add" && String(add2.k) === "1/2");
  assert.throws(() => parseOp("R4-R1", 3), /rows run from 1 to 3/);
  assert.throws(() => parseOp("R1*0", 3), /zero/);
  assert.throws(() => parseOp("swap rows", 3), /cannot read/);
});

test("elimination to rref really reaches the identity and solves the system", () => {
  const m = toMatrix([[2, 1, -1, 8], [-3, -1, 2, -11], [-2, 1, 2, -3]]);
  const ops = eliminate(m, "rref", 3);
  const log = rowOps(m, ops);
  assert.deepEqual(txt(log.at(-1)!.after), [["1", "0", "0", "2"], ["0", "1", "0", "3"], ["0", "0", "1", "−1"]]);
  // Each step really is its operation applied to the step before.
  for (const e of log) assert.deepEqual(txt(applyOp(e.before, e.op)), txt(e.after));
  const ech = rowOps(m, eliminate(m, "echelon", 3)).at(-1)!.after;
  assert.ok(ech[1]![0]!.isZero() && ech[2]![0]!.isZero() && ech[2]![1]!.isZero());
});

test("determinants agree by every method and show each product", () => {
  const m = toMatrix([[2, -3, 1], [2, 0, -1], [1, 4, 5]]);
  const d = det(m);
  assert.equal(String(d), "49");
  for (const method of ["sarrus", "cofactor"] as const) assert.equal(String((determinant(m, method).at(-1) as { value: Frac }).value), "49");
  const sarrus = determinant(m, "sarrus");
  assert.equal(sarrus.filter((e) => e.type === "product").length, 6);
  assert.equal(sarrus[0]!.type, "copy");
  const two = determinant(toMatrix([[3, 8], [4, 6]]));
  assert.deepEqual(two.map((e) => (e as { text: string }).text), ["3 × 6 = 18", "8 × 4 = 32", "18 − 32 = −14"]);
  const cof = determinant(toMatrix([[1, 2], [3, 4]]), "cofactor");
  assert.equal(String((cof.at(-1) as { value: Frac }).value), "−2");
  const four = toMatrix([[1, 0, 2, -1], [3, 0, 0, 5], [2, 1, 4, -3], [1, 0, 5, 0]]);
  assert.equal(String((determinant(four).at(-1) as { value: Frac }).value), String(det(four)));
  assert.equal(String(det(four)), "30");
  assert.throws(() => determinant(toMatrix([[1, 2, 3], [4, 5, 6]])), /square/);
  assert.throws(() => determinant(toMatrix([[1, 2], [3, 4]]), "sarrus"), /3 by 3/);
});

test("Cramer's rule gives the answer that really satisfies the system", () => {
  const a = toMatrix([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]]);
  const b = toVector([8, -11, -3]);
  const log = cramer(a, b, ["x", "y", "z"]);
  const xs = log.filter((e) => e.type === "divide").map((e) => (e as { value: Frac }).value);
  assert.deepEqual(xs.map(String), ["2", "3", "−1"]);
  a.forEach((row, i) => assert.ok(row.reduce((s, v, j) => s.add(v.mul(xs[j]!)), new Frac(0n)).eq(b[i]!)));
  const two = cramer(toMatrix([[2, 1], [1, 3]]), toVector([3, 5]), ["x", "y"]);
  assert.equal(two.length, 7);
  assert.equal((two.at(-1) as { text: string }).text, "y = 7 ÷ 5 = 7/5");
  assert.throws(() => cramer(toMatrix([[1, 2], [2, 4]]), toVector([1, 2]), ["x", "y"]), /determinant of a is 0/);
});

test("matrix times vector, row by row", () => {
  const log = matVec(toMatrix([[1, 2], [3, 4], [5, 6]]), toVector([7, 8]));
  assert.deepEqual(log.map((e) => e.text), ["1 × 7 + 2 × 8 = 23", "3 × 7 + 4 × 8 = 53", "5 × 7 + 6 × 8 = 83"]);
  assert.throws(() => matVec(toMatrix([[1, 2]]), toVector([1, 2, 3])), /needs a vector of 2/);
});

test("every sort really sorts, and its log replays to the same order", () => {
  const data = [5, 2, 8, 1, 9, 3, 3, 7];
  for (const algo of SORTS) {
    const log = sort(data, algo);
    const done = log.at(-1)!;
    assert.ok(done.type === "done");
    assert.deepEqual(done.values, [...data].sort((a, b) => a - b), algo);
    // Replaying swaps (and merges) on the starting ids must give the reported order.
    const ids = data.map((_, i) => i);
    let pending: number[] = [];
    for (const e of log) {
      if (e.type === "compare") assert.equal(e.a, data[ids[e.i]!], `${algo} compare reads the real value`);
      if (e.type === "swap") [ids[e.i], ids[e.j]] = [ids[e.j]!, ids[e.i]!];
      if (e.type === "take") pending.push(ids[e.from]!);
      if (e.type === "lift") {
        pending.forEach((id, k) => (ids[e.lo + k] = id));
        pending = [];
      }
    }
    assert.deepEqual(ids, done.order, algo);
    assert.ok(log.some((e) => e.type === "compare"));
  }
  assert.throws(() => sort([1, Number.NaN], "bubble"), /numbers/);
});

test("the tracer runs code for real and records lines, variables and output", () => {
  const code = ["function sum(xs) {", "  let total = 0", "  for (const n of xs) {", "    total += n", "  }", "  return total", "}", "console.log(sum([3, 5, 2]))"].join("\n");
  const log = trace(code);
  assert.deepEqual(log.at(-1)!.output, ["10"]);
  assert.equal(log[0]!.line, 8);
  const totals = log.filter((e) => e.line === 4).map((e) => e.vars.find((v) => v.name === "total")!.value);
  assert.deepEqual(totals, ["0", "3", "8"]);
  const ret = log.find((e) => e.type === "return")!;
  assert.equal(ret.returned, "10");
  assert.equal(log.find((e) => e.line === 2)!.stack.at(-1)!.args, "xs=[3, 5, 2]");
  // Recursion keeps one frame per call.
  const fact = trace(["function f(n) {", "  if (n <= 1) return 1", "  return n * f(n - 1)", "}", "print(f(4))"].join("\n"));
  assert.equal(Math.max(...fact.map((e) => e.stack.length)), 5);
  assert.deepEqual(fact.at(-1)!.output, ["24"]);
  // Floating point is shown as it truly is.
  assert.deepEqual(trace("let x = 0.1 + 0.2\nprint(x)").at(-1)!.output, ["0.30000000000000004"]);
});

test("the tracer fails loudly on bad, endless or unsupported code", () => {
  assert.throws(() => trace("let x = y + 1"), /line 1: y is not defined/);
  assert.throws(() => trace("while (true) {\n}"), /more than/);
  assert.throws(() => trace("const f = (a) => a"), /arrow functions/);
  assert.throws(() => trace("const a = 1\na = 2"), /const/);
  assert.throws(() => trace("let s = 'open"), /never closed/);
  assert.throws(() => trace("class A {}"), /not supported/);
  assert.throws(() => trace("process.exit()"), /process is not defined/);
});

test("dijkstra fails loudly when the goal cannot be reached", () => {
  assert.throws(() => dijkstra(["a", "b", "c"], [{ id: "ab", from: "a", to: "b", weight: 1 }], "a", "c"), /cannot be reached/);
  assert.throws(() => dijkstra(["a", "b"], [{ id: "ab", from: "a", to: "b", weight: -1 }], "a", "b"), /weights of 0 or more/);
});
