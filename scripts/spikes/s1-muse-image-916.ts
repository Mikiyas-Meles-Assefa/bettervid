// S1: does Muse Image return true 9:16? Spends 1 image ($0.01) per size.
// Usage: npm run spike scripts/spikes/s1-muse-image-916.ts [size ...]
import { metaPost, rateHeaders } from "../lib/meta.ts";
import { dims } from "../lib/image.ts";
import { save } from "../lib/util.ts";

const sizes = process.argv.slice(2).length ? process.argv.slice(2) : ["1080x1920", "1152x2048", "1024x1792"];
const prompt =
  "Vertical documentary collage poster: a Victorian London street map from 1854 on aged paper, " +
  "a hand-drawn red circle around Broad Street, halftone texture, film grain. Full bleed, no borders.";

for (const size of sizes) {
  const r = await metaPost("/images/generations", {
    model: "muse-image-1.0",
    prompt,
    size,
    n: 1,
    response_format: "b64_json",
    output_format: "png",
    reasoning_strength: "low",
  });
  const row: any = { size, status: r.status, ms: r.ms, rate: rateHeaders(r.headers) };
  const b64 = r.json?.data?.[0]?.b64_json;
  if (b64) {
    const path = await save(`media/spikes/s1/${size}.png`, Buffer.from(b64, "base64"));
    const d = dims(path);
    row.out = { ...d, ratio: +(d.width / d.height).toFixed(4), target: +(9 / 16).toFixed(4), path };
    row.revised_prompt = r.json.data[0].revised_prompt;
    row.usage = r.json.usage;
  } else row.error = r.text.slice(0, 600);
  console.log(JSON.stringify(row, null, 2));
}
