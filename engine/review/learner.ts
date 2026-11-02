// The first-time learner. A model cannot forget what it knows, so the design works around that:
// - The quiz is written from the request alone, before anyone has seen the script, and stays fixed across versions.
// - Watching and answering are separate. The watcher takes notes; the answerer sees only the notes and must say when they do
//   not cover something.
// - A "nothing" arm takes the same quiz with empty notes, which measures how much still leaks.
// - Each arm goes through the same steps, so video, audio alone and sound off can be compared directly.
import type { RepairTicket } from "../core/types.ts";
import type { Ask, Part } from "./model.ts";
import { text } from "./model.ts";
import { chunks, sentences, wordMoment } from "./moments.ts";
import type { Chunk, Condition, Cut, LearnerResult, Quiz, QuizResult } from "./types.ts";

const WRITER = `You write a quiz that tests whether someone really learned a topic from a short explainer. You see only what they asked for, not the explainer. Write 8 questions a person who understood could answer, and someone who merely heard the words could not:
- transfer: apply the idea to a fresh case, with new specifics, and get a definite result.
- why: explain why something works or is true.
- steps: state the order or mechanism of what happens.
- trap: a situation where a common misunderstanding gives the wrong answer.
Use at least one of each kind. Stay within what a short explainer on this request could reasonably cover. Give a model answer for each, which a grader will use.`;

const quizSchema = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "question", "answer"],
        properties: { id: { type: "string" }, kind: { type: "string", enum: ["transfer", "why", "steps", "trap"] }, question: { type: "string" }, answer: { type: "string" } },
      },
    },
  },
};

const WATCHER = (what: string) => `You are a first-time learner. You have never studied this subject, and you only know what this ${what} teaches you. Take the notes a keen student would take: the steps, what things mean, any example in full, as far as you actually took them in. If something went past you or you could not connect it to the rest, write that down. Do not add anything from outside the ${what}, and do not tidy up what you did not get.

Update the running notes and return all of them.`;

const notesSchema = { type: "object", additionalProperties: false, required: ["notes"], properties: { notes: { type: "string" } } };

const ANSWERER = `You answer a quiz using only the notes below, which are everything you know. If the notes let you work an answer out, do so, showing how. If they do not, answer exactly "not covered". Using anything outside the notes is cheating.`;

const answersSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "answer"], properties: { id: { type: "string" }, answer: { type: "string" } } } } },
};

const GRADER = `You grade quiz answers against model answers. Score 1 if correct with sound reasoning, 0.5 if partly right, 0 if wrong or "not covered". For a question the narration deals with, give the id of the sentence where it does; otherwise give "".`;

const gradesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["grades"],
  properties: { grades: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "score", "sentence"], properties: { id: { type: "string" }, score: { type: "number", enum: [0, 0.5, 1] }, sentence: { type: "string" } } } } },
};

export async function writeQuiz(request: string, ask: Ask): Promise<Quiz> {
  return ask<Quiz>({ name: "quiz-write", effort: "medium", system: WRITER, user: `Request: ${request}`, schema: quizSchema });
}

// Watches one condition chunk by chunk, keeping notes as it goes.
export async function takeNotes(cut: Cut, what: string, source: (c: Chunk) => Part, ask: Ask, model: "muse-spark-1.2" | "muse-spark-1.3"): Promise<string> {
  let notes = "(no notes yet)";
  for (const c of chunks(sentences(cut.words))) {
    const r = await ask<{ notes: string }>({ name: `learner-notes-${what}`, model, effort: "low", system: WATCHER(what), user: [text(`Your notes so far:\n${notes}`), source(c)], schema: notesSchema });
    notes = r.notes;
  }
  return notes;
}

type Graded = { result: QuizResult; sentences: Map<string, string> };

