# S12: Manim as an optional animation source

Date: 2026-11-02. Code: `scripts/manim/`. Outputs (scratch, not in the repo): `/private/tmp/claude-501/-Users-miki-Desktop-deskt-bettervid/6b1d4f4c-132f-4335-951d-2d8ba79fa07c/scratchpad/`, with `final/` for samples and `run/` for scenes, sheets and logs.

## Verdict

**Use Manim as an optional clip source, for shots where something must move by rule (math, graphs, mechanisms, algorithms). Do not make it the engine, and do not ship it without a frame review step.**

The pipeline works end to end: Spark wrote scenes on its own, the same scene rendered in three styles with no code change, cues hit their spoken words, and the clip sits under our captions in Remotion. The weak point is quality control, not rendering. Passing the automatic checks did not mean a clip was right, and Spark's frame review found real faults but its repairs made 2 of 4 clips worse. A person picked the final scenes in this test. Without that, about 3 of 5 clips would have been good.

## Results

| Requirement | Result |
|---|---|
| Spark writes the scene | Done. 5 briefs. Each concept was Spark's choice: pendulum with energy bars, tangent sliding on a curve, swapping boxes, lock cross section, matrix column swap |
| Look from `styles/*.json` | Done. Every accepted scene rendered in flat, collage and whiteboard: 15 of 15, no scene changes |
| Changes on spoken words | Done. See Sync |
| 1080x1920, 30 fps, in Remotion | Done. All three samples checked with ffprobe: 1080x1920, 30/1, 14.67 s, with audio, captions, vignette, grain |
| Repair on crash, 3 tries at most | Done. See Success rate |
| Speed and hosting | Measured, with a caveat. See Speed |

## Success rate

Five unrelated briefs: Cramer's rule column swap (real recorded word times), derivative of a curve, pendulum energy, quicksort partition, pin tumbler lock (synthetic word times at speech pace).

Generation, from the earlier run, which this test reuses:

| Brief | Tries | Outcome by try |
|---|---|---|
| function-graph | 1 | clean |
| matrix-column | 2 | layout problems, clean |
| quicksort-partition | 2 | layout problems, clean |
| pin-tumbler-lock | 2 | layout problems, clean |
| pendulum-energy | 3 | crash, layout problems, clean |

- 5 of 5 passed every automatic check within 3 tries. 1 of 5 passed on the first try.
- 1 crash in 10 tries (a variable used before it was set). Spark fixed it on the next try.
- 8 later repair renders produced no crashes.

Judged from extracted frames, the clips that passed the checks were not all sound:

| Brief | After automatic checks | After frame review and repair | Used |
|---|---|---|---|
| matrix-column | Broken: the matrix being changed never appears, so the highlight sits on nothing | Review found no faults (it missed this). A new general check found it, one repair fixed it | Repaired |
| pendulum-energy | Broken: speed bar looks full throughout, a block covers the labels at the end | Good: height and speed trade correctly | Repaired |
| pin-tumbler-lock | Usable: springs cross a label, key overlaps | Better: label moved out, diagram cleaner | Repaired |
| quicksort-partition | Good, one brief overlap during the swap | Worse: a dark block hides the pivot value | Original |
| function-graph | Good, small overlap at the bottom, tangent runs off frame at the end | Worse: curve pushed off the right edge, the point disappears | Original |

So checks alone gave 3 of 5 usable clips. Review and repair applied blindly gave 2 of 5, or 3 of 5 with the new invisible-object check. Choosing the better version of each gave 5 of 5, but a person made that choice here. The 3 clips that ran the full loop still had faults listed at the end, and the pendulum's second review was cut off by its output limit, so Spark's verdict cannot make the choice yet. A repair often fixes the named fault and breaks something else.

Remaining flaws in the used clips, all seen in frames:
- Spark tends to crowd the top half and leave the lower half empty.
- In the Cramer clip, the highlight is nearly opaque and mostly hides the column it points at.
- Cross-fading titles overlap for a few frames.

## Sync

Word times arrive as data (`BV_WORDS`). A scene calls `self.at(i)`, which waits until word `i` starts. Timing lives outside the scene code, so a re-record only needs a re-render.

- Scene clock: on the Cramer clip every cue fires on its word, 0 late, in all styles.
- From pixels, over 165 cues across all 15 renders (`measure.py`, first frame that changes near a cue): mean error 0.10 s, worst 0.41 s. 97 cues (59%) within 100 ms, 57 (35%) within one frame. 11 cues had no change near them, which means Spark's scene called the cue and then drew nothing yet.
- On the Cramer clip, mean error is 0.11 to 0.14 s, worst 0.28 s.

Most of the error is not a real delay. Manim's easing starts slowly, so the first visible change comes about 0.1 s after the animation begins. The worst values are negative: an earlier animation was still running when the measuring window opened. The eye reads this as on the word. A cue can be up to 0.3 s late before the check rejects it.

