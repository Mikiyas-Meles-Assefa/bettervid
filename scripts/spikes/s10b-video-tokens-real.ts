// S10b: the free count endpoint ignores video, so read usage from a real call with output capped.
// Usage: npm run spike scripts/spikes/s10b-video-tokens-real.ts <clip.mp4> [model]
import { readFileSync } from "node:fs";
import { metaPost } from "../lib/meta.ts";

const clip = process.argv[2];
const model = process.argv[3] ?? "muse-spark-1.3";
const b64 = readFileSync(clip).toString("base64");
const r = await metaPost("/responses", {
  model,
  max_output_tokens: 64,
  reasoning: { effort: "low" },
  input: [{ role: "user", content: [{ type: "input_video", video_url: `data:video/mp4;base64,${b64}` }, { type: "input_text", text: "One word: what color dominates?" }] }],
});
console.log(JSON.stringify({ clip, model, status: r.status, ms: r.ms, usage: r.json?.usage, out: r.json?.output_text ?? r.json?.output?.at(-1), error: r.status === 200 ? undefined : r.text.slice(0, 500) }, null, 2));
