// Contact sheets: the finalists of a moment side by side, so an agent (the designer after a round, the viewer panel)
// looks at the candidates instead of only reading numbers. One row per candidate, labelled with its id, its label and
// its total miss; one column per keyframe of the moment's window (the onset, the middle, the settled end, or as many as
// the caller asks), labelled with the time from the window's start.
//
// Rendering is behind a small interface (StillRenderer), so the search can run with no browser at all (tests, a CI
// without Chrome) and a host can render however it renders. remotionStills renders with the engine's own preview
// composition at a small scale; composeSheet joins the stills with Pillow (PYTHON, as the bench's sheets do) and the
// stills are deleted once the sheet is written.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Scene, Theme } from "../../core/types.ts";

export interface StillRenderer {
  /** Renders the given frames of a scene to JPEG files under `dir`; returns their paths in the order of `frames`. */
  stills(scene: Scene, frames: number[], dir: string, tag: string): Promise<string[]>;
}

/** `n` frames spread over a window: the first a little after the onset, the last just before the window ends. */
export function sheetFrames(window: [number, number], n: number): number[] {
  const [a, b] = window;
  const len = Math.max(1, b - a);
  if (n <= 1) return [Math.min(b - 1, a + Math.floor(len / 2))];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.min(b - 1, a + Math.round(((i + 0.5) * len) / n)));
  out[n - 1] = Math.max(a, b - 1);
  return [...new Set(out)];
}

export type SheetRow = { label: string; files: string[] };
/** How stills become a sheet: Pillow by default; a host may join them its own way. */
export type SheetOptions = { python?: string; cell?: number; join?: (rows: SheetRow[], times: string[], out: string, o: { python?: string; cell?: number }) => string };

/** Joins rows of stills into one labelled JPEG with Pillow. Column labels are the times given. */
export function composeSheet(rows: SheetRow[], times: string[], out: string, o: { python?: string; cell?: number } = {}): string {
  const python = o.python ?? process.env.PYTHON ?? "python3";
  const code = `
import json, sys
from PIL import Image, ImageDraw
rows, times, out, cw = json.loads(sys.argv[1]), json.loads(sys.argv[2]), sys.argv[3], int(sys.argv[4])
first = Image.open(rows[0]["files"][0])
ch = round(first.size[1] * cw / first.size[0])
lab = 18
n = max(len(r["files"]) for r in rows)
sheet = Image.new("RGB", (cw * n, (ch + lab) * len(rows) + lab), "white")
d = ImageDraw.Draw(sheet)
for i, t in enumerate(times[:n]):
    d.text((cw * i + 4, 3), t, fill="gray")
for r, row in enumerate(rows):
    y = lab + r * (ch + lab)
    d.text((4, y + 3), row["label"], fill="black")
    for i, f in enumerate(row["files"]):
        sheet.paste(Image.open(f).convert("RGB").resize((cw, ch)), (cw * i, y + lab))
sheet.save(out, quality=80)
`;
  mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync(python, ["-I", "-c", code, JSON.stringify(rows), JSON.stringify(times), out, String(o.cell ?? 180)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`sheet: ${(r.stderr || r.error?.message || "").slice(0, 300)}`);
  return out;
}

/**
 * Stills with the engine's preview composition (engine/render/preview.tsx) through Remotion, bundled once per process.
 * `scale` sizes the stills against the scene's frame (0.2 of 1080x1920 is 216x384). A bundle is about 200 MB: with
 * `bundleDir` it is written there once and reused by later runs; without it, it is deleted when the process exits.
 */
export function remotionStills(o: { theme: Theme; scale: number; chrome?: string; bundleDir?: string }): StillRenderer {
  let served: Promise<string> | undefined;
  const browserExecutable = o.chrome ?? process.env.BETTERVID_CHROME;
  return {
    async stills(scene, frames, dir, tag) {
      const { bundle } = await import("@remotion/bundler");
      const { renderStill, selectComposition } = await import("@remotion/renderer");
      served ??= (async () => {
        if (o.bundleDir && existsSync(join(o.bundleDir, "index.html"))) return o.bundleDir;
        const url = await bundle({ entryPoint: resolve(import.meta.dirname, "../../render/preview.tsx"), ...(o.bundleDir ? { outDir: o.bundleDir } : {}) });
        if (!o.bundleDir) process.on("exit", () => rmSync(url, { recursive: true, force: true }));
        return url;
      })();
      const serveUrl = await served;
      const inputProps = { scene, theme: o.theme };
      const composition = await selectComposition({ serveUrl, id: "Scene", inputProps, browserExecutable });
      mkdirSync(dir, { recursive: true });
      const out: string[] = [];
      for (const f of frames) {
        const file = join(dir, `${tag}-${String(f).padStart(5, "0")}.jpg`);
        await renderStill({ serveUrl, composition, inputProps, frame: Math.min(f, scene.frames - 1), imageFormat: "jpeg", jpegQuality: 70, scale: o.scale, browserExecutable, chromiumOptions: { gl: "angle" }, output: file });
        out.push(file);
      }
      return out;
    },
  };
}

/**
 * A contact sheet of candidates' scenes over one window: renders each scene's keyframes, joins them, deletes the
 * stills. Returns the sheet's path. `fps` labels the columns in seconds from the window's start.
 */
export async function candidateSheet(rows: { label: string; scene: Scene }[], window: [number, number], frames: number, fps: number, out: string, r: StillRenderer, o: SheetOptions = {}): Promise<string> {
  const picks = sheetFrames(window, frames);
  const tmp = `${out}.stills`;
  try {
    const files: SheetRow[] = [];
    for (const [i, row] of rows.entries()) files.push({ label: row.label, files: await r.stills(row.scene, picks, tmp, `r${i}`) });
    return (o.join ?? composeSheet)(files, picks.map((f) => `+${((f - window[0]) / fps).toFixed(1)} s`), out, o);
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  }
}
