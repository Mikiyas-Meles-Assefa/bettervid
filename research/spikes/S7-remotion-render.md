# S7: Remotion render time for 60 s at 1080x1920

Date: 2026-10-29. Composition: `video/spike/` (`S7Test.tsx`). Script: `scripts/spikes/s7-render.ts`. Assets and outputs: `media/spikes/s7/` (gitignored), log `media/spikes/logs/s7.log`.

**Verdict: PASS.** A 60 s, 1080x1920, 30 fps video with cutouts, word-pop captions, transitions, grain and vignette renders in **~100 s** on the dev Mac (Apple M4, 4 performance + 6 efficiency cores, 16 GB). Bar was under 3 minutes.

## Setup
- Remotion 4.0.539 (`remotion`, `@remotion/bundler`, `@remotion/renderer`, `@remotion/transitions`), React 19. First render downloads Chrome Headless Shell 157 (171 MB) once.
- Composition: 12 shots of ~5 s. Each has a full-frame JPEG background (S2/S3 images) with a slow zoom, a SAM cutout (S4) that springs in from the side, and 3-word caption pages (Arial Black, 96 px, black stroke, active word yellow, spring pop per word). Shots alternate slide and fade transitions (12 frames). A vignette gradient and a moving grain PNG (overlay blend) sit on top of everything.
- Cutout outline and shadow are baked into the PNG with Pillow beforehand (plan item 7), not CSS filters.
- `renderMedia`, `codec: h264`, `imageFormat: jpeg`. Output 60.0 s, 46 MB.

## Results

| Concurrency | Render time | Frames/s |
|---|---|---|
| 4 | 101.5 s | 17.7 |
| 5 | 103.8 s | 17.3 |
| 7 | 104.4 s | 17.2 |
| 10 (default, all cores) | 118.2 s | 15.2 |

- Bundling takes 6.6 s cold, 1.3 s warm.
- Speed levels off at about the number of performance cores. Using all 10 is slower. Max allowed concurrency is the core count.
- Frames checked by eye: zoom, outlined cutouts, caption pops, transitions and grain all render correctly.

## For the pipeline and hosting
- Local render on the dev Mac is fine for the gallery and the demo: ~100 s per 60 s video, so a 30 s video is ~50 s.
- For a hosted demo, a machine with 8+ fast cores, or chunked rendering across a few Modal containers (Remotion `frameRange` per chunk plus ffmpeg concat), should get 60 s under a minute. Not tested here.
- The critic's fix round should re-render only the changed shots' frame ranges.
- Layout lesson: a cutout's white outline crossed behind the caption and read like a strikethrough. Caption safe zones must keep cutouts out (or captions get their own backing).
- Heavier effects (CSS blur, `@remotion/effects`, video clips inside the frame) were not tested and will cost more.

## Cost
- Free (local).
