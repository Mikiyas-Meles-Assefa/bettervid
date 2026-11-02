// Runs a small JavaScript program for real and records each step: the line about to run, every variable in reach, the
// call stack and what has been printed. It is its own interpreter for a subset of the language, so the code it runs
// can reach nothing at all: no globals, no host objects, no eval, and hard limits on steps, depth and size.
//
// Supported: let, const, var, function declarations and calls (recursion too), if/else, while, for (;;), for...of,
// break, continue, return, numbers, strings, true/false/null/undefined, arrays, plain objects, the usual operators,
// console.log / print, Math, and common array and string methods.
import type { TruthEvent } from "../core/types.ts";

export type Frame = { name: string; args: string; line: number }; // line: where it was called from (0 for the program)
export type Var = { name: string; value: string };
export type TraceEvent = TruthEvent<{ type: "line" | "return" | "end"; line: number; stack: Frame[]; vars: Var[]; output: string[]; returned?: string }>;
export type TraceLimits = { steps: number; events: number; depth: number; size: number };
export const TRACE_LIMITS: TraceLimits = { steps: 20000, events: 400, depth: 60, size: 10000 };

// ---------- Tokens ----------

type Tok = { t: "num" | "str" | "name" | "op" | "eof"; v: string; line: number };
const OPS = ["===", "!==", "**", "<=", ">=", "==", "!=", "&&", "||", "??", "++", "--", "+=", "-=", "*=", "/=", "%=", "=>", "...", "+", "-", "*", "/", "%", "<", ">", "=", "!", "(", ")", "{", "}", "[", "]", ";", ",", ".", "?", ":"];

class TraceError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let line = 1;
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (src.startsWith("//", i)) while (i < src.length && src[i] !== "\n") i++;
    else if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) throw new TraceError("a comment is never closed", line);
      line += src.slice(i, end).split("\n").length - 1;
      i = end + 2;
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i))!;
      out.push({ t: "num", v: m[0], line });
      i += m[0].length;
    } else if (c === "'" || c === '"' || c === "`") {
      let s = "";
      let j = i + 1;
      for (; j < src.length && src[j] !== c; j++) {
        if (src[j] === "\n") throw new TraceError("a string is never closed", line);
        if (c === "`" && src[j] === "$" && src[j + 1] === "{") throw new TraceError("template strings with ${} are not supported; join strings with +", line);
        if (src[j] === "\\") {
          j++;
          const e = src[j];
          s += e === "n" ? "\n" : e === "t" ? "\t" : e ?? "";
        } else s += src[j];
      }
      if (j >= src.length) throw new TraceError("a string is never closed", line);
      out.push({ t: "str", v: s, line });
      i = j + 1;
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))!;
      out.push({ t: "name", v: m[0], line });
      i += m[0].length;
    } else {
      const op = OPS.find((o) => src.startsWith(o, i));
      if (!op) throw new TraceError(`unexpected character "${c}"`, line);
      out.push({ t: "op", v: op, line });
      i += op.length;
    }
  }
  out.push({ t: "eof", v: "", line });
  return out;
}

// ---------- Syntax tree ----------

type Expr =
  | { k: "num"; v: number; line: number }
  | { k: "str"; v: string; line: number }
  | { k: "lit"; v: boolean | null | undefined; line: number }
  | { k: "name"; v: string; line: number }
  | { k: "array"; items: Expr[]; line: number }
  | { k: "object"; props: [string, Expr][]; line: number }
  | { k: "unary"; op: string; e: Expr; line: number }
  | { k: "update"; op: "++" | "--"; prefix: boolean; e: Expr; line: number }
  | { k: "binary"; op: string; a: Expr; b: Expr; line: number }
  | { k: "logical"; op: string; a: Expr; b: Expr; line: number }
  | { k: "cond"; test: Expr; a: Expr; b: Expr; line: number }
  | { k: "assign"; op: string; target: Expr; e: Expr; line: number }
  | { k: "member"; obj: Expr; prop: string; line: number }
  | { k: "index"; obj: Expr; index: Expr; line: number }
  | { k: "call"; callee: Expr; args: Expr[]; line: number }
  | { k: "func"; fn: Func; line: number };
