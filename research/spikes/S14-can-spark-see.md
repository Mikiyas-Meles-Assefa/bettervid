# S14: can Spark see what is wrong in a frame?

Date: 2026-11-02. Code: `scripts/spikes/s14-*.ts` (frame set, runner, tables, engine measures), `pipeline/lib/look.ts`, the look step in `pipeline/stages/scene.ts`, `scripts/look-run.ts`. Frames and raw replies: `media/spikes/s14/` (gitignored). Spend: see the end.

**Verdict: PARTIAL, so the look step no longer rests on Spark's eyes alone.** Spark reliably sees some faults (writing on writing, a pale card with pale writing, text cut by the edge, a photo cropped to sand) and reliably misses others (a frame dimmed to grey, writing too small, a stretch of empty frame, a design the user calls ugly). Image size makes no difference. Showing Spark the scene it wrote, with several frames in one call, which is what the old look step did, is the worst setup tried: recall 0.39, and it scored the frames as fine. The things Spark misses are exactly the things the engine can measure, so the new look step measures them and gives Spark the numbers.

## Test set

26 frames from the three reviewed engine videos (`docs/reviews/2026-11-02-three-videos.md`), 20 with problems labelled by hand from the review and a frame-by-frame look, and 6 clean controls. 36 labelled problems in 12 kinds (`scripts/spikes/s14-frames.ts`). Every call got the topic, the style name, the research facts, the narration before the frame and the words being said at it.

A labelled problem counts as caught when Spark names its kind or a close one (faint and washed out count for each other; a cropped-out subject counts as a wrong or broken picture; words that contradict the narration and unsupported facts count for each other; "ugly" is also caught by a design score of 2 or less). "Empty space" is in nearly every frame of these videos, so naming it is never counted against Spark.

## Conditions

