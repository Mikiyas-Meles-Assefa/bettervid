// The voice stage's holds: the script splits at every hold, the parts join with exactly the held silence between their
// speech, word times move onto the joined clock, and a failed segment is retried on its own. A fake TTS stands in for
// ElevenLabs (each word is a short tone with a matching alignment), so nothing is spent.
// Run: node --experimental-strip-types --test pipeline/stages/voice.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Hold, Project } from "../../schemas/project.ts";
import { captions } from "./timeline.ts";
import { directionHolds, encode, joinSegments, readSegments, scriptWords, speechEdges, splitAtHolds, type Tts, type TtsRequest } from "./voice.ts";

const SR = 44100;
const hold = (id: string, afterWord: number, seconds: number): Hold => ({ id, afterWord, seconds, purpose: "look", does: "" });
const words = (n: number, beatId = "b1") => Array.from({ length: n }, (_, i) => ({ text: `w${i}`, beatId }));

// Silence, then a tone, then silence, in seconds.
function block(lead: number, tone: number, tail: number): Float32Array {
  const pcm = new Float32Array(Math.round((lead + tone + tail) * SR));
  for (let i = Math.round(lead * SR); i < Math.round((lead + tone) * SR); i++) pcm[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR);
  return pcm;
}

test("the script splits after each hold's word, and holds on one word or at the end stay together", () => {
  const segs = splitAtHolds(words(10), [hold("h1", 2, 1), hold("h2", 6, 2)]);
  assert.deepEqual(segs.map((s) => [s.first, s.last, s.text, s.holds.map((h) => h.id)]), [
    [0, 2, "w0 w1 w2", ["h1"]],
    [3, 6, "w3 w4 w5 w6", ["h2"]],
    [7, 9, "w7 w8 w9", []],
  ]);
  const end = splitAtHolds(words(5), [hold("a", 1, 1), hold("b", 1, 2), hold("z", 4, 3)]);
  assert.deepEqual(end.map((s) => [s.first, s.last, s.holds.map((h) => h.id)]), [[0, 1, ["a", "b"]], [2, 4, ["z"]]]);
  assert.deepEqual(splitAtHolds(words(3), []).map((s) => s.text), ["w0 w1 w2"]);
});

test("holds come from every event in word order, and a hold outside the script stops the stage by name", () => {
  const p = { script: { beats: [{ id: "b1", text: "one two three", cue: false }, { id: "c1", text: " Watch this. ", cue: true }] } } as unknown as Project;
  assert.deepEqual(scriptWords(p).map((w) => `${w.text}/${w.beatId}`), ["one/b1", "two/b1", "three/b1", "Watch/c1", "this./c1"]);
  assert.deepEqual(directionHolds(p, 5), []);
  p.direction = { goal: "", promise: "", arc: "", cues: [], events: [{ holds: [hold("h2", 3, 1)] }, { holds: [hold("h1", 1, 1)] }, {}] as never };
  assert.deepEqual(directionHolds(p, 5).map((h) => h.id), ["h1", "h2"]);
  p.direction.events[0]!.holds = [hold("h9", 5, 1)];
  assert.throws(() => directionHolds(p, 5), /hold h9 is after word 5/);
  p.direction.events[0]!.holds = [hold("h0", 2, 0)];
  assert.throws(() => directionHolds(p, 5), /hold h0 lasts 0 s/);
});

test("speech edges find the tone to within one 10 ms window", () => {
  const [a, b] = speechEdges(block(0.2, 0.5, 0.3))!;
  assert.ok(Math.abs(a / SR - 0.2) <= 0.011, `start ${a / SR}`);
  assert.ok(Math.abs(b / SR - 0.7) <= 0.011, `end ${b / SR}`);
  assert.equal(speechEdges(new Float32Array(SR)), null);
});

