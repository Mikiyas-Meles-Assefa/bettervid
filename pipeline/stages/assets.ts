// Stages 5a to 5c: real assets from archives (Spark picks), generated art (Muse Image) where an illustration is honest,
// drawings the scene step makes itself, and SAM cutouts with the outline baked in. Shots run in parallel, a few at a time.
//
// The rules, for any topic:
// - A real picture must show what the words say at that moment, and be the right kind of thing. The picker says what
//   each candidate actually shows before judging it, and its reason is kept on the asset (`why`).
// - Nothing generated may pass as a specific real person, place, map, document, object or event. Every generated
//   picture is looked at with the words it goes under; one that would pass as the real thing is not used.
// - When the real picture is missing: Spark writes new searches from what the archives returned; then the director's
//   drawing (`draw`, made by the scene step); then another real picture from this video that fits; then an honest
//   illustration of the idea in the style's diagram look; then the previous picture holds a few seconds; past that,
//   the scene step draws what the words say.
// - Generated pictures in one video share one look per image type: each is made with a small look study as reference.
import { parallelMap } from "../lib/scheduler.ts";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeMaskToRaster, parseImageStream, recordsOfKind, type ResponsesEvent } from "@meta-sam/parser";
import type { Asset, ImageType, Project, Shot, StyleFile } from "../../schemas/project.ts";
import { download, MIN_SIDE, searchArchives, type Candidate } from "../lib/archives.ts";
import { json, post, PRICE } from "../lib/meta.ts";
import { ownPictures } from "../lib/material.ts";
import { asked, charge, dir, stage, style, topic } from "../lib/project.ts";
import { hash, PYTHON, write } from "../lib/util.ts";

const PARALLEL = 5;
// Bump when picking or cutout rules change, so cached shots are redone under the new rules.
const RULES_VERSION = 13;

// A shot with no image holds the previous one, but only so far: past this, the viewer is looking at something
// unrelated to what they are hearing.
const MAX_HOLD = 6;
// How many shots one real image may fill before gaps must look elsewhere.
const MAX_REPEATS = 3;
// How many candidates the picker sees at once. Searches are merged, so one look covers several queries.
const PICK_FROM = 10;
// New searches Spark may write when the director's own find nothing usable.
const MORE_QUERIES = 3;

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

// What is being said while a shot is on screen, with a little before and after, so a picture is judged against the
// moment and not the whole beat.
export function moment(p: Project, shot: Pick<Shot, "start" | "end">): { before: string; now: string; after: string } {
  const words = p.narration!.words;
  const say = (list: typeof words) => list.map((w) => w.text).join(" ");
  const first = words.findIndex((w) => w.start >= shot.start - 0.01);
  const inside = words.filter((w) => w.start >= shot.start - 0.01 && w.start < shot.end);
  const from = first < 0 ? words.length : first;
  return { before: say(words.slice(Math.max(0, from - 25), from)), now: say(inside), after: say(words.slice(from + inside.length, from + inside.length + 12)) };
}

const momentText = (p: Project, shot: Shot) => {
  const m = moment(p, shot);
  return `Words being said while the picture is on screen: "${m.now}"\n(Just before: "${m.before}" Just after: "${m.after}")`;
};

// Shots of the same document share a query, so each query is searched once per run.
const searches = new Map<string, Promise<Candidate[]>>();
const search = (q: string) => {
  if (!searches.has(q)) searches.set(q, searchArchives(q).catch((e) => (searches.delete(q), Promise.reject(e))));
  return searches.get(q)!;
};

// Searches several queries and interleaves their results, best of each first, without repeats.
async function searchAll(queries: string[], seen: Set<string>, spend: Spend, shotId: string): Promise<Candidate[]> {
  const lists = await Promise.all(queries.map((q) => search(q).catch((e) => (spend.notes.push(`${shotId} archive error for "${q}": ${e.message}`), [] as Candidate[]))));
  const out: Candidate[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let k = 0; k < longest; k++) for (const list of lists) {
    const c = list[k];
    if (c && !seen.has(c.full) && !out.some((x) => x.full === c.full)) out.push(c);
  }
  return out;
}

