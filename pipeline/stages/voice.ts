// Stage 3: voice first. ElevenLabs reads the script; its character timings become word times, the master clock every
// later stage cuts to. With no holds in the direction the whole script is one call. With holds the script is split at
// every hold, each part is read with its neighbours as context (spike S15), and the parts are joined with exactly the
// held silence between them, so the result is still one narration.mp3 and one word list.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hold, Project, Word } from "../../schemas/project.ts";
import { charge, dir, persona, stage, style } from "../lib/project.ts";
import { env, hash, sleep, write } from "../lib/util.ts";

type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
export type TtsRequest = { text: string; previous_text?: string; next_text?: string };
export type TtsResult = { audio: Uint8Array; alignment: Alignment; credits: number };
export type Tts = (req: TtsRequest) => Promise<TtsResult>;

const SR = 44100; // ElevenLabs mp3_44100_128 is mono at this rate
const SPEECH_DB = -50; // a 10 ms window louder than this is speech; the narrator's own pauses sit near -78 dB (S15)
const PAD = 0.03; // seconds of the segment's own quiet kept at each cut, so no onset or release is clipped
const FADE = 0.005;
const CONCURRENCY = 3;
const ATTEMPTS = 3;

// Punctuation gets its own time slot, so only letters and digits extend a word's end (spike S6).
export function toWords(a: Alignment): Omit<Word, "beatId">[] {
  const words: Omit<Word, "beatId">[] = [];
  let cur = "";
  let start = 0;
  let end = 0;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) words.push({ text: cur, start, end });
      cur = "";
      return;
    }
    if (!cur) start = a.character_start_times_seconds[i]!;
    cur += ch;
    if (/[\p{L}\p{N}]/u.test(ch)) end = a.character_end_times_seconds[i]!;
  });
  if (cur) words.push({ text: cur, start, end });
  return words;
}

// The script's words in order with their beats; word numbers in the direction count exactly these.
export function scriptWords(p: Project): { text: string; beatId: string }[] {
  return p.script!.beats.flatMap((b) => b.text.trim().split(/\s+/).filter(Boolean).map((text) => ({ text, beatId: b.id })));
}

// Every hold in the direction, in word order. A hold that points outside the script or holds no time is a direction
// error, so it stops the stage by name rather than being dropped.
export function directionHolds(p: Project, nWords: number): Hold[] {
  const holds = (p.direction?.events ?? []).flatMap((e) => e.holds ?? []);
  for (const h of holds) {
    if (!Number.isInteger(h.afterWord) || h.afterWord < 0 || h.afterWord >= nWords) throw new Error(`voice: hold ${h.id} is after word ${h.afterWord}, but the script has words 0 to ${nWords - 1}`);
    if (!(h.seconds > 0)) throw new Error(`voice: hold ${h.id} lasts ${h.seconds} s`);
  }
  return holds.slice().sort((a, b) => a.afterWord - b.afterWord);
}

// One segment per stretch of speech between holds. `holds` are the silences after the segment, back to back when two
// holds follow the same word. A hold after the last word leaves silence at the end.
export type Segment = { first: number; last: number; text: string; holds: Hold[] };
export function splitAtHolds(words: { text: string }[], holds: Hold[]): Segment[] {
  const segs: Segment[] = [];
  let first = 0;
  for (const h of holds) {
    const prev = segs.at(-1);
    if (prev && prev.last === h.afterWord) {
      prev.holds.push(h);
      continue;
    }
    segs.push({ first, last: h.afterWord, text: "", holds: [h] });
    first = h.afterWord + 1;
  }
  if (first < words.length) segs.push({ first, last: words.length - 1, text: "", holds: [] });
  for (const s of segs) s.text = words.slice(s.first, s.last + 1).map((w) => w.text).join(" ");
  return segs;
}

// First and last sample of speech: where a 10 ms window first and last rises above SPEECH_DB.
export function speechEdges(pcm: Float32Array, sr = SR): [number, number] | null {
  const win = Math.round(sr * 0.01);
  const floor = 10 ** (SPEECH_DB / 20);
  const loud = (i: number) => {
    let s = 0;
    for (let j = i; j < Math.min(i + win, pcm.length); j++) s += pcm[j]! * pcm[j]!;
    return Math.sqrt(s / win) > floor;
  };
  let a = -1;
  for (let i = 0; i < pcm.length; i += win) if (loud(i)) { a = i; break; }
  if (a < 0) return null;
  let b = a;
  for (let i = Math.floor((pcm.length - 1) / win) * win; i >= a; i -= win) if (loud(i)) { b = Math.min(pcm.length, i + win); break; }
  return [a, b];
}

