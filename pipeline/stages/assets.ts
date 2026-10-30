// Stages 5a to 5c: real assets from archives (Spark picks), generated art (Muse Image) as the fallback,
// and SAM cutouts with the outline baked in. Shots run in parallel, a few at a time.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeMaskToRaster, parseImageStream, recordsOfKind, type ResponsesEvent } from "@meta-sam/parser";
import type { Asset, Project, Shot, StyleFile } from "../../schemas/project.ts";
import { download, MIN_SIDE, searchArchives, type Candidate } from "../lib/archives.ts";
import { json, post, PRICE } from "../lib/meta.ts";
import { asked, charge, dir, stage, style, topic } from "../lib/project.ts";
import { hash, write } from "../lib/util.ts";

const PARALLEL = 5;
// Bump when picking or cutout rules change, so cached shots are redone under the new rules.
const RULES_VERSION = 12;

// A shot with no image holds the previous one, but only so far: past this, the viewer is looking at something
// unrelated to what they are hearing.
const MAX_HOLD = 6;
// How many shots one real image may fill before gaps must look elsewhere.
const MAX_REPEATS = 3;

type Spend = { usd: number; notes: string[] };

function dims(path: string): [number, number] {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path]).toString().trim();
  const [w, h] = out.split(",").map(Number);
  return [w ?? 0, h ?? 0];
}

// Normalizes any image to a JPEG at most 2048 px tall, which is all a 1920 px frame needs.
function toJpeg(input: string, out: string) {
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", input, "-vf", "scale='min(iw,2048*iw/ih)':'min(ih,2048)':flags=lanczos", "-frames:v", "1", "-update", "1", "-q:v", "3", out]); // one frame: some archive files are animated
}

// Shots of the same document share a query, so each query is searched once per run.
const searches = new Map<string, Promise<Candidate[]>>();
const search = (q: string) => {
  if (!searches.has(q)) searches.set(q, searchArchives(q).catch((e) => (searches.delete(q), Promise.reject(e))));
  return searches.get(q)!;
};

