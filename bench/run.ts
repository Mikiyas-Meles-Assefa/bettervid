// The teaching bench. Usage (from the repo root):
//   node --experimental-strip-types bench/run.ts prepare <run> [case ...]   prompts for the authors
//   node --experimental-strip-types bench/run.ts submit <run> <case>        check an author's answer, write the next prompt
//   node --experimental-strip-types bench/run.ts status <run>               where every author stands
//   node --experimental-strip-types bench/run.ts map <run> [case ...]       id-map requests (plan words to scene ids)
//   node --experimental-strip-types bench/run.ts measure <run>              free measures, score sheet
//   node --experimental-strip-types bench/run.ts render <run> [case ...]    small MP4, watch sheets, transcript, quiz
//   node --experimental-strip-types bench/run.ts tasks <run> [case ...]     rewrite the watch tasks of rendered clips
//   node --experimental-strip-types bench/run.ts grade <run>                grading requests for the watch tests
//   node --experimental-strip-types bench/run.ts report <run>               the summary in bench/results/<run>/
// `--voice` on prepare records the real narration with ElevenLabs instead of timing it from the text (it costs credits).
// See bench/README.md for the whole protocol.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { caseProject, listCases, loadCase } from "./lib/case.ts";
import { loadState, prepare, submit } from "./lib/author.ts";
import { WORK, folderOf } from "./lib/paths.ts";

const [cmd, run, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((x) => x.startsWith("--")));
const named = rest.filter((x) => !x.startsWith("--"));
if (!cmd || !run) throw new Error("usage: bench/run.ts <prepare|submit|status|map|measure|render|grade|report> <run> [case ...]");
const cases = () => (named.length ? named : listCases());

if (cmd === "prepare") {
  for (const id of cases()) {
    const p = caseProject(loadCase(id));
    const folder = folderOf(run, id);
    if (flags.has("--voice")) {
      // A real voice: the voice stage reads the script and the direction's holds and writes narration.mp3 here.
      process.env.PROJECTS_DIR = join(WORK, run);
      const { voice } = await import("../pipeline/stages/voice.ts");
      await voice(p);
    }
    prepare(p, folder);
    console.log(`${id}: ${p.narration!.words.length} words, ${p.narration!.seconds.toFixed(1)} s, ${p.direction!.events.length} events, ${(p.narration!.holds ?? []).length} holds -> ${folder}`);
  }
} else if (cmd === "submit") {
  const id = named[0]!;
  const folder = folderOf(run, id);
  const p = JSON.parse(readFileSync(join(folder, "project.json"), "utf8"));
  const r = await submit(p, folder);
  console.log(r.next === "done" ? `DONE: ${r.message}` : `NEXT: ${r.message}. Read ${join(folder, "next.md")} and write your whole answer to ${join(folder, "answer.txt")}, then submit again.`);
} else if (cmd === "status") {
  for (const id of cases()) {
    const f = join(folderOf(run, id), "author.json");
    if (!existsSync(f)) {
      console.log(`${id}: not prepared`);
      continue;
    }
    const s = loadState(folderOf(run, id));
    console.log(`${id}: ${s.stage}, round ${s.round}${s.stage === "done" ? `, ${s.ok ? "builds" : "FAILS"}, review ${s.reviewed ?? "-"}, ${s.warnings?.length ?? 0} warnings` : ""}`);
  }
} else {
  const mod = await import("./lib/steps.ts");
  const fn = (mod as Record<string, (run: string, ids: string[], flags: Set<string>) => Promise<void>>)[cmd];
  if (!fn) throw new Error(`unknown command ${cmd}`);
  mkdirSync(join(WORK, run), { recursive: true });
  await fn(run, cases(), flags);
}