const PICKER =
  "You choose real archival images for a documentary explainer video. For each candidate, first say plainly what it actually shows: the kind of thing, and whether it is a photograph, a period drawing, map or document, a modern painting or illustration, a museum replica or reproduction, a scale model or toy, an exhibit panel, or an icon or clip art, and roughly when it was made. Then judge it against the words being said at that moment.\n" +
  "A candidate is usable only if all of these hold:\n" +
  "- It shows what the words are saying now. Sharing the topic, the era, the story or a word is not enough: a picture of another part of the same story does not fit this moment.\n" +
  "- It is the right kind of thing: the same type of object, the same machine, place or person, not a relative of it (a sailing ship is not a steamship, a later model is not the original, a different person with the same name is not them, a jet engine is not a piston engine).\n" +
  "- It is honest about what it is. A scale model, toy or miniature is never usable unless the words are about it. A replica or reproduction may show what something looked like, but never stands in for a moment of the event itself, and only when no original is among the candidates. A modern painting, illustration, icon or clip art is not usable when the shot needs a real photograph or record; period drawings, engravings, maps and documents are records.\n" +
  "- Nothing visible contradicts the words: a label, caption or date naming a different event, mission, place, person or year, or anything that did not exist yet at the time the words describe.\n" +
  "- It reads on a phone: not mostly small text (infographics, posters, exhibit panels, web pages) unless the words are about that very page, and not tiny, blurry or heavily cropped.\n" +
  "Pick the candidate that shows the moment most directly, then the clearest. Answer null when none passes: a near miss is not usable. In `reason`, say in one or two plain sentences why the pick fits, or why none does.";

type Chosen = { cand: Candidate; reason: string };

async function pickReal(p: Project, shot: Shot, all: Candidate[], seen: Set<string>, spend: Spend): Promise<{ pick: Chosen | null; reason: string }> {
  const cands = all.slice(0, PICK_FROM);
  // An image rejected once stays rejected: a later search must not get a second opinion on it.
  for (const c of cands) seen.add(c.full);
  const thumbs = await Promise.all(cands.map((c) => download(c.thumb).then((b) => Buffer.from(b).toString("base64")).catch(() => null)));
  const ok = cands.map((c, i) => ({ c, b64: thumbs[i] })).filter((x) => x.b64);
  if (ok.length < cands.length) spend.notes.push(`${shot.id} ${cands.length - ok.length} of ${cands.length} thumbnails failed to download`);
  if (!ok.length) return { pick: null, reason: "the archives returned nothing" };
  return judge(p, shot, ok, spend);
}

type Thumb = { c: Candidate; b64: string | null };

// One look by the picker. Some archive images (war, bodies) make the whole call refused by content policy; then each
// half is judged on its own, so one image cannot sink the others.
async function judge(p: Project, shot: Shot, ok: Thumb[], spend: Spend): Promise<{ pick: Chosen | null; reason: string }> {
  try {
    return await judgeOnce(p, shot, ok, spend);
  } catch (e: any) {
    if (!/content_policy_violation/.test(e.message)) throw e;
    if (ok.length < 2) return { pick: null, reason: "the candidate was refused by content policy" };
    spend.notes.push(`${shot.id} picker refused by content policy; judging the ${ok.length} candidates in two halves`);
    const half = Math.ceil(ok.length / 2);
    const first = await judge(p, shot, ok.slice(0, half), spend);
    if (first.pick) return first;
    const second = await judge(p, shot, ok.slice(half), spend);
    return second.pick ? second : { pick: null, reason: `${first.reason} ${second.reason}` };
  }
}

