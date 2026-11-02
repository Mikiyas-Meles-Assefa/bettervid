// Stage 2b: direction. After the script and before the voice, Spark walks the video as the viewer, event by event, and
// writes what each stretch is for and what the picture and voice do about it: holds (silences with a job), short cue
// lines, demonstrations tied to the steps a truth kit really computes, what to withhold and where the eye goes
// (research/teaching-tempo.md). The model numbers words as the writer left them; code inserts the cues as beats of their
// own and moves every word number to the final script, the words the voice will time. A plan that breaks a rule goes
// back to the model with its problems until it holds; there is no lesser plan to fall back on.
import type { CompileContext } from "../../engine/core/types.ts";
import { truthSteps } from "../../engine/kits/steps.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import type { Beat, DemoPhase, DirectionEvent, DirectionPlan, Hold, HoldPurpose, Project, Script } from "../../schemas/project.ts";
import { abilities, truthKindNames } from "../lib/abilities.ts";
import { json } from "../lib/meta.ts";
import { asked, charge, persona, prompt, seconds, stage, topic } from "../lib/project.ts";
import { viewer } from "./plan.ts";
import { SCENE_KITS } from "./scene.ts";
import { WORDS_PER_SEC } from "./writer.ts";

const ROUNDS = 4; // the first plan, the computed steps shown back, and repairs
const CUE_WORDS = 8;
const HOLD_SECONDS: [number, number] = [0.3, 12];

// ---------------------------------------------------------------------------------------------------------------------
// What the model returns. Strict JSON has no optional fields, so "none" is an empty string, -1 or an empty list.

