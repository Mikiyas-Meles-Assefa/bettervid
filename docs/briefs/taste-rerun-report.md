# Taste review rerun: merge-min-a2 against merge-min-a

Question: with the taste review on, does Spark fix the composition (small numbers in a mostly empty frame)?

Short answer: no. The taste review saw the problem clearly and asked for the right thing. Spark took the small, local fixes (smaller caption, dims, a removed bottom line) and did not touch scale or framing. The video looks about the same as A. One section (s1) never got a taste review, and its pacing got a little worse.

## Setup

- `projects/merge-min-a2` is a copy of `merge-min-a` with the same narration, voice, plan, direction and style. Its `scene/` folder, `video.mp4`, `mix.wav` and the scene, timeline, mix and render records were cleared, so the scene was written fresh. Input: `sceneAuthor: "toolbox"`, `sceneRepair: "once"`, style neon.
- Ran `--only scene`, `timeline`, `mix`, `render` on `claude/taste-rerun-45ab70` (path A plus the taste review, commit b4d01d7). `RENDER_SCALE=0.75`.
- Nothing broke and no code changed. `node_modules` was already present; `.env` and `projects/` are symlinks to the main checkout (not committed).

## Time and spend

| | merge-min-a | merge-min-a2 |
|---|---|---|
| scene stage | 172 s | 140 s |
| render | 45 s | 51 s |
| Meta spend, scene | $0.024 | $0.023 (s1 $0.005, s2 $0.009, s3 $0.009, taste calls included) |
| length | 67.6 s | 67.6 s |

The director's look was cached from A, so it cost nothing this time. Total Meta spend for this task: $0.023.

## The taste review per section

It ran on Spark (`muse-spark-1.3`, medium effort). It got the part's spoken words, purpose, the video's intent, the neon palette and fonts, the platform (phone, vertical) and the same stills the look review read: 10 frames for s2, 9 for s3. The Meta client keeps no raw call log, so the answers below come from `scene/sN/once/issues.json` (the `taste` field). The request is rebuilt from `tasteContext` in `pipeline/stages/scene.ts`.

**s1 (words 0 to 58): no review.** The first draft did not build, so `writeOnce` went straight to a build-repair request. Neither the look nor the taste review ran. This is how `writeOnce` is meant to work, but it means the section a viewer sees first got no eye on it at all.

**s2 (words 59 to 102): revise.** The look review gave it 5/5 with 0 issues; the taste review disagreed.
- Weakest: hierarchy and scale. "the tiles are too small and cropped to follow on a phone glance while most of the vertical frame does no work."
- Fixes: (1) enlarge the tiles and shrink the caption to a small supporting line; (2) lock the camera on the full rows with no edge cropping and pull them into the middle third; (3) dim the pairs not yet merged, keep only the active pair glowing; (4) remove the stray yellow flashes, pink for comparing and cyan for sorted only; (5) do not shrink out at the end.

**s3 (words 103 to 140): revise.** The look review gave it 5/5 with 0 issues; the taste review disagreed.
- Weakest: space. More than half the frame is empty while the merge plays small, and the inactive right numbers compete equally.
- Fixes: (1) stack the source pair over the result slots in the optical center and make "down" read as down; (2) fade the right quads to faint outlines; (3) make the finger markers large and glowing, on the current fronts only; (4) remove the all-caps WATCH IT HAPPEN line and put a short updating label at the action; (5) finish the merge inside the moment, with no freeze on a half-built state.

These are good notes: specific, phone-aware, and aimed at the problem we were looking for. The look review missed every one of them.

## Did the writer act on them?

Diff of `once/scene.txt` (draft) against `scene.txt` (repaired):

- **s2:** caption `size=big role=title` became `size=small role=note` (fix 1, the caption half). Added a bare `camera demo1` and `dim` lines on items 5 to 8 across states (fix 3). It did not enlarge the tiles, zoom, change `form`, or do anything about the empty frame (fixes 1 and 2, the main ones). Fixes 4 and 5 were not addressed.
- **s3:** the heading lost its typed numbers (which also answered a "what code sees" note) and moved from `role=heading` to `role=title`, and is now dropped at the question beat (fix 4, partly: the persistent bottom line is gone). Lights now include the compared items (fix 3, partly). Camera zoom stayed at 1.4, with a shorter move (90 to 45 frames). No re-layout and no extra dimming of the right quads (fixes 1 and 2 not done). Fix 5 was not done.

So Spark acted on about half the fixes, always the cheap, line-level ones. It ignored every fix that needs a different composition. Note what it had to work with: the `sort` kit sizes itself, and the writer's only controls on scale are `camera` (target and zoom) and `form=row|down|across`. A zoom onto the active pair, or `form=across`, was available and would have answered the main note. It used neither.

**Tools:** none from the design brain's toolbox. `scene/toolbox.json` has no depictions, the same as in A. The scene uses only the base language: `sort`, `text`, `camera`, `do steps`, `do pulse`, `light`, `dim`, `drop`, `emit`. The instruments ran (29 and 31 lines for s2 and s3) and went into the same repair request.

## The two videos, frame by frame (one still every 5 s)

Contact sheets: `merge-min-a` and `merge-min-a2`, 14 stills each (0 to 65 s), compared by eye.

- **0 to 25 s (s1):** A2 is weaker. The "Now merge." title stays up for all of s1, about 25 s, and two text lines stack under the row ("TWO FINGERS - ONE ON THE FRONT OF EACH SIDE" plus "compare under fingers - take the smaller to temp"). A2's camera stays at `zoom=1`, so the 8 tiles are tiny the whole time. A at 10 to 20 s zooms in and the tiles are about twice as large: the only frames in either video where the numbers read well on a phone.
- **30 to 45 s (s2):** about the same. Both show a row cropped at the right edge at 35 s, which is the cropping the taste review called out, still there. A2's caption sits as a mid-frame note instead of nothing. The dims on 5 to 8 do not show in the 35 s and 40 s stills (the right numbers are as bright as in A), probably because the steps relight the items. The empty top and bottom bands are the same.
- **50 to 65 s (s3):** A2 is slightly better. The persistent pink WATCH IT HAPPEN ON THE LEFT bar is gone, replaced by a large title that leaves, then "Which goes down?" near the action. The tiles are the same small size, the right quads are still at full brightness, and the lower half of the frame is still empty.
- **Overall:** same composition problem in both. Small numbers in a band across the middle third, most of the 9:16 frame dark. A demanding designer would not see the taste review's main point in A2. A distracted phone viewer still has to squint at the numbers in every section, and in A2 also in the first 25 s, where A had zoomed in.

## What this says

1. The taste review is worth its call: it found the real problem that the look review scored 5/5. The eye is no longer the bottleneck.
2. Notes alone do not move Spark to re-compose. In one repair round it does the line edits that are easy to see and leaves scale and layout alone, even when the language has the controls. The gap is between the note and the act: the request lists the camera and form controls nowhere near the art director's fixes, and nothing checks after the repair whether the main fix landed.
3. A section whose first draft does not build gets no taste review (s1 here). That was the section that got worse.

Possible next steps (for the owner of path A to decide, not done here): run the look and taste on the build-repaired draft too, so no section ships unseen; and have the taste review name the controls it means (for example "camera onto item 3 to 4, zoom 2") or have the instruments measure how much of the frame the subject fills, so a "use the frame" note comes with a number the writer can act on and a check that it did.
