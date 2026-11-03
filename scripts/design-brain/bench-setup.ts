// Prepares bench cases for the design brain composer: from a bench run folder (after `bench read` and `bench prepare`),
// writes
//   request.json   the timed words, the frames and the frame size the composer reads, with the user's pictures by name
//   material.json  the part cards of the user's material by name (bench read's cards.json: named parts with boxes and,
//                  for a chart, its data), each with the requirements about it
//   requirements.json  every requirement the material states, with where it is stated
//   intent-request.md   the same request the scene author got, with the language rules taken out and the user's
//                  material listed by named parts and requirements, for an author writing the intent plan
// Usage: node --experimental-strip-types scripts/design-brain/bench-setup.ts <run> <case> [case ...]
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { folderOf } from "../../bench/lib/paths.ts";
import { frameOf, loadCase, MATERIAL } from "../../bench/lib/case.ts";
import { loadCards } from "../../bench/lib/read.ts";
import type { PartCard } from "../../engine/design/types.ts";

const [run, ...ids] = process.argv.slice(2);
for (const id of ids) {
  const dir = folderOf(run!, id);
  const p = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
  const c = loadCase(id);
  const words = p.narration.words.map((w: { text: string; start: number }) => ({ text: w.text, start: w.start }));
  const frames = Math.ceil(p.narration.seconds * 30);
  const [width, height] = frameOf(c);
  const assets: Record<string, string> = {};
  const material: Record<string, PartCard> = {};
  const k = c.material?.length ? loadCards(run!, id) : undefined;
  if (c.material?.length && !k) throw new Error(`${id}: no cards.json; run \`npm run -s bench -- read ${run} ${id}\` and answer its reader tasks first`);
  for (const card of k?.cards ?? []) material[card.name] = card;
  for (const m of c.material ?? []) {
    if (m.kind !== "image" || !m.file) continue;
    copyFileSync(join(MATERIAL, m.file), join(dir, m.file));
    assets[m.name] = m.file;
  }
  writeFileSync(join(dir, "request.json"), JSON.stringify({ topic: c.topic, words, frames, width, height, assets }, null, 1));
  if (Object.keys(material).length) writeFileSync(join(dir, "material.json"), JSON.stringify(material, null, 1));
  if (k?.requirements.length) writeFileSync(join(dir, "requirements.json"), JSON.stringify(k.requirements, null, 1));
  // The intent author's request: the scene author's, without the rules of the scene language.
  let req = readFileSync(join(dir, "request.md"), "utf8");
  req = req.replace(/This video is written in parts[\s\S]*?Your part ends the video\.\n\n/, "");
  const listed = (name: string) => {
    const m = material[name]!;
    return `${name} (${m.about}). Its parts: ${Object.entries(m.parts).map(([q, r]) => `${name}.${q} (${r.about})`).join("; ")}`;
  };
  const pictures = Object.keys(assets).filter((n) => material[n]);
  req = req.replace(/Pictures you can show with `image id asset=NAME`:\n(- .*\n)+/, () => `The user's own material, to use by name: ${pictures.map(listed).join(". ")}.\n`);
  if (k?.requirements.length) req += `\nWhat the user's files require of this video (each stated in one of their files):\n${k.requirements.map((r) => `- ${r.id}: ${r.kind}${r.applies ? ` (about ${r.applies})` : ""}: ${r.detail} (stated in ${r.source.file}${r.source.where ? `, ${r.source.where}` : ""}; ${r.why})`).join("\n")}\n`;
  req = req.replace(/@h(\d)\.end/g, "the hold's end").replace(/from @h\d to /g, "");
  writeFileSync(join(dir, "intent-request.md"), req);
  console.log(`${id}: ${words.length} words, ${frames} frames, ${width}x${height}${Object.keys(assets).length ? `, material ${Object.keys(assets).join(", ")}` : ""}${k?.requirements.length ? `, ${k.requirements.length} requirements` : ""}`);
}
