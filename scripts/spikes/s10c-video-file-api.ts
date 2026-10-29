// S10c: upload a clip through the Files API, then reference it by file_id (inline bodies over ~20 MB get 413).
// Usage: npm run spike scripts/spikes/s10c-video-file-api.ts <clip.mp4>
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { META_BASE, metaPost } from "../lib/meta.ts";
import { env } from "../lib/util.ts";

const clip = process.argv[2];
const form = new FormData();
form.append("purpose", "user_data");
form.append("file", new Blob([readFileSync(clip)], { type: "video/mp4" }), basename(clip));
const t0 = Date.now();
const up = await fetch(`${META_BASE}/files`, { method: "POST", headers: { authorization: `Bearer ${env("META_API_KEY")}` }, body: form });
const file = await up.json();
console.log(JSON.stringify({ upload: up.status, ms: Date.now() - t0, file }));
if (!up.ok) process.exit(1);

const r = await metaPost("/responses", {
  model: "muse-spark-1.3",
  max_output_tokens: 64,
  reasoning: { effort: "low" },
  input: [{ role: "user", content: [{ type: "input_video", file_id: file.id }, { type: "input_text", text: "One word: what color dominates?" }] }],
});
console.log(JSON.stringify({ status: r.status, ms: r.ms, usage: r.json?.usage, error: r.status === 200 ? undefined : r.text.slice(0, 500) }));
