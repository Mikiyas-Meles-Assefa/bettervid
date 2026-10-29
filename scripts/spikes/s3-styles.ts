// S3: which styles does Muse Image do well? Same scene in each style, n=2, all in parallel.
// Flat illustrated is covered by S2. Spends 2 images per style ($0.08 for 4 styles).
// Usage: npm run spike scripts/spikes/s3-styles.ts [style ...]
import { existsSync } from "node:fs";
import { metaPost } from "../lib/meta.ts";
import { save } from "../lib/util.ts";

const DIR = "media/spikes/s3";
const SCENE = "A doctor in 1854 London leans over a table, studying a street map with dots marking deaths clustered around a water pump.";
const NO_TEXT = "Absolutely no text, letters, numbers or captions anywhere.";

const STYLES: Record<string, string> = {
  collage:
    "Documentary paper collage: cut-out vintage photographs with white borders and slight drop shadows, layered on aged paper, " +
    "halftone print texture, torn edges, red marker circles and a highlighter stroke, film grain.",
  whiteboard:
    "Whiteboard explainer drawing: confident black marker line art on a clean white board, simple shading with grey marker, " +
    "one accent color (blue) for highlights, hand-drawn arrows, minimal and clear.",
  anime:
    "High quality anime film still: clean cel shading, expressive character design, painted background with warm lamplight, " +
    "cinematic composition, soft bloom.",
  retro:
    "Retro 1960s educational print: limited palette of mustard, teal and brick red on off-white paper, " +
    "visible risograph misregistration and grain, mid-century modern shapes.",
};

const base = { model: "muse-image-1.0", size: "1152x2048", response_format: "b64_json", output_format: "png", reasoning_strength: "low", tool_enablement: { enable_web_search: false, enable_image_search: false, enable_shell: false } };
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(STYLES);

await Promise.all(
  names.map(async (name) => {
    if (existsSync(`${DIR}/${name}-0.png`)) return;
    const r = await metaPost("/images/generations", { ...base, prompt: `${STYLES[name]} Scene: ${SCENE} ${NO_TEXT}`, n: 2 });
    const imgs = r.json?.data ?? [];
    for (const [i, d] of imgs.entries()) if (d.b64_json) await save(`${DIR}/${name}-${i}.png`, Buffer.from(d.b64_json, "base64"));
    console.log(JSON.stringify({ name, status: r.status, ms: r.ms, returned: imgs.length, error: imgs.length ? undefined : r.text.slice(0, 400) }));
  }),
);
