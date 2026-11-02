// Real test of the truth kits: Spark writes one scene per request, with only the language guide (which now lists the
// kits' docs) to learn from. Errors go back to it as in the pipeline. Nothing in the requests names a kit.
// Usage: node --env-file=.env --experimental-strip-types engine/truth/trial.ts <outDir> <capUsd> [<name> ...]
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CompileContext } from "../core/types.ts";
import { KITS } from "../kits/index.ts";
import { author, type AuthorRequest } from "../language/author.ts";
import { loadLibrary } from "../language/library.ts";
import { themeFrom } from "../render/theme.ts";

// Invented word times: about 2.5 words a second, with a pause after each sentence.
function invented(topic: string, script: string): AuthorRequest {
  let t = 0.2;
  const words = script.trim().split(/\s+/).map((text) => {
    const w = { text, start: Math.round(t * 100) / 100 };
    t += 0.28 + text.length * 0.018 + (/[.?!]$/.test(text) ? 0.45 : /[,:;]$/.test(text) ? 0.18 : 0);
    return w;
  });
  return { topic, words };
}

const REQUESTS: Record<string, () => AuthorRequest> = {
  rowops: () => invented("Solving a system of equations by row reduction", `Here are three equations packed into one grid of numbers. Each row is one equation, and the last column holds the answers. Row reduction uses three honest moves: swap two rows, scale a row, or add a multiple of one row to another. None of them changes the solutions. We clear the first column below the top, then the second, then work back up. Step by step the left side turns into the identity. Now just read the last column: x is two, y is three, z is minus one.`),
  determinant: () => invented("How to compute a 3 by 3 determinant with the rule of Sarrus", `To find this determinant, copy the first two columns to the right. Now multiply down each of the three diagonals going right. Those three products are added. Then multiply up the three diagonals going the other way. Those three products are subtracted. Add the first group, take away the second, and you have the determinant: forty nine.`),
  cramer: () => invented("Cramer's rule for two equations", `Two equations, two unknowns. First take the determinant of the coefficients: two times three minus one times one is five. To find x, replace the first column with the right-hand side and take that determinant. It is four. So x is four over five. For y, replace the second column instead. That determinant is seven, so y is seven over five.`),
  matvec: () => invented("What a matrix times a vector means", `A matrix times a vector is just a few dot products. Take the first row and the vector, multiply matching numbers and add them up. That gives the first number of the answer. Do the same with the second row, and you get the second number. Every row turns the same vector into one new number.`),
  sorting: () => invented("How bubble sort works", `Bubble sort is the simplest way to put numbers in order. Walk along the list and compare each neighbor pair. If they are out of order, swap them. After one pass the biggest number has bubbled to the end. Do it again, and again, each pass a little shorter. When a pass makes no swaps, the list is sorted.`),
  code: () => invented("What a JavaScript function that sums a list really does, line by line", `Here is a tiny function that adds up a list. We call it with three, five and two. First, total is set to zero. The loop picks the first item, so n is three, and total becomes three. Next n is five, and total becomes eight. Then n is two, and total becomes ten. The list runs out, the function returns ten, and ten is printed.`),
  shortest: () => invented("How Dijkstra's algorithm finds the shortest path", `You want the cheapest route from A to F, and every road has a cost. Dijkstra's rule: always settle the closest place you have not settled yet. Start at A with cost zero. Check every road out of it and write down the best cost so far for each neighbor. Then settle the next closest place, and check its roads too. A better route replaces the old number; a worse one changes nothing. When F is settled, its number is the answer, and the roads that led there are the path.`),
};

const [out = "projects/truth-trial", cap = "2", ...names] = process.argv.slice(2);
const limit = Number(cap);
const style = process.env.STYLE ?? "whiteboard";
const theme = themeFrom(style);
const ledgerFile = process.env.LEDGER ?? join("projects", "spend.jsonl");
const ledger = (name: string, usd: number, detail: string) => appendFileSync(ledgerFile, `${JSON.stringify({ project: `truth-trial-${name}`, stage: "language", usd: +usd.toFixed(5), detail, at: new Date().toISOString() })}\n`);

let total = 0;
const summary: Record<string, unknown>[] = [];
for (const name of names.length ? names : Object.keys(REQUESTS)) {
  if (total >= limit) {
    console.log(`stopping: $${total.toFixed(2)} of the $${limit} cap is spent`);
    break;
  }
  const request = REQUESTS[name]!();
  const frames = Math.ceil((request.words.at(-1)!.start + 1.5) * 30);
  const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames, theme, words: request.words, kits: KITS };
  console.log(`\n${name}: ${request.words.length} words, ${(frames / 30).toFixed(0)} s`);
  const r = await author(request, { ctx, library: loadLibrary(), seed: 11, rounds: Number(process.env.ROUNDS ?? 3), log: console.log });
  ledger(name, r.usd, r.ok ? `built in ${r.rounds.length} rounds` : `failed after ${r.rounds.length} rounds`);
  total += r.usd;
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "scene.txt"), r.source);
  writeFileSync(join(dir, "rounds.json"), JSON.stringify(r.rounds, null, 1));
  writeFileSync(join(dir, "request.json"), JSON.stringify({ ...request, frames }));
  const kinds = [...new Set([...r.source.matchAll(/^\s*(matrix|det|cramer|matvec|sort|trace|dijkstra)\s/gm)].map((m) => m[1]))];
  summary.push({ name, ok: r.ok, rounds: r.rounds.length, firstRoundProblems: r.rounds[0]?.problems.length, kinds, usesSteps: /do steps /.test(r.source), usd: +r.usd.toFixed(3) });
}
console.log(`\n${JSON.stringify(summary, null, 1)}\ntotal $${total.toFixed(3)}`);
