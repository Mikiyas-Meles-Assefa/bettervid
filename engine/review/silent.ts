// The sound-off reviewer. A viewer watches with no sound, no script and no topic, and says what it can follow. A separate
// grader, who never saw the video, compares that account with the ideas in the script.
import type { RepairTicket } from "../core/types.ts";
import type { Ask, Part } from "./model.ts";
import { text } from "./model.ts";
import { chunks, sentenceAt, sentences, wordMoment } from "./moments.ts";
import type { Chunk, Cut, Idea, Sentence, SilentResult } from "./types.ts";

const VIEWER = `You are watching a video with the sound off. You have no script and nobody has told you the subject. Know only what the screen tells you: do not fill gaps from what you already know about the subject. If you recognise the subject, that does not count as following the video.

For this stretch of video:
- followed: each thing the screen itself made clear, in order, with the second it became clear, counted from the start of this clip.
- lost: each moment you could not tell what was going on or why something happened, with the second and what you could not work out. A picture you can describe but whose point you cannot tell is a place you were lost.
- account: what this stretch added to your understanding. It will be added to your account so far, so do not repeat that. Include only what you could actually work out from the screen, step by step, with any specifics you saw. Say plainly where there are gaps.`;

const viewerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["followed", "lost", "account"],
  properties: {
    followed: { type: "array", items: { type: "object", additionalProperties: false, required: ["second", "what"], properties: { second: { type: "number" }, what: { type: "string" } } } },
    lost: { type: "array", items: { type: "object", additionalProperties: false, required: ["second", "what"], properties: { second: { type: "number" }, what: { type: "string" } } } },
    account: { type: "string" },
  },
};

const IDEAS = `You split a narration into the ideas a viewer is meant to take away. List 6 to 14 ideas in order, each one a single checkable statement, including any specifics of worked examples that matter. Skip asides and greetings. For each, give the id of the sentence where it lands.`;

const ideasSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ideas"],
  properties: { ideas: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "sentence", "idea"], properties: { id: { type: "string" }, sentence: { type: "string" }, idea: { type: "string" } } } } },
};

const GRADER = `You compare a sound-off viewer's account of a video with the list of ideas the video was meant to convey. For each idea give a score: 1 if the account clearly contains it, 0.5 if it contains part of it or only the outline, 0 if it does not. Grade only what the account says, not what the viewer probably meant. An idea stated in general terms that the account could have got from recognising the subject, with no sign it came from the screen, scores at most 0.5.`;

const graderSchema = {
  type: "object",
  additionalProperties: false,
  required: ["recovered"],
  properties: { recovered: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "score", "note"], properties: { id: { type: "string" }, score: { type: "number", enum: [0, 0.5, 1] }, note: { type: "string" } } } } },
};

export async function ideasOf(cut: Cut, ask: Ask): Promise<Idea[]> {
  const list = sentences(cut.words).map((s) => `${s.id}: ${s.text}`).join("\n");
  const r = await ask<{ ideas: Idea[] }>({ name: "ideas", effort: "low", system: IDEAS, user: list, schema: ideasSchema });
  return r.ideas;
}

type Viewer = { followed: { second: number; what: string }[]; lost: { second: number; what: string }[]; account: string };

export async function silentReview(cut: Cut, ideas: Idea[], d: { ask: Ask; silentClip: (c: Chunk) => Part }): Promise<SilentResult> {
  const list = sentences(cut.words);
  let account = ""; // kept by code and only ever added to: a model rewriting it each time quietly drops the early parts
  const tickets: RepairTicket[] = [];
  const ticket = (s: Sentence, problem: RepairTicket["problem"], seen: string, wrong: string, severity: 1 | 2 | 3): RepairTicket => ({
    reviewer: "sound_off",
    problem,
    at: wordMoment(s.first),
    until: wordMoment(s.last),
    from: s.from,
    to: s.to,
    said: s.text,
    seen,
    wrong,
    severity,
  });
  for (const c of chunks(list)) {
    const r = await d.ask<Viewer>({
      name: "sound-off",
      effort: "low",
      system: VIEWER,
      user: [text(`Your account so far: ${account || "nothing yet, the video is starting."}`), d.silentClip(c), text(`This clip lasts ${(c.to - c.from).toFixed(0)} seconds.`)],
      schema: viewerSchema,
    });
    account = [account, r.account].filter(Boolean).join("\n");
    for (const l of r.lost) tickets.push(ticket(sentenceAt(list, c.from + l.second), "viewer_lost", "", `With the sound off: ${l.what}`, 2));
  }
  const g = await d.ask<{ recovered: SilentResult["recovered"] }>({
    name: "sound-off-grade",
    effort: "low",
    system: GRADER,
    user: `Ideas:\n${ideas.map((i) => `${i.id}: ${i.idea}`).join("\n")}\n\nViewer's account:\n${account}`,
    schema: graderSchema,
  });
  const byId = new Map(list.map((s) => [s.id, s]));
  for (const x of g.recovered) {
    const idea = ideas.find((i) => i.id === x.id);
    const s = idea && byId.get(idea.sentence);
    if (s && x.score === 0) tickets.push(ticket(s, "idea_missing", "", `With the sound off this idea never arrives: ${idea.idea}`, 2));
  }
  const score = ideas.length ? g.recovered.reduce((a, b) => a + b.score, 0) / ideas.length : 0;
  return { account, recovered: g.recovered, score, tickets };
}
