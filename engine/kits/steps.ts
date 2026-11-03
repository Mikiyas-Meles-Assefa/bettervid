// What every truth kit shares. A kit lays out all of its parts once, from the real result, and writes a story: an ordered
// list of steps, each a few property changes on those parts. One behavior, `steps`, plays any story at spoken moments.
//
// Nothing is computed while playing: the story is rebuilt from the same input, so the frames are pure, and a part that a
// step changes always exists from the start, which keeps every id addressable by the rest of the scene.
import { when } from "../core/compile.ts";
import type { Behavior, CompileContext, Ease, Kit, NodeSpec, Props, Track, Value } from "../core/types.ts";

// `at` and `dur` are shares of the step's time, 0 to 1. `dur: 0` is an instant change at `at`.
export type Change = { id: string; prop: string; value: Value; at: number; dur: number; ease?: Ease };
export type Play = { id: string; behavior: string; args?: Record<string, Value>; at: number };
export type StoryStep = { say: string; changes: Change[]; plays: Play[]; after: Map<string, Value> };
// `drawn`: one sentence on how the thing is drawn and which way its moves go, so a writer can check the picture against
// words like down, up, left or right, and choose another form when they disagree.
export type Board = { parts: NodeSpec[]; steps: StoryStep[]; drawn?: string };
export type Maker = (id: string, data: Record<string, unknown>, ctx: CompileContext) => Board;

const DEFAULTS: Props = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, drawn: 1 };
const k = (id: string, prop: string) => `${id}\u0000${prop}`;

// Writes a story while it is being worked out. `flash` changes last only until the next step begins.
export class Story {
  readonly steps: StoryStep[] = [];
  private now = new Map<string, Value>();
  private flashed = new Map<string, Value>(); // what each flashed property goes back to
  private readonly known: Map<string, NodeSpec>;
  readonly parts: NodeSpec[];
  constructor(parts: NodeSpec[]) {
    this.parts = parts;
    this.known = new Map(parts.map((p) => [p.id, p]));
  }
  value(id: string, prop: string): Value | undefined {
    return this.now.get(k(id, prop)) ?? this.known.get(id)?.props?.[prop] ?? DEFAULTS[prop];
  }
  step(say: string): this {
    this.close();
    this.steps.push({ say, changes: [], plays: [], after: new Map() });
    for (const [key, value] of this.flashed) {
      const [id, prop] = key.split("\u0000") as [string, string];
      this.write(id, prop, value, 0, 0.3);
    }
    this.flashed.clear();
    return this;
  }
  set(id: string, prop: string, value: Value, at = 0, dur = 0.5, ease?: Ease): this {
    if (this.flashed.has(k(id, prop))) this.flashed.delete(k(id, prop));
    this.write(id, prop, value, at, dur, ease);
    return this;
  }
  flash(id: string, prop: string, value: Value, at = 0, dur = 0.3): this {
    if (!this.flashed.has(k(id, prop))) this.flashed.set(k(id, prop), this.value(id, prop)!);
    this.write(id, prop, value, at, dur);
    return this;
  }
  play(id: string, behavior: string, at = 0, args?: Record<string, Value>): this {
    this.need(id);
    this.current().plays.push({ id, behavior, at, ...(args ? { args } : {}) });
    return this;
  }
  // Ends the story: what each step leaves behind is recorded, so playing can begin at any step.
  finish(): StoryStep[] {
    this.close();
    return this.steps;
  }
  private close() {
    const s = this.steps.at(-1);
    if (!s) return;
    // What stays once flashes are over: the value under each flash.
    const after = new Map(this.now);
    for (const [key, value] of this.flashed) after.set(key, value);
    s.after = after;
  }
  private current() {
    const s = this.steps.at(-1);
    if (!s) throw new Error("a change was written before the first step");
    return s;
  }
  private need(id: string) {
    if (!this.known.has(id)) throw new Error(`the story names ${id}, which was never made`);
  }
  private write(id: string, prop: string, value: Value, at: number, dur: number, ease?: Ease) {
    this.need(id);
    this.current().changes.push({ id, prop, value, at, dur, ...(ease ? { ease } : {}) });
    this.now.set(k(id, prop), value);
  }
}

// Every kind that tells a story, so the one `steps` behavior can find the story of any part it is given.
const makers = new Map<string, Maker>();
const boards = new Map<string, Board>();

