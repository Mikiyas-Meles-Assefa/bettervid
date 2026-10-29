# S1: Muse Image true 9:16

Date: 2026-10-29. Script: `scripts/spikes/s1-muse-image-916.ts`. Raw output: `media/spikes/s1/` (gitignored), log `media/spikes/logs/s1.log`.

**Verdict: PASS.** Muse Image returns an exact 9:16 frame at 1152x2048 (ratio 0.5625). Request `1152x2048` (or `1080x1920`, which snaps to the same) and downscale to 1080x1920 in the render.

## Inputs
- `muse-image-1.0`, `n: 1`, `response_format: b64_json`, `output_format: png`, `reasoning_strength: low`.
- Prompt: Victorian London street map from 1854 on aged paper, red circle around Broad Street, halftone, film grain, full bleed, no borders.
- Sizes requested: `1080x1920`, `1152x2048`, `1024x1792`.

## Outputs

| Requested | Returned | Ratio | Latency |
|---|---|---|---|
| 1080x1920 | 1152x2048 | 0.5625 (exact 9:16) | 25.3 s |
| 1152x2048 | 1152x2048 | 0.5625 (exact 9:16) | 17.7 s |
| 1024x1792 | 1152x2016 | 0.5714 (4:7, 1.6% too wide) | 14.7 s |

- The `size` value is snapped to a supported size, not rejected. Don't ask for 1024x1792: it comes back 4:7 and would need a crop.
- No `revised_prompt` in the response.
- `usage` is reported (about 4,044 input and 1,500 output tokens per image), but the published price is a flat $0.01 per image.

## Quality notes
- Very strong for the documentary collage look: aged paper, halftone, legible street names, the red circle where asked. Full bleed was respected.
- **It adds text nobody asked for:** titles, legends, newspaper headers, and invented facts ("127 deaths reported in 3 days", "500+ cases"). Some are right (pump handle removed 8 Sep 1854), others are made up. The pipeline owns typography and facts, so every image prompt must say "no text, no lettering, no captions" unless text in the image is the point, and the critic should flag stray text. Test whether a negative instruction actually works in S2/S3.
- The S9 posters show the same habit ("WATER PUMP" titles on all 5).

## Cost and timing
- 3 images, $0.03. 15 to 25 s each at `reasoning_strength: low`, so generate images in parallel, not in a chain.
