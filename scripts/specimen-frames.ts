// The style specimen page written in the scene language, built and drawn through the real engine path (build, compile,
// SceneView), one full-size frame per style. Compare with styles/previews/compare/*.jpg, whose right side is the look
// the design layer intends.
// Usage: node --experimental-strip-types scripts/specimen-frames.ts <outDir> [<style> ...]   (all top-level styles by default)
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "../engine/language/build.ts";
import { styleNames, themeFrom } from "../engine/render/theme.ts";
import { closeRenderer, renderStills, SCENE_KITS } from "../pipeline/stages/scene.ts";

export const SPECIMEN = `read dim=0.5
@0
stack page gap=40
  text kicker "Chapter two" role=heading
  text title "Measuring the spread" role=title
  stack card role=panel gap=30
    grid table cols=3 gap=26
      text h1 "x"
      text h2 "x − mean"
      text h3 "squared"
      text a1 "1"
      text a2 "−2"
      text a3 "4"
      text b1 "2"
      text b2 "−1"
      text b3 "1"
      text d1 "6"
      text d2 "3"
      text d3 "9" role=key
    row result gap=80
      text answer "variance = 4" role=answer
      text wrongdiv "÷ 5" role=wrong
  text note "a sample, so divide by n − 1" role=note
@2 keep
mark cross wrongdiv
mark highlight answer
dim b1 b2 b3
@4
stack page2 gap=60
  row diagram gap=90
    circle data "data" fill=accent w=200
    box mean "mean" fill=highlight
    box spread "spread" role=panel
  row under gap=200
    text every "every value" role=label
    text since "since 1890" role=muted
  row pictures gap=50 align=top
    image photo asset=photo w=600 h=400
    image made asset=made w=225 h=400
@6 keep
arrow data -> mean
arrow mean -> spread
mark ring mean
tag photo "1900 glider, flown as a kite" at=0.5,0.84 role=caption id=cap
tag photo "wing" at=0.35,0.25 role=label id=wing
`;

const [out = "out/frames/specimen", ...asked] = process.argv.slice(2);
const pic = (f: string) => `data:image/jpeg;base64,${readFileSync(resolve("styles/previews/specimen", f)).toString("base64")}`;
const assets = { photo: pic("photo.jpg"), made: pic("made.jpg") };
const words = Array.from({ length: 12 }, (_, i) => ({ text: `w${i}`, start: i * 1 }));
mkdirSync(out, { recursive: true });
for (const style of asked.length ? asked : styleNames()) {
  const theme = themeFrom(style);
  const ctx = { fps: 30, width: 1080, height: 1920, frames: 300, theme, words, kits: SCENE_KITS };
  const r = await build(SPECIMEN, { ctx, words: words.map((w) => w.text), assets, seed: 11 });
  const name = style.replace("/", "-");
  writeFileSync(join(out, `${name}.problems.txt`), r.problems.map((p) => `line ${p.line}: ${p.message}`).join("\n") || "none\n");
  console.log(`${style}: ${r.problems.length} problems${r.problems.length ? `\n${r.problems.map((p) => `  line ${p.line}: ${p.message}`).join("\n")}` : ""}`);
  if (!r.scene) continue;
  const files = await renderStills(r.scene, theme, [110, 290], resolve(out, name), 1);
  files.forEach((f, i) => renameSync(f, join(out, `${name}-${i + 1}.jpg`)));
}
await closeRenderer();
