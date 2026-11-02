// Proof of the design layer: the specimen page (engine/style/specimen.ts) in every style, before and after, as
// full-size stills. "Before" reads the older style files from a folder and draws the page the way the first engine
// videos did; "after" uses the style files in styles/ with their roles.
// Usage: node --experimental-strip-types engine/style/proof.ts <outDir> --photo <jpg> --made <jpg> [--before <dir>] [<style> ...]
//        node --experimental-strip-types engine/style/proof.ts <outDir> --surfaces [<style> ...]
// --surfaces renders each bare surface and compares the contrast words really get on it, measured from the pixels
// averaged over a letter stroke, with what design.ts predicts.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { compile } from "../core/compile.ts";
import type { Scene, Theme } from "../core/types.ts";
import { styleNames, themeFrom } from "../render/theme.ts";
import { contrast } from "./color.ts";
import { pageSamples, worst } from "./design.ts";
import { resolveStyle } from "./format.ts";
import { type Pictures, specimen } from "./specimen.ts";

const args = process.argv.slice(2);
const out = resolve(args.shift()!);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1]!;
  args.splice(i, 2);
  return v;
};
const surfaces = args.includes("--surfaces");
if (surfaces) args.splice(args.indexOf("--surfaces"), 1);
const photo = flag("--photo");
const made = flag("--made");
const beforeDir = flag("--before");
const names = args.length ? args : styleNames();
mkdirSync(out, { recursive: true });

const browserExecutable = process.env.BETTERVID_CHROME || null;
const serveUrl = await bundle({ entryPoint: resolve("engine/render/preview.tsx") });
const ctxOf = (theme: Theme) => ({ fps: 30, width: 1080, height: 1920, frames: 2, theme });

async function still(scene: Scene, theme: Theme, file: string) {
  const inputProps = { scene, theme };
  const composition = await selectComposition({ serveUrl, id: "Scene", inputProps, browserExecutable });
  await renderStill({ serveUrl, composition, inputProps, frame: 0, imageFormat: "png", output: file, browserExecutable });
}

const size = (file: string) => {
  const o = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
  return [Number(/pixelWidth: (\d+)/.exec(o)![1]), Number(/pixelHeight: (\d+)/.exec(o)![1])] as const;
};
const dataUri = (file: string) => `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;

if (surfaces) {
  // Each bare surface, averaged over a 7 px box (about a letter stroke at body size), then the lightest and darkest
  // points, against the style's ink. design.ts must never predict better contrast than the pixels give.
  for (const name of names) {
    const theme = themeFrom(name);
    const file = join(out, `${name}-surface.png`);
    await still(compile({ background: "paper", steps: [] }, ctxOf(theme)), theme, file);
    const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-vf", "boxblur=3:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 << 20 });
    let [lo, hi] = [Infinity, -Infinity];
    let [loHex, hiHex] = ["", ""];
    for (let i = 0; i < raw.length; i += 3 * 37) {
      const hex = `#${[raw[i]!, raw[i + 1]!, raw[i + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      const c = contrast(hex, "#000000");
      if (c < lo) [lo, loHex] = [c, hex];
      if (c > hi) [hi, hiHex] = [c, hex];
    }
    const ink = theme.colors.ink!;
    const measured = Math.min(contrast(ink, loHex), contrast(ink, hiHex));
    const predicted = worst([ink], pageSamples(theme.style!, theme.colors));
    console.log(`${name}: ink on the surface measured ${measured.toFixed(2)} (surface ${loHex} to ${hiHex}), predicted ${predicted.toFixed(2)}${predicted > measured * 1.03 ? "  PREDICTION TOO KIND" : ""}`);
  }
} else {
  if (!photo || !made) throw new Error("pass --photo <archival jpg> and --made <generated jpg>");
  const [pw, ph] = size(photo);
  const [mw, mh] = size(made);
  const pics: Pictures = { photo: dataUri(photo), photoW: pw, photoH: ph, made: dataUri(made), madeW: mw, madeH: mh };
  for (const name of names) {
    const after = themeFrom(name);
    const file = JSON.parse(readFileSync(resolve("styles", `${name}.json`), "utf8"));
    await still(compile(specimen(after, "after", pics, file.vignette ?? 0), ctxOf(after)), after, join(out, `${name}-after.png`));
    if (beforeDir) {
      const old = JSON.parse(readFileSync(join(beforeDir, `${name}.json`), "utf8"));
      const style = resolveStyle(old);
      const before: Theme = { colors: { ...old.palette, soft: old.palette.ink }, fonts: { title: style.type.title, body: style.type.body, mono: style.type.mono }, moveFrames: style.motion.frames, ease: style.motion.ease, enter: style.motion.enter, style };
      await still(compile(specimen(before, "before", pics, old.vignette ?? 0), ctxOf(before)), before, join(out, `${name}-before.png`));
    }
    console.log(`${name}: done`);
  }
}