type Func = { name: string; params: string[]; body: Stmt[]; line: number };
type Stmt =
  | { k: "expr"; e: Expr; line: number }
  | { k: "decl"; kind: string; list: [string, Expr | undefined][]; line: number }
  | { k: "func"; fn: Func; line: number }
  | { k: "if"; test: Expr; then: Stmt; else?: Stmt; line: number }
  | { k: "while"; test: Expr; body: Stmt; line: number }
  | { k: "for"; init?: Stmt; test?: Expr; update?: Expr; body: Stmt; line: number }
  | { k: "forof"; kind: string; name: string; iter: Expr; body: Stmt; line: number }
  | { k: "return"; e?: Expr; line: number }
  | { k: "break"; line: number }
  | { k: "continue"; line: number }
  | { k: "block"; body: Stmt[]; line: number }
  | { k: "empty"; line: number };

const UNSUPPORTED = new Set(["class", "new", "this", "try", "catch", "throw", "switch", "async", "await", "yield", "import", "export", "delete", "in", "instanceof", "with", "do", "eval", "Function"]);

function parse(src: string): Stmt[] {
  const toks = lex(src);
  let p = 0;
  const peek = (o = 0) => toks[Math.min(p + o, toks.length - 1)]!;
  const is = (v: string, o = 0) => peek(o).t === "op" && peek(o).v === v;
  const isName = (v: string) => peek().t === "name" && peek().v === v;
  const fail = (msg: string, tok = peek()): never => {
    throw new TraceError(msg, tok.line);
  };
  const eat = (v: string) => {
    if (!is(v)) fail(`expected "${v}" but found "${peek().v || "the end"}"`);
    return toks[p++]!;
  };
  const name = () => {
    const t = peek();
    if (t.t !== "name") fail(`expected a name but found "${t.v || "the end"}"`);
    if (UNSUPPORTED.has(t.v)) fail(`"${t.v}" is not supported here`);
    p++;
    return t.v;
  };
  const semi = () => {
    if (is(";")) p++;
  };

  const func = (line: number, needName: boolean): Func => {
    const fname = peek().t === "name" ? name() : needName ? fail("a function needs a name") : "anonymous";
    eat("(");
    const params: string[] = [];
    while (!is(")")) {
      if (is("...")) fail("rest parameters are not supported");
      params.push(name());
      if (!is(")")) eat(",");
    }
    eat(")");
    eat("{");
    const body: Stmt[] = [];
    while (!is("}")) body.push(statement());
    eat("}");
    return { name: fname, params, body, line };
  };

  const statement = (): Stmt => {
    const t = peek();
    const line = t.line;
    if (t.t === "eof") fail("the program ends too early");
    if (is(";")) {
      p++;
      return { k: "empty", line };
    }
    if (is("{")) {
      p++;
      const body: Stmt[] = [];
      while (!is("}")) body.push(statement());
      eat("}");
      return { k: "block", body, line };
    }
    if (t.t === "name") {
      if (UNSUPPORTED.has(t.v)) fail(`"${t.v}" is not supported here`);
      if (t.v === "function") {
        p++;
        return { k: "func", fn: func(line, true), line };
      }
      if (t.v === "let" || t.v === "const" || t.v === "var") {
        const d = decl();
        semi();
        return d;
      }
      if (t.v === "if") {
        p++;
        eat("(");
        const test = expr();
        eat(")");
        const then = statement();
        if (isName("else")) {
          p++;
          return { k: "if", test, then, else: statement(), line };
        }
        return { k: "if", test, then, line };
      }
      if (t.v === "while") {
        p++;
        eat("(");
        const test = expr();
        eat(")");
        return { k: "while", test, body: statement(), line };
      }
      if (t.v === "for") {
        p++;
        eat("(");
        if ((isName("let") || isName("const") || isName("var")) && peek(2).t === "name" && peek(2).v === "of") {
          const kind = toks[p++]!.v;
          const v = name();
          p++;
          const iter = expr();
          eat(")");
          return { k: "forof", kind, name: v, iter, body: statement(), line };
        }
        if (peek(1).t === "name" && peek(1).v === "in") fail("for...in is not supported; use for...of or a counting loop");
        const init = is(";") ? undefined : isName("let") || isName("const") || isName("var") ? decl() : { k: "expr" as const, e: expr(), line };
        eat(";");
        const test = is(";") ? undefined : expr();
        eat(";");
        const update = is(")") ? undefined : expr();
        eat(")");
        return { k: "for", init, test, update, body: statement(), line };
      }
      if (t.v === "return") {
        p++;
        const e = is(";") || is("}") || peek().line !== line ? undefined : expr();
        semi();
        return { k: "return", e, line };
      }
      if (t.v === "break" || t.v === "continue") {
        p++;
        semi();
        return { k: t.v, line };
      }
    }
    const e = expr();
    semi();
    return { k: "expr", e, line };
  };

  const decl = (): Stmt => {
    const t = toks[p++]!;
    const list: [string, Expr | undefined][] = [];
    do {
      if (is("[") || is("{")) fail("destructuring is not supported; declare one name at a time");
      const n = name();
      let init: Expr | undefined;
      if (is("=")) {
        p++;
        init = assign();
      } else if (t.v === "const") fail(`const ${n} needs a value`);
      list.push([n, init]);
    } while (is(",") && ++p);
    return { k: "decl", kind: t.v, list, line: t.line };
  };

  const expr = (): Expr => {
    const e = assign();
    if (is(",")) fail("the comma operator is not supported; write one expression at a time");
    return e;
  };
  const assign = (): Expr => {
    const line = peek().line;
    if (peek().t === "name" && is("=>", 1)) fail("arrow functions are not supported; write function name(...) { ... }");
    if (is("(")) {
      // Arrow functions start like a bracket; find the matching one and look for =>.
      let depth = 0;
      for (let q = p; q < toks.length; q++) {
        if (toks[q]!.v === "(" && toks[q]!.t === "op") depth++;
        if (toks[q]!.v === ")" && toks[q]!.t === "op" && --depth === 0) {
          if (toks[q + 1]?.v === "=>") fail("arrow functions are not supported; write function name(...) { ... }");
          break;
        }
      }
    }
    const target = cond();
    for (const op of ["=", "+=", "-=", "*=", "/=", "%="]) {
      if (is(op)) {
        if (target.k !== "name" && target.k !== "member" && target.k !== "index") fail(`cannot assign to this`);
        p++;
        return { k: "assign", op, target, e: assign(), line };
      }
    }
    return target;
  };
  const cond = (): Expr => {
    const test = binary(0);
    if (!is("?")) return test;
    p++;
    const a = assign();
    eat(":");
    return { k: "cond", test, a, b: assign(), line: test.line };
  };
  const LEVELS = [["??"], ["||"], ["&&"], ["===", "!==", "==", "!="], ["<", ">", "<=", ">="], ["+", "-"], ["*", "/", "%"]];
  const binary = (level: number): Expr => {
    if (level === LEVELS.length) return power();
    let a = binary(level + 1);
    while (peek().t === "op" && LEVELS[level]!.includes(peek().v)) {
      const op = toks[p++]!.v;
      const b = binary(level + 1);
      a = level < 3 ? { k: "logical", op, a, b, line: a.line } : { k: "binary", op, a, b, line: a.line };
    }
    return a;
  };
  const power = (): Expr => {
    const a = unary();
    if (!is("**")) return a;
    p++;
    return { k: "binary", op: "**", a, b: power(), line: a.line };
  };
  const unary = (): Expr => {
    const line = peek().line;
    if (is("!") || is("-") || is("+")) {
      const op = toks[p++]!.v;
      return { k: "unary", op, e: unary(), line };
    }
    if (isName("typeof")) {
      p++;
      return { k: "unary", op: "typeof", e: unary(), line };
    }
    if (is("++") || is("--")) {
      const op = toks[p++]!.v as "++" | "--";
      return { k: "update", op, prefix: true, e: unary(), line };
    }
    let e = postfix();
    if ((is("++") || is("--")) && peek().line === toks[p - 1]!.line) {
      const op = toks[p++]!.v as "++" | "--";
      e = { k: "update", op, prefix: false, e, line };
    }
    return e;
  };
  const postfix = (): Expr => {
    let e = primary();
    for (;;) {
      const line = peek().line;
      if (is(".")) {
        p++;
        const t = peek();
        if (t.t !== "name") fail("expected a property name after .");
        p++;
        e = { k: "member", obj: e, prop: t.v, line };
      } else if (is("[")) {
        p++;
        const index = expr();
        eat("]");
        e = { k: "index", obj: e, index, line };
      } else if (is("(")) {
        p++;
        const args: Expr[] = [];
        while (!is(")")) {
          if (is("...")) fail("spread arguments are not supported");
          args.push(assign());
          if (!is(")")) eat(",");
        }
        eat(")");
        e = { k: "call", callee: e, args, line };
      } else return e;
    }
  };
  const primary = (): Expr => {
    const t = peek();
    const line = t.line;
    if (t.t === "num") {
      p++;
      return { k: "num", v: Number(t.v), line };
    }
    if (t.t === "str") {
      p++;
      return { k: "str", v: t.v, line };
    }
    if (is("(")) {
      p++;
      const e = expr();
      eat(")");
      return e;
    }
    if (is("[")) {
      p++;
      const items: Expr[] = [];
      while (!is("]")) {
        if (is("...")) fail("spread is not supported");
        items.push(assign());
        if (!is("]")) eat(",");
      }
      eat("]");
      return { k: "array", items, line };
    }
    if (is("{")) {
      p++;
      const props: [string, Expr][] = [];
      while (!is("}")) {
        const k = peek();
        if (k.t !== "name" && k.t !== "str" && k.t !== "num") fail("expected a property name");
        p++;
        if (is(":")) {
          p++;
          props.push([k.v, assign()]);
        } else props.push([k.v, { k: "name", v: k.v, line: k.line }]);
        if (!is("}")) eat(",");
      }
      eat("}");
      return { k: "object", props, line };
    }
    if (t.t === "name") {
      if (t.v === "true" || t.v === "false") {
        p++;
        return { k: "lit", v: t.v === "true", line };
      }
      if (t.v === "null") {
        p++;
        return { k: "lit", v: null, line };
      }
      if (t.v === "function") {
        p++;
        return { k: "func", fn: func(line, false), line };
      }
      return { k: "name", v: name(), line };
    }
    return fail(`unexpected "${t.v || "end of program"}"`);
  };

  const body: Stmt[] = [];
  while (peek().t !== "eof") body.push(statement());
  return body;
}

