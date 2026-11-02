// Stage 7: render the timeline with Remotion. The project folder is the public dir, so asset paths stay relative.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { Project, Timeline } from "../../schemas/project.ts";
import { dir, stage } from "../lib/project.ts";

// H.264 quality: 18 (the default) made a 5:40 video 378 MB. 23 is the usual choice for video on the web.
const CRF = Number(process.env.RENDER_CRF ?? 23);
// Spike S7: 4 workers was fastest on the M4 (performance cores); more is slower.
const CONCURRENCY = Number(process.env.RENDER_CONCURRENCY ?? 4);

// What the composition gets. Remotion hands the props to the page for every frame, so their size costs on every frame:
// a 1.8 MB scene (6 minutes) rendered at 18 frames/s against 27 for the same frames with small props. Each engine
// scene goes into a JSON file in the project folder instead, and the player loads it once per browser tab.
export function playerProps(p: Project): { timeline: Timeline; scenes: Record<string, string> } {
  const scenes: Record<string, string> = {};
  const clips = p.timeline!.clips.map((c) => {
    if (c.type !== "engine" || !c.scene) return c;
    const file = `engine-${c.shotId.replace(/[^\w-]/g, "_")}.json`;
    writeFileSync(join(dir(p), file), JSON.stringify(c.scene));
    scenes[c.shotId] = file;
    const { scene: _, ...rest } = c;
    return rest;
  });
  return { timeline: { ...p.timeline!, clips }, scenes };
}

export async function render(p: Project, force = false) {
  await stage(p, "render", [p.timeline], 0, async () => {
    const t0 = Date.now();
    const serveUrl = await bundle({ entryPoint: resolve("video/index.ts"), publicDir: resolve(dir(p)) });
    const inputProps = playerProps(p);
    // A Chrome to use instead of the one Remotion downloads, e.g. a shared chrome-headless-shell for worktrees.
    const browserExecutable = process.env.BETTERVID_CHROME || null;
    const composition = await selectComposition({ serveUrl, id: "Bettervid", inputProps, browserExecutable });
    let last = 0;
    const t1 = Date.now();
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      browserExecutable,
      codec: "h264",
      crf: CRF,
      imageFormat: "jpeg",
      concurrency: CONCURRENCY,
      outputLocation: join(dir(p), "video.mp4"),
      onProgress: ({ progress }) => {
        if (progress - last >= 0.25) console.log(`  render ${Math.round(progress * 100)}%`), (last = progress);
      },
    });
    const seconds = (Date.now() - t1) / 1000;
    console.log(`  render: ${composition.durationInFrames} frames in ${seconds.toFixed(0)} s, ${(composition.durationInFrames / seconds).toFixed(1)} frames/s at concurrency ${CONCURRENCY}, props ${(JSON.stringify(inputProps).length / 1024).toFixed(0)} KB`);
    p.render = { path: "video.mp4", ms: Date.now() - t0 };
  }, force);
}
