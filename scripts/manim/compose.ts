// Renders the same accepted scene in each style, measures it, and brings each clip into Remotion under captions.
// node --env-file=.env --experimental-strip-types scripts/manim/compose.ts <outDir> <scene.py> style [style...]
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { cramerWords } from "./briefs.ts";
import { HERE, render, STYLE, writeWords } from "./lib.ts";

const OUT = resolve(process.argv[2]!);
const scene = resolve(process.argv[3]!);
const styles = process.argv.slice(4);
const PROJECT = resolve("projects/teach-me-how-to-do-cramers-rule-i-know-t-76cad8");
const c = cramerWords();
const pub = join(OUT, "public");
mkdirSync(pub, { recursive: true });
copyFileSync(join(PROJECT, "grain.png"), join(pub, "grain.png"));
execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(c.from), "-t", String(c.duration), "-i", join(PROJECT, "narration.mp3"), join(pub, "narration.wav")]);
const wordsFile = join(OUT, "cramer-words.json");
writeWords(wordsFile, c.words, c.duration);

const captions: { words: string[]; startFrame: number; endFrame: number }[] = [];
for (let i = 0; i < c.words.length; i += 4) {
  const g = c.words.slice(i, i + 4);
  captions.push({ words: g.map((w) => w.text.replace(/[.,]$/, "")), startFrame: Math.round(g[0]!.start * 30), endFrame: Math.round((c.words[i + 4]?.start ?? c.duration) * 30) });
}

const summary: any[] = [];
for (const style of styles) {
  const dir = join(OUT, `style-${style}`);
  const g = render(scene, wordsFile, style, dir);
  if (!g.ok) throw new Error(`${style}: ${g.error}`);
  writeFileSync(join(dir, "report-copy.json"), JSON.stringify(g.report));
  const sync = JSON.parse(execFileSync("/opt/homebrew/Cellar/manim/0.21.0/libexec/bin/python", [join(HERE, "measure.py"), g.video, join(dir, "report.json")], { encoding: "utf8" }));
  copyFileSync(g.video, join(pub, `clip-${style}.mp4`));
  // The bundle copies public/ when it is made, so bundle after the clip exists.
  const serveUrl = await bundle({ entryPoint: join(import.meta.dirname, "remotion/index.ts"), publicDir: pub });
  const inputProps = { clip: `clip-${style}.mp4`, audio: "narration.wav", frames: Math.round(c.duration * 30), style: JSON.parse(readFileSync(STYLE(style), "utf8")), captions };
  const composition = await selectComposition({ serveUrl, id: "ManimShot", inputProps, browserExecutable: process.env.BV_CHROME });
  const t0 = Date.now();
  const final = join(OUT, `sample-${style}.mp4`);
  await renderMedia({ serveUrl, composition, inputProps, codec: "h264", crf: 23, imageFormat: "jpeg", concurrency: 4, outputLocation: final, browserExecutable: process.env.BV_CHROME });
  summary.push({ style, seconds: c.duration, manimSeconds: g.seconds, manimRatio: g.seconds / c.duration, remotionSeconds: (Date.now() - t0) / 1000, remotionRatio: (Date.now() - t0) / 1000 / c.duration, sync: { ...sync, rows: undefined }, syncRows: sync.rows, final });
  console.log(JSON.stringify({ ...summary.at(-1), syncRows: undefined }));
}
writeFileSync(join(OUT, "compose.json"), JSON.stringify(summary, null, 1));
