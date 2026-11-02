// S14: what the engine measures on a project's scene sections, with no model calls.
// BETTERVID_CHROME=... node --experimental-strip-types scripts/spikes/s14-measure.ts <projectDir> [s1,s5]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../../engine/language/syntax.ts";
import { build } from "../../engine/language/build.ts";
import { when } from "../../engine/core/compile.ts";
import { KITS } from "../../engine/kits/index.ts";
import { decode, hide, inventory, lookFrames, measureLayout, measurePixels, merge, readOf, wordsOnScreen } from "../../pipeline/lib/look.ts";
import { closeRenderer, renderStills, sceneBuildOptions } from "../../pipeline/stages/scene.ts";

const dir = process.argv[2]!;
const only = process.argv[3]?.split(",");
const p = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
// Pictures as small JPEG data URLs, as the scene step loads them.
const loadable = Object.fromEntries(Object.entries((p.scene?.assets ?? {}) as Record<string, string>).map(([name, path]) => [name, `data:image/jpeg;base64,${execFileSync("ffmpeg", ["-v", "error", "-i", join(dir, path), "-vf", "scale='min(720,iw)':-2", "-f", "mjpeg", "-q:v", "4", "-"], { maxBuffer: 1 << 26 }).toString("base64")}`]));
const opts = sceneBuildOptions(p, loadable);
const ctx = opts.ctx;
const kinds = KITS.flatMap((k) => Object.keys(k.kinds ?? {})).filter((k) => k !== "graph");
const out = join(process.cwd(), "media/spikes/s14/measure", p.id);
try {
  for (const s of p.scene.sections) {
    if (only && !only.includes(s.id)) continue;
    const r = await build(s.source, opts);
    if (!r.scene) {
      console.log(`${s.id}: does not build`);
      continue;
    }
    const starts = parse(s.source, kinds).doc.states.map((x) => when({ word: x.at.word }, ctx));
    const next = p.scene.sections.find((x: any) => x.firstWord === s.lastWord + 1);
    const end = next ? when({ word: next.firstWord }, ctx) - 2 : ctx.frames - 1;
    const frames = lookFrames(starts, when({ word: s.firstWord }, ctx), end, ctx.fps);
    const f = frames.map((m) => m.frame);
    const [a, b, c] = await Promise.all([
      renderStills(r.scene, ctx.theme, f, join(out, s.id, "shown"), 0.5),
      renderStills(hide(r.scene, ["text"]), ctx.theme, f, join(out, s.id, "bare"), 0.5),
      renderStills(hide(r.scene, ["text", "image"]), ctx.theme, f, join(out, s.id, "empty"), 0.5),
    ]);
    frames.forEach((m, k) => {
      const things = inventory(r.scene!, m.frame);
      const changing = m.why === "changing";
      const found = merge(measureLayout(things, ctx.width, ctx.height, readOf(ctx.theme), changing), measurePixels(things, decode(a[k]!), decode(b[k]!), decode(c[k]!), ctx.width, changing));
      console.log(`${s.id} ${(m.frame / ctx.fps).toFixed(1)}s ${m.why}: ${wordsOnScreen(things).join(" / ").slice(0, 160)}`);
      for (const x of found) console.log(`    [${x.severity}] ${x.kind}: ${x.note.slice(0, 220)}`);
    });
  }
} finally {
  await closeRenderer();
}