async function judgeOnce(p: Project, shot: Shot, ok: Thumb[], spend: Spend): Promise<{ pick: Chosen | null; reason: string }> {
  const a = shot.asset!;
  const need = [`The director asked for: ${a.query}`, a.subject ? `with a clear ${a.subject} to cut out` : "", a.focus ? `showing ${a.focus}` : "", a.mustBeReal ? "It must be the real thing itself, not a stand-in." : ""].filter(Boolean).join(", ");
  const r = await json<{ candidates: { n: number; shows: string; fits: boolean }[]; pick: number | null; reason: string }>({
    system: PICKER,
    user: [
      ...ok.flatMap(({ c, b64 }, k) => [
        { type: "input_text", text: `Candidate ${k} (${c.source}, ${c.license}${c.size ? `, ${c.size}` : ""}): ${c.title}` },
        { type: "input_image", image_url: `data:image/jpeg;base64,${b64}` },
      ]),
      { type: "input_text", text: `Video topic: ${topic(p)}\n${momentText(p, shot)}\n${need}.\nPick the best candidate, or null if none is usable.` },
    ],
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["candidates", "pick", "reason"],
      properties: {
        candidates: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "shows", "fits"], properties: { n: { type: "integer" }, shows: { type: "string" }, fits: { type: "boolean" } } } },
        pick: { type: ["integer", "null"] },
        reason: { type: "string" },
      },
    },
    schemaName: "asset_pick",
  });
  spend.usd += r.usd;
  const v = r.value;
  const chosen = v.pick != null ? ok[v.pick] : undefined;
  if (!chosen) {
    const seenAs = v.candidates.map((c) => `${c.n}: ${c.shows}`).join("; ");
    spend.notes.push(`${shot.id} picker rejected ${ok.length} candidates: ${v.reason} [${seenAs.slice(0, 400)}]`);
    return { pick: null, reason: `${v.reason} Candidates were: ${seenAs}` };
  }
  return { pick: { cand: chosen.c, reason: v.reason }, reason: v.reason };
}

// The repair step for a search that found nothing usable: Spark reads what came back and why it was refused, and
// writes new searches, the way a picture researcher would.
async function moreQueries(p: Project, shot: Shot, tried: string[], refusals: string[], spend: Spend): Promise<string[]> {
  const r = await json<{ queries: string[] }>({
    system:
      "Archive searches for a picture in a documentary explainer found nothing usable. Write up to " +
      MORE_QUERIES +
      " new searches for Wikimedia Commons, NASA, the Smithsonian and the Internet Archive, which match words in item titles and descriptions. " +
      "Use the names archives actually use: the official or period name of the thing, its maker or photographer, the place, the year, the collection. Fewer, plainer words find more. " +
      "You may also look for a different real picture that would show these words just as truly (the person who did it, the place where it happened, the original document), but never something only loosely related. " +
      "Learn from what came back: if a search found the wrong thing, change the words that misled it. Never repeat a search already tried. Return an empty list if the archives are unlikely to hold anything honest.",
    user: `Video topic: ${topic(p)}\n${momentText(p, shot)}\nThe director asked for: ${shot.asset!.query}${shot.asset!.mustBeReal ? " (it must be the real thing itself)" : ""}\nSearches tried: ${tried.map((q) => `"${q}"`).join(", ")}\nWhat they found and why it was refused:\n${refusals.map((x) => `- ${x}`).join("\n")}`,
    schema: { type: "object", additionalProperties: false, required: ["queries"], properties: { queries: { type: "array", items: { type: "string" } } } },
    schemaName: "more_queries",
  });
  spend.usd += r.usd;
  const done = new Set(tried.map((q) => q.toLowerCase().trim()));
  return r.value.queries.map((q) => q.trim()).filter((q) => q && !done.has(q.toLowerCase())).slice(0, MORE_QUERIES);
}

