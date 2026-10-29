// S6: does ElevenLabs v4 return word timestamps that match the audio?
// Usage: npm run spike scripts/spikes/s6-elevenlabs-timestamps.ts [model_id]
import { env, save } from "../lib/util.ts";

const KEY = env("ELEVENLABS_API_KEY");
const MODEL = process.argv[2] ?? "eleven_v4";
const VOICE = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb"; // "George", a premade narrator voice
const TEXT =
  "In 1854, a doctor named John Snow drew a map. Not of streets, but of deaths. " +
  "And that one map changed how we fight disease forever.";

const OUT = `media/spikes/s6/${MODEL}`;

type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export function toWords(a: Alignment) {
  const words: { word: string; start: number; end: number }[] = [];
  let cur = "";
  let start = 0;
  let end = 0;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) words.push({ word: cur, start, end });
      cur = "";
      return;
    }
    if (!cur) start = a.character_start_times_seconds[i];
    cur += ch;
    // punctuation gets its own time slot, so only letters and digits extend the word's end
    if (/[\p{L}\p{N}]/u.test(ch)) end = a.character_end_times_seconds[i];
  });
  if (cur) words.push({ word: cur, start, end });
  return words;
}

if (process.argv[3] === "offline") {
  const { readFile } = await import("node:fs/promises");
  const saved = JSON.parse(await readFile(`${OUT}/alignment.json`, "utf8"));
  console.log(toWords(saved.alignment).map((w) => `${w.word} ${w.start}-${w.end}`).join(" | "));
  process.exit(0);
}

const t0 = Date.now();
const res = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`,
  {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ text: TEXT, model_id: MODEL }),
  },
);
const ms = Date.now() - t0;
const cost = res.headers.get("character-cost") ?? res.headers.get("x-character-count");
const body = await res.text();
if (!res.ok) {
  console.log(JSON.stringify({ model: MODEL, status: res.status, ms, body: body.slice(0, 800) }, null, 2));
  process.exit(1);
}
const json = JSON.parse(body);
await save(`${OUT}/audio.mp3`, Buffer.from(json.audio_base64, "base64"));
const words = toWords(json.alignment);
const nWords = toWords(json.normalized_alignment ?? json.alignment);
await save(`${OUT}/alignment.json`, JSON.stringify({ alignment: json.alignment, normalized: json.normalized_alignment, words }, null, 2));
console.log(JSON.stringify({ model: MODEL, status: res.status, ms, chars: TEXT.length, cost, words, normalizedWordCount: nWords.length }, null, 2));
