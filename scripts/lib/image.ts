import { execFileSync } from "node:child_process";

export function dims(path: string): { width: number; height: number } {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path]).toString().trim();
  const [width, height] = out.split(",").map(Number);
  return { width, height };
}
