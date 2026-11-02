// ffmpeg helpers: what each reviewer is allowed to see or hear.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MotionGrid } from "./moments.ts";
import type { Part } from "./model.ts";

function withTemp<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "review-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ff = (args: string[]) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { maxBuffer: 1 << 30 });

const asVideo = (file: string): Part => ({ type: "input_video", video_url: `data:video/mp4;base64,${readFileSync(file).toString("base64")}` });

// Part of a video, with or without its sound.
export function clip(src: string, from: number, to: number, sound: boolean): Part {
  return withTemp((dir) => {
    const out = join(dir, "c.mp4");
    const a = sound ? ["-c:a", "aac", "-b:a", "48k"] : ["-an"];
    ff(["-ss", from.toFixed(2), "-to", to.toFixed(2), "-i", src, "-vf", "scale=540:-2,fps=6", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast", ...a, out]);
    return asVideo(out);
  });
}

// The sound of a video with nothing to see, so the audio-alone arm goes through the same door as the others.
export function soundOnly(src: string, from: number, to: number): Part {
  return withTemp((dir) => {
    const out = join(dir, "a.mp4");
    const seconds = (to - from).toFixed(2);
    ff(["-f", "lavfi", "-i", `color=c=black:s=480x480:r=2:d=${seconds}`, "-ss", from.toFixed(2), "-t", seconds, "-i", src, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-crf", "40", "-preset", "veryfast", "-c:a", "aac", "-b:a", "48k", "-shortest", out]);
    return asVideo(out);
  });
}

export function frame(src: string, at: number, width = 540): Part {
  const jpeg = ff(["-ss", at.toFixed(2), "-i", src, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"]);
  return { type: "input_image", image_url: `data:image/jpeg;base64,${jpeg.toString("base64")}` };
}

// How much each tile of the frame changes between samples, measured from the pixels.
export function motion(src: string, fps = 2, cols = 8, rows = 14): MotionGrid {
  const px = 8; // pixels per tile side
  const w = cols * px;
  const h = rows * px;
  const raw = ff(["-i", src, "-vf", `fps=${fps},scale=${w}:${h},format=gray`, "-f", "rawvideo", "pipe:1"]);
  const n = Math.floor(raw.length / (w * h));
  const change: number[][] = [];
  for (let f = 1; f < n; f++) {
    const a = raw.subarray((f - 1) * w * h, f * w * h);
    const b = raw.subarray(f * w * h, (f + 1) * w * h);
    const row = new Array(cols * rows).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) row[Math.floor(y / px) * cols + Math.floor(x / px)] += Math.abs(a[y * w + x] - b[y * w + x]);
    change.push(row.map((v) => v / (px * px * 255)));
  }
  return { fps, rows, cols, change };
}

export function duration(src: string): number {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).toString().trim());
}