| Condition | What Spark gets |
|---|---|
| small | one frame at 432 px wide (the old look step's 0.4 scale), plain reviewer framing |
| full | one frame at 1080 px wide, plain framing |
| fullDemanding | one frame at 1080 px, framed as a demanding designer and teacher, told to read every region and every word |
| batchSmallSource | up to 5 frames of one video in one call at 432 px, with the scene text written for them: the closest to the old look step |
| batchFullDemanding | up to 5 frames in one call at 1080 px, demanding framing, no scene text |

The sequence condition (three frames 1.2 s apart) and the checklist framing were written but not run, to stay within the cap; the batch results already answer whether more frames per call help.

## Results

| Condition | Recall | Caught / labelled | Kinds named that were not labelled | Clean frames passed | Design score: collage / chalkboard / neon | Cost |
|---|---|---|---|---|---|---|
| small | 0.56 | 20 / 36 | 29 | 4 / 6 | 2.5 / 3.1 / 3.4 | $0.31 |
| full | 0.53 | 19 / 36 | 23 | 2 / 6 | 2.7 / 3.3 / 3.3 | $0.35 |
| fullDemanding | 0.56 | 15 / 27 | 21 | 2 / 2 | 2.5 / 3.0 / not run | $0.29 |
| batchSmallSource | 0.39 | 14 / 36 | 9 | 5 / 6 | 3.0 / 3.4 / 3.4 | $0.14 |
| batchFullDemanding | 0.50 | 14 / 28 | 11 | 5 / 5 | 2.6 / 3.1 / 3.3 | $0.14 |

fullDemanding and batchFullDemanding stopped at the spending cap, so they cover 20 and 22 frames.

By kind (caught / labelled frames, per condition in the order above):

| Kind | small | full | fullDemanding | batchSmallSource | batchFullDemanding |
|---|---|---|---|---|---|
| writing on writing or on a busy photo | 5/6 | 5/6 | 4/5 | 4/6 | 5/6 |
| subject cropped out of a photo | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| cut by the frame edge | 1/1 | 1/1 | 1/1 | 1/1 | not run |
| faint writing | 3/6 | 3/6 | 2/3 | 3/6 | 3/6 |
| washed out, dimmed | 2/4 | 2/4 | 1/1 | 2/4 | 2/4 |
| too small | 1/3 | 1/3 | 0/1 | 0/3 | 0/3 |
| empty space | 1/3 | 1/3 | 2/3 | 0/3 | 1/2 |
| blank card, mark at nothing | 1/2 | 1/2 | 0/2 | 1/2 | not run |
| label says other than the words | 1/2 | 1/2 | 0/2 | 1/2 | not run |
| wrong or unsourced fact, notation | 1/2 | 0/2 | 1/2 | 0/2 | 1/1 |
| wrong picture | 1/2 | 1/2 | 1/2 | 0/2 | 0/1 |
| ugly (design) | 2/4 | 2/4 | 2/4 | 1/4 | 1/4 |

What the numbers mean, frame by frame:
- **Seen every time:** the cream card on the blackboard with near-invisible writing (`s-cream`, 5 of 5, design score 1 or 2), captions written over each other (`m-tradeoff`, 5 of 5), the photo cropped to sand (`w-sand`, 5 of 5), the title cut off (`w-cutoff`, 4 of 4).
- **Never seen:** the neon frame dimmed to grey (`m-grey`, 0 of 4, "glowing blue title ... stand out clearly", design 4), the dimmed waiting boxes with tiny pointers (`m-faded`, 0 of 4), the table shrunk into the top of the frame (`s-tiny`, 0 of 5, design 4).
- **Seen but misnamed:** on the blank card with a ring around empty sky (`w-ring`), Spark wrote that the card "is mostly blank" but filed it as empty space, and never noticed that the label names the 1902 glider while the 1903 Flyer is spoken. Grading by kind undercounts these a little.
- **Facts:** the sample formula with x where x-bar belongs was caught in 2 of 5 runs; the table of lift numbers with no source in 1 of 4. Spark checks facts when it happens to read the writing; it does not do it reliably from pixels.
- **Design:** the collage frames score 2.5 to 3.0 on average against 3.0 to 3.4 for the other two styles, the right order but a small gap, and single collage frames the user disliked (red serif text over an engine photo, a clip-art icon on a beige page) score 4: "clean minimal card, clear hierarchy". Spark's taste is not the user's bar.
- **False alarms:** one frame per call flags something on 2 to 4 of the 6 clean frames (mostly "too small", often about the tiny source line, and "says other than the words" on frames that were mid-sentence). Batched calls are quieter: 0 or 1 clean frame flagged, but they also catch less.

## Why the old look step passed nearly everything

1. **It showed Spark its own scene.** With the scene text beside the frames (batchSmallSource), Spark judges what the scene says rather than what the frame shows: lowest recall (0.39) and the highest design scores. The old step also used the scene writer's system prompt, so the reviewer was the author.
2. **Judging and rewriting were one answer.** The reply was either FINE or a whole new part. In the collage run every section came back changed twice: a rewrite was the only way to say anything, and nothing checked whether the rewrite was better.
3. **The faults it missed are the ones Spark cannot see.** Dimming, small writing and empty frame are invisible to Spark at any size here. Bigger frames did not help (0.53 at 1080 px against 0.56 at 432 px).

## What the engine measures instead

The engine knows where every visible thing is on a frame and its fade, so some faults need no pixels at all (`measureLayout` in `pipeline/lib/look.ts`): writing over other writing, writing cut by the frame edge, writing below the style's readable size, a picture under an opaque shape painted after it, how much of the usable frame is empty and the largest empty band, and how much of what is on screen is dimmed.

Contrast needs pixels, because a style's pen can draw a fill differently from its theme color (the chalk pen draws `back=paper` as a pale fill). So each frame is rendered three times: as is, with every word hidden, and with every word and picture hidden (`measurePixels`). Where the first two differ are the words' own pixels; the second render shows exactly what is behind them. That gives a real contrast ratio per piece of writing, whether writing is visible at all, whether it sits on a busy background, and whether a picture shows.

Run on today's builds of the reviewed sections with no model calls (`scripts/spikes/s14-measure.ts`), it reports the faults Spark missed, with numbers:
- the cream table card in the standard deviation video: "Data" 1.5:1, "-2" 1.1:1, every value about 1.5:1, on every frame of that section;
- the dimmed table that follows: "87% of what is on screen is dimmed or faded";
- a title written over the data table as it arrives: "Say your sample is..." and "Data", 50% of the smaller box;
- a list of five numbers alone on the board: "9% of the usable frame has anything in it";
- in merge sort, four boxes alone: "15% of the usable frame has anything in it; the largest empty band is 50% of its height".

On frames caught while things change, what is fading in or out is not judged as faint, dimmed or empty, because a fade-in is not a fault; writing on writing still counts there, as it is the "old text fading under new text" fault from the review.

## The new look step

In `pipeline/stages/scene.ts`, using `pipeline/lib/look.ts` and `prompts/scene-look.md`:
1. **Frames:** each state seen settled (just before the next begins) and some changes seen while they happen, up to 10 per section, at 648 by 1152. Each frame goes with the words around it, the exact writing on screen from the scene (so nothing depends on reading pixels), and what was measured on it.
2. **Judge:** a separate reviewer prompt, not the scene writer's, without the scene text. It judges readability, whether pictures and marks work, the writing against the words being said and the research facts (and the engine's computed steps), timing, use of space, and design. It returns issues with frames, what is wrong, what should be true instead, and a severity, plus a design score. Measured findings of severity 2 or more join the list as issues.
3. **Fix only what was named:** the writer gets the numbered part, the issues and the frames they name, and returns the part with only those changed. It is built and repaired as usual.
4. **Keep it only if it is better:** the changed version is measured and judged again; the recheck says per issue whether it is fixed and lists anything new, and which version is better. The fix is kept only if the measured weight did not rise, the total fell, nothing new is severe, and the recheck does not prefer the old version.
5. **Stop:** a part with no issues is never rewritten. After a kept fix, a second round runs only if a severe issue is still open, starting from the recheck instead of judging afresh. A rejected fix ends the look.

