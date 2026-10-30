// Stage 5d + mix: places sound effects on the cuts, lays a music bed for the mode, ducks it under the voice,
// and masters the result to -14 LUFS / -1 dBTP in one ffmpeg graph (craft rules A1 to A4).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Clip, Project } from "../../schemas/project.ts";
import { KIT, music, sfx, type KitUse } from "../lib/kit.ts";
import { charge, dir, stage } from "../lib/project.ts";

const MIN_GAP = 1.5; // seconds between effects; more than one per ~2 s is noise (rule A3)
const FADE_OUT = 1.5;

type Hit = { name: string; at: number };

// One effect per cut at most, in priority order: impact on title slams, paper on cutouts and receipts,
// whoosh only where the shot type changes. The first shot gets nothing; the hook starts on the voice.
export function placeEffects(clips: Clip[], fps: number): Hit[] {
  const hits: Hit[] = [];
  clips.forEach((c, i) => {
    if (i === 0) return;
    const t = c.from / fps;
    const prev = clips[i - 1]!;
    const hit: Hit | null =
      c.type === "kinetic_title" ? { name: "impact", at: t } :
      c.type === "cutout_on_paper" ? { name: "paper", at: t + 0.12 } :
      c.type === "receipt" ? { name: "paper", at: t + 0.15 } :
      c.type !== prev.type ? { name: "whoosh", at: Math.max(0, t - 0.3) } : // whoosh peaks on the cut
      null;
    const last = hits.at(-1);
    if (hit && (!last || hit.at - last.at >= MIN_GAP || hit.name === "impact")) hits.push(hit);
  });
  return hits;
}

function graph(nHits: number, hits: Hit[], seconds: number, master: string): string {
  const fmt = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  const parts = [
    `[0:a]${fmt},apad=whole_dur=${seconds.toFixed(2)},asplit=2[vox][sc]`, // padded, or the ducked bed stops when the voice does
    `[1:a]${fmt},atrim=0:${seconds.toFixed(2)},afade=t=in:d=0.6,afade=t=out:st=${(seconds - FADE_OUT).toFixed(2)}:d=${FADE_OUT}[bed]`,
    // Duck the bed under speech: fast attack so the first syllable is clear, ~0.5 s release (research/voice-audio.md).
    `[bed][sc]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=500[duck]`,
  ];
  hits.forEach((h, i) => {
    const ms = Math.round(h.at * 1000);
    parts.push(`[${i + 2}:a]${fmt},volume=${KIT.sfx[h.name]!.gainDb}dB,adelay=${ms}|${ms}[s${i}]`);
  });
  const ins = ["[vox]", "[duck]", ...hits.map((_, i) => `[s${i}]`)].join("");
  parts.push(`${ins}amix=inputs=${2 + nHits}:normalize=0:duration=longest,atrim=0:${seconds.toFixed(2)},${master}[out]`);
  return parts.join(";");
}

function run(args: string[]): string {
  const r = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-800)}`);
  return r.stderr;
}

export async function mix(p: Project, force = false) {
  const t = p.timeline!;
  const mood = KIT.moodByMode[p.input.mode] ?? "documentary";
  const hits = placeEffects(t.clips, t.fps);
  await stage(p, "mix", [t.clips, t.frames, p.narration!.audio, mood, KIT], 0, async () => {
    const use: KitUse = { credits: 0, made: [] };
    const bed = await music(mood, use);
    const files: Record<string, string> = {};
    for (const h of hits) files[h.name] ??= await sfx(h.name, use);
    const seconds = t.frames / t.fps;
    const inputs = ["-i", join(dir(p), p.narration!.audio), "-stream_loop", "-1", "-i", bed, ...hits.flatMap((h) => ["-i", files[h.name]!])];
    // Two-pass loudnorm: measure the mix, then apply with the measured values (linear) for an exact -14 LUFS.
    const measure = run(["-v", "info", ...inputs, "-filter_complex", graph(hits.length, hits, seconds, "loudnorm=I=-14:TP=-1:LRA=11:print_format=json"), "-map", "[out]", "-f", "null", "-"]);
    const m = JSON.parse(measure.slice(measure.lastIndexOf("{"), measure.lastIndexOf("}") + 1));
    const master = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    const out = join(dir(p), "mix.wav");
    run(["-y", "-v", "error", ...inputs, "-filter_complex", graph(hits.length, hits, seconds, master), "-map", "[out]", "-ar", "48000", "-t", seconds.toFixed(2), out]);
    // Verify what was written.
    const check = run(["-v", "info", "-i", out, "-af", "loudnorm=I=-14:TP=-1:print_format=json", "-f", "null", "-"]);
    const c = JSON.parse(check.slice(check.lastIndexOf("{"), check.lastIndexOf("}") + 1));
    t.audio = "mix.wav";
    console.log(`  ${hits.length} effects (${hits.map((h) => h.name).join(", ")}), music "${mood}", ${c.input_i} LUFS, ${c.input_tp} dBTP`);
    if (use.made.length) console.log(`  generated kit: ${use.made.join(", ")}`);
    charge(p, "mix", 0, `ElevenLabs ${use.credits} credits for ${use.made.join(", ") || "nothing (kit cached)"}; ${c.input_i} LUFS`);
  }, force);
  // The timeline stage resets audio to the bare narration whenever it rebuilds, so point it at the mix even when cached.
  if (existsSync(join(dir(p), "mix.wav"))) t.audio = "mix.wav";
}

