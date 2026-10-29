// Stages 5a to 5c: real assets from archives (Spark picks), generated art (Muse Image) as the fallback,
// and SAM cutouts with the outline baked in. Shots run in parallel, a few at a time.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeMaskToRaster, parseImageStream, recordsOfKind, type ResponsesEvent } from "@meta-sam/parser";
import type { Asset, Project, Shot, StyleFile } from "../../schemas/project.ts";
import { download, MIN_SIDE, searchArchives, type Candidate } from "../lib/archives.ts";
import { json, post, PRICE } from "../lib/meta.ts";
import { charge, dir, stage, style } from "../lib/project.ts";
import { hash, write } from "../lib/util.ts";

const PARALLEL = 5;
// Bump when picking or cutout rules change, so cached shots are redone under the new rules.
const RULES_VERSION = 5;

type Spend = { usd: number; notes: string[] };

function dims(path: string): [number, number] {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path]).toString().trim();
  const [w, h] = out.split(",").map(Number);
  return [w ?? 0, h ?? 0];
}

// Normalizes any image to a JPEG at most 2048 px tall, which is all a 1920 px frame needs.
function toJpeg(input: string, out: string) {
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", input, "-vf", "scale='min(iw,2048*iw/ih)':'min(ih,2048)':flags=lanczos", "-q:v", "3", out]);
}

async function pickReal(p: Project, shot: Shot, spend: Spend): Promise<{ cand: Candidate; reason: string } | null> {
  const cands = (await searchArchives(shot.asset!.query)).slice(0, 8);
  const thumbs = await Promise.all(cands.map((c) => download(c.thumb).then((b) => Buffer.from(b).toString("base64")).catch(() => null)));
  const ok = cands.map((c, i) => ({ c, b64: thumbs[i] })).filter((x) => x.b64);
  if (ok.length < cands.length) spend.notes.push(`${shot.id} ${cands.length - ok.length} of ${cands.length} thumbnails failed to download`);
  if (!ok.length) {
    spend.notes.push(`${shot.id} no archive candidates for "${shot.asset!.query}"`);
    return null;
  }
  const beat = p.script!.beats.find((b) => b.id === shot.beatId);
  const r = await json<{ pick: number | null; usable: boolean; reason: string }>({
    system:
      "You pick real archival images for a documentary-style explainer video. Be strict: a loosely related or wrong subject is not usable; a different but accurate image of the same thing is fine. " +
      "Read any visible text, labels and titles: reject an image whose label names a different event, mission, date, place or person than the narration (for example a diagram labeled for a different mission). " +
      "Reject tiny, blurry or heavily cropped images. Prefer clear, high-contrast images that work full screen in a vertical video.",
    user: [
      ...ok.flatMap(({ c, b64 }, k) => [
        { type: "input_text", text: `Candidate ${k} (${c.source}, ${c.license}${c.size ? `, ${c.size}` : ""}): ${c.title}` },
        { type: "input_image", image_url: `data:image/jpeg;base64,${b64}` },
      ]),
      { type: "input_text", text: `Video topic: ${p.input.prompt}\nNarration: "${beat?.text}". The shot needs: ${shot.asset!.query}${shot.asset!.subject ? `, with a clear ${shot.asset!.subject} to cut out` : ""}. Pick the best candidate, or null if none is accurate.` },
    ],
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["pick", "usable", "reason"],
      properties: { pick: { type: ["integer", "null"] }, usable: { type: "boolean" }, reason: { type: "string" } },
    },
    schemaName: "asset_pick",
  });
  spend.usd += r.usd;
  const v = r.value;
  if (!v.usable || v.pick == null) spend.notes.push(`${shot.id} picker rejected ${ok.length} candidates: ${v.reason}`);
  return v.usable && v.pick != null && ok[v.pick] ? { cand: ok[v.pick]!.c, reason: v.reason } : null;
}

// Muse Image refuses some prompts (content policy), e.g. disease scenes with bodies. Retry once with the
// neutral archive query; the caller turns the shot into a title card if that is refused too.
async function generate(shot: Shot, s: StyleFile, spend: Spend): Promise<Uint8Array | null> {
  for (const scene of [shot.asset!.prompt, shot.asset!.query].filter(Boolean)) {
    try {
      return await generateOnce(scene, s, spend);
    } catch (e: any) {
      if (!/content_policy_violation/.test(e.message)) throw e;
      spend.notes.push(`${shot.id} prompt refused by content policy: "${scene.slice(0, 80)}"`);
    }
  }
  return null;
}

