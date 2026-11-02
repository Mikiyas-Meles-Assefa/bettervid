// Command line for the understanding loop.
//   review <projectDir> [files...] [--repeat n] [--cap dollars]   review renders of one project; versions share ideas and quiz
//   bench <version> --map map.json [--only id,id] [--cap dollars]  run the benchmark on finished projects (map: request id to project dir)
//   board [versionA versionB]                                      print the scoreboard, and a comparison if two versions are named
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { BENCHMARK } from "./benchmark.ts";
import { scopeOf, writeQuiz } from "./learner.ts";
import { metaAsk, type Ask } from "./model.ts";
import { cutFromProject, review } from "./review.ts";
import { compare, listVersions, loadResults, runBenchmark, summarize, table } from "./scoreboard.ts";
import { needsOf } from "./sequence.ts";
import { ideasOf } from "./silent.ts";
import type { Cut, Idea, LearnerResult, Needs, Quiz, Scope } from "./types.ts";

const ROOT = process.env.PROJECTS_DIR ?? "projects";
const OUT = join(ROOT, "review");
const SCORES = "engine/review/scores";
const hashless = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);

// The quiz belongs to the request and the ideas to the script, not to any one version, so both are stored once.
async function kept<T>(name: string, make: () => Promise<T>): Promise<T> {
  mkdirSync(join(OUT, "fixed"), { recursive: true });
  const f = join(OUT, "fixed", `${name}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  const v = await make();
  writeFileSync(f, JSON.stringify(v, null, 1));
  return v;
}

const quizFor = (request: string, ask: Ask) => kept<Quiz>(`quiz-${hashless(request)}`, () => writeQuiz(request, ask));
const narration = (cut: Cut) => `${hashless(cut.topic)}-${cut.words.length}`;

// Everything held fixed for a narration, so versions of a video are measured against the same yardstick.
async function yardstick(cut: Cut, request: string, ask: Ask) {
  const quiz = await quizFor(request, ask);
  const [ideas, needs, scope] = await Promise.all([
    kept<Idea[]>(`ideas-${narration(cut)}`, () => ideasOf(cut, ask)),
    kept<Needs>(`needs-${narration(cut)}`, () => needsOf(cut, ask)),
    kept<Scope>(`scope-${narration(cut)}`, () => scopeOf(quiz, cut, ask)),
  ]);
  return { quiz, ideas, needs, scope };
}

const flag = (args: string[], name: string, or: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : or;
};

async function reviewProject(args: string[]) {
  const named = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  const [dir, ...files] = named;
  const repeat = Number(flag(args, "repeat", "1"));
  const { ask, meter } = metaAsk({ project: "engine-review", cap: Number(flag(args, "cap", "1")) });
  const list = files.length ? files : ["video.mp4"];
  const first = cutFromProject(dir, list[0]);
  const fixed = await yardstick(first, first.request, ask);
  for (let run = 1; run <= repeat; run++) {
    // The narration is the same across renders, so one pass of the picture-free arms serves them all.
    let shared: Partial<Record<"audio" | "nothing", { notes: string; result: NonNullable<LearnerResult["arms"]["audio"]> }>> | undefined;
    for (const file of list) {
      const cut = cutFromProject(dir, file);
      const report = await review(cut, { ask, ...fixed, shared, meter });
      const a = report.learner!;
      shared ??= { audio: { notes: a.notes.audio!, result: a.arms.audio! }, nothing: { notes: "", result: a.arms.nothing! } };
      const out = join(OUT, basename(dir));
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `${basename(file, ".mp4")}-run${run}.json`), JSON.stringify(report, null, 1));
      const s = report.scores;
      console.log(`${file} run ${run}: overall ${s.overall.toFixed(2)} soundOff ${s.soundOff.toFixed(2)} learned ${s.learned.toFixed(2)} audio ${s.audioAlone?.toFixed(2)} silentQuiz ${s.silentQuiz?.toFixed(2)} nothing ${s.nothing?.toFixed(2)} fit ${s.fit.toFixed(2)} held ${s.held.toFixed(2)} truth ${s.truthErrors} severe ${s.worst} tickets ${s.tickets} $${report.usd.toFixed(3)} (total $${meter.usd.toFixed(3)})`);
    }
  }
}

async function bench(args: string[]) {
  const version = args[0];
  const map: Record<string, string> = JSON.parse(readFileSync(flag(args, "map", "bench-map.json"), "utf8"));
  const only = flag(args, "only", "").split(",").filter(Boolean);
  const cap = Number(flag(args, "cap", "5"));
  const { ask, meter } = metaAsk({ project: `bench-${version}`, cap });
  const results = await runBenchmark({
    version,
    dir: SCORES,
    requests: only.length ? BENCHMARK.filter((r) => only.includes(r.id)) : BENCHMARK,
    make: async (r) => (map[r.id] ? cutFromProject(map[r.id]) : null),
    review: async (cut, r) => review(cut, { ask, ...(await yardstick(cut, r.prompt, ask)), meter }),
    stopped: () => (meter.usd >= cap ? `cap of $${cap} reached` : null),
  });
  console.log(table([summarize(results)]));
}

function board(args: string[]) {
  const versions = listVersions(SCORES);
  console.log(table(versions.map((v) => summarize(loadResults(SCORES, v)))));
  if (args.length === 2) console.log(JSON.stringify(compare(loadResults(SCORES, args[0]), loadResults(SCORES, args[1])), null, 2));
}

const [command, ...rest] = process.argv.slice(2);
if (command === "review") await reviewProject(rest);
else if (command === "bench") await bench(rest);
else if (command === "board") board(rest);
else console.log("usage: run.ts review|bench|board");
