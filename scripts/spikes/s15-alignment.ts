// S15 part 2: does previous_text make eleven_v4's character alignment less accurate? The same passage is read twice
// alone and once with the text before it as context; each take's word starts are compared with the pauses in its audio.
// Usage: npm run spike scripts/spikes/s15-alignment.ts <project id>
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { toWords } from "../../pipeline/stages/voice.ts";
import { env, save } from "../lib/util.ts";

const p = JSON.parse(readFileSync(`projects/${process.argv[2]}/project.json`, "utf8"));
const words: string[] = p.script.beats.flatMap((b: { text: string }) => b.text.trim().split(/\s+/));
const before = words.slice(31, 85).join(" ");
const passage = words.slice(85, 160).join(" ");
const OUT = "media/spikes/s15/alignment";

async function take(name: string, extra: Record<string, unknown>) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({ text: passage, model_id: "eleven_v4", ...extra }),
  });
  const j = await res.json();
  const file = await save(`${OUT}/${name}.mp3`, Buffer.from(j.audio_base64, "base64"));
  await save(`${OUT}/${name}.json`, JSON.stringify({ alignment: j.alignment }));
  const log = spawnSync("ffmpeg", ["-v", "info", "-i", file, "-af", "silencedetect=n=-35dB:d=0.12", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const resumes = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const starts = toWords(j.alignment).map((w) => w.start);
  const err = resumes.map((t) => Math.round(1000 * Math.abs(starts.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a)) - t))).sort((a, b) => a - b);
  console.log(`${name}: ${res.status}, ${passage.length} chars, cost ${res.headers.get("character-cost")}, ${resumes.length} pauses, start error median ${err[err.length >> 1]} ms, max ${err.at(-1)} ms`);
}

await take("alone-1", {});
await take("alone-2", {});
await take("with-previous", { previous_text: before });