test("joined segments are exactly the hold apart from speech to speech, and shifts move each segment's clock", () => {
  const j = joinSegments([
    { pcm: block(0.1, 0.5, 0.25), holds: [hold("h1", 3, 1.5)], lastWord: 3 },
    { pcm: block(0.15, 0.4, 0.1), holds: [hold("h2", 7, 0.8), hold("h3", 7, 0.7)], lastWord: 7 },
    { pcm: block(0.2, 0.3, 0.2), holds: [], lastWord: 9 },
  ]);
  const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 0.011, `${what}: ${a} vs ${b}`);
  // Segment 1 speaks 0.1 to 0.6 and is not moved.
  near(j.shift[0]!, 0, "shift 1");
  near(j.holds[0]!.start, 0.6, "h1 start");
  // Segment 2's speech starts 1.5 s after segment 1's ends.
  near(0.15 + j.shift[1]!, 0.6 + 1.5, "segment 2 speech");
  // Two holds after one word run back to back.
  near(j.holds[1]!.start, 2.1 + 0.4, "h2 start");
  near(j.holds[2]!.start, j.holds[1]!.start + 0.8, "h3 start");
  near(0.2 + j.shift[2]!, j.holds[1]!.start + 1.5, "segment 3 speech");
  // The joined audio is silent through every hold and keeps the last segment's tail.
  for (const h of j.holds) {
    const quiet = j.pcm.slice(Math.round((h.start + 0.02) * SR), Math.round((h.start + h.seconds - 0.02) * SR));
    assert.ok(quiet.every((x) => x === 0), `${h.id} is silent`);
  }
  near(j.pcm.length / SR, 0.2 + j.shift[2]! + 0.5, "length");
  assert.deepEqual(j.holds.map((h) => h.afterWord), [3, 7, 7]);
});

test("a hold after the last word leaves that much silence at the end", () => {
  const j = joinSegments([{ pcm: block(0.1, 0.5, 0.3), holds: [hold("end", 2, 2)], lastWord: 2 }]);
  assert.ok(Math.abs(j.pcm.length / SR - (0.6 + 2)) <= 0.011);
});

// A fake narrator: each word is 0.25 s of tone with 0.1 s between words and 0.1 s of silence at both ends, returned as
// an MP3 (with its encoder delay in the header) and a character alignment, like ElevenLabs. `extra` adds one word to
// any segment that contains it; `stretch` times the last word to the end of the audio, as ElevenLabs does (S15).
function fakeTts(opts: { failFirst?: string; extra?: string; stretch?: boolean } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "voice-test-"));
  const calls: TtsRequest[] = [];
  const failed = new Set<string>();
  const tts: Tts = async (req) => {
    calls.push(req);
    if (opts.failFirst && req.text.includes(opts.failFirst) && !failed.has(req.text)) {
      failed.add(req.text);
      throw new Error("elevenlabs 500: busy");
    }
    const ws = req.text.split(" ");
    if (opts.extra && req.text.includes(opts.extra)) ws.push("extra");
    const pcm = new Float32Array(Math.round((0.2 + ws.length * 0.35) * SR));
    const characters: string[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    ws.forEach((w, k) => {
      const t0 = 0.1 + k * 0.35;
      for (let i = Math.round(t0 * SR); i < Math.round((t0 + 0.25) * SR); i++) pcm[i] = 0.3 * Math.sin((2 * Math.PI * 330 * i) / SR);
      if (k) { characters.push(" "); starts.push(t0 - 0.1); ends.push(t0); }
      [...w].forEach((ch, c) => { characters.push(ch); starts.push(t0 + (0.25 * c) / w.length); ends.push(t0 + (0.25 * (c + 1)) / w.length); });
    });
    if (opts.stretch) ends[ends.length - 1] = pcm.length / SR;
    const file = join(tmp, `${calls.length}.mp3`);
    await encode(pcm, file);
    return { audio: readFileSync(file), alignment: { characters, character_start_times_seconds: starts, character_end_times_seconds: ends }, credits: req.text.length };
  };
  return { tts, calls };
}