// ---------- Running ----------

type Closure = { kind: "closure"; fn: Func; env: Env };
type Builtin = { kind: "builtin"; name: string; call: (args: Val[], line: number) => Val };
type Obj = { kind: "object"; props: Map<string, Val> };
type Val = number | string | boolean | null | undefined | Val[] | Obj | Closure | Builtin;
type Binding = { value: Val; constant: boolean; order: number };
type Env = { vars: Map<string, Binding>; parent?: Env; frame: number };

class Signal {
  readonly kind: "break" | "continue" | "return";
  readonly value?: Val;
  constructor(kind: "break" | "continue" | "return", value?: Val) {
    this.kind = kind;
    this.value = value;
  }
}

const isFn = (v: Val): v is Closure | Builtin => typeof v === "object" && v !== null && !Array.isArray(v) && (v.kind === "closure" || v.kind === "builtin");
const isObj = (v: Val): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v) && v.kind === "object";

// How a value reads on screen. Strings in quotes, like a debugger shows them.
export function display(v: Val, top = false, depth = 0): string {
  if (typeof v === "string") return top ? v : `'${v}'`;
  if (typeof v === "number") return Object.is(v, -0) ? "0" : String(v);
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "boolean") return String(v);
  if (depth > 3) return "...";
  if (Array.isArray(v)) return `[${v.map((x) => display(x, false, depth + 1)).join(", ")}]`;
  if (isObj(v)) return `{${[...v.props].map(([k, x]) => `${k}: ${display(x, false, depth + 1)}`).join(", ")}}`;
  return v.kind === "closure" ? `function ${v.fn.name}` : `function ${v.name}`;
}

