// Pure timing logic: narration into sentences and chunks, findings back onto words, and frozen stretches from measured motion.
import type { Moment } from "../core/types.ts";
import type { Chunk, Sentence, Word } from "./types.ts";

// Split on sentence ends. A run-on longer than maxSeconds is split at the next pause mark, then anywhere.
export function sentences(words: Word[], maxSeconds = 9): Sentence[] {
  const out: Sentence[] = [];
  let first = 0;
  const close = (last: number) => {
    out.push({ id: `s${out.length + 1}`, first, last, from: words[first].start, to: words[last].end, text: words.slice(first, last + 1).map((w) => w.text).join(" ") });
    first = last + 1;
  };
  words.forEach((w, i) => {
    const long = w.end - words[first].start;
    if (/[.?!]["')\]]*$/.test(w.text) || i === words.length - 1) close(i);
    else if (long > maxSeconds && /[,;:]$/.test(w.text)) close(i);
    else if (long > maxSeconds * 1.5) close(i);
  });
  return out;
}

// Group sentences into watchable chunks. Accuracy falls on long clips (spike S10), so chunks stay short.
export function chunks(list: Sentence[], target = 24): Chunk[] {
  const out: Chunk[] = [];
  let cur: Sentence[] = [];
  for (const s of list) {
    cur.push(s);
    if (s.to - cur[0].from >= target) {
      out.push({ from: cur[0].from, to: s.to, sentences: cur });
      cur = [];
    }
  }
  if (cur.length) {
    const last = out.at(-1);
    // A very short tail joins the chunk before it.
    if (last && cur.at(-1)!.to - cur[0].from < target / 3) {
      last.sentences.push(...cur);
      last.to = cur.at(-1)!.to;
    } else out.push({ from: cur[0].from, to: cur.at(-1)!.to, sentences: cur });
  }
  return out;
}

export const wordMoment = (word: number): Moment => ({ word });

// The sentence playing at a time in seconds, or the nearest one.
export function sentenceAt(list: Sentence[], seconds: number): Sentence {
  return list.reduce((best, s) => {
    const d = (x: Sentence) => (seconds < x.from ? x.from - seconds : seconds > x.to ? seconds - x.to : 0);
    return d(s) < d(best) ? s : best;
  }, list[0]);
}

// Times worth looking at for a sentence: its start, end, and enough between that nothing long goes unseen.
export function frameTimes(s: Sentence, gap = 2.5): number[] {
  const inset = Math.min(0.3, (s.to - s.from) / 4);
  const a = s.from + inset;
  const b = s.to - inset;
  const n = Math.max(1, Math.ceil((b - a) / gap));
  return Array.from({ length: n + 1 }, (_, i) => +(a + ((b - a) * i) / n).toFixed(2));
}

export type MotionGrid = { fps: number; rows: number; cols: number; change: number[][] }; // change[step][tile], 0 to 1

// Tiles that change nearly all the time are moving captions or decoration, not the content of the picture. If most of the
// frame is like that the camera is moving, and nothing can be said from pixels alone, so no tile is ignored.
export function contentTiles(g: MotionGrid, threshold = 0.012): number[] {
  const tiles = g.rows * g.cols;
  const steps = g.change.length;
  const busy = Array.from({ length: tiles }, (_, t) => t).filter((t) => g.change.filter((row) => row[t] > threshold).length > steps * 0.35);
  if (busy.length > tiles / 2) return [];
  return Array.from({ length: tiles }, (_, t) => t).filter((t) => !busy.includes(t));
}

// Stretches where the picture's content really does not change while words keep coming. This is a measurement, not a
// judgement: holding still while explaining can be right, so these become low-severity tickets unless a reviewer agrees.
export function frozenSpans(g: MotionGrid, words: Word[], o: { threshold?: number; seconds?: number; minWords?: number } = {}) {
  const threshold = o.threshold ?? 0.012;
  const seconds = o.seconds ?? 5;
  const minWords = o.minWords ?? 10;
  const tiles = contentTiles(g, threshold);
  if (!tiles.length) return [];
  const still = g.change.map((row) => tiles.every((t) => row[t] <= threshold));
  const out: { from: number; to: number; first: number; last: number }[] = [];
  let start = -1;
  for (let i = 0; i <= still.length; i++) {
    if (i < still.length && still[i]) {
      if (start < 0) start = i;
      continue;
    }
    if (start >= 0) {
      const from = start / g.fps;
      const to = i / g.fps;
      const inside = words.flatMap((w, n) => (w.start >= from && w.end <= to ? [n] : []));
      if (to - from >= seconds && inside.length >= minWords) out.push({ from, to, first: inside[0], last: inside.at(-1)! });
      start = -1;
    }
  }
  return out;
}
