// A bench case: one short moment of a video, written as a director and a teacher would, turned into the Project the
// scene stage reads. Cases are written with phrases instead of word numbers (holds after a phrase, a reveal at a
// phrase), so they stay readable and cannot drift from their narration; this file counts the words.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DemoPhase, DirectionEvent, DirectionPlan, Hold, Project, Word } from "../../schemas/project.ts";
import { truthSteps } from "../../engine/kits/steps.ts";
import { SIZE, sceneContext } from "../../pipeline/stages/scene.ts";

type Anchor = string | { hold: string };
export type CaseEvent = Omit<DirectionEvent, "firstWord" | "lastWord" | "holds" | "reveal" | "demo"> & {
  text: string; // what the narrator says in this event
  holds?: (Omit<Hold, "afterWord"> & { after: string })[];
  reveal?: { at: string; what: string };
  demo?: { what: string; truth?: { kind: string; data: Record<string, unknown> }; phases: (Omit<DemoPhase, "at" | "until"> & { at: Anchor; until?: Anchor })[] };
};
// What the user supplied: pasted notes or a document, a small table, a code file, or a picture. Text material goes where
// the pipeline puts the user's material (plan.material, which the research and writer stages read); a picture becomes
// one of the video's pictures, which the scene's author can show by name.
export type Material = { kind: "notes" | "doc" | "csv" | "code" | "image"; name: string; about: string; text?: string; file?: string; size?: [number, number] };
// `needs`: what a viewer must have taken in to answer: the words, the picture, or both.
// `hard`: a question only a picture that does what the plan asks can answer (where a thing is after a step, what changed
// colour, which moved first). The words-only learner should miss these; the gap is what the picture teaches.
export type Question = { q: string; a: string; needs: "words" | "picture" | "both"; hard?: boolean };
export type Case = {
  id: string;
  use: string; // the kind of moment, in a few words, for the score sheet
  request: string; // the user's message
  topic: string;
  intent: string;
  asked?: string[]; // what the user asked for on purpose about the content or the visuals
  material?: Material[];
  style: string; // a file in styles/
  goal: string;
  promise: string;
  arc: string;
  events: CaseEvent[];
  quiz: Question[];
};

export const CASES = join(import.meta.dirname, "..", "cases");
export const MATERIAL = join(CASES, "material");
export const listCases = (): string[] => readdirSync(CASES).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
export const loadCase = (id: string): Case => JSON.parse(readFileSync(join(CASES, `${id}.json`), "utf8"));

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}%$.]/gu, "").replace(/\.$/, "");
export const tokens = (text: string) => text.trim().split(/\s+/).filter(Boolean);

// The word a phrase starts (or ends) at, inside one event's words.
// A phrase word written with its punctuation ("three.") must match it exactly, so a hold can sit after the right "three".
function find(words: string[], from: number, to: number, phrase: string, end: boolean, what: string): number {
  const want = tokens(phrase);
  const same = (w: string, p: string) => (/[^\p{L}\p{N}]$/u.test(p) ? w.toLowerCase() === p.toLowerCase() : norm(w) === norm(p));
  for (let i = from; i + want.length - 1 <= to; i++) if (want.every((p, k) => same(words[i + k]!, p))) return end ? i + want.length - 1 : i;
  throw new Error(`${what}: "${phrase}" is not in the event's words`);
}

