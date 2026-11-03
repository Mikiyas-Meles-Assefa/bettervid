// The design brain's contract (wave 4, docs/DESIGN-BRAIN.md). Five layers:
//   abilities    engine/design/abilities, engine/design/depict   what the engine can do, with no opinions
//   instruments  engine/design/instruments                      measure and report, never judge
//   agents       engine/design/agents                           decide per video and per moment what good means
//   search       engine/design/search                           try options, measure them against the goals, look, revise
//   suggestions  engine/design/suggest.ts                       style values as starting points an agent may override
// Material readers (engine/design/material) turn the user's files into part cards and requirements.
//
// Nothing in this file is a value of taste. Every number a composition uses lives in a Design (per video) or a
// MomentDesign (per moment) with where it came from: the author, an agent's goal, the search, the style's suggestion or
// the material. Changes to this file need the lead's review: every workstream depends on it.
import type { Scene, SceneDoc } from "../core/types.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Where the video is watched. Written by the director from the platform, purpose and audience; never assumed.

/** A rectangle as fractions of the frame: x0, y0, x1, y1 in 0..1. */
export type Box = [number, number, number, number];

export type Viewing = {
  width: number; // frame size in pixels, any shape (9:16, 16:9, 1:1, 4:5 ...)
  height: number;
  fps: number;
  screen: string; // plain words: "phone in a feed", "TV across a living room", "laptop at a desk", "classroom screen"
  /** How wide the frame looks to the eye: the frame's physical width and the viewing distance, in millimetres. */
  frameWidthMm: number;
  distanceMm: number;
  watch: string; // how the viewer watches: "glancing in a feed", "watching on purpose", "in the background"
  /** Parts of the frame covered by the platform (captions, buttons, a progress bar) or kept clear by the director. */
  uiZones: { box: Box; what: string }[];
  captions: { show: boolean; box?: Box; why: string }; // decided per platform and intent, as everything else
  why: string;
};

// ---------------------------------------------------------------------------------------------------------------------
// The author's intent plan (prompts/intent.md is its guide). It says what matters, never where,
// how big, what color or how it moves.

export type Pace = "slow" | "normal" | "fast";

/** A thing the plan names. `object` is depicted (engine/design/depict); `material` is the user's own piece. */
export type Thing = {
  id: string;
  kind: "thing" | "many" | "object" | "material";
  text?: string; // words or a value, for `thing`
  many?: { n: number; unit: string };
  desc?: string; // for `object`: what it is, in plain words
  material?: { name: string; part?: string }; // for the user's material, by name and part
  line: number;
};

/** What an object does, in the author's plain verbs. Open: a verb the engine does not know is kept and reported. */
export type Act = { verb: string; ids: string[]; to?: string; arg?: string; speed?: Pace; line: number };

export type Moment = {
  word: number; // the spoken word it starts on
  line: number;
  show?: string; // the one subject
  keep: string[]; // support that stays, quieter
  becomes: { id: string; text?: string; n?: number }[];
  from: { a: string; b: string }[];
  compare?: [string, string];
  arrows: { a: string; b: string; label: string }[];
  ask?: string;
  reveal?: string;
  wrong: string[];
  stress: boolean;
  pace: Pace;
  acts: Act[];
  /** Lines of today's scene language inside the moment: pinned constraints, the strongest precedence (section 6). */
  pinned: { line: number; text: string }[];
  plain?: boolean; // the author refused the agents' proposals for this moment
};

export type IntentPlan = { feel?: string; audience?: string; things: Thing[]; moments: Moment[]; notes: string[] };

// ---------------------------------------------------------------------------------------------------------------------
// Instruments: one interface. An instrument takes a compiled scene (or a stretch of it) and returns numbers and, where
// it helps, a picture. It has settings an agent chooses for this video; it never says pass or fail.

export type Word = { text: string; start: number; end?: number };

export type MeasureInput = {
  scene: Scene;
  words: Word[];
  viewing: Viewing;
  /** Frames to measure, inclusive start, exclusive end. Whole scene when absent. */
  window?: [number, number];
  /** Plan names to scene ids (what "flask" is on screen), so goals can name things in the plan's words. */
  ids?: Record<string, string[]>;
  /** Silences in the narration, by id. */
  holds?: { id: string; from: number; to: number }[];
};

export type Reading = {
  instrument: string;
  /** Flat numbers a goal can name, such as "share.flask", "minSizeMm", "peakNew". */
  values: Record<string, number>;
  /** Short plain lines an agent reads beside the frames. */
  notes: string[];
  /** Optional per-frame series for a sheet or a plot. */
  series?: { frame: number; values: Record<string, number> }[];
};

export interface Instrument<S extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  /** What it reports and what its settings mean, for agents choosing settings. */
  describe: string;
  /** Settings suggested for a viewing context. A suggestion, which the agent may replace. */
  suggest(viewing: Viewing): S;
  measure(input: MeasureInput, settings: S): Reading;
}

// ---------------------------------------------------------------------------------------------------------------------
// Goals: written by the director (per video) and the designer (per moment), in plain words, with the instrument
// readings that would show them met. A goal is never a default of the engine.

export type Goal = {
  id: string;
  scope: "video" | "moment";
  moment?: number; // index into IntentPlan.moments for a moment goal
  says: string; // the goal in plain words: "the faint pink is the only thing that changes during the hold"
  instrument: string; // the instrument whose reading shows it
  settings?: Record<string, unknown>; // the instrument settings the agent chose
  value: string; // which reading value, such as "share.flask"
  want: { min?: number; max?: number; near?: number };
  weight: number; // how much it matters against the moment's other goals, 0 to 1
  why: string;
};

