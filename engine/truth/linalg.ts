// Linear algebra done for real, in exact fractions, reporting each step. Kits draw these logs; they never do the math.
import type { TruthEvent } from "../core/types.ts";
import { Frac, type Mat } from "./fraction.ts";

const SUB = "₀₁₂₃₄₅₆₇₈₉";
export const sub = (n: number) => [...String(n)].map((d) => SUB[Number(d)]).join("");
const MINUS = "−";
const copy = (m: Mat): Mat => m.map((r) => [...r]);

// ---------- Row operations ----------

export type RowOp = { type: "swap"; a: number; b: number } | { type: "scale"; row: number; k: Frac } | { type: "add"; row: number; src: number; k: Frac }; // rows count from 1
export type RowEvent = TruthEvent<{ type: "op"; op: RowOp; label: string; before: Mat; after: Mat; rows: number[] }>;

const OP_FORMS = `R1<->R2 (swap), R2*3 or R2/3 or 1/3R2 (scale), R2-2R1 or R3+1/2R1 (add a multiple)`;

const coef = (k: Frac) => (k.isOne() ? "" : k.eq(new Frac(-1n)) ? MINUS : k.d !== 1n ? `(${k})` : String(k));

export function opLabel(op: RowOp): string {
  if (op.type === "swap") return `R${sub(op.a)} ↔ R${sub(op.b)}`;
  if (op.type === "scale") return `R${sub(op.row)} → ${coef(op.k)}R${sub(op.row)}`;
  const k = op.k.abs();
  return `R${sub(op.row)} → R${sub(op.row)} ${op.k.isNeg() ? MINUS : "+"} ${coef(k)}R${sub(op.src)}`;
}

// Reads one row operation as a person would write it. Throws with the accepted forms on anything else.
export function parseOp(text: string, rows: number): RowOp {
  const s = text.replace(/\s+/g, "").replace(/−/g, "-").replace(/[↔]/g, "<->").replace(/×|·/g, "*").toUpperCase();
  const row = (n: string) => {
    const r = Number(n);
    if (!(r >= 1 && r <= rows)) throw new Error(`row operation "${text}" names row ${n}, but rows run from 1 to ${rows}`);
    return r;
  };
  const k = (t: string) => {
    if (t === "" || t === "+") return new Frac(1n);
    if (t === "-") return new Frac(-1n);
    return Frac.parse(t.replace(/^\((.*)\)$/, "$1").replace(/\*$/, ""));
  };
  let m = /^R(\d+)(?:<->|<>|<=>)R(\d+)$/.exec(s);
  if (m) {
    const [a, b] = [row(m[1]!), row(m[2]!)];
    if (a === b) throw new Error(`row operation "${text}" swaps a row with itself`);
    return { type: "swap", a, b };
  }
  // An optional "R2=" or "R2->" in front, as long as the rest is about that row.
  const lead = /^R(\d+)(?:=|->|→)(.*)$/.exec(s);
  const body = lead ? lead[2]! : s;
  m = /^R(\d+)([*/])\(?([+-]?\d+(?:\/\d+)?(?:\.\d+)?)\)?$/.exec(body);
  if (m) {
    const r = row(m[1]!);
    if (lead && Number(lead[1]) !== r) throw new Error(`row operation "${text}" sets row ${lead[1]} from row ${r}; only a swap moves a row`);
    const f = k(m[3]!);
    if (f.isZero()) throw new Error(`row operation "${text}" scales by zero, which loses the row`);
    return { type: "scale", row: r, k: m[2] === "*" ? f : new Frac(1n).div(f) };
  }
  m = /^\(?([+-]?\d+(?:\/\d+)?(?:\.\d+)?)\)?\*?R(\d+)$/.exec(body);
  if (m) {
    const r = row(m[2]!);
    if (lead && Number(lead[1]) !== r) throw new Error(`row operation "${text}" sets row ${lead[1]} from row ${r}; only a swap moves a row`);
    const f = k(m[1]!);
    if (f.isZero()) throw new Error(`row operation "${text}" scales by zero, which loses the row`);
    return { type: "scale", row: r, k: f };
  }
  m = /^R(\d+)([+-])\(?(\d+(?:\/\d+)?(?:\.\d+)?)?\)?\*?R(\d+)$/.exec(body);
  if (m) {
    const [r, src] = [row(m[1]!), row(m[4]!)];
    if (lead && Number(lead[1]) !== r) throw new Error(`row operation "${text}" sets row ${lead[1]} from row ${r}`);
    if (r === src) throw new Error(`row operation "${text}" adds a row to itself; use a scale instead`);
    const f = k(m[3] ?? "");
    return { type: "add", row: r, src, k: m[2] === "-" ? f.neg() : f };
  }
  throw new Error(`cannot read the row operation "${text}". Write it as one of: ${OP_FORMS}`);
}

export function applyOp(m: Mat, op: RowOp): Mat {
  const out = copy(m);
  if (op.type === "swap") [out[op.a - 1], out[op.b - 1]] = [out[op.b - 1]!, out[op.a - 1]!];
  else if (op.type === "scale") out[op.row - 1] = out[op.row - 1]!.map((x) => x.mul(op.k));
  else out[op.row - 1] = out[op.row - 1]!.map((x, c) => x.add(op.k.mul(m[op.src - 1]![c]!)));
  return out;
}

