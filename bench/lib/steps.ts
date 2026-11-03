// The bench steps after authoring: id maps, free measures, clips and watch sheets, grading, and the summary. Each is a
// command of bench/run.ts and reads and writes files in bench/work/<run>/<case>/.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "../../engine/language/build.ts";
import type { Scene } from "../../engine/core/types.ts";
import { attachments, catalogue, holds, mapRequest, mapSchema, sample, sourceWords, spans, type Mapped } from "../../pipeline/lib/direction-check.ts";
import { prompt } from "../../pipeline/lib/project.ts";
import { kitKinds, sceneBuildOptions } from "../../pipeline/stages/scene.ts";
import { captions } from "../../pipeline/stages/timeline.ts";
import type { Project } from "../../schemas/project.ts";
import { loadCase, picturesOf, type Case } from "./case.ts";
import { failed, measureCase, type CaseMeasure } from "./measure.ts";
import { BENCH, RESULTS, WORK, folderOf } from "./paths.ts";
import { settingsOf } from "./settings.ts";

type Step = (run: string, ids: string[], flags: Set<string>) => Promise<void>;
const read = (f: string) => readFileSync(f, "utf8");
const json = <T,>(f: string): T => JSON.parse(read(f));
const projectOf = (run: string, id: string): Project => json(join(folderOf(run, id), "project.json"));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// Build options with the case's pictures loadable, as the author's checks had them.
const optionsOf = (p: Project) => sceneBuildOptions(p, Object.fromEntries(picturesOf(p).map((x) => [x.name, x.src])));

// The author's final part, built with the engine as it is now.
async function built(run: string, id: string): Promise<{ p: Project; scene?: Scene; source: string; why?: string }> {
  const folder = folderOf(run, id);
  const p = projectOf(run, id);
  const file = join(folder, "scene.txt");
  if (!existsSync(file)) return { p, source: "", why: "the author never finished" };
  const source = read(file);
  const r = await build(source, optionsOf(p));
  return { p, scene: r.scene, source, why: r.scene ? undefined : r.problems.slice(0, 3).map((x) => `line ${x.line}: ${x.message}`).join(" | ") };
}

// ---------------------------------------------------------------------------------------------------------------------
// Id map: the plan names things in words, the scene has ids. The direction check asks Spark; the bench writes the very
// same request to a file for a Claude agent, which answers in map.json.

