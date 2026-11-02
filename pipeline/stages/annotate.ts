// Stage 5d: annotate. Spark looks at every picture the video shows and says where its subject is (so a crop to the
// phone frame keeps it), where the part the narration is about is, and plans drawn marks on the spoken words. SAM then
// tightens the subject's box to the thing's real outline, and a second look at a crop refines a small target.
// Tools are options: most shots get few marks or none.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeMaskToRaster, parseImageStream, recordsOfKind, type ResponsesEvent } from "@meta-sam/parser";
import type { Asset, Box, Mark, Project, Shot } from "../../schemas/project.ts";
import { json, post, PRICE } from "../lib/meta.ts";
import { asked, charge, dir, prompt, stage } from "../lib/project.ts";
import { hash } from "../lib/util.ts";

const PARALLEL = 5;
const FRAME = 9 / 16; // the video's shape, width over height
const VERSION = 2;// bump when what a look returns changes, so cached looks are redone

// What the picture's crop must keep. Stored on the asset next to `focus` (the target) until schemas/project.ts has it.
export type Framing = { subject?: Box; pan?: boolean };
export type Framed = Asset & Framing;

type Found = Box & { found: boolean };
type Plan = { subject: Found & { name: string }; target: Found; zoom: boolean; pan: boolean; marks: Mark[] };
const num = { type: "number" } as const;
const box = { found: { type: "boolean" }, x: num, y: num, w: num, h: num } as const;
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "target", "zoom", "pan", "marks"],
  properties: {
    subject: { type: "object", additionalProperties: false, required: ["found", "name", "x", "y", "w", "h"], properties: { ...box, name: { type: "string" } } },
    target: { type: "object", additionalProperties: false, required: ["found", "x", "y", "w", "h"], properties: box },
    zoom: { type: "boolean" },
    pan: { type: "boolean" },
    marks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tool", "points", "word", "text", "color"],
        properties: {
          tool: { type: "string", enum: ["ring", "box", "underline", "arrow", "line", "dots", "label", "path"] },
          points: { type: "array", items: { type: "array", items: num } },
          word: { type: "integer" },
          text: { type: "string" },
          color: { type: "string", enum: ["accent", "highlight"] },
        },
      },
    },
  },
} as const;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
// A box kept inside the picture, or undefined when it is empty.
export function clean(b: Box | undefined): Box | undefined {
  if (!b || ![b.x, b.y, b.w, b.h].every(Number.isFinite)) return undefined;
  const [x0, y0] = [clamp(b.x), clamp(b.y)];
  const [x1, y1] = [clamp(b.x + b.w), clamp(b.y + b.h)];
  return x1 - x0 > 0.005 && y1 - y0 > 0.005 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
}
const area = (b: Box) => b.w * b.h;
export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
export const iou = (a: Box, b: Box) => overlap(a, b) / (area(a) + area(b) - overlap(a, b));

// Where SAM's outline of the subject and Spark's box agree, SAM's is the true edge. SAM can latch onto a different
// thing with a similar name, or a part of the subject, so its box is used only when it is the same thing: mostly
// inside Spark's box, and not a small piece of it.
export function agreed(spark: Box, sam: Box | undefined): Box {
  if (!sam) return spark;
  const inside = overlap(spark, sam) / area(sam);
  const covers = overlap(spark, sam) / area(spark);
  return inside > 0.7 && covers > 0.45 ? sam : spark;
}

function jpeg(image: string, out: string, filter: string): string {
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", image, "-vf", filter, "-q:v", "3", out]);
  return `data:image/jpeg;base64,${readFileSync(out).toString("base64")}`;
}

async function look(p: Project, shot: Shot, what: string, url: string, usd: { n: number }): Promise<Plan> {
  const all = p.narration!.words;
  const spoken = all.map((w, i) => ({ w, i })).filter(({ w }) => w.start >= shot.start && w.start < shot.end).map(({ w, i }) => `${i} ${w.text}`).join("\n");
  const wishes = asked(p.plan?.visuals ?? []);
  const r = await json<Plan>({
    system: prompt("annotate"),
    user: [
      { type: "input_image", image_url: url },
      { type: "input_text", text: `${wishes ? `${wishes}\n\n` : ""}The director's note (what this picture was meant to show; the picture may show something else or more): ${what}\n\nSpoken while this picture is on screen (number, word):\n${spoken}` },
    ],
    schema,
    schemaName: "marks",
    effort: "medium",
  });
  usd.n += r.usd;
  return r.value;
}

