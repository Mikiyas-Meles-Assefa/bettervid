// Stage: join the rendered picture with the mixed sound. The render draws the frames while the mix masters the audio,
// since neither needs the other; this step copies the picture stream and encodes the audio once, in seconds.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../../schemas/project.ts";
import { dir, stage } from "../lib/project.ts";

export const PICTURE = "picture.mp4"; // what the render writes: the frames, with whatever audio the timeline had then

export async function mux(p: Project, force = false) {
  const t = p.timeline!;
  const audio = existsSync(join(dir(p), "mix.wav")) ? "mix.wav" : t.audio;
  await stage(p, "mux", [p.stages.render?.hash, p.stages.mix?.hash, audio], 0, async () => {
    const t0 = Date.now();
    const picture = join(dir(p), PICTURE);
    if (!existsSync(picture)) throw new Error(`mux: no ${PICTURE} to join; run the render first`);
    const out = join(dir(p), "video.mp4");
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", picture, "-i", join(dir(p), audio), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", out], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`mux: ffmpeg failed: ${r.stderr.slice(-600)}`);
    console.log(`  mux: picture + ${audio} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    p.render = { path: "video.mp4", ms: Date.now() - t0 };
  }, force);
  if (!p.render && existsSync(join(dir(p), "video.mp4"))) p.render = { path: "video.mp4", ms: 0 };
}
