// The scene step: the engine is the one visual step for every video. The narration is split into sections, a quick
// first pass plans what carries from one section into the next, then Spark writes every section at the same time in the
// scene language, with the video's own word numbers so the sections join into one document in order. Each section is
// built by the engine and repaired from its errors, then rendered to a few still frames that Spark looks at beside the
// words, and repaired again from what it sees; then the design brain's instruments read it and Spark reviews it with
// their readings beside the frames, and the writer repairs it from both (reviewRound). No fallback: a section that cannot be repaired is reported loudly.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DemoPhase, DirectionEvent, DirectionPlan, Project, SceneSection, ScenePlan } from "../../schemas/project.ts";
import { when } from "../../engine/core/compile.ts";
import { bundled } from "../../engine/render/bundle.ts";
import { evaluate } from "../../engine/core/evaluate.ts";
import type { CompileContext, Kit, Resolved, Scene, Theme } from "../../engine/core/types.ts";
import { KITS } from "../../engine/kits/index.ts";
import { mathKit } from "../../engine/kits/math.ts";
import { STEPS_DOC, truthSteps } from "../../engine/kits/steps.ts";
import { spokenNotShown, type PhaseSpan } from "../lib/demo.ts";
import { languagePrompt, numbered, reviewText, truthKinds } from "../../engine/language/author.ts";
import { build, formatProblems, measureLines, type BuildOptions, type BuildResult } from "../../engine/language/build.ts";
import { expandHolds, holdMoments, type HoldTime } from "../../engine/language/holds.ts";
import { loadLibrary } from "../../engine/language/library.ts";
import { fontMeasure } from "../../engine/language/measure.ts";
import { parse, vocabulary, type Item, type State } from "../../engine/language/syntax.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import { better, decode, hide, inventory, issuesFrom, judgeSchema, keptAt, lookFrames, measureLayout, measurePixels, merge, readOf, recheckSchema, weight, wordsOnScreen, type Finding, type Issue, type Judged, type Moment, type Rechecked } from "../lib/look.ts";
import { json, text } from "../lib/meta.ts";
import { asked, charge, checkBudget, dir, prompt, stage, style, topic } from "../lib/project.ts";
import { shotsToScene } from "../lib/shots-scene.ts";
import { hash } from "../lib/util.ts";
import { designRunner, type DesignInputs } from "../lib/design-run.ts";
import { checkPlan, INTENT_GUIDE, intentRepair, intentSystem, materialText, stripFence } from "../lib/intent-author.ts";
import { metaReasoner } from "../lib/reasoner-meta.ts";
import { frameReadings, partNotes, type PartNotes } from "../lib/instrument-notes.ts";
import { readProject, type MaterialFile } from "../../engine/design/material/index.ts";
import { suggestViewing, viewingFrom } from "../../engine/design/suggest.ts";
import type { PartCard, Reasoner, Viewing } from "../../engine/design/types.ts";
import { basename } from "node:path";
import { emptyToolbox, prepareToolbox, toolboxKit, toolboxNotes, type Toolbox, type ToolboxMakers } from "../../engine/language/toolbox.ts";
import { lookSchema } from "./direction.ts";
import { metaDepictMakers, spriteStyle } from "../lib/depict-makers.ts";
import { mend, unwrap } from "../lib/mend.ts";
import { imageFile, tasteNotes, tasteReview, type TasteContext, type TasteVerdict } from "../../engine/review/taste.ts";
import type { Ask } from "../../engine/review/model.ts";

const VERSION = 6; // bump when the way sections are written or checked changes, so cached sections are redone
const CHECKS = 8; // bump when the engine checks a built scene differently: the stage joins and checks again, sections stay cached
const FPS = 30;
const [WIDTH, HEIGHT] = [1080, 1920];
export const SIZE = { target: 55, max: 85, min: 20 }; // words per section: about 15 to 30 seconds of speech
export const BUILD_ROUNDS = 4;
const LOOK_ROUNDS = 2;
const LOOK_FRAMES = 10; // each state settled, and changes while they happen
const LOOK_SCALE = 0.6; // frames Spark sees: 648 by 1152, near full size
const PARALLEL = 6;
export const MAX_PROBLEMS = 25;
const JOIN_ROUNDS = 2; // repairs of the parts a joined scene that does not build names
export const REVIEW_ROUNDS = 2; // repairs from the instruments and a reviewer, after the look

export type Range = { id: string; firstWord: number; lastWord: number };
// A thing one section hands to the next: what it is, the ids of its pieces (so they stay the same things on screen rather
// than being drawn again), and how the next section builds on it.
export type Carry = { id: string; what: string; parts?: string[]; use?: string };
export type CastPart = { shows: string; handoff: Carry[] };
type Spoken = { text: string; start: number; beatId?: string };
type Span = { id: string; firstWord: number; lastWord: number; demo?: unknown };

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

// Sections follow the script's beats, or the direction's events when there are some, so a section ends where the viewer
// feels one thing end: whole runs are grouped to about `target` words, a run longer than `max` is split at its
// sentences, and a short tail joins the section before it. An event with a demonstration may run half as long again
// before it is split, so one author plays it through.
export function splitSections(words: Spoken[], size = SIZE, events: Span[] = []): Range[] {
  const owner = words.map((_, i) => events.find((e) => i >= e.firstWord && i <= e.lastWord));
  const key = (i: number) => owner[i]?.id ?? `beat ${words[i]!.beatId}`;
  const runs: [number, number][] = [];
  for (let i = 0; i < words.length; i++) {
    const last = runs.at(-1);
    if (last && key(i) === key(last[1])) last[1] = i;
    else runs.push([i, i]);
  }
  const pieces = runs.flatMap(([a, b]) => splitRun(words, a, b, owner[a]?.demo ? Math.round(size.max * 1.5) : size.max));
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
    const at = /^@(\d+|[A-Za-z]\w*)/.exec(t);
    if (at) {
      // A hold moment (@h2) sits in the stretch of the word before it; its number is known once holds are expanded.
      const word = /^\d+$/.test(at[1]!) ? Number(at[1]) : (out.states.at(-1)?.word ?? 0);
      out.states.push({ word, text: [...pending, line].join("\n") });
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
  return joinWithSpans(sections).text;
}

// The joined document with the lines each section's states fill in it, so a problem in the whole goes back to its part.
export function joinWithSpans(sections: { id: string; firstWord: number; source: string }[]): { text: string; spans: { id: string; from: number; to: number }[] } {
  let bg: string | undefined;
  const programs = new Map<string, string>();
  const bodies: { id: string; body: string }[] = [];
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
    bodies.push({ id: s.id, body });
  }
  const head = [...(bg ? [`bg ${bg}`] : []), ...programs.values()];
  let line = head.length ? head.join("\n\n").split("\n").length + 2 : 1;
  const spans = bodies.map(({ id, body }) => {
    const span = { id, from: line, to: line + body.split("\n").length - 1 };
    line = span.to + 2;
    return span;
  });
  return { text: [...head, ...bodies.map((b) => b.body)].join("\n\n") + "\n", spans };
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
  for (const c of carry) {
    if (!shown.has(c.id)) out.push(`line ${first.line}: the part before yours leaves ${c.id} (${c.what}) on screen. If your first words build on it, list it in your first state with the id ${c.id}, so it stays rather than being drawn again; if they do not, it leaves as your part begins.`);
    else if (c.parts?.length) {
      const missing = c.parts.filter((x) => !shown.has(x));
      if (missing.length) out.push(`line ${first.line}: you keep ${c.id}, but not its pieces ${missing.join(", ")}, so the viewer sees them drawn again. Give its pieces the ids ${c.parts.join(", ")}, as the part before yours does.`);
    }
  }
  return out;
}

// Whether a contract line is about a carried thing the part left out, which is the writer's call, not a mistake.
const leftOut = (x: string) => x.includes("the part before yours leaves");

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
  return handoff.flatMap((c) => {
    if (!visible(c.id)) return [`The next part picks up ${c.id} (${c.what}), but it is not on screen when your last word, ${range.lastWord}, is spoken. Have it on screen with that id by then.`];
    const missing = (c.parts ?? []).filter((x) => !visible(x));
    return missing.length ? [`The next part picks up ${c.id} with its pieces ${c.parts!.join(", ")}, but ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not on screen with ${missing.length > 1 ? "those ids" : "that id"} as your last word is spoken. Give its pieces those ids.`] : [];
  });
}

// Things that stay over full-frame pictures through picture after picture: a heading or list left on top stops being
// read and hides the pictures. Measured on the built scene, so it sees what the viewer sees. Feedback, not a rule.
export function overPictures(source: string, scene: Scene, from: number, to: number, kitKinds: string[] = [], fps = FPS): string[] {
  const { doc } = parse(source, kitKinds);
  const fills = new Set<string>();
  const tops = new Map<string, number>();
  const walk = (items: Item[], top: boolean) => {
    for (const i of items) {
      if (i.attrs.frame === "fill" && i.kind === "image") fills.add(i.id);
      else if (i.attrs.frame === "fill") continue; // a field of color behind everything is a backdrop, not something on top
      else if (top && i.kind !== "image" && i.kind !== "space" && !tops.has(i.id)) tops.set(i.id, i.line);
      walk(i.children, false);
    }
  };
  for (const s of doc.states) walk(s.items, true);
  if (!fills.size || !tops.size) return [];
  const step = Math.max(1, Math.round(fps / 2));
  const over = new Map<string, { frames: number; pictures: Set<string> }>();
  for (let f = from; f <= to; f += step) {
    const seen = visibleAt(scene, f);
    const pics = [...fills].filter((id) => seen.has(id));
    if (!pics.length) continue;
    for (const id of tops.keys()) {
      if (!seen.has(id) && ![...seen].some((v) => v.startsWith(`${id}.`))) continue;
      const o = over.get(id) ?? { frames: 0, pictures: new Set<string>() };
      o.frames += step;
      pics.forEach((x) => o.pictures.add(x));
      over.set(id, o);
    }
  }
  return [...over].filter(([, o]) => o.pictures.size >= 2 && o.frames / fps >= 6).map(([id, o]) => `${id} (line ${tops.get(id)}) stays over the full-frame pictures for ${Math.round(o.frames / fps)} s, across ${[...o.pictures].join(", ")}. Over a picture that fills the frame, the picture is the subject. If the words are no longer about ${id}, drop it when the picture changes, or bring it back when they return to it.`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Building: the same context and options for checking a section, the whole scene, and the player.

// Real math typesetting joins the scene's kits here, with the guide line a writer needs, so a formula is set for real
// rather than typed as characters. Its part behaviors work through `do` now that kits expand in compile's context.
const mathFormulas: Kit = {
  name: "math",
  kinds: mathKit.kinds,
  behaviors: mathKit.behaviors,
  docs: {
    math: "`math f latex=\"\\bar{x} = \\frac{1}{n}\\sum x_i\"` real typeset math from LaTeX, as in a good textbook: fractions, roots that reach over what they cover, bars and hats, sums, powers and indices, matrices. Write each backslash once. Every symbol is its own part, and the whole formula can be lit, tagged, ringed, marked and moved like any thing. Give it a role, as words take (role=answer for a result), and it takes that role's color and the style's hand. To change a formula, repeat its line with the same id and new latex, and it changes in place. For a derivation, give `states=[\"...\",\"...\"]` and step through them with `do become f state=N`: symbols that stay travel to their new places",
    become: "`do become f state=1 frames=20`: a formula with `states=` moves to that state; matching symbols travel, the rest appear or fade",
    each: "`do each f part=frac.0.num color=accent stagger=4`: recolor, fade (opacity=) or nudge (dx= dy=) every symbol of a named part at once. Parts: word.N, line.N, frac.N.num, frac.N.den, matrix.N.row.R, matrix.N.col.C, char.X",
    swell: "`do swell f part=matrix.0.col.1 size=1.2`: a set of symbols swells and settles together, to point at it",
  },
};
export const SCENE_KITS: Kit[] = [...KITS, mathFormulas];

export function sceneContext(p: Project, theme: Theme = themeFrom(p.input.style)): CompileContext {
  const words = p.narration!.words.map((w) => ({ text: w.text, start: w.start }));
  const [width, height] = p.input.frame ?? [WIDTH, HEIGHT];
  return { fps: FPS, width, height, frames: Math.ceil((p.narration!.seconds + 0.5) * FPS), theme, words, kits: usesToolbox(p) ? [...SCENE_KITS, toolboxKit(toolboxOf(p))] : SCENE_KITS };
}

// Path A: the writer keeps writing whole scenes, and the language also offers the design brain's abilities (depicted
// things, staging, the motion vocabulary with the style's leanings, the director's look) and a review round of
// instruments and stills. The depictions a project's scenes asked for are kept in scene/toolbox.json, so every build of
// its scene (the stage, the join, the timeline, the scripts) draws the same things.
export const usesToolbox = (p: Project) => (p.input.sceneAuthor ?? SCENE_AUTHOR_DEFAULT) === "toolbox";
const TOOLBOXES = new Map<string, Toolbox>();
const toolboxFile = (p: Project) => join(dir(p), "scene", "toolbox.json");
export function toolboxOf(p: Project): Toolbox {
  const file = toolboxFile(p);
  let box = TOOLBOXES.get(file);
  if (!box) {
    box = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Toolbox) : emptyToolbox();
    TOOLBOXES.set(file, box);
  }
  return box;
}
export function saveToolbox(p: Project) {
  mkdirSync(join(dir(p), "scene"), { recursive: true });
  writeFileSync(toolboxFile(p), JSON.stringify(toolboxOf(p), null, 1));
}

// Build options for this project's scene. `assets` maps asset names to an image source the renderer can load.
// Words are measured in the style's real fonts, so what is laid out is what the renderer draws.
export function sceneBuildOptions(p: Project, assets: Record<string, string> = {}): BuildOptions {
  const ctx = sceneContext(p);
  return { ctx, words: p.narration!.words.map((w) => w.text), assets, library: loadLibrary(), seed: 11, measure: fontMeasure(ctx.theme), holds: holdsOf(p) };
}

// The silences the voice left, as the language reads them.
export const holdsOf = (p: Project): HoldTime[] => (p.narration?.holds ?? []).map((h) => ({ id: h.id, afterWord: h.afterWord, start: h.start, seconds: h.seconds }));

// A section with its hold moments written as word moments, which is how it is stored, joined and read by later steps.
export function plainMoments(source: string, opts: BuildOptions): string {
  return expandHolds(source, holdMoments(opts.holds, opts.ctx)).source;
}

// The sections of this video: by the direction's events when there is a direction, else by the script's beats.
export const sectionsOf = (p: Project): Range[] => splitSections(p.narration!.words, SIZE, p.direction?.events ?? []);

// The whole scene document, ready for `build()`: the parts written in the scene language. Parts the design brain
// composed are compiled scenes, joined by `wholeScene`.
export const joinScene = (plan: ScenePlan) => joinSections(plan.sections.filter((s) => s.author !== "intent"));

// Who writes the scene when neither the call nor the project says: the scene language, until the intent path is chosen.
export const SCENE_AUTHOR_DEFAULT: "language" | "intent" = "language";

// ---------------------------------------------------------------------------------------------------------------------
// The whole scene: the language parts built as one document, and each composed part shown only in its own window.

type Window = { from: number; to: number };

// Opacity keys that are `inside` in the windows and `outside` elsewhere, changing in one frame at each edge.
export function windowKeys(windows: Window[], inside: number, outside: number): { at: number; value: number }[] {
  // Windows that touch or overlap are one window, so nothing flickers where one part hands over to the next.
  const merged: Window[] = [];
  for (const w of [...windows].filter((x) => x.to > x.from).sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1);
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to);
    else merged.push({ ...w });
  }
  const keys = [{ at: 0, value: merged[0] && merged[0].from <= 0 ? inside : outside }];
  for (const w of merged) {
    if (w.from > 0) keys.push({ at: w.from - 1, value: outside }, { at: w.from, value: inside });
    keys.push({ at: w.to - 1, value: inside }, { at: w.to, value: outside });
  }
  return keys.filter((k, i) => i === 0 || k.at > keys[i - 1]!.at);
}

// A compiled scene under a new root group, with every id prefixed so it cannot clash with another part's.
function prefixed(scene: Scene, root: string): Pick<Scene, "nodes" | "tracks" | "events"> {
  const id = (x: string) => `${root}${x}`;
  const nodes = scene.nodes.map((n) => ({ ...n, id: id(n.id), parent: n.parent === undefined ? root : id(n.parent), props: typeof n.props.mask === "string" && n.props.mask ? { ...n.props, mask: id(n.props.mask) } : n.props }));
  const tracks = scene.tracks.map((t) => ({ ...t, target: id(t.target), ...(t.prop === "mask" ? { keys: t.keys.map((k) => (typeof k.value === "string" && k.value ? { ...k, value: id(k.value) } : k)) } : {}) }));
  return { nodes, tracks, events: scene.events };
}