export function rowOps(m: Mat, ops: RowOp[]): RowEvent[] {
  let cur = m;
  return ops.map((op) => {
    const after = applyOp(cur, op);
    const e: RowEvent = { type: "op", op, label: opLabel(op), before: cur, after, rows: op.type === "swap" ? [op.a, op.b] : [op.row] };
    cur = after;
    return e;
  });
}

// The row operations of Gaussian elimination, worked out on the real matrix. `cols` limits pivots to the first columns,
// so an augmented matrix never pivots on its right-hand side. "echelon" stops at row echelon form; "rref" goes on to
// reduced row echelon form.
export function eliminate(m: Mat, mode: "echelon" | "rref", cols = m[0]!.length): RowOp[] {
  const ops: RowOp[] = [];
  let cur = copy(m);
  const run = (op: RowOp) => {
    ops.push(op);
    cur = applyOp(cur, op);
  };
  let r = 0;
  for (let c = 0; c < cols && r < cur.length; c++) {
    const p = cur.findIndex((row, i) => i >= r && !row[c]!.isZero());
    if (p < 0) continue;
    if (p !== r) run({ type: "swap", a: r + 1, b: p + 1 });
    if (mode === "rref" && !cur[r]![c]!.isOne()) run({ type: "scale", row: r + 1, k: new Frac(1n).div(cur[r]![c]!) });
    for (let i = 0; i < cur.length; i++) {
      if (i === r || (mode === "echelon" && i < r) || cur[i]![c]!.isZero()) continue;
      run({ type: "add", row: i + 1, src: r + 1, k: cur[i]![c]!.div(cur[r]![c]!).neg() });
    }
    r++;
  }
  return ops;
}

// ---------- Determinants ----------

export type Cell = [number, number]; // row, column from 1
export type DetEvent =
  | TruthEvent<{ type: "copy" }> // Sarrus: the first two columns written again on the right
  | TruthEvent<{ type: "product"; cells: Cell[]; factors: Frac[]; value: Frac; sign: 1 | -1; text: string }>
  | TruthEvent<{ type: "cofactor"; row: number; col: number; entry: Frac; sign: 1 | -1; minor: Mat; minorDet: Frac; value: Frac; text: string }>
  | TruthEvent<{ type: "total"; value: Frac; text: string }>;

export function det(m: Mat): Frac {
  const n = m.length;
  if (m.some((r) => r.length !== n)) throw new Error(`a determinant needs a square matrix, not ${n} by ${m[0]!.length}`);
  if (n === 1) return m[0]![0]!;
  let total = new Frac(0n);
  for (let j = 0; j < n; j++) {
    const t = m[0]![j]!.mul(det(minorOf(m, 0, j)));
    total = j % 2 ? total.sub(t) : total.add(t);
  }
  return total;
}

export function minorOf(m: Mat, r: number, c: number): Mat {
  return m.filter((_, i) => i !== r).map((row) => row.filter((_, j) => j !== c));
}

const times = (fs: Frac[]) => fs.map((f) => f.paren()).join(" × ");
// "6 − 3 + 0": the sum of signed values, written the way a person would.
export function sumText(values: Frac[]): string {
  return values.map((v, i) => (i === 0 ? String(v) : v.isNeg() ? ` ${MINUS} ${v.abs()}` : ` + ${v}`)).join("");
}
// "6 + 0 + 4 − 2 − 0 − 3": products with their sign, a negative product kept in brackets after a minus.
function signedText(terms: { sign: 1 | -1; value: Frac }[]): string {
  return terms.map((t, i) => (i === 0 ? (t.sign < 0 ? `${MINUS}${t.value.paren()}` : String(t.value)) : `${t.sign < 0 ? ` ${MINUS} ` : " + "}${t.sign < 0 || t.value.isNeg() ? t.value.paren() : t.value}`)).join("");
}
// A 2 by 2 determinant written out: "3 × 1 − 2 × 0".
export function det2Text(m: Mat): string {
  return `${times([m[0]![0]!, m[1]![1]!])} ${MINUS} ${times([m[0]![1]!, m[1]![0]!])}`;
}

