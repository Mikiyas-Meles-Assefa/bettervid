// Stage 7: render the timeline with Remotion. The project folder is the public dir, so asset paths stay relative.
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { Project } from "../../schemas/project.ts";
import { dir, stage } from "../lib/project.ts";

// Spike S7: 4 workers was fastest on the M4 (performance cores); more is slower.
const CONCURRENCY = Number(process.env.RENDER_CONCURRENCY ?? 4);

export async function render(p: Project, force = false) {
  await stage(p, "render", [p.timeline], 0, async () => {
    const t0 = Date.now();
    const serveUrl = await bundle({ entryPoint: resolve("video/index.ts"), publicDir: resolve(dir(p)) });
    const inputProps = { timeline: p.timeline! };
    const composition = await selectComposition({ serveUrl, id: "Bettervid", inputProps });
    let last = 0;
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: "h264",
      imageFormat: "jpeg",
      concurrency: CONCURRENCY,
      outputLocation: join(dir(p), "video.mp4"),
      onProgress: ({ progress }) => {
        if (progress - last >= 0.25) console.log(`  render ${Math.round(progress * 100)}%`), (last = progress);
      },
    });
    p.render = { path: "video.mp4", ms: Date.now() - t0 };
  }, force);
}