async function generateOnce(scene: string, s: StyleFile, spend: Spend): Promise<Uint8Array> {
  const r = await post("/images/generations", {
    model: "muse-image-1.0",
    prompt: `${s.artPrefix} Scene: ${scene}`,
    size: "1152x2048",
    n: 1,
    response_format: "b64_json",
    output_format: "jpeg",
    reasoning_strength: "low",
    tool_enablement: { enable_web_search: false, enable_image_search: false, enable_shell: false },
  });
  spend.usd += PRICE.image;
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("muse image returned no image");
  return Buffer.from(b64, "base64");
}

// The SAM parser reads a Responses event stream; a non-streamed reply is replayed as one delta.
async function* asEvents(text: string): AsyncIterable<ResponsesEvent> {
  const lane = { item_id: "m", output_index: 0, content_index: 0 };
  yield { type: "response.output_text.delta", ...lane, delta: text } as ResponsesEvent;
  yield { type: "response.output_text.done", ...lane, text } as ResponsesEvent;
  yield { type: "response.completed" } as ResponsesEvent;
}

// Cutouts are for people and objects. Scenery has no edge to cut along (Oct 29: an "ocean" cutout came out as a strip).
const SCENERY = /\b(sky|sea|ocean|water|horizon|landscape|field|city|street|map|mountain|cloud|sunset|sunrise|beach|forest|desert|room|space|light)s?\b/i;