test("segments are read with their neighbours as context, and word times land on the joined clock", async () => {
  const ws = words(9);
  const segs = splitAtHolds(ws, [hold("h1", 2, 2), hold("h2", 5, 1)]);
  const { tts, calls } = fakeTts({ stretch: true });
  const r = await readSegments(segs, ws, tts);
  const byText = new Map(calls.map((c) => [c.text, c]));
  assert.deepEqual(byText.get("w3 w4 w5"), { text: "w3 w4 w5", previous_text: "w0 w1 w2", next_text: "w6 w7 w8" });
  assert.deepEqual(byText.get("w0 w1 w2"), { text: "w0 w1 w2", next_text: "w3 w4 w5" });
  assert.equal(r.words.length, 9);
  assert.deepEqual(r.words.map((w) => w.text), ws.map((w) => w.text));
  assert.deepEqual(r.holds.map((h) => [h.id, h.afterWord, h.seconds]), [["h1", 2, 2], ["h2", 5, 1]]);
  // Each hold starts when its word ends, even though the alignment stretched that word into the quiet, and the next
  // word starts when the hold is over (alignment against audio within one 10 ms window).
  for (const h of r.holds) {
    assert.ok(Math.abs(r.words[h.afterWord]!.end - h.start) < 0.015, `${h.id} starts at its word end: ${r.words[h.afterWord]!.end} vs ${h.start}`);
    assert.ok(Math.abs(r.words[h.afterWord + 1]!.start - (h.start + h.seconds)) < 0.015, `${h.id} ends at the next word`);
  }
  // Within a segment the spacing is untouched.
  assert.ok(Math.abs(r.words[4]!.start - r.words[3]!.start - 0.35) < 0.002);
  assert.equal(r.billed, 9 * 3 - 3);
});

test("a failing segment is retried alone, and a word count mismatch stays inside its segment", async () => {
  const ws = [...words(3, "b1"), ...words(3, "b2").map((w, i) => ({ ...w, text: `v${i}` }))];
  const segs = splitAtHolds(ws, [hold("h1", 2, 1)]);
  const { tts, calls } = fakeTts({ failFirst: "v0", extra: "w0" });
  const r = await readSegments(segs, ws, tts);
  assert.equal(calls.filter((c) => c.text.startsWith("w0")).length, 1);
  assert.equal(calls.filter((c) => c.text.startsWith("v0")).length, 2);
  // Segment 1 came back with 4 words: the extra takes its segment's last beat; segment 2 keeps its own beats.
  assert.deepEqual(r.words.map((w) => `${w.text}/${w.beatId}`), ["w0/b1", "w1/b1", "w2/b1", "extra/b1", "v0/b2", "v1/b2", "v2/b2"]);
  // The hold follows the narration's word 3, the last word actually spoken before it.
  assert.deepEqual(r.holds.map((h) => h.afterWord), [3]);
});

test("caption pages break at a hold, so no page runs across the silence", () => {
  const ws = "the first swap moves".split(" ").map((text, i) => ({ text, start: i < 2 ? i * 0.4 : 3 + i * 0.4, end: (i < 2 ? i * 0.4 : 3 + i * 0.4) + 0.3, beatId: "b1" }));
  const p = {
    narration: { audio: "", voiceId: "", model: "", seconds: 5, words: ws, holds: [{ id: "h1", afterWord: 1, start: 0.7, seconds: 3 }] },
    script: { beats: [{ id: "b1", text: "", emphasis: [] }] },
  } as unknown as Project;
  const pages = captions(p, []);
  assert.deepEqual(pages.map((c) => c.words.map((w) => w.text).join(" ")), ["the first", "swap moves"]);
  // The first page leaves the screen 0.4 s after its last word, well before the hold ends.
  assert.equal(pages[0]!.endFrame, Math.round((0.4 + 0.3 + 0.4) * 30));
});
