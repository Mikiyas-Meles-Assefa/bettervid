# S3: which styles Muse Image does well

Date: 2026-10-29. Script: `scripts/spikes/s3-styles.ts`. Images: `media/spikes/s3/` (gitignored), log `media/spikes/logs/s3.log`.

**Verdict: PASS, 5 of 5 styles look professional** (bar: 3 or more). All five can become style files.

## Method
Same scene in every style (a doctor in 1854 London studying a death map clustered around a water pump), `n=2`, 1152x2048, `reasoning_strength: low`, search and shell off, "no text" instruction. Flat illustrated was already covered by S2. Judged by eye on a contact sheet.

| Style | Result |
|---|---|
| Documentary collage | Excellent. Torn paper, white-bordered photo cutouts with shadows, halftone, red marker circles and yellow highlighter exactly as described. The strongest look for the flagship style. |
| Flat illustrated (S2) | Excellent and consistent across 8 shots. |
| Whiteboard | Good. Reads more like pencil sketch than marker, with blue accent arrows as asked. Clean enough for teaching. |
| Anime | Excellent. Film-still quality, warm lamplight, rain outside the window. |
| Retro paper | Good. Mustard, teal and brick on off-white, mid-century shapes, visible print grain. |

## Notes
- No stray text in any of the 8 images; the "no text" line works.
- Both versions of each style differ in composition but keep the look, so `n=2` gives a real choice.
- **Honesty risk in collage:** it invents convincing fake "archival photos" (a Victorian street, a portrait). For history topics the real pipeline should fill those slots with real archival images and SAM cutouts, and label generated ones, or judges may read them as real.
- Latency 15 to 32 s per call, all 4 styles in parallel.

## Cost
- 8 images, $0.08.