// The SAM parser reads a Responses event stream; a non-streamed reply is replayed as one delta.
async function* asEvents(text: string): AsyncIterable<ResponsesEvent> {
  const lane = { item_id: "m", output_index: 0, content_index: 0 };
  yield { type: "response.output_text.delta", ...lane, delta: text } as ResponsesEvent;
  yield { type: "response.output_text.done", ...lane, text } as ResponsesEvent;
  yield { type: "response.completed" } as ResponsesEvent;
}

// The box of SAM's most confident mask for a phrase, as fractions of the picture.
async function samBox(small: string, size: [number, number], phrase: string, usd: { n: number }): Promise<Box | undefined> {
  const r = await post("/responses", {
    model: "sam-3.1",
    store: false,
    metadata: { include_confidence: "true", mask_encoding: "lossless" },
    input: [{ role: "user", content: [{ type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(small).toString("base64")}` }, { type: "input_text", text: phrase }] }],
  });
  usd.n += PRICE.sam;
  const text = r.output?.[0]?.content?.[0]?.text ?? "";
  const masks = recordsOfKind((await parseImageStream(asEvents(text)).finalResult).records, "mask") as any[];
  const best = [...masks].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  if (!best) return undefined;
  // Trim the box to the mask's real pixels, so stray empty rows at the edges do not count.
  const raster = decodeMaskToRaster(best.mask) as ArrayLike<number>;
  const [mw, mh] = [best.mask.width as number, best.mask.height as number];
  let [x0, y0, x1, y1] = [mw, mh, -1, -1];
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (raster[y * mw + x]) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  if (x1 < 0) return undefined;
  const b = best.bounds;
  const [bw, bh] = [b.right - b.left, b.bottom - b.top];
  const left = b.left + (x0 / mw) * bw;
  const top = b.top + (y0 / mh) * bh;
  return clean({ x: left / size[0], y: top / size[1], w: (((x1 + 1 - x0) / mw) * bw) / size[0], h: (((y1 + 1 - y0) / mh) * bh) / size[1] });
}

// Pictures shown with their own words: the director's look, else what the shot asked the picture to be.
const hint = (shot: Shot, a: Asset) => a.look || shot.asset?.focus || shot.asset?.subject || shot.asset?.prompt || shot.asset?.query || "what the picture shows";

async function one(p: Project, shot: Shot, a: Framed, usd: { n: number }): Promise<void> {
  const image = join(dir(p), a.path!);
  const what = hint(shot, a);
  const words = p.narration!.words;
  const spoken = words.filter((w) => w.start >= shot.start && w.start < shot.end).map((w) => w.text);
  // Each picture's look is cached on its own, so adding pictures or rerunning does not pay again for the rest.
  const cacheFile = join(dir(p), "assets", `${shot.id}.annotate.json`);
  // Keyed on VERSION rather than the prompt's wording, so a wording fix does not pay again for every picture.
  const key = hash(VERSION, a.path, statSync(image).size, what, spoken, shot.start, p.plan?.visuals ?? []);
  if (existsSync(cacheFile)) {
    const c = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (c.key === key) return void Object.assign(a, c.result);
  }
  const first = await look(p, shot, what, jpeg(image, `${image}.look.jpg`, "scale='min(iw,1024)':-2"), usd);
  const subject0 = first.subject.found ? clean(first.subject) : undefined;
  let target = first.target.found ? clean(first.target) : undefined;

  // SAM finds the subject's true outline, so the crop is not off by a model's rough box.
  let subject = subject0;
  if (subject0 && first.subject.name.trim() && area(subject0) < 0.9) {
    const small = `${image}.sam.jpg`;
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", image, "-vf", "scale='min(iw,1600)':-2", "-q:v", "3", small]);
    const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", small]).toString().trim().split(",").map(Number);
    const sam = await samBox(small, [out[0]!, out[1]!], first.subject.name.trim(), usd).catch((e) => (console.log(`  ${shot.id} sam error: ${e.message}`), undefined));
    subject = agreed(subject0, sam);
  }

  // A second look at a crop around a small target: small errors in the whole picture show once the camera moves in.
  let plan = first;
  let map = (x: number, y: number): [number, number] => [x, y];
  if (target) {
    const cw = Math.max(target.w * 2.5, 0.3);
    const ch = Math.max(target.h * 2.5, 0.3);
    if (cw < 1 && ch < 1) {
      const cx = Math.min(Math.max(target.x + target.w / 2 - cw / 2, 0), 1 - cw);
      const cy = Math.min(Math.max(target.y + target.h / 2 - ch / 2, 0), 1 - ch);
      const second = await look(p, shot, what, jpeg(image, `${image}.crop.jpg`, `crop=iw*${cw}:ih*${ch}:iw*${cx}:ih*${cy},scale=1024:-2:flags=lanczos`), usd);
      map = (x, y) => [cx + x * cw, cy + y * ch];
      const t = second.target;
      const [x, y] = map(t.x, t.y);
      const refined = t.found ? clean({ x, y, w: t.w * cw, h: t.h * ch }) : undefined;
      if (refined) {
        target = refined;
        plan = second;
      } else map = (x, y) => [x, y];
    }
  }
  if (process.env.ANNOTATE_DEBUG) console.log(`  ${shot.id} subject "${first.subject.name}" ${JSON.stringify(subject0)} -> ${JSON.stringify(subject)}, target ${JSON.stringify(target)}`);
  const result: Framing & Pick<Asset, "focus" | "zoom" | "marks"> = {
    subject: subject ?? target,
    focus: target ?? subject,
    zoom: first.zoom,
    pan: first.pan,
    marks: plan.marks
      .filter((m) => m.points.length && m.points.every((q) => q.length === 2) && words[m.word])
      .map((m) => ({ ...m, points: m.points.map(([x, y]) => map(clamp(x!), clamp(y!))), text: m.tool === "label" ? m.text : undefined })),
  };
  for (const k of ["subject", "focus"] as const) if (!result[k]) delete result[k];
  Object.assign(a, result);
  writeFileSync(cacheFile, JSON.stringify({ key, result }));
}

export async function annotate(p: Project, force = false) {
  const assets = new Map((p.assets ?? []).map((a) => [a.shotId, a]));
  // Pictures the director wants to guide the eye on, and every picture whose shape differs from the frame's, because the
  // crop to the phone frame needs to know where its subject is. A picture already the frame's shape is never cropped.
  const shaped = (a: Asset) => !a.size || Math.abs(a.size[0] / a.size[1] - FRAME) > 0.02;
  const todo = p.shots!.filter((s) => {
    const a = assets.get(s.id);
    return a?.path && !a.missing && (a.look || shaped(a));
  });
  await stage(p, "annotate", [VERSION, todo.map((s) => [s.id, hint(s, assets.get(s.id)!), assets.get(s.id)?.path]), prompt("annotate")], todo.length * 0.012, async () => {
    const usd = { n: 0 };
    try {
      for (let i = 0; i < todo.length; i += PARALLEL) {
        await Promise.all(todo.slice(i, i + PARALLEL).map((s) => one(p, s, assets.get(s.id)!, usd).catch((e) => console.log(`  ${s.id} annotate error: ${e.message}`))));
      }
    } finally {
      charge(p, "annotate", usd.n, `${todo.length} shots, ${todo.reduce((n, s) => n + (assets.get(s.id)?.marks?.length ?? 0), 0)} marks`);
    }
    for (const s of todo) console.log(`  ${s.id}: ${(assets.get(s.id)?.marks ?? []).map((m) => m.tool).join(", ") || "no marks"}`);
  }, force);
}
