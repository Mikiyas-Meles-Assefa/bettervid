// Stage 3: voice first. ElevenLabs reads the whole script once; its character timings become word times,
// the master clock every later stage cuts to.
import { join } from "node:path";
import type { Project, Word } from "../../schemas/project.ts";
import { charge, dir, persona, stage, style } from "../lib/project.ts";
import { env, write } from "../lib/util.ts";

type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };

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

export async function voice(p: Project, force = false) {
  // The persona's voice wins over the style's, so narrator and look can be chosen separately.
  const v = persona(p.input.persona).voice ?? style(p.input.style).voice;
  const beats = p.script!.beats;
  const text = beats.map((b) => b.text.trim()).join(" ");
  await stage(p, "voice", [v, text], 0, async () => {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v.id}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: v.model }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${body.slice(0, 400)}`);
    const j = JSON.parse(body);
    const audio = await write(join(dir(p), "narration.mp3"), Buffer.from(j.audio_base64, "base64"));
    const words = toWords(j.alignment);
    // Assign each word to its beat by counting the beat's words in order.
    const beatOf: string[] = beats.flatMap((b) => b.text.trim().split(/\s+/).map(() => b.id));
    if (beatOf.length !== words.length) console.error(`  voice: ${words.length} timed words vs ${beatOf.length} script words; beats assigned by position`);
    p.narration = {
      audio: "narration.mp3",
      voiceId: v.id,
      model: v.model,
      seconds: words.at(-1)?.end ?? 0,
      words: words.map((w, i) => ({ ...w, beatId: beatOf[Math.min(i, beatOf.length - 1)]! })),
    };
    // ElevenLabs bills plan credits, not dollars; record characters for the ledger.
    charge(p, "voice", 0, `${text.length} chars, ${res.headers.get("character-cost") ?? "?"} credits, ${audio}`);
  }, force);
}