// The director's searches first, merged into one look; if nothing passes, one round of Spark's new searches.
async function findReal(p: Project, shot: Shot, spend: Spend): Promise<{ pick: Chosen | null; reason: string }> {
  const a = shot.asset!;
  const seen = new Set<string>();
  const tried = [a.query, a.broadQuery].filter((x): x is string => !!x);
  const refusals: string[] = [];
  let found = await searchAll(tried, seen, spend, shot.id);
  for (let round = 0; ; round++) {
    if (found.length) {
      const r = await pickReal(p, shot, found, seen, spend);
      if (r.pick) return r;
      refusals.push(r.reason);
    } else refusals.push(`nothing found for ${tried.slice(-3).map((q) => `"${q}"`).join(", ")}`);
    if (round >= 1) break;
    const more = await moreQueries(p, shot, tried, refusals, spend);
    if (!more.length) break;
    spend.notes.push(`${shot.id} searching again: ${more.map((q) => `"${q}"`).join(", ")}`);
    tried.push(...more);
    found = await searchAll(more, seen, spend, shot.id);
  }
  return { pick: null, reason: refusals.at(-1) ?? "nothing found" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Generated pictures.

type GenContext = { p: Project; shot: Shot };

// A small study of the style's look for one image type, made once per video. Every generated picture of that type
// is made with it as a reference, so the set reads as one artist's work rather than a mix of looks.
const studies = new Map<string, Promise<Uint8Array | undefined>>();
const STUDY: Record<ImageType, string> = {
  scene: "A study of the look only: an ordinary empty landscape with a few trees, a path and some clouds, nothing else.",
  object: "A study of the look only: a plain ceramic jug shown whole, nothing else.",
  diagram: "A study of the look only: a simple diagram of a ball rolling down a ramp, with one curved arrow, nothing else.",
};
function lookStudy(p: Project, s: StyleFile, type: ImageType, spend: Spend): Promise<Uint8Array | undefined> {
  const file = join(dir(p), "assets", `look-${type}.jpg`);
  const key = hash(s.art[type], STUDY[type]);
  const memo = `${file}:${key}`;
  if (!studies.has(memo)) {
    studies.set(memo, (async () => {
      const keyFile = `${file}.key`;
      if (existsSync(file) && existsSync(keyFile) && readFileSync(keyFile, "utf8") === key) return new Uint8Array(readFileSync(file));
      try {
        const img = await generateOnce(STUDY[type], s.art[type], spend);
        await write(file, img);
        writeFileSync(keyFile, key);
        spend.notes.push(`look study for ${type} images made`);
        return img;
      } catch (e: any) {
        spend.notes.push(`look study for ${type} failed (${e.message.slice(0, 80)}); generating without a reference`);
        return undefined;
      }
    })());
  }
  return studies.get(memo)!;
}

type Check = { writing: boolean; face: boolean; passes: boolean; reason: string };

// One look at a generated picture with the words it goes under: fake writing, a made-up face standing in for a real
// person, or a picture a viewer would take for the real thing the story is about. The model first names the specific
// real thing the words single out, if any; a picture can only pass as a real thing that has been named, so an everyday
// object (a fridge, a gull) is never refused for looking real.
async function checkGenerated(img: Uint8Array, spend: Spend, ctx?: GenContext): Promise<Check> {
  const words = ctx ? `Video topic: ${topic(ctx.p)}\n${momentText(ctx.p, ctx.shot)}` : "No narration is given: judge only the writing.";
  const r = await json<{ writing: boolean; face: boolean; specific: string; passes: boolean; reason: string }>({
    system:
      "You check an AI-generated picture before it goes into a documentary explainer video. Answer:\n" +
      "- writing: does any surface show text, letters, numbers, a label, or marks imitating writing or script of any kind?\n" +
      "- face: does it show the face of a real person the narration is about, by name or as a group it names, with features a viewer would take as theirs? A made-up face standing in for a real person counts. A small figure far away or from behind does not.\n" +
      "- specific: the one particular real person, place, building, map, document, machine, artifact or event these words single out and the picture could be taken for (\"the first telephone\", \"the 1906 earthquake\"), or empty if the words are about a kind of thing in general (any fridge, birds, a beach).\n" +
      "- passes: only when `specific` is not empty: would a viewer hearing these words take this picture for a real photograph, painting or record of that thing, rather than a generic picture or an illustration of an idea? A plainly drawn picture no one would take for a record does not pass.\n" +
      "- reason: one plain sentence.",
    user: [{ type: "input_image", image_url: `data:image/jpeg;base64,${Buffer.from(img).toString("base64")}` }, { type: "input_text", text: words }],
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["writing", "face", "specific", "passes", "reason"],
      properties: { writing: { type: "boolean" }, face: { type: "boolean" }, specific: { type: "string" }, passes: { type: "boolean" }, reason: { type: "string" } },
    },
    schemaName: "generated_check",
  });
  spend.usd += r.usd;
  const v = r.value;
  if (!ctx) return { writing: v.writing, face: false, passes: false, reason: v.reason };
  return { writing: v.writing, face: v.face, passes: v.passes && !!v.specific.trim(), reason: v.specific.trim() ? `${v.reason} (it would stand for: ${v.specific})` : v.reason };
}

// Muse Image refuses some prompts (content policy), e.g. disease scenes with bodies. Retry once with the neutral
// archive query. Fake writing and made-up faces get one blank or faceless redo; a picture that would pass as the real
// thing gets none, because the request itself is the problem. Returns null with the reason in `spend.notes`.
export async function generate(shot: Shot, s: StyleFile, spend: Spend, ctx?: Omit<GenContext, "shot">): Promise<Uint8Array | null> {
  const type = shot.asset!.imageType ?? "scene";
  const look = s.art[type];
  const study = ctx ? await lookStudy(ctx.p, s, type, spend) : undefined;
  const check = ctx ? { ...ctx, shot } : undefined;
  for (const scene of [shot.asset!.prompt, shot.asset!.query].filter(Boolean)) {
    try {
      let extra = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const img = await generateOnce(scene + extra, look, spend, study);
        const c = await checkGenerated(img, spend, check);
        if (c.passes) {
          spend.notes.push(`${shot.id} generated picture would pass as the real thing, not used: ${c.reason}`);
          return null;
        }
        if (!c.writing && !c.face) return img;
        spend.notes.push(`${shot.id} generated picture has ${c.writing ? "fake writing" : "a face standing in for a real person"}${attempt ? ", giving up on it" : ", redoing it"}: ${c.reason}`);
        extra = c.writing ? " Every surface is blank, with no marks that could look like writing." : " No faces are visible: any people are small, far away or seen from behind.";
      }
      return null;
    } catch (e: any) {
      if (!/content_policy_violation/.test(e.message)) throw e;
      spend.notes.push(`${shot.id} prompt refused by content policy: "${scene.slice(0, 80)}"`);
    }
  }
  return null;
}

