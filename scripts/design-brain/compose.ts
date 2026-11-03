// The intent composer from the command line: a thin shell over the design brain's library (engine/design).
// Reads <momentDir>/request.json (words with start seconds, frames, the user's pictures by name, and optionally a
// `viewing`), <momentDir>/intent.txt (the intent language, prompts/intent.md; INTENT picks another file),
// <momentDir>/material.json (what a material reader found in each picture) and <momentDir>/props.json (the depicter's
// spec of each object, from depict-tasks.ts), and writes
//   <out>.scene.json   the compiled scene for render.ts and stills.ts
//   <out>.notes.txt    parse notes, problems for an agent to repair, the composer's notes and every decision
//   <out>.design.json  the design it composed with (the style's suggestion, unless DESIGN gave one), to edit and recompose
//   <out>.ids.json     plan names to the scene ids that draw them, for instruments
// Usage: node --experimental-strip-types scripts/design-brain/compose.ts <momentDir> [style=flat] [out=intent]
//   DESIGN=<file>   compose with this design instead of the suggestion
//   VIEWING=<file>  the viewing as JSON (engine/design/suggest.ts ViewingDesc); else request.json's, else the bench's
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { themeFrom } from "../../engine/render/theme.ts";
import { compose } from "../../engine/design/compose/compose.ts";
import { checkIntent, parseIntent } from "../../engine/design/intent/parse.ts";
import { suggestDesign, viewingFrom, type ViewingDesc } from "../../engine/design/suggest.ts";
import type { PropSpec } from "../../engine/design/depict/index.ts";
import type { Box, ChartData, Design, PartCard } from "../../engine/design/types.ts";

const [dir, styleArg = "flat", outName = "intent"] = process.argv.slice(2);
if (!dir) throw new Error("usage: compose.ts <momentDir> [style] [out]");
const theme = themeFrom(styleArg);
const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8")) as { words: { text: string; start: number }[]; frames: number; assets?: Record<string, string>; viewing?: ViewingDesc };

// The bench renders a 9:16 clip for a phone feed and burns its own captions into a band near the bottom
// (video/Video.tsx, Caption: top 1640 px, 170 px tall, in a 1920 px frame).
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
const viewing = viewingFrom(process.env.VIEWING ? JSON.parse(readFileSync(process.env.VIEWING, "utf8")) : request.viewing ?? BENCH);

// The user's material: each picture by name, as a part card (material.json is what a reader agent returns).
type Reading = { file?: string; size?: [number, number]; about?: string; parts?: Record<string, { box: Box; about?: string }>; data?: ChartData };
let material: Record<string, Reading> = {};
try {
  material = JSON.parse(readFileSync(join(dir, "material.json"), "utf8"));
} catch {}
const cards: PartCard[] = [];
const assets: Record<string, string> = {};
for (const [name, file] of Object.entries(request.assets ?? {})) {
  const bytes = readFileSync(join(dir, file));
  const png = bytes.length > 24 && bytes.toString("latin1", 1, 4) === "PNG";
  const r = material[name] ?? {};
  const size = r.size ?? (png ? ([bytes.readUInt32BE(16), bytes.readUInt32BE(20)] as [number, number]) : undefined);
  assets[name] = `data:image/${file.toLowerCase().endsWith(".png") ? "png" : "jpeg"};base64,${bytes.toString("base64")}`;
  cards.push({ name, file, size, kind: r.data ? "chart" : "picture", about: r.about ?? "", parts: Object.fromEntries(Object.entries(r.parts ?? {}).map(([k, v]) => [k, { box: v.box, about: v.about ?? k }])), data: r.data, requirements: [], checked: { ok: !!material[name], notes: material[name] ? [] : ["no reading: a picture with no parts"] } });
}

const plan = parseIntent(readFileSync(join(dir, process.env.INTENT ?? "intent.txt"), "utf8"));
let props: Record<string, PropSpec> = {};
try {
  props = JSON.parse(readFileSync(join(dir, "props.json"), "utf8"));
} catch {}
const problems = checkIntent(plan, request.words, cards);
const design: Design = process.env.DESIGN ? JSON.parse(readFileSync(process.env.DESIGN, "utf8")) : suggestDesign(plan, viewing, theme, cards, request.words, props);
const t = performance.now();
const out = compose(plan, design, { theme, words: request.words, frames: request.frames, cards, assets, props });
const ms = performance.now() - t;
writeFileSync(join(dir, `${outName}.scene.json`), JSON.stringify(out.scene));
writeFileSync(join(dir, `${outName}.design.json`), JSON.stringify(design, null, 1));
writeFileSync(join(dir, `${outName}.ids.json`), JSON.stringify(out.ids, null, 1));
const lines = [
  `feel ${plan.feel ?? "-"}, for ${plan.audience ?? "-"}, style ${styleArg}, ${viewing.width}x${viewing.height} (${viewing.screen}), ${plan.moments.length} moments, ${out.scene.nodes.length} nodes, composed in ${ms.toFixed(0)} ms`,
  ...plan.notes.map((n) => `parse: ${n}`),
  ...problems.map((p) => `check: line ${p.line}: ${p.message}`),
  ...out.problems.map((p) => `repair (${p.who}${p.task ? `, ${p.task}` : ""}): ${p.problem}`),
  ...out.notes,
  ...out.decisions.map((d) => `${d.moment === undefined ? "video" : `@${plan.moments[d.moment]?.word}`} ${d.area} [${d.from}]: ${d.choice}${d.why ? ` (${d.why})` : ""}`),
];
writeFileSync(join(dir, `${outName}.notes.txt`), `${lines.join("\n")}\n`);
console.log(`${dir}: ${plan.moments.length} moments, ${out.scene.nodes.length} nodes, ${out.scene.tracks.length} tracks, ${out.notes.length} notes, ${out.problems.length} problems, ${out.decisions.length} decisions, ${ms.toFixed(0)} ms`);
