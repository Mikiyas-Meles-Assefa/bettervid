# Baseline, 2026-11-03

The engine as of commit e33f506 plus the bench, with Claude Haiku authoring every scene through the scene stage's own prompts, checks, repair rounds and review. 28 cases, 10 from the user's own material (notes, documents, a CSV, code files, pictures). Meta spend $0, ElevenLabs none. Full table: `scores.md`; numbers: `summary.json`; each case's scene and watchers' answers: `scenes/`. Clips stay in `bench/work/2026-11-03-baseline/<case>/clip.mp4` (not committed).

## Overall

| measure | value |
|---|---|
| cases built | 26 of 28 (25 pass every check; running-max builds but ends with a check failing) |
| free measures, mean | 0.75 (eye 0.68, lag 0.76, pace 0.64, load 0.90, holds 0.72, reveal 0.90, read 0.81) |
| quiz, video learner | 0.95 |
| quiz, words only | 0.81 (the picture adds 0.15) |
| picture-only questions, video vs words | 0.83 vs 0.18 |
| follow: eye on the plan's target | 0.85; waiting for the right thing 0.86 |
| follow: windows with confusion | 0.76 |
| designer, out of 10 | 3.9 (no case above 6) |
| scroller: share of clip watched | 0.59 (8 of 26 watched to the end) |
| scroller: retelling carries the point | 0.83 |

## Reading

The clips teach the words; they do not yet teach with the picture. A learner gets nearly every answer, but the narration alone gets 0.81, and the quiz is near its ceiling, so it separates cases poorly. Where the picture alone holds the answer it mostly delivers (0.83 against 0.18), which shows the pictures are on topic and timed, not that they explain.

Two seats, one verdict: the designer gives 3.9 of 10, and the follow viewer reports confusion in three windows of four. The same faults repeat across uses and styles:

