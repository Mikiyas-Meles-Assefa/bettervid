// S5: can Spark catch 5 planted faults in a test video? Builds a 17 s, 7-shot video from the S2 images
// with captions, plants 5 faults, then asks Spark for fix tickets two ways: from the MP4, and from one
// keyframe per shot. Both get the shot list. Spends ~$0.02 per call.
// Usage: npm run spike scripts/spikes/s5-critic-faults.ts [runs]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { metaPost, metaUpload } from "../lib/meta.ts";
import { save } from "../lib/util.ts";

const DIR = "media/spikes/s5";
const RUNS = Number(process.argv[2] ?? 1);
const CHARACTER = "Dr. Ama: short black natural hair, round gold glasses, orange turtleneck, teal lab coat, silver water-drop pendant.";

// fault is ground truth for scoring; the critic never sees it.
const shots = [
  { img: "1", secs: 2, intended: "Ama kneels by the water pump at night with a lantern", caption: "In 1854, cholera hit London.", zoom: true },
  { img: "2", secs: 2, intended: "Close-up: Ama looks through a magnifying glass", caption: "Dr. Ama started to investigate.", zoom: true },
  { img: "7", secs: 2, intended: "Ama pours samples between flasks in her lab", caption: "She tested the water samples.", zoom: true, fault: "wrong_visual" },
  { img: "4", secs: 2, intended: "Ama looks up at a glowing map of the city", caption: "She mapped every cholrea death.", zoom: true, fault: "typo" },
  { img: "6", secs: 5, intended: "Ama writes in her notebook at her desk", caption: "Night after night, she wrote.", zoom: false, fault: "static_too_long" },
  { img: "5", secs: 2, intended: "Ama runs across a rainy bridge with her papers", caption: "Then she ran to the council.", zoom: true, fault: "character_drift" },
  { img: "3", secs: 2, intended: "Ama at her lab bench, the case is closed", caption: "The pump handle came off.", zoom: true, fault: "caption_offscreen" },
];

function build(): string {
  const out = `${DIR}/test.mp4`;
  if (existsSync(out)) return out;
  const spec = JSON.stringify(shots.map((s) => ({ ...s, src: `media/spikes/s2/${s.img}.png` })));
  // Pillow draws 10 fps frames: slow zoom, caption in a rounded box at 70% height. The off-screen fault shifts the caption right.
  execFileSync("python3", ["-I", "-c", `
import json, os
from PIL import Image, ImageDraw, ImageFont
shots = json.loads(${JSON.stringify(spec)})
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 64)
os.makedirs("${DIR}/frames", exist_ok=True)
n = 0
for s in shots:
    src = Image.open(s["src"]).convert("RGB").resize((1080, 1920))
    frames = s["secs"] * 10
    for f in range(frames):
        z = 1 + 0.08 * f / frames if s["zoom"] else 1
        w, h = int(1080 / z), int(1920 / z)
        im = src.crop(((1080 - w) // 2, (1920 - h) // 2, (1080 + w) // 2, (1920 + h) // 2)).resize((1080, 1920))
        d = ImageDraw.Draw(im)
        cx = 540 + (520 if s.get("fault") == "caption_offscreen" else 0)
        box = d.textbbox((cx, 1350), s["caption"], font=font, anchor="mm")
        d.rounded_rectangle((box[0] - 30, box[1] - 20, box[2] + 30, box[3] + 20), 24, fill=(0, 0, 0))
        d.text((cx, 1350), s["caption"], font=font, fill="white", anchor="mm")
        im.save(f"${DIR}/frames/{n:05d}.png")
        n += 1
`]);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-framerate", "10", "-i", `${DIR}/frames/%05d.png`, "-r", "30",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
  return out;
}

const shotList = (() => {
  let t = 0;
  return shots.map((s, i) => {
    const line = `Shot ${i + 1}, ${t}s to ${t + s.secs}s: visual "${s.intended}", caption "${s.caption}"`;
    t += s.secs;
    return line;
  }).join("\n");
})();

const instructions =
  `You are the quality critic for a short vertical explainer video (1080x1920). Character spec: ${CHARACTER}\n` +
  `Intended shot list:\n${shotList}\n\n` +
  "House rules: every caption is spelled correctly and fully inside the frame with margin; every visual matches its shot list line; " +
  "the character matches the spec in every shot; no shot holds a still image without motion for more than 3 seconds.\n" +
  "Report only real problems you can see. Reply with JSON only: " +
  '{"tickets":[{"shot":1,"type":"typo|caption_offscreen|wrong_visual|character_drift|static_too_long|other","detail":"..."}]}';

async function critique(content: unknown[], label: string, run: number) {
  const r = await metaPost("/responses", {
    model: "muse-spark-1.3",
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: 16000,
    input: [{ role: "user", content }],
  });
  await save(`${DIR}/critique-${label}-${run}.json`, r.text);
  const text = r.json?.output?.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join("") ?? "";
  let tickets: any[] = [];
  try {
    tickets = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)).tickets ?? [];
  } catch {}
  const planted = shots.map((s, i) => ({ shot: i + 1, fault: s.fault })).filter((s) => s.fault);
  const caught = planted.filter((p) => tickets.some((t) => t.shot === p.shot && t.type === p.fault));
  const caughtAnyType = planted.filter((p) => tickets.some((t) => t.shot === p.shot));
  const falseAlarms = tickets.filter((t) => !planted.some((p) => p.shot === t.shot));
  const u = r.json?.usage ?? {};
  console.log(JSON.stringify({ label, run, status: r.status, ms: r.ms, usage: u, cost: +((u.input_tokens ?? 0) * 1.25e-6 + (u.output_tokens ?? 0) * 4.25e-6).toFixed(4),
    caught: caught.map((c) => c.fault), caughtOnShotAnyType: caughtAnyType.length, falseAlarms, tickets }));
}

const video = build();
const up = await metaUpload(video, "video/mp4");
if (!up.json?.id) throw new Error(`upload failed ${up.status}: ${up.text.slice(0, 300)}`);

// Keyframes: the middle frame of each shot, 540x960 JPEG.
let t = 0;
const keyframes = shots.map((s, i) => {
  const path = `${DIR}/key-${i + 1}.jpg`;
  execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(t + s.secs / 2), "-i", video, "-frames:v", "1", "-vf", "scale=540:960", "-q:v", "3", path]);
  t += s.secs;
  return path;
});

for (let run = 1; run <= RUNS; run++) {
  await critique([{ type: "input_video", file_id: up.json.id }, { type: "input_text", text: instructions }], "video", run);
  await critique([
    ...keyframes.flatMap((p, i) => [
      { type: "input_text", text: `Keyframe from the middle of shot ${i + 1}:` },
      { type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(p).toString("base64")}` },
    ]),
    { type: "input_text", text: instructions },
  ], "keyframes", run);
}