// Joins the segments' audio with each segment's holds as silence. Cuts are made only in the quiet at a hold: a segment
// after a hold starts PAD before its speech, a segment before one ends PAD after it, and the inserted silence is the
// hold minus those pads, so speech to speech is exactly the hold. Returns the audio, where each segment's original
// time 0 lands on the new clock (word times shift by this), each segment's speech on its own clock, and where each hold
// starts.
export type Joined = { pcm: Float32Array; shift: number[]; speech: [number, number][]; holds: { id: string; afterWord: number; start: number; seconds: number }[] };
export function joinSegments(segs: { pcm: Float32Array; holds: Hold[]; lastWord: number }[], sr = SR): Joined {
  const pad = Math.round(PAD * sr);
  const fade = Math.round(FADE * sr);
  const parts: Float32Array[] = [];
  const shift: number[] = [];
  const speech: [number, number][] = [];
  const holds: Joined["holds"] = [];
  let at = 0; // samples written so far
  let lead = 0; // samples of silence the next segment's head pad must take from the gap
  segs.forEach((s, i) => {
    const edges = speechEdges(s.pcm, sr);
    if (!edges) throw new Error(`voice: segment ${i + 1} has no speech in it`);
    speech.push([edges[0] / sr, edges[1] / sr]);
    const from = i > 0 ? Math.max(0, edges[0] - pad) : 0;
    const to = s.holds.length ? Math.min(s.pcm.length, edges[1] + pad) : s.pcm.length;
    const cut = s.pcm.slice(from, to);
    if (i > 0) for (let k = 0; k < Math.min(fade, cut.length); k++) cut[k]! *= k / fade;
    if (s.holds.length) for (let k = 0; k < Math.min(fade, cut.length); k++) cut[cut.length - 1 - k]! *= k / fade;
    // The silence before this segment was planned assuming a full head pad; settle the difference now.
    const headPad = edges[0] - from;
    if (i > 0) {
      const gap = Math.max(0, lead - headPad);
      parts.push(new Float32Array(gap));
      at += gap;
    }
    shift.push((at - from) / sr);
    parts.push(cut);
    at += cut.length;
    if (!s.holds.length) return;
    const tailPad = to - edges[1];
    let start = (at - tailPad) / sr;
    let total = 0;
    for (const h of s.holds) {
      holds.push({ id: h.id, afterWord: s.lastWord, start: +start.toFixed(3), seconds: h.seconds });
      start += h.seconds;
      total += h.seconds;
    }
    const silence = Math.round(total * sr) - tailPad;
    if (i === segs.length - 1) {
      // A hold after the last word: the silence ends the narration.
      const tail = Math.max(0, silence);
      parts.push(new Float32Array(tail));
      at += tail;
    } else lead = Math.max(0, silence);
  });
  const pcm = new Float32Array(at);
  let o = 0;
  for (const part of parts) {
    pcm.set(part, o);
    o += part.length;
  }
  return { pcm, shift, speech, holds };
}

function ffmpeg(args: string[], input?: Uint8Array): Buffer {
  const r = spawnSync("ffmpeg", ["-v", "error", ...args], { input, maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.toString().slice(-600)}`);
  return r.stdout;
}

function decode(mp3: Uint8Array): Float32Array {
  const raw = ffmpeg(["-i", "pipe:0", "-ac", "1", "-ar", String(SR), "-f", "f32le", "pipe:1"], mp3);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
}

// Written to a file, not a pipe, so the MP3 carries its encoder delay in the header and players start on time.
export async function encode(pcm: Float32Array, out: string): Promise<string> {
  await write(out, "");
  ffmpeg(["-y", "-f", "f32le", "-ar", String(SR), "-ac", "1", "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", "128k", out], new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  return out;
}

// The real ElevenLabs call. previous_text and next_text carry the neighbouring segments for continuity and are not billed (S15).
function elevenlabs(v: { id: string; model: string }): Tts {
  return async (req) => {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.id}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "content-type": "application/json" },
      body: JSON.stringify({ ...req, model_id: v.model }),
      signal: AbortSignal.timeout(3 * 60_000),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${body.slice(0, 400)}`);
    const j = JSON.parse(body);
    return { audio: Buffer.from(j.audio_base64, "base64"), alignment: j.alignment, credits: Number(res.headers.get("character-cost") ?? 0) };
  };
}

// Word list for timed words against the script words they should be, by position. A count mismatch is reported and
// beats are assigned by position, as one whole-script call always did.
function assignBeats(timed: Omit<Word, "beatId">[], script: { beatId: string }[], where: string): Word[] {
  if (timed.length !== script.length) console.error(`  voice: ${timed.length} timed words vs ${script.length} script words${where}; beats assigned by position`);
  return timed.map((w, i) => ({ ...w, beatId: script[Math.min(i, script.length - 1)]!.beatId }));
}

