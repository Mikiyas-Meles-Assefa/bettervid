// S10: what does video input cost the critic? Uses the free input-token-count endpoint only.
// Makes synthetic 1080x1920 test clips with ffmpeg, then counts tokens per clip, sent both
// inline (data URL) and as an uploaded Files API file_id.
// Finding (Oct 29): the count endpoint returns ~1 token per video either way, so it can't price video.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { metaPost, metaUpload } from "../lib/meta.ts";

const MODEL = process.argv[2] ?? "muse-spark-1.3";
const DIR = "media/spikes/s10";
mkdirSync(DIR, { recursive: true });

const clips = [
  { secs: 5, audio: false },
  { secs: 10, audio: false },
  { secs: 30, audio: false },
  { secs: 60, audio: false },
  { secs: 30, audio: true },
];

function makeClip(secs: number, audio: boolean): string {
  const path = `${DIR}/test-${secs}s${audio ? "-audio" : ""}.mp4`;
  if (existsSync(path)) return path;
  const args = ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=size=1080x1920:rate=30:duration=${secs}`];
  if (audio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${secs}`);
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p");
  if (audio) args.push("-c:a", "aac", "-shortest");
  args.push("-movflags", "+faststart", path);
  execFileSync("ffmpeg", args);
  return path;
}

const count = (content: unknown[]) =>
  metaPost("/responses/input_tokens", { model: MODEL, input: [{ role: "user", content }] });

const baseline = await count([{ type: "input_text", text: "Critique this video." }]);
console.log(JSON.stringify({ case: "text only", status: baseline.status, body: baseline.json ?? baseline.text.slice(0, 400) }));
const base = baseline.json?.input_tokens ?? 0;

for (const c of clips) {
  const path = makeClip(c.secs, c.audio);
  const b64 = readFileSync(path).toString("base64");
  const up = await metaUpload(path, "video/mp4");
  const fileId = up.json?.id;
  const shapes: [string, unknown][] = [["data_url", { type: "input_video", video_url: `data:video/mp4;base64,${b64}` }]];
  if (fileId) shapes.push(["file_id", { type: "input_video", file_id: fileId }]);
  else console.log(JSON.stringify({ ...c, upload: up.status, error: up.text.slice(0, 400) }));
  for (const [via, video] of shapes) {
    const r = await count([video, { type: "input_text", text: "Critique this video." }]);
    const tokens = r.json?.input_tokens;
    console.log(JSON.stringify({ ...c, via, mb: +(b64.length / 1.37e6).toFixed(2), status: r.status, tokens, videoTokens: tokens != null ? tokens - base : undefined, perSec: tokens != null ? +((tokens - base) / c.secs).toFixed(1) : undefined, error: tokens == null ? r.text.slice(0, 400) : undefined }));
  }
}
