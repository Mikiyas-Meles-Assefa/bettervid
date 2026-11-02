// S15: on eleven_v4, is voice_settings.speed honored, is request stitching accepted, and how do audio tags at the start
// of a segment show up in the alignment? Writes each take to media/spikes/s15/ and prints durations and alignments.
// Usage: npm run spike scripts/spikes/s15-voice-holds.ts
import { spawnSync } from "node:child_process";
import { env, save } from "../lib/util.ts";

const KEY = env("ELEVENLABS_API_KEY");
const MODEL = "eleven_v4";
const VOICE = "JBFqnCBsd6RMkjVDRZzb";
const OUT = "media/spikes/s15";
const A = "Merge sort splits the list in half, again and again, until every piece holds one number.";
const B = "Then it merges the pieces back, always taking the smaller front card first.";

type Take = { name: string; text: string; extra?: Record<string, unknown> };
let total = 0;

async function tts(t: Take) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ text: t.text, model_id: MODEL, ...t.extra }),
  });
  const body = await res.text();
  total += t.text.length;
  const id = res.headers.get("request-id");
  const cost = res.headers.get("character-cost");
  if (!res.ok) {
    console.log(`${t.name}: ${res.status} ${body.slice(0, 400)}`);
    return { id: null };
  }
  const j = JSON.parse(body);
  const file = `${OUT}/${t.name}.mp3`;
  await save(file, Buffer.from(j.audio_base64, "base64"));
  await save(`${OUT}/${t.name}.json`, JSON.stringify({ alignment: j.alignment, normalized: j.normalized_alignment }, null, 2));
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim();
  const a = j.alignment;
  const chars = a.characters.join("");
  console.log(`${t.name}: ${res.status} id=${id} cost=${cost} audio=${probe}s lastChar=${a.character_end_times_seconds.at(-1)} chars="${chars.slice(0, 60)}"`);
  console.log(`  first 12 slots: ${a.characters.slice(0, 12).map((c: string, i: number) => `${c}@${a.character_start_times_seconds[i]}`).join(" ")}`);
  return { id };
}

await tts({ name: "a-default", text: A });
await tts({ name: "a-speed-0.8", text: A, extra: { voice_settings: { speed: 0.8 } } });
await tts({ name: "a-speed-1.2", text: A, extra: { voice_settings: { speed: 1.2 } } });
const first = await tts({ name: "a-next", text: A, extra: { next_text: B } });
await tts({ name: "b-stitched", text: B, extra: { previous_text: A, previous_request_ids: first.id ? [first.id] : undefined } });
await tts({ name: "b-alone", text: B });
await tts({ name: "b-quietly", text: `[quietly] ${B}` });
await tts({ name: "a-tension", text: `[building tension, measured pace] ${A}`, extra: { previous_text: B } });
console.log(`text characters sent: ${total}`);