async function cutout(image: string, subject: string, out: string, spend: Spend): Promise<boolean> {
  if (SCENERY.test(subject)) return false;
  const small = `${image}.sam.jpg`;
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", image, "-vf", "scale='min(iw,1600)':-2", "-q:v", "3", small]);
  const [iw, ih] = dims(small);
  const r = await post("/responses", {
    model: "sam-3.1",
    store: false,
    metadata: { include_confidence: "true", mask_encoding: "lossless" },
    input: [{ role: "user", content: [{ type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(small).toString("base64")}` }, { type: "input_text", text: subject }] }],
  });
  spend.usd += PRICE.sam;
  const text = r.output?.[0]?.content?.[0]?.text ?? "";
  const masks = recordsOfKind((await parseImageStream(asEvents(text)).finalResult).records, "mask") as any[];
  if (!masks.length) return false;
  const best = masks.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  const raster = decodeMaskToRaster(best.mask);
  const bw = (best.bounds.right - best.bounds.left) / iw;
  const bh = (best.bounds.bottom - best.bounds.top) / ih;
  // Scenery, not a subject: a full-width thin band, or a mask that fills nearly the whole frame.
  // Use the mask's real area, not its box: a portrait's box covers most of the photo but the person doesn't.
  const area = (raster.reduce((n: number, v: number) => n + v, 0) / raster.length) * bw * bh;
  if ((bw > 0.95 && bh < 0.4) || area > 0.85) return false;
  const pgm = `${out}.pgm`;
  writeFileSync(pgm, Buffer.concat([Buffer.from(`P5\n${best.mask.width} ${best.mask.height}\n255\n`), Buffer.from(raster.map((v: number) => v * 255))]));
  const b = best.bounds;
  execFileSync("python3", ["-I", "pipeline/tools/bake_cutout.py", small, pgm, String(b.left), String(b.top), String(b.right), String(b.bottom), out]);
  return true;
}

// Each shot's result is cached in assets/<shot>.json under a hash of what it depends on, so a failed or
// changed run only redoes the shots that need it.
async function one(p: Project, shot: Shot, s: StyleFile, spend: Spend): Promise<Asset> {
  const folder = join(dir(p), "assets");
  const key = hash(RULES_VERSION, shot.type, shot.asset, s.artPrefix);
  const cacheFile = join(folder, `${shot.id}.json`);
  if (existsSync(cacheFile)) {
    const c = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (c.key === key) return c.asset;
  }
  const result = await make(p, shot, s, spend, folder);
  await write(cacheFile, JSON.stringify({ key, asset: result }));
  return result;
}

async function make(p: Project, shot: Shot, s: StyleFile, spend: Spend, folder: string): Promise<Asset> {
  const rel = `assets/${shot.id}.jpg`;
  const abs = join(dir(p), rel);
  let asset: Asset | undefined;
  if (shot.asset!.kind === "real" && shot.asset!.query) {
    const pick = await pickReal(p, shot, spend).catch((e) => (spend.notes.push(`${shot.id} archive error: ${e.message}`), null));
    const raw = pick && (await write(join(folder, `${shot.id}.src`), await download(pick.cand.full)));
    const [w, h] = raw ? dims(raw) : [0, 0];
    if (pick && Math.min(w, h) < MIN_SIDE) spend.notes.push(`${shot.id} archive pick "${pick.cand.title}" is only ${w}x${h}, generating instead`);
    if (pick && raw && Math.min(w, h) >= MIN_SIDE) {
      toJpeg(raw, abs);
      asset = { shotId: shot.id, kind: "real", path: rel, title: pick.cand.title, source: pick.cand.source, license: pick.cand.license, credit: pick.cand.credit, page: pick.cand.page };
      spend.notes.push(`${shot.id} real: ${pick.cand.source} "${pick.cand.title}"`);
    } else if (!pick) spend.notes.push(`${shot.id} no usable archive image for "${shot.asset!.query}", generating`);
  }
  // Never generate a likeness of a real, named person: a portrait with no archive match becomes a title card.
  // A named person: a person subject plus "portrait" or a capitalized name ("Jim Lovell") in the query.
  const q = shot.asset!.query;
  const realPerson = shot.asset!.kind === "real" && /\b(man|woman|person|boy|girl)\b/i.test(shot.asset!.subject ?? "") && (/portrait/i.test(q) || /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(q));
  if (!asset && realPerson) {
    spend.notes.push(`${shot.id} no archive portrait for "${shot.asset!.query}"; not generating a real person, using a title card`);
    return { shotId: shot.id, kind: "none", override: { type: "kinetic_title", text: q.replace(/\bportrait\b/i, "").trim() } };
  }
  if (!asset) {
    const img = await generate(shot, s, spend);
    if (!img) {
      // Nothing to show: make it a title card of the beat's emphasis words instead.
      const text = p.script!.beats.find((b) => b.id === shot.beatId)?.emphasis.join(" ") ?? "";
      return { shotId: shot.id, kind: "none", override: { type: "kinetic_title", text } };
    }
    const raw = await write(join(folder, `${shot.id}.gen.jpg`), img);
    toJpeg(raw, abs);
    asset = { shotId: shot.id, kind: "generated", path: rel, source: "Muse Image (generated)" };
  }
  if (shot.type === "cutout_on_paper") {
    const subject = shot.asset!.subject || "person";
    const cut = `assets/${shot.id}-cut.png`;
    if (await cutout(abs, subject, join(dir(p), cut), spend).catch((e) => (spend.notes.push(`${shot.id} sam error: ${e.message}`), false))) asset.cutout = cut;
    else {
      // No mask means no cutout: show the image full screen instead (spike S4: some phrases never match).
      asset.override = { type: "photo_kenburns" };
      spend.notes.push(`${shot.id} no clean "${subject}" cutout, using photo_kenburns`);
    }
  }
  return asset;
}

export async function assets(p: Project, force = false) {
  const s = style(p.input.style);
  const todo = p.shots!.filter((x) => x.asset);
  await stage(p, "assets", [p.shots, s.artPrefix], todo.length * 0.02, async () => {
    const spend: Spend = { usd: 0, notes: [] };
    const out: Asset[] = [];
    try {
      for (let i = 0; i < todo.length; i += PARALLEL) {
        out.push(...(await Promise.all(todo.slice(i, i + PARALLEL).map((shot) => one(p, shot, s, spend)))));
      }
    } finally {
      // Charge what was spent even if a shot failed, so the ledger stays true.
      for (const n of spend.notes) console.log(`  ${n}`);
      charge(p, "assets", spend.usd, `${todo.length} shots, ${out.filter((a) => a.kind === "real").length} real, ${out.filter((a) => a.cutout).length} cutouts`);
    }
    p.assets = out;
  }, force);
}