function boardFor(kind: string, id: string, spec: string, ctx: CompileContext): Board {
  const key = `${kind}\u0000${id}\u0000${spec}\u0000${ctx.theme.fonts.mono ?? ""}\u0000${ctx.theme.fonts.body}\u0000${ctx.width}x${ctx.height}`;
  const known = boards.get(key);
  if (known) return known;
  const make = makers.get(kind);
  if (!make) throw new Error(`no truth kit makes ${kind}`);
  const board = make(id, JSON.parse(spec), ctx);
  if (boards.size > 200) boards.clear();
  boards.set(key, board);
  return board;
}

// Turns a maker into a kind. The input rides on the root group, so playing later finds the very same story.
export function truthKind(kind: string, make: Maker, allowed: string[]): NonNullable<Kit["kinds"]>[string] {
  makers.set(kind, make);
  const ok = new Set([...allowed, "w", "h", "done"]);
  return (n, ctx) => {
    const data = { ...(n.data ?? {}) };
    for (const key of Object.keys(data)) if (!ok.has(key)) throw new Error(`${kind} has no setting "${key}". It takes: ${allowed.join(", ")}, and done`);
    // `done=K`: the thing first shows how it stands once steps 1 to K are done, as when a demonstration goes on from an
    // earlier stretch. Its steps then play on from K + 1.
    const after = data.done === undefined ? 0 : Number(data.done);
    delete data.w;
    delete data.h;
    delete data.done;
    const spec = JSON.stringify(data);
    const board = boardFor(kind, n.id, spec, ctx);
    if (!Number.isInteger(after) || after < 0 || after > board.steps.length) throw new Error(`done= is how many of its ${board.steps.length} steps are already done, a whole number from 0 to ${board.steps.length}, not ${n.data?.done}`);
    const [root, ...rest] = board.parts;
    if (!root || root.id !== n.id || root.kind !== "group") throw new Error(`${kind} must start with its own group`);
    const done = after ? board.steps[after - 1]!.after : new Map<string, Value>();
    const at = (part: NodeSpec): NodeSpec => {
      const own = [...done].filter(([key]) => key.startsWith(`${part.id}\u0000`));
      return own.length ? { ...part, props: { ...part.props, ...Object.fromEntries(own.map(([key, v]) => [key.split("\u0000")[1]!, v])) } } : part;
    };
    return [{ ...root, parent: n.parent, props: { ...n.props, ...root.props, truth: kind, spec, played: after } }, ...rest.map(at)];
  };
}

// The moments `at=@12,@15,@20` arrive as one string, since the language only turns a single moment into a frame.
function moments(raw: Value, ctx: CompileContext): number[] {
  if (typeof raw === "number") return [raw];
  if (Array.isArray(raw)) throw new Error(`at= takes spoken moments such as @12,@15, not plain numbers`);
  return String(raw).split(",").filter(Boolean).map((tok) => {
    const m = /^@(\d+)(?:([+-])(\d+))?$/.exec(tok.trim());
    if (!m) throw new Error(`at= takes spoken moments such as @12,@15+4, and "${tok}" is not one`);
    const word = Number(m[1]);
    if (!ctx.words?.[word]) throw new Error(`at= names spoken word ${word}, which does not exist`);
    return when({ word, offset: m[2] ? Number(`${m[2]}${m[3]}`) : 0 }, ctx);
  });
}

const int = (v: Value | undefined, name: string): number | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`${name}= must be a whole number, not ${JSON.stringify(v)}`);
  return v;
};

export function stepList(steps: StoryStep[]): string {
  const shown = steps.map((s, i) => `${i + 1} ${s.say}`);
  return shown.length > 40 ? `${shown.slice(0, 36).join("; ")}; ... ${shown.slice(-3).join("; ")}` : shown.join("; ");
}

// How fast a stretch of steps plays. `each` is the time a step gets when nothing else says; `least` is the shortest
// time in which a step at that pace can still be watched, so a stretch squeezed below it is refused; `move` is how long
// one change takes. In seconds.
export const PACES = {
  slow: { each: 1.8, least: 1.1, move: 0.8 },
  normal: { each: 0.8, least: 0.4, move: 0.45 },
  fast: { each: 0.3, least: 0.12, move: 0.22 },
} as const;
export type Pace = keyof typeof PACES;

