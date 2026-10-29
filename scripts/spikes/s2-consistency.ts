// S2: does Muse Image keep one character and style across 8 shots with the reference attached?
// Makes an anchor sheet, fans out 7 /images/edits calls in parallel with it, then asks Spark to check drift.
// Spends 8 images ($0.08) plus one Spark call (~$0.02). Reuses images already in media/spikes/s2/.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { metaPost, metaEdit, rateHeaders } from "../lib/meta.ts";
import { dims } from "../lib/image.ts";
import { save } from "../lib/util.ts";

const DIR = "media/spikes/s2";
const STYLE =
  "Flat vector illustration in a modern science explainer style: bold simple shapes, soft gradients, " +
  "limited palette of teal, navy, warm orange and cream, subtle grain, no outlines. Absolutely no text, letters, numbers or captions anywhere.";
const CHARACTER =
  "Dr. Ama, a young Ghanaian woman scientist with short black natural hair, round gold glasses, " +
  "an orange turtleneck under a teal lab coat, and a small silver pendant shaped like a drop of water.";
const base = { model: "muse-image-1.0", size: "1152x2048", response_format: "b64_json", output_format: "png", reasoning_strength: "low", tool_enablement: { enable_web_search: false, enable_image_search: false, enable_shell: false } };

const anchorPrompt = `${STYLE} Character reference: ${CHARACTER} Full body, front view, standing on a plain cream background.`;
const anchorPath = `${DIR}/0-anchor.png`;
if (!existsSync(anchorPath)) {
  const anchor = await metaPost("/images/generations", { ...base, prompt: anchorPrompt, n: 1 });
  const anchorB64 = anchor.json?.data?.[0]?.b64_json;
  if (!anchorB64) throw new Error(`anchor failed ${anchor.status}: ${anchor.text.slice(0, 400)}`);
  await save(anchorPath, Buffer.from(anchorB64, "base64"));
  console.log(JSON.stringify({ shot: 0, status: anchor.status, ms: anchor.ms, rate: rateHeaders(anchor.headers) }));
}

const shots = [
  "She kneels by a cobbled street water pump at night, holding a lantern, looking worried.",
  "Close-up of her face, eyebrows raised in surprise, looking through a magnifying glass.",
  "She stands at a lab bench pouring blue liquid between two flasks, side view.",
  "Seen from behind, she looks up at a giant glowing map of a city on a wall.",
  "She runs across a rainy bridge holding papers, motion, low angle.",
  "She sits at a wooden desk writing in a notebook under a desk lamp, top-down three quarter view.",
  "Wide shot: she is small in the frame, standing in a crowd of people in a busy market square.",
];

const results = await Promise.all(
  shots.map(async (scene, i) => {
    const done = `${DIR}/${i + 1}.png`;
    if (existsSync(done)) return done;
    const prompt = `Same character and same art style as the reference image. ${CHARACTER} Scene: ${scene} ${STYLE}`;
    const r = await metaEdit({ ...base, prompt, n: 1 }, [anchorPath]);
    const b64 = r.json?.data?.[0]?.b64_json;
    const path = b64 ? await save(`${DIR}/${i + 1}.png`, Buffer.from(b64, "base64")) : undefined;
    console.log(JSON.stringify({ shot: i + 1, status: r.status, ms: r.ms, out: path ? dims(path) : undefined, error: b64 ? undefined : r.text.slice(0, 400) }));
    return path;
  }),
);

const paths = [anchorPath, ...results.filter((p): p is string => !!p)];
if (paths.length === 1) throw new Error("every edit failed, skipping the judge");
// Judge on 576x1024 JPEGs: full PNGs are ~29 MB inline, over the request limit.
const small = (p: string) => {
  const out = p.replace(/\.png$/, "-small.jpg");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", p, "-vf", "scale=576:1024", "-q:v", "4", out]);
  return readFileSync(out).toString("base64");
};
const judge = await metaPost("/responses", {
  model: "muse-spark-1.3",
  store: false,
  reasoning: { effort: "low" },
  max_output_tokens: 16000,
  input: [{
    role: "user",
    content: [
      ...paths.flatMap((p, i) => [
        { type: "input_text", text: `Image ${i}${i === 0 ? " (reference)" : ""}:` },
        { type: "input_image", image_url: `data:image/jpeg;base64,${small(p)}` },
      ]),
      { type: "input_text", text:
        `You are a strict continuity supervisor. The intended character: ${CHARACTER} ` +
        "Compare every image to image 0. For each image report: same_person (true/false), drift (list of concrete differences in face, hair, glasses, clothing colors, pendant, body type), " +
        "style_match (0-10 vs image 0), stray_text (true if any letters or numbers appear). Reply with JSON only: " +
        '{"images":[{"i":1,"same_person":true,"drift":[],"style_match":9,"stray_text":false}],"verdict":"short summary"}' },
    ],
  }],
});
await save(`${DIR}/judge.json`, judge.text);
const out = judge.json?.output?.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join("") ?? "";
console.log(JSON.stringify({ judge: judge.status, usage: judge.json?.usage }));
console.log(out || judge.text.slice(0, 600));
