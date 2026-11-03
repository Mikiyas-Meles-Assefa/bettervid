// The search and look loop from the command line, on a moment folder (the same folder compose.ts reads): request.json,
// intent.txt, material.json and the user's pictures, plus project.json for the narration's holds when it is there.
// Agents answer through files in <dir>/agents (engine/design/reasoner.ts): each run writes the next task to
// <dir>/agents/ask/<id>.md and stops; write the answer to <dir>/agents/answer/<id>.json and run again.
// Writes
//   search.report.txt    every moment: rounds, candidates, timing, what was kept and by whom, miss before and after
//   search.design.json   the design as it stands (goals, overrides, decisions)
//   search.scene.json    the compiled scene with the kept designs, once the search is done (and search.ids.json)
//   sheets/m<k>.r<r>.jpg contact sheets of each round's finalists (with --sheets)
// Usage: node --experimental-strip-types scripts/design-brain/search.ts <dir> [style=flat] [--sheets] [--viewers]
//   DESIGN=<file>    start from this design instead of the style's suggestion
//   DIRECTOR=<file>  a director's answer to apply first (engine/design/agents/api.ts DirectorAnswer)
//   BUDGET=<json>    {"candidatesPerMoment":..,"rounds":..,"calls":..}, over the design's budget
//   ONLY=3,5         search only these moments
//   SCALE=0.2        still size for sheets against the frame (0.2 of 1080x1920 is 216x384)
//   BUNDLE_DIR=<dir> keep the renderer's bundle (about 200 MB) there and reuse it across runs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { themeFrom } from "../../engine/render/theme.ts";
import type { Agents, DirectorAnswer } from "../../engine/design/agents/api.ts";
import { parseIntent } from "../../engine/design/intent/parse.ts";
import { fileReasoner } from "../../engine/design/reasoner.ts";
import { composeCached, keepDirector, newCache, remotionStills, runSearch, standInAgents, type SearchResult } from "../../engine/design/search/index.ts";
import { suggestDesign, viewingFrom, type ViewingDesc } from "../../engine/design/suggest.ts";
import type { Box, ChartData, Design, PartCard } from "../../engine/design/types.ts";

// The bench's own viewing, as compose.ts has it: a vertical short on a phone, with the bench's burned-in captions.
const BENCH: ViewingDesc = {
  width: 1080,
  height: 1920,
  fps: 30,
  screen: "phone in a feed",
  frameWidthMm: 65,
  distanceMm: 300,
  watch: "glancing in a feed",
  captions: { show: true, box: [0, 1640 / 1920, 1, 1810 / 1920], why: "the bench burns the narration in as captions" },
  why: "the bench's own viewing: a vertical short watched on a phone, with the bench's captions",
};

/** The agents: engine/design/agents' own when it exports them, else the plain stand-in (engine/design/search/stand-in.ts). */
export async function agentsFor(): Promise<{ agents: Agents; which: string }> {
  const file = join(import.meta.dirname, "../../engine/design/agents/index.ts");
  if (existsSync(file)) {
    const mod = (await import(file)) as { agents?: Agents };
    if (mod.agents) return { agents: mod.agents, which: "engine/design/agents" };
  }
  return { agents: standInAgents(), which: "the stand-in agents (engine/design/search/stand-in.ts)" };
}

export type FolderOptions = { style?: string; sheets?: boolean; viewers?: boolean; only?: number[]; budget?: Partial<Design["budget"]>; design?: Design; director?: DirectorAnswer; scale?: number; log?: (s: string) => void };