// When the steps of one `do steps` play, as playSteps places them (it also checks them; this does not): which steps,
// the frame each begins, and the longest one change takes. For the camera, which follows what the steps work on.
export function stepSchedule(args: Record<string, Value>, start: number, n: number, ctx: CompileContext): { from: number; to: number; times: number[]; longest: number; pace?: Pace } {
  const from = typeof args.from === "number" ? args.from : 1;
  const to = typeof args.to === "number" ? args.to : n;
  const count = Math.max(0, to - from + 1);
  const paceName = args.pace === undefined ? undefined : String(args.pace);
  const pace = paceName && paceName in PACES ? PACES[paceName as Pace] : undefined;
  const longest = Number(args.frames ?? (pace ? Math.max(4, Math.round(pace.move * ctx.fps)) : Math.round(ctx.theme.moveFrames * 1.2)));
  let times: number[];
  if (args.at !== undefined) times = moments(args.at, ctx);
  else if (args.until !== undefined) times = Array.from({ length: count }, (_, i) => Math.round(start + ((Number(args.until) - start) / count) * i));
  else {
    const each = Number(args.each ?? (pace ? Math.round(pace.each * ctx.fps) : Math.round(ctx.theme.moveFrames * 1.5)));
    times = Array.from({ length: count }, (_, i) => start + Math.round(each * i));
  }
  return { from, to, times, longest, ...(pace ? { pace: paceName as Pace } : {}) };
}

