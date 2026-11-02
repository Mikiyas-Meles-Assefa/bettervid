// Style writer: a person describes a look in words, Spark writes the whole style file, the engine checks it, and Spark
// looks at a rendered preview and fixes what does not match or cannot be read. Nothing falls back to a stock style:
// every problem goes back to Spark until the file is right, or the run stops and says why.
// Usage: node --env-file=.env --experimental-strip-types pipeline/tools/style-writer.ts "<description>"
// Prints "step: ..." lines while it works and "style custom/<slug>" when the style is saved.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { preview, previewStill, PREVIEWS } from "../../app/preview.ts";
import { resolveStyle, STYLE_GUIDE } from "../../engine/style/format.ts";
import { json, text } from "../lib/meta.ts";
import { checkBudget, prompt, ROOT, style } from "../lib/project.ts";
import { hash } from "../lib/util.ts";

const CUSTOM = "styles/custom";
const DRAFTS = `${CUSTOM}/drafts`;
const WRITE_ROUNDS = 4; // tries to get a file the engine accepts
const LOOK_ROUNDS = 3; // times Spark looks at the rendered preview
const MAX_DESCRIPTION = 400;
const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded"]);
const KEYS = ["name", "label", "palette", "fonts", "art", "realAssets", "surface", "grain", "vignette", "hand", "render", "voice", "description"];

type Raw = Record<string, any>;
export type Written = { name: string; label: string; file: Raw; still: string; loop: string; usd: number; notes: string[] };

// Families the renderer can actually draw: the machine's own fonts, minus scripts the videos never use.
const SKIP = /noto|braille|sangam|\bmn\b|kohinoor|hiragino|heiti|lastresort|emoji|symbol|ornament|dingbat|webdings|wingdings|kufi|naskh|nastaleeq|devanagari|gurmukhi|gujarati|kannada|malayalam|myanmar|khmer|lao|thonburi|geeza|damascus|baghdad|beirut|farah|farisi|muna|mishafi|diwan|kefa|^al |albayan|ayuthaya|kailasa|kokonor|mshtakan|euphemia|inaimathi|gothic|myungjo|aqua|pingfang|songti|kaiti|sathu|silom|krungthep|cherokee|mukta|sukhumvit|^\./i;
export function installedFonts(): string[] {
  try {
    const out = execFileSync("fc-list", [":lang=en", "family"], { encoding: "utf8" });
    return [...new Set(out.split("\n").map((l) => l.split(",")[0]!.trim()).filter((f) => f && !SKIP.test(f)))].sort();
  } catch {
    throw new Error("style writer: cannot list installed fonts (fc-list is missing), so it cannot promise a font will render");
  }
}

const families = (stack: string) => stack.split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")).filter(Boolean);

// Everything wrong with a file, as plain sentences Spark can act on. Empty means the engine and pipeline can use it.
export function problems(file: Raw, fonts: Set<string>): string[] {
  const out: string[] = [];
  try {
    resolveStyle(file);
  } catch (e: any) {
    out.push(e.message);
  }
  for (const key of Object.keys(file)) if (!KEYS.includes(key)) out.push(`unknown top-level field "${key}". Known: ${KEYS.join(", ")}`);
  if (typeof file.label !== "string" || !file.label.trim() || file.label.length > 32) out.push("label must be a short name, 1 to 32 characters");
  for (const k of ["title", "body", "caption"]) {
    const f = file.fonts?.[k];
    if (typeof f !== "string" || !fonts.has(f)) out.push(`fonts.${k}: "${f}" is not an installed family. Pick one from the list`);
  }
  for (const k of ["title", "body"]) {
    const stack = file.render?.type?.[k];
    if (stack === undefined) continue;
    const list = typeof stack === "string" ? families(stack) : [];
    if (!list.length) {
      out.push(`render.type.${k} must be a CSS font stack`);
      continue;
    }
    if (!fonts.has(list[0]!)) out.push(`render.type.${k}: the first family "${list[0]}" is not installed`);
    const unknown = list.filter((f) => !fonts.has(f) && !GENERIC.has(f) && !/^Liberation /.test(f));
    if (unknown.length) out.push(`render.type.${k}: ${unknown.map((f) => `"${f}"`).join(", ")} not installed`);
    if (!GENERIC.has(list.at(-1)!)) out.push(`render.type.${k} must end with a generic family such as serif or sans-serif`);
  }
  for (const k of ["scene", "object", "diagram"]) {
    const a = file.art?.[k];
    if (typeof a !== "string" || a.trim().length < 20) out.push(`art.${k} must describe how that kind of picture is drawn`);
    else if (a.length > 500) out.push(`art.${k} is too long for an image prompt; keep it under 500 characters`);
  }
  if (!["prefer", "proof"].includes(file.realAssets)) out.push(`realAssets must be "prefer" or "proof"`);
  for (const k of ["grain", "vignette"]) if (typeof file[k] !== "number" || file[k] < 0 || file[k] > 1) out.push(`${k} must be a number from 0 to 1`);
  const hand = file.hand;
  if (!hand || typeof hand.wobble !== "number" || hand.wobble < 0 || hand.wobble > 12 || typeof hand.weight !== "number" || hand.weight < 0.3 || hand.weight > 3) out.push("hand needs wobble (0 to 12) and weight (0.3 to 3)");
  const s = file.surface;
  if (s !== undefined) {
    if (typeof s !== "object" || s === null) out.push("surface must be an object with filter and paper");
    else {
      for (const k of Object.keys(s)) if (!["filter", "paper"].includes(k)) out.push(`surface.${k} is not a setting. Known: filter, paper`);
      if (s.filter !== undefined && (typeof s.filter !== "string" || !/^\s*([a-z-]+\([^()]*\)\s*)*$/.test(s.filter))) out.push(`surface.filter "${s.filter}" is not a CSS filter list such as "sepia(0.3) contrast(1.1)"`);
      if (s.paper !== undefined && (typeof s.paper !== "number" || s.paper < 0 || s.paper > 1)) out.push("surface.paper must be from 0 to 1");
    }
  }
  return out;
}