/** Runs the search on a moment folder and writes its files; returns the result. */
export async function searchFolder(dir: string, o: FolderOptions = {}): Promise<SearchResult> {
  const theme = themeFrom(o.style ?? "flat");
  const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8")) as { words: { text: string; start: number }[]; frames: number; assets?: Record<string, string>; viewing?: ViewingDesc; holds?: { id: string; afterWord: number; seconds: number }[] };
  const viewing = viewingFrom(request.viewing ?? BENCH);
  type MatReading = { file?: string; size?: [number, number]; about?: string; parts?: Record<string, { box: Box; about?: string }>; data?: ChartData; requirements?: PartCard["requirements"] };
  const material: Record<string, MatReading> = existsSync(join(dir, "material.json")) ? JSON.parse(readFileSync(join(dir, "material.json"), "utf8")) : {};
  const cards: PartCard[] = [];
  const assets: Record<string, string> = {};
  for (const [name, file] of Object.entries(request.assets ?? {})) {
    const bytes = readFileSync(join(dir, file));
    const png = bytes.length > 24 && bytes.toString("latin1", 1, 4) === "PNG";
    const r = material[name] ?? {};
    const size = r.size ?? (png ? ([bytes.readUInt32BE(16), bytes.readUInt32BE(20)] as [number, number]) : undefined);
    assets[name] = `data:image/${file.toLowerCase().endsWith(".png") ? "png" : "jpeg"};base64,${bytes.toString("base64")}`;
    cards.push({ name, file, size, kind: r.data ? "chart" : "picture", about: r.about ?? "", parts: Object.fromEntries(Object.entries(r.parts ?? {}).map(([k, v]) => [k, { box: v.box, about: v.about ?? k }])), data: r.data, requirements: r.requirements ?? [], checked: { ok: !!material[name], notes: [] } });
  }
  const project = existsSync(join(dir, "project.json")) ? JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) : undefined;
  const holds = request.holds ?? project?.narration?.holds ?? [];
  const plan = parseIntent(readFileSync(join(dir, "intent.txt"), "utf8"));
  const { agents, which } = await agentsFor();
  let design = o.design ?? suggestDesign(plan, viewing, theme, cards, request.words);
  const director = o.director ?? keepDirector(design, "no director answer: the design's own viewing, tempo and importances");
  if (o.director) design = agents.applyDirector(design, o.director);
  if (o.budget) design = { ...design, budget: { ...design.budget, ...o.budget } };
  const cache = newCache();
  const r = await runSearch({
    plan,
    design,
    director,
    cards,
    words: request.words,
    holds,
    theme,
    frames: request.frames,
    assets,
    agents,
    reasoner: fileReasoner(join(dir, "agents")),
    dir,
    ...(o.sheets ? { stills: remotionStills({ theme, scale: o.scale ?? 0.2, bundleDir: process.env.BUNDLE_DIR }), sheet: { finalists: 4, frames: 3 } } : {}),
    viewers: o.viewers,
    only: o.only,
    cache,
    log: o.log,
  });
  writeFileSync(join(dir, "search.report.txt"), `agents: ${which}\n${r.report}\n${r.pending.length ? `\nwaiting for:\n${r.pending.map((p) => `- ${p}`).join("\n")}\n` : ""}`);
  writeFileSync(join(dir, "search.design.json"), JSON.stringify(r.design, null, 1));
  if (r.status === "done") {
    const c = composeCached(plan, r.design, { plan, compose: { theme, words: request.words, frames: request.frames, cards, assets }, cache });
    writeFileSync(join(dir, "search.scene.json"), JSON.stringify(c.scene));
    writeFileSync(join(dir, "search.ids.json"), JSON.stringify(c.ids, null, 1));
  }
  return r;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const [dir, style = "flat"] = args.filter((a) => !a.startsWith("--"));
  if (!dir) throw new Error("usage: search.ts <dir> [style] [--sheets] [--viewers]");
  const r = await searchFolder(dir, {
    style,
    sheets: flags.has("--sheets"),
    viewers: flags.has("--viewers"),
    only: process.env.ONLY?.split(",").map(Number),
    budget: process.env.BUDGET ? JSON.parse(process.env.BUDGET) : undefined,
    design: process.env.DESIGN ? JSON.parse(readFileSync(process.env.DESIGN, "utf8")) : undefined,
    director: process.env.DIRECTOR ? JSON.parse(readFileSync(process.env.DIRECTOR, "utf8")) : undefined,
    scale: process.env.SCALE ? Number(process.env.SCALE) : undefined,
    log: console.log,
  });
  console.log(r.report);
  if (r.pending.length) console.log(`\nwaiting for:\n${r.pending.join("\n")}`);
}
