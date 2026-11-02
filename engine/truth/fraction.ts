// Exact rational numbers, so a matrix on screen never shows 0.30000000000000004. Always kept in lowest terms with a
// positive denominator.
export class Frac {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new Error("division by zero");
    if (d < 0n) [n, d] = [-n, -d];
    const g = gcd(n < 0n ? -n : n, d);
    this.n = g > 1n ? n / g : n;
    this.d = g > 1n ? d / g : d;
  }
  static of(v: unknown): Frac {
    if (v instanceof Frac) return v;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error(`${v} is not a finite number`);
      return Frac.parse(String(v));
    }
    if (typeof v === "string") return Frac.parse(v);
    throw new Error(`${JSON.stringify(v)} is not a number`);
  }
  // "3", "-2.5", "1/3", "-4/6", "1e-3". Decimals are read exactly as written.
  static parse(s: string): Frac {
    const t = s.trim().replace(/−/g, "-");
    const f = /^([+-]?\d+)\/([+-]?\d+)$/.exec(t);
    if (f) return new Frac(BigInt(f[1]!), BigInt(f[2]!));
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(t);
    if (!m || (!m[2] && !m[3])) throw new Error(`"${s}" is not a number`);
    const digits = BigInt(`${m[2] || "0"}${m[3] ?? ""}`);
    const exp = Number(m[4] ?? 0) - (m[3]?.length ?? 0);
    const n = m[1] === "-" ? -digits : digits;
    return exp >= 0 ? new Frac(n * 10n ** BigInt(exp)) : new Frac(n, 10n ** BigInt(-exp));
  }
  add(o: Frac) { return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o: Frac) { return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o: Frac) { return new Frac(this.n * o.n, this.d * o.d); }
  div(o: Frac) {
    if (o.n === 0n) throw new Error("division by zero");
    return new Frac(this.n * o.d, this.d * o.n);
  }
  neg() { return new Frac(-this.n, this.d); }
  isZero() { return this.n === 0n; }
  isOne() { return this.n === 1n && this.d === 1n; }
  isNeg() { return this.n < 0n; }
  abs() { return this.n < 0n ? this.neg() : this; }
  eq(o: Frac) { return this.n === o.n && this.d === o.d; }
  // What the viewer reads: "7", "−3", "2/5", "−1/2". A true minus sign, not a hyphen.
  toString() {
    const sign = this.n < 0n ? "−" : "";
    const n = this.n < 0n ? -this.n : this.n;
    return this.d === 1n ? `${sign}${n}` : `${sign}${n}/${this.d}`;
  }
  // Wrapped in brackets when it would read badly after a sign or a times: (−3), (1/2).
  paren() {
    return this.n < 0n || this.d !== 1n ? `(${this})` : this.toString();
  }
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

export type Mat = Frac[][];

// A matrix from JSON, checked: a list of equal rows of numbers or fraction strings.
export function toMatrix(v: unknown, what = "data"): Mat {
  if (!Array.isArray(v) || !v.length) throw new Error(`${what} must be a list of rows, as in [[2,1],[1,3]]`);
  const rows = v.map((r, i) => {
    if (!Array.isArray(r) || !r.length) throw new Error(`${what} row ${i + 1} is not a list of numbers`);
    return r.map((x) => Frac.of(x));
  });
  const w = rows[0]!.length;
  rows.forEach((r, i) => {
    if (r.length !== w) throw new Error(`${what} rows must all be the same length: row 1 has ${w}, row ${i + 1} has ${r.length}`);
  });
  return rows;
}

export function toVector(v: unknown, what = "v"): Frac[] {
  if (!Array.isArray(v) || !v.length) throw new Error(`${what} must be a list of numbers, as in [3,5]`);
  return v.map((x) => {
    if (Array.isArray(x) && x.length === 1) return Frac.of(x[0]);
    return Frac.of(x);
  });
}

export const show = (m: Mat) => m.map((r) => r.map(String));