// The range of every render setting, read from the engine's own checks so it can never drift from them: an unknown
// key makes resolveStyle list the known ones, and an absurd value makes it state the allowed range.
export function settingRanges(): string {
  const base = { palette: { paper: "#ffffff", ink: "#000000", accent: "#c00000", highlight: "#ffcc00" } };
  const fail = (render: Raw) => {
    try {
      resolveStyle({ ...base, render });
      return "";
    } catch (e: any) {
      return String(e.message);
    }
  };
  return ["line", "fill", "surface", "type", "motion"].map((part) => {
    const known = /Known: (.*)$/.exec(fail({ [part]: { "?": 1 } }))?.[1]?.split(", ") ?? [];
    const ranges = known.flatMap((k) => {
      const m = / is outside (\S+) to (\S+)$/.exec(fail({ [part]: { [k]: 1e9 } }));
      return m ? [`${k} ${m[1]} to ${m[2]}`] : [];
    });
    return `render.${part}: ${ranges.join(", ")}`;
  }).join("\n");
}

// The JSON object in a reply, even if the model wrapped it in a fence.
function parse(reply: string): Raw {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("the reply has no JSON object in it");
  const value = JSON.parse(reply.slice(start, end + 1));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("the reply is not a JSON object");
  return value;
}

export const slugOf = (description: string) => {
  const words = description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32).replace(/-[^-]*$/, "") || "style";
  return `${words}-${hash(description, Date.now()).slice(0, 4)}`;
};

// Two existing styles as examples of the form, chosen by the description so different requests see different ones.
function examples(description: string): string {
  const names = readdirSync("styles").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  const h = parseInt(hash(description).slice(0, 8), 16);
  const pick = [names[h % names.length]!, names[(h + 1 + (h >> 8) % (names.length - 1)) % names.length]!];
  return pick.map((n) => {
    const { name, voice, ...rest } = style(n);
    return "```json\n" + JSON.stringify(rest, null, 1) + "\n```";
  }).join("\n\n");
}

const LOOK = `You check a style for explainer videos. You get the person's description, the style file, and a still from a test scene drawn in it: a title, three labeled shapes joined by arrows with a tag, a small weighted graph, and a line of math, with the accent on what matters.

Judge two things. First, does it look like the description? Think about what someone who wrote those words pictured, and whether this still would make them say "yes, that". Clean and readable but generic is not a match: if the still could belong to many descriptions, say what would make it unmistakably this one, using what the style file can change. Second, can everything be read at a glance on a phone: words on the surface, labels inside filled shapes, lines against the background, the accent standing out.

The test scene's layout and words are fixed, so judge only the look: colors, type, lines, fills, surface, texture, motion settings. The "art" sentences are prompts for pictures an image model makes later. Those pictures never contain writing, by design, because every word on screen is drawn by the engine; leave that part of them alone.

If anything should change, return the whole corrected style file in "file" as a JSON string, keeping what already works. If it is right, return "file" as "" and "problems" as [].`;

const lookSchema = {
  type: "object",
  additionalProperties: false,
  required: ["matches", "readable", "problems", "file"],
  properties: { matches: { type: "boolean" }, readable: { type: "boolean" }, problems: { type: "array", items: { type: "string" } }, file: { type: "string" } },
} as const;

