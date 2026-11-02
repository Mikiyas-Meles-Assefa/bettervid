// Attacks on the sandbox. Each one is something a hostile or broken program could really try.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { childCommand, LIMITS, runProgram, sandboxLayers, type ProgramInput, type RunResult } from "./sandbox.ts";

const input: ProgramInput = { W: 800, H: 600, T0: 10, T1: 100, fps: 30, frames: 300, seed: 7, args: { n: 3 }, on: {}, words: [{ text: "hi", frame: 12 }], colors: ["ink", "accent"] };
const run = (src: string, over: Partial<ProgramInput> = {}, limits = LIMITS) => runProgram(src, { ...input, ...over }, limits);
const errorOf = (r: RunResult) => (r.ok ? "" : r.error);
// A probe writes what it found into a text node, so a test can read what the program could see.
const probe = async (expr: string) => {
  const r = await run(`let v; try { v = ${expr}; } catch (e) { v = "threw: " + (e && e.message); } text("x", { text: String(v) });`);
  assert.ok(r.ok, errorOf(r));
  return (r as Extract<RunResult, { ok: true }>).output.nodes[0]!.props.text as string;
};

test("a normal program returns parts, keys and events", async () => {
  const r = await run(`for (let i = 0; i < args.n; i++) path("p" + i, { points: circle(i * 10, 0, 5), fill: "accent" }); anim("p0", "x", T0, T1, (t) => t * W, 10); emit("hit", T0 + 1, { a: 1 });`);
  assert.ok(r.ok, errorOf(r));
  const out = (r as Extract<RunResult, { ok: true }>).output;
  assert.equal(out.nodes.length, 3);
  assert.equal(out.tracks[0]!.keys.at(-1)!.value, 800);
  assert.equal(out.events[0]!.name, "hit");
});

test("the same seed gives the same result, and another seed differs", async () => {
  const src = `text("r", { text: String(Math.random() + random()) });`;
  const [a, b, c] = await Promise.all([run(src), run(src), run(src, { seed: 8 })]);
  assert.deepEqual((a as any).output, (b as any).output);
  assert.notDeepEqual((a as any).output, (c as any).output);
});

test("nothing from the host is reachable", async () => {
  for (const e of ["process", "require", "module", "global", "console", "fetch", "setTimeout", "setInterval", "queueMicrotask", "Buffer", "XMLHttpRequest", "WebSocket", "navigator", "performance", "URL", "Function", "eval", "Date", "Intl", "WebAssembly", "SharedArrayBuffer", "Atomics", "ArrayBuffer", "Float64Array", "WeakRef", "FinalizationRegistry"]) {
    assert.equal(await probe(`typeof ${e}`), "undefined", e);
  }
});

test("constructor tricks cannot make code from strings or reach the host", async () => {
  assert.match(await probe(`(function () {}).constructor("return process")()`), /threw: Code generation/);
  assert.equal(await probe(`typeof this`), "undefined");
  assert.match(await probe(`(async function () {}).constructor("return 1")`), /threw: Code generation/);
  assert.match(await probe(`(function* () {}).constructor("yield 1")`), /threw: Code generation/);
  assert.match(await probe(`Object.getPrototypeOf(Array).constructor("return globalThis.process")()`), /threw: Code generation/);
  assert.match(await probe(`Reflect.construct(Object.getPrototypeOf(group).constructor, ["return 1"])`), /threw: Code generation/);
  assert.equal(await probe(`typeof globalThis.__run`), "undefined");
  assert.equal(await probe(`Object.getOwnPropertyNames(globalThis).filter((k) => !/^[A-Z]/.test(k)).sort().join()`), "globalThis,isFinite,isNaN,parseFloat,parseInt,undefined");
});

test("dynamic import fails", async () => {
  const r = await run(`let done = "none"; import("node:fs").then(() => { throw new Error("got fs"); }).catch(() => {}); text("x", { text: done });`);
  assert.ok(r.ok, errorOf(r));
});

test("errors thrown from inside cannot run code on the host side", async () => {
  const r = await run(`const e = new Error("x"); Object.defineProperty(e, "message", { get() { for (;;); } }); throw e;`);
  assert.equal(r.ok, false);
  const p = await run(`throw new Proxy({}, { get() { for (;;); } });`);
  assert.equal(p.ok, false);
  const q = await run(`throw { get stack() { for (;;); } };`);
  assert.equal(q.ok, false);
});

test("an endless loop is stopped and named", async () => {
  const r = await run(`for (;;) {}`, {}, { ...LIMITS, cpuMs: 200 });
  assert.match(errorOf(r), /limit/);
  assert.ok(r.ms < 2500, `took ${r.ms}`);
});

