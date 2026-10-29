// S7: how long does Remotion take to render 60 s at 1080x1920 with cutouts and captions? Local, free.
// Assets come from media/spikes/s7/public (backgrounds, pre-outlined cutouts, grain).
// Usage: npm run spike scripts/spikes/s7-render.ts [concurrency ...]
import { cpus } from "node:os";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const DIR = "media/spikes/s7";
const runs = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [cpus().length];

let t0 = Date.now();
const serveUrl = await bundle({ entryPoint: "video/spike/index.ts", publicDir: `${DIR}/public` });
console.log(JSON.stringify({ step: "bundle", ms: Date.now() - t0 }));

const composition = await selectComposition({ serveUrl, id: "S7Test" });
for (const concurrency of runs) {
  t0 = Date.now();
  let last = 0;
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    outputLocation: `${DIR}/s7-c${concurrency}.mp4`,
    concurrency,
    imageFormat: "jpeg",
    onProgress: ({ progress }) => {
      if (progress - last >= 0.25) console.error(`c${concurrency} ${Math.round(progress * 100)}% at ${((Date.now() - t0) / 1000).toFixed(0)} s`), (last = progress);
    },
  });
  const secs = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ step: "render", concurrency, frames: composition.durationInFrames, secs: +secs.toFixed(1), fps: +(composition.durationInFrames / secs).toFixed(1) }));
}