type Point = { word: number; hold: string; cue: string };
type RawHold = { id: string; afterWord: number; afterCue: string; seconds: number; purpose: HoldPurpose; does: string; shows: string };
type RawPhase = { from: number; to: number; pace: DemoPhase["pace"]; at: Point; until: Point; replay: boolean; why: string };
type RawDemo = { what: string; truth: { kind: string; data: string }; phases: RawPhase[] };
export type RawEvent = {
  id: string;
  firstWord: number;
  lastWord: number;
  job: string;
  knows: string;
  waiting: string;
  look: string;
  feel: string;
  rhythm: "long" | "short";
  reveal: { word: number; what: string };
  withhold: { what: string; until: string };
  holds: RawHold[];
  demo: RawDemo;
  sound: string;
  camera: string;
};
export type RawCue = { id: string; beforeWord: number; text: string };
export type RawPlan = { goal: string; promise: string; arc: string; events: RawEvent[]; cues: RawCue[] };

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const obj = (properties: Record<string, object>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const point = obj({ word: int, hold: str, cue: str });
const schema = obj({
  goal: str,
  promise: str,
  arc: str,
  events: {
    type: "array",
    items: obj({
      id: str,
      firstWord: int,
      lastWord: int,
      job: str,
      knows: str,
      waiting: str,
      look: str,
      feel: str,
      rhythm: { type: "string", enum: ["long", "short"] },
      reveal: obj({ word: int, what: str }),
      withhold: obj({ what: str, until: str }),
      holds: {
        type: "array",
        items: obj({ id: str, afterWord: int, afterCue: str, seconds: { type: "number" }, purpose: { type: "string", enum: ["look", "predict", "settle", "recap", "reveal"] }, does: str, shows: str }),
      },
      demo: obj({
        what: str,
        truth: obj({ kind: str, data: str }),
        phases: { type: "array", items: obj({ from: int, to: int, pace: { type: "string", enum: ["slow", "normal", "fast"] }, at: point, until: point, replay: { type: "boolean" }, why: str }) },
      }),
      sound: str,
      camera: str,
    }),
  },
  cues: { type: "array", items: obj({ id: str, beforeWord: int, text: str }) },
});

// ---------------------------------------------------------------------------------------------------------------------
// Pure parts: words, cues, checking and renumbering. Tested in direction.test.ts.

export const beatWords = (b: Beat) => b.text.trim().split(/\s+/).filter(Boolean);
export const scriptWords = (s: Script) => s.beats.flatMap(beatWords);
const cueWords = (text: string) => text.trim().split(/\s+/).filter(Boolean);

// The script as the writer left it: cue beats removed and beats a cue split joined again, so a rerun plans from the same words.
export function stripCues(s: Script): Script {
  const beats: Beat[] = [];
  for (const b of s.beats) {
    if (b.cue) continue;
    const whole = b.of ? beats.find((x) => x.id === b.of) : undefined;
    if (whole) {
      whole.text = `${whole.text.trim()} ${b.text.trim()}`;
      continue;
    }
    beats.push({ ...b, claimIds: [...b.claimIds], emphasis: [...b.emphasis] });
  }
  return { ...s, beats };
}

const SENTENCE_END = /[.?!:]["'”’)\]]*$/;
export const sentenceStart = (words: string[], at: number) => at === 0 || at === words.length || SENTENCE_END.test(words[at - 1] ?? "");

// Which event a cue belongs to: the one holding the word it comes before (a cue before an event's first word opens it),
// or the last event for a cue after the last word.
function cueEvent(events: { firstWord: number; lastWord: number }[], beforeWord: number): number {
  const i = events.findIndex((e) => beforeWord >= e.firstWord && beforeWord <= e.lastWord);
  return i >= 0 ? i : beforeWord >= (events.at(-1)?.lastWord ?? -1) + 1 ? events.length - 1 : -1;
}

// Events must cover every word exactly once, in order.
export function coverage(events: { id: string; firstWord: number; lastWord: number }[], total: number): string[] {
  if (!events.length) return [`there are no events; they must cover every word from 0 to ${total - 1}`];
  const out: string[] = [];
  let next = 0;
  for (const e of events) {
    if (e.lastWord < e.firstWord) out.push(`event ${e.id} ends at word ${e.lastWord}, before its first word ${e.firstWord}`);
    if (e.firstWord > next) out.push(`words ${next} to ${e.firstWord - 1} belong to no event (event ${e.id} starts at word ${e.firstWord})`);
    if (e.firstWord < next) out.push(`event ${e.id} starts at word ${e.firstWord}, inside the event before it, which runs to word ${next - 1}; each event starts one word after the last one ends`);
    next = Math.max(next, e.lastWord + 1);
  }
  if (next < total) out.push(`words ${next} to ${total - 1} belong to no event; the last event must end at word ${total - 1}`);
  if (next > total) out.push(`the last event ends at word ${next - 1}, but the script's last word is ${total - 1}`);
  return out;
}

const truthKey = (d: RawDemo) => `${d.truth.kind.trim()} ${d.truth.data.replace(/\s+/g, "")}`;
const hasDemo = (e: RawEvent) => !!e.demo.what.trim() || e.demo.phases.length > 0;
const hasTruth = (e: RawEvent) => hasDemo(e) && !!e.demo.truth.kind.trim();

// The real steps of every truth thing the plan names, by its kind and data. A thing the kit refuses comes back as a problem.
export function demoSteps(raw: RawPlan, ctx: CompileContext, kinds: string[]): { steps: Map<string, string[]>; problems: string[] } {
  const steps = new Map<string, string[]>();
  const problems: string[] = [];
  for (const e of raw.events.filter(hasTruth)) {
    const key = truthKey(e.demo);
    if (steps.has(key)) continue;
    const kind = e.demo.truth.kind.trim();
    if (!kinds.includes(kind)) {
      problems.push(`event ${e.id}: the demo names truth kind "${kind}", which the engine does not have (it has ${kinds.join(", ")}); leave truth.kind empty for a demonstration no kit computes`);
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(e.demo.truth.data);
    } catch {
      problems.push(`event ${e.id}: truth.data must be a JSON object of the kind's settings, and ${JSON.stringify(e.demo.truth.data)} is not JSON`);
      continue;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      problems.push(`event ${e.id}: truth.data must be a JSON object of the kind's settings, such as the ones its guide line shows`);
      continue;
    }
    try {
      // Built through the kit itself, so settings it does not take are refused here as they would be in the scene.
      const make = ctx.kits?.find((k) => k.kinds?.[kind])?.kinds?.[kind];
      make?.({ id: "demo", kind, props: {}, data: data as Record<string, unknown> }, ctx);
      steps.set(key, truthSteps(kind, "demo", data as Record<string, unknown>, ctx));
    } catch (err) {
      problems.push(`event ${e.id}: the ${kind} kit refuses this data: ${(err as Error).message}`);
    }
  }
  return { steps, problems };
}

// Every rule a plan must keep, in the numbering the model wrote (the script before cues). Empty when it holds.
export function problems(raw: RawPlan, words: string[], steps: Map<string, string[]> = new Map(), scriptText = words.join(" ")): string[] {
  const out: string[] = [];
  const n = words.length;
  const events = raw.events;
  out.push(...coverage(events, n));
  const dupes = (ids: string[], what: string) => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].forEach((id) => out.push(`two ${what} share the id "${id}"; ids must be unique`));
  dupes(events.map((e) => e.id), "events");
  dupes(events.flatMap((e) => e.holds.map((h) => h.id)), "holds");
  dupes(raw.cues.map((c) => c.id), "cues");

  const cueAt = new Map<string, number>(); // cue id to the index of its event
  for (const c of raw.cues) {
    const n0 = cueWords(c.text).length;
    if (!n0) out.push(`cue ${c.id} has no words`);
    if (n0 > CUE_WORDS) out.push(`cue ${c.id} ("${c.text}") has ${n0} words; a cue is at most ${CUE_WORDS}, a short line that turns the eye or marks a change of pace`);
    if (c.beforeWord < 0 || c.beforeWord > n) out.push(`cue ${c.id} comes before word ${c.beforeWord}, which does not exist (0 to ${n}, where ${n} means after the last word)`);
    else if (!sentenceStart(words, c.beforeWord)) out.push(`cue ${c.id} comes before word ${c.beforeWord} ("${words[c.beforeWord]}"), in the middle of a sentence ("... ${words.slice(Math.max(0, c.beforeWord - 4), c.beforeWord).join(" ")}"); a cue goes before the first word of a sentence`);
    for (const num of c.text.match(/\d[\d.,]*/g) ?? []) {
      const bare = num.replace(/[.,]+$/, "");
      if (!scriptText.includes(bare)) out.push(`cue ${c.id} says ${bare}, which the script never says; a cue never adds a fact`);
    }
    const at = cueEvent(events, c.beforeWord);
    if (at >= 0) cueAt.set(c.id, at);
  }

  const order = new Map(events.map((e, i) => [e.id, i]));
  const played = new Map<string, number>(); // truth thing to the last step played, across events
  events.forEach((e, i) => {
    const inside = (w: number) => w >= e.firstWord && w <= e.lastWord;
    const span = `words ${e.firstWord} to ${e.lastWord}`;
    if (!e.job.trim()) out.push(`event ${e.id} has no job`);
    if (!e.look.trim()) out.push(`event ${e.id} has no look: name the one thing the eye should be on`);
    if (e.reveal.word >= 0 && !inside(e.reveal.word)) out.push(`event ${e.id}: its reveal is at word ${e.reveal.word}, outside the event (${span})`);
    if (e.reveal.word >= 0 && !e.reveal.what.trim()) out.push(`event ${e.id}: its reveal at word ${e.reveal.word} does not say what it reveals`);
    if (e.withhold.what.trim()) {
      const until = order.get(e.withhold.until);
      if (until === undefined) out.push(`event ${e.id}: it withholds "${e.withhold.what}" until "${e.withhold.until}", which is not an event id`);
      else if (until < i) out.push(`event ${e.id}: it withholds "${e.withhold.what}" until ${e.withhold.until}, an earlier event; until names the event where it may first appear, this one or a later one`);
    }
    const holds = new Set(e.holds.map((h) => h.id));
    for (const h of e.holds) {
      if (h.afterCue.trim()) {
        if (!raw.cues.some((c) => c.id === h.afterCue)) out.push(`hold ${h.id} comes after cue "${h.afterCue}", which is not a cue id`);
        else if (cueAt.get(h.afterCue) !== i) out.push(`hold ${h.id} comes after cue ${h.afterCue}, which belongs to another event; a hold sits inside its own event`);
      } else if (!inside(h.afterWord)) out.push(`hold ${h.id} comes after word ${h.afterWord}, outside its event ${e.id} (${span})`);
      if (!(h.seconds >= HOLD_SECONDS[0] && h.seconds <= HOLD_SECONDS[1])) out.push(`hold ${h.id} lasts ${h.seconds} s; a hold lasts ${HOLD_SECONDS[0]} to ${HOLD_SECONDS[1]} s`);
      if (!h.does.trim()) out.push(`hold ${h.id} does not say what the picture does during it; an empty pause does nothing for a viewer`);
    }
    if (!hasDemo(e)) return;
    if (!e.demo.what.trim()) out.push(`event ${e.id}: its demo has phases but does not say what it demonstrates`);
    if (!e.demo.phases.length) out.push(`event ${e.id}: its demo "${e.demo.what}" has no phases; give each stretch of it a phase with its pace`);
    const key = hasTruth(e) ? truthKey(e.demo) : "";
    const real = key ? steps.get(key) : undefined;
    const pointProblem = (p: Point, name: string, optional: boolean) => {
      const set = [p.word >= 0, !!p.hold.trim(), !!p.cue.trim()].filter(Boolean).length;
      if (set === 0 && optional) return;
      if (set !== 1) return out.push(`event ${e.id}: a demo phase's ${name} must give exactly one of word, hold or cue (word -1 and empty strings for the others)`);
      if (p.word >= 0 && !inside(p.word)) out.push(`event ${e.id}: a demo phase's ${name} is word ${p.word}, outside the event (${span})`);
      if (p.hold.trim() && !holds.has(p.hold)) out.push(`event ${e.id}: a demo phase's ${name} is hold "${p.hold}", which is not one of this event's holds`);
      if (p.cue.trim() && cueAt.get(p.cue) !== i) out.push(`event ${e.id}: a demo phase's ${name} is cue "${p.cue}", which is not a cue in this event`);
    };
    for (const ph of e.demo.phases) {
      pointProblem(ph.at, "at", false);
      pointProblem(ph.until, "until", true);
      if (ph.at.word >= 0 && ph.until.word >= 0 && ph.until.word < ph.at.word) out.push(`event ${e.id}: a demo phase runs from word ${ph.at.word} until word ${ph.until.word}, backwards`);
      if (!ph.from && !ph.to) continue;
      if (!key) {
        out.push(`event ${e.id}: a demo phase names steps ${ph.from} to ${ph.to}, but the demo has no truth thing; steps are a truth kit's computed steps (set from and to to 0 otherwise)`);
        continue;
      }
      if (!real) continue; // the kit refused it, reported with its data
      if (ph.from < 1 || ph.to > real.length || ph.from > ph.to) out.push(`event ${e.id}: a demo phase plays steps ${ph.from} to ${ph.to}, but ${e.demo.truth.kind} computes steps 1 to ${real.length}`);
      else if (!ph.replay) {
        const done = played.get(key) ?? 0;
        if (ph.from <= done) out.push(`event ${e.id}: a demo phase plays steps ${ph.from} to ${ph.to}, but steps up to ${done} already played; a step plays once, so go on from ${done + 1} or mark the phase as a replay`);
        played.set(key, Math.max(done, ph.to));
      }
    }
  });
  // A question the viewer is asked needs time to think before the script answers it.
  const waited = new Set(events.flatMap((e) => e.holds.map((h) => h.afterCue)));
  for (const c of raw.cues)
    if (/\?["'”’)]*$/.test(c.text.trim()) && !waited.has(c.id)) out.push(`cue ${c.id} ("${c.text}") asks the viewer a question but no hold follows it; give it a predict hold right after (afterCue "${c.id}") or make it a line that is not a question`);
  return out;
}

// Inserts the cues into the script as beats of their own and moves every word number in the plan to the final script.
// A cue before an event's first word opens that event. A cue inside a beat splits it: the later part keeps the beat's
// fields and names it in `of`, so stripCues can join it again.
export function applyCues(script: Script, raw: RawPlan, steps: Map<string, string[]> = new Map()): { script: Script; plan: DirectionPlan } {
  const words = scriptWords(script);
  const n = words.length;
  const cues = raw.cues.map((c, k) => ({ ...c, text: punctuate(c.text), k })).sort((a, b) => a.beforeWord - b.beforeWord || a.k - b.k);
  const len = new Map(cues.map((c) => [c.id, cueWords(c.text).length]));
  // Cue words that come before word w; `at` counts those placed exactly at w too.
  const before = (w: number, at = false) => cues.filter((c) => c.beforeWord < w || (at && c.beforeWord === w)).reduce((s, c) => s + len.get(c.id)!, 0);
  const moved = (w: number) => w + before(w, true);
  const cueStart = new Map<string, number>();
  for (const c of cues) cueStart.set(c.id, c.beforeWord + before(c.beforeWord) + cues.filter((x) => x.beforeWord === c.beforeWord && x.k < c.k).reduce((s, x) => s + len.get(x.id)!, 0));
  const cueEnd = (id: string) => cueStart.get(id)! + len.get(id)! - 1;
  const total = n + before(n, true);
  const toPoint = (p: Point): DemoPhase["at"] => (p.hold.trim() ? { hold: p.hold } : p.cue.trim() ? { word: cueStart.get(p.cue)! } : { word: moved(p.word) });
  const has = (p: Point) => p.word >= 0 || !!p.hold.trim() || !!p.cue.trim();

  const firsts = raw.events.map((e) => e.firstWord + before(e.firstWord));
  const events: DirectionEvent[] = raw.events.map((e, i) => {
    const out: DirectionEvent = {
      id: e.id,
      firstWord: firsts[i]!,
      lastWord: i + 1 < firsts.length ? firsts[i + 1]! - 1 : total - 1,
      job: e.job,
      knows: e.knows,
      waiting: e.waiting,
      look: e.look,
      feel: e.feel,
      rhythm: e.rhythm,
    };
    if (e.reveal.word >= 0) out.reveal = { word: moved(e.reveal.word), what: e.reveal.what };
    if (e.withhold.what.trim()) out.withhold = { what: e.withhold.what, until: e.withhold.until };
    if (e.holds.length)
      out.holds = e.holds.map((h): Hold => ({
        id: h.id,
        afterWord: h.afterCue.trim() ? cueEnd(h.afterCue) : moved(h.afterWord),
        seconds: +h.seconds.toFixed(2),
        purpose: h.purpose,
        does: h.does,
        ...(h.shows.trim() ? { shows: h.shows } : {}),
      }));
    if (hasDemo(e)) {
      const real = hasTruth(e) ? steps.get(truthKey(e.demo)) : undefined;
      out.demo = {
        what: e.demo.what,
        ...(real ? { truth: { kind: e.demo.truth.kind.trim(), data: JSON.parse(e.demo.truth.data), steps: real } } : {}),
        phases: e.demo.phases.map((ph): DemoPhase => ({
          ...(ph.from || ph.to ? { steps: [ph.from, ph.to] as [number, number] } : {}),
          pace: ph.pace,
          at: toPoint(ph.at),
          ...(has(ph.until) ? { until: toPoint(ph.until) } : {}),
          ...(ph.replay ? { replay: true } : {}),
          why: ph.why,
        })),
      };
    }
    if (e.sound.trim()) out.sound = e.sound;
    if (e.camera.trim()) out.camera = e.camera;
    return out;
  });

  // The beats: each writer beat cut at the cues inside it, with the cue beats placed before the word they precede.
  const beats: Beat[] = [];
  const eventAt = (w: number) => events.find((e) => w >= e.firstWord && w <= e.lastWord);
  const cueBeat = (c: (typeof cues)[number], role: Beat["role"]): Beat => ({ id: `cue${c.k + 1}`, role, text: c.text, claimIds: [], visual: eventAt(cueStart.get(c.id)!)?.look ?? "", emphasis: [], cue: true });
  let start = 0;
  for (const b of script.beats) {
    const bw = beatWords(b);
    const end = start + bw.length; // one past the beat's last word
    const cuts = [...new Set(cues.filter((c) => c.beforeWord > start && c.beforeWord < end).map((c) => c.beforeWord))];
    const bounds = [start, ...cuts, end];
    for (let j = 0; j + 1 < bounds.length; j++) {
      const [from, to] = [bounds[j]!, bounds[j + 1]!];
      for (const c of cues.filter((c) => c.beforeWord === from)) beats.push(cueBeat(c, b.role));
      const text = bw.slice(from - start, to - start).join(" ");
      // The first part keeps the beat's whole emphasis list, so stripping the cues gives the writer's beat back exactly.
      beats.push(j === 0 ? { ...b, text: cuts.length ? text : b.text } : { ...b, id: `${b.id}.${j + 1}`, text, emphasis: b.emphasis.filter((x) => text.includes(x)), of: b.id });
    }
    start = end;
  }
  for (const c of cues.filter((c) => c.beforeWord >= n)) beats.push(cueBeat(c, script.beats.at(-1)?.role ?? "ending"));

  const plan: DirectionPlan = { goal: raw.goal, promise: raw.promise, arc: raw.arc, events, cues: raw.cues.map((c) => ({ beforeWord: c.beforeWord, text: punctuate(c.text) })) };
  const final = { ...script, beats };
  // The renumbering must leave every word in exactly one event; anything else is a bug here, not the model's.
  const broken = coverage(events, scriptWords(final).length);
  if (broken.length) throw new Error(`direction: renumbering broke the events: ${broken.join("; ")}`);
  return { script: final, plan };
}

// A cue is spoken as its own sentence.
const punctuate = (t: string) => {
  const s = t.trim().replace(/\s+/g, " ").replace(/\s*[—–]\s*/g, ", ");
  return /[.?!]["'”’)]*$/.test(s) ? s : `${s}.`;
};

// ---------------------------------------------------------------------------------------------------------------------
// The stage.

// The script with every word numbered, beat by beat, as the model reads it.
export function numberedScript(s: Script): string {
  let w = 0;
  return s.beats.map((b) => {
    const ws = beatWords(b);
    const line = `${b.id} (${b.role}), words ${w} to ${w + ws.length - 1}:\n${ws.map((x, i) => `[${w + i}]${x}`).join(" ")}`;
    w += ws.length;
    return line;
  }).join("\n\n");
}

const brief = (e: DirectionEvent) => [e.job, e.holds?.length ? `${e.holds.length} hold${e.holds.length > 1 ? "s" : ""} (${e.holds.map((h) => `${h.purpose} ${h.seconds}s`).join(", ")})` : "", e.demo ? `demo ${e.demo.phases.map((p) => p.pace).join(">")}` : "", e.withhold ? "withholds" : ""].filter(Boolean).join("; ");

export async function direction(p: Project, force = false) {
  const base = stripCues(p.script!);
  const words = scriptWords(base);
  const who = persona(p.input.persona);
  const secs = seconds(p);
  const kinds = truthKindNames();
  const system = prompt("direction").replace("{{abilities}}", abilities()).replace("{{cueWords}}", String(CUE_WORDS)).replace("{{holdMin}}", String(HOLD_SECONDS[0])).replace("{{holdMax}}", String(HOLD_SECONDS[1]));
  const wishes = asked([...(p.plan?.story ?? []), p.plan?.tone ? `Tone: ${p.plan.tone}` : "", ...(p.plan?.visuals ?? []), ...(p.plan?.sound ?? [])]);
  const claims = p.factSheet?.claims.map((c) => `- ${c.id}: ${c.text}${c.number ? ` (${c.number})` : ""}`).join("\n") ?? "";
  const user = [
    `Topic: ${topic(p)}`,
    viewer(p),
    wishes,
    `Narrator: ${who.label}. ${who.brief}`,
    `Length: ${secs ? `the user asked for about ${secs} seconds` : "no length was asked for"}. The voice reads about ${WORDS_PER_SEC} words a second, so the script alone runs about ${Math.round(words.length / WORDS_PER_SEC)} seconds; your holds add to that.`,
    `Title: ${base.title}\nTakeaway: ${base.takeaway}`,
    `Research claims the script rests on:\n${claims}`,
    `The script, ${words.length} words, every word numbered from 0 (cite these numbers):\n\n${numberedScript(base)}`,
  ].filter(Boolean).join("\n\n");
  const ctx: CompileContext = { fps: 30, width: 1080, height: 1920, frames: 1, theme: themeFrom(p.input.style), kits: SCENE_KITS };

  await stage(p, "direction", [system, user, base, kinds], 0.3, async () => {
    let feedback = "";
    const shown = new Set<string>();
    for (let round = 1; ; round++) {
      const r = await json<RawPlan>({ system, user: user + feedback, schema, schemaName: "direction", effort: "high" });
      const raw = r.value;
      const { steps, problems: refused } = demoSteps(raw, ctx, kinds);
      const found = [...refused, ...problems(raw, words, steps)];
      const unseen = [...steps.entries()].filter(([k]) => !shown.has(k));
      charge(p, "direction", r.usd, `round ${round}: ${raw.events.length} events, ${raw.cues.length} cues, ${found.length} problems${unseen.length ? `, ${unseen.length} step lists to show` : ""}`);
      console.log(`  round ${round}: ${raw.events.length} events, ${raw.events.reduce((s, e) => s + e.holds.length, 0)} holds, ${raw.cues.length} cues, ${found.length} problems`);
      for (const x of found) console.log(`    ${x}`);
      // Steps the model has not seen yet go back once, so its phases name real steps; a plan that keeps the rules on the
      // last round stands even if it changed its demonstration's data again.
      if (!found.length && (!unseen.length || round >= ROUNDS)) {
        const done = applyCues(base, raw, steps);
        p.script = done.script;
        p.direction = done.plan;
        const held = done.plan.events.flatMap((e) => e.holds ?? []).reduce((s, h) => s + h.seconds, 0);
        console.log(`  goal: ${done.plan.goal}\n  arc: ${done.plan.arc}\n  ${done.plan.events.length} events, ${done.plan.cues.length} cues, ${held.toFixed(1)} s of holds`);
        for (const e of done.plan.events) console.log(`    ${e.id} ${e.firstWord}-${e.lastWord}: ${brief(e)}`);
        return;
      }
      if (round >= ROUNDS) throw new Error(`direction: the plan still breaks its rules after ${ROUNDS} rounds:\n${found.map((x) => `  ${x}`).join("\n")}`);
      for (const [k] of unseen) shown.add(k);
      feedback =
        `\n\nYour plan so far:\n${JSON.stringify(raw)}\n\n` +
        (found.length ? `It breaks these rules. Fix each one and return the whole plan:\n${found.map((x) => `- ${x}`).join("\n")}\n\n` : "") +
        (steps.size
          ? "The engine computed the real steps of your demonstrations. Check every phase against them: the steps a phase plays " +
            "must be the ones its words and holds are about, the slow first instance must cover the whole first instance, and a " +
            "hold meant to show a step must come where that step plays. Change phases, holds or cues to fit; never the script. " +
            `Return the whole plan.\n${[...steps.entries()].map(([k, s]) => `${k}:\n${s.map((x, i) => `  ${i + 1} ${x}`).join("\n")}`).join("\n")}`
          : "");
    }
  }, force);
}