// Plays a story, or part of it. Steps count from 1.
//   at=@12,@15,...   one spoken moment per step played
//   until=@40        spread the steps evenly from now until then
//   each=20          frames between steps (the default)
//   pace=slow        slow, normal or fast: the time each step gets, unless at= or until= place them; with them, the
//                    least time a step may have, so a stretch that cannot fit its steps at that pace is an error
//   from=3 to=5      only these steps; from=3 first jumps, in no time, to how things stand after step 2
//   frames=24        the longest any one change takes
export const playSteps: Behavior = ({ target, start, args, ctx, tools }) => {
  const props = tools.props(target);
  if (typeof props.truth !== "string" || typeof props.spec !== "string") throw new Error(`steps plays a truth thing (matrix, det, cramer, matvec, sort, trace, dijkstra), and ${target} is not one`);
  const { steps } = boardFor(props.truth, target, props.spec, ctx);
  const n = steps.length;
  if (!n) throw new Error(`${target} has no steps to play; give it something to compute`);
  const from = int(args.from, "from") ?? 1;
  const to = int(args.to, "to") ?? n;
  if (from < 1 || to > n || from > to) throw new Error(`${target} has steps 1 to ${n}, so from=${from} to=${to} does not fit. Its steps: ${stepList(steps)}`);
  // Playing steps that already played would show the same work twice; a scene that wants more goes on from where it was.
  const done = Number(tools.value(target, "played", start) ?? props.played ?? 0);
  if (from <= done) throw new Error(`${target} already played steps 1 to ${done} before this moment, so this play must start at from=${done + 1}${done < n ? "" : ", but there are no steps left"}. Its steps: ${stepList(steps)}`);
  const count = to - from + 1;
  const paceName = args.pace === undefined ? undefined : String(args.pace);
  if (paceName !== undefined && !(paceName in PACES)) throw new Error(`pace must be slow, normal or fast, not ${paceName}`);
  const pace = paceName ? PACES[paceName as Pace] : undefined;
  const longest = Number(args.frames ?? (pace ? Math.max(4, Math.round(pace.move * ctx.fps)) : Math.round(ctx.theme.moveFrames * 1.2)));
  const least = pace ? Math.max(2, Math.round(pace.least * ctx.fps)) : 2;
  const seconds = (f: number) => `${(f / ctx.fps).toFixed(1)} s`;
  // A stretch too short for its steps is refused with what would fit, so a writer can play fewer, go faster, or say that
  // the time it was given is too short.
  const tooShort = (room: number, where: string) => {
    const fit = Math.max(0, Math.floor(room / least));
    const faster = paceName === "slow" ? " or pace=normal" : paceName === "normal" ? " or pace=fast" : "";
    return new Error(`${target} plays ${count} steps (${from} to ${to})${paceName ? ` at pace=${paceName}` : ""}, which needs at least ${least} frames a step (${seconds(least * count)} in all), but ${where} leaves ${room} frames (${seconds(room)}). ${fit ? `At this pace ${fit} step${fit > 1 ? "s" : ""} fit${fit > 1 ? "" : "s"} (to=${from + fit - 1}); play the rest in a later stretch${faster}` : `Not one step fits; give these steps a longer stretch${faster}`}. If the time is a hold the direction gave and the steps must play there at this pace, the hold is too short: keep what fits and write a line \`# needs HOLD ${Math.ceil((least * count) / ctx.fps)}s: why\` so the hold can be made longer.`);
  };
  let times: number[];
  if (args.at !== undefined) {
    times = moments(args.at, ctx);
    if (times.length !== count) throw new Error(`${target} plays ${count} steps (${from} to ${to}) but at= gives ${times.length} moments. Give one per step, or use until=@N to spread them. Its steps: ${stepList(steps)}`);
    if (times.some((t, i) => i > 0 && t < times[i - 1]!)) throw new Error(`the moments in at= must not go back in time`);
    if (times[0]! < start) throw new Error(`the first moment in at= comes before the state that plays it`);
    const tight = times.findIndex((t, i) => i > 0 && t - times[i - 1]! < least);
    if (pace && tight > 0) throw new Error(`${target} plays step ${from + tight - 1} at frame ${times[tight - 1]} and step ${from + tight} at frame ${times[tight]}, only ${times[tight]! - times[tight - 1]!} frames apart, but pace=${paceName} needs at least ${least} frames a step. Space those moments further apart, or choose a faster pace.`);
  } else if (args.until !== undefined) {
    const end = Number(args.until);
    if (!(end > start)) throw new Error(`until= must come after the state that plays the steps`);
    if ((end - start) / count < least) throw tooShort(end - start, "until=");
    const gap = (end - start) / count;
    times = Array.from({ length: count }, (_, i) => Math.round(start + gap * i));
  } else {
    const each = Number(args.each ?? (pace ? Math.round(pace.each * ctx.fps) : Math.round(ctx.theme.moveFrames * 1.5)));
    if (!(each >= 1)) throw new Error(`each= must be at least 1 frame`);
    if (pace && each < least) throw new Error(`each=${each} is quicker than pace=${paceName} allows (${least} frames a step). Give each= at least ${least}, or a faster pace.`);
    times = Array.from({ length: count }, (_, i) => start + Math.round(each * i));
    if (times.at(-1)! >= ctx.frames) throw tooShort(Math.max(0, ctx.frames - start), "the end of the video");
  }

  const tracks: Track[] = [];
  const valueAt = (id: string, prop: string, f: number): Value => tools.value(id, prop, f) ?? tools.props(id)[prop] ?? DEFAULTS[prop] ?? 0;
  const put = (id: string, prop: string, value: Value, s: number, d: number, ease?: Ease) => {
    const from = valueAt(id, prop, s);
    const t: Track = d <= 0 ? { target: id, prop, keys: [{ at: s, value: from }, { at: s + 1, value, ease: "step" }] } : { target: id, prop, keys: [{ at: s, value: from }, { at: s + d, value, ease: ease ?? "smooth" }] };
    tools.write(t);
    tracks.push(t);
  };
  // Starting part way: everything earlier steps left behind is put in place at once. Where they already played this
  // changes nothing.
  if (from > 1) for (const [key, value] of steps[from - 2]!.after) {
    const [id, prop] = key.split("\u0000") as [string, string];
    put(id, prop, value, Math.max(0, start - 1), 0);
  }
  for (let i = 0; i < count; i++) {
    const step = steps[from - 1 + i]!;
    const t0 = times[i]!;
    const room = i + 1 < count ? times[i + 1]! - t0 : longest;
    const len = Math.max(2, Math.min(longest, room));
    const changes = [...step.changes].sort((a, b) => a.at - b.at);
    for (const c of changes) put(c.id, c.prop, c.value, Math.round(t0 + c.at * len), c.dur <= 0 ? 0 : Math.max(1, Math.round(c.dur * len)), c.ease);
    for (const p of step.plays) tools.run(p.behavior, p.id, Math.round(t0 + p.at * len), p.args ?? {});
  }
  // Flashes on the last step played go back once its time is over, unless it ends the whole story.
  if (to < n) {
    const end = times.at(-1)! + longest;
    for (const [key, value] of steps[to - 1]!.after) {
      const [id, prop] = key.split("\u0000") as [string, string];
      if (valueAt(id, prop, end) !== value) put(id, prop, value, end, Math.round(longest / 3));
    }
  }
  tools.write({ target, prop: "played", keys: [{ at: start, value: to, ease: "step" }] });
  tools.emit({ name: "steps", at: times[0], data: { target, from, to } });
  // One event per step, so anything reading the scene (a report, the sound) knows when each step really plays.
  for (let i = 0; i < count; i++) tools.emit({ name: "step", at: times[i]!, data: { target, step: from + i, say: steps[from + i - 1]!.say } });
  return [];
};