// Reads every segment (a few at a time) and joins them. Each segment is cached on disk by its exact request, so a run
// that stops part way never pays twice for a segment it already has; a failing segment is retried on its own.
export async function readSegments(segs: Segment[], words: { text: string; beatId: string }[], tts: Tts, cacheDir?: string, fresh = false) {
  const results: TtsResult[] = new Array(segs.length);
  let next = 0;
  let billed = 0;
  const one = async (i: number) => {
    const s = segs[i]!;
    const req: TtsRequest = { text: s.text, ...(i > 0 && { previous_text: segs[i - 1]!.text }), ...(i < segs.length - 1 && { next_text: segs[i + 1]!.text }) };
    const file = cacheDir && join(cacheDir, hash(req));
    if (file && !fresh && existsSync(`${file}.json`)) {
      const saved = JSON.parse(readFileSync(`${file}.json`, "utf8"));
      results[i] = { audio: readFileSync(`${file}.mp3`), alignment: saved.alignment, credits: 0 };
      return;
    }
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await tts(req);
        billed += r.credits;
        if (!toWords(r.alignment).length) throw new Error("no timed words came back");
        results[i] = r;
        if (file) {
          await write(`${file}.mp3`, r.audio);
          await write(`${file}.json`, JSON.stringify({ alignment: r.alignment, request: req }));
        }
        return;
      } catch (e: any) {
        if (attempt >= ATTEMPTS) throw new Error(`voice: segment ${i + 1} of ${segs.length} ("${s.text.slice(0, 40)}...") failed ${ATTEMPTS} times: ${e.message}`);
        console.error(`  voice: segment ${i + 1} failed (${e.message.slice(0, 120)}), retrying it`);
        await sleep(2000 * attempt);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, segs.length) }, async () => {
    while (next < segs.length) await one(next++);
  }));
  const joined = joinSegments(segs.map((s, i) => ({ pcm: decode(results[i]!.audio), holds: s.holds, lastWord: s.last })));
  // Word numbers on the narration clock: if a segment came back with a different word count, later numbers follow the
  // timed words, and each hold records the narration's number for the word it follows.
  const out: Word[] = [];
  const lastTimed: number[] = [];
  segs.forEach((s, i) => {
    // At the end of a request ElevenLabs stretches the last word to the end of the audio, up to a third of a second past
    // the speech (S15), which would leave its caption up into the hold. No word is timed outside the measured speech.
    const [a, b] = joined.speech[i]!;
    const shift = joined.shift[i]!;
    const timed = toWords(results[i]!.alignment).map((w) => {
      const start = Math.min(Math.max(w.start, a), b);
      return { ...w, start: +(start + shift).toFixed(3), end: +(Math.max(start, Math.min(w.end, b)) + shift).toFixed(3) };
    });
    out.push(...assignBeats(timed, words.slice(s.first, s.last + 1), ` in segment ${i + 1}`));
    lastTimed.push(out.length - 1);
  });
  const holds = joined.holds.map((h) => ({ ...h, afterWord: lastTimed[segs.findIndex((s) => s.last === h.afterWord)]! }));
  return { pcm: joined.pcm, words: out, holds, billed };
}

export async function voice(p: Project, force = false) {
  // The persona's voice wins over the style's, so narrator and look can be chosen separately.
  const v = persona(p.input.persona).voice ?? style(p.input.style).voice;
  const beats = p.script!.beats;
  const text = beats.map((b) => b.text.trim()).join(" ");
  const words = scriptWords(p);
  const holds = directionHolds(p, words.length);
  // With no holds the key stays what it always was, so existing narrations stay cached.
  const key = holds.length ? [v, text, holds.map((h) => [h.id, h.afterWord, h.seconds])] : [v, text];
  await stage(p, "voice", key, 0, async () => {
    if (holds.length) {
      const segs = splitAtHolds(words, holds);
      const r = await readSegments(segs, words, elevenlabs(v), join(dir(p), "voice"), force);
      const audio = await encode(r.pcm, join(dir(p), "narration.mp3"));
      // As before, the narration ends with its last word, or with a hold that follows it.
      const seconds = Math.max(r.words.at(-1)?.end ?? 0, ...r.holds.map((h) => h.start + h.seconds));
      p.narration = { audio: "narration.mp3", voiceId: v.id, model: v.model, seconds: +seconds.toFixed(3), words: r.words, holds: r.holds };
      charge(p, "voice", 0, `${text.length} chars in ${segs.length} segments around ${holds.length} holds, ${r.billed} credits, ${audio}`);
      return;
    }
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.id}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: v.model }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${body.slice(0, 400)}`);
    const j = JSON.parse(body);
    const audio = await write(join(dir(p), "narration.mp3"), Buffer.from(j.audio_base64, "base64"));
    const timed = toWords(j.alignment);
    p.narration = {
      audio: "narration.mp3",
      voiceId: v.id,
      model: v.model,
      seconds: timed.at(-1)?.end ?? 0,
      words: assignBeats(timed, words, ""),
    };
    // ElevenLabs bills plan credits, not dollars; record characters for the ledger.
    charge(p, "voice", 0, `${text.length} chars, ${res.headers.get("character-cost") ?? "?"} credits, ${audio}`);
  }, force);
}