/** The language scene with each composed part laid over it: a composed part shows only from its first word until the
 * next part begins, and the language parts are hidden while it shows. */
export function gateScenes(base: Scene, parts: { id: string; scene: Scene; from: number; to: number }[]): Scene {
  if (!parts.length) return base;
  const windows = parts.map((x) => ({ from: Math.max(0, x.from), to: Math.min(base.frames, x.to) })).filter((w) => w.to > w.from);
  const BASE = "language__";
  const nodes: Scene["nodes"] = [{ id: BASE, kind: "group", props: { opacity: 1 } }, ...base.nodes.map((n) => (n.parent === undefined ? { ...n, parent: BASE } : n))];
  const tracks: Scene["tracks"] = [...base.tracks, { target: BASE, prop: "opacity", keys: windowKeys(windows, 0, 1) }];
  const events = [...base.events];
  const held = [...(base.held ?? [])];
  for (const x of parts) {
    const root = `${x.id}__`;
    const w = { from: Math.max(0, x.from), to: Math.min(base.frames, x.to) };
    const inner = prefixed(x.scene, root);
    nodes.push({ id: root, kind: "group", props: { opacity: 0 } }, ...inner.nodes);
    tracks.push(...inner.tracks, { target: root, prop: "opacity", keys: windowKeys([w], 1, 0) });
    events.push(...inner.events.filter((e) => e.at === undefined || (e.at >= w.from && e.at < w.to)));
    held.push(...(x.scene.held ?? []).filter((h) => h.to > w.from && h.from < w.to).map((h) => ({ ...h, from: Math.max(h.from, w.from), to: Math.min(h.to, w.to) })));
  }
  return { ...base, nodes, tracks, events, ...(held.length ? { held } : {}) };
}

// Image sources in a compiled scene, changed one by one.
export function mapSources(scene: Scene, fn: (src: string) => string): Scene {
  const nodes = scene.nodes.map((n) => (n.kind === "image" && typeof n.props.src === "string" ? { ...n, props: { ...n.props, src: fn(n.props.src) } } : n));
  const tracks = scene.tracks.map((t) => (t.prop === "src" ? { ...t, keys: t.keys.map((k) => (typeof k.value === "string" ? { ...k, value: fn(k.value) } : k)) } : t));
  return { ...scene, nodes, tracks };
}

/** The whole video's scene for `frames` frames. `assets` maps asset names to sources the renderer loads (the project
 * paths for the player, data URLs for stills); composed parts are stored with project paths and mapped the same way. */
export async function wholeScene(p: Project, assets: Record<string, string>, frames: number): Promise<{ scene?: Scene; problems: { line: number; message: string }[]; source: string }> {
  const plan = p.scene!;
  const opts = sceneBuildOptions(p, assets);
  const ctx = { ...opts.ctx, frames };
  const source = joinScene(plan);
  const composed = plan.sections.filter((s) => s.author === "intent");
  const byPath = new Map(Object.entries(plan.assets).map(([name, path]) => [path, assets[name] ?? path]));
  const parts = composed.map((s) => {
    if (!s.design) throw new Error(`scene: part ${s.id} was composed but names no scene file`);
    const scene = mapSources(JSON.parse(readFileSync(join(dir(p), s.design.file), "utf8")) as Scene, (src) => byPath.get(src) ?? src);
    const order = [...plan.sections].sort((a, b) => a.firstWord - b.firstWord);
    const next = order[order.indexOf(s) + 1];
    return { id: s.id, scene, from: when({ word: s.firstWord }, ctx), to: next ? when({ word: next.firstWord }, ctx) : frames };
  });
  let base: Scene;
  if (plan.sections.length > composed.length) {
    const r = await build(source, { ...opts, ctx });
    if (!r.scene) return { problems: r.problems, source };
    base = r.scene;
  } else base = { fps: ctx.fps, width: ctx.width, height: ctx.height, frames, background: parts[0]?.scene.background ?? "#ffffff", nodes: [], tracks: [], events: [] };
  return { scene: gateScenes(base, parts), problems: [], source };
}

export const kitKinds = () => [...SCENE_KITS.flatMap((k) => Object.keys(k.kinds ?? {})).filter((k) => k !== "graph"), "depict"];

// ---------------------------------------------------------------------------------------------------------------------
// Pictures: the director's images, offered to Spark by name.

export type Picture = { name: string; path: string; size?: [number, number]; about: string; words?: [number, number] };

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

export const describe = (list: Picture[]) => list.map((x) => `- ${x.name}${x.size ? `, ${x.size[0]} by ${x.size[1]}` : ""}: ${x.about}${x.words ? ` (the director planned it for words ${x.words[0]} to ${x.words[1]})` : ""}`).join("\n");

// Shots the director chose to have drawn rather than shown as a picture (no honest picture exists, or a drawing
// explains better). The scene draws them at their words with the engine, from facts in the narration only.
function drawings(p: Project): string {
  const words = p.narration?.words ?? [];
  const lines = (p.assets ?? []).filter((a) => a.draw).map((a) => {
    const shot = p.shots?.find((s) => s.id === a.shotId);
    const first = shot ? words.findIndex((w) => w.start >= shot.start - 0.01) : -1;
    const last = shot ? words.findLastIndex((w) => w.start < shot.end) : -1;
    return `- ${first >= 0 && last >= first ? `words ${first} to ${last}` : "somewhere fitting"}: ${a.draw}`;
  });
  return lines.length ? `\n\nThe director asked for these to be drawn by you with the engine, not shown as pictures, using only facts the narration gives:\n${lines.join("\n")}` : "";
}


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
    const { openBrowser } = await import("@remotion/renderer");
    const serveUrl = await bundled(join(process.cwd(), "engine/render/preview.tsx"));
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

export type Job = {
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
  review?: boolean; // false: no review round after the look (reviewRound)
  once?: boolean; // one repair round: write, build, look once, one repair with every note (writeOnce)
  taste?: Ask; // the taste review's model calls (Spark when not given); tests pass a fake
  // Path A: what prepares the depictions a part asks for before each build, and the toolbox they are kept in.
  toolbox?: { box: Toolbox; makers: ToolboxMakers; inflight: Map<string, Promise<void>>; save: () => void };
};
export type Written = { source: string; result: BuildResult; problems: string[]; warnings: string[]; usd: number; rounds: number };

const endFrame = (job: Job) => (job.next ? when({ word: job.next.firstWord }, job.opts.ctx) - 2 : job.opts.ctx.frames - 1);

export type Checked = { result: BuildResult; problems: string[]; warnings: string[]; notes: string[] };

export async function check(job: Job, written: string): Promise<Checked> {
  const kinds = kitKinds();
  // Depicted things are drawn from the depicter's answers, so they are prepared before the part is built; what could
  // not be prepared goes back to the writer with the build's own problems.
  const unmade = job.toolbox ? (await prepareToolbox(plainMoments(written, job.opts), kinds, job.toolbox.box, job.toolbox.makers, job.toolbox.inflight)).problems : [];
  if (job.toolbox) job.toolbox.save();
  const result = await build(written, job.opts);
  const source = plainMoments(written, job.opts);
  const built = result.problems.map((p) => (p.line ? `line ${p.line}: ${p.message}` : p.message));
  const shape = contract(source, job.range, job.carry, kinds);
  // Ranges and plain first states keep the join sound, so they must be fixed. What the next part was promised goes back
  // for repair too, but a part that still misses it is reported, not failed. Leaving out a carried thing is the
  // writer's call (its words may have moved on), so it is only recorded.
  const handoff = result.scene ? handedOver(source, result.scene, endFrame(job), job.handoff, job.range, kinds) : [];
  const carry = shape.filter((x) => !leftOut(x) && x.includes("you keep"));
  // What the direction asks of this stretch that code can check: withheld things declared, and a demonstration of
  // computed steps played by the thing that computes them. Both go back for repair; a part that still misses a
  // demonstration is reported rather than failed, as a hand-off is.
  const direction = directed(source, job.p, job.range, kinds);
  return { result, problems: [...unmade, ...built, ...shape.filter((x) => !leftOut(x) && !carry.includes(x)), ...direction.withholds, ...direction.truth], warnings: [...carry, ...handoff, ...direction.demos], notes: [...shape.filter(leftOut), ...needs(written)] };
}

// Lines a writer leaves when a hold is too short for what the direction asks of it: `# needs h2 6s: why`. They go to
// the section's notes, for the direction to lengthen the hold.
export const needs = (source: string): string[] => [...source.matchAll(/^\s*#\s*needs\s+([A-Za-z]\w*)\s+([\d.]+)\s*s\b:?\s*(.*)$/gm)].map((m) => `hold ${m[1]} too short: needs ${m[2]} s${m[3] ? `, ${m[3].trim()}` : ""}`);

// Events of the direction that share words with a range.
const eventsIn = (p: Project, range: Range): DirectionEvent[] => (p.direction?.events ?? []).filter((e) => e.lastWord >= range.firstWord && e.firstWord <= range.lastWord);

// Withholds whose stretch (from the event that sets it to the event it waits for) overlaps a range, with the word the
// thing may appear from.
export function withholdsIn(p: Project, range: Range): { event: DirectionEvent; what: string; until: string; word: number }[] {
  const events = p.direction?.events ?? [];
  return events.flatMap((e) => {
    if (!e.withhold) return [];
    const word = events.find((x) => x.id === e.withhold!.until)?.firstWord ?? (p.narration?.words.length ?? 0);
    return e.firstWord <= range.lastWord && word > range.firstWord ? [{ event: e, what: e.withhold.what, until: e.withhold.until, word }] : [];
  });
}

// The computed things the direction demonstrates, each one thing for the whole video with one id and one input. For a
// range: the line that makes it, how many of its steps are done as the range begins, and exactly the steps it plays.
// Parts are written at the same time, so this is how each knows where the demonstration stands.
export type TruthPart = { id: string; kind: string; line: string; steps: string[]; total: number; done: number; plays: { from: number; to: number; pace: string; event: string }[] };
const setting = (k: string, v: unknown) => `${k}=${typeof v === "string" ? (/\s/.test(v) ? JSON.stringify(v) : v) : JSON.stringify(v)}`;
export function truthPlan(p: Project, range: Range): TruthPart[] {
  const events = p.direction?.events ?? [];
  const holdWord = new Map(events.flatMap((e) => (e.holds ?? []).map((h) => [h.id, h.afterWord] as const)));
  const startOf = (ph: DemoPhase, e: DirectionEvent) => ("word" in ph.at ? ph.at.word : holdWord.get(ph.at.hold) ?? e.firstWord);
  const things = new Map<string, TruthPart & { phases: { from: number; to: number; pace: string; event: string; word: number }[] }>();
  for (const e of events) {
    const t = e.demo?.truth;
    if (!t) continue;
    const key = `${t.kind} ${JSON.stringify(t.data)}`;
    if (!things.has(key)) {
      const id = `demo${things.size + 1}`;
      things.set(key, { id, kind: t.kind, line: `${t.kind} ${id} ${Object.entries(t.data).map(([k, v]) => setting(k, v)).join(" ")}`, steps: t.steps, total: t.steps.length, done: 0, plays: [], phases: [] });
    }
    for (const ph of e.demo!.phases) if (ph.steps) things.get(key)!.phases.push({ from: ph.steps[0], to: ph.steps[1], pace: ph.pace, event: e.id, word: startOf(ph, e) });
  }
  return [...things.values()].map(({ phases, ...t }) => ({
    ...t,
    // Where it stands as the range begins: after the steps played before it, or, in a video that opens partway through
    // a process, just before the first step any phase plays.
    done: Math.max(0, phases.length ? Math.min(...phases.map((ph) => ph.from)) - 1 : 0, ...phases.filter((ph) => ph.word < range.firstWord).map((ph) => ph.to)),
    plays: phases.filter((ph) => ph.word >= range.firstWord && ph.word <= range.lastWord).map(({ word: _w, ...ph }) => ph),
  }));
}

// Checks a part's computed things against the truth plan: the very same thing, standing where the parts before left it,
// playing exactly its own steps. A demonstration split across parts written at once only joins when each part does.
export function truthChecked(doc: ReturnType<typeof parse>["doc"], plan: TruthPart[]): string[] {
  const out: string[] = [];
  const items = new Map<string, Item>();
  const index = (list: Item[]) => list.forEach((i) => (items.has(i.id) || items.set(i.id, i), index(i.children)));
  doc.states.forEach((st) => index(st.items));
  const OWN = new Set(["at", "into", "before", "after", "done", "w", "h", "role", "follow", "enter"]);
  const input = (attrs: Record<string, string>) => Object.entries(attrs).filter(([k]) => !OWN.has(k)).map(([k, v]) => `${k}=${v}`).sort().join(" ");
  for (const t of plan) {
    const wanted = `${t.line}${t.done ? ` done=${t.done}` : ""}`;
    const expected = input(Object.fromEntries(t.line.split(/\s+/).slice(2).map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1).replace(/^"(.*)"$/, "$1")])));
    const item = items.get(t.id);
    const others = [...items.values()].filter((i) => i.kind === t.kind && i.id !== t.id && input(i.attrs) === expected);
    for (const o of others) out.push(`line ${o.line}: ${o.id} is the computed thing the direction demonstrates, which is ${t.id} in every part of the video. Write it as \`${wanted}\`.`);
    const plays = doc.states.flatMap((st) => st.commands.flatMap((c) => (c.do === "play" && c.behavior === "steps" && c.targets.includes(t.id) ? [{ line: c.line, from: Number(c.attrs.from ?? 1), to: Number(c.attrs.to ?? t.total) }] : [])));
    const mine = t.plays.map((x) => `${x.from} to ${x.to} (${x.pace}, event ${x.event})`).join(", ");
    if (!item) {
      if (t.plays.length) out.push(`The direction plays steps ${mine} of ${t.id} in your part, but your part does not show it. Make it as \`${wanted}\` and play those steps with \`do steps ${t.id}\`.`);
      continue;
    }
    if (input(item.attrs) !== expected) out.push(`line ${item.line}: ${t.id} must be the very thing the other parts show, made with exactly \`${wanted}\` (you may add a place, a size, a role); other settings would make a different computation.`);
    if (Number(item.attrs.done ?? 0) !== t.done) out.push(`line ${item.line}: as your part begins, ${t.id} stands after step ${t.done}, which the parts before yours played. Write done=${t.done} on it${t.done ? "" : " or leave done= out"}, so it shows that state from your first frame.`);
    const want = new Set(t.plays.flatMap((x) => Array.from({ length: x.to - x.from + 1 }, (_, k) => x.from + k)));
    const got = new Set(plays.flatMap((x) => Array.from({ length: Math.max(0, x.to - x.from + 1) }, (_, k) => x.from + k)));
    const extra = [...got].filter((k) => !want.has(k));
    const missing = [...want].filter((k) => !got.has(k));
    if (extra.length || missing.length) out.push(`${plays.length ? `line ${plays[0]!.line}: ` : ""}your part must play exactly ${t.plays.length ? `steps ${mine}` : `no steps of ${t.id} (the parts around yours play them)`} of ${t.id}, one \`do steps ${t.id} from= to=\` per phase.${extra.length ? ` It plays ${extra.join(", ")}, which another part plays.` : ""}${missing.length ? ` It leaves out ${missing.join(", ")}.` : ""}`);
  }
  return out;
}

// Checks a part against its direction, from its source alone.
export function directed(source: string, p: Project, range: Range, kitKindList: string[] = kitKinds()): { withholds: string[]; demos: string[]; truth: string[] } {
  if (!p.direction?.events?.length) return { withholds: [], demos: [], truth: [] };
  const { doc } = parse(source, kitKindList);
  const withholds = withholdsIn(p, range).flatMap((w) => doc.withholds.some((d) => d.until.word >= w.word) ? [] : [`The direction withholds ${w.what} until event ${w.until}, at word ${w.word}, and your part comes before it. Name the ids in your part that show it with \`withhold IDS until=@${w.word}\`, so the engine keeps them off screen until then; if nothing in your part shows it, write \`withhold none until=@${w.word}\`.`]);
  const truth = new Set(truthKinds(SCENE_KITS));
  const kinds = new Map<string, string>();
  const index = (items: Item[]) => items.forEach((i) => (kinds.set(i.id, i.kind), index(i.children)));
  doc.states.forEach((s) => index(s.items));
  const played = doc.states.some((s) => s.commands.some((c) => c.do === "play" && c.behavior === "steps" && c.targets.some((t) => truth.has(kinds.get(t) ?? ""))));
  const demos = eventsIn(p, range).flatMap((e) => (e.demo?.phases.some((ph) => ph.steps) && !played ? [`The direction demonstrates ${e.demo.what} in event ${e.id} as phases of computed steps, but your part plays no steps of a truth thing. Show it with the kit that computes it (${[...truth].map((k) => `\`${k}\``).join(", ")}) and one \`do steps\` per phase, so every step and every label is right; draw it by hand only if no kit computes what the words describe.`] : []));
  return { withholds, demos, truth: truthChecked(doc, truthPlan(p, range)) };
}

