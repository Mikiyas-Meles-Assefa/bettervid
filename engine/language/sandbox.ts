// Runs generated programs. A program is untrusted code from a model, and this may run on a public site, so it gets:
//   1. Its own short-lived process: empty environment, Node's permission model (no files, no child processes, no
//      workers), a small heap, and a hard kill on a timer.
//   2. An OS network block where one exists (sandbox-exec on macOS, a network namespace on Linux). See `sandboxLayers`.
//   3. A fresh V8 context holding only an allowed list of language globals, with code generation from strings off.
//      No host object ever enters it. The only thing that leaves is one string, which the parent validates as plain data.
// Programs run once while a scene compiles and return data, never code, so nothing generated runs at render time.
// Node's docs say `node:vm` alone is not a security boundary, which is why it is only one layer here. The risk left is
// a bug in V8 itself; `sandboxLayers` says whether the network would still be shut in that case.
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

export type ProgramTarget = { x: number; y: number; w: number; h: number };
export type ProgramInput = {
  W: number;
  H: number;
  T0: number;
  T1: number;
  fps: number;
  frames: number;
  seed: number;
  args: Record<string, unknown>;
  on: Record<string, ProgramTarget>;
  words: { text: string; frame: number }[];
  colors: string[];
};
export type RawNode = { id: string; kind: string; parent?: string; props: Record<string, unknown> };
export type RawKey = { at: number; value: unknown; ease?: string };
export type RawTrack = { target: string; prop: string; keys: RawKey[] };
export type RawEvent = { name: string; at: number; data?: Record<string, unknown> };
// A number the program worked out at a frame, read back by code: how a program shows that its rules did what it claims.
export type RawMeasure = { name: string; at: number; value: number };
export type RawOutput = { nodes: RawNode[]; tracks: RawTrack[]; events: RawEvent[]; measures?: RawMeasure[] };
export type RunResult = { ok: true; output: RawOutput; ms: number } | { ok: false; error: string; line?: number; ms: number };
export type Limits = { cpuMs: number; wallMs: number; heapMb: number; outputBytes: number; nodes: number; keys: number; measures: number };

export const LIMITS: Limits = { cpuMs: 1500, wallMs: 4000, heapMb: 48, outputBytes: 6_000_000, nodes: 2500, keys: 150_000, measures: 2000 };

// The only globals a program can see. Everything else, including every clock, is deleted before it runs.
const ALLOWED = ["Object", "Array", "Number", "Boolean", "String", "Symbol", "BigInt", "Math", "JSON", "Map", "Set", "WeakMap", "WeakSet", "Error", "TypeError", "RangeError", "SyntaxError", "EvalError", "ReferenceError", "URIError", "AggregateError", "RegExp", "Reflect", "Proxy", "Promise", "parseInt", "parseFloat", "isNaN", "isFinite", "NaN", "Infinity", "undefined", "globalThis"];

// Everything a program can call. Each name is in scope as a plain variable.
export const API_NAMES = ["W", "H", "T0", "T1", "fps", "frames", "seed", "args", "on", "words", "colors", "random", "TAU", "group", "path", "text", "key", "anim", "emit", "measure", "arc", "circle", "rect", "polygon", "curve", "lerp", "clamp", "smooth"];

