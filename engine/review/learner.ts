// The first-time learner. A model cannot forget what it knows, so the design works around that:
// - The quiz is written from the request alone, before anyone has seen the script, and stays fixed across versions.
// - Watching and answering are separate. The watcher takes notes; the answerer sees only the notes and must quote the line
//   each answer rests on. Code checks the quote is really in the notes, and an answer without one counts as not covered.
// - The quiz is not edited to fit the narration, but questions the narration never deals with are set aside once, per narration,
//   so a video is not marked down for what its script left out. They are listed in the report.
// - A "nothing" arm takes the same quiz with empty notes, which measures how much still leaks.
// - Each arm goes through the same steps, so video, audio alone and sound off can be compared directly.
import type { RepairTicket } from "../core/types.ts";
import type { Ask, Part } from "./model.ts";
import { text } from "./model.ts";
import { chunks, sentences, wordMoment } from "./moments.ts";
import type { Chunk, Condition, Cut, LearnerResult, Quiz, QuizResult, Scope } from "./types.ts";

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

Return only the new notes from this stretch. They will be added to your notes so far, so do not repeat those.`;

const notesSchema = { type: "object", additionalProperties: false, required: ["notes"], properties: { notes: { type: "string" } } };

const ANSWERER = `You answer a quiz using only the notes below, which are everything you know. For each question, copy into quote the exact words from the notes that your answer rests on, then work the answer out from them. If no line in the notes helps, leave quote empty and answer "not covered". Using anything outside the notes is cheating.`;

const answersSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "quote", "answer"], properties: { id: { type: "string" }, quote: { type: "string" }, answer: { type: "string" } } } } },
};

const GRADER = `You grade quiz answers against model answers. Score 1 if correct with sound reasoning, 0.5 if partly right, 0 if wrong or "not covered".`;

const SCOPE = `You see a narration and a quiz. For each question, decide whether the narration gives a listener what they need to answer it, even if the question is a fresh case of the same method. Give the id of the sentence that most deals with it, or "" if the narration does not cover it.`;

const scopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: { questions: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "sentence"], properties: { id: { type: "string" }, sentence: { type: "string" } } } } },
};

const gradesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["grades"],
  properties: { grades: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "score"], properties: { id: { type: "string" }, score: { type: "number", enum: [0, 0.5, 1] } } } } },
};

export async function writeQuiz(request: string, ask: Ask): Promise<Quiz> {
  return ask<Quiz>({ name: "quiz-write", effort: "medium", system: WRITER, user: `Request: ${request}`, schema: quizSchema });
}

export async function scopeOf(quiz: Quiz, cut: Cut, ask: Ask): Promise<Scope> {
  const script = sentences(cut.words).map((s) => `${s.id}: ${s.text}`).join("\n");
  const r = await ask<{ questions: { id: string; sentence: string }[] }>({ name: "quiz-scope", effort: "low", system: SCOPE, user: `Narration:\n${script}\n\nQuiz:\n${quiz.questions.map((q) => `${q.id}: ${q.question}`).join("\n")}`, schema: scopeSchema });
  return Object.fromEntries(r.questions.filter((q) => q.sentence).map((q) => [q.id, q.sentence]));
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// A quote counts only if it is really in the notes and long enough to mean something.
export const quoted = (quote: string, notes: string) => squash(quote).length >= 6 && squash(notes).includes(squash(quote));

// Watches one condition chunk by chunk, keeping notes as it goes.
export async function takeNotes(cut: Cut, what: string, source: (c: Chunk) => Part, ask: Ask, model: "muse-spark-1.2" | "muse-spark-1.3"): Promise<string> {
  let notes = ""; // kept by code and only ever added to, for the same reason as the sound-off account
  for (const c of chunks(sentences(cut.words))) {
    const r = await ask<{ notes: string }>({ name: `learner-notes-${what}`, model, effort: "low", system: WATCHER(what), user: [text(`Your notes so far:\n${notes || "(none yet)"}`), source(c)], schema: notesSchema });
    notes = [notes, r.notes].filter(Boolean).join("\n");
  }
  return notes;
}

export async function sitQuiz(quiz: Quiz, notes: string, ask: Ask): Promise<QuizResult> {
  if (!quiz.questions.length) return { score: 0, byQuestion: {} };
  const questions = quiz.questions.map((q) => `${q.id}: ${q.question}`).join("\n");
  const a = await ask<{ answers: { id: string; quote: string; answer: string }[] }>({ name: "learner-answer", effort: "low", system: ANSWERER, user: `Notes:\n${notes || "(empty)"}\n\nQuestions:\n${questions}`, schema: answersSchema });
  const answers = new Map(a.answers.filter((x) => quoted(x.quote, notes)).map((x) => [x.id, x.answer]));
  const paper = quiz.questions.map((q) => `${q.id}\nQuestion: ${q.question}\nModel answer: ${q.answer}\nGiven answer: ${answers.get(q.id) ?? "not covered"}`).join("\n\n");
  const g = await ask<{ grades: { id: string; score: number }[] }>({ name: "learner-grade", effort: "low", system: GRADER, user: `Papers:\n${paper}`, schema: gradesSchema });
  const byQuestion = Object.fromEntries(quiz.questions.map((q) => [q.id, g.grades.find((x) => x.id === q.id)?.score ?? 0]));
  return { score: Object.values(byQuestion).reduce((x, y) => x + y, 0) / quiz.questions.length, byQuestion };
}

export type LearnerDeps = {
  ask: Ask;
  videoClip: (c: Chunk) => Part;
  audioClip?: (c: Chunk) => Part; // leave out to skip, or when a shared result is passed in
  shared?: Partial<Record<Condition, { notes: string; result: QuizResult }>>; // arms that do not depend on the picture
  silentNotes?: string; // the sound-off viewer's account, sat as one more arm
};

export async function learnerReview(cut: Cut, whole: Quiz, scope: Scope, d: LearnerDeps): Promise<LearnerResult> {
  const quiz = { questions: whole.questions.filter((q) => scope[q.id]) };
  const arms: LearnerResult["arms"] = {};
  const notes: LearnerResult["notes"] = {};
  const sit = async (arm: Condition, n: string) => {
    notes[arm] = n;
    arms[arm] = await sitQuiz(quiz, n, d.ask);
  };
  for (const [arm, v] of Object.entries(d.shared ?? {})) {
    arms[arm as Condition] = v.result;
    notes[arm as Condition] = v.notes;
  }
  const video = await takeNotes(cut, "video", d.videoClip, d.ask, "muse-spark-1.2");
  const work: Promise<unknown>[] = [];
  work.push(sit("video", video));
  if (d.audioClip && !arms.audio) work.push(takeNotes(cut, "narration", d.audioClip, d.ask, "muse-spark-1.2").then((n) => sit("audio", n)));
  if (d.silentNotes !== undefined) work.push(sit("silent", d.silentNotes));
  if (!arms.nothing) work.push(sit("nothing", ""));
  await Promise.all(work);

  // A question failed after watching is a ticket. If the same question was passed on audio alone, the picture got in the way.
  const list = sentences(cut.words);
  const tickets: RepairTicket[] = [];
  for (const q of quiz.questions) {
    const got = arms.video!.byQuestion[q.id];
    if (got === 1) continue;
    const audio = arms.audio?.byQuestion[q.id];
    const worse = audio !== undefined && audio > got;
    const s = list.find((x) => x.id === scope[q.id]);
    tickets.push({
      reviewer: "learner",
      problem: "not_learned",
      at: wordMoment(s?.first ?? 0),
      until: wordMoment(s?.last ?? cut.words.length - 1),
      from: s?.from ?? 0,
      to: s?.to ?? cut.seconds,
      said: s?.text ?? "",
      seen: "",
      wrong: `A first-time learner scored ${got} on: ${q.question}${worse ? ` They scored ${audio} on audio alone, so the picture made this worse.` : ""}`,
      severity: worse ? 3 : got === 0 ? 2 : 1,
    });
  }
  return { arms, notes, outOfScope: whole.questions.filter((q) => !scope[q.id]).map((q) => q.question), tickets };
}