async function generateOnce(scene: string, look: string, spend: Spend, study?: Uint8Array): Promise<Uint8Array> {
  const fields = {
    model: "muse-image-1.0",
    size: "1152x2048",
    n: 1,
    response_format: "b64_json",
    output_format: "jpeg",
    reasoning_strength: "low",
    tool_enablement: { enable_web_search: false, enable_image_search: false, enable_shell: false },
  };
  const text = `${look} Absolutely no text, letters, numbers or captions anywhere. Scene: ${scene}`;
  let r: any;
  if (study) {
    // /images/edits is multipart: object fields as JSON strings, the reference as image[0] (spike S2).
    const form = new FormData();
    const prompt = `Use the reference image only for its look: medium, palette, lighting, line and texture. Do not copy its subjects, objects or layout. ${text}`;
    for (const [k, v] of Object.entries({ ...fields, prompt })) form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    form.append("image[0]", new Blob([Buffer.from(study)], { type: "image/jpeg" }), "look.jpg");
    r = await post("/images/edits", form);
  } else r = await post("/images/generations", { ...fields, prompt: text });
  spend.usd += PRICE.image;
  const b64 = r.data?.[0]?.b64_json;
  if (!b64) throw new Error("muse image returned no image");
  return Buffer.from(b64, "base64");
}

// ---------------------------------------------------------------------------------------------------------------------
// Cutouts.

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
  const best = [...masks].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]; // the parsed records are frozen
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
  execFileSync(PYTHON, ["-I", "pipeline/tools/bake_cutout.py", small, pgm, String(b.left), String(b.top), String(b.right), String(b.bottom), out]);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// One shot.

// Each shot's result is cached in assets/<shot>.json under a hash of what it depends on, so a failed or
// changed run only redoes the shots that need it. The file also keeps that shot's notes, so a picture's story can be read.
async function one(p: Project, shot: Shot, s: StyleFile, spend: Spend): Promise<Asset> {
  const folder = join(dir(p), "assets");
  const key = hash(RULES_VERSION, shot.type, shot.asset, s.art, topic(p), moment(p, shot), p.plan?.story, p.plan?.visuals, ownPictures(p));
  const cacheFile = join(folder, `${shot.id}.json`);
  if (existsSync(cacheFile)) {
    const c = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (c.key === key && [c.asset.path, c.asset.cutout].every((f) => !f || existsSync(join(dir(p), f)))) return c.asset;
  }
  const result = await make(p, shot, s, spend, folder);
  await write(cacheFile, JSON.stringify({ key, asset: result, notes: spend.notes.filter((n) => n.startsWith(`${shot.id} `)) }, null, 1));
  return result;
}

