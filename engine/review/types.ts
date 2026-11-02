// Types private to the understanding loop. The ticket that leaves this folder is in engine/core/types.ts.
import type { RepairTicket, TruthEvent } from "../core/types.ts";

export type Word = { text: string; start: number; end: number };

// One finished video and what is known about it. Everything a reviewer may look at, and nothing about how it was made.
export type Cut = {
  id: string; // unique per video file
  request: string; // what the person asked for
  topic: string;
  video: string; // path to an MP4 with sound
  seconds: number;
  words: Word[];
  script: string;
  sources: string[]; // fact sheet lines and references
  truth?: TruthEvent[]; // logs from truth engines, if the scene used any
};

// A stretch of narration: usually a sentence. Reviewers talk about these, which is how a finding gets back to a word.
export type Sentence = { id: string; first: number; last: number; from: number; to: number; text: string };
export type Chunk = { from: number; to: number; sentences: Sentence[] };

export type SentenceRow = {
  id: string;
  seen: string;
  shown: "yes" | "partly" | "no" | "na"; // na: nothing here needs showing
  gone: string; // needed thing that has left the screen
  stale: string; // the voice moved on, the screen did not
  competing: string;
  unreadable: string;
  severity: 1 | 2 | 3;
};
export type ScreenClaim = { sentence: string; text: string };
export type SequenceResult = { rows: SentenceRow[]; claims: ScreenClaim[]; fit: number; frozenSeconds: number; tickets: RepairTicket[] };

export type Idea = { id: string; sentence: string; idea: string };
export type SilentResult = { account: string; recovered: { id: string; score: number; note: string }[]; score: number; tickets: RepairTicket[] };

export type Question = { id: string; kind: "transfer" | "why" | "steps" | "trap"; question: string; answer: string };
export type Quiz = { questions: Question[] };
export type QuizResult = { score: number; byQuestion: Record<string, number> };
export type Condition = "video" | "audio" | "silent" | "nothing";
export type LearnerResult = { arms: Partial<Record<Condition, QuizResult>>; notes: Partial<Record<Condition, string>>; tickets: RepairTicket[] };

export type ClaimCheck = { claim: ScreenClaim; verdict: "ok" | "contradicted" | "unsupported"; why: string; confirmed?: boolean };
export type TruthResult = { checks: ClaimCheck[]; falseClaims: number; unsupported: number; tickets: RepairTicket[] };

// The numbers that go on the scoreboard. All are 0 to 1 except truthErrors and tickets.
export type Scores = {
  overall: number; // mean of soundOff, learned and fit, kept plain so nobody has to trust a formula
  soundOff: number; // ideas recovered with no sound
  learned: number; // quiz score after video with sound
  audioAlone: number | null; // same quiz after the narration alone
  nothing: number | null; // same quiz with nothing watched: how much leaks from what the model already knows
  fit: number; // does the screen show what the voice is on about, across time
  truthErrors: number;
  worst: number; // tickets of severity 3
  tickets: number;
};

export type Report = {
  cut: string;
  request: string;
  at: string;
  usd: number;
  scores: Scores;
  sequence?: SequenceResult;
  silent?: SilentResult;
  learner?: LearnerResult;
  truth?: TruthResult;
  tickets: RepairTicket[];
};
