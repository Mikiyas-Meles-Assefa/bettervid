// The scene step: the engine is the one visual step for every video. The narration is split into sections, a quick
// first pass plans what carries from one section into the next, then Spark writes every section at the same time in the
// scene language, with the video's own word numbers so the sections join into one document in order. Each section is
// built by the engine and repaired from its errors, then rendered to a few still frames that Spark looks at beside the
// words, and repaired again from what it sees. No fallback: a section that cannot be repaired is reported loudly.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project, SceneSection, ScenePlan } from "../../schemas/project.ts";
import { when } from "../../engine/core/compile.ts";
import { evaluate } from "../../engine/core/evaluate.ts";
import type { CompileContext, Resolved, Scene, Theme } from "../../engine/core/types.ts";
import { KITS } from "../../engine/kits/index.ts";
import { languagePrompt, numbered, truthText } from "../../engine/language/author.ts";
import { build, formatProblems, type BuildOptions, type BuildResult } from "../../engine/language/build.ts";
import { loadLibrary } from "../../engine/language/library.ts";
import { parse, type Item, type State } from "../../engine/language/syntax.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import { json, text } from "../lib/meta.ts";
import { asked, charge, dir, prompt, stage, topic } from "../lib/project.ts";
import { shotsToScene } from "../lib/shots-scene.ts";
import { hash } from "../lib/util.ts";

const VERSION = 1; // bump when the way sections are written or checked changes, so cached sections are redone
const FPS = 30;
const [WIDTH, HEIGHT] = [1080, 1920];
export const SIZE = { target: 55, max: 85, min: 20 }; // words per section: about 15 to 30 seconds of speech
const BUILD_ROUNDS = 4;
const LOOK_ROUNDS = 2;
const STILLS = 6;
const PARALLEL = 6;
const MAX_PROBLEMS = 25;

export type Range = { id: string; firstWord: number; lastWord: number };
export type Carry = { id: string; what: string };
export type CastPart = { shows: string; handoff: Carry[] };
type Spoken = { text: string; start: number; beatId?: string };

// ---------------------------------------------------------------------------------------------------------------------
// Pure parts: splitting, slicing and joining scene text. Tested in scene.test.ts.

