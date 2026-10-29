# S5: can Spark catch planted faults in a test video?

Date: 2026-10-29. Script: `scripts/spikes/s5-critic-faults.ts`. Test video, keyframes and raw critiques: `media/spikes/s5/` (gitignored), log `media/spikes/logs/s5.log`.

**Verdict: PASS.** Watching the MP4, Spark 1.3 caught 5 of 5 planted faults in all 3 runs, with one debatable extra ticket in 1 run. From one keyframe per shot it caught 4 of 5 in all 3 runs (it can't see a long hold from a single frame) with no false alarms. Bar was 4 of 5 with few false alarms.

## Test video
17 s, 1080x1920, 7 shots from the S2 images, slow zoom on every shot except one, caption in a black box at 70% height. Built with Pillow and ffmpeg (no audio).

| Shot | Planted fault |
|---|---|
| 1, 2 | none (control) |
| 3 | wrong visual: shot list says lab, video shows the market crowd |
| 4 | typo: "cholrea" |
| 5 | still image held 5 s with no motion (rule: max 3 s) |
| 6 | character drift: long windblown hair |
| 7 | caption pushed off the right edge |

The critic got the shot list (time range, intended visual, caption), the character spec and the house rules, and had to answer with JSON tickets of a fixed type set.

## Results

| Run | Input | Caught | Extra tickets | Latency | Cost |
|---|---|---|---|---|---|
| 1 | MP4 | 5 of 5 | shot 7 "not the case-closed beat" (my shot list line was vague) | 18 s | $0.012 |
| 1 | keyframes | 4 of 5 (missed the long hold) | none | 6 s | $0.011 |
| 2 | MP4 | 5 of 5 | none | 21 s | $0.012 |
| 2 | keyframes | 4 of 5 | none | 7 s | $0.011 |
| 3 | MP4 | 5 of 5 | same shot 7 note | 27 s | $0.013 |
| 3 | keyframes | 4 of 5 | none | 7 s | $0.012 |

Tickets were specific and usable, e.g. "Caption is cut off as 'The pump han'", "Shot runs 8s to 13s (5 seconds) holding a single still".

## For the pipeline
- Both modes work. Keyframes plus shot list are faster and catch everything except timing faults, which code already enforces (`DECISIONS.md` item 4). Use keyframes as the main critic and the MP4 pass as the extra check, as planned.
- Keep the fixed ticket types; Spark used them exactly. Vague shot list lines invite opinion tickets, so the director should write concrete visual descriptions.
- `effort: low` with `max_output_tokens: 16000` used ~1.1k to 1.4k output tokens. See S10: short clips (here 17 s) are reliable; chunk longer videos.

## Cost
- 6 critic calls plus 2 uploads, about $0.07.
