// Prepares bench cases for the design brain composer: from a bench run folder (after `bench prepare`), writes
//   request.json   the timed words and frames the composer reads, with the user's pictures by name
//   material.json  what a material reader returns for each picture: named parts and, for a chart, its data
//   intent-request.md   the same request the scene author got, with the language rules taken out and the user's
//                  material listed by named parts, for an author writing the intent plan
// Usage: node --experimental-strip-types scripts/design-brain/bench-setup.ts <run> <case> [case ...]
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { folderOf } from "../../bench/lib/paths.ts";
import { loadCase } from "../../bench/lib/case.ts";

// Material readings. In the pipeline a reader agent produces these (vision for parts, the data file or digitizing for
// numbers); here they are written by hand from the case's own description of the picture, for the prototype only.
const READINGS: Record<string, Record<string, unknown>> = {
  "support-tickets-slide.png": {
    about: "the user's meeting slide: a bar chart of Q3 support tickets by cause, total 840",
    parts: {
      title: { box: [0.03, 0.0, 0.97, 0.125], about: "the slide title, Q3 support tickets by cause" },
      total: { box: [0.03, 0.15, 0.31, 0.2], about: "the total, 840 tickets (Jul to Sep)" },
      login: { box: [0.258, 0.264, 0.884, 0.375], about: "the login / password bar, 412" },
      billing: { box: [0.258, 0.424, 0.665, 0.535], about: "the billing bar, 268" },
      shipping: { box: [0.258, 0.583, 0.405, 0.694], about: "the shipping bar, 97" },
      other: { box: [0.258, 0.743, 0.354, 0.854], about: "the other bar, 63" },
    },
    data: { kind: "bars", orient: "h", title: "Q3 support tickets by cause", labels: ["Login / password", "Billing", "Shipping", "Other"], values: [412, 268, 97, 63], ymax: 480, plot: [0.258, 0.24, 0.987, 0.878], barFrac: 0.696, texts: { title: "Q3 support tickets by cause", total: "840 tickets" } },
  },
};

const [run, ...ids] = process.argv.slice(2);
for (const id of ids) {
  const dir = folderOf(run!, id);
  const p = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
  const c = loadCase(id);
  const words = p.narration.words.map((w: { text: string; start: number }) => ({ text: w.text, start: w.start }));
  const frames = Math.ceil(p.narration.seconds * 30);
  const assets: Record<string, string> = {};
  const material: Record<string, unknown> = {};
  for (const m of c.material ?? []) {
    if (m.kind !== "image" || !m.file) continue;
    copyFileSync(join("bench/cases/material", m.file), join(dir, m.file));
    assets[m.name] = m.file;
    material[m.name] = { file: m.file, size: m.size, ...(READINGS[m.file] ?? { about: m.about, parts: {} }) };
  }
  writeFileSync(join(dir, "request.json"), JSON.stringify({ topic: c.topic, words, frames, assets }, null, 1));
  if (Object.keys(material).length) writeFileSync(join(dir, "material.json"), JSON.stringify(material, null, 1));
  // The intent author's request: the scene author's, without the rules of the scene language.
  let req = readFileSync(join(dir, "request.md"), "utf8");
  req = req.replace(/This video is written in parts[\s\S]*?Your part ends the video\.\n\n/, "");
  req = req.replace(/Pictures you can show with `image id asset=NAME`:\n(- .*\n)+/, () =>
    `The user's own material, to use by name: ${Object.entries(material).map(([k, v]) => { const m = v as { about: string; parts: Record<string, { about: string }> }; return `${k} (${m.about}). Its parts: ${Object.entries(m.parts).map(([q, r]) => `${k}.${q} (${r.about})`).join("; ")}`; }).join(". ")}.\n`);
  req = req.replace(/@h(\d)\.end/g, "the hold's end").replace(/from @h\d to /g, "");
  writeFileSync(join(dir, "intent-request.md"), req);
  console.log(`${id}: ${words.length} words, ${frames} frames${Object.keys(assets).length ? `, material ${Object.keys(assets).join(", ")}` : ""}`);
}