export const map: Step = async (run, ids) => {
  const system = (prompt("direction-check").split(/^# /m).find((x) => x.startsWith("Map")) ?? "").slice(3).trim();
  for (const id of ids) {
    const b = await built(run, id);
    if (!b.scene) {
      console.log(`${id}: no scene (${b.why})`);
      continue;
    }
    const kinds = kitKinds();
    const s = sample(b.scene);
    for (const [k, words] of sourceWords(b.source, kinds)) if (s.ids.includes(k) && !s.text.get(k)) s.text.set(k, words);
    const attached = attachments(b.source, kinds);
    const plan = b.p.direction!;
    const list = spans(plan, b.p.narration!.words, s.fps, s.frames);
    const request = mapRequest(plan, list, s, catalogue(s, attached), holds(plan, b.p.narration!));
    const out = join(folderOf(run, id), "map.md");
    writeFileSync(out, `${system}\n\n---\n\n${request}\n\n---\n\nAnswer with one JSON object matching this schema, and nothing else:\n${JSON.stringify(mapSchema)}\n`);
    console.log(`${id}: ${out}`);
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// Free measures.

export const measure: Step = async (run, ids) => {
  const rows: CaseMeasure[] = [];
  for (const id of ids) {
    const folder = folderOf(run, id);
    const b = await built(run, id);
    if (!b.scene) {
      rows.push(failed(id, b.why ?? "no scene"));
      continue;
    }
    const mapFile = join(folder, "map.json");
    const raw = existsSync(mapFile) ? (json<Mapped>(mapFile)) : undefined;
    const set = settingsOf(loadCase(id));
    const m = measureCase(b.p, b.scene, b.source, optionsOf(b.p).ctx.theme, raw, set);
    m.raw.settings = set;
    rows.push(m);
    writeFileSync(join(folder, "measure.json"), JSON.stringify(m, null, 1));
    console.log(`${id}: overall ${m.overall.toFixed(2)} ${Object.entries(m.scores).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}${raw ? "" : " (no id map: eye, holds and reveal not judged)"}`);
  }
  writeFileSync(join(WORK, run, "scores.json"), JSON.stringify(rows, null, 1));
};

// ---------------------------------------------------------------------------------------------------------------------
// Clips: a small MP4 with the video's captions and a clock, then watch sheets of 8 frames (2 s at 4 frames a second)
// and a transcript cut to the same 2 s windows. Frames are deleted once tiled.

const SCALE = 1 / 3;
const SHEET = { fps: 4, cols: 4, rows: 2 };
const windowSeconds = (SHEET.cols * SHEET.rows) / SHEET.fps;

let bundled: string | undefined;
async function serveUrl(): Promise<string> {
  if (bundled) return bundled;
  const { bundle } = await import("@remotion/bundler");
  bundled = await bundle({ entryPoint: join(BENCH, "clip.tsx") });
  return bundled;
}

// The timed words, cut into the sheets' windows, with each hold as a silence.
export function transcript(p: Project): string[] {
  const words = p.narration!.words;
  const silences = p.narration!.holds ?? [];
  const n = Math.ceil(p.narration!.seconds / windowSeconds);
  return Array.from({ length: n }, (_, k) => {
    const [a, b] = [k * windowSeconds, (k + 1) * windowSeconds];
    const said = words.filter((w) => w.start >= a && w.start < b).map((w) => w.text).join(" ");
    const quiet = silences.filter((h) => h.start < b && h.start + h.seconds > a).map((h) => `(silence ${Math.max(a, h.start).toFixed(1)} to ${Math.min(b, h.start + h.seconds).toFixed(1)} s)`);
    return `sheet ${String(k + 1).padStart(2, "0")}, ${a.toFixed(1)} to ${b.toFixed(1)} s: ${[said, ...quiet].filter(Boolean).join(" ") || "(silence)"}`;
  });
}

export const render: Step = async (run, ids) => {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const url = await serveUrl();
  const browserExecutable = process.env.BETTERVID_CHROME || null;
  for (const id of ids) {
    const folder = folderOf(run, id);
    const b = await built(run, id);
    if (!b.scene) {
      console.log(`${id}: no scene to render (${b.why})`);
      continue;
    }
    const theme = optionsOf(b.p).ctx.theme;
    const inputProps = { scene: b.scene, theme, captions: captions(b.p, []) };
    const composition = await selectComposition({ serveUrl: url, id: "BenchClip", inputProps, browserExecutable });
    const mp4 = join(folder, "clip.mp4");
    const t0 = Date.now();
    await renderMedia({ serveUrl: url, composition, inputProps, browserExecutable, codec: "h264", crf: 28, imageFormat: "jpeg", jpegQuality: 70, scale: SCALE, concurrency: Number(process.env.RENDER_CONCURRENCY ?? 3), outputLocation: mp4 });
    const sheets = join(folder, "sheets");
    rmSync(sheets, { recursive: true, force: true });
    mkdirSync(sheets, { recursive: true });
    // Frames are sampled at the start of each quarter second and tiled in the order they play, left to right.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-vf", `fps=${SHEET.fps}:start_time=0:round=down,scale=270:480,tile=${SHEET.cols}x${SHEET.rows}:padding=4:color=gray`, "-q:v", "5", join(sheets, "sheet-%02d.jpg")]);
    writeFileSync(join(folder, "transcript.txt"), transcript(b.p).join("\n") + "\n");
    writeWatchTasks(run, id, b.p);
    console.log(`${id}: ${mp4} in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${readdirSync(sheets).length} sheets`);
  }
  // The bundle is about 30 MB in the system's temp folder; it is ours alone, so it goes once the clips are made.
  rmSync(url, { recursive: true, force: true });
  bundled = undefined;
};

// The tasks the watch tests give their agents: the quiz without answers, and where the sheets and words are.
function writeWatchTasks(run: string, id: string, p: Project) {
  const c = loadCase(id);
  const folder = folderOf(run, id);
  const quiz = c.quiz.map((x, i) => `${i + 1}. ${x.q}`).join("\n");
  const sheets = readdirSync(join(folder, "sheets")).sort().map((f) => join(folder, "sheets", f));
  const words = read(join(folder, "transcript.txt"));
  writeFileSync(join(folder, "quiz.md"), quiz + "\n");
  writeFileSync(join(folder, "watch-learner.md"), `${LEARNER}\n\nThe sheets, in order (open every one, in this order):\n${sheets.join("\n")}\n\nThe narration, by sheet:\n${words}\nThe quiz:\n${quiz}\n\nWrite your answers to ${join(folder, "learner.json")} as a JSON list of {"q": number, "answer": string, "from": "words" | "picture" | "both" | "not in the clip"}.\n`);
  writeFileSync(join(folder, "watch-words.md"), `${WORDS_ONLY}\n\nThe narration, by 2 second stretch:\n${words}\nThe quiz:\n${quiz}\n\nWrite your answers to ${join(folder, "words.json")} as a JSON list of {"q": number, "answer": string}.\n`);
  writeFileSync(join(folder, "watch-follow.md"), `${FOLLOW}\n\nThe sheets, in order (open every one, in this order):\n${sheets.join("\n")}\n\nThe narration, by sheet:\n${words}\nWrite ${join(folder, "follow.json")} as a JSON list with one entry per sheet: {"sheet": number, "looking": string, "waiting": string, "confusing": string}.\n`);
  writeFileSync(join(folder, "watch-designer.md"), `${DESIGNER}\n\nWhat the clip is for: ${c.goal}\nThe user asked: ${c.request}\n\nThe sheets, in order (open every one, in this order):\n${sheets.join("\n")}\n\nThe narration, by sheet:\n${words}\nWrite ${join(folder, "designer.json")} as one JSON object: {"composition": 1-10, "type": 1-10, "motion": 1-10, "hierarchy": 1-10, "consistency": 1-10, "overall": 1-10, "issues": [the worst problems, most serious first, each with its sheet number]}.\n`);
  writeFileSync(join(folder, "watch-depict.md"), `${DEPICT}\n\nThe sheets, in order (open every one, in this order):\n${sheets.join("\n")}\n\nThe narration, by sheet:\n${words}\nWrite ${join(folder, "depict.json")} as one JSON object: {"things": [{"thing": string, "as": "itself" | "symbol" | "word" | "absent", "sheet": number, "note": string}], "changes": [{"change": string, "as": "shown" | "told" | "missing", "sheet": number, "note": string}]}.\n`);
  writeFileSync(join(folder, "watch-scroll.md"), `${SCROLLER}\n\nThe sheets, in order:\n${sheets.join("\n")}\n\nThe narration, by sheet (you half hear it):\n${words}\nWrite ${join(folder, "scroll.json")} as one JSON object: {"sheets": [{"sheet": number, "watching": true|false, "noticed": string}], "swiped_at": sheet number or null, "remembers": "what you would tell a friend this clip said, in one or two sentences"}.\n`);
  void p;
}

// Writes the watch tasks again, for clips already rendered (after the task texts change).
export const tasks: Step = async (run, ids) => {
  for (const id of ids) if (existsSync(join(folderOf(run, id), "sheets"))) writeWatchTasks(run, id, projectOf(run, id));
};

const LEARNER = `You are a first-time learner. You know nothing about this topic beyond what the clip shows and says. You watch a short vertical video as sheets of frames: each sheet holds 8 frames, 4 a second, left to right then top to bottom, covering 2 seconds. A clock in the top left corner of each frame gives the time; the captions at the bottom are the narration. Watch every sheet in order with the words beside it, as a viewer would, then answer the quiz from what the clip showed and said. Do not use outside knowledge: if the clip did not show or say it, answer "not in the clip". Say for each answer whether you got it from the words, the picture, or both.`;
const DESIGNER = `You are a demanding motion designer and art director who makes top short-form explainers. You judge a short vertical video (9:16, for phones) from sheets of frames: each sheet holds 8 frames, 4 a second, left to right then top to bottom, covering 2 seconds; a clock in the corner gives the time and the captions at the bottom are the video's own. Go through every sheet in order. Judge as you would a colleague's cut before it ships: composition and use of the frame, type (size, weight, line length, readability on a phone), motion (does change carry meaning, is it smooth, purposeful, well timed with the words), hierarchy (is it always clear what matters now), and consistency. Score each from 1 (amateur) to 10 (best in the field); 5 is competent but forgettable. Be specific and strict; do not grade on effort.`;
const SCROLLER = `You are an ordinary person scrolling short videos on your phone, a little tired and distracted. You did not choose this video; it came up in your feed. You see it as sheets of frames: each sheet holds 8 frames, 4 a second, left to right then top to bottom, covering 2 seconds. Glance at each sheet the way a scroller would, for a moment, noticing only what grabs you; you half hear the words. After each sheet, say honestly whether you would still be watching, and what you noticed. Once you would have swiped away, stop watching (mark the rest as not watching). At the end, say what you would tell a friend the clip said.`;
const WORDS_ONLY = `You are a first-time learner who only hears a short clip's narration, with no picture. You know nothing about this topic beyond the words below. Answer the quiz from the words alone. Do not use outside knowledge: if the words do not say it, answer "not in the clip".`;
const DEPICT = `You check whether a short vertical video shows what it talks about, or only names it. You see it as sheets of frames: each sheet holds 8 frames, 4 a second, left to right then top to bottom, covering 2 seconds; a clock in the corner gives the time and the captions at the bottom are the narration (ignore the captions themselves). Go through every sheet in order with the words beside it.
1. Things: list every concrete thing the narration names that the moment is about (an object, substance, creature, body part, place, device, person, a piece of data). For each, say how the picture gives it, at its best moment: "itself" when it is drawn so you would know it with its label covered (its shape, colour, parts, material: a flask with liquid in it, a heart shape, a map, a chart's real bars); "symbol" when a generic shape or icon stands in that you only know by convention or with help from its label (a plain circle for a cell, a dot for a drop); "word" when only its name is written (as text, or in a box or circle); "absent" when it is not on screen at all. Code, a formula or a sentence the moment is about is "itself" when it is shown as such.
2. Changes: list every change of state the narration says happens (something moves, falls, fills, turns a colour, grows, breaks, joins, stops, wins). For each: "shown" when the picture makes the change visibly (it moves, recolours, fills, the drawing changes), "told" when only words on screen change (a label rewritten, a tag "pink" added, a counter), "missing" when the picture does not change at all.
Be strict and literal: a box labelled FLASK is a word, not a flask; a tag that says "pink" on a grey shape is told, not shown.`;
const FOLLOW = `You are a first-time viewer of a short vertical video. You know nothing about its topic. You see it as sheets of frames: each sheet holds 8 frames, 4 a second, left to right then top to bottom, covering 2 seconds; a clock in the corner gives the time and the captions are the narration. Go through the sheets in order. For each sheet, say, as the viewer in that moment and knowing only what came before: what you are looking at (the one thing your eye goes to, in a few words), what you are waiting for (the open question or what you expect next, or "nothing"), and anything confusing (what you could not tell or follow, or "" when nothing). Be honest and plain; a clear clip gets short answers.`;

// ---------------------------------------------------------------------------------------------------------------------
// Grading: one request per group of cases, for a grader agent that never watched anything. It marks each answer
// against the case's answer, and each follow entry against the plan's look and open question for that window.

const GROUP = 8;
export const grade: Step = async (run, ids) => {
  const ready = ids.filter((id) => existsSync(join(folderOf(run, id), "learner.json")) || existsSync(join(folderOf(run, id), "follow.json")));
  for (let g = 0; g * GROUP < ready.length; g++) {
    const part = ready.slice(g * GROUP, (g + 1) * GROUP).map((id) => gradeBlock(run, id));
    const file = join(WORK, run, `grade-${g + 1}.md`);
    writeFileSync(file, `${GRADER}\n\n${part.join("\n\n---\n\n")}\n\nWrite ${join(WORK, run, `grades-${g + 1}.json`)} as one JSON object: {"<case id>": {"video": [score per question], "words": [score per question], "follow": [{"sheet": number, "on_look": score, "waiting_ok": score, "confused": true|false}], "remembers": score}}. Scores are 1 (right), 0.5 (partly right or vague) or 0 (wrong, missing or "not in the clip").\n`);
    console.log(file);
  }
};

function gradeBlock(run: string, id: string): string {
  const folder = folderOf(run, id);
  const c: Case = loadCase(id);
  const p = projectOf(run, id);
  const answers = (f: string) => (existsSync(join(folder, f)) ? json<{ q: number; answer: string }[]>(join(folder, f)) : []);
  const video = answers("learner.json");
  const words = answers("words.json");
  const quiz = c.quiz.map((x, i) => `Q${i + 1}. ${x.q}\n  Reference: ${x.a}\n  Video learner: ${video.find((a) => a.q === i + 1)?.answer ?? "(no answer)"}\n  Words-only learner: ${words.find((a) => a.q === i + 1)?.answer ?? "(no answer)"}`).join("\n");
  const follow = existsSync(join(folder, "follow.json")) ? json<{ sheet: number; looking: string; waiting: string; confusing: string }[]>(join(folder, "follow.json")) : [];
  const w = p.narration!.words;
  const planAt = (t: number) => {
    const e = [...p.direction!.events].reverse().find((x) => w[x.firstWord]!.start <= t + 0.01) ?? p.direction!.events[0]!;
    return e;
  };
  const rows = follow.map((f) => {
    const mid = (f.sheet - 1) * windowSeconds + windowSeconds / 2;
    const e = planAt(mid);
    return `Sheet ${f.sheet} (${((f.sheet - 1) * windowSeconds).toFixed(0)} to ${(f.sheet * windowSeconds).toFixed(0)} s), plan: eye on "${e.look}"; viewer should be waiting for "${e.waiting || "nothing in particular"}".\n  Viewer looked at: ${f.looking}\n  Viewer waiting for: ${f.waiting}\n  Viewer confused by: ${f.confusing || "(nothing)"}`;
  });
  const scroll = existsSync(join(folder, "scroll.json")) ? json<{ remembers?: string }>(join(folder, "scroll.json")) : undefined;
  return `## Case ${id}\n\nQuiz:\n${quiz}\n\nFollow test:\n${rows.join("\n") || "(none)"}\n\nDistracted viewer: the clip is for "${c.goal}". What they would tell a friend: ${scroll?.remembers ?? "(no answer)"}`;
}

const GRADER = `You grade a teaching benchmark. You never saw the clips. For each case:
- Quiz: compare each learner's answer with the reference answer. 1 when it says what the reference says (wording may differ; numbers must match), 0.5 when it is partly right or too vague to count, 0 when it is wrong, missing, or "not in the clip". Grade the video learner and the words-only learner separately, one score per question, in order.
- Distracted viewer: "remembers" is 1 when what they would tell a friend carries the clip's point (as stated), 0.5 when it carries part of it, 0 when it misses it or is wrong.
- Follow test: for each sheet, on_look is 1 when what the viewer looked at is the plan's eye target (or a part of it), 0.5 when related, 0 when it is something else. waiting_ok is 1 when the viewer's expectation matches the plan's open question (or the plan expects nothing and the viewer is simply following), 0.5 when close, 0 when it does not. confused is true when the viewer reports anything confusing.
Be strict and consistent. Do not reward an answer for being plausible: it must match the reference.`;

// ---------------------------------------------------------------------------------------------------------------------
// The summary: free measures and watch tests together, per case and overall.

type Graded = { video?: number[]; words?: number[]; follow?: { sheet: number; on_look: number; waiting_ok: number; confused: boolean }[]; remembers?: number };
type Designer = { composition: number; type: number; motion: number; hierarchy: number; consistency: number; overall: number; issues: string[] };
type DepictWatch = { things?: { as: string }[]; changes?: { as: string }[] };
// The watch test's depiction score: things drawn as themselves 1, as a symbol 0.5, as a word or not at all 0; changes
// shown 1, told or missing 0; the mean of the two lists that have entries.
export function depictWatch(d: DepictWatch): number | undefined {
  const things = (d.things ?? []).map((t) => (t.as === "itself" ? 1 : t.as === "symbol" ? 0.5 : 0));
  const changes = (d.changes ?? []).map((c) => (c.as === "shown" ? 1 : 0));
  const parts = [things, changes].filter((x) => x.length).map(mean);
  return parts.length ? mean(parts) : undefined;
}
type Scroll = { sheets: { sheet: number; watching: boolean }[]; swiped_at: number | null; remembers: string };

export const report: Step = async (run, ids) => {
  const scores = json<CaseMeasure[]>(join(WORK, run, "scores.json"));
  const grades: Record<string, Graded> = Object.assign({}, ...readdirSync(join(WORK, run)).filter((f) => /^grades-\d+\.json$/.test(f)).map((f) => json(join(WORK, run, f))));
  const out = join(RESULTS, run);
  mkdirSync(join(out, "scenes"), { recursive: true });
  const rows = ids.map((id) => {
    const m = scores.find((x) => x.id === id);
    const c = loadCase(id);
    const g = grades[id] ?? {};
    const byNeeds = (arm: number[] | undefined, needs: string) => {
      const xs = c.quiz.map((q, i) => (q.needs === needs ? arm?.[i] : undefined)).filter((x): x is number => x !== undefined);
      return xs.length ? mean(xs) : undefined;
    };
    const hardOf = (arm: number[] | undefined) => {
      const xs = c.quiz.map((q, i) => (q.hard ? arm?.[i] : undefined)).filter((x): x is number => x !== undefined);
      return xs.length ? mean(xs) : undefined;
    };
    const learner = g.video?.length ? mean(g.video) : undefined;
    const wordsOnly = g.words?.length ? mean(g.words) : undefined;
    const follow = g.follow?.length ? { onLook: mean(g.follow.map((f) => f.on_look)), waiting: mean(g.follow.map((f) => f.waiting_ok)), confused: mean(g.follow.map((f) => (f.confused ? 1 : 0))) } : undefined;
    const folder = folderOf(run, id);
    const designer = existsSync(join(folder, "designer.json")) ? json<Designer>(join(folder, "designer.json")) : undefined;
    const scroll = existsSync(join(folder, "scroll.json")) ? json<Scroll>(join(folder, "scroll.json")) : undefined;
    // Depiction: the free signals and the watch test, the watch weighing more (it sees the finished picture).
    const depictFree = (m?.scores as Record<string, number> | undefined)?.depict;
    const depictSeen = existsSync(join(folder, "depict.json")) ? depictWatch(json<DepictWatch>(join(folder, "depict.json"))) : undefined;
    const ww = settingsOf(c).depict.watchWeight;
    const depict = depictSeen === undefined ? depictFree : depictFree === undefined ? depictSeen : (1 - ww) * depictFree + ww * depictSeen;
    // Retention: the share of the clip's sheets the distracted viewer was still watching.
    const kept = scroll ? (scroll.swiped_at ? (scroll.swiped_at - 1) / Math.max(1, scroll.sheets.length) : 1) : undefined;
    for (const f of ["scene.txt", "map.json", "learner.json", "words.json", "follow.json", "designer.json", "scroll.json", "depict.json"]) if (existsSync(join(folder, f))) copyFileSync(join(folder, f), join(out, "scenes", `${id}.${f}`));
    const author = existsSync(join(folder, "author.json")) ? json<{ round: number; reviewed?: string; ok?: boolean }>(join(folder, "author.json")) : undefined;
    return {
      id, use: c.use, style: c.style, built: m?.built ?? false, passed: author?.ok ?? false, rounds: author?.round ?? 0, reviewed: author?.reviewed ?? "",
      overall: m?.overall ?? 0, scores: m?.scores ?? {},
      learner, wordsOnly, gain: learner !== undefined && wordsOnly !== undefined ? learner - wordsOnly : undefined,
      pictureQuestions: byNeeds(g.video, "picture"), pictureQuestionsWordsOnly: byNeeds(g.words, "picture"),
      hard: hardOf(g.video), hardWordsOnly: hardOf(g.words),
      depictFree, depictSeen, depict,
      follow,
      designer: designer ? { overall: designer.overall, composition: designer.composition, type: designer.type, motion: designer.motion, hierarchy: designer.hierarchy, consistency: designer.consistency, issues: designer.issues.slice(0, 3) } : undefined,
      scroller: scroll ? { kept, remembers: g.remembers } : undefined,
      material: !!c.material?.length,
      tickets: (m?.tickets ?? []).filter((t) => t.severity >= 2).map((t) => `${t.kind}: ${t.note}`).slice(0, 6),
      raw: m?.raw ?? {},
    };
  });
  const keys = ["eye", "lag", "pace", "load", "holds", "reveal", "read"] as const;
  const avg = (f: (r: (typeof rows)[number]) => number | undefined) => {
    const xs = rows.map(f).filter((x): x is number => x !== undefined);
    return xs.length ? +mean(xs).toFixed(3) : null;
  };
  const overall = {
    cases: rows.length,
    built: rows.filter((r) => r.built).length,
    passed: rows.filter((r) => r.passed).length,
    overall: avg((r) => r.overall),
    ...Object.fromEntries(keys.map((k) => [k, avg((r) => (r.scores as Record<string, number>)[k])])),
    learner: avg((r) => r.learner), wordsOnly: avg((r) => r.wordsOnly), gain: avg((r) => r.gain),
    hard: avg((r) => r.hard), hardWordsOnly: avg((r) => r.hardWordsOnly), hardGap: avg((r) => (r.hard !== undefined && r.hardWordsOnly !== undefined ? r.hard - r.hardWordsOnly : undefined)),
    depictFree: avg((r) => r.depictFree), depictSeen: avg((r) => r.depictSeen), depict: avg((r) => r.depict),
    pictureQuestions: avg((r) => r.pictureQuestions), pictureQuestionsWordsOnly: avg((r) => r.pictureQuestionsWordsOnly),
    followOnLook: avg((r) => r.follow?.onLook), followWaiting: avg((r) => r.follow?.waiting), followConfused: avg((r) => r.follow?.confused),
    designer: avg((r) => r.designer?.overall), scrollKept: avg((r) => r.scroller?.kept), scrollRemembers: avg((r) => r.scroller?.remembers),
    materialCases: rows.filter((r) => r.material).length, learnerMaterial: avg((r) => (r.material ? r.learner : undefined)), learnerPrompt: avg((r) => (r.material ? undefined : r.learner)),
  };
  writeFileSync(join(out, "summary.json"), JSON.stringify({ run, overall, cases: rows }, null, 1));
  const f2 = (x: number | undefined | null) => (x === undefined || x === null ? "-" : x.toFixed(2));
  const gap = (a?: number | null, b?: number | null) => (a === undefined || a === null || b === undefined || b === null ? undefined : a - b);
  const table = [
    `| case | use | style | built | teach gap | hard gap | free | eye | lag | pace | load | holds | reveal | read | depict (free) | depict (watch) | depict | quiz (video) | quiz (words) | hard Qs (video) | hard Qs (words) | follow on look | confused | designer /10 | scroll kept | scroll remembers |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
    ...rows.map((r) => `| ${r.id} | ${r.use} | ${r.style.replace(/^custom\//, "").replace(/-[0-9a-f]{4}$/, "")} | ${r.built ? `yes (${r.rounds}${r.passed ? "" : ", checks fail"})` : "NO"} | ${f2(r.gain)} | ${f2(gap(r.hard, r.hardWordsOnly))} | ${f2(r.overall)} | ${keys.map((k) => f2((r.scores as Record<string, number>)[k])).join(" | ")} | ${f2(r.depictFree)} | ${f2(r.depictSeen)} | ${f2(r.depict)} | ${f2(r.learner)} | ${f2(r.wordsOnly)} | ${f2(r.hard)} | ${f2(r.hardWordsOnly)} | ${f2(r.follow?.onLook)} | ${f2(r.follow?.confused)} | ${r.designer ? r.designer.overall : "-"} | ${f2(r.scroller?.kept)} | ${f2(r.scroller?.remembers)} |`),
    `| **all** | | | ${overall.built}/${overall.cases} | ${f2(overall.gain)} | ${f2(overall.hardGap)} | ${f2(overall.overall)} | ${keys.map((k) => f2((overall as Record<string, number | null>)[k])).join(" | ")} | ${f2(overall.depictFree)} | ${f2(overall.depictSeen)} | ${f2(overall.depict)} | ${f2(overall.learner)} | ${f2(overall.wordsOnly)} | ${f2(overall.hard)} | ${f2(overall.hardWordsOnly)} | ${f2(overall.followOnLook)} | ${f2(overall.followConfused)} | ${f2(overall.designer)} | ${f2(overall.scrollKept)} | ${f2(overall.scrollRemembers)} |`,
  ];
  // The instruments' raw readings beside the scores, so a judge can reason over them with the case's own settings.
  const readings = rows.filter((r) => r.built).map((r) => {
    const x = r.raw as Record<string, any>;
    const rd = x.read ?? {};
    const set = x.settings ?? settingsOf(loadCase(r.id));
    const hs = (x.holds ?? []).map((h: any) => `${h.id} ${h.purpose}${h.still ? " (still)" : ""}: working ${h.work}, unrelated ${h.other}${h.answered ? ", answer shown" : ""}`).join("; ") || "none";
    const dp = x.depict ?? {};
    const units = (dp.units ?? []).reduce((a: Record<string, number>, u: any) => ({ ...a, [u.as]: (a[u.as] ?? 0) + 1 }), {});
    return `- **${r.id}** (${set.context.screen}, ${set.context.frame}, ${set.context.attention}): read: words ${rd.words}, small ${rd.smallShare}, faint ${rd.faintShare}, subject ${rd.subject}, frame in use ${rd.filledShare}, empty band ${rd.emptyBand}, broken ${rd.broken}${(rd.examples ?? []).length ? ` (${rd.examples.slice(0, 3).join("; ")})` : ""}. holds: ${hs}. depict: ${Object.entries(units).map(([k, v]) => `${v} ${k}`).join(", ") || "no picture"}; changes ${(dp.shown ?? []).length} shown, ${(dp.told ?? []).length} told. load: peak ${x.load?.peakNew} new in 2 s, ${x.load?.peakPull} pulls. mentions: ${x.mentions?.in_time}/${x.mentions?.total} in time.`;
  });
  const notes = rows.filter((r) => r.tickets.length).map((r) => `- **${r.id}**: ${r.tickets.slice(0, 3).join(" / ").slice(0, 600)}`);
  writeFileSync(join(out, "scores.md"), `# Bench run ${run}\n\nThe main teaching number is the **teach gap**: the video learner minus the words-only learner over the whole quiz, what the picture teaches beyond the narration. "hard gap" is the same over the hard, picture-dependent questions. Free measures are 0 to 1; "free" is their mean (depict there is the free signal only); "depict" blends the free signal with the watch test by the case's depict.watchWeight (0.6 to the watch by default); quiz scores are the share right; "confused" is the share of 2 s windows where the follow viewer reported confusion. Columns are explained in bench/README.md.\n\n${table.join("\n")}\n\n## Instrument readings\n\nRaw values behind the scores, read against each case's settings (its measure block over the defaults in bench/lib/settings.ts).\n\n${readings.join("\n")}\n\n## Direction tickets (severity 2 and 3)\n\n${notes.join("\n")}\n`);
  console.log(join(out, "scores.md"));
};