// Splits a run of words that is too long at the sentence ends closest to equal parts, else at commas, else anywhere.
function splitRun(words: Spoken[], from: number, to: number, max: number): [number, number][] {
  const n = to - from + 1;
  if (n <= max) return [[from, to]];
  const parts = Math.ceil(n / max);
  const cuts: number[] = [];
  for (let k = 1; k < parts; k++) {
    const ideal = from + Math.round((n * k) / parts) - 1;
    const best = (re: RegExp) => {
      let pick = -1;
      for (let i = from + 1; i < to; i++) if (re.test(words[i]!.text) && i > (cuts.at(-1) ?? from) && (pick < 0 || Math.abs(i - ideal) < Math.abs(pick - ideal))) pick = i;
      return pick >= 0 && Math.abs(pick - ideal) <= max / 3 ? pick : -1;
    };
    const at = [best(/[.?!]["')\]]*$/), best(/[,;:]["')\]]*$/)].find((x) => x >= 0) ?? ideal;
    cuts.push(at);
  }
  const out: [number, number][] = [];
  let start = from;
  for (const c of cuts) {
    out.push([start, c]);
    start = c + 1;
  }
  out.push([start, to]);
  return out.flatMap(([a, b]) => (b - a + 1 > max ? splitRun(words, a, b, max) : [[a, b] as [number, number]]));
}

// Sections follow the script's beats: whole beats are grouped to about `target` words, a beat longer than `max` is split
// at its sentences, and a short tail joins the section before it.
export function splitSections(words: Spoken[], size = SIZE): Range[] {
  const runs: [number, number][] = [];
  for (let i = 0; i < words.length; i++) {
    const last = runs.at(-1);
    if (last && words[i]!.beatId === words[last[1]]!.beatId) last[1] = i;
    else runs.push([i, i]);
  }
  const pieces = runs.flatMap(([a, b]) => splitRun(words, a, b, size.max));
  const groups: [number, number][] = [];
  for (const [a, b] of pieces) {
    const cur = groups.at(-1);
    const len = cur ? cur[1] - cur[0] + 1 : 0;
    if (cur && (len < size.min || (len + (b - a + 1) <= size.target)) && len + (b - a + 1) <= size.max) cur[1] = b;
    else groups.push([a, b]);
  }
  const tail = groups.at(-1);
  const before = groups.at(-2);
  if (tail && before && tail[1] - tail[0] + 1 < size.min && tail[1] - before[0] + 1 <= size.max) {
    before[1] = tail[1];
    groups.pop();
  }
  return groups.map(([firstWord, lastWord], i) => ({ id: `s${i + 1}`, firstWord, lastWord }));
}

type Program = { name: string; text: string };
export type Pieces = { bg?: string; programs: Program[]; states: { word: number; text: string }[] };

// Takes scene text apart into its background, its program definitions and its states, each state with its word.
export function pieces(source: string): Pieces {
  const lines = source.replace(/\r/g, "").replace(/^```[a-z]*\s*$/gm, "").split("\n");
  const out: Pieces = { programs: [], states: [] };
  let pending: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    const program = /^program\s+([A-Za-z][\w-]*)/.exec(t);
    if (program && line === line.trimStart()) {
      const body = [line];
      for (i++; i < lines.length; i++) {
        body.push(lines[i]!);
        if (lines[i]!.trim() === "end") break;
      }
      out.programs.push({ name: program[1]!, text: body.join("\n") });
      continue;
    }
    const bg = /^bg\s+(\S+)/.exec(t);
    if (bg && line === line.trimStart() && !out.states.length) {
      out.bg ??= bg[1];
      continue;
    }
    const at = /^@(\d+)/.exec(t);
    if (at) {
      out.states.push({ word: Number(at[1]), text: [...pending, line].join("\n") });
      pending = [];
      continue;
    }
    if (out.states.length) out.states.at(-1)!.text += `\n${line}`;
    else if (t) pending.push(line);
  }
  if (pending.length) out.states.push({ word: 0, text: pending.join("\n") });
  for (const s of out.states) s.text = s.text.replace(/\s+$/, "");
  return out;
}

const runs = (text: string) => [...text.matchAll(/^\s*run\s+([A-Za-z][\w-]*)/gm)].map((m) => m[1]!);
const rename = (text: string, from: string, to: string) => text.replace(new RegExp(`^(\\s*run\\s+)${from.replace(/[-]/g, "\\-")}(?=\\s|$)`, "gm"), `$1${to}`);

// Joins sections into one document: the first background, every program once (a name two sections define differently
// is renamed in the later one), then every section's states in order.
export function joinSections(sections: { id: string; firstWord: number; source: string }[]): string {
  let bg: string | undefined;
  const programs = new Map<string, string>();
  const bodies: string[] = [];
  for (const s of [...sections].sort((a, b) => a.firstWord - b.firstWord)) {
    const p = pieces(s.source);
    bg ??= p.bg;
    let body = p.states.map((x) => x.text).join("\n");
    for (const prog of p.programs) {
      const known = programs.get(prog.name);
      if (known === undefined || known === prog.text) {
        programs.set(prog.name, prog.text);
        continue;
      }
      let name = `${prog.name}-${s.id}`;
      for (let k = 2; programs.has(name); k++) name = `${prog.name}-${s.id}-${k}`;
      programs.set(name, prog.text.replace(/^program\s+[A-Za-z][\w-]*/, `program ${name}`));
      body = rename(body, prog.name, name);
    }
    bodies.push(body);
  }
  return [...(bg ? [`bg ${bg}`] : []), ...programs.values(), ...bodies].join("\n\n") + "\n";
}

// Cuts a whole-video draft (global word numbers) into one draft per section, by the word each state starts on. Each
// draft carries the background and the programs its states run.
export function sliceSource(source: string, ranges: Range[]): string[] {
  const p = pieces(source);
  const out: string[][] = ranges.map(() => []);
  const isCut = (text: string) => /^\s*@\S+\s+cut\b/m.test(text);
  let lastCut: string | undefined;
  for (const s of p.states) {
    let k = ranges.findIndex((r) => s.word >= r.firstWord && s.word <= r.lastWord);
    if (k < 0) k = s.word < (ranges[0]?.firstWord ?? 0) ? 0 : ranges.length - 1;
    // A section that begins inside a shot opens with that shot's cut, moved to its first word, so it stands on its own.
    if (!out[k]!.length && !isCut(s.text) && lastCut) out[k]!.push(lastCut.replace(/^(\s*)@\S+/m, `$1@${ranges[k]!.firstWord}`));
    if (isCut(s.text)) lastCut = s.text;
    out[k]!.push(s.text);
  }
  return out.map((states) => {
    if (!states.length) return "";
    const used = new Set(states.flatMap(runs));
    return [...(p.bg ? [`bg ${p.bg}`] : []), ...p.programs.filter((x) => used.has(x.name)).map((x) => x.text), ...states].join("\n") + "\n";
  });
}

// Ids a state names directly: its items, everything inside them, and their atoms.
function named(items: Item[], into = new Set<string>()): Set<string> {
  for (const i of items) {
    into.add(i.id);
    for (const part of i.parts ?? []) for (const a of part.type === "text" ? [part.atom] : part.type === "frac" ? [...part.num, ...part.den] : part.rows.flat()) into.add(a.id);
    named(i.children, into);
  }
  return into;
}

// What code can check about a section against its range and its handoffs, before and after the engine builds it.
export function contract(source: string, range: Range, carry: Carry[], kitKinds: string[] = []): string[] {
  const { doc } = parse(source, kitKinds);
  const out: string[] = [];
  const first = doc.states[0];
  if (!first) return [`Your part has no states. Start it with a plain state at @${range.firstWord}.`];
  if (first.at.word !== range.firstWord || first.at.offset < 0) out.push(`line ${first.line}: your first state must be @${range.firstWord}, the first word of your part.`);
  if (first.keep) out.push(`line ${first.line}: your first state must be a plain state, not keep, so your part stands on its own; list everything that is on screen.`);
  for (const s of doc.states) if (s.at.word < range.firstWord || s.at.word > range.lastWord) out.push(`line ${s.line}: @${s.at.word} is outside your part; every state starts on a word from ${range.firstWord} to ${range.lastWord}.`);
  const shown = named(first.items);
  for (const c of carry) if (!shown.has(c.id)) out.push(`line ${first.line}: the part before yours leaves ${c.id} (${c.what}) on screen. List it in your first state with the id ${c.id}, so it stays rather than being drawn again.`);
  return out;
}

// Every id visible at a frame, through the whole tree, so a hand-off can be checked on the built scene.
export function visibleAt(scene: Scene, frame: number): Set<string> {
  const out = new Set<string>();
  const walk = (list: Resolved[], opacity: number) => {
    for (const n of list) {
      const o = opacity * Number(n.props.opacity ?? 1);
      if (o <= 0.05) continue;
      out.add(n.id);
      walk(n.children, o);
    }
  };
  walk(evaluate(scene, frame), 1);
  return out;
}

// Checks that what the next section expects is on screen as this one ends. A line or arrangement counts when any of
// what it holds is visible.
function handedOver(source: string, scene: Scene, frame: number, handoff: Carry[], range: Range, kitKinds: string[]): string[] {
  if (!handoff.length) return [];
  const { doc } = parse(source, kitKinds);
  const members = new Map<string, Set<string>>();
  const index = (items: Item[]) => {
    for (const i of items) {
      members.set(i.id, named([i]));
      index(i.children);
    }
  };
  doc.states.forEach((s: State) => index(s.items));
  const seen = visibleAt(scene, frame);
  const visible = (id: string) => [...(members.get(id) ?? new Set([id]))].some((m) => seen.has(m) || [...seen].some((v) => v.startsWith(`${m}.`)));
  return handoff.filter((c) => !visible(c.id)).map((c) => `The next part picks up ${c.id} (${c.what}), but it is not on screen when your last word, ${range.lastWord}, is spoken. Have it on screen with that id by then.`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Building: the same context and options for checking a section, the whole scene, and the player.

export function sceneContext(p: Project, theme: Theme = themeFrom(p.input.style)): CompileContext {
  const words = p.narration!.words.map((w) => ({ text: w.text, start: w.start }));
  return { fps: FPS, width: WIDTH, height: HEIGHT, frames: Math.ceil((p.narration!.seconds + 0.5) * FPS), theme, words, kits: KITS };
}

// Build options for this project's scene. `assets` maps asset names to an image source the renderer can load.
export function sceneBuildOptions(p: Project, assets: Record<string, string> = {}): BuildOptions {
  return { ctx: sceneContext(p), words: p.narration!.words.map((w) => w.text), assets, library: loadLibrary(), seed: 11 };
}

// The whole scene document, ready for `build()`.
export const joinScene = (plan: ScenePlan) => joinSections(plan.sections);

const kitKinds = () => KITS.flatMap((k) => Object.keys(k.kinds ?? {})).filter((k) => k !== "graph");

// ---------------------------------------------------------------------------------------------------------------------
// Pictures: the director's images, offered to Spark by name.

type Picture = { name: string; path: string; size?: [number, number]; about: string; words?: [number, number] };

function pictures(p: Project, names?: Record<string, string>): Picture[] {
  const words = p.narration!.words;
  const fromAssets: Picture[] = (p.assets ?? []).filter((a) => a.path && !a.missing && a.kind !== "none").map((a) => {
    const shot = p.shots?.find((s) => s.id === a.shotId);
    const first = shot ? words.findIndex((w) => w.start >= shot.start - 0.01) : -1;
    const last = shot ? words.findLastIndex((w) => w.start < shot.end) : -1;
    const about = [a.title, shot?.asset?.subject, shot?.asset?.prompt || shot?.asset?.query, a.look ? `look at: ${a.look}` : ""].filter(Boolean).join("; ");
    return { name: a.shotId, path: a.path!, size: a.size, about: about || "a picture", ...(first >= 0 && last >= first ? { words: [first, last] as [number, number] } : {}) };
  });
  if (!names) return fromAssets;
  return Object.entries(names).map(([name, path]) => fromAssets.find((x) => x.name === name && x.path === path) ?? { ...(fromAssets.find((x) => x.path === path) ?? { about: "a picture" }), name, path });
}

const describe = (list: Picture[]) => list.map((x) => `- ${x.name}${x.size ? `, ${x.size[0]} by ${x.size[1]}` : ""}: ${x.about}${x.words ? ` (the director planned it for words ${x.words[0]} to ${x.words[1]})` : ""}`).join("\n");

// A small JPEG as a data URL, so a still can load it without a server.
function dataUrl(path: string, cache: string): string {
  const out = join(cache, `${hash(path).slice(0, 10)}.jpg`);
  if (!existsSync(out)) execFileSync("ffmpeg", ["-y", "-v", "error", "-i", path, "-vf", "scale='min(720,iw)':-2", "-q:v", "4", out]);
  return `data:image/jpeg;base64,${readFileSync(out).toString("base64")}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stills: one bundle and one browser for the whole stage, a few renders at a time.

type Renderer = { serveUrl: string; browser: any; close: () => Promise<void> };
let renderer: Promise<Renderer> | undefined;
let slots = 2;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (slots <= 0) await new Promise<void>((r) => waiting.push(r));
  slots--;
  try {
    return await fn();
  } finally {
    slots++;
    waiting.shift()?.();
  }
}

function openRenderer(): Promise<Renderer> {
  renderer ??= (async () => {
    const { bundle } = await import("@remotion/bundler");
    const { openBrowser } = await import("@remotion/renderer");
    const serveUrl = await bundle({ entryPoint: join(process.cwd(), "engine/render/preview.tsx") });
    const browser = await openBrowser("chrome", { browserExecutable: process.env.BETTERVID_CHROME ?? null, chromiumOptions: { gl: "angle" } });
    return { serveUrl, browser, close: () => browser.close({ silent: true }) };
  })();
  return renderer;
}

export async function closeRenderer() {
  if (!renderer) return;
  const r = await renderer;
  renderer = undefined;
  await r.close();
}

// Renders frames of a built scene as small JPEGs and returns their paths.
export async function renderStills(scene: Scene, theme: Theme, frames: number[], folder: string, scale = 0.4): Promise<string[]> {
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  const r = await openRenderer();
  mkdirSync(folder, { recursive: true });
  const inputProps = { scene, theme };
  return slot(async () => {
    const composition = await selectComposition({ serveUrl: r.serveUrl, id: "Scene", inputProps, puppeteerInstance: r.browser });
    const out: string[] = [];
    for (const frame of frames) {
      const file = join(folder, `${String(frame).padStart(5, "0")}.jpg`);
      await renderStill({ serveUrl: r.serveUrl, composition, inputProps, frame, imageFormat: "jpeg", jpegQuality: 80, scale, output: file, puppeteerInstance: r.browser });
      out.push(file);
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing one section: build, repair from errors, then look at stills and repair from what Spark sees.

type Job = {
  p: Project;
  range: Range;
  next?: Range;
  carry: Carry[];
  handoff: Carry[];
  system: string;
  request: string;
  opts: BuildOptions; // assets here are loadable sources, for stills
  folder: string;
  log: (line: string) => void;
};
type Written = { source: string; result: BuildResult; problems: string[]; warnings: string[]; usd: number; rounds: number };

const endFrame = (job: Job) => (job.next ? when({ word: job.next.firstWord }, job.opts.ctx) - 2 : job.opts.ctx.frames - 1);

async function check(job: Job, source: string): Promise<{ result: BuildResult; problems: string[]; warnings: string[] }> {
  const kinds = kitKinds();
  const result = await build(source, job.opts);
  const built = result.problems.map((p) => (p.line ? `line ${p.line}: ${p.message}` : p.message));
  const shape = contract(source, job.range, job.carry, kinds);
  // Ranges and plain first states keep the join sound, so they must be fixed. Hand-offs are what the parts agreed;
  // they go back for repair too, but a part that still misses one is reported, not failed.
  const handoff = result.scene ? handedOver(source, result.scene, endFrame(job), job.handoff, job.range, kinds) : [];
  const carryMiss = shape.filter((x) => x.includes("the part before yours leaves"));
  return { result, problems: [...built, ...shape.filter((x) => !carryMiss.includes(x))], warnings: [...carryMiss, ...handoff] };
}

async function compose(job: Job, start: string | undefined, prior: string): Promise<Written> {
  let usd = 0;
  let source = start ?? "";
  let next = prior;
  let last: { result: BuildResult; problems: string[]; warnings: string[] } | undefined;
  let round = 0;
  for (round = 1; round <= BUILD_ROUNDS; round++) {
    if (round > 1 || start === undefined) {
      try {
        const r = await text({ system: job.system, user: next, effort: "medium", maxOutput: 32000 });
        usd += r.usd;
        source = r.value;
      } catch (e) {
        usd += (e as { usd?: number }).usd ?? 0;
        job.log(`    ${job.range.id} round ${round}: the model failed: ${(e as Error).message.slice(0, 160)}`);
        continue;
      }
    }
    last = await check(job, source);
    const all = [...last.problems, ...last.warnings];
    job.log(`    ${job.range.id} round ${round}: ${last.result.stats.states} states, ${last.result.stats.programs} programs, ${last.problems.length} problems, ${last.warnings.length} hand-off misses`);
    for (const x of all.slice(0, 4)) job.log(`      ${x.slice(0, 180)}`);
    if (!all.length) break;
    if (!last.problems.length && round >= 2) break; // builds and is sound; a hand-off still missed after a repair is reported
    next = `${job.request}\n\nYour part, with line numbers added for reference. Do not include the numbers:\n${numbered(source)}\n\n${prompt("engine-repair")}\nProblems:\n${all.slice(0, MAX_PROBLEMS).join("\n")}`;
  }
  // Computed steps are only known once the part builds, so Spark sees them once to tie each step to the right words.
  // The aligned version is kept only if it is still sound.
  if (last && !last.problems.length && last.result.truth?.length) {
    try {
      const r = await text({ system: job.system, user: `${job.request}\n\nYour part builds. Here it is, with line numbers added for reference. Do not include the numbers:\n${numbered(source)}\n\n${truthText(last.result.truth)}`, effort: "medium", maxOutput: 32000 });
      usd += r.usd;
      const aligned = await check(job, r.value);
      job.log(`    ${job.range.id} steps aligned: ${aligned.problems.length} problems`);
      if (!aligned.problems.length) [source, last] = [r.value, aligned];
    } catch (e) {
      usd += (e as { usd?: number }).usd ?? 0;
      job.log(`    ${job.range.id} step alignment failed: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  return { source, result: last?.result ?? { problems: [], stats: { states: 0, parts: 0, programs: 0, programMs: 0 } }, problems: last ? last.problems : ["the model never answered"], warnings: last?.warnings ?? [], usd, rounds: Math.min(round, BUILD_ROUNDS) };
}

// Frames spread over the section, each with the words said since the frame before it.
function moments(job: Job, n = STILLS): { frame: number; words: string }[] {
  const ctx = job.opts.ctx;
  const f0 = when({ word: job.range.firstWord }, ctx);
  const f1 = endFrame(job);
  const words = job.p.narration!.words;
  const out: { frame: number; words: string }[] = [];
  let prev = f0;
  for (let i = 0; i < n; i++) {
    const frame = Math.min(f1, Math.round(f0 + ((i + 0.6) / n) * (f1 - f0)));
    const said = words.map((w, k) => ({ w, k })).filter(({ w, k }) => k >= job.range.firstWord && k <= job.range.lastWord && w.start * FPS >= prev - 1 && w.start * FPS <= frame);
    out.push({ frame, words: said.map(({ w }) => w.text).join(" ") });
    prev = frame;
  }
  return out;
}

async function look(job: Job, w: Written, round: number): Promise<{ reply: string; usd: number }> {
  const shots = moments(job);
  const folder = join(job.folder, `look${round}`);
  const files = await renderStills(w.result.scene!, job.opts.ctx.theme, shots.map((s) => s.frame), folder);
  writeFileSync(join(folder, "scene.txt"), w.source);
  const content: unknown[] = [{ type: "input_text", text: `${job.request}\n\nThe scene written for this part:\n${w.source}` }];
  shots.forEach((s, i) => {
    content.push({ type: "input_text", text: `Frame ${i + 1}, at ${(s.frame / FPS).toFixed(1)} s. Words just said: ${s.words ? `"${s.words}"` : "(a pause)"}` });
    content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(files[i]!).toString("base64")}` });
  });
  content.push({ type: "input_text", text: prompt("scene-look") });
  const r = await text({ system: job.system, user: content, effort: "medium", maxOutput: 32000 });
  writeFileSync(join(folder, "reply.txt"), r.value);
  return { reply: r.value, usd: r.usd };
}

async function writeSection(job: Job, draft: string): Promise<Written & { looks: string[] }> {
  job.log(`  ${job.range.id} (words ${job.range.firstWord} to ${job.range.lastWord}): writing`);
  let w = await compose(job, undefined, draft ? `${job.request}\n\nA first draft of your part, made from the director's shots. Keep its pictures where they serve the words and build on it:\n${draft}` : job.request);
  let usd = w.usd;
  let rounds = w.rounds;
  const looks: string[] = [];
  for (let round = 1; round <= LOOK_ROUNDS && !w.problems.length && w.result.scene; round++) {
    let seen: { reply: string; usd: number };
    try {
      seen = await look(job, w, round);
    } catch (e) {
      usd += (e as { usd?: number }).usd ?? 0;
      job.log(`  ${job.range.id} look ${round}: FAILED to look: ${(e as Error).message.slice(0, 200)}`);
      looks.push(`failed: ${(e as Error).message.slice(0, 200)}`);
      break;
    }
    usd += seen.usd;
    if (/^\W*fine\W*$/i.test(seen.reply.trim())) {
      job.log(`  ${job.range.id} look ${round}: fine`);
      looks.push("fine");
      break;
    }
    job.log(`  ${job.range.id} look ${round}: Spark changed the part`);
    looks.push("changed");
    const fixed = await compose(job, seen.reply, `${job.request}\n\nYour part:\n${seen.reply}`);
    usd += fixed.usd;
    rounds += fixed.rounds;
    if (fixed.problems.length) {
      job.log(`  ${job.range.id} look ${round}: !!! the changed part does not build after ${fixed.rounds} repairs; keeping the version before it. Problems: ${fixed.problems.slice(0, 3).join(" | ")}`);
      looks.push("change did not build");
      break;
    }
    w = fixed;
  }
  // The final version, rendered for the record; no model call.
  if (w.result.scene) await renderStills(w.result.scene, job.opts.ctx.theme, moments(job).map((m) => m.frame), join(job.folder, "final")).catch((e) => job.log(`  ${job.range.id}: final stills failed: ${(e as Error).message.slice(0, 160)}`));
  return { ...w, usd, rounds, looks };
}

// ---------------------------------------------------------------------------------------------------------------------
// The first pass: what each section shows, and what carries into the next.

const castSchema = {
  type: "object",
  additionalProperties: false,
  required: ["parts"],
  properties: {
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["shows", "handoff"],
        properties: {
          shows: { type: "string" },
          handoff: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "what"], properties: { id: { type: "string" }, what: { type: "string" } } } },
        },
      },
    },
  },
} as const;

// Ids must be valid in the language and unique to a thing; a cast id that clashes with another thing is renamed.
export function cleanCast(parts: CastPart[], count: number): CastPart[] {
  const whatOf = new Map<string, string>();
  return Array.from({ length: count }, (_, i) => {
    const part = parts[i] ?? { shows: "", handoff: [] };
    const handoff = i === count - 1 ? [] : part.handoff.map((c) => {
      let id = c.id.replace(/[^\w-]/g, "_").replace(/^[^A-Za-z]+/, "") || `thing${i + 1}`;
      const known = whatOf.get(id);
      if (known !== undefined && known !== c.what && !parts[i - 1]?.handoff.some((x) => x.id === c.id)) id = `${id}_${i + 1}`;
      whatOf.set(id, c.what);
      return { id, what: c.what };
    });
    const seen = new Set<string>();
    return { shows: part.shows, handoff: handoff.filter((c) => !seen.has(c.id) && seen.add(c.id)) };
  });
}

async function planCast(p: Project, ranges: Range[], header: string, pics: string): Promise<{ cast: CastPart[]; usd: number }> {
  const words = p.narration!.words;
  const parts = ranges.map((r, i) => `Part ${i + 1} (words ${r.firstWord} to ${r.lastWord}): ${words.slice(r.firstWord, r.lastWord + 1).map((w) => w.text).join(" ")}`).join("\n\n");
  const user = `${header}${pics ? `Pictures the video has:\n${pics}\n\n` : ""}The ${ranges.length} parts, in order:\n\n${parts}`;
  let usd = 0;
  for (let tries = 1; ; tries++) {
    const r = await json<{ parts: CastPart[] }>({ system: prompt("scene-cast"), user: tries === 1 ? user : `${user}\n\nReturn exactly ${ranges.length} parts, one per part above, in order.`, schema: castSchema, schemaName: "cast", effort: "low" });
    usd += r.usd;
    if (r.value.parts.length === ranges.length || tries >= 2) return { cast: cleanCast(r.value.parts, ranges.length), usd };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The stage.

function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? "");
}

function requestFor(p: Project, ranges: Range[], i: number, cast: CastPart[], header: string, pics: string): string {
  const r = ranges[i]!;
  const words = p.narration!.words;
  const list = (c: Carry[]) => c.map((x) => `- ${x.id}: ${x.what}`).join("\n");
  const carry = i === 0 ? "Your part opens the video." : cast[i - 1]!.handoff.length ? `When your part begins, the part before has left these on screen. List them in your first state with the same ids, so the viewer sees them stay rather than being drawn again. Then move, change or remove them as your words need:\n${list(cast[i - 1]!.handoff)}` : "The part before yours leaves nothing you need, so start fresh.";
  const handoff = i === ranges.length - 1 ? "Your part ends the video." : cast[i]!.handoff.length ? `The next part picks these up, so have them on screen, with these ids, as your last word is spoken:\n${list(cast[i]!.handoff)}` : "The next part starts fresh, so end your part however suits your words.";
  const arc = cast.map((c, k) => `${k + 1}. words ${ranges[k]!.firstWord} to ${ranges[k]!.lastWord}${k === i ? " (yours)" : ""}: ${c.shows}`).join("\n");
  const plain = (a: number, b: number) => words.slice(a, b).map((w) => w.text).join(" ");
  const narration = `${plain(0, r.firstWord)}\n[your part starts]\n${plain(r.firstWord, r.lastWord + 1)}\n[your part ends]\n${plain(r.lastWord + 1, words.length)}`.trim();
  const body = fill(prompt("scene"), { first: String(r.firstWord), last: String(r.lastWord), prefix: `${r.id}_`, carry, handoff, arc, pictures: pics ? `\nPictures you can show with \`image id asset=NAME\`:\n${pics}\n` : "", narration });
  const spoken = words.slice(r.firstWord, r.lastWord + 1).map((w, k) => `${r.firstWord + k} ${w.start.toFixed(1)} ${w.text}`).join("\n");
  return `${header}${body}\nYour words (number, seconds, word):\n${spoken}`;
}

export async function scene(p: Project, force = false) {
  const words = p.narration!.words;
  const ranges = splitSections(words);
  // Where the director made shots with pictures, each section starts from its part of them.
  let draft: { source: string; assets: Record<string, string> } | undefined;
  if (p.shots?.length && p.assets?.length) {
    try {
      draft = shotsToScene(p);
    } catch (e) {
      console.log(`  !!! shotsToScene failed, so sections start from the picture list alone: ${(e as Error).message}`);
    }
  }
  const pics = pictures(p, draft?.assets);
  const header = [
    `Topic: ${topic(p)}`,
    p.plan?.intent ? `Why the viewer wants this: ${p.plan.intent}` : "",
    asked([...(p.plan?.story ?? []), ...(p.plan?.visuals ?? [])]),
  ].filter(Boolean).join("\n\n") + "\n\n";
  const prompts = ["scene", "scene-cast", "scene-look", "engine-language", "engine-repair"].map(prompt);
  const library = loadLibrary().map((x) => x.name);
  const inputs = [VERSION, words, p.script?.beats, p.plan, p.input.style, header, pics, draft?.source ?? "", prompts, kitKinds(), library];
  const estimate = 0.03 + ranges.length * 0.12;
  await stage(p, "scene", inputs, estimate, async () => {
    const root = join(dir(p), "scene");
    mkdirSync(root, { recursive: true });
    const spent = { usd: 0 };
    try {
      // The first pass, cached on its own so a resumed run plans the same hand-offs.
      const castKey = hash(VERSION, ranges, words.map((w) => w.text), header, describe(pics), prompt("scene-cast"));
      const castFile = join(root, "cast.json");
      let cast: CastPart[];
      const known = existsSync(castFile) ? JSON.parse(readFileSync(castFile, "utf8")) : undefined;
      if (!force && known?.key === castKey) cast = known.cast;
      else {
        const r = await planCast(p, ranges, header, describe(pics));
        spent.usd += r.usd;
        cast = r.cast;
        writeFileSync(castFile, JSON.stringify({ key: castKey, cast }, null, 1));
      }
      console.log(`  ${ranges.length} sections; carried: ${cast.map((c, i) => `${ranges[i]!.id}->[${c.handoff.map((x) => x.id).join(", ")}]`).join(" ")}`);

      const assets = Object.fromEntries(pics.map((x) => [x.name, x.path]));
      const loadable = Object.fromEntries(pics.map((x) => [x.name, dataUrl(join(dir(p), x.path), root)]));
      const opts = sceneBuildOptions(p, loadable);
      const system = languagePrompt(opts);
      const drafts = draft ? sliceSource(draft.source, ranges) : ranges.map(() => "");

      const sections: SceneSection[] = new Array(ranges.length);
      const notes: string[][] = ranges.map(() => []);
      let nextJob = 0;
      const worker = async () => {
        for (let i = nextJob++; i < ranges.length; i = nextJob++) {
          const range = ranges[i]!;
          const request = requestFor(p, ranges, i, cast, header, describe(pics));
          const carry = i ? cast[i - 1]!.handoff : [];
          const handoff = cast[i]!.handoff;
          const key = hash(VERSION, request, drafts[i], carry, handoff, system);
          const file = join(root, range.id, "section.json");
          const cached = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
          if (!force && cached?.key === key && cached.section.ok) {
            sections[i] = cached.section;
            console.log(`  ${range.id}: cached`);
            continue;
          }
          const folder = join(root, range.id);
          const job: Job = { p, range, next: ranges[i + 1], carry, handoff, system, request, opts, folder, log: (l) => console.log(l) };
          const w = await writeSection(job, drafts[i]!);
          spent.usd += w.usd;
          const ok = !w.problems.length && !!w.result.scene;
          sections[i] = { id: range.id, firstWord: range.firstWord, lastWord: range.lastWord, source: w.source, ok, rounds: w.rounds, usd: +w.usd.toFixed(4) };
          notes[i] = [...w.problems, ...w.warnings.map((x) => `hand-off: ${x}`), `looks: ${w.looks.join(", ") || "none"}`];
          mkdirSync(folder, { recursive: true });
          writeFileSync(join(folder, "scene.txt"), w.source);
          writeFileSync(file, JSON.stringify({ key, section: sections[i], notes: notes[i] }, null, 1));
          console.log(`  ${range.id}: ${ok ? "built" : "FAILED"} in ${w.rounds} rounds, looks ${w.looks.join(", ") || "none"}, $${w.usd.toFixed(3)}${w.warnings.length ? `, ${w.warnings.length} hand-off misses` : ""}`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, ranges.length) }, worker));

      p.scene = { sections, assets };
      const joined = joinScene(p.scene);
      writeFileSync(join(root, "scene.txt"), joined);
      const whole = await build(joined, opts);
      const failed = sections.filter((s) => !s.ok);
      charge(p, "scene", spent.usd, `${sections.length} sections, ${failed.length} failed, ${whole.stats.states} states`);
      spent.usd = 0;
      if (whole.problems.length) console.log(`  !!! the joined scene does not build:\n${formatProblems(whole.problems.slice(0, 10))}`);
      if (failed.length || whole.problems.length) {
        const lines = failed.map((s) => `  ${s.id} (words ${s.firstWord} to ${s.lastWord}): ${notes[sections.indexOf(s)]?.slice(0, 3).join(" | ") ?? "see its section.json"}`);
        throw new Error(`scene: ${failed.length ? `sections ${failed.map((s) => s.id).join(", ")} could not be repaired` : "the joined scene does not build"}. No lesser visual stands in for them.\n${lines.join("\n")}`);
      }
      console.log(`  joined scene: ${whole.stats.states} states, ${whole.stats.parts} parts, ${whole.stats.programs} programs`);
    } catch (e) {
      if (spent.usd) Object.assign(e as object, { usd: spent.usd });
      throw e;
    } finally {
      await closeRenderer();
    }
  }, force);
}