// The one behavior every truth kit adds, with the one line that teaches it.
export const STEPS_DOC = "`do steps ID at=@12,@15,@20` plays the steps of a truth thing (matrix, det, cramer, matvec, sort, trace, dijkstra), one spoken moment per step: the first time a process plays, and whenever the words name its steps one by one, give each step the moment its words are said with at=, so the value moves as it is spoken and not before. `until=@40` spreads the steps evenly to that moment, which fits a stretch the words sum up (a replay, the rest going the same way), not steps the words call out; or `each=FRAMES`. After the build you are shown when each step really played and the words under it. `from=K to=K` (counted from 1) plays only those steps, so several states can each play the next few; a step never plays twice. `done=K` on the thing itself shows it as it stands once steps 1 to K are done, for a stretch that takes a demonstration over part way through; its plays then start at from=K+1. `pace=slow|normal|fast` sets how long each step takes and how long its moves last; with `until=` or `at=` it is the least time a step may have, and a stretch too short for its steps at that pace is an error that says how many fit. A demonstration in phases is one `do steps` per phase: `do steps s from=1 to=2 pace=slow until=@h1`, then `do steps s from=3 to=9 pace=fast until=@40`. To show the same process again (a replay, or the same input run beside it), make a second thing with `replay=ID`, which takes the first one's input, and play its steps. Every number, result and path it shows is computed: point at its parts (light, tag, mark) rather than writing results yourself. In the main column it grows into the room the words leave on its own; `w=` and `h=` give it a different shape of box to start from";

// ---------- Layout helpers shared by the kits ----------

export const CHAR = 0.56; // average character width in em, as the language estimates it
export const MONO = 0.6;
export const textWidth = (s: string, size: number, mono = false) => Math.max(0.6, [...s].length) * size * (mono ? MONO : CHAR);

// A square bracket, open to the right (side -1) or the left (side 1).
export function bracket(x: number, top: number, bottom: number, side: -1 | 1, lip = 18): number[] {
  return [x - side * lip, top, x, top, x, bottom, x - side * lip, bottom];
}

// An invisible box around everything a kit may ever show, so it is fitted to its slot by its largest state.
export function frame(id: string, parent: string, l: number, t: number, r: number, b: number): NodeSpec {
  return { id, kind: "path", parent, props: { points: [l, t, r, t, r, b, l, b, l, t], stroke: "none", fill: "none", opacity: 0 } };
}

export function text(id: string, parent: string, x: number, y: number, value: string, size: number, more: Props = {}): NodeSpec {
  return { id, kind: "text", parent, props: { x, y, text: value, size, color: "ink", ...more } };
}

/** When each step of every truth thing really played, with the words spoken then: one line per thing. Read from the
 * scene's `step` events, so it reports what was built, not what was written. `words` carry seconds. */
export function stepLines(events: { name: string; at?: number; data?: Record<string, unknown> }[], words: { text: string; start: number }[], fps: number): string[] {
  const by = new Map<string, { step: number; at: number; say: string }[]>();
  for (const e of events) {
    if (e.name !== "step" || !e.data) continue;
    const { target, step, say } = e.data as { target?: string; step?: number; say?: string };
    if (typeof target !== "string" || typeof step !== "number" || typeof e.at !== "number") continue;
    if (!by.has(target)) by.set(target, []);
    by.get(target)!.push({ step, at: e.at, say: String(say ?? "") });
  }
  const under = (frame: number) => {
    const t = frame / fps;
    let k = words.findIndex((w) => w.start > t);
    if (k < 0) k = words.length;
    const from = Math.max(0, k - 1);
    const text = words.slice(from, from + 4).map((w) => w.text).join(" ");
    return text ? `"${text}"` : "silence";
  };
  return [...by.entries()].map(([target, list]) => {
    list.sort((a, b) => a.at - b.at);
    return `${target} played ${list.map((s) => `step ${s.step} (${s.say}) at ${(s.at / fps).toFixed(1)} s under ${under(s.at)}`).join("; ")}. A step whose words come earlier or later than it plays moves at the wrong moment: give it that moment with at=.`;
  });
}

// How a truth thing is drawn, in one sentence, for the same planner: which way its moves go on this frame.
export function truthDrawn(kind: string, id: string, data: Record<string, unknown>, ctx: CompileContext): string | undefined {
  const { w: _w, h: _h, ...rest } = data;
  return boardFor(kind, id, JSON.stringify(rest), ctx).drawn;
}

// The steps a truth thing will play, in words, for a planner deciding which spoken moment each step belongs to.
// Throws, as the kind does, on bad input.
export function truthSteps(kind: string, id: string, data: Record<string, unknown>, ctx: CompileContext): string[] {
  const { w: _w, h: _h, ...rest } = data;
  return boardFor(kind, id, JSON.stringify(rest), ctx).steps.map((s) => s.say);
}

// The story of a truth thing already made, by the kind and spec its root group carries, for layout to see where its
// parts go while it plays.
export const storyOf = (kind: string, id: string, spec: string, ctx: CompileContext): Board => boardFor(kind, id, spec, ctx);
