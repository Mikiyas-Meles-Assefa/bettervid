# S2: one character and style across 8 shots

Date: 2026-10-29. Script: `scripts/spikes/s2-consistency.ts`. Images: `media/spikes/s2/` (gitignored), log `media/spikes/logs/s2.log`.

**Verdict: PASS.** With the anchor attached through `/images/edits`, 7 of 7 shots show the same person in the same style. One shot drifted on hair, and Spark's continuity check caught it without help. 7 parallel edits finish in ~31 s wall time.

## Method
- Anchor: `/images/generations`, flat explainer style, full-body character sheet of "Dr. Ama" (short natural hair, round gold glasses, orange turtleneck, teal lab coat, water-drop pendant), cream background.
- 7 shots fired in parallel to `/images/edits` with the anchor as the reference, each prompt repeating the character and style text plus a scene (night street with lantern, close-up with magnifier, lab bench, from behind at a map, running on a bridge, at a desk, tiny in a market crowd).
- Judge: Spark 1.3, effort low, all 8 images as 576x1024 JPEGs, asked for per-image `same_person`, `drift`, `style_match`, `stray_text`.

## Results
- My own look: the face, glasses, coat, turtleneck, pendant and palette all hold, including the back view and the crowd shot. Only shot 5 (running in the rain) drifts: long windblown hair instead of short.
- Spark judge: same person in all 7; style match 8 to 9; flagged shot 5's hair as the only major drift, and noted the larger pendant in the close-up. No stray text found.
- "Absolutely no text, letters, numbers or captions" held in all 8 images, which answers the S1 worry.

## API findings
- `/images/edits` is multipart. Reference images go in as `image[0]`, `image[1]`, ... (`image[]` is rejected). Object fields must be JSON strings. Helper: `metaEdit` in `scripts/lib/meta.ts`.
- Turning off search and shell: send `tool_enablement: { enable_web_search, enable_image_search, enable_shell }`. Top-level `enable_web_search` is rejected with a 400.
- Output stays 1152x2048 with the anchor attached.
- A Responses request with ~29 MB of inline images gets `413 payload_too_large` under the default `store=true`. Send `store: false` and downscaled JPEGs, or use the Files API.

## For the pipeline
- Anchor first, then fan out edits in parallel (as `DECISIONS.md` item 6 says). Run the Spark continuity check on every batch and regenerate any shot it flags; action shots (wind, motion) are where drift shows up.

## Cost
- 8 images ($0.08) plus one judge call (6.4k in, 1.1k out, ~$0.013). About $0.09.