/** How far a reading is from a goal: 0 met, 1 far. */
export type GoalScore = { goal: string; value?: number; miss: number };

// ---------------------------------------------------------------------------------------------------------------------
// Decisions: everything a composition needs, each value with where it came from. The composer is a pure function of
// (plan, design, material, theme); the search varies MomentDesign fields; agents write goals and overrides.

export type From = "author" | "director" | "designer" | "search" | "style" | "material" | "viewer";
export type Decided<T> = { value: T; from: From; why?: string };

export type Focus = "one" | "two" | "none" | "hidden" | "all";

export type CameraPlan = { zoom: number; at: [number, number]; move: "hold" | "push" | "drift" | "cut" | "follow"; frames?: number };

export type MomentDesign = {
  moment: number;
  importance: Decided<number>; // 0..1, the director's: how much this moment carries the video (spends search budget)
  focus: Decided<Focus>;
  /** The subject's size as a share of the usable frame's shorter side, and where its center sits (fractions). */
  subjectScale: Decided<number>;
  subjectAt: Decided<[number, number]>;
  /** How the support sits around the subject: an open word the composer understands (stack, row, around, split, inset). */
  arrangement: Decided<string>;
  supportOpacity: Decided<number>; // how far support steps back (the style's dim is the suggestion)
  typeScale: Decided<number>; // multiplier on the style's type scale for this moment
  lead: Decided<number>; // seconds a change starts before its word (negative: after)
  dwell: Decided<number>; // least seconds the moment holds before the next may take the eye
  camera: Decided<CameraPlan>;
  /** Proposals the agents add (a pointer, a level line, a compare-on-one-scale), each with its reason. */
  proposals: Decided<{ kind: string; ids: string[]; args?: Record<string, unknown> }>[];
};

/** How a demonstration plays: real speed, slowed, replayed; the director's call from physics and the viewer. */
export type DemoPlan = { moment: number; act: number; speed: Decided<"real" | "slow" | "fast" | number>; replay?: Decided<{ speed: "real" | "slow" | number }>; why: string };

export type Design = {
  viewing: Viewing;
  tempo: Decided<number>; // the video's pace multiplier (feel and audience)
  moments: MomentDesign[];
  demos: DemoPlan[];
  /** Style values the agents overrode for this video, each with its reason. */
  overrides: { key: string; value: unknown; why: string }[];
  goals: Goal[];
  decisions: DecisionRecord[];
  budget: { candidatesPerMoment: number; rounds: number; calls: number }; // a setting per video
};

/** Kept for review (the contract asks decisions to go to review). */
export type DecisionRecord = { area: string; moment?: number; choice: string; goals: string[]; readings?: Record<string, number>; from: From; why: string };

// ---------------------------------------------------------------------------------------------------------------------
// Material: the user's files read once into part cards (shared with wave 5).

export type ChartData = {
  kind: "bars" | "line" | "pie" | "table" | string;
  orient?: "v" | "h";
  title?: string;
  labels: string[];
  values: number[];
  unit?: string;
  ymax?: number;
  plot?: Box; // the plot area inside the picture
  barFrac?: number;
  texts?: Record<string, string>;
  /** A total the picture itself states, when it states one (checked against the values). */
  total?: number;
  /** The card's part that shows each value, in the order of `labels` (checked against the values: bar lengths). */
  parts?: string[];
};

export type Requirement = {
  id: string;
  source: { file: string; where?: string }; // the file and place that states it
  applies?: string; // the file or part it is about (another file in the project, often)
  kind: string; // open: "show exactly", "use colors", "must say", "never say", "legible", "on screen for" ...
  detail: string;
  why: string;
};

export type PartCard = {
  name: string; // the name the plan uses
  file: string;
  size?: [number, number];
  kind: string; // open: chart, photo, slide, document, code, diagram, map, screenshot ...
  about: string;
  parts: Record<string, { box?: Box; about: string; text?: string }>;
  data?: ChartData;
  text?: string;
  requirements: Requirement[];
  /** The reader's check of its reading against the source. */
  checked: { ok: boolean; notes: string[] };
};

// ---------------------------------------------------------------------------------------------------------------------
// Agents: every reasoning step goes through a Reasoner. In production it is a Meta model (Spark); in development a
// Claude subagent answers files (the bench protocol), so the engine never calls a model it cannot pay for.

export type AgentRole = "director" | "designer" | "viewer" | "reader" | "author" | "depicter";

export type AgentTask = {
  role: AgentRole;
  id: string; // unique per run, such as "designer.m3.r1"
  system: string;
  request: string;
  /** JSON schema of the answer, when the answer is structured. */
  schema?: Record<string, unknown>;
  /** Pictures to look at (contact sheets, keyframes, the user's material). */
  images?: string[];
};

/** `pending` means the task was written out and the caller should stop and resume once it is answered. */
export type Answer<T> = { status: "answered"; value: T } | { status: "pending"; file: string };

export interface Reasoner {
  ask<T>(task: AgentTask): Promise<Answer<T>>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Search: candidates are designs of a moment (or a stretch), rendered and measured against the goals.

export type Candidate = { id: string; moment: number; design: MomentDesign; doc?: SceneDoc; readings: Reading[]; scores: GoalScore[]; total: number; sheet?: string };
