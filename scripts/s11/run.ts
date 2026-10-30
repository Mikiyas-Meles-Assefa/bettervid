// Spike S11: can Spark write a simulation that runs, syncs to cues and fits a style? Usage: node ... scripts/s11/run.ts <outDir> [traffic|waves] [spentSoFar]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { text } from "../../pipeline/lib/meta.ts";
import { loadSim, SAFE, seeded } from "./kit.ts";

const out = process.argv[2]!;
mkdirSync(out, { recursive: true });
const BRIEFS = {
  traffic: {
    cues: { brake: 3, gaps: 6.5 },
    brief: `Show how a phantom traffic jam forms. Cars drive around a ring road, each following one rule: match the car ahead and keep a safe gap, with a slight reaction delay. At cue "brake", one car taps its brakes for a moment; the slowdown spreads backward through the traffic as a jam that moves against the flow, with no accident anywhere. At cue "gaps", every driver starts keeping a much bigger gap, and the jam dissolves. Length: 10 seconds. Show slow or stopped cars in "accent".`,
  },
  waves: {
    cues: { flip: 3, add: 6.5 },
    brief: `Show two sound waves on screen: the original noise and an upside-down copy of it. Each wave is drawn from its formula and moves. At cue "flip" the second wave appears, inverted. At cue "add" the two slide together and combine, and the sum, computed from the formula, shrinks to a flat line. Length: 10 seconds. Show the sum in "accent".`,
  },
};
const { cues, brief } = BRIEFS[(process.argv[3] ?? "traffic") as keyof typeof BRIEFS];
// Stop before a call that would likely take the run over the spike's budget. A repair has cost up to about $0.05.
const CAP = 0.15;
const room = (usd: number, last: number) => usd + Math.max(last, 0.05) <= CAP;

const FORBIDDEN = /Math\.random|Date\b|setTimeout|setInterval|fetch\s*\(|\bimport\b|\beval\b|document\.|window\.|globalThis/;
function check(code: string): string | null {
  const bad = FORBIDDEN.exec(code);
  if (bad) return `Forbidden: ${bad[0]}`;
  const rng = seeded(7);
  let drawn = 0;
  let outside = 0;
  const note = (x: number, y: number) => {
    drawn++;
    if (x < SAFE.x - 2 || x > SAFE.x + SAFE.w + 2 || y < SAFE.y - 2 || y > SAFE.y + SAFE.h + 2) outside++;
  };
  const kit = {
    safe: SAFE,
    background() {},
    dot: (x: number, y: number) => note(x, y),
    ring: (x: number, y: number) => note(x, y),
    line: (a: number, b: number, c: number, d: number) => (note(a, b), note(c, d)),
    path: (p: number[][]) => p.forEach(([x, y]) => note(x!, y!)),
    label: (_: string, x: number, y: number) => note(x, y),
  };
  try {
    const sim = loadSim(code);
    const state = sim.setup({ width: 1080, height: 1920, rng, kit });
    const t0 = performance.now();
    for (let f = 0; f < 300; f++) {
      sim.step(state, { t: f / 30, dt: 1 / 30, rng, cues });
      sim.draw(state, kit, { t: f / 30, cues });
    }
    const ms = (performance.now() - t0) / 300;
    if (!drawn) return "It never drew anything.";
    if (outside / drawn > 0.02) return `${Math.round((outside / drawn) * 100)}% of the drawing is outside kit.safe.`;
    if (ms > 10) return `Too slow: ${ms.toFixed(1)} ms per frame.`;
    console.log(`  ran 300 frames at ${ms.toFixed(2)} ms each, ${drawn} marks, ${outside} outside`);
    return null;
  } catch (e: any) {
    return `It crashed: ${e.message}`;
  }
}

const system = readFileSync("prompts/simulation.md", "utf8");
const user = `What to show: ${brief}\n\nCues: ${JSON.stringify(cues)}`;
let code = "";
let usd = Number(process.argv[4] ?? 0); // already spent on this spike by earlier runs, counted against the cap
let last = 0;
let problem: string | null = "first try";
for (let i = 1; i <= 5 && problem && room(usd, last); i++) {
  const r = await text({ system, user: i === 1 ? user : `${user}\n\nYour last version:\n${code}\n\nProblem: ${problem}\nFix it and reply with the full module.`, effort: "medium" });
  usd += r.usd;
  last = r.usd;
  code = r.value.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "").trim();
  problem = check(code);
  console.log(`try ${i}: ${problem ?? "passed"} ($${r.usd.toFixed(3)})`);
}
if (problem) process.exit(1);

// Measured repair: run the simulation with no drawing, read its numbers once per second, and let Spark compare them
// with what the brief needs at each cue. Works for any simulation, because each one chooses what to measure.
function table(code: string): string {
  const rng = seeded(7);
  const noop = () => {};
  const kit = { safe: SAFE, background: noop, dot: noop, ring: noop, line: noop, path: noop, label: noop };
  const sim = loadSim(code) as any;
  const state = sim.setup({ width: 1080, height: 1920, rng, kit });
  const rows: string[] = [];
  for (let f = 0; f < 300; f++) {
    if (f % 30 === 0) rows.push(`t=${f / 30}s ${JSON.stringify(sim.measure(state))}`);
    sim.step(state, { t: f / 30, dt: 1 / 30, rng, cues });
  }
  return rows.join("\n");
}

for (let round = 1; round <= 3; round++) {
  if (!room(usd, last)) {
    console.log(`round ${round}: skipped, it would go over $${CAP}`);
    break;
  }
  const rows = table(code);
  console.log(`round ${round} measurements:\n${rows}`);
  const r = await text({
    system,
    user: `${user}\n\nThese are the numbers your module below produced:\n${rows}\n\nGo through the cues in order and compare what the numbers show with what the viewer should see before and after each one. If it all matches, reply with exactly OK. If not, reply with the full fixed module only.\n\n${code}`,
    effort: "high",
  });
  usd += r.usd;
  last = r.usd;
  if (/^OK\b/.test(r.value.trim())) {
    console.log(`round ${round}: Spark says it matches ($${r.usd.toFixed(3)})`);
    break;
  }
  const next = r.value.replace(/^\`\`\`[a-z]*\n?/i, "").replace(/\`\`\`\s*$/, "").trim();
  const bad = check(next);
  console.log(`round ${round}: rewrote it, ${bad ?? "passed checks"} ($${r.usd.toFixed(3)})`);
  if (!bad) code = next;
}
console.log(`final measurements:\n${table(code)}`);
writeFileSync(join(out, "sim.js"), code);
console.log(`spent $${usd.toFixed(3)}`);

const serveUrl = await bundle({ entryPoint: resolve("scripts/s11/Sim.tsx") });
for (const name of ["collage", "whiteboard"]) {
  const inputProps = { code, cues, style: JSON.parse(readFileSync(`styles/${name}.json`, "utf8")) };
  const composition = await selectComposition({ serveUrl, id: "Sim", inputProps });
  await renderMedia({ serveUrl, composition, inputProps, codec: "h264", imageFormat: "jpeg", concurrency: 2, outputLocation: join(out, `${name}.mp4`) });
  console.log(`rendered ${name}`);
}