1. Diagrams of boxes and labels instead of the thing. Titration with no liquid or pink, a square knot drawn as crossing sticks, rust as a dark blob, octopus hearts as three circles labelled HEART, a water cycle with no water, an ad whose product is a box labelled BOTTLE. The idea is told in text on screen, not shown.
2. The demonstration the plan asks for does not happen. Ball-drop never drops the balls (they drift up), the fraction counter reads "0 halves" while halves appear, insertion sort's slow first step lasts a second, then sits still.
3. Composition: the content sits small in the top third with the bottom half empty, on nearly every case. Labels that carry the lesson are too small for a phone, and some lines run off the frame (route-finding's answer, rule-of-72's transition collision, ball-drop's heading).
4. Holds are dead air. Predict and thinking holds show a still frame (ball-drop, affect-effect, fresh-water, rust, ice-floats), so the holds measure and the scroller agree: that is where people swipe.
5. A bug that reads as one: the word "key" (and "answer") shows as chalk text beside equations in fraction-division and life-expectancy. The authors wrote `role=key` on equation lines whose pieces are `name=text`, so the role is drawn as a piece. The engine should refuse or read it as a role.

Failures: off-by-one (code file) and offside never built in 4 rounds, both on readability: a state that holds too much shrinks text below the readable size, and Haiku did not split it. running-max built, but its trace line never matched the code the plan's truth computes.

The free measures agree with the watchers on dead holds and on the eye, and miss what the designer sees most: read scores 1.0 on clips the designer calls illegible on a phone (running-max, water-cycle-recap, trail-directions), because the size check passes text a phone viewer cannot read and does not see a frame that is mostly empty below the content. Nothing measures whether the picture depicts the thing rather than labels it. Those are the gaps to close in the measures before wave 4.

Material cases learn as well as prompt cases (quiz 0.98 vs 0.94) and look no better (the supplied picture in trail-directions is shown small and unreadable; the support-tickets slide's bars do not carry its proportion).

## Clips worth watching

- best: `bench/work/2026-11-03-baseline/magna-carta/clip.mp4` (designer 6, free 0.91)
- best: `bench/work/2026-11-03-baseline/trail-directions/clip.mp4` (designer 5, scroller stayed to sheet 12)
- worst: `bench/work/2026-11-03-baseline/ball-drop/clip.mp4` (the drop never happens; designer 3)
- worst: `bench/work/2026-11-03-baseline/titration-lab/clip.mp4` (a lab step with no liquid; designer 3)
- worst: `bench/work/2026-11-03-baseline/fraction-division/clip.mp4` (counter stuck at 0, stray "key" label)

## Rescored with the new measures

The same clips, scored again after the measures were changed (bench/README.md has the definitions). `scores.md` and `summary.json` now hold the rescored numbers; the first run's table is in git history. Watch tests for the rescore: the learner and depict tests by Sonnet, words only by Haiku, grading by Sonnet. Designer, scroller and follow answers are from the first run. Meta spend $0, ElevenLabs none.

| measure | first run | rescored |
|---|---|---|
| teach gap (video minus words, whole quiz) | 0.15 (0.95 vs 0.81) | **0.29** (0.86 vs 0.58) |
| hard picture questions, video vs words | none | 0.73 vs 0.21 (gap 0.53) |
| read | 0.81 | 0.52 |
| holds | 0.72 | 0.44 |
| depict (free / watch / blend) | none | 0.62 / 0.40 / 0.49 |
| free measures, mean | 0.75 | 0.66 |

Part of the drop in the words-only score is the change of model (Haiku now, stricter about "not in the clip"); the hard questions are what widens the gap: the words-only learner gets 0.21 of them.

Read, before and after, on the clips the designer judged:

| case | read before | read after | why, from raw.read |
|---|---|---|---|
| water-cycle-recap | 1.00 | 0.21 | stage labels 39 px, grey on grey boxes; 80% of its words are under the phone size |
| running-max | 1.00 | 0.39 | the code, the whole lesson, is 49 px; 79% of the words small |
| trail-directions | 1.00 | 0.46 | the sketch is shown 64% wide (its labels shrink with it), route labels 40 to 47 px; the 114 px title scores full |
| magna-carta | 1.00 | 0.65 | the clause at 69 to 94 px reads well; it loses on the charter card (CHARTER at 36 px, seal at 48 px) and on the moment the key phrase sits at 1:1 contrast under a dark bar, both on the designer's list |
| death-zone | 1.00 | 0.98 | large words on a plain field |

Holds now catch dead air the old check passed: running-max's predict hold 1.00 to 0.19 (a question sits still for 2 s; the designer said the same), magna-carta 1.00 to 0.40, monarch-migration 1.00 to 0.33, death-zone 1.00 to 0.45. Frozen holds stay 0; a hold that keeps working stays 1 (disc-brake, square-knot, titration's running timer).

Depict (blend) lowest: frostline-ad 0.03 (a box labelled BOTTLE), led-vs-bulb 0.06, water-cycle-recap 0.08, rule-of-72 0.13, disc-brake 0.20, ball-drop 0.26, octopus-hearts 0.28, titration-lab 0.28 (labelled boxes, a tag reading "pink", no liquid). Highest: insertion-sort and matrix-rotation 0.85 (the notation is the thing), affect-effect, fresh-water and route-finding 0.78.

## Do the measures agree with the two seats?

- read: yes on the named cases, and it now separates (0.21 to 0.98) where it sat at 0.96 or more for 19 of 26. The designer names text too small for a phone on 24 of 26 clips, so the designer's type score (4 to 7) barely ranks the clips and the rank correlation is near zero (-0.06); read is the finer instrument here. Its space term is lenient (0.80 mean while the designer names empty frames on 24 clips); that is the next thing to tighten.
- depict: the watch test agrees with the designer (rank correlation 0.31 with the designer's overall; their issue lists name the same boxes and labels). The free signal agrees with the watch test (0.55) but overrates any program drawing (a climbing dot counts as drawn), which is why the watch weighs more.
- holds: agrees with the designer on each dead hold it names; against the scroller's swipe point it does not rank (-0.20), because people swipe for many reasons besides a hold, and several clips have no hold near where they swiped.
- quiz: no longer at the ceiling (0.86), and the hard questions separate clips that do the plan's demonstration (fresh-water, route-finding, water-cycle-recap's ordered replay: 1.00) from those that do not (death-zone, led-vs-bulb, titration-lab, square-knot: 0.33; life-expectancy 0, its chart has no year ticks). A few hard questions are weak (the words imply the answer: matrix-rotation's are answered from the narration too); the words-only column shows which, and they should be replaced.

## Per-case settings

The numbers in the two sections above were scored with the phone-teaching defaults for every case. The measures now read every threshold from the case's own `measure` block (its viewing context and what good means for it, derived once from the request, intent and audience and recorded in the case file) over the defaults in `bench/lib/settings.ts`. `scores.md` and `summary.json` hold the numbers with those settings, and `scores.md` lists each case's raw instrument readings beside its scores. No watch test was rerun; only the free measures and the depict blend were recomputed.

What the derived settings change:

- Viewing context: classroom screens (ball-drop, insertion-sort, magna-carta, matrix-rotation, vaccine-memory, water-cycle-recap) look about 15% narrower than a phone at arm's length, so they need text 15% larger; the all-hands meeting screen (support-tickets) needs 45% larger; laptops at a desk (two-factor, off-by-one) need less. read moves: support-tickets 0.49 to 0.16, matrix-rotation 0.78 to 0.64, magna-carta 0.65 to 0.57, ball-drop 0.55 to 0.48, two-factor 0.36 to 0.51.
- Still holds: where the plan asks the picture to wait ("nothing moves toward the answer", "the question waits", "stays lit"), the hold scores on nothing unrelated moving instead of on change. 19 holds are declared still, 17 of them in cases that built. holds moves from 0.44 to 0.80; running-max's predict hold goes 0.19 to 1, ball-drop's and fraction-division's frozen predict holds 0 to 1. A frozen hold the plan did not ask for still scores 0 (rust, fresh-water's answered predict hold).

| measure | phone defaults | per-case settings |
|---|---|---|
| read | 0.52 | 0.50 |
| holds | 0.44 | 0.80 |
| free measures, mean | 0.66 | 0.70 |

The scroller swiped during several of the still holds the plans ask for, so whether a still predict hold is right is now a question for the plan (and the plan stage's settings), not a fault the holds measure charges to the scene.