export async function sitQuiz(quiz: Quiz, notes: string, cut: Cut, ask: Ask): Promise<Graded> {
  const questions = quiz.questions.map((q) => `${q.id}: ${q.question}`).join("\n");
  const a = await ask<{ answers: { id: string; answer: string }[] }>({ name: "learner-answer", effort: "low", system: ANSWERER, user: `Notes:\n${notes || "(empty)"}\n\nQuestions:\n${questions}`, schema: answersSchema });
  const answers = new Map(a.answers.map((x) => [x.id, x.answer]));
  const paper = quiz.questions.map((q) => `${q.id}\nQuestion: ${q.question}\nModel answer: ${q.answer}\nGiven answer: ${answers.get(q.id) ?? "not covered"}`).join("\n\n");
  const script = sentences(cut.words).map((s) => `${s.id}: ${s.text}`).join("\n");
  const g = await ask<{ grades: { id: string; score: number; sentence: string }[] }>({ name: "learner-grade", effort: "low", system: GRADER, user: `Narration:\n${script}\n\nPapers:\n${paper}`, schema: gradesSchema });
  const byQuestion = Object.fromEntries(quiz.questions.map((q) => [q.id, g.grades.find((x) => x.id === q.id)?.score ?? 0]));
  const score = quiz.questions.length ? Object.values(byQuestion).reduce((x, y) => x + y, 0) / quiz.questions.length : 0;
  return { result: { score, byQuestion }, sentences: new Map(g.grades.map((x) => [x.id, x.sentence])) };
}

export type LearnerDeps = {
  ask: Ask;
  videoClip: (c: Chunk) => Part;
  audioClip?: (c: Chunk) => Part; // leave out to skip, or when a shared result is passed in
  shared?: Partial<Record<Condition, { notes: string; result: QuizResult }>>; // arms that do not depend on the picture
  silentNotes?: string; // the sound-off viewer's account, sat as one more arm
};

export async function learnerReview(cut: Cut, quiz: Quiz, d: LearnerDeps): Promise<LearnerResult> {
  const arms: LearnerResult["arms"] = {};
  const notes: LearnerResult["notes"] = {};
  const sit = async (arm: Condition, n: string) => {
    notes[arm] = n;
    const g = await sitQuiz(quiz, n, cut, d.ask);
    arms[arm] = g.result;
    return g;
  };
  for (const [arm, v] of Object.entries(d.shared ?? {})) {
    arms[arm as Condition] = v.result;
    notes[arm as Condition] = v.notes;
  }
  const video = await takeNotes(cut, "video", d.videoClip, d.ask, "muse-spark-1.2");
  const work: Promise<unknown>[] = [];
  const main = sit("video", video);
  work.push(main);
  if (d.audioClip && !arms.audio) work.push(takeNotes(cut, "narration", d.audioClip, d.ask, "muse-spark-1.2").then((n) => sit("audio", n)));
  if (d.silentNotes !== undefined) work.push(sit("silent", d.silentNotes));
  if (!arms.nothing) work.push(sit("nothing", ""));
  await Promise.all(work);

  // A question failed after watching is a ticket. If the same question was passed on audio alone, the picture got in the way.
  const list = sentences(cut.words);
  const graded = await main;
  const tickets: RepairTicket[] = [];
  for (const q of quiz.questions) {
    const got = arms.video!.byQuestion[q.id];
    if (got === 1) continue;
    const audio = arms.audio?.byQuestion[q.id];
    const worse = audio !== undefined && audio > got;
    const s = list.find((x) => x.id === graded.sentences.get(q.id));
    tickets.push({
      reviewer: "learner",
      problem: "not_learned",
      at: wordMoment(s?.first ?? 0),
      until: wordMoment(s?.last ?? cut.words.length - 1),
      from: s?.from ?? 0,
      to: s?.to ?? cut.seconds,
      said: s?.text ?? "(the narration never deals with this)",
      seen: "",
      wrong: `A first-time learner scored ${got} on: ${q.question}${worse ? ` They scored ${audio} on audio alone, so the picture made this worse.` : ""}`,
      severity: worse ? 3 : got === 0 ? 2 : 1,
    });
  }
  return { arms, notes, tickets };
}