// A shot the scene step draws itself. It carries `missing` too, so a path that cannot draw holds the previous shot.
export const drawn = (shot: Shot, why: string): Asset => ({ shotId: shot.id, kind: "none", missing: true, draw: shot.asset!.draw, why });

// Never a likeness of a real, named person, as a safety net under the director's mustBeReal: a person subject plus
// "portrait" or a capitalized name ("Jim Lovell") in the query.
export const realPerson = (shot: Shot) => {
  const a = shot.asset!;
  return a.kind === "real" && /\b(man|woman|person|boy|girl)\b/i.test(a.subject ?? "") && (/portrait/i.test(a.query) || /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(a.query));
};

async function make(p: Project, shot: Shot, s: StyleFile, spend: Spend, folder: string): Promise<Asset> {
  const req = shot.asset!;
  if (req.kind === "drawn") {
    spend.notes.push(`${shot.id} drawn by the scene: "${(req.draw ?? "").slice(0, 80)}"`);
    return drawn(shot, "The director chose a drawing: it shows this moment more clearly than a picture.");
  }
  const rel = `assets/${shot.id}.jpg`;
  const abs = join(dir(p), rel);
  if (req.kind === "own") {
    const pic = ownPictures(p).find((x) => x.card.name === req.query);
    if (!pic) throw new Error(`assets: ${shot.id} names the user's picture "${req.query}", which is not in the project`);
    await write(abs, new Uint8Array());
    toJpeg(join(dir(p), pic.path), abs);
    spend.notes.push(`${shot.id} the user's own picture: ${req.query}`);
    return { shotId: shot.id, kind: "real", path: rel, title: req.query, source: "Your file", why: `The user's own picture: ${pic.card.about}`, size: dims(abs), look: req.focus };
  }
  let asset: Asset | undefined;
  let why = "";
  if (req.kind === "real" && req.query) {
    const found = await findReal(p, shot, spend).catch((e) => (spend.notes.push(`${shot.id} archive error: ${e.message}`), { pick: null, reason: `archive error: ${e.message}` }));
    let pick = found.pick;
    // The list of what each candidate showed stays in the shot's notes; the asset keeps the plain reason.
    why = found.reason.split(" Candidates were:")[0]!;
    // Archives sometimes refuse the full file after serving the preview; that image is simply unavailable.
    const full = pick && (await download(pick.cand.full).catch((e) => (spend.notes.push(`${shot.id} download failed: ${e.message}`), null)));
    if (pick && !full) pick = null;
    const raw = pick && full && (await write(join(folder, `${shot.id}.src`), full));
    const [w, h] = raw ? dims(raw) : [0, 0];
    if (pick && Math.min(w, h) < MIN_SIDE) {
      spend.notes.push(`${shot.id} archive pick "${pick.cand.title}" is only ${w}x${h}, too small to use`);
      why = `The best archive image was too small (${w}x${h}).`;
    }
    if (pick && raw && Math.min(w, h) >= MIN_SIDE) {
      toJpeg(raw, abs);
      asset = { shotId: shot.id, kind: "real", path: rel, title: pick.cand.title, source: pick.cand.source, license: pick.cand.license, credit: pick.cand.credit, page: pick.cand.page, why: pick.reason };
      spend.notes.push(`${shot.id} real: ${pick.cand.source} "${pick.cand.title}": ${pick.reason}`);
    } else if (!pick) spend.notes.push(`${shot.id} no usable archive image for "${req.query}"`);
  }
  // Never generate a stand-in for a specific real thing. The director's drawing comes first; otherwise the shot is a
  // gap, and fillGaps looks for another real picture from this video, then an honest illustration of the idea.
  if (!asset && (req.mustBeReal || realPerson(shot))) {
    if (req.draw) {
      spend.notes.push(`${shot.id} no real image; drawn by the scene instead: "${req.draw.slice(0, 80)}"`);
      return drawn(shot, `No real image was found (${why}) The scene draws it instead.`);
    }
    spend.notes.push(`${shot.id} no archive image for "${req.query}" and it must be real`);
    return { shotId: shot.id, kind: "none", missing: true, why: `No real image was found, and a generated one would pass as the real thing. ${why}` };
  }
  if (!asset) {
    const img = await generate(shot, s, spend, { p });
    if (!img) {
      const last = spend.notes.filter((n) => n.startsWith(`${shot.id} `)).at(-1) ?? "";
      if (req.draw) return drawn(shot, `No honest generated picture (${last}). The scene draws it instead.`);
      return { shotId: shot.id, kind: "none", missing: true, why: `No honest picture could be made: ${last}` };
    }
    const raw = await write(join(folder, `${shot.id}.gen.jpg`), img);
    toJpeg(raw, abs);
    asset = { shotId: shot.id, kind: "generated", path: rel, source: "Muse Image (generated)", why: `${why ? `No archive image fit (${why}). ` : ""}A generic illustration is honest here: ${req.prompt.slice(0, 120)}` };
  }
  asset.size = dims(abs);
  asset.look = req.focus;
  if (shot.type === "cutout_on_paper") {
    const subject = req.subject || "person";
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

// ---------------------------------------------------------------------------------------------------------------------
// Gaps.

// Picks, from the real images this video already found, the one that truly shows what is being said during a shot.
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
      "A documentary video has no image for one moment. Pick, from the real images it already uses, one that truly shows what is being said now: the same person, place, object or event the words name, not just another part of the same story. Answer null rather than pick one that is only loosely related. " +
      "A map, document or wide photo can fit through one part of it: name that part in `focus`, as something visible to find in the image, or leave it empty for the whole image. " +
      "Never pick an image that shows something the narration has not revealed yet, such as a person who has not been named. Say why in `reason`, in one plain sentence.",
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
  spend.notes.push(`${shot.id} reusing "${from.title}"${r.value.focus ? `, looking at "${r.value.focus}"` : ""}: ${r.value.reason}`);
  return { ...from, shotId: shot.id, cutout: undefined, override: { type: "photo_kenburns" }, look: r.value.focus || undefined, why: `Reused: ${r.value.reason}` };
}

// Walks the shots in order and keeps every hold under MAX_HOLD. A gap takes the best fit from what the video found,
// but no image may fill the video by itself; next comes an honest illustration of the idea, then a drawing of what the
// words say, made by the scene step. Drawn shots are not gaps.
async function fillGaps(p: Project, out: Asset[], s: StyleFile, spend: Spend) {
  const pool = [...new Map(out.filter((a) => a.kind === "real" && a.path).map((a) => [a.title, a])).values()];
  const shown = new Map<string | undefined, number>();
  for (const a of out) if (a.kind === "real") shown.set(a.title, (shown.get(a.title) ?? 0) + 1);
  let held = 0;
  for (const shot of p.shots!) {
    const len = shot.end - shot.start;
    const i = out.findIndex((a) => a.shotId === shot.id);
    if (!out[i]?.missing || out[i]?.draw) {
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
    if (filled) {
      out[i] = filled;
      held = len;
    } else {
      // Nothing honest to show: the scene step draws the idea of these words itself, in the video's style, rather
      // than a title card of a stray word or a picture that pretends.
      const brief = gapBrief(p, shot);
      out[i] = { shotId: shot.id, kind: "none", missing: true, draw: brief, why: `${out[i]?.why ?? ""} Nothing honest fit, so the scene draws the idea of these words.`.trim() };
      spend.notes.push(`${shot.id} nothing honest to show; the scene draws: "${brief.slice(0, 80)}"`);
      held = len;
    }
  }
}

// What the scene step should draw for a gap: the director's own request in words, tied to what is being said.
export function gapBrief(p: Project, shot: Shot): string {
  const a = shot.asset;
  const asked = a?.idea || a?.query || a?.prompt || "";
  return `a simple drawing of what these words say: "${moment(p, shot).now}"${asked ? ` (the director wanted: ${asked})` : ""}. No invented facts, numbers or likenesses.`;
}

// The critic's fix: a generated image is redone with the note; a real one gives way to another image from this video,
// the director's drawing, or an honest illustration, and if none fits, the shot holds the previous image.
export async function replaceImage(p: Project, shotId: string, note: string, s: StyleFile, spend: Spend) {
  const i = p.assets!.findIndex((a) => a.shotId === shotId);
  const old = p.assets![i]!;
  const shot = p.shots!.find((x) => x.id === shotId)!;
  if (!shot.asset) return;
  const tried = old.title;
  let next: Asset | undefined;
  if (old.kind === "generated") {
    const req = { ...shot, asset: { ...shot.asset, prompt: `${shot.asset.idea || shot.asset.prompt} ${note}`, query: "" } };
    const img = await generate(req, s, spend, { p });
    if (img) {
      const rel = `assets/${shotId}.jpg`;
      toJpeg(await write(join(dir(p), "assets", `${shotId}.gen.jpg`), img), join(dir(p), rel));
      next = { shotId, kind: "generated", path: rel, source: "Muse Image (generated)", size: dims(join(dir(p), rel)), override: { type: "photo_kenburns" }, why: `Redone after review: ${note}` };
    }
  } else {
    const pool = [...new Map(p.assets!.filter((a) => a.kind === "real" && a.path && a.title !== tried).map((a) => [a.title, a])).values()];
    next = pool.length ? await reuse(p, shot, pool, spend) : undefined;
  }
  if (!next && shot.asset.draw) next = drawn(shot, `Replaced after review (${note}); the scene draws it instead.`);
  if (!next && shot.asset.idea) next = await illustrate(p, shot, s, spend);
  p.assets![i] = next ?? { shotId, kind: "none", missing: true, why: `Removed after review: ${note}` };
}

// An honest picture of the idea, for a real thing that could not be found. It carries no claim to be that thing, so
// it is made in the style's diagram look, plainly an illustration, and checked like any generated picture.
async function illustrate(p: Project, shot: Shot, s: StyleFile, spend: Spend): Promise<Asset | undefined> {
  const req = { ...shot, asset: { ...shot.asset!, prompt: shot.asset!.idea!, query: "", imageType: "diagram" as const } };
  const img = await generate(req, s, spend, { p });
  if (!img) return undefined;
  const rel = `assets/${shot.id}.jpg`;
  const raw = await write(join(dir(p), "assets", `${shot.id}.gen.jpg`), img);
  toJpeg(raw, join(dir(p), rel));
  spend.notes.push(`${shot.id} illustrating the idea: "${shot.asset!.idea!.slice(0, 60)}"`);
  return { shotId: shot.id, kind: "generated", path: rel, source: "Muse Image (generated)", size: dims(join(dir(p), rel)), override: { type: "photo_kenburns" }, why: `No real image was found; an illustration of the idea, not of the real thing: ${shot.asset!.idea!.slice(0, 120)}` };
}

export async function assets(p: Project, force = false) {
  const s = style(p.input.style);
  const todo = p.shots!.filter((x) => x.asset);
  await stage(p, "assets", [RULES_VERSION, p.shots, s.art, topic(p), p.narration?.words, p.plan?.story, p.plan?.visuals, ownPictures(p)], todo.length * 0.03, async () => {
    const spend: Spend = { usd: 0, notes: [] };
    const out: Asset[] = [];
    try {
      out.push(...await parallelMap(todo, PARALLEL, (shot) => one(p, shot, s, spend)));
      await fillGaps(p, out, s, spend);
    } finally {
      // Charge what was spent even if a shot failed, so the ledger stays true.
      for (const n of spend.notes) console.log(`  ${n}`);
      const count = (k: string) => out.filter((a) => (k === "drawn" ? !!a.draw : a.kind === k && !a.draw)).length;
      charge(p, "assets", spend.usd, `${todo.length} shots, ${count("real")} real, ${count("generated")} generated, ${count("drawn")} drawn, ${out.filter((a) => a.missing && !a.draw).length} held, ${out.filter((a) => a.cutout).length} cutouts`);
    }
    p.assets = out;
  }, force);
}