// Runs inside the fresh context, before the program. This is the program's whole world.
const prelude = (input: ProgramInput, limits: Limits) => `(function () {
  "use strict";
  const allowed = new Set(${JSON.stringify(ALLOWED)});
  for (const name of Object.getOwnPropertyNames(globalThis)) if (!allowed.has(name)) delete globalThis[name];
  Error.stackTraceLimit = 4;

  // Seeded randomness: the same seed always gives the same video.
  let state = ${(input.seed >>> 0) || 1};
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = random;
  Number.prototype.toLocaleString = Number.prototype.toString;

  const INPUT = JSON.parse(${JSON.stringify(JSON.stringify(input))});
  const nodes = [], tracks = new Map(), events = [], measures = [];
  let keyCount = 0;
  const num = (v, what) => { if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError(what + " must be a finite number, got " + String(v)); return v; };
  const addNode = (kind, id, props) => {
    if (typeof id !== "string") throw new TypeError(kind + "() needs a string id as its first argument");
    if (nodes.length >= ${limits.nodes}) throw new RangeError("too many parts: the limit is ${limits.nodes}");
    const { parent, ...rest } = props || {};
    nodes.push(parent === undefined ? { id, kind, props: rest } : { id, kind, parent, props: rest });
    return id;
  };
  const key = (id, prop, at, value, ease) => {
    if (keyCount++ >= ${limits.keys}) throw new RangeError("too many keyframes: the limit is ${limits.keys}");
    num(at, "the frame given to key()");
    const name = id + "\\u0000" + prop;
    if (!tracks.has(name)) tracks.set(name, { target: id, prop, keys: [] });
    tracks.get(name).keys.push(ease === undefined ? { at: Math.round(at), value } : { at: Math.round(at), value, ease });
  };
  const anim = (id, prop, from, to, fn, step) => {
    const gap = Math.max(1, Math.round(step || 2));
    num(from, "the start frame given to anim()");
    num(to, "the end frame given to anim()");
    if (to < from) throw new RangeError("anim() ends at frame " + to + " before it starts at frame " + from);
    for (let f = from; ; f += gap) {
      const at = Math.min(f, to);
      key(id, prop, at, fn(to === from ? 1 : (at - from) / (to - from), at), "linear");
      if (at >= to) break;
    }
  };
  const TAU = Math.PI * 2;
  const arc = (cx, cy, r, a0, a1, n) => { const c = n || 48, out = []; for (let i = 0; i <= c; i++) { const a = a0 + (a1 - a0) * i / c; out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } return out; };
  const circle = (cx, cy, r, n) => arc(cx, cy, r, 0, TAU, n);
  const rect = (x, y, w, h) => [x, y, x + w, y, x + w, y + h, x, y + h, x, y];
  const polygon = (cx, cy, r, sides, turn) => { const out = []; for (let i = 0; i <= sides; i++) { const a = (turn || 0) - Math.PI / 2 + TAU * i / sides; out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } return out; };
  const curve = (from, to, fn, n) => { const c = n || 64, out = []; for (let i = 0; i <= c; i++) { const x = from + (to - from) * i / c; out.push(x, fn(x)); } return out; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

  const api = {
    W: INPUT.W, H: INPUT.H, T0: INPUT.T0, T1: INPUT.T1, fps: INPUT.fps, frames: INPUT.frames, seed: INPUT.seed,
    args: INPUT.args, on: INPUT.on, words: INPUT.words, colors: INPUT.colors, random, TAU,
    group: (id, p) => addNode("group", id, p), path: (id, p) => addNode("path", id, p), text: (id, p) => addNode("text", id, p),
    key, anim, emit: (name, at, data) => { events.push({ name: String(name), at: Math.round(num(at, "the frame given to emit()")), data }); },
    measure: (name, at, value) => {
      if (measures.length >= ${limits.measures}) throw new RangeError("too many measures: the limit is ${limits.measures}, so measure once a second or at the moments that matter");
      measures.push({ name: String(name), at: Math.round(num(at, "the frame given to measure()")), value: num(value, "the value given to measure(" + String(name) + ")") });
    },
    arc, circle, rect, polygon, curve, lerp, clamp, smooth,
  };
  const stringify = JSON.stringify, list = Array.from, message = (e) => {
    try {
      const m = e && typeof e.stack === "string" ? /program:(\\d+)/.exec(e.stack) : null;
      return stringify({ error: String(e && e.message !== undefined ? e.message : e).slice(0, 400), line: m ? Number(m[1]) - 1 : undefined });
    } catch { return stringify({ error: "the program failed" }); }
  };
  globalThis.__run = () => {
    const main = globalThis.__main;
    delete globalThis.__main;
    delete globalThis.__run;
    try {
      main(api);
      return stringify({ nodes, tracks: list(tracks.values()), events, measures });
    } catch (e) { return message(e); }
  };
})();`;

// The program's line 1 sits on the script's line 2, so its line numbers can be reported back exactly.
const wrap = (source: string) => `"use strict"; globalThis.__main = (function ({ ${API_NAMES.join(", ")} }) {\n${source}\n});`;