// Word times without a voice: about 2.4 words a second, each word given time by its length, a little more after a
// comma and a sentence, and each hold as a silence after its word. Good enough for scenes to be built and judged; a
// recorded voice replaces it with `--voice`.
export const RATE = 2.4;
export function synthTiming(texts: { text: string; beatId: string }[], holds: { id: string; afterWord: number; seconds: number }[]): Pick<Project, "narration">["narration"] & {} {
  const weight = (w: string) => 0.55 + 0.08 * norm(w).length;
  const after = (w: string) => (/[.!?]["')\]]*$/.test(w) ? 0.32 : /[,;:]["')\]]*$/.test(w) ? 0.16 : 0.03);
  const total = texts.reduce((s, w) => s + weight(w.text), 0);
  const pauses = texts.reduce((s, w) => s + after(w.text), 0);
  const scale = (texts.length / RATE - pauses) / total;
  const byWord = new Map<number, typeof holds>();
  for (const h of holds) byWord.set(h.afterWord, [...(byWord.get(h.afterWord) ?? []), h]);
  const words: Word[] = [];
  const timed: { id: string; afterWord: number; start: number; seconds: number }[] = [];
  let t = 0.15;
  texts.forEach((w, i) => {
    const d = weight(w.text) * scale;
    words.push({ text: w.text, start: +t.toFixed(3), end: +(t + d * 0.9).toFixed(3), beatId: w.beatId });
    t += d + after(w.text);
    for (const h of byWord.get(i) ?? []) {
      timed.push({ id: h.id, afterWord: i, start: +(words[i]!.end + 0.05).toFixed(3), seconds: h.seconds });
      t = Math.max(t, words[i]!.end + 0.05 + h.seconds + 0.1);
    }
  });
  const seconds = Math.max(words.at(-1)!.end + 0.4, ...timed.map((h) => h.start + h.seconds + 0.2));
  return { audio: "", voiceId: "", model: "synthetic", seconds: +seconds.toFixed(3), words, holds: timed };
}

// The user's pictures, as the scene stage offers them to its author, with sources the renderer can load.
export function picturesOf(p: Project): { name: string; path: string; size?: [number, number]; about: string; src: string }[] {
  return (p.assets ?? []).filter((a) => a.path).map((a) => ({ name: a.shotId, path: a.path!, size: a.size, about: a.title ?? "a picture", src: `data:image/${a.path!.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(join(MATERIAL, a.path!)).toString("base64")}` }));
}

// The case as a project: plan, script, direction with real word numbers, and synthetic narration.
export function caseProject(c: Case): Project {
  const words: { text: string; beatId: string }[] = [];
  const spans = c.events.map((e) => {
    const first = words.length;
    for (const t of tokens(e.text)) words.push({ text: t, beatId: e.id });
    return [first, words.length - 1] as const;
  });
  const all = words.map((w) => w.text);
  const holdWord = new Map<string, number>();
  const events: DirectionEvent[] = c.events.map((e, k) => {
    const [first, last] = spans[k]!;
    const { text: _t, holds, reveal, demo, ...rest } = e;
    const out: DirectionEvent = { ...rest, firstWord: first, lastWord: last };
    if (holds?.length) out.holds = holds.map(({ after, ...h }) => {
      const afterWord = find(all, first, last, after, true, `${c.id} ${e.id} hold ${h.id}`);
      holdWord.set(h.id, afterWord);
      return { ...h, afterWord };
    });
    if (reveal) out.reveal = { word: find(all, first, last, reveal.at, false, `${c.id} ${e.id} reveal`), what: reveal.what };
    return out;
  });
  // Demos last, since a phase may start at a hold of another event.
  c.events.forEach((e, k) => {
    if (!e.demo) return;
    const [first, last] = spans[k]!;
    const at = (a: Anchor): DemoPhase["at"] => (typeof a === "string" ? { word: find(all, first, last, a, false, `${c.id} ${e.id} demo`) } : a);
    events[k]!.demo = { what: e.demo.what, phases: e.demo.phases.map(({ at: a, until, ...ph }) => ({ ...ph, at: at(a), ...(until ? { until: at(until) } : {}) })) };
    if (e.demo.truth) events[k]!.demo!.truth = { ...e.demo.truth, steps: [] };
  });
  const direction: DirectionPlan = { goal: c.goal, promise: c.promise, arc: c.arc, events, cues: [] };
  const holds = events.flatMap((e) => e.holds ?? []).map((h) => ({ id: h.id, afterWord: h.afterWord, seconds: h.seconds }));
  const narration = synthTiming(words, holds);
  const p: Project = {
    id: c.id,
    createdAt: "2026-11-03T00:00:00.000Z",
    input: { prompt: c.request, style: c.style, persona: "auto", mode: "explain", seconds: 0 },
    plan: { topic: c.topic, seconds: 0, story: c.asked ?? [], tone: "", intent: c.intent, visuals: [], sound: [], material: (c.material ?? []).filter((m) => m.text).map((m) => `${m.name} (${m.about}):\n${m.text}`).join("\n\n"), notation: false },
    ...(c.material?.some((m) => m.kind === "image") ? { assets: c.material.filter((m) => m.kind === "image").map((m) => ({ shotId: m.name, kind: "real" as const, path: m.file!, size: m.size, title: m.about, why: "supplied by the user" })) } : {}),
    script: { title: c.topic, takeaway: c.goal, beats: c.events.map((e) => ({ id: e.id, role: "explain", text: e.text, claimIds: [], visual: e.look, emphasis: [] })) },
    direction,
    narration,
    stages: {},
    costs: [],
  };
  // The truth steps the engine really computes, so phases name real steps, as the direction stage writes them.
  const ctx = sceneContext(p);
  for (const e of events) if (e.demo?.truth) e.demo.truth.steps = truthSteps(e.demo.truth.kind, "demo", e.demo.truth.data, ctx);
  // One case is one part, written by one author, so it is no longer than the stage lets one part be.
  if (words.length > SIZE.max) throw new Error(`${c.id}: ${words.length} words; a bench case is one part of at most ${SIZE.max} words`);
  return p;
}