// What code can see about a built part beyond errors: computed steps to bind, and craft notes the writer weighs.
export function review(job: Job, written: string, result: BuildResult): string {
  const kinds = kitKinds();
  const source = plainMoments(written, job.opts);
  const from = when({ word: job.range.firstWord }, job.opts.ctx);
  const extra = result.scene ? overPictures(source, result.scene, from, endFrame(job), kinds) : [];
  // What each depicted thing can do, so the writer can use its states, verbs and parts.
  const things = job.toolbox ? toolboxNotes(source, kinds, job.toolbox.box, job.opts.ctx.theme) : [];
  // What the part's programs measured against what they claim to prove: numbers for the writer to read, never a verdict.
  const measures = measureLines(result, job.opts.ctx.fps);
  return reviewText(source, result, { kitKinds: kinds, truthKinds: truthKinds(SCENE_KITS), math: kinds.includes("math"), extra: [...extra, ...things.map((x) => `Depicted: ${x}`), ...measures] });
}

// What goes back to the writer: a part with build problems, and a part that builds with what code can see about it.
export const repairRequest = (job: Job, src: string, list: string[]) => `${job.request}\n\nYour part, with line numbers added for reference. Do not include the numbers:\n${numbered(src)}\n\n${prompt("engine-repair")}\nProblems:\n${list.slice(0, MAX_PROBLEMS).join("\n")}`;
export const reviewRequest = (job: Job, src: string, said: string) => `${job.request}\n\nYour part builds. Here it is, with line numbers added for reference. Do not include the numbers:\n${numbered(src)}\n\n${said}`;

