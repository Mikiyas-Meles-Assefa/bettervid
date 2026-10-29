// S9: does n=4 count as one request against Muse Image's 150 RPM? Spends 1 + 4 images ($0.05).
// Reads the remaining-requests header after an n=1 call and after an n=4 call.
import { metaPost, rateHeaders } from "../lib/meta.ts";
import { save } from "../lib/util.ts";

const base = { model: "muse-image-1.0", size: "1024x1792", response_format: "b64_json", output_format: "png", reasoning_strength: "low" };
const prompt = "Flat illustrated vertical poster of a water pump on a cobbled street, bold shapes, clean palette.";

for (const n of [1, 4]) {
  const r = await metaPost("/images/generations", { ...base, prompt, n });
  const imgs = r.json?.data ?? [];
  for (const [i, d] of imgs.entries()) if (d.b64_json) await save(`media/spikes/s9/n${n}-${i}.png`, Buffer.from(d.b64_json, "base64"));
  console.log(JSON.stringify({ n, status: r.status, ms: r.ms, returned: imgs.length, rate: rateHeaders(r.headers), usage: r.json?.usage, error: r.json ? undefined : r.text.slice(0, 400) }, null, 2));
}