export function determinant(m: Mat, method: "auto" | "diagonal" | "sarrus" | "cofactor" = "auto", along = 1): DetEvent[] {
  const n = m.length;
  if (m.some((r) => r.length !== n)) throw new Error(`a determinant needs a square matrix, not ${n} by ${m[0]!.length}`);
  if (n < 2 || n > 4) throw new Error(`determinants are shown for 2 by 2 to 4 by 4 matrices, not ${n} by ${n}`);
  const how = method === "auto" ? (n === 2 ? "diagonal" : "cofactor") : method;
  const log: DetEvent[] = [];
  const product = (cells: Cell[], sign: 1 | -1) => {
    const factors = cells.map(([r, c]) => m[r - 1]![c - 1]!);
    const value = factors.reduce((a, b) => a.mul(b));
    log.push({ type: "product", cells, factors, value, sign, text: `${times(factors)} = ${value}` });
    return { sign, value };
  };
  if (how === "diagonal") {
    if (n !== 2) throw new Error(`method=diagonal is for 2 by 2; use sarrus or cofactor for ${n} by ${n}`);
    const t = [product([[1, 1], [2, 2]], 1), product([[1, 2], [2, 1]], -1)];
    const value = t[0]!.value.sub(t[1]!.value);
    log.push({ type: "total", value, text: `${signedText(t)} = ${value}` });
  } else if (how === "sarrus") {
    if (n !== 3) throw new Error(`method=sarrus only works for 3 by 3; use cofactor for ${n} by ${n}`);
    log.push({ type: "copy" });
    const t: { sign: 1 | -1; value: Frac }[] = [];
    for (let s = 0; s < 3; s++) t.push(product([0, 1, 2].map((i): Cell => [i + 1, ((s + i) % 3) + 1]), 1));
    for (let s = 0; s < 3; s++) t.push(product([0, 1, 2].map((i): Cell => [i + 1, ((s + 2 - i + 3) % 3) + 1]), -1));
    const value = t.reduce((a, x) => (x.sign > 0 ? a.add(x.value) : a.sub(x.value)), new Frac(0n));
    log.push({ type: "total", value, text: `${signedText(t)} = ${value}` });
  } else if (how === "cofactor") {
    if (!(along >= 1 && along <= n)) throw new Error(`row=${along} is not a row of a ${n} by ${n} matrix`);
    const r = along - 1;
    const values: Frac[] = [];
    for (let c = 0; c < n; c++) {
      const sign: 1 | -1 = (r + c) % 2 ? -1 : 1;
      const entry = m[r]![c]!;
      const minor = minorOf(m, r, c);
      const minorDet = det(minor);
      const value = entry.mul(minorDet).mul(new Frac(BigInt(sign)));
      const inner = minor.length === 2 ? `(${det2Text(minor)})` : minorDet.paren();
      values.push(value);
      log.push({ type: "cofactor", row: r + 1, col: c + 1, entry, sign, minor, minorDet, value, text: `${sign < 0 ? MINUS : "+"}${entry.paren()} × ${inner} = ${value}` });
    }
    const value = values.reduce((a, b) => a.add(b));
    log.push({ type: "total", value, text: `${sumText(values)} = ${value}` });
  } else throw new Error(`method must be diagonal, sarrus or cofactor, not ${method}`);
  return log;
}

// ---------- Cramer's rule ----------

export type CramerEvent =
  | TruthEvent<{ type: "det"; col: number; matrix: Mat; value: Frac; text: string }> // col 0 is A itself
  | TruthEvent<{ type: "replace"; col: number; matrix: Mat }>
  | TruthEvent<{ type: "divide"; col: number; name: string; num: Frac; den: Frac; value: Frac; text: string }>;

const detText = (m: Mat, v: Frac) => (m.length === 2 ? `${det2Text(m)} = ${v}` : String(v));

export function cramer(a: Mat, b: Frac[], names: string[]): CramerEvent[] {
  const n = a.length;
  if (a.some((r) => r.length !== n)) throw new Error(`Cramer's rule needs a square matrix a, not ${n} by ${a[0]!.length}`);
  if (b.length !== n) throw new Error(`b has ${b.length} numbers but a has ${n} rows`);
  if (names.length !== n) throw new Error(`there are ${n} unknowns but ${names.length} names`);
  const d = det(a);
  if (d.isZero()) throw new Error(`the determinant of a is 0, so Cramer's rule has no single answer for this system`);
  const log: CramerEvent[] = [{ type: "det", col: 0, matrix: a, value: d, text: detText(a, d) }];
  for (let c = 1; c <= n; c++) {
    const m = a.map((row, i) => row.map((x, j) => (j === c - 1 ? b[i]! : x)));
    log.push({ type: "replace", col: c, matrix: m });
    const v = det(m);
    log.push({ type: "det", col: c, matrix: m, value: v, text: detText(m, v) });
    const value = v.div(d);
    log.push({ type: "divide", col: c, name: names[c - 1]!, num: v, den: d, value, text: `${names[c - 1]} = ${v} ÷ ${d.paren()} = ${value}` });
  }
  return log;
}

// ---------- Matrix times vector ----------

export type MatVecEvent = TruthEvent<{ type: "row"; row: number; factors: [Frac, Frac][]; value: Frac; text: string }>;

export function matVec(m: Mat, v: Frac[]): MatVecEvent[] {
  if (m[0]!.length !== v.length) throw new Error(`a ${m.length} by ${m[0]!.length} matrix needs a vector of ${m[0]!.length} numbers, not ${v.length}`);
  return m.map((row, i) => {
    const factors = row.map((x, j): [Frac, Frac] => [x, v[j]!]);
    const value = factors.reduce((s, [x, y]) => s.add(x.mul(y)), new Frac(0n));
    const sum = factors.map(([x, y]) => times([x, y])).join(" + ");
    return { type: "row" as const, row: i + 1, factors, value, text: `${sum} = ${value}` };
  });
}
