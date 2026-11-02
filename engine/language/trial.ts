// Real test: Spark writes a scene for each request, errors go back to it, and every round is recorded.
// Usage: node --env-file=.env --experimental-strip-types engine/language/trial.ts <outDir> <capUsd> [<name> ...]
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { themeFrom } from "../render/theme.ts";
import type { CompileContext } from "../core/types.ts";
import { author, type AuthorRequest } from "./author.ts";
import { loadLibrary } from "./library.ts";

const PROJECTS = process.env.PROJECTS_DIR ?? "projects";

// Word times from a finished project, so the timing is a real voice.
function fromProject(id: string, topic: string): AuthorRequest {
  const p = JSON.parse(readFileSync(join(PROJECTS, id, "project.json"), "utf8"));
  return { topic, words: p.narration.words.map((w: { text: string; start: number }) => ({ text: w.text, start: w.start })) };
}
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
  math: () => fromProject("teach-me-how-to-do-cramers-rule-i-know-t-76cad8", "Teach me how to do Cramer's rule"),
  algorithm: () => invented("How Dijkstra's algorithm finds the shortest path", `You want the shortest route from A to F on this map. Every road has a cost. Dijkstra's idea is simple: always stand on the closest place you have not finished yet. Start at A, with cost zero. From A, you can reach B for four and C for two. C is closest, so go to C. Now look around from C. Going through C reaches B for three, which beats four, so B gets cheaper. It reaches E for ten and F for twelve. The closest unfinished place is now B, at three. From B, D costs eight. Then D reaches E for ten, no better. E reaches F for thirteen, no better than twelve. So the answer is twelve: A to C to F. Every place was settled once, in order of distance, and nothing could ever beat it later.`),
  code: () => invented("What a Python function that sums a list really does, line by line", `Here is a tiny Python function. It adds up a list. Watch what the computer actually does. We call it with the list three, five, two. First, total is set to zero. Now the loop picks the first item, so n is three. Total plus n is three, so total becomes three. Back to the top of the loop. Now n is five. Three plus five is eight, so total becomes eight. Back again. n is two, total becomes ten. The list has run out, so the loop ends. The function returns ten. Three names changed on the way, but the machine only ever did one small thing at a time.`),
  history: () => fromProject("how-was-linear-b-deciphered-keep-it-unde-a8f373", "How was Linear B deciphered?"),
  // These two have no ready-made form, so they are where programs must carry the scene.
  chance: () => invented("How throwing random darts can measure pi", `Draw a square, and inside it a circle that just touches the sides. Now throw darts completely at random. Some land in the circle, some only in the square. The fraction landing inside depends only on the two areas. Circle over square is pi over four. So count them. After ten darts the guess is rough. After a hundred it wobbles around three point one. After a thousand it settles close to pi. Nobody measured a circle. Random dots did the geometry.`),
  waves: () => invented("Why two sound waves can cancel each other out", `Sound is a wave of pressure, rising and falling as it travels. Send a second wave along the same path, and the two simply add up, point by point. When their peaks line up, the result is twice as tall. That is why two speakers can sound louder. Now slide one wave along by half a wavelength. Every peak meets a trough. They add up to nothing, and the line goes flat. Both waves are still there, carrying energy, but where they cancel you hear silence.`),
  science: () => fromProject("why-do-we-have-seasons-under-a-minute-4ab3fd", "Why do we have seasons?"),
};

const [out = "projects/engine-language", cap = "2", ...names] = process.argv.slice(2);
const limit = Number(cap);
const style = process.env.STYLE ?? "whiteboard";
const theme = themeFrom(style);
const library = loadLibrary();
const ledger = (name: string, usd: number, detail: string) => appendFileSync(join(PROJECTS, "spend.jsonl"), `${JSON.stringify({ project: `engine-language-${name}`, stage: "language", usd: +usd.toFixed(5), detail, at: new Date().toISOString() })}\n`);

let total = 0;
const summary: Record<string, unknown>[] = [];
for (const name of names.length ? names : Object.keys(REQUESTS)) {
  if (total >= limit) {
    console.log(`stopping: $${total.toFixed(2)} of the $${limit} cap is spent`);
    break;
  }
  const request = REQUESTS[name]!();
  const frames = Math.ceil((request.words.at(-1)!.start + 1.5) * 30);
  const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames, theme, words: request.words };
  console.log(`\n${name}: ${request.words.length} words, ${(frames / 30).toFixed(0)} s`);
  const r = await author(request, { ctx, library, seed: 11, rounds: Number(process.env.ROUNDS ?? 4), log: console.log });
  ledger(name, r.usd, r.ok ? `built in ${r.rounds.length} rounds` : `failed after ${r.rounds.length} rounds`);
  total += r.usd;
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "scene.txt"), r.source);
  writeFileSync(join(dir, "rounds.json"), JSON.stringify(r.rounds, null, 1));
  if (r.result.scene) writeFileSync(join(dir, "scene.json"), JSON.stringify(r.result.scene));
  writeFileSync(join(dir, "request.json"), JSON.stringify({ ...request, frames }));
  summary.push({ name, ok: r.ok, rounds: r.rounds.length, firstRoundProblems: r.rounds[0]?.problems.length, usd: +r.usd.toFixed(3), states: r.result.stats.states, programs: r.result.stats.programs, parts: r.result.stats.parts, chars: r.source.length });
}
console.log(`\n${JSON.stringify(summary, null, 1)}\ntotal $${total.toFixed(3)}`);
