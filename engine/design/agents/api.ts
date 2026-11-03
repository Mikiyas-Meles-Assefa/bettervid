// The reasoning agents' contract (docs/DESIGN-BRAIN.md 2.3): what each agent is given, what it answers, and how an
// answer changes the Design. Implemented in engine/design/agents/*.ts (director.ts, designer.ts, viewer.ts); the search
// loop (engine/design/search) calls them through the Reasoner. In production the Reasoner is Spark; in development a
// Claude subagent answering files. Changes here need the lead's review.
import type { Theme } from "../../core/types.ts";
import type { AgentTask, Candidate, Design, Goal, IntentPlan, MomentDesign, PartCard, Reading, Requirement, Viewing, Word } from "../types.ts";

/** What the director knows about the video: everything a top director would ask before deciding anything. */
export type DirectorInput = {
  plan: IntentPlan;
  words: Word[];
  holds: { id: string; afterWord: number; seconds: number; purpose?: string }[];
  cards: PartCard[];
  requirements: Requirement[];
  /** The user's request and what the plan stage knows: purpose, audience, platform, any explicit asks. Plain text. */
  brief: string;
  /** The direction plan's events when there is one (wave 2), as plain text. */
  direction?: string;
  theme: Theme;
  styleName: string;
  /** The viewing the platform implies, if known; the director confirms or replaces it. */
  viewing?: Viewing;
  /** The design the engine would start from (style suggestions), so the director overrides only what it means to. */
  start: Design;
  /** The plan names the start's composition draws as things of their own: a goal on another name is refused. */
  drawn?: string[];
};

export type DirectorAnswer = {
  viewing: Viewing;
  tempo: { value: number; why: string };
  /** Per plan moment (by index): importance 0..1 and what the viewer should know, feel and wait for after it. */
  moments: { moment: number; importance: number; know: string; feel?: string; waiting?: string; focus?: string }[];
  demos: { moment: number; act: number; speed: "real" | "slow" | "fast" | number; replay?: { speed: "real" | "slow" | number }; why: string }[];
  goals: Goal[]; // video goals
  overrides: { key: string; value: unknown; why: string }[];
  /** Budget per video: candidates per moment, rounds, model calls (a setting; the director spends unevenly by importance). */
  budget: { candidatesPerMoment: number; rounds: number; calls: number };
  /** Corrections of the plan against the material or the world: never silent; each is a visible note. */
  corrections: { moment?: number; was: string; now: string; source: string }[];
  /** Viewers the panel should include for this audience, beyond the standing seats. */
  seats: { who: string; why: string }[];
  why: string;
};

export type DesignerInput = {
  plan: IntentPlan;
  moment: number;
  design: Design;
  director: DirectorAnswer;
  cards: PartCard[];
  words: Word[];
  /** The style's suggestions with reasons (suggest.ts styleValues), keys the designer may override. */
  styleValues: Record<string, { value: unknown; why: string }>;
  /**
   * After a search round: the best candidates' readings and goal scores, and their contact sheet. `final`: the moment's
   * rounds or calls are spent, so this look ends its search and the designer picks one of these candidates.
   */
  round?: { candidates: Candidate[]; sheet?: string; readings: Reading[]; final?: boolean };
  /** This moment's share of the search as the search allotted it; from the design's budget when absent. */
  share?: { candidates: number; rounds: number; calls: number };
  /** The plan names the composition draws as things of their own: what an instrument can measure by name. */
  drawn?: string[];
  /** The instruments it can set goals on, with their value names and settings (from the registry's describe). */
  instruments: { name: string; describe: string; suggested: Record<string, unknown> }[];
  /** Silences in the narration (timing goals name them as hold.<id>), and requirements stated across files. */
  holds?: { id: string; afterWord: number; seconds: number; purpose?: string }[];
  requirements?: Requirement[];
  /** The user's request in plain text, as the director had it. */
  brief?: string;
};

/** The space a search explores for one moment: per MomentDesign field, the values worth trying. */
export type SearchSpace = Partial<Record<"subjectScale" | "subjectAt" | "arrangement" | "supportOpacity" | "typeScale" | "lead" | "dwell" | "camera", unknown[]>>;

export type DesignerAnswer = {
  goals: Goal[]; // moment goals, each with instrument settings
  space: SearchSpace;
  overrides: { key: string; value: unknown; why: string }[]; // style keys, written key@N for this moment
  proposals: { kind: string; ids: string[]; args?: Record<string, unknown>; why: string }[];
  /** Why each field of the space holds the values it does (a field with one value is set, Decided with this why). */
  reasons?: Partial<Record<keyof SearchSpace, string>>;
  /** The moment's focus when the designer decides it differently from the director. */
  focus?: { value: "one" | "two" | "none" | "hidden" | "all"; why: string };
  /** After a round: keep one candidate, or revise the space. */
  pick?: string;
  done: boolean;
  why: string;
};

export type ViewerInput = {
  /** One contact sheet per finalist (or one sheet with every finalist labelled), and the words spoken in its window. */
  sheets: { candidate: string; image: string }[];
  transcript: string;
  seats: { who: string; why: string }[];
  goals: Goal[];
  /** Style keys a fix may name besides the search's fields (styleValues' keys); the style's full list when absent. */
  styleKeys?: string[];
  /** How many moments the video has, so a fix may name key@N; any N is refused when absent. */
  moments?: number;
  /** Each finalist's current values (by candidate id), so a fix can say what a field becomes. */
  designs?: Record<string, MomentDesign>;
};

export type ViewerAnswer = {
  seats: { who: string; candidate: string; saw: string; remembers: string; problems: string[]; wouldKeepWatching: boolean }[];
  pick: string;
  fixes: { candidate: string; field: string; value: unknown; why: string }[];
};

/** Implemented by engine/design/agents. Tasks are pure functions of their input; apply functions are pure too. */
export type Agents = {
  directorTask(input: DirectorInput): AgentTask;
  applyDirector(design: Design, answer: DirectorAnswer): Design;
  designerTask(input: DesignerInput): AgentTask;
  /** `picked` is the round's candidate the answer picks, when it picks one: its MomentDesign becomes the moment's. */
  applyDesigner(design: Design, moment: number, answer: DesignerAnswer, picked?: Candidate): Design;
  viewerTask(input: ViewerInput): AgentTask;
};
