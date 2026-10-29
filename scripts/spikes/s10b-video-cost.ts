// S10b: real video input cost and frame sampling for the critic. Paid: one /responses call per clip.
// Clips show a big timestamp (0.1 s steps) and frame number, and the model is asked to list every one it can read.
// Usage: [EFFORT=minimal] npm run spike scripts/spikes/s10b-video-cost.ts [model] [secs ...]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { metaPost, metaUpload } from "../lib/meta.ts";
import { save } from "../lib/util.ts";

const MODEL = process.argv[2] ?? "muse-spark-1.3";
const EFFORT = process.env.EFFORT ?? "low";
const SECS = process.argv.slice(3).map(Number);
const DIR = "media/spikes/s10b";
const IN_PRICE = 1.25 / 1e6;
const OUT_PRICE = 4.25 / 1e6;
mkdirSync(DIR, { recursive: true });

// ffmpeg here has no drawtext, so Pillow draws one labeled frame per 0.1 s and ffmpeg holds each for 3 frames.
function makeClip(secs: number): string {
  const path = `${DIR}/stamp-${secs}s.mp4`;
  if (existsSync(path)) return path;
  const frames = `${DIR}/frames-${secs}`;
  mkdirSync(frames, { recursive: true });
  execFileSync("python3", ["-I", "-c", `
from PIL import Image, ImageDraw, ImageFont
f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 170)
for i in range(${secs * 10}):
    im = Image.new("RGB", (1080, 1920), (20 + i % 7 * 30, 60, 120))
    d = ImageDraw.Draw(im)
    d.text((540, 760), f"T {i / 10:.1f}", font=f, fill="white", anchor="mm")
    d.text((540, 1160), f"F {i * 3}", font=f, fill="yellow", anchor="mm")
    im.save(f"${frames}/{i:05d}.png")
`]);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-framerate", "10", "-i", `${frames}/%05d.png`, "-r", "30",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path]);
  return path;
}

const prompt =
  "This video shows a timestamp line 'T <seconds>' and a frame line 'F <frame number>'. " +
  "List every distinct pair you can read, in order, one per line as 'T=<seconds> F=<frame>'. " +
  "Then on a last line write 'SAMPLED=<count of pairs>'. No other text.";

for (const secs of SECS.length ? SECS : [10, 30]) {
  const path = makeClip(secs);
  const up = await metaUpload(path, "video/mp4");
  if (!up.json?.id) {
    console.log(JSON.stringify({ secs, upload: up.status, error: up.text.slice(0, 400) }));
    continue;
  }
  const r = await metaPost("/responses", {
    model: MODEL,
    reasoning: { effort: EFFORT },
    max_output_tokens: 4000,
    input: [{ role: "user", content: [{ type: "input_video", file_id: up.json.id }, { type: "input_text", text: prompt }] }],
  });
  await save(`${DIR}/response-${secs}s-${EFFORT}.json`, r.text);
  const u = r.json?.usage ?? {};
  const out = r.json?.output_text ?? r.json?.output?.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join("") ?? "";
  const pairs = [...out.matchAll(/T=([\d.]+)\s+F=(\d+)/g)].map((m) => [+m[1], +m[2]]);
  const cost = (u.input_tokens ?? 0) * IN_PRICE + (u.output_tokens ?? 0) * OUT_PRICE;
  console.log(JSON.stringify({
    secs, effort: EFFORT, status: r.status, ms: r.ms, usage: u,
    inPerSec: u.input_tokens ? +(u.input_tokens / secs).toFixed(1) : undefined,
    cost: +cost.toFixed(4), pairs: pairs.length, first: pairs.slice(0, 6), last: pairs.slice(-3),
    error: r.status === 200 ? undefined : r.text.slice(0, 500),
  }));
}
