// Spark looks at frames of each accepted clip and repairs what the automatic checks cannot see. Passing a check is not the same
// as making sense on screen. At most 2 rounds per brief.
// node --env-file=.env --experimental-strip-types scripts/manim/review.ts <runDir> [briefId...]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { json, text } from "../../pipeline/lib/meta.ts";
import { briefs, type Brief } from "./briefs.ts";
import { askFor, CAP, charge, code, HERE, lint, problems, render, spent } from "./lib.ts";

process.env.BV_OUT = resolve(process.argv[2]!);
const OUT = process.env.BV_OUT;
const only = process.argv.slice(3);
const SYSTEM = readFileSync(join(HERE, "prompt.md"), "utf8");
const ROUNDS = 2;
const FRAMES = 12;

const REVIEW = `You check a short animated visual for a narrated video. You get the narration and a sheet of ${FRAMES} frames taken at even intervals, read left to right, top to bottom. List only faults a viewer would notice: something that should be visible but is missing or blank, things covering or crossing each other, parts cut off by the frame, a visual that contradicts the narration or shows a wrong fact, a large empty area while the rest is cramped. Say where in the sequence each fault is and what it is. Do not suggest a different concept and do not list matters of taste. An empty list means the clip is sound.`;

async function look(b: Brief, video: string, dir: string, n: number) {
  const sheet = join(dir, `review${n}.jpg`);
  execFileSync("zsh", [join(HERE, "sheet.sh"), video, sheet, String(FRAMES), "6"]);
  const r = await json<{ faults: string[] }>({
    system: REVIEW,
    user: [
      { type: "input_text", text: askFor(b) },
      { type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(sheet).toString("base64")}` },
    ] as any,
    schemaName: "review",
    schema: { type: "object", additionalProperties: false, required: ["faults"], properties: { faults: { type: "array", items: { type: "string" } } } },
    effort: "low",
    maxOutput: 3000,
  } as any);
  charge(r.usd, `${b.id} review ${n}`);
  return { faults: r.value.faults, usd: r.usd };
}

async function run(b: Brief) {
  const dir = join(OUT, b.id);
  const wordsFile = join(dir, "words.json");
  const old = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
  let n = old.tries.at(-1).n as number;
  let prev = readFileSync(join(dir, `scene${n}.py`), "utf8");
  let g = render(join(dir, `scene${n}.py`), wordsFile, "flat", join(dir, "base"));
  if (!g.ok) throw new Error(`base render: ${g.error}`);
  const rounds: any[] = [];
  let best = n;
  for (let round = 1; round <= ROUNDS + 1; round++) {
    if (spent() > CAP * 0.9) throw new Error("budget stop");
    const seen = await look(b, g.video, dir, round);
    const entry: any = { round, scene: n, faults: seen.faults, usd: seen.usd };
    rounds.push(entry);
    if (!seen.faults.length || round > ROUNDS) break;
    const user = `${askFor(b)}\n\nYour previous file:\n\`\`\`python\n${prev}\`\`\`\n\nA reviewer watched it and found:\n${seen.faults.map((f) => `- ${f}`).join("\n")}\n\nFix these. Keep what works. Reply with the whole corrected file.`;
    const r = await text({ system: SYSTEM, user, effort: "low", maxOutput: 16000 });
    charge(r.usd, `${b.id} repair ${round}`);
    entry.usd += r.usd;
    const src = code(r.value);
    const file = join(dir, `fix${round}.py`);
    writeFileSync(file, src);
    const bad = lint(src);
    const next = bad.length ? null : render(file, wordsFile, "flat", join(dir, `fixrender${round}`));
    if (!next?.ok) {
      entry.repair = bad.length ? { lint: bad } : { crash: next!.error.slice(-300) };
      break;
    }
    entry.repair = { checks: problems(next.report) };
    g = next;
    prev = src;
    n = 100 + round;
    best = n;
  }
  const result = { id: b.id, final: best > 100 ? `fix${best - 100}.py` : `scene${best}.py`, rounds, usd: rounds.reduce((a, r) => a + r.usd, 0) };
  writeFileSync(join(dir, "review.json"), JSON.stringify(result, null, 1));
  console.log(b.id, result.final, `$${result.usd.toFixed(3)}`, rounds.map((r) => r.faults.length).join(" > "));
  return result;
}

const list = briefs().filter((b) => !only.length || only.includes(b.id));
const res = await Promise.all(list.map((b) => run(b).catch((e) => ({ id: b.id, failed: String(e) }))));
writeFileSync(join(OUT, "review.json"), JSON.stringify(res, null, 1));
console.log("spent so far", spent().toFixed(4));