async function compose(job: Job, start: string | undefined, prior: string, reviewed = start === undefined): Promise<Written> {
  let usd = 0;
  let source = start ?? "";
  let next = prior;
  let last: Checked | undefined;
  let round = 0;
  const ask = async (user: string, what: string): Promise<string | undefined> => {
    try {
      const r = await text({ system: job.system, user, effort: "medium", maxOutput: 32000 });
      usd += r.usd;
      return r.value;
    } catch (e) {
      usd += (e as { usd?: number }).usd ?? 0;
      job.log(`    ${job.range.id} ${what}: the model failed: ${(e as Error).message.slice(0, 160)}`);
      return undefined;
    }
  };
  const repair = (src: string, list: string[]) => repairRequest(job, src, list);
  for (round = 1; round <= BUILD_ROUNDS; round++) {
    if (round > 1 || start === undefined) {
      const reply = await ask(next, `round ${round}`);
      if (reply === undefined) continue;
      source = reply;
    }
    last = await check(job, source);
    const all = [...last.problems, ...last.warnings];
    job.log(`    ${job.range.id} round ${round}: ${last.result.stats.states} states, ${last.result.stats.programs} programs, ${last.problems.length} problems, ${last.warnings.length} hand-off misses`);
    for (const x of all.slice(0, 4)) job.log(`      ${x.slice(0, 180)}`);
    if (!all.length) break;
    if (!last.problems.length && round >= 2) break; // builds and is sound; a hand-off still missed after a repair is reported
    next = repair(source, all);
  }
  // Once the part builds, what code can see about it goes back once: the steps truth things computed, to tie each to the
  // right words, and craft notes to weigh. A reviewed version that breaks is repaired once; it replaces the built one
  // only when it is sound.
  const said = last && !last.problems.length && reviewed ? review(job, source, last.result) : "";
  if (said && last) {
    let src = await ask(reviewRequest(job, source, said), "review");
    let seen = src === undefined ? undefined : await check(job, src);
    if (src !== undefined && seen?.problems.length) {
      src = await ask(repair(src, [...seen.problems, ...seen.warnings]), "review repair");
      seen = src === undefined ? undefined : await check(job, src);
    }
    job.log(`    ${job.range.id} reviewed: ${seen ? `${seen.problems.length} problems, ${seen.warnings.length} hand-off misses` : "no answer"}`);
    if (src !== undefined && seen && !seen.problems.length && seen.warnings.length <= last.warnings.length) [source, last] = [src, seen];
  }
  return { source, result: last?.result ?? { problems: [], stats: { states: 0, parts: 0, programs: 0, programMs: 0 } }, problems: last ? last.problems : ["the model never answered"], warnings: last ? [...last.warnings, ...last.notes] : [], usd, rounds: Math.min(round, BUILD_ROUNDS) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The look step (pipeline/lib/look.ts): frames of each state settled and changing, rendered near full size, measured by
// the engine, and judged by Spark with the words, the exact on-screen text and the research facts. A fix changes only
// what was named, the changed version is kept only if it measures and looks better, and then the look stops.

export type Seen = { moments: Moment[]; files: string[]; measured: { frame: number; findings: Finding[]; words: string[] }[] };

const lookPart = (name: "Judge" | "Fix" | "Recheck") => (prompt("scene-look").split(/^# /m).find((x) => x.startsWith(name)) ?? "").slice(name.length).trim();

// Renders the frames worth seeing three ways (as is, without words, without words and pictures) and measures them.
async function see(job: Job, scene: Scene, source: string, folder: string): Promise<Seen> {
  const ctx = job.opts.ctx;
  const starts = parse(plainMoments(source, job.opts), kitKinds()).doc.states.map((s) => when(s.at, ctx));
  const words = job.p.narration!.words;
  const picked = lookFrames(starts, when({ word: job.range.firstWord }, ctx), endFrame(job), FPS, LOOK_FRAMES);
  const moments: Moment[] = picked.map((m) => ({ ...m, words: words.filter((w) => w.start * FPS >= m.frame - 2.5 * FPS && w.start * FPS <= m.frame + 0.5 * FPS).map((w) => w.text).join(" ") }));
  const frames = moments.map((m) => m.frame);
  const [files, bare, empty] = await Promise.all([
    renderStills(scene, ctx.theme, frames, join(folder, "shown"), LOOK_SCALE),
    renderStills(hide(scene, ["text"]), ctx.theme, frames, join(folder, "bare"), 0.5),
    renderStills(hide(scene, ["text", "image"]), ctx.theme, frames, join(folder, "empty"), 0.5),
  ]);
  writeFileSync(join(folder, "scene.txt"), source);
  const read = readOf(ctx.theme);
  const measured = frames.map((frame, k) => {
    const things = inventory(scene, frame);
    const shown = decode(files[k]!, 540);
    const changing = moments[k]!.why === "changing";
    const findings = merge(measureLayout(things, ctx.width, ctx.height, read, changing, keptAt(scene, frame)), measurePixels(things, shown, decode(bare[k]!), decode(empty[k]!), ctx.width, changing));
    return { frame, findings, words: wordsOnScreen(things) };
  });
  writeFileSync(join(folder, "measured.json"), JSON.stringify(measured, null, 1));
  return { moments, files, measured };
}

// What the judge reads before the frames: the topic, the research facts, computed steps, and this part's words.
function lookHeader(job: Job, w: Written): string {
  const p = job.p;
  const facts = (p.factSheet?.claims ?? []).map((c) => `- ${c.text}`).join("\n");
  const steps = w.result.truth?.length ? `\n\nSteps computed by the engine, correct by construction:\n${w.result.truth.map((t) => `${t.id} (${t.kind}): ${t.steps.slice(0, 40).join("; ")}`).join("\n")}` : "";
  const said = p.narration!.words.slice(job.range.firstWord, job.range.lastWord + 1).map((x) => x.text).join(" ");
  return `Topic: ${topic(p)}\nVisual style: ${p.input.style || "default"}\n\nResearch facts the video is built on:\n${facts || "(none listed)"}${steps}\n\nThis part's narration:\n${said}`;
}

// `extra`: more lines for frame k (from 0), such as what the instruments read on it.
function frameContent(seen: Seen, only?: Set<number>, label = "Frame", extra?: (k: number) => string): unknown[] {
  return seen.moments.flatMap((m, k) => {
    if (only && !only.has(k + 1)) return [];
    const found = seen.measured[k]!.findings.map((f) => `[${f.severity}] ${f.note}`);
    const more = extra?.(k);
    return [
      { type: "input_text", text: `${label} ${k + 1}, at ${(m.frame / FPS).toFixed(1)} s (${m.why}). Words around it: ${m.words ? `"${m.words}"` : "(a pause)"}\nOn screen: ${seen.measured[k]!.words.join(" / ") || "(no writing)"}\nMeasured: ${found.join("; ") || "nothing found"}${more ? `\nInstruments on this frame:\n${more}` : ""}` },
      { type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(seen.files[k]!).toString("base64")}` },
    ];
  });
}

const issueText = (issues: Issue[]) => issues.map((x) => `${x.id} [severity ${x.severity}, frames ${x.frames.join(", ")}] ${x.what} Should be: ${x.want}`).join("\n");

async function judge(job: Job, w: Written, seen: Seen): Promise<{ judged: Judged; usd: number }> {
  const r = await json<Judged>({ system: lookPart("Judge"), user: [{ type: "input_text", text: lookHeader(job, w) }, ...frameContent(seen)], schema: judgeSchema, schemaName: "look", effort: "medium" });
  return { judged: r.value, usd: r.usd };
}

async function recheck(job: Job, w: Written, after: Seen, before: Seen, issues: Issue[]): Promise<{ re: Rechecked; usd: number }> {
  const named = new Set(issues.flatMap((x) => x.frames).filter((f) => f <= after.moments.length));
  const user = [
    { type: "input_text", text: `${lookHeader(job, w)}\n\nThe issues you named:\n${issueText(issues)}\n\nThe frames before the change, where those issues were:` },
    ...frameContent(before, new Set([...named].slice(0, 4)), "Before, frame"),
    { type: "input_text", text: "The changed version, every frame:" },
    ...frameContent(after),
  ];
  const r = await json<Rechecked>({ system: `${lookPart("Judge")}\n\n${lookPart("Recheck")}`, user, schema: recheckSchema, schemaName: "recheck", effort: "medium" });
  return { re: r.value, usd: r.usd };
}

// Returns the version kept and the severe problems it still has (measured or seen), so a section that a fix could not
// mend is rewritten or reported rather than shipped as it is.
async function look(job: Job, start: Written, log: string[]): Promise<{ w: Written; usd: number; rounds: number; severe: Issue[] }> {
  let w = start;
  let usd = 0;
  let rounds = 0;
  let seen = await see(job, w.result.scene!, w.source, join(job.folder, "look1"));
  let judged: Judged["issues"] | undefined;
  for (let round = 1; round <= LOOK_ROUNDS; round++) {
    if (!judged) {
      const j = await judge(job, w, seen);
      usd += j.usd;
      judged = j.judged.issues;
      job.log(`  ${job.range.id} look ${round}: design ${j.judged.design}/5, ${j.judged.designNote.slice(0, 140)}`);
    }
    const issues = issuesFrom(judged, seen.measured);
    mkdirSync(join(job.folder, `look${round}`), { recursive: true }); // a second round reuses the recheck frames, so its folder may not exist
    writeFileSync(join(job.folder, `look${round}`, "issues.json"), JSON.stringify(issues, null, 1));
    if (!issues.length) {
      job.log(`  ${job.range.id} look ${round}: fine`);
      log.push("fine");
      break;
    }
    job.log(`  ${job.range.id} look ${round}: ${issues.length} issues (${weight(issues)} weight)`);
    for (const x of issues.slice(0, 6)) job.log(`      ${x.id} [${x.severity}] ${x.what.slice(0, 170)}`);
    const shown = new Set(issues.flatMap((x) => x.frames).slice(0, 4));
    const user = [
      { type: "input_text", text: `${job.request}\n\nYour part, with line numbers added for reference. Do not include the numbers:\n${numbered(w.source)}\n\n${lookPart("Fix")}\n\nIssues:\n${issueText(issues)}\n\nThe frames the issues name:` },
      ...frameContent(seen, shown),
    ];
    let reply: string;
    try {
      const r = await text({ system: job.system, user, effort: "medium", maxOutput: 32000 });
      usd += r.usd;
      reply = r.value;
    } catch (e) {
      usd += (e as { usd?: number }).usd ?? 0;
      log.push(`fix failed: ${(e as Error).message.slice(0, 120)}`);
      break;
    }
    const fixed = await compose(job, reply, `${job.request}\n\nYour part:\n${reply}`);
    usd += fixed.usd;
    rounds += fixed.rounds;
    if (fixed.problems.length || !fixed.result.scene) {
      job.log(`  ${job.range.id} look ${round}: !!! the fixed part does not build after ${fixed.rounds} repairs; keeping the version before it. Problems: ${fixed.problems.slice(0, 3).join(" | ")}`);
      log.push("fix did not build, kept before");
      break;
    }
    const after = await see(job, fixed.result.scene, fixed.source, join(job.folder, `look${round}b`));
    const { re, usd: u } = await recheck(job, fixed, after, seen, issues);
    usd += u;
    writeFileSync(join(job.folder, `look${round}b`, "recheck.json"), JSON.stringify(re, null, 1));
    const open = issues.filter((x) => x.source === "seen" && re.named.find((n) => n.id === x.id)?.fixed !== "yes");
    const fresh = re.issues.filter((x) => x.severity >= 2);
    const measuredAfter = weight(after.measured.flatMap((m) => m.findings.filter((f) => f.severity >= 2)));
    const measuredBefore = weight(seen.measured.flatMap((m) => m.findings.filter((f) => f.severity >= 2)));
    const verdict = better({ measuredBefore, measuredAfter, seenBefore: weight(issues.filter((x) => x.source === "seen")), seenAfter: weight([...open, ...fresh]), newSevere: fresh.filter((x) => x.severity >= 3).length, prefer: re.better });
    job.log(`  ${job.range.id} look ${round}: measured ${measuredBefore} -> ${measuredAfter}, seen ${weight(issues.filter((x) => x.source === "seen"))} -> ${weight([...open, ...fresh])}, prefers ${re.better}: ${verdict ? "kept the fix" : "kept the version before"}`);
    if (!verdict) {
      log.push("fix not better, kept before");
      break;
    }
    log.push("fixed");
    w = fixed;
    seen = after;
    // What is still open carries into the next round as the judgement of this version, so it is not judged afresh.
    judged = [...open.map(({ id: _i, source: _s, ...x }) => x), ...fresh];
    if (![...judged, ...after.measured.flatMap((m) => m.findings)].some((x) => x.severity >= 3)) break;
  }
  return { w, usd, rounds, severe: severeOf(judged ?? [], seen.measured) };
}

// Every repair keeps only an improvement. Both versions are rendered and measured as the look step does; with `named`
// (the problems the repair was for) a second look also compares them, as the look step's recheck does. The changed
// version is kept only when it is better overall and brings no new severe problem; otherwise the version before stays,
// so a repair that does not converge never ships a worse part.
export async function gate(job: Job, before: string, after: Written, named: Issue[] | undefined, label: string): Promise<{ keep: boolean; usd: number; why: string }> {
  const was = await check(job, before);
  // A version that does not build cannot ship. With neither building nothing changes here; with only the changed one
  // building there is nothing to compare it with, so it is kept only when a fresh look finds nothing severe in it.
  if (!after.result.scene) return { keep: !was.result.scene, usd: 0, why: was.result.scene ? "the changed version does not build" : "neither version builds" };
  const folder = join(job.folder, `gate-${label}`);
  if (!was.result.scene) {
    const a = await see(job, after.result.scene, after.source, join(folder, "after"));
    const j = await judge(job, after, a);
    const left = severeOf(j.judged.issues, a.measured);
    writeFileSync(join(folder, "judged.json"), JSON.stringify(j.judged, null, 1));
    return { keep: !left.length, usd: j.usd, why: `the version before does not build; the changed one has ${left.length} severe problems${left.length ? `: ${left.map((x) => x.what).join(" | ").slice(0, 160)}` : ""}` };
  }
  const [b, a] = await Promise.all([see(job, was.result.scene, before, join(folder, "before")), see(job, after.result.scene, after.source, join(folder, "after"))]);
  const heavy = (x: Seen) => weight(x.measured.flatMap((m) => m.findings.filter((f) => f.severity >= 2)));
  const severe = (x: Seen) => x.measured.flatMap((m) => m.findings.filter((f) => f.severity >= 3)).length;
  const [mb, ma] = [heavy(b), heavy(a)];
  const newSevere = Math.max(0, severe(a) - severe(b));
  if (!named) {
    const keep = ma <= mb && !newSevere;
    return { keep, usd: 0, why: `measured ${mb} -> ${ma}${newSevere ? `, ${newSevere} new severe` : ""}` };
  }
  const shown = named.map((x) => ({ ...x, frames: x.frames.length ? x.frames : Array.from({ length: Math.min(4, b.moments.length) }, (_, k) => k + 1) }));
  const { re, usd } = await recheck(job, after, a, b, shown);
  writeFileSync(join(folder, "recheck.json"), JSON.stringify(re, null, 1));
  const open = shown.filter((x) => re.named.find((n) => n.id === x.id)?.fixed !== "yes");
  const fresh = re.issues.filter((x) => x.severity >= 2);
  const keep = better({ measuredBefore: mb, measuredAfter: ma, seenBefore: weight(shown), seenAfter: weight([...open, ...fresh]), newSevere: newSevere + fresh.filter((x) => x.severity >= 3).length, prefer: re.better });
  return { keep, usd, why: `measured ${mb} -> ${ma}, named ${shown.length} -> ${open.length} open, ${fresh.length} new, prefers ${re.better}` };
}

// What still breaks a frame in a version: severe issues seen, and severe measured findings.
export const severeOf = (judged: Judged["issues"], measured: Seen["measured"]): Issue[] => issuesFrom(judged, measured).filter((x) => x.severity >= 3);

// ---------------------------------------------------------------------------------------------------------------------
// The review round (path A): after the build, the look and its fix, the part is read by the design brain's instruments
// (pipeline/lib/instrument-notes.ts, with their suggestions for this project's viewing) and reviewed by Spark looking at
// its stills with those readings beside each frame. Both go back to the writer as notes, and it repairs its own part.
// A repair is kept only when it builds, keeps what it promised the parts around it, and the gate finds it no worse;
// otherwise the version before stays and the round stops. Code decides nothing about layout, motion or timing here: the
// instruments report, the reviewer says what it sees and what matters for this video, the writer decides what changes.

// The model calls and renders of a review round, so it can run with stand-ins (scene.test.ts) and live.
export type ReviewCalls = {
  see: (w: Written, folder: string) => Promise<Seen>;
  review: (w: Written, seen: Seen, notes: PartNotes) => Promise<{ judged: Judged; usd: number }>;
  write: (user: unknown[]) => Promise<{ value: string; usd: number }>;
  compose: (reply: string) => Promise<Written>;
  gate: (before: string, after: Written, named: Issue[], label: string) => Promise<{ keep: boolean; usd: number; why: string }>;
};

const reviewPart = (name: "Review" | "Repair" | "Once" | "Check") => (prompt("scene-review").split(/^# /m).find((x) => x.startsWith(name)) ?? "").slice(name.length).trim();

/** What the instruments read on a built part: its window of the video, the project's viewing, the words and silences. */
export function measurePart(job: Job, scene: Scene): PartNotes {
  const words = job.p.narration!.words.map((w) => ({ text: w.text, start: w.start, ...("end" in w && typeof w.end === "number" ? { end: w.end } : {}) }));
  const holds = (job.opts.holds ?? []).map((h) => ({ id: h.id, from: h.start, to: h.start + h.seconds }));
  return partNotes({ scene, words, viewing: projectViewing(job.p), window: [when({ word: job.range.firstWord }, job.opts.ctx), endFrame(job) + 1], holds });
}

const readingsOn = (job: Job, scene: Scene, seen: Seen) => (k: number) => frameReadings(scene, projectViewing(job.p), seen.moments[k]!.frame);
const NOTES_HEAD = "The instruments' readings over your part (times are seconds of the video, places are shares of the frame):";

/** What goes back to the writer from a review: its part, the reviewer's issues, the instruments' notes, and the frames named. */
export function reviewRepairRequest(job: Job, w: Written, issues: Issue[], notes: PartNotes, seen: Seen): unknown[] {
  const shown = new Set(issues.flatMap((x) => x.frames).filter((f) => f >= 1 && f <= seen.moments.length).slice(0, 4));
  return [
    { type: "input_text", text: `${job.request}\n\nYour part, with line numbers added for reference. Do not include the numbers:\n${numbered(w.source)}\n\n${reviewPart("Repair")}\n\nIssues the reviewer saw:\n${issueText(issues)}\n\n${NOTES_HEAD}\n${notes.lines.join("\n")}\n\nThe frames the issues name, with what the instruments read on each:` },
    ...frameContent(seen, shown, "Frame", readingsOn(job, w.result.scene!, seen)),
  ];
}

const liveReview = (job: Job): ReviewCalls => ({
  see: (w, folder) => see(job, w.result.scene!, w.source, folder),
  review: async (w, seen, notes) => {
    const user = [{ type: "input_text", text: `${lookHeader(job, w)}\n\n${NOTES_HEAD}\n${notes.lines.join("\n")}` }, ...frameContent(seen, undefined, "Frame", readingsOn(job, w.result.scene!, seen))];
    const r = await json<Judged>({ system: reviewPart("Review"), user, schema: judgeSchema, schemaName: "review", effort: "medium" });
    return { judged: r.value, usd: r.usd };
  },
  write: (user) => text({ system: job.system, user, effort: "medium", maxOutput: 32000 }),
  compose: (reply) => compose(job, reply, `${job.request}\n\nYour part:\n${reply}`),
  gate: (before, after, named, label) => gate(job, before, after, named, label),
});

// Warnings that are about the join (hand-offs, the direction's demonstrations), which a repair must not add to.
const joinWarnings = (w: Written) => w.warnings.filter((x) => !x.startsWith("severe on screen") && !x.startsWith("hold ")).length;

/** At most REVIEW_ROUNDS rounds of instruments, reviewer and writer on a built part; returns the version kept. */
export async function reviewRound(job: Job, start: Written, calls: ReviewCalls = liveReview(job)): Promise<{ w: Written; usd: number; rounds: number; log: string[] }> {
  let w = start;
  let usd = 0;
  let rounds = 0;
  const log: string[] = [];
  for (let round = 1; round <= REVIEW_ROUNDS && w.result.scene; round++) {
    const folder = join(job.folder, `review${round}`);
    mkdirSync(folder, { recursive: true });
    const notes = measurePart(job, w.result.scene);
    writeFileSync(join(folder, "instruments.txt"), `${notes.lines.join("\n")}\n`);
    const seen = await calls.see(w, folder);
    const r = await calls.review(w, seen, notes);
    usd += r.usd;
    writeFileSync(join(folder, "review.json"), JSON.stringify(r.judged, null, 1));
    // The reviewer read the instruments beside the frames and says what matters for this video; blemishes stay.
    const issues: Issue[] = r.judged.issues.filter((x) => x.severity >= 2).map((x, i) => ({ ...x, id: `r${i + 1}`, source: "seen" }));
    job.log(`  ${job.range.id} review ${round}: design ${r.judged.design}/5, ${issues.length} issues${issues.length ? `: ${issues.map((x) => x.what.slice(0, 80)).join(" | ")}` : ""}`);
    if (!issues.length) {
      log.push("fine");
      break;
    }
    let reply: string;
    try {
      const x = await calls.write(reviewRepairRequest(job, w, issues, notes, seen));
      usd += x.usd;
      reply = x.value;
    } catch (e) {
      usd += (e as { usd?: number }).usd ?? 0;
      log.push(`repair failed: ${(e as Error).message.slice(0, 120)}`);
      break;
    }
    if (reply.trim() === w.source.trim()) {
      log.push("the writer kept it as it was");
      break;
    }
    const fixed = await calls.compose(reply);
    usd += fixed.usd;
    rounds += fixed.rounds;
    if (fixed.problems.length || !fixed.result.scene) {
      job.log(`  ${job.range.id} review ${round}: the repair does not build (${fixed.problems.slice(0, 2).join(" | ").slice(0, 200)}); kept the version before`);
      log.push("repair did not build, kept before");
      break;
    }
    if (joinWarnings(fixed) > joinWarnings(w)) {
      log.push("repair missed a hand-off, kept before");
      break;
    }
    const g = await calls.gate(w.source, fixed, issues, `review${round}`);
    usd += g.usd;
    job.log(`  ${job.range.id} review ${round}: ${g.keep ? "kept the repair" : "kept the version before"} (${g.why})`);
    if (!g.keep) {
      log.push("repair not better, kept before");
      break;
    }
    log.push("repaired");
    w = fixed;
  }
  return { w, usd, rounds, log };
}

// `start`: an answer already written in the scene language (an intent author who wrote today's language instead), which
// is checked, repaired and looked at as a first answer would be.
// Build and mend in code: slips the build names with exactly one fix are made before any model sees the part.
async function checkMended(job: Job, written: string, fixed: string[]): Promise<{ source: string; c: Checked }> {
  let source = unwrap(written);
  let c = await check(job, source);
  for (let pass = 0; pass < 3 && c.result.problems.length; pass++) {
    const m = mend(source, c.result.problems);
    if (!m.fixed.length) break;
    fixed.push(...m.fixed);
    source = m.source;
    c = await check(job, source);
  }
  return { source, c };
}

// The taste review on a part's stills (engine/review/taste.ts): an art director's judgment from the frames and the
// part's context, run beside the look on the same stills. Its notes join the one repair request; it adds a call, not a round.
export function tasteContext(job: Job): TasteContext {
  const p = job.p;
  const s = style(p.input.style);
  const words = p.narration!.words.slice(job.range.firstWord, job.range.lastWord + 1).map((w) => w.text).join(" ");
  const events = eventsIn(p, job.range);
  const v = projectViewing(p);
  return {
    words,
    purpose: events.map((e) => `${e.job}; the eye should be on ${e.look}`).join(" Then: ") || "carry these words",
    ...(p.plan?.intent || p.direction?.goal ? { intent: [p.plan?.intent, p.direction?.goal].filter(Boolean).join(". ") } : {}),
    style: { name: s.name, palette: Object.entries(s.palette ?? {}).map(([k, x]) => `${k} ${x}`), fonts: [...new Set(Object.values(s.fonts ?? {}))], ...(s.art?.scene ? { texture: s.art.scene } : {}) },
    platform: `${v.screen}, ${v.width} by ${v.height}, ${v.watch}`,
  };
}
// What the scene's writer can do about a frame, in the language's own words, so an art director's fix can name the
// means it would use. Read from the language and the kits each time, never from a list kept here.
export function meansOf(): string[] {
  const v = vocabulary();
  return [
    `writing sizes: ${v.sizes.join(", ")}; role= gives a thing the style's own look for what it is (a title, a heading, a caption, a note, a key, a panel)`,
    `arrangements: ${v.containers.join(", ")} (a stage puts things in one place at their true relative sizes); w= and h= set the room a shape, a picture or a computed thing takes; gap= the space between things`,
    `camera: ${v.attrs.camera!.join(", ")} (camera ID zoom=N frames one thing larger, so small things fill the frame; zoom 1 shows the whole frame)`,
    `emphasis and removal: ${v.commands.join(", ")} (light marks the thing the words are about, dim fades the rest, drop removes what the words have left behind)`,
    ...SCENE_KITS.flatMap((k) => Object.entries(k.docs ?? {}).filter(([n]) => !!k.kinds && n in k.kinds).map(([n, d]) => `${n}, a computed thing: ${d}`)),
  ];
}
/** The art director's verdict on a part's stills, with the instruments' readings beside each frame when there are any, and
 * the fixes asked for before a repair when this is the check on that repair. */
export async function tasteVerdictFor(job: Job, seen: Seen, ask: Ask, readings?: (k: number) => string, asked?: string[]): Promise<TasteVerdict> {
  const t0 = seen.moments[0]?.frame ?? 0;
  const frames = seen.moments.map((m, k) => ({ at: (m.frame - t0) / FPS, image: imageFile(seen.files[k]!), ...(readings ? { readings: readings(k) } : {}) }));
  return tasteReview(ask, frames, { ...tasteContext(job), means: meansOf(), ...(asked ? { asked } : {}) });
}
export async function tasteFor(job: Job, seen: Seen, ask: Ask): Promise<string[]> {
  return tasteNotes(await tasteVerdictFor(job, seen, ask));
}
// Frames spread evenly over the part, numbered as frameContent numbers them (from 1), so a writer sees its part as a
// viewer does and not only the frames an issue names.
export function spreadOf(seen: Seen, n: number): number[] {
  const total = seen.moments.length;
  if (total <= n) return seen.moments.map((_, k) => k + 1);
  return [...new Set(Array.from({ length: n }, (_, i) => 1 + Math.round((i * (total - 1)) / (n - 1))))];
}
// The taste review's calls on Spark, charged with the part's other calls.
const sparkAsk = (pay: (usd: number) => void): Ask => async <T>(c: Parameters<Ask>[0]) => {
  const r = await json<T>({ system: c.system, user: c.user as string, schema: c.schema as Record<string, unknown>, schemaName: c.name, effort: c.effort ?? "medium", ...(c.model ? { model: c.model as never } : {}) });
  pay(r.usd);
  return r.value;
};

// One repair round (the project's `sceneRepair: "once"`). The writer writes; a draft that does not build gets its build
// problems back first, so what follows always reads a part that exists. The built part is rendered once and looked at by
// everything at the same time: the look review, the art director (with the writer's means named, so its fixes can be
// acted on) and the design brain's instruments. Everything found goes back together in one request, with the frames
// themselves spread over the part, so the writer sees what a viewer sees. The repair is kept if it builds; only a repair
// that does not build is asked again, with its build problems. Then the check: when the art director had asked for a
// revision, the repaired part is rendered again and shown to the same eye with the fixes it asked for. If the weakest
// element still stands, the writer gets one last request with the repaired frames. Code decides nothing about the
// scene here: it measures, renders and carries notes; the writer decides what changes.
async function writeOnce(job: Job, draft: string): Promise<Written & { looks: string[]; repairs: number; fixed: string[] }> {
  job.log(`  ${job.range.id} (words ${job.range.firstWord} to ${job.range.lastWord}): writing, one repair round`);
  let usd = 0;
  const fixed: string[] = [];
  const log = (m: string) => job.log(`  ${job.range.id}: ${m}`);
  const ask = async (user: string | unknown[]): Promise<string> => {
    const r = await text({ system: job.system, user: user as string, effort: "medium", maxOutput: 32000 });
    usd += r.usd;
    return r.value;
  };
  const taste = job.taste ?? sparkAsk((x) => (usd += x));
  const built = (c: Checked) => !c.problems.length && !!c.result.scene;
  const written = (source: string, c: Checked, rounds: number): Written => ({ source, result: c.result, problems: c.problems, warnings: [...c.warnings, ...c.notes], usd, rounds });
  const buildProblems = (c: Checked) => c.problems.slice(0, 2).join(" | ").slice(0, 200);
  const looks: string[] = [];
  let repairs = 0;

  // 1. The draft, built. Every section gets its one look, even one whose first answer did not build.
  let first = await checkMended(job, await ask(draft ? `${job.request}\n\nA first draft of your part, made from the director's shots:\n${draft}` : job.request), fixed);
  for (let tries = 0; !built(first.c) && tries < 2; tries++) {
    repairs++;
    log(`the draft does not build (${buildProblems(first.c)}); asking with its build problems`);
    first = await checkMended(job, await ask(repairRequest(job, first.source, [...first.c.problems, ...first.c.warnings])), fixed);
  }
  if (!built(first.c)) {
    looks.push("did not build");
    return { ...written(first.source, first.c, 1 + repairs), usd, looks, repairs, fixed };
  }

  // 2. One look at the built part, by every eye at once, and one request back with everything found.
  const w = written(first.source, first.c, 1 + repairs);
  const scene = first.c.result.scene!;
  const seen = await see(job, scene, first.source, join(job.folder, "once"));
  const notes = measurePart(job, scene);
  const readings = readingsOn(job, scene, seen);
  const [j, verdict] = await Promise.all([
    judge(job, w, seen),
    tasteVerdictFor(job, seen, taste, readings).catch((e) => (log(`taste review failed: ${(e as Error).message.slice(0, 160)}`), undefined)),
  ]);
  usd += j.usd;
  const issues = issuesFrom(j.judged.issues, seen.measured);
  const said = review(job, first.source, first.c.result);
  const tasteLines = verdict ? tasteNotes(verdict) : [];
  writeFileSync(join(job.folder, "once", "issues.json"), JSON.stringify({ design: j.judged.design, issues, said, warnings: first.c.warnings, instruments: notes.lines, taste: tasteLines }, null, 1));
  log(`look: design ${j.judged.design}/5, ${issues.length} issues, ${first.c.warnings.length} build notes, ${notes.lines.length} instrument lines, taste: ${verdict ? (verdict.verdict === "ship" ? "ship" : `revise (${verdict.weakest})`) : "no answer"}`);
  if (!issues.length && !first.c.warnings.length && !said.trim() && !tasteLines.length) return { ...w, usd, looks: ["fine"], repairs, fixed };
  const shown = new Set([...issues.flatMap((x) => x.frames).filter((f) => f >= 1 && f <= seen.moments.length).slice(0, 4), ...spreadOf(seen, 4)]);
  const parts = [
    `${job.request}\n\nYour part, with line numbers added for reference. Do not include the numbers:\n${numbered(first.source)}\n\n${reviewPart("Once")}`,
    first.c.warnings.length ? `What the build reports:\n${first.c.warnings.map((x) => `- ${x}`).join("\n")}` : "",
    said.trim() ? `What code sees:\n${said}` : "",
    issues.length ? `Issues the reviewer saw on the frames:\n${issueText(issues)}` : "",
    tasteLines.length ? `An art director looked at the same frames:\n${tasteLines.map((x) => `- ${x}`).join("\n")}` : "",
    `${NOTES_HEAD}\n${notes.lines.join("\n")}`,
    "Your part as it renders, with what the instruments read on each frame:",
  ].filter(Boolean).join("\n\n");
  repairs++;
  let next = await checkMended(job, await ask([{ type: "input_text", text: parts }, ...frameContent(seen, shown, "Frame", readings)]), fixed);
  if (!built(next.c)) {
    repairs++;
    log(`the repair does not build (${buildProblems(next.c)}); asking once more with its build problems`);
    next = await checkMended(job, await ask(repairRequest(job, next.source, [...next.c.problems, ...next.c.warnings])), fixed);
  }
  if (!built(next.c)) {
    looks.push("repair did not build, kept the first");
    return { ...written(first.source, first.c, 1 + repairs), usd, looks, repairs, fixed };
  }
  looks.push("repaired");

  // 3. The check: did what the art director asked for land on screen? One last request if not.
  if (verdict?.verdict === "revise") {
    const folder = join(job.folder, "once", "check");
    const scene2 = next.c.result.scene!;
    const seen2 = await see(job, scene2, next.source, folder);
    const readings2 = readingsOn(job, scene2, seen2);
    const again = await tasteVerdictFor(job, seen2, taste, readings2, verdict.fixes).catch((e) => (log(`taste check failed: ${(e as Error).message.slice(0, 160)}`), undefined));
    writeFileSync(join(folder, "check.json"), JSON.stringify({ asked: verdict.fixes, verdict: again ?? null }, null, 1));
    if (again?.verdict === "revise") {
      log(`check: the weakest element still stands (${again.weakest}); one last repair`);
      const notes2 = measurePart(job, scene2);
      const said2 = review(job, next.source, next.c.result);
      const text2 = [
        `${job.request}\n\nYour part, with line numbers added for reference. Do not include the numbers:\n${numbered(next.source)}\n\n${reviewPart("Check")}`,
        `What you were asked to fix:\n${verdict.fixes.map((x) => `- ${x}`).join("\n")}`,
        `The art director looked at the repaired frames:\n${tasteNotes(again).map((x) => `- ${x}`).join("\n")}`,
        next.c.warnings.length ? `What the build reports:\n${next.c.warnings.map((x) => `- ${x}`).join("\n")}` : "",
        said2.trim() ? `What code sees:\n${said2}` : "",
        `${NOTES_HEAD}\n${notes2.lines.join("\n")}`,
        "The repaired frames, with what the instruments read on each:",
      ].filter(Boolean).join("\n\n");
      repairs++;
      let third = await checkMended(job, await ask([{ type: "input_text", text: text2 }, ...frameContent(seen2, new Set(spreadOf(seen2, 5)), "Frame", readings2)]), fixed);
      // A re-composition is the change most likely to break the build, and the one most worth keeping, so like the
      // first repair it gets its build problems back once before it is given up.
      if (!built(third.c)) {
        repairs++;
        log(`the last repair does not build (${buildProblems(third.c)}); asking once more with its build problems`);
        third = await checkMended(job, await ask(repairRequest(job, third.source, [...third.c.problems, ...third.c.warnings])), fixed);
      }
      if (built(third.c)) {
        next = third;
        looks.push("repaired again after the check");
      } else {
        writeFileSync(join(folder, "unbuilt.txt"), `${third.c.problems.join("\n")}\n\n${third.source}`);
        looks.push("the last repair did not build, kept the first repair");
      }
    } else looks.push(again ? `check: ${again.verdict}` : "check: no answer");
  }
  return { ...written(next.source, next.c, 1 + repairs), usd, looks, repairs, fixed };
}

async function writeSection(job: Job, draft: string, start?: string): Promise<Written & { looks: string[] }> {
  if (job.once && start === undefined) return writeOnce(job, draft);
  job.log(`  ${job.range.id} (words ${job.range.firstWord} to ${job.range.lastWord}): writing`);
  let w = start !== undefined ? await compose(job, start, job.request, true) : await compose(job, undefined, draft ?`${job.request}\n\nA first draft of your part, made from the director's shots. Keep its pictures where they serve the words and build on it. Its camera lines frame each picture on its subject, measured for this frame, so keep them unless you move the picture; words you add over a picture take role=caption:\n${draft}` : job.request);
  let usd = w.usd;
  let rounds = w.rounds;
  const looks: string[] = [];
  if (!w.problems.length && w.result.scene) {
    try {
      const r = await look(job, w, looks);
      [w, usd, rounds] = [r.w, usd + r.usd, rounds + r.rounds];
      if (r.severe.length) {
        // A fix that was no better leaves a severe problem in place. Write the part again from the start, told what went
        // wrong, and keep whichever version has fewer severe problems; what is still severe is reported, not hidden.
        job.log(`  ${job.range.id} look: !!! still severe after the look: ${r.severe.map((x) => x.what.slice(0, 100)).join(" | ")}. Writing it again.`);
        const again = await compose(job, undefined, `${job.request}\n\nAn earlier version of your part had these problems on screen, and changing it did not remove them. Write your part again so that none of them can happen:\n${issueText(r.severe)}`);
        usd += again.usd;
        rounds += again.rounds;
        let severe = r.severe;
        if (!again.problems.length && again.result.scene) {
          const seen = await see(job, again.result.scene, again.source, join(job.folder, "rewrite"));
          const j = await judge(job, again, seen);
          usd += j.usd;
          const left = severeOf(j.judged.issues, seen.measured);
          job.log(`  ${job.range.id} rewrite: ${left.length} severe (was ${r.severe.length})`);
          if (left.length < r.severe.length) [w, severe] = [again, left];
          looks.push(left.length < r.severe.length ? "rewritten" : "rewrite not better");
        } else looks.push("rewrite did not build");
        if (severe.length) {
          job.log(`  ${job.range.id} look: !!! SEVERE problems remain: ${severe.map((x) => x.what.slice(0, 120)).join(" | ")}`);
          w = { ...w, warnings: [...w.warnings, ...severe.map((x) => `severe on screen: ${x.what}`)] };
        }
      }
    } catch (e) {
      usd += (e as { usd?: number }).usd ?? 0;
      job.log(`  ${job.range.id} look: FAILED to look: ${(e as Error).message.slice(0, 200)}`);
      looks.push(`failed: ${(e as Error).message.slice(0, 200)}`);
    }
    if (job.review !== false) {
      try {
        const r = await reviewRound(job, w);
        // What the look left severe stays reported on a repaired version: the review does not say it is gone.
        const severe = w.warnings.filter((x) => x.startsWith("severe on screen"));
        [w, usd, rounds] = [r.w === w ? w : { ...r.w, warnings: [...r.w.warnings, ...severe] }, usd + r.usd, rounds + r.rounds];
        looks.push(...r.log.map((x) => `review: ${x}`));
      } catch (e) {
        usd += (e as { usd?: number }).usd ?? 0;
        job.log(`  ${job.range.id} review: FAILED: ${(e as Error).message.slice(0, 200)}`);
        looks.push(`review failed: ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }
  return { ...w, usd, rounds, looks };
}

// The look step on its own, for a section already written: no rewriting from scratch. Used to test the look.
export async function lookAgain(p: Project, sectionId: string, assets: Record<string, string>): Promise<{ before: string; after: string; looks: string[]; usd: number }> {
  const ranges = sectionsOf(p);
  const i = ranges.findIndex((r) => r.id === sectionId);
  const section = p.scene!.sections.find((s) => s.id === sectionId)!;
  const castFile = join(dir(p), "scene", "cast.json");
  const cast: CastPart[] = existsSync(castFile) ? JSON.parse(readFileSync(castFile, "utf8")).cast : ranges.map(() => ({ shows: "", handoff: [] }));
  const header = [`Topic: ${topic(p)}`, p.plan?.intent ? `Why the viewer wants this: ${p.plan.intent}` : "", asked([...(p.plan?.story ?? []), ...(p.plan?.visuals ?? [])])].filter(Boolean).join("\n\n") + "\n\n";
  const pics = pictures(p, p.scene!.assets);
  const opts = sceneBuildOptions(p, assets);
  const job: Job = { p, range: ranges[i]!, next: ranges[i + 1], carry: i ? cast[i - 1]!.handoff : [], handoff: cast[i]!.handoff, system: languagePrompt(opts), request: requestFor(p, ranges, i, cast, header, (describe(pics) + drawings(p))), opts, folder: join(dir(p), "scene", sectionId), log: (l) => console.log(l) };
  const start = await check(job, section.source);
  if (start.problems.length || !start.result.scene) throw new Error(`${sectionId} does not build: ${start.problems.slice(0, 3).join(" | ")}`);
  const looks: string[] = [];
  const r = await look(job, { source: section.source, result: start.result, problems: [], warnings: start.warnings, usd: 0, rounds: 0 }, looks);
  return { before: section.source, after: r.w.source, looks, usd: r.usd };
}

// One section written again from the start, with build repairs and the look, as the stage would. For checking a change
// to the guide or the engine on one section without redoing a whole video. The project itself is not changed.
export async function writeAgain(p: Project, sectionId: string, assets: Record<string, string>): Promise<Written & { looks: string[] }> {
  const ranges = sectionsOf(p);
  const i = ranges.findIndex((r) => r.id === sectionId);
  if (i < 0) throw new Error(`no section ${sectionId}`);
  const castFile = join(dir(p), "scene", "cast.json");
  const cast: CastPart[] = existsSync(castFile) ? JSON.parse(readFileSync(castFile, "utf8")).cast : ranges.map(() => ({ shows: "", handoff: [] }));
  const header = [`Topic: ${topic(p)}`, p.plan?.intent ? `Why the viewer wants this: ${p.plan.intent}` : "", asked([...(p.plan?.story ?? []), ...(p.plan?.visuals ?? [])])].filter(Boolean).join("\n\n") + "\n\n";
  const pics = pictures(p, p.scene?.assets);
  const opts = sceneBuildOptions(p, assets);
  const job: Job = { p, range: ranges[i]!, next: ranges[i + 1], carry: i ? cast[i - 1]!.handoff : [], handoff: cast[i]!.handoff, system: languagePrompt(opts), request: requestFor(p, ranges, i, cast, header, describe(pics) + drawings(p)), opts, folder: join(dir(p), "scene", sectionId, "again"), log: (l) => console.log(l) };
  return writeSection(job, "");
}

// Two versions of one section compared by the gate, as a repair is: `before` stays unless `after` is better overall
// and brings no new severe problem. For checking a change after the fact without writing anything again.
export async function compareVersions(p: Project, sectionId: string, before: string, after: string, assets: Record<string, string>): Promise<{ keep: boolean; usd: number; why: string }> {
  const ranges = sectionsOf(p);
  const i = ranges.findIndex((r) => r.id === sectionId);
  if (i < 0) throw new Error(`no section ${sectionId}`);
  const castFile = join(dir(p), "scene", "cast.json");
  const cast: CastPart[] = existsSync(castFile) ? JSON.parse(readFileSync(castFile, "utf8")).cast : ranges.map(() => ({ shows: "", handoff: [] }));
  const opts = sceneBuildOptions(p, assets);
  const job: Job = { p, range: ranges[i]!, next: ranges[i + 1], carry: i ? cast[i - 1]!.handoff : [], handoff: cast[i]!.handoff, system: "", request: "", opts, folder: join(dir(p), "scene", sectionId), log: (l) => console.log(l) };
  const now = await check(job, after);
  const written: Written = { source: after, result: now.result, problems: now.problems, warnings: now.warnings, usd: 0, rounds: 0 };
  return gate(job, before, written, [], "compare");
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
          handoff: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "what", "parts", "use"],
              properties: { id: { type: "string" }, what: { type: "string" }, parts: { type: "array", items: { type: "string" } }, use: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

// Ids must be valid in the language and unique to a thing; a cast id that clashes with another thing is renamed. Piece
// ids are cleaned the same way and never repeat the thing's own id.
const cleanId = (id: string) => id.replace(/[^\w-]/g, "_").replace(/^[^A-Za-z]+/, "");
export function cleanCast(parts: CastPart[], count: number): CastPart[] {
  const whatOf = new Map<string, string>();
  return Array.from({ length: count }, (_, i) => {
    const part = parts[i] ?? { shows: "", handoff: [] };
    const handoff = i === count - 1 ? [] : part.handoff.map((c) => {
      let id = cleanId(c.id) || `thing${i + 1}`;
      const known = whatOf.get(id);
      if (known !== undefined && known !== c.what && !parts[i - 1]?.handoff.some((x) => x.id === c.id)) id = `${id}_${i + 1}`;
      whatOf.set(id, c.what);
      const pieces = [...new Set((c.parts ?? []).map(cleanId).filter((x) => x && x !== id))];
      return { id, what: c.what, ...(pieces.length ? { parts: pieces } : {}), ...(c.use?.trim() ? { use: c.use.trim() } : {}) };
    });
    const seen = new Set<string>();
    return { shows: part.shows, handoff: handoff.filter((c) => !seen.has(c.id) && seen.add(c.id)) };
  });
}

async function planCast(p: Project, ranges: Range[], header: string, pics: string): Promise<{ cast: CastPart[]; usd: number }> {
  const words = p.narration!.words;
  const parts = ranges.map((r, i) => `Part ${i + 1} (words ${r.firstWord} to ${r.lastWord}): ${words.slice(r.firstWord, r.lastWord + 1).map((w) => w.text).join(" ")}`).join("\n\n");
  const user = `${header}${pics ? `Pictures the video has:\n${pics}\n\n` : ""}${directionSummary(p, ranges)}The ${ranges.length} parts, in order:\n\n${parts}`;
  // The things that compute a process, so a demonstration that spans parts is carried as the one computed thing.
  const truth = SCENE_KITS.filter((k) => k.behaviors?.steps).flatMap((k) => Object.keys(k.kinds ?? {}).map((name) => `- ${k.docs?.[name] ?? name}`));
  const system = `${prompt("scene-cast")}${truth.length ? `\n\nThe engine's things that compute a process for real:\n${truth.join("\n")}\n- ${STEPS_DOC}` : ""}`;
  let usd = 0;
  for (let tries = 1; ; tries++) {
    const r = await json<{ parts: CastPart[] }>({ system, user: tries === 1 ? user : `${user}\n\nReturn exactly ${ranges.length} parts, one per part above, in order.`, schema: castSchema, schemaName: "cast", effort: "low" });
    usd += r.usd;
    if (r.value.parts.length === ranges.length || tries >= 2) return { cast: cleanCast(r.value.parts, ranges.length), usd };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The stage.

function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? "");
}

export function requestFor(p: Project, ranges: Range[], i: number, cast: CastPart[], header: string, pics: string): string {
  const r = ranges[i]!;
  const words = p.narration!.words;
  const list = (c: Carry[]) => c.map((x) => `- ${x.id}: ${x.what}${x.parts?.length ? ` Its pieces have the ids ${x.parts.join(", ")}.` : ""}${x.use ? ` The next part: ${x.use}` : ""}`).join("\n");
  const carry = i === 0 ? "Your part opens the video." : cast[i - 1]!.handoff.length ? `When your part begins, the part before has left these on screen, for your words to build on:\n${list(cast[i - 1]!.handoff)}\nWhere your first words build on one, list it in your first state with the same id, and its pieces with theirs, so the viewer sees it stay rather than being drawn again; then change it as your words need, and drop it once they have moved on. Anything you leave out of your first state leaves as your part begins, which is right when your words turn to something else.` : "The part before yours leaves nothing you need, so start fresh.";
  const handoff = i === ranges.length - 1 ? "Your part ends the video." : cast[i]!.handoff.length ? `The next part builds on these, so have them on screen, with these ids, as your last word is spoken. Until then show them only where your own words use them:\n${list(cast[i]!.handoff)}` : "The next part starts fresh, so end your part however suits your words.";
  const { arc, narration, spoken } = partContext(p, ranges, i, cast, true);
  const body = fill(prompt("scene"), { first: String(r.firstWord), last: String(r.lastWord), prefix: `${r.id}_`, carry, handoff, arc, pictures: pics ? `\nPictures you can show with \`image id asset=NAME\`:\n${pics}\n` : "", narration, direction: directionText(p, r) });
  return `${header}${body}\nYour words (number, seconds, word):\n${spoken}`;
}

// What every author of a part is told about the whole: what each part shows, the narration with the part marked, and
// the part's own words with their times and the silences the voice left.
function partContext(p: Project, ranges: Range[], i: number, cast: CastPart[], holdMomentsToo: boolean) {
  const r = ranges[i]!;
  const words = p.narration!.words;
  const arc = cast.map((c, k) => `${k + 1}. words ${ranges[k]!.firstWord} to ${ranges[k]!.lastWord}${k === i ? " (yours)" : ""}: ${c.shows}`).join("\n");
  const plain = (a: number, b: number) => words.slice(a, b).map((w) => w.text).join(" ");
  const narration = `${plain(0, r.firstWord)}\n[your part starts]\n${plain(r.firstWord, r.lastWord + 1)}\n[your part ends]\n${plain(r.lastWord + 1, words.length)}`.trim();
  const silences = new Map((p.narration?.holds ?? []).map((h) => [h.afterWord, h]));
  const spoken = words.slice(r.firstWord, r.lastWord + 1).map((w, k) => {
    const h = silences.get(r.firstWord + k);
    return `${r.firstWord + k} ${w.start.toFixed(1)} ${w.text}${h ? `\n   (silence: hold ${h.id}, ${h.start.toFixed(1)} to ${(h.start + h.seconds).toFixed(1)} s${holdMomentsToo ? `, @${h.id} to @${h.id}.end` : ""})` : ""}`;
  }).join("\n");
  return { arc, narration, spoken };
}

// ---------------------------------------------------------------------------------------------------------------------
// The intent path: an author writes what matters at each moment of its part, and the design brain composes it.

/** The intent author's request for part `i`: the same video, direction and words the language author gets, without the
 * language's rules, and with the user's material listed by its named parts. */
export function intentRequestFor(p: Project, ranges: Range[], i: number, cast: CastPart[], header: string, material: string): string {
  const r = ranges[i]!;
  const { arc, narration, spoken } = partContext(p, ranges, i, cast, false);
  const parts = ranges.length > 1
    ? `This video is planned in parts, each by a different author at the same time, and each part is composed on its own. You plan one: the spoken words ${r.firstWord} to ${r.lastWord}. Use the video's own word numbers in every \`@N\`, as listed below. Your first moment is \`@${r.firstWord}\`, and no moment starts after word ${r.lastWord}: the next part takes over right after it. Declare every thing your part shows, even one an earlier part showed.`
    : `You plan the whole video: the spoken words ${r.firstWord} to ${r.lastWord}. Your first moment is \`@${r.firstWord}\`.`;
  return [
    `${header}${parts}`,
    // Hold moments are the scene language's; an intent plan places its moments on spoken words.
    directionText(p, r).replace(/from @h\d+ to @h\d+\.end/g, "").replace(/@h\d+\.end/g, "the hold's end").replace(/,\s*\./g, ".").trim(),
    ranges.length > 1 ? `What the viewer mainly sees in each part of the video, so yours fits the whole:\n${arc}` : "",
    material,
    `The whole narration, for context. Your part is between the markers:\n${narration}`,
    `Your words (number, seconds, word):\n${spoken}`,
  ].filter(Boolean).join("\n\n") + "\n";
}

/** The user's files as the material readers take them: the director's pictures and the notes the user supplied. */
export function materialFiles(p: Project, pics: Picture[]): MaterialFile[] {
  const files: MaterialFile[] = pics.map((x) => ({ name: x.name, file: basename(x.path), path: join(dir(p), x.path), size: x.size, about: x.about, kind: "image" }));
  if (p.plan?.material?.trim()) files.push({ name: "notes", file: "notes.txt", text: p.plan.material, about: "notes, facts or sources the user supplied", kind: "notes" });
  return files;
}

/** The material read once into part cards (p.material), and again only when the files change. */
export async function readMaterialOnce(p: Project, files: MaterialFile[], reasoner: Reasoner): Promise<NonNullable<Project["material"]>> {
  // The uploads were read by the material stage. They stay as they are; only what the scene adds is read here.
  const uploaded = p.material?.uploaded;
  const names = new Set(uploaded?.cards ?? []);
  const kept = { cards: (p.material?.cards ?? []).filter((c) => names.has(c.name)), requirements: (p.material?.requirements ?? []).filter((r) => names.has(r.source.file)), problems: uploaded?.problems ?? [] };
  const key = uploaded ? hash(uploaded.key, files.map((f) => [f.name, f.file, f.path, f.text, f.size])) : hash(files.map((f) => [f.name, f.file, f.path, f.text, f.size]));
  if (p.material?.key === key) return p.material;
  if (!files.length) return (p.material = { ...kept, key, ...(uploaded ? { uploaded } : {}) });
  const r = await readProject(files, reasoner, { request: `${topic(p)}${p.plan?.intent ? `. ${p.plan.intent}` : ""}` });
  if (r.pending.length) throw new Error(`scene: the material reader left ${r.pending.length} tasks unanswered: ${r.pending.slice(0, 3).join(", ")}`);
  for (const c of r.cards.filter((c) => !c.checked.ok)) console.log(`  !!! material ${c.name} did not check: ${c.checked.notes.slice(0, 2).join(" | ")}`);
  return (p.material = { cards: [...kept.cards, ...r.cards], requirements: [...kept.requirements, ...r.requirements], problems: [...kept.problems, ...r.problems], key, ...(uploaded ? { uploaded } : {}) });
}

// How the video is watched, as far as the project says: the frame, the screen and distance the user's request and plan
// imply (suggest.ts suggestViewing: lengths the words give, else a typical screen of the kind they name, else the
// frame's shape), and the captions the timeline burns in (video/Video.tsx: a band from 1640 to 1810 px of a 1920 px
// frame). Each number has its reason; the director confirms or replaces it.
export function projectViewing(p: Project): Viewing {
  const [width, height] = p.input.frame ?? [WIDTH, HEIGHT];
  const request = [p.input.prompt, p.plan?.intent, ...(p.plan?.story ?? []), ...(p.plan?.visuals ?? [])].filter(Boolean).join(". ");
  const sized = suggestViewing({ request }, width, height);
  return viewingFrom({
    width, height, fps: FPS,
    screen: sized.screen,
    frameWidthMm: sized.frameWidthMm,
    distanceMm: sized.distanceMm,
    watch: height > width ? "glancing in a feed (not stated)" : "watching on purpose (not stated)",
    captions: { show: true, box: [0, 1640 / 1920, 1, 1810 / 1920], why: "the timeline burns the narration in as captions" },
    why: `from the user's request and the project's frame: ${sized.why}`,
  });
}

// `spend`: what the plan's own calls cost, for the stage to charge; the design brain's calls are charged as they are made.
type IntentWritten = { section: SceneSection; notes: string[]; decisions: string[]; spend: number } | { language: string; usd: number; rounds: number };

/** One part on the intent path: the plan is written and repaired from its checks, then composed by the design brain.
 * An answer written wholly in the scene language is handed back, for the language path to take. */
async function writeIntent(job: Job, it: { system: string; request: string; cards: PartCard[]; requirements: PartCard["requirements"]; loadable: Record<string, string>; paths: Record<string, string>; brief: string }): Promise<IntentWritten> {
  const { p, range } = job;
  const words = p.narration!.words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
  job.log(`  ${range.id} (words ${range.firstWord} to ${range.lastWord}): planning the intent`);
  let usd = 0;
  let src = "";
  let next = it.request;
  let problems: string[] = ["the model never answered"];
  let notes: string[] = [];
  let round = 0;
  let plan: ReturnType<typeof checkPlan>["plan"] | undefined;
  for (round = 1; round <= BUILD_ROUNDS; round++) {
    try {
      const r = await text({ system: it.system, user: next, effort: "medium", maxOutput: 32000 });
      usd += r.usd;
      src = stripFence(r.value);
    } catch (e) {
      usd += (e as { usd?: number }).usd ?? 0;
      job.log(`    ${range.id} intent round ${round}: the model failed: ${(e as Error).message.slice(0, 160)}`);
      continue;
    }
    const c = checkPlan(src, words, it.cards, range);
    if (c.language) {
      job.log(`    ${range.id}: the answer is written in the scene language, so it takes the language path`);
      return { language: src, usd, rounds: round };
    }
    [problems, notes, plan] = [c.problems, c.notes, c.plan];
    job.log(`    ${range.id} intent round ${round}: ${c.plan.moments.length} moments, ${c.plan.things.length} things, ${problems.length} problems`);
    for (const x of problems.slice(0, 4)) job.log(`      ${x.slice(0, 180)}`);
    if (!problems.length) break;
    next = intentRepair(it.request, src, problems, MAX_PROBLEMS);
  }
  const rounds = Math.min(round, BUILD_ROUNDS);
  mkdirSync(job.folder, { recursive: true });
  writeFileSync(join(job.folder, "intent.txt"), src);
  const spend = usd;
  const failed = (why: string[]): IntentWritten => ({ section: { id: range.id, firstWord: range.firstWord, lastWord: range.lastWord, source: src, ok: false, rounds, usd: +usd.toFixed(4), author: "intent" }, notes: [...why, ...notes.map((x) => `parse: ${x}`)], decisions: [], spend });
  if (problems.length || !plan) return failed(problems);

  // The design brain, with a reasoner of its own so this part's cost is its own; every call is charged as it is made.
  const reasoner = metaReasoner({
    charge: (x, detail) => charge(p, "scene", x, `${range.id} ${detail}`),
    checkBudget: () => checkBudget(0.05),
  });
  const { run, agents } = designRunner();
  const opts = job.opts;
  const inputs: DesignInputs = {
    plan, words, range, frames: opts.ctx.frames,
    holds: (p.narration?.holds ?? []).map((h) => ({ id: h.id, afterWord: h.afterWord, seconds: h.seconds, purpose: p.direction?.events.flatMap((e) => e.holds ?? []).find((x) => x.id === h.id)?.purpose })),
    cards: it.cards, requirements: it.requirements, assets: it.loadable, brief: it.brief, direction: directionText(p, range).trim() || undefined,
    theme: opts.ctx.theme, styleName: p.input.style, viewing: projectViewing(p),
  };
  try {
    const out = await run(join(job.folder, "design"), inputs, reasoner, agents);
    usd += reasoner.ledger.usd;
    // Stored with the project's paths, so the player serves the pictures and the timeline credits them.
    const back = new Map(Object.entries(it.loadable).map(([name, url]) => [url, it.paths[name] ?? url]));
    const file = join("scene", range.id, "design-scene.json");
    writeFileSync(join(dir(p), file), JSON.stringify(mapSources(out.scene, (s) => back.get(s) ?? s)));
    const decisions = [
      ...out.decisions.map((d) => `${range.id} ${d.moment === undefined ? "video" : `@${plan!.moments[d.moment]?.word ?? d.moment}`} ${d.area} [${d.from}]: ${d.choice}${d.why ? ` (${d.why})` : ""}`),
      ...out.corrections.map((c) => `${range.id} correction${c.moment === undefined ? "" : ` @${plan!.moments[c.moment]?.word ?? c.moment}`}: "${c.was}" is now "${c.now}" (${c.source})`),
    ];
    for (const c of out.corrections) job.log(`  ${range.id}: the director corrected "${c.was}" to "${c.now}" (${c.source})`);
    const section: SceneSection = { id: range.id, firstWord: range.firstWord, lastWord: range.lastWord, source: src, ok: true, rounds, usd: +usd.toFixed(4), author: "intent", design: { file, decisions, notes: out.notes } };
    return { section, notes: [...notes.map((x) => `parse: ${x}`), ...out.notes], decisions, spend };
  } catch (e) {
    usd += reasoner.ledger.usd;
    job.log(`  ${range.id}: !!! the design brain failed: ${(e as Error).message.slice(0, 200)}`);
    return failed([`the design brain failed: ${(e as Error).message}`]);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Direction: the moment-by-moment plan, in plain words for the scene's author. Holds are given as moments and frame
// lengths from what the voice really recorded, and demonstrations as phases tied to words and holds.

export function directionText(p: Project, range: Range, fps = FPS): string {
  const d = p.direction;
  const events = d ? eventsIn(p, range) : [];
  if (!d || !events.length) return "";
  const words = p.narration!.words;
  const recorded = new Map((p.narration?.holds ?? []).map((h) => [h.id, h]));
  const quote = (n: number) => `word ${n}${words[n] ? ` ("${words[n]!.text}")` : ""}`;
  const len = (s: number) => `${s.toFixed(1)} s (${Math.round(s * fps)} frames)`;
  // A phase's ends, as a moment the author can write and a time on the narration clock.
  const point = (m: DemoPhase["at"] | undefined, edge: "start" | "end"): { say: string; t?: number } | undefined => {
    if (!m) return undefined;
    if ("word" in m) return { say: `@${m.word}`, t: words[m.word]?.start };
    const h = recorded.get(m.hold);
    if (!h) return { say: `the hold ${m.hold} (not recorded as a silence, so treat it as a short beat)` };
    return edge === "end" ? { say: `@${m.hold}.end`, t: h.start + h.seconds } : { say: `@${m.hold}`, t: h.start };
  };
  const phase = (e: DirectionEvent, ph: DemoPhase, k: number, all: DemoPhase[]) => {
    const from = point(ph.at, "start")!;
    const sameHold = "hold" in ph.at && ph.until && "hold" in ph.until && ph.until.hold === ph.at.hold;
    const to = ph.until ? point(ph.until, sameHold ? "end" : "start") : "hold" in ph.at ? point(ph.at, "end") : all[k + 1] ? point(all[k + 1]!.at, "start") : point({ word: e.lastWord }, "start");
    const span = from.t !== undefined && to?.t !== undefined && to.t > from.t ? `, about ${len(to.t - from.t)}` : "";
    const what = ph.replay ? "a replay" : ph.steps ? `steps ${ph.steps[0]} to ${ph.steps[1]}` : "the demonstration";
    return `  ${k + 1}. ${what}, ${ph.pace}, from ${from.say} until ${to?.say ?? "the event ends"}${span}: ${ph.why}`;
  };
  const block = (e: DirectionEvent) => {
    const edge = e.firstWord < range.firstWord ? " (it began in the part before yours)" : e.lastWord > range.lastWord ? " (it goes on into the next part)" : "";
    const out = [`Event ${e.id}, words ${e.firstWord} to ${e.lastWord}${edge}: ${e.job}`];
    if (e.knows) out.push(`- By its end the viewer knows: ${e.knows}`);
    if (e.waiting) out.push(`- The viewer is waiting for: ${e.waiting}`);
    if (e.look) out.push(`- The eye should be on: ${e.look}`);
    if (e.feel || e.rhythm) out.push(`- Feel: ${e.feel || "as the words suggest"}; rhythm: ${e.rhythm === "long" ? "long, held" : "short, quick succession"}`);
    if (e.camera) out.push(`- Camera: ${e.camera}`);
    if (e.sound) out.push(`- Sound: ${e.sound} (an \`emit NAME\` at that moment lets the sound follow it)`);
    if (e.reveal) out.push(`- Reveal at ${quote(e.reveal.word)}: ${e.reveal.what}`);
    for (const h of e.holds ?? []) {
      const r = recorded.get(h.id);
      const when = r ? `${len(r.seconds)} of silence after ${quote(h.afterWord)}, from @${h.id} to @${h.id}.end` : `after ${quote(h.afterWord)}, planned at ${h.seconds.toFixed(1)} s but not recorded as a silence, so it is only a beat`;
      out.push(`- Hold ${h.id}, ${h.purpose}: ${when}. During it: ${h.does}${h.shows ? `. On screen: "${h.shows}"` : ""}`);
    }
    if (e.demo) out.push(`- Demonstration: ${e.demo.what}. Phases:\n${e.demo.phases.map((ph, k, all) => phase(e, ph, k, all)).join("\n")}`);
    return out.join("\n");
  };
  const held = withholdsIn(p, range).map((w) => `- ${w.what} (set in event ${w.event.id}), until event ${w.until} at ${quote(w.word)}: write \`withhold IDS until=@${w.word}\` with the ids that show it, or \`withhold none until=@${w.word}\`.`);
  const truth = truthPlan(p, range).filter((t) => t.plays.length).map((t) => `- \`${t.line}${t.done ? ` done=${t.done}` : ""}\`: the same computed thing, with the same id and settings, in every part of the video. ${t.done ? `The parts before yours played steps 1 to ${t.done}, so as your part begins it stands after step ${t.done} (done=${t.done} shows that from your first frame). ` : ""}Your part plays exactly steps ${t.plays.map((x) => `${x.from} to ${x.to} (${x.pace}, event ${x.event})`).join(", ")}, one \`do steps ${t.id} from= to=\` per phase, and no others: the parts after yours play the rest. Its steps, numbered:\n${t.steps.map((x, i) => `    ${i + 1} ${x}`).filter((_, i) => t.plays.some((pl) => i + 1 >= pl.from - 1 && i + 1 <= pl.to)).join("\n")}`);
  return `\nHow your part is directed. The direction walked the video as its viewer and wrote what each moment is for; your picture carries it out:\n${d.goal ? `The video is for: ${d.goal}\n` : ""}\n${events.map(block).join("\n\n")}${held.length ? `\n\nWithheld while your part plays, so nothing of it may be seen before its moment:\n${held.join("\n")}` : ""}${truth.length ? `\n\nThe computed demonstration in your part:\n${truth.join("\n")}` : ""}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Demonstrations that fit their words. Each phase plays computed steps under a stretch of narration; where those steps
// are not the ones the words are about, the plan's demonstration is repaired by Spark before any part is written, since
// every part's step numbers come from it.

const DEMO_ROUNDS = 3;
type Truth = NonNullable<NonNullable<DirectionEvent["demo"]>["truth"]>;

// Each computed thing the direction demonstrates, with the word span of every phase that plays its steps.
export function demoSpans(p: Project): { truth: Truth; events: DirectionEvent[]; spans: PhaseSpan[] }[] {
  const events = p.direction?.events ?? [];
  const holdWord = new Map(events.flatMap((e) => (e.holds ?? []).map((h) => [h.id, h.afterWord] as const)));
  const groups = new Map<string, { truth: Truth; events: DirectionEvent[]; spans: PhaseSpan[] }>();
  for (const e of events) {
    const t = e.demo?.truth;
    if (!t) continue;
    const key = `${t.kind} ${JSON.stringify(t.data)}`;
    const g = groups.get(key) ?? groups.set(key, { truth: t, events: [], spans: [] }).get(key)!;
    g.events.push(e);
    const start = (m: DemoPhase["at"]) => ("word" in m ? m.word : (holdWord.get(m.hold) ?? e.firstWord) + 1);
    e.demo!.phases.forEach((ph, index, all) => {
      if (!ph.steps) return;
      const first = Math.max(e.firstWord, start(ph.at));
      const last = ph.until ? ("word" in ph.until ? ph.until.word : holdWord.get(ph.until.hold) ?? e.lastWord) : all[index + 1] ? start(all[index + 1]!.at) - 1 : e.lastWord;
      g.spans.push({ event: e.id, index, from: ph.steps[0], to: ph.steps[1], first, last: Math.max(first, Math.min(e.lastWord, last)) });
    });
  }
  return [...groups.values()];
}

export const demoFit = (p: Project): string[] => demoSpans(p).flatMap((g) => spokenNotShown(g.spans, p.narration!.words.map((w) => w.text), g.truth.data, g.truth.steps));

type RawDemoPhase = { event: string; from: number; to: number; pace: DemoPhase["pace"]; atWord: number; atHold: string; untilWord: number; untilHold: string; why: string };
const demoSchema = {
  type: "object",
  additionalProperties: false,
  required: ["data", "phases"],
  properties: {
    data: { type: "string" },
    phases: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["event", "from", "to", "pace", "atWord", "atHold", "untilWord", "untilHold", "why"],
        properties: { event: { type: "string" }, from: { type: "integer" }, to: { type: "integer" }, pace: { type: "string", enum: ["slow", "normal", "fast"] }, atWord: { type: "integer" }, atHold: { type: "string" }, untilWord: { type: "integer" }, untilHold: { type: "string" }, why: { type: "string" } },
      },
    },
  },
} as const;

// Repairs every demonstration whose phases do not show their words, in place on p.direction. A demonstration that
// still does not fit after the rounds is reported loudly; the parts are then written to the plan as it stands.
async function fitDemos(p: Project): Promise<number> {
  const words = p.narration!.words.map((w) => w.text);
  const ctx = sceneContext(p);
  let usd = 0;
  for (const g of demoSpans(p)) {
    let problems = spokenNotShown(g.spans, words, g.truth.data, g.truth.steps);
    if (!problems.length) continue;
    const kind = g.truth.kind;
    const guide = SCENE_KITS.find((k) => k.kinds?.[kind])?.docs?.[kind] ?? kind;
    const holds = new Map(g.events.flatMap((e) => (e.holds ?? []).map((h) => [h.id, h] as const)));
    const eventText = g.events.map((e) => `Event ${e.id} (words ${e.firstWord} to ${e.lastWord}): ${e.job}${e.holds?.length ? `; holds ${e.holds.map((h) => `${h.id} after word ${h.afterWord}`).join(", ")}` : ""}\n${words.slice(e.firstWord, e.lastWord + 1).map((w, k) => `${e.firstWord + k} ${w}`).join(" ")}`).join("\n\n");
    let data = g.truth.data;
    let steps = g.truth.steps;
    let raw: RawDemoPhase[] = g.events.flatMap((e) => e.demo!.phases.map((ph) => ({ event: e.id, from: ph.steps?.[0] ?? 0, to: ph.steps?.[1] ?? 0, pace: ph.pace, atWord: "word" in ph.at ? ph.at.word : -1, atHold: "hold" in ph.at ? ph.at.hold : "", untilWord: ph.until && "word" in ph.until ? ph.until.word : -1, untilHold: ph.until && "hold" in ph.until ? ph.until.hold : "", why: ph.why })));
    let fitted: { data: Record<string, unknown>; steps: string[]; phases: RawDemoPhase[] } | undefined;
    for (let round = 1; round <= DEMO_ROUNDS && !fitted; round++) {
      const user = `Topic: ${topic(p)}\n\nThe computed thing: ${kind}. Its guide line: ${guide}\n\nThe events that demonstrate it, with their words numbered:\n${eventText}\n\nIts settings now: ${JSON.stringify(data)}\nIts steps with these settings:\n${steps.map((x, i) => `${i + 1} ${x}`).join("\n")}\n\nThe phases now:\n${JSON.stringify(raw)}\n\nWhat does not fit:\n${problems.map((x) => `- ${x}`).join("\n")}`;
      const r = await json<{ data: string; phases: RawDemoPhase[] }>({ system: prompt("scene-demo"), user, schema: demoSchema, schemaName: "demo", effort: "medium" });
      usd += r.usd;
      const found: string[] = [];
      let next: Record<string, unknown> = data;
      try {
        next = JSON.parse(r.value.data);
        steps = truthSteps(kind, "demo", next, ctx);
        data = next;
      } catch (e) {
        found.push(`the settings ${r.value.data} are refused: ${(e as Error).message}`);
      }
      raw = r.value.phases;
      let last = 0;
      for (const ph of [...raw].sort((a, b) => (a.atWord >= 0 ? a.atWord : holds.get(a.atHold)?.afterWord ?? 0) - (b.atWord >= 0 ? b.atWord : holds.get(b.atHold)?.afterWord ?? 0))) {
        const e = g.events.find((x) => x.id === ph.event);
        if (!e) found.push(`phase names event ${ph.event}, which is not one of ${g.events.map((x) => x.id).join(", ")}`);
        if (ph.from < 1 || ph.to > steps.length || ph.from > ph.to) found.push(`event ${ph.event}: steps ${ph.from} to ${ph.to} are not steps 1 to ${steps.length}`);
        if (ph.from <= last) found.push(`event ${ph.event}: steps ${ph.from} to ${ph.to} start before step ${last + 1}, but each step plays once, in order`);
        last = Math.max(last, ph.to);
        if (ph.atWord < 0 && !holds.has(ph.atHold)) found.push(`event ${ph.event}: a phase starts at no word and no hold of its demonstration`);
        if (e && ph.atWord >= 0 && (ph.atWord < e.firstWord || ph.atWord > e.lastWord)) found.push(`event ${ph.event}: a phase starts at word ${ph.atWord}, outside the event's words ${e.firstWord} to ${e.lastWord}`);
      }
      if (!found.length) {
        const trial: Project = { ...p, direction: { ...p.direction!, events: p.direction!.events.map((e) => (g.events.some((x) => x.id === e.id) ? { ...e, demo: { ...e.demo!, truth: { kind, data, steps }, phases: raw.filter((x) => x.event === e.id).map(toPhase) } } : e)) } };
        found.push(...demoFit(trial).filter((x) => g.events.some((e) => x.startsWith(`event ${e.id},`))));
      }
      console.log(`  demonstration of ${kind}, round ${round}: ${found.length ? `${found.length} problems` : "fits its words"}`);
      for (const x of found.slice(0, 4)) console.log(`    ${x.slice(0, 200)}`);
      if (!found.length) fitted = { data, steps, phases: raw };
      problems = found;
    }
    if (!fitted) {
      console.log(`  !!! the demonstration of ${kind} still does not fit its words after ${DEMO_ROUNDS} rounds; the parts are written to the plan as it stands`);
      continue;
    }
    for (const e of p.direction!.events) {
      if (!g.events.some((x) => x.id === e.id)) continue;
      e.demo = { ...e.demo!, truth: { kind, data: fitted.data, steps: fitted.steps }, phases: fitted.phases.filter((x) => x.event === e.id).map(toPhase) };
    }
    console.log(`  demonstration of ${kind} now: ${JSON.stringify(fitted.data)}; ${fitted.phases.map((x) => `${x.event} ${x.from}-${x.to} ${x.pace}`).join(", ")}`);
  }
  if (usd) charge(p, "scene", usd, "fitting demonstrations to their words");
  return usd;
}

const toPhase = (x: RawDemoPhase): DemoPhase => ({
  steps: [x.from, x.to],
  pace: x.pace,
  at: x.atWord >= 0 ? { word: x.atWord } : { hold: x.atHold },
  ...(x.untilWord >= 0 ? { until: { word: x.untilWord } } : x.untilHold ? { until: { hold: x.untilHold } } : {}),
  why: x.why,
});

// ---------------------------------------------------------------------------------------------------------------------
// Tickets from watching the finished video. The critic files what it saw (the look of each part, and whether the picture
// carried out the direction); a ticket of severity 2 or more that names one part, or a few, sends those parts back for
// one repair round with its notes. A note about the whole video is no one part's to fix and is left to the reader.

export type SceneTicket = { key: string; sections: string[]; text: string };
const TICKETS_DONE = "tickets-done.json";

export function sceneTickets(p: Project, ranges: Range[]): SceneTicket[] {
  const events = p.direction?.events ?? [];
  return (p.critic?.tickets ?? []).flatMap((t) => {
    const m = /^(direction:scene|look):([a-z_]+):(\d)$/.exec(t.action);
    if (!m || Number(m[3]) < 2) return [];
    const ids = t.shotId.split(",").map((x) => x.trim()).filter(Boolean);
    const named = m[1] === "look"
      ? ranges.filter((r) => ids.includes(r.id))
      : ranges.filter((r) => ids.some((id) => { const e = events.find((x) => x.id === id); return !!e && e.lastWord >= r.firstWord && e.firstWord <= r.lastWord; }));
    if (!named.length || named.length > Math.max(2, Math.floor(ranges.length / 2))) return [];
    return [{ key: hash(t.action, t.shotId, t.note), sections: named.map((r) => r.id), text: `${m[2]!.replace(/_/g, " ")} (${ids.join(", ")}): ${t.note}` }];
  });
}

// A cached part has no notes from this run; a repair keeps the ones it was written with.
const notesOf = (folder: string, now: string[]): string[] => {
  if (now.length) return now;
  try {
    return JSON.parse(readFileSync(join(folder, "section.json"), "utf8")).notes ?? [];
  } catch {
    return [];
  }
};

const doneTickets = (p: Project): string[] => {
  const file = join(dir(p), "scene", TICKETS_DONE);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
};

// The direction in short, for the first pass that plans what carries between parts.
function directionSummary(p: Project, ranges: Range[]): string {
  if (!p.direction?.events?.length) return "";
  const lines = ranges.map((r, i) => `Part ${i + 1}: ${eventsIn(p, r).map((e) => `${e.id} (words ${e.firstWord} to ${e.lastWord}) ${e.job}; eye on ${e.look}${e.demo ? `; demonstrates ${e.demo.what} in ${e.demo.phases.length} phases` : ""}${e.withhold ? `; withholds ${e.withhold.what} until ${e.withhold.until}` : ""}`).join(" | ")}`);
  const things = truthPlan(p, ranges[0] ?? { id: "", firstWord: 0, lastWord: -1 }).map((t) => `- \`${t.line}\` is one computed thing for the whole video, with the id ${t.id} in every part; carry it with that id where a part hands it on.`);
  return `How the video is directed, event by event:\n${lines.join("\n")}${things.length ? `\n${things.join("\n")}` : ""}\n\n`;
}

// The director's look, as every path A writer reads it beside its own part.
export const lookText = (p: Project) => {
  const l = p.direction?.look;
  return l ? `\n\nThe look of the whole video, from its director, for every part (art direction to carry out in your own way, not rules):\n- Emphasis: ${l.emphasis}\n- Scale: ${l.scale}\n- Motifs: ${l.motifs}\n- Texture: ${l.texture}\n` : "";
};

// A direction plan written before the look was part of it gets the look in one call of the director's own guide.
async function ensureLook(p: Project) {
  if (!p.direction || p.direction.look) return;
  const user = [`Topic: ${topic(p)}`, `Visual style: ${p.input.style || "default"}`, `Goal: ${p.direction.goal}`, `Promise: ${p.direction.promise}`, `Arc: ${p.direction.arc}`, `Events:\n${p.direction.events.map((e) => `${e.id}: ${e.job}; eye on ${e.look}; feel ${e.feel}`).join("\n")}`, `The narration:\n${p.narration?.words.map((w) => w.text).join(" ") ?? ""}`].join("\n\n");
  const r = await json<NonNullable<DirectionPlan["look"]>>({ system: `You are the director of this video and have planned it already. Now write its look.\n\n${prompt("art-direction")}`, user, schema: lookSchema, schemaName: "look", effort: "medium" });
  p.direction.look = r.value;
  charge(p, "scene", r.usd, "the director's look");
  console.log(`  look: ${JSON.stringify(r.value).slice(0, 300)}`);
}

// What prepares path A's depictions: the depicter on Muse Spark, the style's art, and the makers of sprites and pictures.
function toolboxFor(p: Project, spent: { usd: number }): NonNullable<Job["toolbox"]> {
  const depicter = metaReasoner({ effort: { depicter: "medium" }, charge: (x, detail) => ((spent.usd += x), console.log(`  depicter ${detail}: $${x.toFixed(4)}`)), checkBudget: () => checkBudget(0.05) });
  const s = style(p.input.style);
  const makers: ToolboxMakers = { depicter, style: spriteStyle(s), purpose: [p.plan?.intent, topic(p)].filter(Boolean).join(": "), sprites: true, ...depictMakers(p, spent) };
  return { box: toolboxOf(p), makers, inflight: new Map(), save: () => saveToolbox(p) };
}

// Sprite and picture makers for path A (pipeline/lib/depict-makers.ts), when this run has them.
function depictMakers(p: Project, spent: { usd: number }): Partial<ToolboxMakers> {
  const pay = (x: number, detail: string) => ((spent.usd += x), console.log(`  ${detail}: $${x.toFixed(4)}`));
  const reasoner = metaReasoner({ effort: { reader: "medium" }, charge: pay, checkBudget: () => checkBudget(0.05) });
  const made = metaDepictMakers({ reasoner, charge: pay, checkBudget: (x) => checkBudget(x ?? 0.05) });
  const paths = Object.fromEntries(pictures(p).map((x) => [x.name, join(dir(p), x.path)]));
  return {
    sprite: made.sprite,
    picture: async ({ desc, asset, parts }) => {
      if (asset !== undefined && !paths[asset]) throw new Error(`there is no picture called ${asset}; the pictures are ${Object.keys(paths).join(", ") || "none"}`);
      const r = await made.picture!(desc, asset !== undefined ? paths[asset] : undefined, parts.map((name) => ({ name, phrase: name, mask: true })));
      return { card: r.card, src: r.src, ...(r.masks ? { masks: r.masks } : {}), tier: r.tier };
    },
  };
}

// What every part's request starts with: the topic, why the viewer wants it, and what the user asked for on purpose.
export const sceneHeader = (p: Project) => [
  `Topic: ${topic(p)}`,
  p.plan?.intent ? `Why the viewer wants this: ${p.plan.intent}` : "",
  asked([...(p.plan?.story ?? []), ...(p.plan?.visuals ?? [])]),
].filter(Boolean).join("\n\n") + "\n\n";

export async function scene(p: Project, force = false, o: { author?: "language" | "intent" } = {}) {
  const words = p.narration!.words;
  const author = o.author ?? p.input.sceneAuthor ?? SCENE_AUTHOR_DEFAULT;
  // Every part's step numbers come from the plan's demonstrations, so they must show their words before any is written.
  if (demoFit(p).length) await fitDemos(p);
  const ranges = sectionsOf(p);
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
  const header = sceneHeader(p);
  const prompts = ["scene", "scene-cast", "scene-look", "scene-demo", "engine-language", "engine-repair"].map(prompt);
  const library = loadLibrary().map((x) => x.name);
  const done = new Set(doneTickets(p));
  const tickets = sceneTickets(p, ranges).filter((t) => !done.has(t.key));
  // Path A gives every writer the director's look; a plan written before the look existed gets one now, once.
  if (author === "toolbox") await ensureLook(p);
  const inputs = [VERSION, CHECKS, tickets.map((t) => t.key), words, p.script?.beats, p.plan, p.input.style, header, pics, draft?.source ?? "", prompts, kitKinds(), library, p.direction ?? null, p.narration?.holds ?? [], ...(author === "intent" ? [author, readFileSync(INTENT_GUIDE, "utf8")] : []), ...(author === "toolbox" ? [author, prompt("scene-review")] : [])];
  const estimate = 0.03 + ranges.length * 0.12;
  await stage(p, "scene", inputs, estimate, async () => {
    const root = join(dir(p), "scene");
    mkdirSync(root, { recursive: true });
    const spent = { usd: 0 };
    try {
      // The first pass, cached on its own so a resumed run plans the same hand-offs.
      const castKey = hash(VERSION, ranges, words.map((w) => w.text), header, (describe(pics) + drawings(p)), prompt("scene-cast"), directionSummary(p, ranges), STEPS_DOC);
      const castFile = join(root, "cast.json");
      let cast: CastPart[];
      const known = existsSync(castFile) ? JSON.parse(readFileSync(castFile, "utf8")) : undefined;
      if (!force && known?.key === castKey) cast = known.cast;
      else {
        const r = await planCast(p, ranges, header, (describe(pics) + drawings(p)));
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
      const toolbox = author === "toolbox" ? toolboxFor(p, spent) : undefined;
      const jobs: Job[] = ranges.map((range, i) => ({ p, range, next: ranges[i + 1], carry: i ? cast[i - 1]!.handoff : [], handoff: cast[i]!.handoff, system, request: requestFor(p, ranges, i, cast, header, describe(pics) + drawings(p)) + (toolbox ? lookText(p) : ""), opts, folder: join(root, range.id), log: (l) => console.log(l), review: !!toolbox && p.input.sceneRepair !== "once", once: p.input.sceneRepair === "once", ...(toolbox ? { toolbox } : {}) }));
      // The intent path: the material read once into cards, and one plan request per part.
      let intent: { system: string; requests: string[]; cards: PartCard[]; requirements: PartCard["requirements"]; brief: string } | undefined;
      if (author === "intent") {
        const reader = metaReasoner({ effort: { reader: "medium" }, charge: (x, detail) => charge(p, "scene", x, `material ${detail}`), checkBudget: () => checkBudget(0.05) });
        const m = await readMaterialOnce(p, materialFiles(p, pics), reader);
        const unread = pics.filter((x) => !m.cards.some((c) => c.name === x.name));
        const material = [materialText(m.cards, m.requirements), unread.length ? `Pictures you can show by name:\n${describe(unread)}` : "", drawings(p).trim()].filter(Boolean).join("\n\n");
        intent = {
          system: intentSystem({ kits: SCENE_KITS, programs: loadLibrary() }),
          requests: ranges.map((_, i) => intentRequestFor(p, ranges, i, cast, header, material)),
          cards: m.cards,
          requirements: m.requirements,
          brief: `${header}The user's request: ${p.input.prompt}`,
        };
      }
      const keys = jobs.map((job, i) => (intent ? hash(VERSION, "intent", intent.requests[i], intent.system, intent.cards, job.request, system) : hash(VERSION, job.request, drafts[i], job.carry, job.handoff, system)));
      let nextJob = 0;
      const worker = async () => {
        for (let i = nextJob++; i < ranges.length; i = nextJob++) {
          const range = ranges[i]!;
          const key = keys[i]!;
          const file = join(root, range.id, "section.json");
          const cached = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
          if (!force && cached?.key === key && cached.section.ok) {
            sections[i] = cached.section;
            console.log(`  ${range.id}: cached`);
            continue;
          }
          const folder = join(root, range.id);
          const job = jobs[i]!;
          let start: string | undefined;
          let preRounds = 0;
          if (intent) {
            const it = await writeIntent(job, { system: intent.system, request: intent.requests[i]!, cards: intent.cards, requirements: intent.requirements, loadable, paths: assets, brief: intent.brief });
            if ("section" in it) {
              spent.usd += it.spend;
              sections[i] = it.section;
              notes[i] = it.notes;
              mkdirSync(folder, { recursive: true });
              writeFileSync(file, JSON.stringify({ key, section: sections[i], notes: notes[i] }, null, 1));
              console.log(`  ${range.id}: ${it.section.ok ? "composed" : "FAILED"} from an intent plan in ${it.section.rounds} rounds, ${it.decisions.length} decisions, $${it.section.usd.toFixed(3)}`);
              continue;
            }
            spent.usd += it.usd;
            [start, preRounds] = [it.language, it.rounds];
          }
          const w = await writeSection(job, drafts[i]!, start);
          w.rounds += preRounds;
          spent.usd += w.usd;
          const ok = !w.problems.length && !!w.result.scene;
          // Stored with hold moments as word moments, so joining, the player and the critic read it as any scene.
          sections[i] = { id: range.id, firstWord: range.firstWord, lastWord: range.lastWord, source: plainMoments(w.source, opts), ok, rounds: w.rounds, usd: +w.usd.toFixed(4) };
          notes[i] = [...w.problems, ...w.warnings.map((x) => (x.startsWith("severe on screen") || x.startsWith("hold ") ? x : `hand-off: ${x}`)), `looks: ${w.looks.join(", ") || "none"}`];
          for (const x of needs(w.source)) console.log(`  ${range.id}: !!! ${x}`);
          mkdirSync(folder, { recursive: true });
          writeFileSync(join(folder, "scene.txt"), w.source);
          writeFileSync(file, JSON.stringify({ key, section: sections[i], notes: notes[i] }, null, 1));
          console.log(`  ${range.id}: ${ok ? "built" : "FAILED"} in ${w.rounds} rounds, looks ${w.looks.join(", ") || "none"}, $${w.usd.toFixed(3)}${w.warnings.length ? `, ${w.warnings.length} hand-off misses` : ""}`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, ranges.length) }, worker));

      // Parts the critic's tickets name go back once, with what was seen in the finished video.
      if (tickets.length) {
        const byPart = new Map<number, string[]>();
        for (const t of tickets) for (const id of t.sections) {
          const i = ranges.findIndex((r) => r.id === id);
          // A composed part is redone by the design brain, not repaired line by line; its tickets stay in the critic's notes.
          if (i >= 0 && sections[i]?.author === "intent") console.log(`  ${id}: a ticket names this composed part; it is left for the design brain: ${t.text.slice(0, 160)}`);
          else if (i >= 0) (byPart.get(i) ?? byPart.set(i, []).get(i)!).push(t.text);
        }
        console.log(`  ${tickets.length} tickets from watching the video send back ${[...byPart.keys()].map((i) => ranges[i]!.id).join(", ")}`);
        await Promise.all([...byPart].map(async ([i, list]) => {
          const job = jobs[i]!;
          // A part that does not build as it stands is mended by the joined repair, which fixes just that; a rewrite for
          // the tickets has nothing to be compared with.
          if (!(await check(job, sections[i]!.source)).result.scene) {
            job.log(`  ${job.range.id}: does not build as it stands, so its tickets wait for the joined repair`);
            return;
          }
          const named: Issue[] = list.map((what, k) => ({ id: `t${k + 1}`, frames: [], kind: "measured", what, want: "what the direction and the words ask for here", severity: 2, source: "seen" }));
          const ask = `${job.request}\n\nYour part, with line numbers added for reference. Do not include the numbers:\n${numbered(sections[i]!.source)}\n\nThe finished video was rendered and watched. These problems were seen in your part (times in seconds of the video):\n${list.map((x) => `- ${x}`).join("\n")}\n\nChange your part so each of them is fixed, as the direction above asks, and keep everything else as it is. Return the whole part, with no commentary.`;
          const w = await compose(job, undefined, ask, false);
          spent.usd += w.usd;
          const ok = !w.problems.length && !!w.result.scene;
          if (!ok) {
            job.log(`  ${job.range.id}: !!! the repair from the tickets does not build (${w.problems.slice(0, 2).join(" | ").slice(0, 200)}); kept as it was, $${w.usd.toFixed(3)}`);
            return;
          }
          const g = await gate(job, sections[i]!.source, w, named, "tickets");
          spent.usd += g.usd;
          job.log(`  ${job.range.id}: repair from the tickets ${g.keep ? "kept" : "not better, kept the version before"} (${g.why}), $${(w.usd + g.usd).toFixed(3)}`);
          if (!g.keep) return;
          sections[i] = { ...sections[i]!, source: plainMoments(w.source, opts), rounds: sections[i]!.rounds + w.rounds, usd: +(sections[i]!.usd + w.usd).toFixed(4) };
          writeFileSync(join(job.folder, "scene.txt"), w.source);
          writeFileSync(join(job.folder, "section.json"), JSON.stringify({ key: keys[i], section: sections[i], notes: notesOf(job.folder, notes[i]!) }, null, 1));
        }));
        writeFileSync(join(root, TICKETS_DONE), JSON.stringify([...done, ...tickets.map((t) => t.key)], null, 1));
      }
      // What the design brain decided for each composed part, and every correction the director made, kept visible.
      const decisions = sections.flatMap((s) => s.design?.decisions ?? []);
      p.scene = { sections, assets, ...(decisions.length ? { decisions } : {}) };
      // The parts join into one scene. Where the whole does not build, the problem goes back to the part whose lines it
      // names, with the error, and that part is repaired and joined again; there is no lesser scene to stand in.
      // Composed parts are compiled scenes already, so only the language parts join as a document.
      const languageParts = () => sections.filter((s) => s.author !== "intent");
      const buildJoined = async (text: string): Promise<BuildResult> => (languageParts().length ? build(text, opts) : { problems: [], stats: { states: 0, parts: 0, programs: 0, programMs: 0 } });
      let joined = joinWithSpans(languageParts());
      let whole = await buildJoined(joined.text);
      for (let round = 1; round <= JOIN_ROUNDS && whole.problems.length; round++) {
        const lines = joined.text.split("\n");
        const byPart = new Map<number, string[]>();
        for (const x of whole.problems) {
          const k = joined.spans.findIndex((sp) => x.line >= sp.from && x.line <= sp.to);
          if (k < 0) continue;
          const i = sections.findIndex((sec) => sec.id === joined.spans[k]!.id);
          (byPart.get(i) ?? byPart.set(i, []).get(i)!).push(`${x.message} (the line in your part reads: ${lines[x.line - 1]?.trim().slice(0, 140)})`);
        }
        console.log(`  !!! the joined scene does not build (round ${round}): ${whole.problems.length} problems, in ${[...byPart.keys()].map((i) => sections[i]!.id).join(", ") || "no one part"}`);
        for (const x of whole.problems.slice(0, 4)) console.log(`      ${formatProblems([x]).slice(0, 220)}`);
        if (!byPart.size) break;
        await Promise.all([...byPart].map(async ([i, list]) => {
          const job = jobs[i]!;
          const ask = `${job.request}\n\nYour part, with line numbers added for reference. Do not include the numbers:\n${numbered(sections[i]!.source)}\n\nYour part builds on its own, but the whole video, joined from every part, does not, because of these lines of your part:\n${list.slice(0, MAX_PROBLEMS).join("\n")}\n\n${prompt("engine-repair")}`;
          const w = await compose(job, undefined, ask, false);
          spent.usd += w.usd;
          job.log(`  ${job.range.id}: repaired for the joined scene: ${w.problems.length ? `still ${w.problems.length} problems` : "builds"}, $${w.usd.toFixed(3)}`);
          if (w.problems.length || !w.result.scene) return;
          // The version before cannot ship in the whole, but a repair that measures worse is tried again, not kept.
          const g = await gate(job, sections[i]!.source, w, undefined, `joined${round}`);
          job.log(`  ${job.range.id}: the joined repair ${g.keep ? "measures no worse, kept" : "measures worse, tried again"} (${g.why})`);
          if (!g.keep) return;
          sections[i] = { ...sections[i]!, source: plainMoments(w.source, opts), rounds: sections[i]!.rounds + w.rounds, usd: +(sections[i]!.usd + w.usd).toFixed(4) };
          writeFileSync(join(job.folder, "scene.txt"), w.source);
          writeFileSync(join(job.folder, "section.json"), JSON.stringify({ key: keys[i], section: sections[i], notes: notesOf(job.folder, notes[i]!) }, null, 1));
        }));
        joined = joinWithSpans(languageParts());
        whole = await buildJoined(joined.text);
      }
      writeFileSync(join(root, "scene.txt"), joined.text);
      const failed = sections.filter((s) => !s.ok);
      charge(p, "scene", spent.usd, `${sections.length} sections, ${failed.length} failed, ${whole.stats.states} states`);
      spent.usd = 0;
      if (whole.problems.length) console.log(`  !!! the joined scene does not build:\n${formatProblems(whole.problems.slice(0, 10))}`);
      if (failed.length || whole.problems.length) {
        const lines = failed.map((s) => `  ${s.id} (words ${s.firstWord} to ${s.lastWord}): ${notes[sections.indexOf(s)]?.slice(0, 3).join(" | ") ?? "see its section.json"}`);
        throw new Error(`scene: ${failed.length ? `sections ${failed.map((s) => s.id).join(", ")} could not be repaired` : "the joined scene does not build"}. No lesser visual stands in for them.\n${lines.join("\n")}`);
      }
      console.log(`  joined scene: ${whole.stats.states} states, ${whole.stats.parts} parts, ${whole.stats.programs} programs`);
      if (sections.some((s) => s.author === "intent")) {
        // The whole video as the timeline will show it: composed parts laid over the language parts, each in its window.
        const all = await wholeScene(p, loadable, opts.ctx.frames);
        if (!all.scene) throw new Error(`scene: the whole scene does not build with its composed parts:\n${formatProblems(all.problems.slice(0, 10))}`);
        console.log(`  whole scene: ${sections.filter((s) => s.author === "intent").length} composed parts, ${all.scene.nodes.length} nodes, ${decisions.length} decisions kept`);
      }
      const severe = notes.flatMap((n, i) => n.filter((x) => x.startsWith("severe on screen")).map((x) => `${ranges[i]!.id}: ${x}`));
      if (severe.length) console.log(`  !!! sections shipped with severe problems on screen (a fix and a rewrite could not remove them):\n${severe.map((x) => `    ${x.slice(0, 220)}`).join("\n")}`);
    } catch (e) {
      if (spent.usd) Object.assign(e as object, { usd: spent.usd });
      throw e;
    } finally {
      await closeRenderer();
    }
  }, force);
}
