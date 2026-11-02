// Runs the reviewers on one cut, merges their tickets and fills in the scores. Also the repair loop.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RepairTicket } from "../core/types.ts";
import { learnerReview, type LearnerDeps } from "./learner.ts";
import { clip, duration, frame, motion, soundOnly } from "./media.ts";
import type { Ask } from "./model.ts";
import { sequenceReview } from "./sequence.ts";
import { silentReview } from "./silent.ts";
import { truthReview } from "./truth.ts";
import type { Cut, Idea, Needs, Quiz, Report, Scope, Scores } from "./types.ts";

// Same problem from the same reviewer in touching stretches is one ticket. Worst first, then in order of time.
export function mergeTickets(all: RepairTicket[], gap = 1): RepairTicket[] {
  const sorted = [...all].sort((a, b) => a.from - b.from);
  const out: RepairTicket[] = [];
  for (const t of sorted) {
    const prev = out.findLast((x) => x.reviewer === t.reviewer && x.problem === t.problem);
    if (prev && t.from <= prev.to + gap && t.problem !== "not_learned" && t.problem !== "idea_missing") {
      if (t.to > prev.to) {
        prev.to = t.to;
        prev.until = t.until;
        if (!prev.said.includes(t.said)) prev.said += ` ${t.said}`;
      }
      prev.severity = Math.max(prev.severity, t.severity) as RepairTicket["severity"];
      if (!prev.wrong.includes(t.wrong)) prev.wrong += ` ${t.wrong}`;
      continue;
    }
    out.push({ ...t });
  }
  return out.sort((a, b) => b.severity - a.severity || a.from - b.from);
}

export function score(r: Pick<Report, "sequence" | "silent" | "learner" | "truth" | "tickets">): Scores {
  const soundOff = r.silent?.score ?? 0;
  const learned = r.learner?.arms.video?.score ?? 0;
  const fit = r.sequence?.fit ?? 0;
  const held = r.sequence?.held ?? 0;
  return {
    overall: (soundOff + learned + fit + held) / 4,
    soundOff,
    learned,
    audioAlone: r.learner?.arms.audio?.score ?? null,
    nothing: r.learner?.arms.nothing?.score ?? null,
    fit,
    held,
    silentQuiz: r.learner?.arms.silent?.score ?? null,
    truthErrors: r.truth?.falseClaims ?? 0,
    worst: r.tickets.filter((t) => t.severity === 3).length,
    tickets: r.tickets.length,
  };
}

// What a finished project folder knows, as a cut. `file` picks one of the renders in it.
export function cutFromProject(projectDir: string, file = "video.mp4"): Cut {
  const p = JSON.parse(readFileSync(join(projectDir, "project.json"), "utf8"));
  const video = join(projectDir, file);
  return {
    id: `${p.id}/${file}`,
    request: p.input.prompt,
    topic: p.plan?.topic ?? p.input.prompt,
    video,
    seconds: duration(video),
    words: p.narration.words,
    script: p.script.beats.map((b: { text: string }) => b.text).join("\n"),
    sources: [
      ...(p.factSheet?.claims ?? []).map((c: { text: string }) => c.text),
      ...(p.factSheet?.sources ?? []).map((s: { title: string; url: string }) => `${s.title}: ${s.url}`),
    ],
  };
}

export type ReviewOptions = {
  ask: Ask;
  ideas: Idea[];
  quiz: Quiz;
  scope: Scope;
  needs: Needs;
  shared?: LearnerDeps["shared"]; // arms that do not depend on the picture, so versions of one narration reuse them
  meter?: { usd: number };
};

export async function review(cut: Cut, o: ReviewOptions): Promise<Report> {
  const start = o.meter?.usd ?? 0;
  const { ask } = o;
  const [sequence, silent] = await Promise.all([
    sequenceReview(cut, { ask, needs: o.needs, grabFrame: (t) => frame(cut.video, t), motion: () => motion(cut.video) }),
    silentReview(cut, o.ideas, { ask, silentClip: (c) => clip(cut.video, c.from, c.to, false) }),
  ]);
  const [learner, truth] = await Promise.all([
    learnerReview(cut, o.quiz, o.scope, {
      ask,
      videoClip: (c) => clip(cut.video, c.from, c.to, true),
      audioClip: (c) => soundOnly(cut.video, c.from, c.to),
      shared: o.shared,
      silentNotes: silent.account,
    }),
    truthReview(cut, sequence.claims, { ask, bigFrame: (t) => frame(cut.video, t, 1080) }),
  ]);
  const tickets = mergeTickets([...sequence.tickets, ...silent.tickets, ...learner.tickets, ...truth.tickets]);
  const parts = { sequence, silent, learner, truth, tickets };
  return { cut: cut.id, request: cut.request, at: new Date().toISOString(), usd: (o.meter?.usd ?? 0) - start, scores: score(parts), ...parts };
}

export const passes = (s: Scores) => s.truthErrors === 0 && s.worst === 0;

// Review, repair, render, review again, until it passes, stops getting better, or runs out of rounds. The repair step is
// passed in: this loop only knows about tickets, so it stays independent of how scenes are written.
export async function repairLoop<V>(o: {
  first: V;
  review: (v: V) => Promise<Report>;
  repair: (v: V, tickets: RepairTicket[]) => Promise<V>;
  rounds?: number;
}): Promise<{ best: V; report: Report; history: Report[] }> {
  let v = o.first;
  let best = v;
  let report = await o.review(v);
  const history = [report];
  for (let i = 0; i < (o.rounds ?? 2) && !passes(report.scores); i++) {
    v = await o.repair(v, report.tickets);
    const next = await o.review(v);
    history.push(next);
    if (next.scores.overall <= report.scores.overall && next.scores.truthErrors >= report.scores.truthErrors) break;
    best = v;
    report = next;
  }
  return { best, report, history };
}