## How themes work

`bv.py` loads the style and a scene does `from bv import *`:
- `PAPER`, `INK`, `ACCENT`, `HIGHLIGHT` come from `palette`. Lint rejects color names, hex values and font names in generated code.
- Every Manim class that has its own default color is rewritten at import to use `INK` or `ACCENT`, so nothing falls back to Manim's look.
- `Text` uses `fonts.body`, and `FONT_TITLE` is available.
- `hand.weight` sets stroke width. `hand.wobble` now bends large shapes at draw time, in the camera, so scenes do not know about it. Glyphs stay crisp.
- Vignette, grain and captions come from the Remotion layer, as in `video/Video.tsx`.

Limits:
- LaTeX follows only the family (Computer Modern serif or sans), so math does not match Georgia or Marker Felt exactly.
- Text width changes with the font, so a layout that is clean in one style can fail in another. 1 of 15 renders hit this (Cramer in collage: a `D` overlaps in the last moments). A real run must check layout in the target style. Generation here always checked in flat.
- A scene is flat vector shapes. Image styles such as collage get palette and type, not cut paper or photo texture. Collage reads as a tinted diagram, which is fine for a diagram shot and would not pass as collage itself.

## Speed and hosting

The machine was busy (load average 18 to 40 on 10 cores, another agent running), so the numbers below are upper bounds and are not a fair match with the 1.4 figure.

| Step | Seconds per video second |
|---|---|
| Our engine (earlier figure) | about 1.4 |
| Manim, one clip at a time, 3 styles | 0.54 to 0.77 |
| Manim, earlier scene runs | about 0.3 to 0.8 |
| Manim, 3 parallel jobs at load 40 | mean 2.2, range 1.0 to 5.1 |
| Remotion composite of the clip, concurrency 4 | 3.5 to 4.3 |

Manim itself is faster than the engine figure. A Manim clip still goes through Remotion, so it adds time rather than replacing it, but only for its own seconds. The composite figure needs a retest on an idle machine: `OffthreadVideo` plus a full-frame grain layer may be slow, or it may just be the load. Bundling once per video, not once per style as this test does, saves some of it.

Hosting needs on top of the current `Dockerfile`, which has none of this:
- Python 3 with Manim 0.21 (74 MB here), plus Cairo, Pango and fonts for every style. Marker Felt and Georgia must exist on Linux or be replaced in the style.
- LaTeX with `amsmath`, `sansmath` and real `dvisvgm` (398 MB here for BasicTeX). `bin/dvisvgm` is a local stand-in for this machine, not for hosting. Expect the image to grow by about 500 MB to 1 GB; this is an estimate, no image was built.
- CPU: Manim uses one core per clip.
- A sandbox. Generated Python runs on the server. Lint plus a clean environment (no keys) is enough for a test only. Production needs a container with no network, a time limit and a memory limit.

## Cost per clip

Spark at low effort.

| Item | Cost |
|---|---|
| Write one try | about $0.02 |
| Clip through automatic checks (5 briefs) | $0.021 to $0.056, mean $0.040 |
| One frame review | about $0.013 |
| One repair | about $0.018 |
| Clip with full review loop | about $0.11 |

Total spend on Meta for this test: **$0.563** of the $1.00 limit.
- Earlier run: $0.261 (13 calls, from its ledger). The first attempt before it made no Meta calls (checked in its transcript).
- This run: $0.302, of which $0.0135 is an estimate: one review call hit its output limit and the helper threw before the cost was recorded.

## What integration would take

1. A new `manim` shot type. The director picks it for shots where motion carries the idea.
2. A stage that writes the scene, runs lint and checks, renders in the target style, and stores the clip as an asset. The loop already exists in `generate.ts`.
3. A frame review that compares versions and keeps the best one. Repairing and trusting the last one, as `review.ts` does, is the part that failed.
4. Move the composition from `remotion/Root.tsx` into the shot list, or into the new `engine/`.
5. When Manim fails or nothing passes, the shot goes back to Spark for repair, then to the director to choose another shot type.
6. The hosting and sandbox work above.

About 1 to 2 days of work, of which hosting and the sandbox are the riskiest. Given the Nov 4 deadline, this should come after the engine. Nothing in the engine has to wait for it, because a clip is just a video file on the timeline.

## Added in this run

- `bv.py`: `hand.wobble`, and a check for a `FadeIn` that leaves its target invisible. That check is general and caught the Cramer fault.
- `review.ts`: frame review and repair.
- `matrix.ts`: every scene in one style, measured.
- `lib.ts`: shared `code` and `askFor`.

To run compose, Remotion must be installed: this repo checkout has no `node_modules`. The test used a copy in the scratch folder.
