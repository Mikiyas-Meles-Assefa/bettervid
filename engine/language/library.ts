// The growing library. A program a model wrote can be kept for reuse, but only after it passes tests in the sandbox: it
// must run cleanly at several sizes and seeds, give the same result twice, stay inside its box, and be general.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkOutput } from "./program.ts";
import { runProgram, type ProgramInput, type RawNode } from "./sandbox.ts";

export type LibraryEntry = { name: string; doc: string; params: Record<string, string>; source: string; tested?: string };

const DIR = join(dirname(fileURLToPath(import.meta.url)), "library");
const COLORS = ["ink", "accent", "paper", "highlight", "soft"];

export function loadLibrary(dir = DIR): LibraryEntry[] {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as LibraryEntry);
}

// How much of a program's drawing falls outside its box, from 0 to 1. Only static start positions can be checked.
function outside(nodes: RawNode[], W: number, H: number): number {
  let total = 0;
  let out = 0;
  for (const n of nodes) {
    const ox = typeof n.props.x === "number" && !n.parent ? n.props.x : 0;
    const oy = typeof n.props.y === "number" && !n.parent ? n.props.y : 0;
    const p = Array.isArray(n.props.points) ? (n.props.points as number[]) : [];
    for (let i = 0; i + 1 < p.length; i += 2) {
      total++;
      const [x, y] = [p[i]! + ox, p[i + 1]! + oy];
      if (!n.parent && (x < -W * 0.1 || x > W * 1.1 || y < -H * 0.1 || y > H * 1.1)) out++;
    }
  }
  return total ? out / total : 0;
}

// Every way a candidate can fail. An empty list means it may be saved.
export async function testProgram(entry: LibraryEntry): Promise<string[]> {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(entry.name)) problems.push("the name must be lowercase letters, digits and hyphens");
  if (entry.doc.trim().length < 12) problems.push("it needs a one-line description of what it can do");
  const cases: Pick<ProgramInput, "W" | "H" | "seed" | "T0" | "T1">[] = [
    { W: 900, H: 900, seed: 1, T0: 0, T1: 150 },
    { W: 600, H: 1100, seed: 2, T0: 40, T1: 400 },
    { W: 1000, H: 420, seed: 3, T0: 10, T1: 60 },
  ];
  for (const c of cases) {
    // A spoken moment has no word to land on here, so it stands for a point inside the program's time.
    const args = Object.fromEntries(Object.entries(entry.params).map(([k, v]) => [k, /^-?[\d.]+$/.test(v) ? Number(v) : v.startsWith("@") ? Math.round((c.T0 + c.T1) / 2) : v]));
    const input: ProgramInput = { ...c, fps: 30, frames: 600, args, on: {}, words: [], colors: COLORS };
    const [a, b] = await Promise.all([runProgram(entry.source, input), runProgram(entry.source, input)]);
    const size = `at ${c.W} by ${c.H}`;
    if (!a.ok) {
      problems.push(`${size} it failed: ${a.error}`);
      continue;
    }
    if (!b.ok || JSON.stringify(a.output) !== JSON.stringify(b.output)) problems.push(`${size} it gave different results for the same seed`);
    const { errors } = checkOutput(a.output, { mount: "m", on: [], offset: { x: 0, y: 0 }, frames: 600, colors: new Set(COLORS) });
    problems.push(...errors.map((e) => `${size}: ${e}`));
    if (!a.output.nodes.length) problems.push(`${size} it drew nothing`);
    if (outside(a.output.nodes, c.W, c.H) > 0.02) problems.push(`${size} it draws outside its box, so it ignores W and H`);
  }
  return problems;
}

// Finds programs in a written scene that could be kept. A person or reviewer still decides which are general enough.
export async function harvest(source: string, parsePrograms: (s: string) => { name: string; doc?: string; params: Record<string, string>; source: string }[]) {
  const out: { entry: LibraryEntry; problems: string[] }[] = [];
  for (const p of parsePrograms(source)) {
    const entry: LibraryEntry = { name: p.name.toLowerCase(), doc: p.doc ?? "", params: p.params, source: p.source };
    out.push({ entry, problems: await testProgram(entry) });
  }
  return out;
}

// Saves a program after it passes. Throws with every reason when it does not, so nothing untested gets in.
export async function saveProgram(entry: LibraryEntry, dir = DIR): Promise<string> {
  const problems = await testProgram(entry);
  if (problems.length) throw new Error(`${entry.name} was not saved:\n${problems.join("\n")}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${entry.name}.json`);
  writeFileSync(file, `${JSON.stringify({ ...entry, tested: "3 sizes, 3 seeds, repeatable, stays in its box" }, null, 2)}\n`);
  return file;
}
