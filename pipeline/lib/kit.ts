// The audio kit: sound effects and music beds from ElevenLabs, generated once on first use, normalized,
// and kept in audio/kit/ (committed, royalty-free) so every video and the hosted app reuse them.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { env, write } from "./util.ts";

const DIR = "audio/kit";
export const KIT = JSON.parse(readFileSync("audio/kit.json", "utf8")) as {
  sfx: Record<string, { text: string; seconds: number; gainDb: number }>;
  music: Record<string, { prompt: string; seconds: number }>;
  moodByMode: Record<string, string>;
};

async function eleven(path: string, body: unknown): Promise<Uint8Array> {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method: "POST",
    headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!res.ok) throw new Error(`elevenlabs ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Loudness-normalizes a file in one pass to a 48 kHz stereo WAV.
function normalize(input: string, out: string, lufs: number) {
  mkdirSync(dirname(out), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", input, "-af", `loudnorm=I=${lufs}:TP=-2:LRA=11`, "-ar", "48000", "-ac", "2", out]);
}

// Short effects are too short for loudnorm; peak-normalize them to -3 dBFS instead and set level at mix time.
function peakNormalize(input: string, out: string) {
  // volumedetect reports on stderr.
  const log = spawnSync("ffmpeg", ["-i", input, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const max = Number(/max_volume: (-?[\d.]+) dB/.exec(log)?.[1] ?? 0);
  mkdirSync(dirname(out), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", input, "-af", `volume=${(-3 - max).toFixed(2)}dB`, "-ar", "48000", "-ac", "2", out]);
}

export type KitUse = { credits: number; made: string[] };

export async function sfx(name: string, use: KitUse): Promise<string> {
  const out = join(DIR, "sfx", `${name}.wav`);
  if (existsSync(out)) return out;
  const def = KIT.sfx[name];
  if (!def) throw new Error(`no sfx "${name}" in audio/kit.json`);
  let raw = join(DIR, "src", `${name}.mp3`);
  if (!existsSync(raw)) {
    raw = await write(raw, await eleven("/v1/sound-generation?output_format=mp3_44100_128", { text: def.text, duration_seconds: def.seconds, prompt_influence: 0.5 }));
    use.credits += 200;
    use.made.push(`sfx ${name}`);
  }
  peakNormalize(raw, out);
  return out;
}

export async function music(mood: string, use: KitUse): Promise<string> {
  const out = join(DIR, "music", `${mood}.wav`);
  if (existsSync(out)) return out;
  const def = KIT.music[mood];
  if (!def) throw new Error(`no music mood "${mood}" in audio/kit.json`);
  // Downloaded sources are kept, so a failed post-process never pays for a second generation.
  let raw = join(DIR, "src", `${mood}.mp3`);
  if (!existsSync(raw)) {
    raw = await write(raw, await eleven("/v1/music?output_format=mp3_44100_128", { prompt: def.prompt, music_length_ms: def.seconds * 1000, model_id: "music_v2_5", force_instrumental: true }));
    use.credits += Math.ceil((def.seconds / 60) * 900);
    use.made.push(`music ${mood}`);
  }
  // Beds sit at -26 LUFS: about 10 dB under the narration before ducking takes them lower during speech.
  normalize(raw, out, -26);
  return out;
}