async function pickReal(p: Project, shot: Shot, query: string, seen: Set<string>, spend: Spend): Promise<{ cand: Candidate; reason: string } | null> {
  const cands = (await search(query)).filter((c) => !seen.has(c.full)).slice(0, 8);
  // An image rejected once stays rejected: a broader search must not get a second opinion on it.
  for (const c of cands) seen.add(c.full);
  const thumbs = await Promise.all(cands.map((c) => download(c.thumb).then((b) => Buffer.from(b).toString("base64")).catch(() => null)));
  const ok = cands.map((c, i) => ({ c, b64: thumbs[i] })).filter((x) => x.b64);
  if (ok.length < cands.length) spend.notes.push(`${shot.id} ${cands.length - ok.length} of ${cands.length} thumbnails failed to download`);
  if (!ok.length) {
    spend.notes.push(`${shot.id} no archive candidates for "${query}"`);
    return null;
  }
  const beat = p.script!.beats.find((b) => b.id === shot.beatId);
  const r = await json<{ pick: number | null; usable: boolean; reason: string }>({
    system:
      "You pick real archival images for a documentary-style explainer video. Be strict: a loosely related or wrong subject is not usable; a different but accurate image of the same thing is fine. " +
      "Read any visible text, labels and titles: reject an image whose label names a different event, mission, date, place or person than the narration (for example a diagram labeled for a different mission). " +
      "Reject the wrong kind of thing, even within the same family (a sailing ship is not a steamship). " +
      "Reject scale models, toys and miniatures unless the narration is about them, and images that only share a word or an era with the narration without showing what is being said. " +
      "Reject anything from the wrong era: a building, vehicle, street or photograph that did not exist yet at the time the narration describes (for example a bridge built decades later). " +
      "Reject images made mostly of small text, such as infographics, posters and web pages, unless the narration is about that very page: they cannot be read on a phone. " +
      "Reject tiny, blurry or heavily cropped images. Prefer clear, high-contrast images that work full screen in a vertical video.",
    user: [
      ...ok.flatMap(({ c, b64 }, k) => [
        { type: "input_text", text: `Candidate ${k} (${c.source}, ${c.license}${c.size ? `, ${c.size}` : ""}): ${c.title}` },
        { type: "input_image", image_url: `data:image/jpeg;base64,${b64}` },
      ]),
      { type: "input_text", text: `Video topic: ${topic(p)}\nNarration: "${beat?.text}". The shot needs: ${shot.asset!.query}${shot.asset!.subject ? `, with a clear ${shot.asset!.subject} to cut out` : ""}. Pick the best candidate, or null if none is accurate.` },
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
export async function generate(shot: Shot, s: StyleFile, spend: Spend): Promise<Uint8Array | null> {
  const look = s.art[shot.asset!.imageType ?? "scene"];
  for (const scene of [shot.asset!.prompt, shot.asset!.query].filter(Boolean)) {
    try {
      // An image model cannot write, so anything shaped like writing comes out as gibberish: look, and redo it blank.
      for (const extra of ["", " Every surface is blank, with no marks that could look like writing."]) {
        const img = await generateOnce(scene + extra, look, spend);
        if (!(await hasWriting(img, spend))) return img;
        spend.notes.push(`${shot.id} generated image has fake writing, ${extra ? "giving up on it" : "redoing it blank"}`);
      }
    } catch (e: any) {
      if (!/content_policy_violation/.test(e.message)) throw e;
      spend.notes.push(`${shot.id} prompt refused by content policy: "${scene.slice(0, 80)}"`);
    }
  }
  return null;
}

async function hasWriting(img: Uint8Array, spend: Spend): Promise<boolean> {
  const r = await json<{ writing: boolean }>({
    system: "Look at this image. Answer true if any surface shows text, letters, numbers, a label, or marks imitating writing or script of any kind. Answer false otherwise.",
    user: [{ type: "input_image", image_url: `data:image/jpeg;base64,${Buffer.from(img).toString("base64")}` }, { type: "input_text", text: "Is there any writing in it?" }],
    schema: { type: "object", additionalProperties: false, required: ["writing"], properties: { writing: { type: "boolean" } } },
    schemaName: "writing",
  });
  spend.usd += r.usd;
  return r.value.writing;
}

async function generateOnce(scene: string, look: string, spend: Spend): Promise<Uint8Array> {
  const r = await post("/images/generations", {
    model: "muse-image-1.0",
    prompt: `${look} Absolutely no text, letters, numbers or captions anywhere. Scene: ${scene}`,
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
  const key = hash(RULES_VERSION, shot.type, shot.asset, s.art);
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
    // Archive search matches words in titles, so a specific query often finds nothing; then try the broader one.
    let pick: Awaited<ReturnType<typeof pickReal>> = null;
    const seen = new Set<string>();
    for (const query of [shot.asset!.query, shot.asset!.broadQuery].filter((x): x is string => !!x)) {
      pick = await pickReal(p, shot, query, seen, spend).catch((e) => (spend.notes.push(`${shot.id} archive error: ${e.message}`), null));
      if (pick) break;
    }
    // Archives sometimes refuse the full file after serving the preview; that image is simply unavailable.
    const full = pick && (await download(pick.cand.full).catch((e) => (spend.notes.push(`${shot.id} download failed: ${e.message}`), null)));
    if (pick && !full) pick = null;
    const raw = pick && full && (await write(join(folder, `${shot.id}.src`), full));
    const [w, h] = raw ? dims(raw) : [0, 0];
    if (pick && Math.min(w, h) < MIN_SIDE) spend.notes.push(`${shot.id} archive pick "${pick.cand.title}" is only ${w}x${h}, generating instead`);
    if (pick && raw && Math.min(w, h) >= MIN_SIDE) {
      toJpeg(raw, abs);
      asset = { shotId: shot.id, kind: "real", path: rel, title: pick.cand.title, source: pick.cand.source, license: pick.cand.license, credit: pick.cand.credit, page: pick.cand.page };
      spend.notes.push(`${shot.id} real: ${pick.cand.source} "${pick.cand.title}"`);
    } else if (!pick) spend.notes.push(`${shot.id} no usable archive image for "${shot.asset!.query}"`);
  }
  // Never generate a stand-in for a specific real thing (the director's mustBeReal), and as a safety net never a likeness
  // of a real, named person: a person subject plus "portrait" or a capitalized name ("Jim Lovell") in the query.
  // With no image, the shot is marked missing and the timeline holds the previous image instead.
  const q = shot.asset!.query;
  const realPerson = shot.asset!.kind === "real" && /\b(man|woman|person|boy|girl)\b/i.test(shot.asset!.subject ?? "") && (/portrait/i.test(q) || /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(q));
  if (!asset && (shot.asset!.mustBeReal || realPerson)) {
    spend.notes.push(`${shot.id} no archive image for "${q}" and it must be real; holding the previous image`);
    return { shotId: shot.id, kind: "none", missing: true };
  }
  if (!asset) {
    const img = await generate(shot, s, spend);
    if (!img) return { shotId: shot.id, kind: "none", missing: true };
    const raw = await write(join(folder, `${shot.id}.gen.jpg`), img);
    toJpeg(raw, abs);
    asset = { shotId: shot.id, kind: "generated", path: rel, source: "Muse Image (generated)" };
  }
  asset.size = dims(abs);
  asset.look = shot.asset!.focus;
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

// Picks, from the real images this video already found, the one that best fits what is being said during a shot.
async function reuse(p: Project, shot: Shot, pool: Asset[], spend: Spend): Promise<Asset | undefined> {
  const words = p.narration!.words;
  const before = words.filter((w) => w.start < shot.start).map((w) => w.text).join(" ");
  const now = words.filter((w) => w.start >= shot.start && w.start < shot.end).map((w) => w.text).join(" ");
  const images = pool.flatMap((a, k) => {
    const small = join(dir(p), `${a.path}.pool.jpg`);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", join(dir(p), a.path!), "-vf", "scale='min(iw,512)':-2", "-q:v", "4", small]);
    return [
      { type: "input_text", text: `Image ${k}: ${a.title}` },
      { type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(small).toString("base64")}` },
    ];
  });
  const r = await json<{ pick: number | null; focus: string; reason: string }>({
    system:
      "A documentary video has no image for one moment. Pick, from the real images it already uses, the one that clearly fits what is being said. Answer null rather than pick one that is only loosely related. " +
      "A map, document or wide photo can fit through one part of it: name that part in `focus`, as something visible to find in the image, or leave it empty for the whole image. " +
      "Never pick an image that shows something the narration has not revealed yet, such as a person who has not been named.",
    user: [
      ...images,
      { type: "input_text", text: `${asked([...(p.plan?.story ?? []), ...(p.plan?.visuals ?? [])])}\n\nNarration so far: "${before}"\n\nBeing said now: "${now}"` },
    ],
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["pick", "focus", "reason"],
      properties: { pick: { type: ["integer", "null"] }, focus: { type: "string" }, reason: { type: "string" } },
    },
    schemaName: "reuse",
  });
  spend.usd += r.usd;
  const from = r.value.pick == null ? undefined : pool[r.value.pick];
  if (!from) return undefined;
  spend.notes.push(`${shot.id} reusing "${from.title}"${r.value.focus ? `, looking at "${r.value.focus}"` : ""}`);
  return { ...from, shotId: shot.id, cutout: undefined, override: { type: "photo_kenburns" }, look: r.value.focus || undefined };
}

// Walks the shots in order and keeps every hold under MAX_HOLD. A gap takes the best fit from what the video found,
// but no image may fill the video by itself; next comes an honest illustration of the idea, then a title card of the
// beat's words, unless those words already appear as a title anywhere in the video.
async function fillGaps(p: Project, out: Asset[], s: StyleFile, spend: Spend) {
  const pool = [...new Map(out.filter((a) => a.kind === "real" && a.path).map((a) => [a.title, a])).values()];
  const shown = new Map<string | undefined, number>();
  for (const a of out) if (a.kind === "real") shown.set(a.title, (shown.get(a.title) ?? 0) + 1);
  const titles = new Set(p.shots!.filter((x) => x.type === "kinetic_title").map((x) => (x.text ?? "").toLowerCase()));
  let held = 0;
  for (const shot of p.shots!) {
    const len = shot.end - shot.start;
    const i = out.findIndex((a) => a.shotId === shot.id);
    if (!out[i]?.missing) {
      held = len;
      continue;
    }
    if (held && held + len <= MAX_HOLD) {
      held += len;
      continue;
    }
    const fresh = pool.filter((a) => (shown.get(a.title) ?? 0) < MAX_REPEATS);
    let filled = fresh.length ? await reuse(p, shot, fresh, spend) : undefined;
    if (filled) shown.set(filled.title, (shown.get(filled.title) ?? 0) + 1);
    else if (shot.asset?.idea) filled = await illustrate(p, shot, s, spend);
    const text = p.script!.beats.find((b) => b.id === shot.beatId)?.emphasis.join(" ") ?? "";
    if (filled) {
      out[i] = filled;
      held = len;
    } else if (text && !titles.has(text.toLowerCase())) {
      out[i] = { shotId: shot.id, kind: "none", override: { type: "kinetic_title", text } };
      titles.add(text.toLowerCase());
      held = len;
    } else held += len;
  }
}

// The critic's fix: a generated image is redone with the note; a real one gives way to another image from this video
// or an honest illustration, and if neither fits, the shot holds the previous image.
export async function replaceImage(p: Project, shotId: string, note: string, s: StyleFile, spend: Spend) {
  const i = p.assets!.findIndex((a) => a.shotId === shotId);
  const old = p.assets![i]!;
  const shot = p.shots!.find((x) => x.id === shotId)!;
  if (!shot.asset) return;
  const tried = old.title;
  let next: Asset | undefined;
  if (old.kind === "generated") {
    const req = { ...shot, asset: { ...shot.asset, prompt: `${shot.asset.idea || shot.asset.prompt} ${note}`, query: "" } };
    const img = await generate(req, s, spend);
    if (img) {
      const rel = `assets/${shotId}.jpg`;
      toJpeg(await write(join(dir(p), "assets", `${shotId}.gen.jpg`), img), join(dir(p), rel));
      next = { shotId, kind: "generated", path: rel, source: "Muse Image (generated)", size: dims(join(dir(p), rel)), override: { type: "photo_kenburns" } };
    }
  } else {
    const pool = [...new Map(p.assets!.filter((a) => a.kind === "real" && a.path && a.title !== tried).map((a) => [a.title, a])).values()];
    next = (pool.length ? await reuse(p, shot, pool, spend) : undefined) ?? (shot.asset.idea ? await illustrate(p, shot, s, spend) : undefined);
  }
  p.assets![i] = next ?? { shotId, kind: "none", missing: true };
}

// An honest picture of the idea, for a real thing that could not be found. It carries no claim to be that thing.
async function illustrate(p: Project, shot: Shot, s: StyleFile, spend: Spend): Promise<Asset | undefined> {
  const req = { ...shot, asset: { ...shot.asset!, prompt: shot.asset!.idea!, query: "" } };
  const img = await generate(req, s, spend);
  if (!img) return undefined;
  const rel = `assets/${shot.id}.jpg`;
  const raw = await write(join(dir(p), "assets", `${shot.id}.gen.jpg`), img);
  toJpeg(raw, join(dir(p), rel));
  spend.notes.push(`${shot.id} illustrating the idea: "${shot.asset!.idea!.slice(0, 60)}"`);
  return { shotId: shot.id, kind: "generated", path: rel, source: "Muse Image (generated)", size: dims(join(dir(p), rel)), override: { type: "photo_kenburns" } };
}

export async function assets(p: Project, force = false) {
  const s = style(p.input.style);
  const todo = p.shots!.filter((x) => x.asset);
  await stage(p, "assets", [p.shots, s.art], todo.length * 0.02, async () => {
    const spend: Spend = { usd: 0, notes: [] };
    const out: Asset[] = [];
    try {
      for (let i = 0; i < todo.length; i += PARALLEL) {
        out.push(...(await Promise.all(todo.slice(i, i + PARALLEL).map((shot) => one(p, shot, s, spend)))));
      }
      await fillGaps(p, out, s, spend);
    } finally {
      // Charge what was spent even if a shot failed, so the ledger stays true.
      for (const n of spend.notes) console.log(`  ${n}`);
      charge(p, "assets", spend.usd, `${todo.length} shots, ${out.filter((a) => a.kind === "real").length} real, ${out.filter((a) => a.cutout).length} cutouts`);
    }
    p.assets = out;
  }, force);
}