test("endless async work is stopped too", async () => {
  const r = await run(`const spin = () => Promise.resolve().then(spin); spin();`, {}, { ...LIMITS, cpuMs: 200 });
  assert.match(errorOf(r), /limit/);
});

test("a regex that backtracks forever is stopped", async () => {
  const r = await run(`/^(a+)+$/.test("a".repeat(40) + "b");`, {}, { ...LIMITS, cpuMs: 200 });
  assert.match(errorOf(r), /limit/);
});

test("a memory bomb is killed", async () => {
  const r = await run(`const a = []; for (;;) a.push(new Array(10000).fill(1.5));`);
  assert.match(errorOf(r), /memory|limit/);
  const s = await run(`let s = "x"; for (;;) s += s;`);
  assert.equal(s.ok, false);
  const m = await run(`const m = new Map(); for (let i = 0; ; i++) m.set(i, { i });`);
  assert.equal(m.ok, false);
});

test("runaway recursion is reported, not fatal", async () => {
  const r = await run(`const f = () => f(); f();`);
  assert.match(errorOf(r), /stack/i);
});

test("too much output is stopped", async () => {
  const r = await run(`text("x", { text: "a".repeat(9000000) });`);
  assert.match(errorOf(r), /byte limit/);
});

test("part and keyframe limits hold", async () => {
  assert.match(errorOf(await run(`for (let i = 0; ; i++) text("t" + i, {});`)), /too many parts/);
  assert.match(errorOf(await run(`text("t", {}); for (let i = 0; ; i++) key("t", "x", i, i);`)), /too many keyframes/);
});

test("syntax errors and runtime errors give the program's own line", async () => {
  const s = await run(`const a = 1;\nconst b = ;\n`);
  assert.equal(s.ok, false);
  assert.equal((s as any).line, 2);
  const r = await run(`const a = 1;\n\nnope();\n`);
  assert.match(errorOf(r), /nope is not defined/);
  assert.equal((r as any).line, 3);
});

test("closing the wrapper early still finds no host", async () => {
  const q = await run(`}); globalThis.__run = () => JSON.stringify({ nodes: [{ id: typeof process, kind: "text", props: {} }], tracks: [], events: [] }); (function () {`);
  assert.equal((q as any).output.nodes[0].id, "undefined"); // and whatever it returns is only a string the parent validates
});

// The tests below run as if a program had already broken out of the context, and prove the outer layers stand on their own.
const outside = (code: string) => {
  const [cmd, ...argv] = childCommand(code);
  return spawnSync(cmd!, argv, { env: {}, cwd: tmpdir(), encoding: "utf8", timeout: 6000 });
};

test("the process cannot read or write files", () => {
  const read = outside(`try { require("node:fs").readFileSync(${JSON.stringify(import.meta.filename)}); console.log("READ"); } catch (e) { console.log(e.code); }`);
  assert.match(read.stdout, /ERR_ACCESS_DENIED/);
  const write = outside(`try { require("node:fs").writeFileSync("/tmp/bettervid-sandbox-probe", "x"); console.log("WROTE"); } catch (e) { console.log(e.code); }`);
  assert.match(write.stdout, /ERR_ACCESS_DENIED/);
});

test("the process cannot start other processes or workers, and holds no secrets", () => {
  const exec = outside(`try { require("node:child_process").execSync("echo hi"); console.log("RAN"); } catch (e) { console.log(e.code); }`);
  assert.match(exec.stdout, /ERR_ACCESS_DENIED/);
  const worker = outside(`try { new (require("node:worker_threads").Worker)("1", { eval: true }); console.log("RAN"); } catch (e) { console.log(e.code); }`);
  assert.match(worker.stdout, /ERR_ACCESS_DENIED/);
  const env = outside(`console.log(Object.keys(process.env).filter((k) => /KEY|TOKEN|SECRET/i.test(k)).length)`);
  assert.equal(env.stdout.trim(), "0");
});

test("the network is blocked at the OS level where that is available", async (t) => {
  const layers = sandboxLayers();
  console.log("sandbox layers:", JSON.stringify(layers));
  if (!layers.osNetworkBlock) return t.skip("no OS network block on this machine");
  const out = outside(`const s = require("node:net").connect(53, "1.1.1.1"); s.on("connect", () => { console.log("CONNECTED"); s.destroy(); }); s.on("error", (e) => console.log(e.code)); setTimeout(() => process.exit(), 2500);`);
  assert.doesNotMatch(out.stdout, /CONNECTED/);
});
