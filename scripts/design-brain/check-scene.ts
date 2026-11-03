// Builds a scene written in today's language and prints its problems (the same check the repair loop sees), or "ok".
// Writes <file>.scene.json next to it when it builds.
// Usage: node --experimental-strip-types scripts/design-brain/check-scene.ts <momentDir> [scene file, default baseline.txt]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, formatProblems } from "../../engine/language/build.ts";
import { loadLibrary } from "../../engine/language/library.ts";
import { fontMeasure } from "../../engine/language/measure.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import { SCENE_KITS } from "../../pipeline/stages/scene.ts";

const [dir, file = "baseline.txt"] = process.argv.slice(2);
const req = JSON.parse(readFileSync(join(dir!, "request.json"), "utf8"));
const theme = themeFrom(process.env.STYLE ?? "flat");
const ctx = { fps: 30, width: 1080, height: 1920, frames: req.frames, theme, words: req.words, kits: SCENE_KITS };
// The user's material, by name, as data URLs so the scene carries its pictures.
const assets: Record<string, string> = Object.fromEntries(Object.entries((req.assets ?? {}) as Record<string, string>).map(([k, f]) => [k, `data:image/${f.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(join(dir!, f)).toString("base64")}`]));
const r = await build(readFileSync(join(dir!, file), "utf8"), { ctx, library: loadLibrary(), seed: 11, words: req.words.map((w: { text: string }) => w.text), measure: fontMeasure(theme), assets });
if (r.scene) writeFileSync(join(dir!, file.replace(/\.txt$/, ".scene.json")), JSON.stringify(r.scene));
console.log(r.problems.length ? formatProblems(r.problems) : "ok");
if (r.notes?.length) console.log(`notes:\n${r.notes.join("\n")}`);
process.exit(0);
