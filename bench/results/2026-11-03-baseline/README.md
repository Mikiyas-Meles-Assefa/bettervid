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
