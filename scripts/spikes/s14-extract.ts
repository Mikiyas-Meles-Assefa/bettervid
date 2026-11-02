// Extracts the S14 frames at full size, with one second before and after for the sequence test.
// node --experimental-strip-types scripts/spikes/s14-extract.ts
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FRAMES, PROJECTS } from "./s14-frames.ts";

const out = join(process.cwd(), "media/spikes/s14");
mkdirSync(out, { recursive: true });
for (const f of FRAMES) {
  const video = join(process.cwd(), "projects", PROJECTS[f.project as keyof typeof PROJECTS], "video.mp4");
  for (const [tag, dt] of [["a", -1.2], ["b", 0], ["c", 1.2]] as const) {
    execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(f.t + dt), "-i", video, "-frames:v", "1", "-q:v", "2", join(out, `${f.id}-${tag}.jpg`)]);
  }
}
execFileSync("ffmpeg", ["-y", "-v", "error", "-pattern_type", "glob", "-i", join(out, "*-b.jpg"), "-vf", "scale=216:-2,tile=9x3", "-q:v", "4", join(out, "sheet.jpg")]);
console.log(`extracted ${FRAMES.length * 3} frames to ${out}`);
