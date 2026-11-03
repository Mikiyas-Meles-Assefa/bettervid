// The design brain's whole run (engine/design/search/design.ts runDesign) from the command line, on a moment folder (the
// same folder compose.ts reads): request.json, intent.txt, material.json and the user's pictures, plus project.json for
// the narration's holds and requirements.json when they are there. Agents (depicter, director, designer, viewer panel)
// answer through files in <dir>/design: each run writes the waiting tasks to <dir>/design/ask/<id>.md and stops; write
// each answer to <dir>/design/answer/<id>.json and run again. Answered steps replay from their answers.
// Writes, under <dir>/design, once every task is answered: composed.scene.json, design.json, decisions.json, notes.txt,
// ids.json, props.json, report.txt; sheets/ holds the contact sheets (with --sheets).
// Usage: node --experimental-strip-types scripts/design-brain/search.ts <dir> [style=flat] [--sheets]
//   BRIEF=<text>     the user's request and purpose, for the director (else the folder's topic)
//   SCALE=0.15       still size for sheets against the frame
//   BUNDLE_DIR=<dir> keep the renderer's bundle there and reuse it across runs
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { themeFrom } from "../../engine/render/theme.ts";
import { parseIntent } from "../../engine/design/intent/parse.ts";
import { fileReasoner } from "../../engine/design/reasoner.ts";
import { runDesign, type DesignOutcome } from "../../engine/design/search/design.ts";
import { remotionStills } from "../../engine/design/search/sheet.ts";
import { viewingFrom, type ViewingDesc } from "../../engine/design/suggest.ts";
import type { Box, ChartData, PartCard, Requirement } from "../../engine/design/types.ts";

/** What the folder says of where it is watched: its frame, and that the bench burns captions in; the rest is the director's. */
const hint = (width: number, height: number): ViewingDesc => ({
  width,
  height,
  fps: 30,
  screen: "not stated: the director decides",
  frameWidthMm: 65,
  distanceMm: 300,
  watch: "not stated",
  captions: { show: true, box: [0, 1640 / 1920, 1, 1810 / 1920], why: "the bench burns the narration in as captions" },
  why: "only the frame's shape is known; the rest is a placeholder for the director to replace",
});

export type FolderOptions = { style?: string; sheets?: boolean; brief?: string; scale?: number; log?: (s: string) => void };

/** Runs the design brain on a moment folder; its files go to <dir>/design. */
export async function designFolder(dir: string, o: FolderOptions = {}): Promise<DesignOutcome> {
  const theme = themeFrom(o.style ?? "flat");
  const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8")) as { topic?: string; words: { text: string; start: number; end?: number }[]; frames: number; width?: number; height?: number; assets?: Record<string, string>; viewing?: ViewingDesc; holds?: { id: string; afterWord: number; seconds: number }[] };
  type MatReading = { file?: string; size?: [number, number]; about?: string; kind?: string; parts?: Record<string, { box?: Box; about?: string }>; data?: ChartData; requirements?: Requirement[] };
  const material: Record<string, MatReading> = existsSync(join(dir, "material.json")) ? JSON.parse(readFileSync(join(dir, "material.json"), "utf8")) : {};
  const cards: PartCard[] = [];
  const assets: Record<string, string> = {};
  for (const [name, file] of Object.entries(request.assets ?? {})) {
    const bytes = readFileSync(join(dir, file));
    const png = bytes.length > 24 && bytes.toString("latin1", 1, 4) === "PNG";
    const r = material[name] ?? {};
    const size = r.size ?? (png ? ([bytes.readUInt32BE(16), bytes.readUInt32BE(20)] as [number, number]) : undefined);
    assets[name] = `data:image/${png ? "png" : "jpeg"};base64,${bytes.toString("base64")}`;
    cards.push({ name, file, size, kind: r.kind ?? (r.data ? "chart" : "picture"), about: r.about ?? "", parts: Object.fromEntries(Object.entries(r.parts ?? {}).map(([k, v]) => [k, { box: v.box, about: v.about ?? k }])), data: r.data, requirements: r.requirements ?? [], checked: { ok: !!material[name], notes: [] } });
  }
  const project = existsSync(join(dir, "project.json")) ? JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) : undefined;
  const holds = request.holds ?? project?.narration?.holds ?? [];
  const requirements: Requirement[] = existsSync(join(dir, "requirements.json")) ? JSON.parse(readFileSync(join(dir, "requirements.json"), "utf8")) : [];
  const viewing = viewingFrom(request.viewing ?? hint(request.width ?? 1080, request.height ?? 1920));
  const out = join(dir, "design");
  return runDesign(
    out,
    { plan: parseIntent(readFileSync(join(dir, "intent.txt"), "utf8")), words: request.words, holds, frames: request.frames, cards, requirements, assets, brief: o.brief ?? `Topic: ${request.topic ?? "not stated"}`, theme, styleName: o.style ?? "flat", viewing },
    fileReasoner(out),
    undefined,
    { ...(o.sheets ? { stills: remotionStills({ theme, scale: o.scale ?? 0.15, bundleDir: process.env.BUNDLE_DIR }), sheet: { finalists: 3, frames: 3, cell: 150 } } : {}), log: o.log },
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const [dir, style = "flat"] = args.filter((a) => !a.startsWith("--"));
  if (!dir) throw new Error("usage: search.ts <dir> [style] [--sheets]");
  const r = await designFolder(dir, { style, sheets: flags.has("--sheets"), brief: process.env.BRIEF, scale: process.env.SCALE ? Number(process.env.SCALE) : undefined, log: console.log });
  console.log(r.report);
  if (r.status === "pending") console.log(`\nwaiting for:\n${r.waiting.join("\n")}`);
}