export function trace(source: string, limits: TraceLimits = TRACE_LIMITS): TraceEvent[] {
  const program = parse(source);
  const events: TraceEvent[] = [];
  const output: string[] = [];
  const stack: (Frame & { env: Env })[] = [];
  let steps = 0;
  let order = 0;
  const fail = (msg: string, line: number): never => {
    throw new TraceError(msg, line);
  };

  const builtins = new Map<string, Val>();
  const fn = (name: string, call: (args: Val[], line: number) => Val): Builtin => ({ kind: "builtin", name, call });
  const nums = (args: Val[], name: string, line: number) =>
    args.map((a) => (typeof a === "number" ? a : fail(`${name} needs numbers, not ${display(a)}`, line)));
  const print = fn("print", (args) => {
    if (output.length >= 200) fail("the program printed more than 200 lines", stack.at(-1)?.line ?? 0);
    output.push(args.map((a) => display(a, true)).join(" "));
    return undefined;
  });
  const math = new Map<string, Val>([["PI", Math.PI], ["E", Math.E]]);
  for (const m of ["floor", "ceil", "round", "abs", "sqrt", "trunc", "sign", "min", "max", "pow", "log", "exp", "sin", "cos"] as const) {
    math.set(m, fn(`Math.${m}`, (args, line) => (Math[m] as (...x: number[]) => number)(...nums(args, `Math.${m}`, line))));
  }
  builtins.set("console", { kind: "object", props: new Map([["log", print]]) });
  builtins.set("print", print);
  builtins.set("Math", { kind: "object", props: math });
  builtins.set("parseInt", fn("parseInt", (a) => parseInt(String(a[0]), typeof a[1] === "number" ? a[1] : 10)));
  builtins.set("String", fn("String", (a) => display(a[0], true)));
  builtins.set("Number", fn("Number", (a) => Number(typeof a[0] === "object" ? NaN : a[0])));
  builtins.set("Infinity", Infinity);
  builtins.set("NaN", NaN);
  builtins.set("undefined", undefined);

  const global: Env = { vars: new Map(), frame: 0 };
  const lookup = (env: Env, n: string, line: number): Binding | undefined => {
    for (let e: Env | undefined = env; e; e = e.parent) {
      const b = e.vars.get(n);
      if (b) return b;
    }
    if (builtins.has(n)) return { value: builtins.get(n), constant: true, order: -1 };
    return fail(`${n} is not defined`, line);
  };
  const declare = (env: Env, n: string, value: Val, constant: boolean, line: number) => {
    if (env.vars.has(n)) fail(`${n} is declared twice`, line);
    env.vars.set(n, { value, constant, order: order++ });
  };

  const snapshot = (type: TraceEvent["type"], line: number, returned?: Val) => {
    if (events.length >= limits.events) fail(`the program takes more than ${limits.events} steps to show; give it a smaller input`, line);
    const top = stack.at(-1)!;
    const seen = new Map<string, Binding>();
    for (let e: Env | undefined = top.env; e; e = e.parent) for (const [n, b] of e.vars) if (!seen.has(n) && !isFn(b.value)) seen.set(n, b);
    const vars = [...seen].sort((a, b) => a[1].order - b[1].order).map(([name, b]) => ({ name, value: display(b.value) }));
    events.push({ type, line, stack: stack.map(({ name, args, line }) => ({ name, args, line })), vars, output: [...output], ...(type === "return" ? { returned: display(returned) } : {}) });
  };
  const at = (line: number) => {
    if (++steps > limits.steps) fail(`the program ran more than ${limits.steps} steps; it may never stop`, line);
    snapshot("line", line);
  };
  const size = (v: Val[] | string, line: number) => {
    if (v.length > limits.size) fail(`a list or string grew past ${limits.size} items`, line);
  };

  const call = (f: Val, args: Val[], line: number): Val => {
    if (!isFn(f)) return fail(`${display(f)} is not a function`, line);
    if (f.kind === "builtin") return f.call(args, line);
    if (stack.length >= limits.depth) fail(`calls went more than ${limits.depth} deep`, line);
    const env: Env = { vars: new Map(), parent: f.env, frame: stack.length };
    f.fn.params.forEach((p, i) => declare(env, p, args[i], false, line));
    stack.push({ name: f.fn.name, args: f.fn.params.map((p, i) => `${p}=${display(args[i])}`).join(", "), line, env });
    let result: Val;
    try {
      const s = block(f.fn.body, env);
      result = s instanceof Signal && s.kind === "return" ? s.value : undefined;
    } finally {
      stack.pop();
    }
    snapshot("return", line, result);
    return result;
  };

  const block = (list: Stmt[], env: Env): Signal | undefined => {
    for (const s of list) if (s.k === "func") declare(env, s.fn.name, { kind: "closure", fn: s.fn, env }, false, s.line);
    for (const s of list) {
      const r = exec(s, env);
      if (r) return r;
    }
    return undefined;
  };

  const loopBody = (body: Stmt, env: Env): "break" | Signal | undefined => {
    const r = exec(body, env);
    if (!r) return undefined;
    if (r.kind === "break") return "break";
    if (r.kind === "continue") return undefined;
    return r;
  };

  const exec = (s: Stmt, env: Env): Signal | undefined => {
    switch (s.k) {
      case "empty":
      case "func":
        return;
      case "block":
        return block(s.body, { vars: new Map(), parent: env, frame: env.frame });
      case "expr":
        at(s.line);
        evaluate(s.e, env);
        return;
      case "decl":
        at(s.line);
        for (const [n, e] of s.list) declare(env, n, e ? evaluate(e, env) : undefined, s.kind === "const", s.line);
        return;
      case "if":
        at(s.line);
        if (truthy(evaluate(s.test, env))) return exec(s.then, env);
        return s.else ? exec(s.else, env) : undefined;
      case "while":
        for (;;) {
          at(s.line);
          if (!truthy(evaluate(s.test, env))) return;
          const r = loopBody(s.body, env);
          if (r === "break") return;
          if (r) return r;
        }
      case "for": {
        const scope: Env = { vars: new Map(), parent: env, frame: env.frame };
        at(s.line);
        if (s.init) {
          if (s.init.k === "decl") for (const [n, e] of s.init.list) declare(scope, n, e ? evaluate(e, scope) : undefined, s.init.kind === "const", s.line);
          else if (s.init.k === "expr") evaluate(s.init.e, scope);
        }
        for (let first = true; ; first = false) {
          if (!first) {
            at(s.line);
            if (s.update) evaluate(s.update, scope);
          }
          if (s.test && !truthy(evaluate(s.test, scope))) return;
          const r = loopBody(s.body, { vars: new Map(), parent: scope, frame: env.frame });
          if (r === "break") return;
          if (r) return r;
        }
      }
      case "forof": {
        at(s.line);
        const it = evaluate(s.iter, env);
        const list = Array.isArray(it) ? it : typeof it === "string" ? [...it] : fail(`for...of needs a list or a string, not ${display(it)}`, s.line);
        for (let i = 0; i < list.length; i++) {
          if (i > 0) at(s.line);
          const scope: Env = { vars: new Map(), parent: env, frame: env.frame };
          declare(scope, s.name, list[i], s.kind === "const", s.line);
          const r = loopBody(s.body, scope);
          if (r === "break") return;
          if (r) return r;
        }
        if (list.length) at(s.line);
        return;
      }
      case "return":
        at(s.line);
        if (stack.length < 2) fail("return outside a function", s.line);
        return new Signal("return", s.e ? evaluate(s.e, env) : undefined);
      case "break":
      case "continue":
        at(s.line);
        return new Signal(s.k);
    }
  };

  const truthy = (v: Val) => (Array.isArray(v) || isObj(v) || isFn(v) ? true : !!v);
  const key = (v: Val, line: number): string | number => (typeof v === "number" || typeof v === "string" ? v : fail(`${display(v)} cannot be used as an index`, line));

  const getProp = (obj: Val, prop: string | number, line: number): Val => {
    if (Array.isArray(obj) || typeof obj === "string") {
      if (prop === "length") return obj.length;
      if (typeof prop === "number" || /^\d+$/.test(prop)) return obj[Number(prop)];
      return method(obj, prop, line);
    }
    if (isObj(obj)) return obj.props.get(String(prop));
    return fail(`cannot read ${prop} of ${display(obj)}`, line);
  };
  const method = (obj: Val[] | string, name: string, line: number): Builtin => {
    const m = (call: (args: Val[]) => Val) => fn(name, call);
    if (Array.isArray(obj)) {
      const a = obj;
      const table: Record<string, (args: Val[]) => Val> = {
        push: (x) => {
          a.push(...x);
          size(a, line);
          return a.length;
        },
        pop: () => a.pop(),
        shift: () => a.shift(),
        unshift: (x) => {
          a.unshift(...x);
          size(a, line);
          return a.length;
        },
        slice: (x) => a.slice(x[0] as number | undefined, x[1] as number | undefined),
        indexOf: (x) => a.indexOf(x[0]),
        includes: (x) => a.includes(x[0]),
        join: (x) => a.map((v) => display(v, true)).join(x[0] === undefined ? "," : String(x[0])),
        concat: (x) => a.concat(...x),
        reverse: () => a.reverse(),
      };
      if (!table[name]) fail(`lists have no method ${name} here; supported: ${Object.keys(table).join(", ")}, length`, line);
      return m(table[name]!);
    }
    const s = obj;
    const table: Record<string, (args: Val[]) => Val> = {
      toUpperCase: () => s.toUpperCase(),
      toLowerCase: () => s.toLowerCase(),
      slice: (x) => s.slice(x[0] as number | undefined, x[1] as number | undefined),
      charAt: (x) => s.charAt(Number(x[0] ?? 0)),
      indexOf: (x) => s.indexOf(String(x[0])),
      includes: (x) => s.includes(String(x[0])),
      split: (x) => s.split(String(x[0] ?? "")),
    };
    if (!table[name]) fail(`strings have no method ${name} here; supported: ${Object.keys(table).join(", ")}, length`, line);
    return m(table[name]!);
  };
  const setProp = (obj: Val, prop: string | number, value: Val, line: number) => {
    if (Array.isArray(obj)) {
      const i = typeof prop === "number" ? prop : /^\d+$/.test(prop) ? Number(prop) : fail(`cannot set ${prop} on a list`, line);
      if (!Number.isInteger(i) || i < 0 || i > limits.size) fail(`${i} is not a usable list index`, line);
      obj[i] = value;
      return;
    }
    if (isObj(obj)) {
      obj.props.set(String(prop), value);
      return;
    }
    fail(`cannot set ${prop} on ${display(obj)}`, line);
  };

  const arith = (op: string, a: Val, b: Val, line: number): Val => {
    if (op === "===") return a === b;
    if (op === "!==") return a !== b;
    if (op === "==") return a == b; // eslint-disable-line eqeqeq
    if (op === "!=") return a != b; // eslint-disable-line eqeqeq
    if (op === "+" && (typeof a === "string" || typeof b === "string")) {
      const s = display(a, true) + display(b, true);
      size(s, line);
      return s;
    }
    const prim = (v: Val) => (typeof v === "object" && v !== null ? fail(`cannot use ${display(v)} in ${op}`, line) : (v as number));
    const [x, y] = [prim(a), prim(b)];
    switch (op) {
      case "+": return x + y;
      case "-": return x - y;
      case "*": return x * y;
      case "/": return x / y;
      case "%": return x % y;
      case "**": return x ** y;
      case "<": return x < y;
      case ">": return x > y;
      case "<=": return x <= y;
      case ">=": return x >= y;
    }
    return fail(`unknown operator ${op}`, line);
  };

  const store = (target: Expr, value: Val, env: Env) => {
    if (target.k === "name") {
      const b = lookup(env, target.v, target.line)!;
      if (b.order < 0) fail(`cannot change ${target.v}`, target.line);
      if (b.constant) fail(`${target.v} is a const and cannot change`, target.line);
      b.value = value;
    } else if (target.k === "member") setProp(evaluate(target.obj, env), target.prop, value, target.line);
    else if (target.k === "index") setProp(evaluate(target.obj, env), key(evaluate(target.index, env), target.line), value, target.line);
    else fail("cannot assign to this", target.line);
  };

  const evaluate = (e: Expr, env: Env): Val => {
    switch (e.k) {
      case "num":
      case "str":
      case "lit":
        return e.v;
      case "name":
        return lookup(env, e.v, e.line)!.value;
      case "array": {
        const a = e.items.map((x) => evaluate(x, env));
        size(a, e.line);
        return a;
      }
      case "object":
        return { kind: "object", props: new Map(e.props.map(([k, x]) => [k, evaluate(x, env)])) };
      case "func":
        return { kind: "closure", fn: e.fn, env };
      case "unary": {
        const v = evaluate(e.e, env);
        if (e.op === "!") return !truthy(v);
        if (e.op === "typeof") return v === null ? "object" : Array.isArray(v) || isObj(v) ? "object" : isFn(v) ? "function" : typeof v;
        if (typeof v !== "number") fail(`${e.op} needs a number, not ${display(v)}`, e.line);
        return e.op === "-" ? -(v as number) : (v as number);
      }
      case "update": {
        const old = evaluate(e.e, env);
        if (typeof old !== "number") return fail(`${e.op} needs a number, not ${display(old)}`, e.line);
        const next = e.op === "++" ? old + 1 : old - 1;
        store(e.e, next, env);
        return e.prefix ? next : old;
      }
      case "binary":
        return arith(e.op, evaluate(e.a, env), evaluate(e.b, env), e.line);
      case "logical": {
        const a = evaluate(e.a, env);
        if (e.op === "&&") return truthy(a) ? evaluate(e.b, env) : a;
        if (e.op === "||") return truthy(a) ? a : evaluate(e.b, env);
        return a === null || a === undefined ? evaluate(e.b, env) : a;
      }
      case "cond":
        return truthy(evaluate(e.test, env)) ? evaluate(e.a, env) : evaluate(e.b, env);
      case "assign": {
        const value = evaluate(e.e, env);
        const next = e.op === "=" ? value : arith(e.op.slice(0, -1), evaluate(e.target, env), value, e.line);
        store(e.target, next, env);
        return next;
      }
      case "member":
        return getProp(evaluate(e.obj, env), e.prop, e.line);
      case "index":
        return getProp(evaluate(e.obj, env), key(evaluate(e.index, env), e.line), e.line);
      case "call": {
        const f = evaluate(e.callee, env);
        return call(f, e.args.map((a) => evaluate(a, env)), e.line);
      }
    }
  };

  stack.push({ name: "program", args: "", line: 0, env: global });
  block(program, global);
  const last = events.at(-1);
  snapshot("end", last?.line ?? 1);
  return events;
}