The critic stage now judges engine videos the same way on the final render, three settled frames per section with layout measures, and files notes per section. It does not re-render.

## Runs on copied projects

`scripts/look-run.ts` runs the new look on sections already written, with no rewriting from scratch.

- **Standard deviation, s6 (the cream table card):** the judge gave design 2 of 5 ("the pale panel behind the table ... makes the table unreadable") and named one issue; the measures added the contrast finding ("Data" 1.4:1, "x - mean" 1.3:1, values 1.2:1). The fix removed `back=soft` from the table on its 7 states and changed nothing else. Recheck: both issues fixed, no new issue, design 4 of 5, prefers the change. Measured weight 30 to 0, seen 3 to 0. Kept, and the look stopped after one round. $0.099. Frames: `projects/<id>/scene/s6/look1/shown` (before) and `look1b/shown` (after), copied projects only.
- **Standard deviation, s8 (table dimmed to 87%):** settled in one round. The judge named nothing itself; the 4 issues came from the measurements (87% dimmed, an "=" at 2.0:1, writing over writing mid-change, empty space). Measured weight 8 to 1, kept, $0.111.
- **Merge sort, s6 (title and notes at about 1.2:1, heavily dimmed):** 13 issues, design 2/5. Round 1 kept (measured 45 to 27, seen 12 to 4, after one build repair); round 2 changed nothing measurable and seen problems rose from 4 to 5, so it was rejected and the look stopped, $0.242. Still open: content in the top third, the two halves not shown as groups, a pointer emoji at 1.1:1.
- **Merge sort, s2:** started at design 3/5 with 4 issues (pink text on bright boxes at 2.5:1); the run reached its spending cap before an outcome was logged.

| Section | Rounds | Measured | Seen | Result | Cost |
|---|---|---|---|---|---|
| Stats s6 | 1 | 30 to 0 | 3 to 0 | kept | $0.099 |
| Stats s8 | 1 | 8 to 1 | 0 to 0 | kept | $0.111 |
| Merge s6 | 2 | 45 to 27 | 12 to 4 | round 1 kept, round 2 rejected | $0.242 |

Logs: `media/spikes/s14/look-stats.log`, `media/spikes/s14/look-merge.log`; results in each project's `scene/look-run.json`.

## Spend

$1.33 of Meta when this was written (spike $1.23, look runs so far $0.10), logged in `media/spikes/s14/runs/spend.jsonl`. The two runs still going are capped at $0.25 and $0.30, so the total stays under $2.
