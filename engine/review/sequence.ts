// The sequence reviewer walks the video in order, sentence by sentence, with the voice beside the pictures. It carries a
// running record of what is on screen, which is what lets it see problems that only exist across time.
import type { RepairTicket } from "../core/types.ts";
import type { Ask, Part } from "./model.ts";
import { text } from "./model.ts";
import { chunks, frameTimes, frozenSpans, sentences, wordMoment, type MotionGrid } from "./moments.ts";
import type { Cut, Sentence, SentenceRow, SequenceResult, ScreenClaim } from "./types.ts";

const SYSTEM = `You review an explainer video the way a careful viewer experiences it: in order, with the voice and the screen together. You get numbered sentences of narration, and frames from the moment each sentence is spoken.

For every sentence, fill one row.
- seen: what is on screen, briefly, as a viewer would describe it.
- shown: can a viewer looking at the screen right now find what the voice is talking about? "yes", "partly", or "no". Use "na" only when the sentence needs nothing shown (a greeting, an aside). A picture does not need to be literal: it counts if a viewer would connect it to the words without being told. A picture that merely decorates the sentence's vocabulary does not count.
- gone: if the sentence depends on something shown or said earlier that the viewer needs in front of them to follow, and it is no longer on screen, name it. Otherwise "".
- stale: if the voice has moved to a new point and the screen still shows the old one, say so. Otherwise "". Holding still while the voice is still on the same thing is fine.
- competing: if something on screen pulls attention away from the words, has nothing to do with them, or would mislead, name it. Otherwise "".
- unreadable: if the key thing is present but cut off, too small, overlapping, or caught half way through a change for long enough to matter, say so. Otherwise "".
- severity: 3 if this stops a viewer understanding, 2 if it makes it clearly harder, 1 if it is a blemish or there is no problem.

Also list every claim the screen makes in screen_claims: statements, numbers, results, formulas, labels with content. Copy them exactly as written on screen. Skip captions that merely repeat the narration word for word.

Judge only whether a viewer can follow. Many ways of teaching work; do not prefer one. Do not suggest fixes. Be concrete and short. Update board: a compact record of what is on screen at the end of this stretch, and what has left the screen that may matter later.`;

const row = {
  type: "object",
  additionalProperties: false,
  required: ["id", "seen", "shown", "gone", "stale", "competing", "unreadable", "severity"],
  properties: {
    id: { type: "string" },
    seen: { type: "string" },
    shown: { type: "string", enum: ["yes", "partly", "no", "na"] },
    gone: { type: "string" },
    stale: { type: "string" },
    competing: { type: "string" },
    unreadable: { type: "string" },
    severity: { type: "integer", enum: [1, 2, 3] },
  },
};
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["rows", "screen_claims", "board"],
  properties: {
    rows: { type: "array", items: row },
    screen_claims: { type: "array", items: { type: "object", additionalProperties: false, required: ["sentence", "text"], properties: { sentence: { type: "string" }, text: { type: "string" } } } },
    board: { type: "string" },
  },
};

type Reply = { rows: SentenceRow[]; screen_claims: ScreenClaim[]; board: string };

// How well the screen serves the voice, weighted by time. 0 means the screen adds nothing, which is what audio alone scores.
export function fitScore(rows: SentenceRow[], list: Sentence[]): number {
  const seconds = new Map(list.map((s) => [s.id, s.to - s.from]));
  let total = 0;
  let sum = 0;
  for (const r of rows) {
    if (r.shown === "na") continue;
    const w = seconds.get(r.id) ?? 0;
    let v = r.shown === "yes" ? 1 : r.shown === "partly" ? 0.5 : 0;
    if (r.gone) v -= 0.5;
    if (r.stale) v -= 0.5;
    if (r.competing) v -= 0.5;
    total += w;
    sum += w * Math.max(v, -0.5);
  }
  return total ? Math.max(0, sum / total) : 0;
}

export function rowTickets(rows: SentenceRow[], list: Sentence[]): RepairTicket[] {
  const byId = new Map(list.map((s) => [s.id, s]));
  return rows.flatMap((r) => {
    const s = byId.get(r.id);
    if (!s) return [];
    const base = { reviewer: "sequence" as const, at: wordMoment(s.first), until: wordMoment(s.last), from: s.from, to: s.to, said: s.text, seen: r.seen, severity: r.severity };
    const out: RepairTicket[] = [];
    if (r.gone) out.push({ ...base, problem: "left_screen", wrong: r.gone });
    if (r.stale) out.push({ ...base, problem: "frozen", wrong: r.stale });
    if (r.competing) out.push({ ...base, problem: "competing", wrong: r.competing });
    if (r.unreadable) out.push({ ...base, problem: "unreadable", wrong: r.unreadable });
    if (r.shown === "no") out.push({ ...base, problem: "not_shown", wrong: "What the voice is talking about cannot be found on screen." });
    else if (r.shown === "partly" && r.severity > 1) out.push({ ...base, problem: "not_shown", wrong: "Only part of what the voice is talking about can be found on screen." });
    return out;
  });
}

export type SequenceDeps = { ask: Ask; grabFrame: (at: number) => Part; motion?: () => MotionGrid };

export async function sequenceReview(cut: Cut, d: SequenceDeps): Promise<SequenceResult> {
  const list = sentences(cut.words);
  const rows: SentenceRow[] = [];
  const claims: ScreenClaim[] = [];
  let board = "Nothing yet. The video is starting.";
  for (const c of chunks(list)) {
    const parts: Part[] = [text(`Screen so far: ${board}`)];
    for (const s of c.sentences) {
      parts.push(text(`${s.id} [${s.from.toFixed(1)}s to ${s.to.toFixed(1)}s]: "${s.text}"`));
      for (const at of frameTimes(s).slice(0, 5)) parts.push(text(`frame at ${at.toFixed(1)}s`), d.grabFrame(at));
    }
    const r = await d.ask<Reply>({ name: "sequence", effort: "low", system: SYSTEM, user: parts, schema });
    const ids = new Set(c.sentences.map((s) => s.id));
    rows.push(...r.rows.filter((x) => ids.has(x.id)));
    claims.push(...r.screen_claims);
    board = r.board;
  }
  const tickets = rowTickets(rows, list);
  let frozenSeconds = 0;
  if (d.motion) {
    for (const f of frozenSpans(d.motion(), cut.words)) {
      frozenSeconds += f.to - f.from;
      tickets.push({
        reviewer: "sequence",
        problem: "frozen",
        at: wordMoment(f.first),
        until: wordMoment(f.last),
        from: f.from,
        to: f.to,
        said: cut.words.slice(f.first, f.last + 1).map((w) => w.text).join(" "),
        seen: "The picture does not change.",
        wrong: `Measured: nothing on screen changes for ${(f.to - f.from).toFixed(1)} s while the voice keeps talking.`,
        severity: 1,
      });
    }
  }
  return { rows, claims, fit: fitScore(rows, list), frozenSeconds, tickets };
}