export async function writeStyle(description: string, log: (line: string) => void = console.log): Promise<Written> {
  description = description.trim().replace(/\s+/g, " ");
  if (!description) throw new Error("Describe the look you want.");
  if (description.length > MAX_DESCRIPTION) throw new Error(`Keep the description under ${MAX_DESCRIPTION} characters.`);
  const slug = slugOf(description);
  const fontList = installedFonts();
  const fonts = new Set(fontList);
  const voice = style("collage").voice; // the narrator's voice belongs to the narrator, not to a look
  let usd = 0;
  const ledger = (detail: string, cost: number) => {
    usd += cost;
    mkdirSync(ROOT, { recursive: true });
    appendFileSync(join(ROOT, "spend.jsonl"), JSON.stringify({ project: `style-${slug}`, stage: "style", usd: +cost.toFixed(5), detail, at: new Date().toISOString() }) + "\n");
  };
  const ranges = settingRanges();
  const system = prompt("style-writer").replace("{{guide}}", STYLE_GUIDE).replace("{{ranges}}", ranges).replace("{{fonts}}", fontList.join(", ")).replace("{{examples}}", examples(description));

  // Ask, check, and send every problem back until the engine accepts the file.
  async function settle(first: Raw | string, why: string): Promise<Raw> {
    let reply = typeof first === "string" ? first : JSON.stringify(first);
    for (let round = 1; ; round++) {
      let file: Raw | undefined;
      let list: string[];
      try {
        file = parse(reply);
        list = problems(file, fonts);
      } catch (e: any) {
        list = [`the file could not be read: ${e.message}`];
      }
      if (!list.length) return file!;
      if (round >= WRITE_ROUNDS) throw new Error(`the style still has problems after ${round} tries: ${list.join("; ")}`);
      log(`step: Fixing ${list.length} problem${list.length > 1 ? "s" : ""} the engine found`);
      checkBudget(0.05);
      const r = await text({
        system,
        effort: "low",
        user: `The look: ${description}\n\n${why}\n\nYour file:\n${reply}\n\nThe engine cannot use it yet:\n${list.map((p) => `- ${p}`).join("\n")}\n\nReturn the whole corrected file, keeping everything that already works.`,
      });
      ledger("repair", r.usd);
      reply = r.value;
    }
  }

  log("step: Writing the style");
  checkBudget(0.05);
  const first = await text({ system, effort: "medium", user: `The look: ${description}` });
  ledger("write", first.usd);
  let file = await settle(first.value, "This is the style file you wrote for it.");

  const notes: string[] = [];
  const draft = `drafts/${slug}`;
  mkdirSync(DRAFTS, { recursive: true });
  try {
    for (let round = 1; round <= LOOK_ROUNDS; round++) {
      file = { ...file, name: `custom/${slug}`, voice };
      writeFileSync(join(CUSTOM, `${draft}.json`), JSON.stringify(file, null, 2));
      log(`step: Drawing a test scene${round > 1 ? " again" : ""}`);
      const still = await previewStill(`custom/${draft}`, join(DRAFTS, `${slug}.jpg`));
      log("step: Looking at the test scene");
      checkBudget(0.05);
      const { name, voice: _, ...shown } = file;
      const r = await json<{ matches: boolean; readable: boolean; problems: string[]; file: string }>({
        system: LOOK,
        effort: "low",
        user: [
          { type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(still).toString("base64")}` },
          { type: "input_text", text: `The description: ${description}\n\nThe style file:\n${JSON.stringify(shown, null, 1)}\n\n${STYLE_GUIDE}\n\nThe range of each setting:\n${ranges}\n\nInstalled fonts: ${fontList.join(", ")}` },
        ],
        schema: lookSchema,
        schemaName: "look",
      });
      ledger("look", r.usd);
      const v = r.value;
      notes.splice(0, notes.length, ...(v.matches && v.readable ? [] : v.problems));
      if ((v.matches && v.readable) || !v.file.trim()) break;
      if (round === LOOK_ROUNDS) break; // the last look's notes are kept and reported with the style
      log(`step: Adjusting: ${v.problems.slice(0, 2).join("; ") || "closer to the description"}`);
      file = await settle(v.file, "This is the corrected file you wrote after looking at the test scene.");
    }
  } finally {
    rmSync(join(CUSTOM, `${draft}.json`), { force: true });
    rmSync(join(DRAFTS, `${slug}.jpg`), { force: true });
  }

  file = { name: `custom/${slug}`, label: file.label, ...file, voice };
  writeFileSync(join(CUSTOM, `${slug}.json`), JSON.stringify({ ...file, description }, null, 2) + "\n");
  log("step: Making the preview");
  const made = await preview(`custom/${slug}`);
  log(`step: Done for $${usd.toFixed(3)}`);
  return { name: `custom/${slug}`, label: file.label, file, ...made, usd, notes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const description = process.argv.slice(2).join(" ");
  const r = await writeStyle(description);
  if (r.notes.length) console.log(`notes: ${r.notes.join("; ")}`);
  console.log(`still ${r.still}`);
  console.log(`style ${r.name}`);
  if (!existsSync(join(PREVIEWS, `${r.name}.jpg`))) process.exit(1);
}
