// The author step of the bench. The scene stage gives Spark a system prompt (the language guide) and a request per
// part, builds what comes back, sends build problems back for repair, then sends what code can see about a built part
// back once (review). Here the same prompts are written to files, any author (a Claude Haiku agent standing in for
// Spark) answers them in a file, and `submit` runs the very checks the stage runs and writes the next prompt. The flow
// mirrors `compose()` in pipeline/stages/scene.ts; the look step (Spark judging stills) is not part of the bench.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../../schemas/project.ts";
import { languagePrompt } from "../../engine/language/author.ts";
import { picturesOf } from "./case.ts";
import { BUILD_ROUNDS, check, describe, plainMoments, repairRequest, requestFor, review, reviewRequest, sceneBuildOptions, sceneHeader, type Checked, type Job } from "../../pipeline/stages/scene.ts";

export type AuthorState = {
  round: number;
  stage: "build" | "review" | "review-repair" | "done";
  built?: { source: string; warnings: number }; // the version that builds, before the review
  ok?: boolean;
  problems?: string[];
  warnings?: string[];
  notes?: string[];
  reviewed?: "kept" | "not kept" | "nothing to say";
};

const read = (f: string) => readFileSync(f, "utf8");
const statePath = (folder: string) => join(folder, "author.json");
export const loadState = (folder: string): AuthorState => JSON.parse(read(statePath(folder)));
const saveState = (folder: string, s: AuthorState) => writeFileSync(statePath(folder), JSON.stringify(s, null, 1));

// The job the scene stage would make for the one part a bench case is.
export function jobFor(p: Project, folder: string): Job {
  const ranges = [{ id: "s1", firstWord: 0, lastWord: p.narration!.words.length - 1 }];
  const pics = picturesOf(p);
  const opts = sceneBuildOptions(p, Object.fromEntries(pics.map((x) => [x.name, x.src])));
  // A one-part video has no first pass to plan hand-offs; what the part mainly shows is the moment's arc.
  const cast = [{ shows: p.direction?.arc ?? "", handoff: [] }];
  return { p, range: ranges[0]!, carry: [], handoff: [], system: languagePrompt(opts), request: requestFor(p, ranges, 0, cast, sceneHeader(p), describe(pics)), opts, folder, log: () => {} };
}

// Writes the system prompt and the first request, and resets the author's state.
export function prepare(p: Project, folder: string) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "project.json"), JSON.stringify(p, null, 1));
  const job = jobFor(p, folder);
  writeFileSync(join(folder, "system.md"), job.system);
  writeFileSync(join(folder, "request.md"), job.request);
  writeFileSync(join(folder, "next.md"), job.request);
  saveState(folder, { round: 0, stage: "build" });
}

const strip = (s: string) => s.replace(/^\s*```[\w-]*\s*\n/, "").replace(/\n```\s*$/, "").trim() + "\n";

// Takes the author's answer (answer.txt), checks it as the stage does, and says what happens next: a prompt in
// next.md, or done, with the final part in scene.txt.
export async function submit(p: Project, folder: string): Promise<{ next: "answer" | "done"; message: string }> {
  const s = loadState(folder);
  if (s.stage === "done") return { next: "done", message: "already done" };
  const job = jobFor(p, folder);
  const answer = strip(read(join(folder, "answer.txt")));
  const c = await check(job, answer);
  const list = [...c.problems, ...c.warnings];
  const ask = (prompt: string, stage: AuthorState["stage"], why: string) => {
    writeFileSync(join(folder, "next.md"), prompt);
    saveState(folder, { ...s, stage });
    return { next: "answer" as const, message: why };
  };
  const finish = (source: string, last: Checked, reviewed?: AuthorState["reviewed"]) => {
    writeFileSync(join(folder, "scene.txt"), plainMoments(source, job.opts));
    saveState(folder, { ...s, stage: "done", ok: !last.problems.length && !!last.result.scene, problems: last.problems, warnings: last.warnings, notes: last.notes, ...(reviewed ? { reviewed } : {}) });
    return { next: "done" as const, message: last.problems.length ? `done, but it does not build (${last.problems.length} problems)` : "done: it builds" };
  };
  // Once a part builds, what code can see about it goes back once.
  const toReview = (source: string, last: Checked) => {
    const said = review(job, source, last.result);
    if (!said) return finish(source, last, "nothing to say");
    s.built = { source, warnings: last.warnings.length };
    writeFileSync(join(folder, "built.txt"), source);
    return ask(reviewRequest(job, source, said), "review", "it builds; the review is in next.md");
  };
  if (s.stage === "build") {
    s.round += 1;
    writeFileSync(join(folder, `round-${s.round}.txt`), answer);
    if (!list.length || (!c.problems.length && s.round >= 2)) return toReview(answer, c);
    if (s.round >= BUILD_ROUNDS) return c.problems.length ? finish(answer, c) : toReview(answer, c);
    return ask(repairRequest(job, answer, list), "build", `round ${s.round}: ${c.problems.length} problems, ${c.warnings.length} hand-off misses; repair request in next.md`);
  }
  const built = s.built!;
  writeFileSync(join(folder, `${s.stage}.txt`), answer);
  if (!c.problems.length && c.warnings.length <= built.warnings) return finish(answer, c, "kept");
  if (s.stage === "review" && c.problems.length) return ask(repairRequest(job, answer, list), "review-repair", `the reviewed version has ${c.problems.length} problems; repair request in next.md`);
  // The reviewed version breaks or misses more: the built one stands.
  const before = await check(job, built.source);
  return finish(built.source, before, "not kept");
}

export const exists = (f: string) => existsSync(f);
