// Stage mix: reasons over compiled visual moments, ducks sound under the voice,
// and masters the result to -14 LUFS / -1 dBTP in one ffmpeg graph (craft rules A1 to A4).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../../schemas/project.ts";
import { KIT, music, sfx, type KitUse } from "../lib/kit.ts";
import { charge, dir, stage } from "../lib/project.ts";

import { collectMoments, placements, reasonSound, type Hit } from "../lib/sound.ts";
import { extendKit } from "../lib/kit.ts";
import { write } from "../lib/util.ts";

type MusicCue = { name: string; at: number; level: number; why: string };
export function graph(hits: Hit[], cues: MusicCue[], seconds: number, master: string): string {
  const fmt = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  const parts = [`[0:a]${fmt},apad=whole_dur=${seconds},asplit=3[vox][sc][fxsc]`];
  cues.forEach((cue, i) => {
    const end = cues[i + 1]?.at ?? seconds;
    const fade = Math.min(0.25, (end - cue.at) / 2);
    const duration = Math.min(seconds - cue.at, end - cue.at + fade);
    const ms = Math.round(cue.at * 1000);
    parts.push(`[${i + 1}:a]${fmt},atrim=0:${duration},asetpts=PTS-STARTPTS,volume=${cue.level}dB,afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, duration - fade)}:d=${fade},adelay=${ms}|${ms}[b${i}]`);
  });
  parts.push(`${cues.map((_, i) => `[b${i}]`).join("")}amix=inputs=${cues.length}:normalize=0[bed]`);
  parts.push("[bed][sc]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=500[duck]");
  hits.forEach((h, i) => {
    const ms = Math.round(h.at * 1000);
    parts.push(`[${i + 1 + cues.length}:a]${fmt},atrim=0:${KIT.sfx[h.name]!.seconds},volume=${h.level}dB,adelay=${ms}|${ms}[s${i}]`);
  });
  if (hits.length) {
    parts.push(`${hits.map((_, i) => `[s${i}]`).join("")}amix=inputs=${hits.length}:normalize=0[fx]`);
    parts.push("[fx][fxsc]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=150[quietfx]");
  } else parts.push("[fxsc]anullsink");
  parts.push(`[vox][duck]${hits.length ? "[quietfx]" : ""}amix=inputs=${hits.length ? 3 : 2}:normalize=0:duration=longest,atrim=0:${seconds},${master}[out]`);
  return parts.join(";");
}

function run(args: string[]): string {
  const r = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-800)}`);
  return r.stderr;
}

export async function mix(p: Project, force = false) {
  const t = p.timeline!;
  const moments = collectMoments(p);
  await stage(p, "mix", ["event-sound-v1", { ...t, audio: p.narration!.audio }, p.direction, p.narration, KIT], 0.05, async () => {
    const use: KitUse = { credits: 0, made: [] };
    const decision = await reasonSound(p, moments);
    charge(p, "mix", decision.usd, "Spark sound direction");
    extendKit(decision.value.additions);
    const seconds = t.frames / t.fps;
    const { hits, music: cues } = placements(decision.value, moments, t.fps, seconds);
    await write(join(dir(p), "sound-plan.json"), JSON.stringify({ moments, ...decision, placements: { hits, music: cues } }, null, 2));
    const beds = [];
    for (const cue of cues) beds.push(await music(cue.name, use));
    const files: Record<string, string> = {};
    for (const h of hits) files[h.name] ??= await sfx(h.name, use);
    const inputs = ["-i", join(dir(p), p.narration!.audio), ...beds.flatMap((bed) => ["-stream_loop", "-1", "-i", bed]), ...hits.flatMap((h) => ["-i", files[h.name]!])];
    // Two-pass loudnorm: measure the mix, then apply with the measured values (linear) for an exact -14 LUFS.
    const measure = run(["-v", "info", ...inputs, "-filter_complex", graph(hits, cues, seconds, "loudnorm=I=-14:TP=-1.2:LRA=11:print_format=json"), "-map", "[out]", "-f", "null", "-"]);
    const m = JSON.parse(measure.slice(measure.lastIndexOf("{"), measure.lastIndexOf("}") + 1));
    const master = `loudnorm=I=-14:TP=-1.2:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    const out = join(dir(p), "mix.wav");
    run(["-y", "-v", "error", ...inputs, "-filter_complex", graph(hits, cues, seconds, master), "-map", "[out]", "-ar", "48000", "-t", seconds.toFixed(2), out]);
    // Verify what was written.
    const check = run(["-v", "info", "-i", out, "-af", "loudnorm=I=-14:TP=-1.2:print_format=json", "-f", "null", "-"]);
    const c = JSON.parse(check.slice(check.lastIndexOf("{"), check.lastIndexOf("}") + 1));
    if (!Number.isFinite(Number(c.input_i)) || !Number.isFinite(Number(c.input_tp)) || Math.abs(Number(c.input_i) + 14) > 0.5 || Number(c.input_tp) > -1) {
      throw new Error(`mix master outside target: ${c.input_i} LUFS, ${c.input_tp} dBTP`);
    }
    await write(join(dir(p), "sound-measurement.json"), JSON.stringify({ lufs: c.input_i, truePeak: c.input_tp, credits: use.credits, made: use.made, usd: decision.usd }, null, 2));
    t.audio = "mix.wav";
    delete p.stages.render;
    console.log(`  ${hits.length} effects (${hits.map((h) => h.name).join(", ")}), music ${cues.map((c) => c.name).join(", ")}, ${c.input_i} LUFS, ${c.input_tp} dBTP`);
    if (use.made.length) console.log(`  generated kit: ${use.made.join(", ")}`);
    charge(p, "mix", 0, `ElevenLabs ${use.credits} credits for ${use.made.join(", ") || "nothing (kit cached)"}; ${c.input_i} LUFS`);
  }, force);
  // The timeline stage resets audio to the bare narration whenever it rebuilds, so point it at the mix even when cached.
  if (existsSync(join(dir(p), "mix.wav"))) t.audio = "mix.wav";
}

