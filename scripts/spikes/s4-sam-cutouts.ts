// S4: does SAM 3.1 cut cleanly from photos, paintings and illustrations? One concept per image.
// Spends $0.0025 per image. Usage: npm run spike scripts/spikes/s4-sam-cutouts.ts [name=concept ...]
// Writes each mask as a PGM next to the source; cutouts are composited by Pillow.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { decodeMaskToRaster, parseImageStream, recordsOfKind, type ResponsesEvent } from "@meta-sam/parser";
import { metaPost } from "../lib/meta.ts";

const DIR = "media/spikes/s4";
const cases = [
  { name: "einstein", src: `${DIR}/src/einstein.jpg`, concept: "man", kind: "photo" },
  { name: "migrant", src: `${DIR}/src/migrant.jpg`, concept: "woman", kind: "photo" },
  { name: "vangogh", src: `${DIR}/src/vangogh.jpg`, concept: "man", kind: "painting" },
  { name: "vermeer", src: `${DIR}/src/vermeer.jpg`, concept: "woman", kind: "painting" },
  { name: "hokusai", src: `${DIR}/src/hokusai.jpg`, concept: "wave", kind: "print" },
  { name: "ama-face", src: "media/spikes/s2/2.png", concept: "woman", kind: "illustration" },
  { name: "ama-lab", src: "media/spikes/s2/3.png", concept: "woman", kind: "illustration" },
  { name: "anime", src: "media/spikes/s3/anime-0.png", concept: "man", kind: "illustration" },
  { name: "retro", src: "media/spikes/s3/retro-0.png", concept: "man", kind: "illustration" },
  { name: "collage-pump", src: "media/spikes/s3/collage-1.png", concept: "water pump", kind: "illustration" },
];

// Optional args "name=concept" rerun only those cases with a different concept phrase.
const overrides = process.argv.slice(2).map((a) => a.split("="));
const run = overrides.length
  ? overrides.map(([name, concept]) => ({ ...cases.find((c) => c.name === name)!, concept, name: `${name}-${concept.replace(/\W+/g, "_")}` }))
  : cases;

// The parser consumes a Responses event stream; a non-streamed reply is replayed as one delta.
async function* asEvents(text: string): AsyncIterable<ResponsesEvent> {
  const lane = { item_id: "m", output_index: 0, content_index: 0 };
  yield { type: "response.output_text.delta", ...lane, delta: text } as ResponsesEvent;
  yield { type: "response.output_text.done", ...lane, text } as ResponsesEvent;
  yield { type: "response.completed" } as ResponsesEvent;
}

for (const c of run) {
  const jpg = `${DIR}/${c.name}.jpg`;
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", c.src, "-q:v", "2", jpg]);
  const r = await metaPost("/responses", {
    model: "sam-3.1",
    metadata: { include_confidence: "true", mask_encoding: "lossless" },
    input: [{ role: "user", content: [
      { type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(jpg).toString("base64")}` },
      { type: "input_text", text: c.concept },
    ] }],
  });
  const text = r.json?.output?.[0]?.content?.[0]?.text ?? "";
  writeFileSync(`${DIR}/${c.name}.txt`, text);
  const result = await parseImageStream(asEvents(text)).finalResult;
  const masks = recordsOfKind(result.records, "mask");
  const objects = masks.map((m: any, i: number) => {
    const raster = decodeMaskToRaster(m.mask);
    const { height, width } = m.mask;
    const pgm = `${DIR}/${c.name}-mask${i}.pgm`;
    writeFileSync(pgm, Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), Buffer.from(raster.map((v: number) => v * 255))]));
    return { id: m.objectId, bounds: m.bounds, confidence: m.confidence, size: [width, height], pgm };
  });
  console.log(JSON.stringify({ ...c, status: r.status, ms: r.ms, objects, diagnostics: result.diagnostics.length, error: r.status === 200 ? undefined : r.text.slice(0, 300) }));
}
