// Spark writes a scene for each brief. Crashes and failed checks go back to Spark, at most 3 tries in all.
// node --env-file=.env --experimental-strip-types scripts/manim/generate.ts <outDir> [briefId...]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { text } from "../../pipeline/lib/meta.ts";
import { briefs, type Brief } from "./briefs.ts";
import { askFor, CAP, charge, code, HERE, lint, problems, render, spent, writeWords } from "./lib.ts";

process.env.BV_OUT = resolve(process.argv[2]!);
const OUT = process.env.BV_OUT;
const only = process.argv.slice(3);
const SYSTEM = readFileSync(join(HERE, "prompt.md"), "utf8");
const TRIES = 3;

async function run(b: Brief) {
  const dir = join(OUT, b.id);
  mkdirSync(dir, { recursive: true });
  const wordsFile = join(dir, "words.json");
  writeWords(wordsFile, b.words, b.duration);
  const ask = askFor(b);
  const tries: any[] = [];
  let feedback = "";
  let prev = "";
  for (let n = 1; n <= TRIES; n++) {
    if (spent() > CAP * 0.9) throw new Error("budget stop");
    const user = feedback ? `${ask}\n\nYour previous file:\n\`\`\`python\n${prev}\`\`\`\n\nIt needs repair:\n${feedback}\n\nReply with the whole corrected file.` : ask;
    const t0 = Date.now();
    const r = await text({ system: SYSTEM, user, effort: "low", maxOutput: 16000 });
    charge(r.usd, `${b.id} try ${n}`);
    const src = code(r.value);
    const file = join(dir, `scene${n}.py`);
    writeFileSync(file, src);
    const entry: any = { n, usd: r.usd, tokens: r.raw.usage, llmSeconds: (Date.now() - t0) / 1000 };
    tries.push(entry);
    prev = src;
    const bad = lint(src);
    if (bad.length) {
      entry.outcome = "lint";
      entry.detail = bad;
      feedback = bad.join("\n");
      continue;
    }
    const g = render(file, wordsFile, "flat", join(dir, `try${n}`));
    entry.renderSeconds = g.seconds;
    if (!g.ok) {
      entry.outcome = "crash";
      entry.detail = g.error.slice(-400);
      feedback = `It crashed:\n${g.error}`;
      continue;
    }
    const p = problems(g.report);
    entry.video = g.video;
    entry.report = { late: g.report.cues.filter((c: any) => c.late > 0.3).length, cues: g.report.cues.length, layout: g.report.layout.length, over: g.report.over };
    if (!p.length) {
      entry.outcome = "clean";
      break;
    }
    entry.outcome = "rendered_with_problems";
    entry.detail = p;
    feedback = p.join("\n");
  }
  const result = { id: b.id, real: b.real, duration: b.duration, words: b.words.length, usd: tries.reduce((a, t) => a + t.usd, 0), tries };
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 1));
  console.log(b.id, tries.map((t) => `${t.outcome}($${t.usd.toFixed(3)},${Math.round(t.llmSeconds)}s llm,${Math.round(t.renderSeconds ?? 0)}s render)`).join(" > "));
  return result;
}

const list = briefs().filter((b) => !only.length || only.includes(b.id));
const res = await Promise.all(list.map((b) => run(b).catch((e) => ({ id: b.id, failed: String(e) }))));
writeFileSync(join(OUT, `results-${Date.now()}.json`), JSON.stringify(res, null, 1));
console.log("spent so far", spent().toFixed(4));