// Runs in the child process, in Node's own context. It hands the program nothing, and only ever passes a string out.
const RUNNER = `"use strict";
const vm = require("node:vm");
const { isNativeError, isProxy } = require("node:util").types;
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  const { prelude, program, cpuMs } = JSON.parse(raw);
  raw = "";
  const context = vm.createContext(Object.create(null), { name: "program", codeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate" });
  const opts = { timeout: cpuMs };
  let out;
  let script;
  try {
    // Compiling runs nothing from the program, so this error is entirely ours and safe to read.
    script = new vm.Script(program, { filename: "program" });
  } catch (e) {
    const at = /^program:(\\d+)/.exec(String(e.stack));
    process.stdout.write(JSON.stringify({ error: String(e.message), line: at ? Number(at[1]) - 1 : undefined }));
    return;
  }
  try {
    vm.runInContext(prelude, context, { ...opts, filename: "prelude" });
    script.runInContext(context, opts);
    out = vm.runInContext("globalThis.__run()", context, { ...opts, filename: "finish" });
    if (typeof out !== "string") out = JSON.stringify({ error: "the program did not finish" });
  } catch (e) {
    // From here a thrown value may come from the program. Never read it the normal way: a getter would run its code here.
    let error = "the program failed";
    try {
      if (!isProxy(e) && isNativeError(e)) {
        const own = (k) => { const v = Object.getOwnPropertyDescriptor(e, k); return v && typeof v.value === "string" ? v.value : ""; };
        error = own("code") === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? "timeout" : own("message") || error;
      }
    } catch {}
    out = JSON.stringify({ error });
  }
  process.stdout.write(out);
});
`;

// The OS wrapper for this machine, if one works here. Probed once, since it can be refused inside containers.
let wrapper: string[] | undefined;
function osWrapper(): string[] {
  if (wrapper) return wrapper;
  const options = process.platform === "darwin" ? [["sandbox-exec", "-p", `(version 1)(allow default)(deny network*)`]] : process.platform === "linux" ? [["unshare", "--user", "--map-root-user", "--net", "--"]] : [];
  wrapper = [];
  for (const o of options) {
    const r = spawnSync(o[0]!, [...o.slice(1), process.execPath, "--version"], { stdio: "ignore", timeout: 3000 });
    if (r.status === 0) {
      wrapper = o;
      break;
    }
  }
  return wrapper;
}

// What protection is really on, so a deployment can check it instead of assuming.
export function sandboxLayers(): { process: true; permissions: true; context: true; osNetworkBlock: boolean } {
  return { process: true, permissions: true, context: true, osNetworkBlock: osWrapper().length > 0 };
}

// The exact command a program's process starts with. Exported so tests can prove what that process cannot do.
export function childCommand(script: string, limits: Limits = LIMITS): string[] {
  return [...osWrapper(), process.execPath, "--permission", "--disallow-code-generation-from-strings", `--max-old-space-size=${limits.heapMb}`, "--max-semi-space-size=4", "--stack-size=800", "-e", script];
}

const friendly = (error: string, limits: Limits) => (error === "timeout" ? `it ran longer than the ${limits.cpuMs} ms limit, so look for a loop that never ends or too much work` : error);

// Runs one program and returns plain data or a message that says what went wrong. Never throws on bad programs.
export function runProgram(source: string, input: ProgramInput, limits: Limits = LIMITS): Promise<RunResult> {
  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  const [cmd, ...argv] = childCommand(RUNNER, limits);
  return new Promise((done) => {
    const child = spawn(cmd!, argv, { env: {}, cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let why = "";
    const stop = (reason: string) => {
      why ||= reason;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop(`it ran longer than the ${limits.wallMs} ms limit`), limits.wallMs);
    child.stdout.on("data", (d: Buffer) => {
      size += d.length;
      if (size > limits.outputBytes) return stop(`its output passed the ${limits.outputBytes} byte limit`);
      chunks.push(d);
    });
    child.stderr.on("data", () => {}); // drained, never read: it can hold nothing useful and must not fill its pipe
    child.stdin.on("error", () => {}); // the child may die before reading everything
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ ok: false, error: `the sandbox could not start: ${e.message}`, ms: ms() });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (why) return done({ ok: false, error: why, ms: ms() });
      if (code !== 0 || signal) return done({ ok: false, error: `it used more than the ${limits.heapMb} MB memory limit or crashed (exit ${signal ?? code})`, ms: ms() });
      try {
        const out = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (typeof out.error === "string") return done({ ok: false, error: friendly(out.error, limits), ...(typeof out.line === "number" ? { line: out.line } : {}), ms: ms() });
        done({ ok: true, output: out as RawOutput, ms: ms() });
      } catch {
        done({ ok: false, error: "it did not return readable data", ms: ms() });
      }
    });
    child.stdin.end(JSON.stringify({ prelude: prelude(input, limits), program: wrap(source), cpuMs: limits.cpuMs }));
  });
}
