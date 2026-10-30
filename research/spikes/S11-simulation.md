# S11: Can Spark write a simulation for a video?

Oct 30, 2026. One brief (a phantom traffic jam on a ring road, 10 s, two cues), rendered in collage and whiteboard. Cost $0.074: $0.043 to write it, $0.031 for one repair. Code: `scripts/s11/`, prompt: `prompts/simulation.md`.

| Question | Result |
|---|---|
| Does the code run? | Yes, on the first try: 173 lines, 0.08 ms per frame, nothing outside the safe area |
| Are the rules real? | Yes: Spark wrote a car-following model with reaction delay |
| Do changes land on cues? | Yes: the labels switch on the cue |
| Does it take on the style? | Yes, with no code change: paper, colors and font all came from the style file |
| Does it show the idea? | **No.** The cars only turn red after the "bigger gaps" cue, the opposite of the brief |
| Did looking at frames fix that? | **No.** One repair from 7 frames was no better, and cars began to overlap |

## What it means

Passing the code checks says nothing about whether the simulation teaches. A real simulation has its own timing: the jam takes seconds to build, so it does not simply obey the cues. Seven still frames do not give Spark enough to see why.

Also weak: the picture fills only about the top third of the frame, and the small labels will not read on a phone.

## Second test: repair from measurements

Same brief, $0.17. Each simulation now reports numbers once per second (here slow cars and speed spread), and Spark compares them with the brief, for up to 3 rounds.

- **It did not fix it.** Spark rewrote the module all 3 times and never answered OK. After the brake, 0 to 5 cars of the ring were slow at any moment, there was never a real jam, and in frames the red dot still shows up late.
- The numbers did show the failure clearly, so a check can catch this. Spark could not tune its way out.
- Labels got bigger, but the picture still fills only about the top third, and the yellow labels are hard to read on paper.

## What it means

This brief is close to the hardest case: the jam has to emerge from an unstable system, on cue. The code, cues and styling are not the problem. Getting emergent behavior to land on time is.

Simulations with a direct formula (waves adding up, orbits, compound growth) have no such problem, because the state at any moment is known. Those are untested, and a single test would show whether they work on the first try.

## Third test: a formula-based idea

Same flow, new brief: two sound waves, cue "flip" brings in an upside-down copy, cue "add" slides them together and the sum goes flat. 10 s, collage and whiteboard. Two runs, $0.120 in all: $0.054 for the first, $0.066 for the second. Judged from frames, not from Spark's answer.

| Question | Run 1, old prompt | Run 2, new rules |
|---|---|---|
| Does the code run? | Yes, first try, 0.05 ms per frame, nothing outside the safe area | Yes, first try, 0.04 ms per frame, nothing outside the safe area |
| One wave before "flip"? | **No.** A full-size "SUM" wave is there from the start | Yes |
| Two mirrored waves between the cues? | Yes, but the "SUM" stays full size, which is false once the copy exists | Two waves, but they read as two offset waves, not as a mirror |
| Flat line after "add"? | Looks right, flat by 7.5 s | Yes, flat by about 8.5 s |
| Is the sum computed? | **No.** It is the noise times a fade, not the two waves added | Yes, the sum of the two drawn waves at every point |
| Do changes land on cues? | Yes, on the cue frame | Yes, on the cue frame |
| Does it take on the style? | Yes, no code change | Yes, no code change |
| Picture size | Full width, about 80% of the safe height | Same |
| Labels on a phone | Big enough, but yellow "FLIPPED" is hard to read | Big enough and dark, but they collide with the waves |

Run 1 is the important one: Spark answered OK on a picture that was wrong. Its own numbers were built from the same fake sum, so they agreed with it. Measurements only catch what the module chooses to measure honestly.

Three general rules went into `prompts/simulation.md`: nothing appears before its cue, a result is computed from the same values drawn for its inputs, and "highlight" is never a label. They fixed all three things they aimed at. Spark then found a real way to make the sum shrink: the copy starts offset along the wave, and closing that offset brings the sum to zero.

The repair round in run 2 changed the module but fixed nothing a viewer would see, and a second round was skipped to stay under the $0.15 cap.

Still weak in run 2:

- **Wrong label.** "sum = 0" appears on the "add" cue, while the sum is at its largest, about 1.5 s before it is true.
- **Label collisions.** "flipped" and "sum = 0" sit on top of a wave, in both styles.
- **Mirror not obvious.** The offset that makes the sum real also hides that the copy is upside down.
- **Same color.** Both waves are ink, because "highlight" was the only other choice left. The flipped wave stands out less than it did in run 1.

## Verdict

Keep simulations in the plan, for formula-based ideas only. The original failure is gone: the behavior lands on the cue frame, the math can be real, and it costs about $0.03 to $0.07 per simulation.

It is not ready to run unattended. The first run faked the result and passed its own check, and the best run still has a false label and collisions. So the pipeline needs two things beyond this spike: a review of rendered frames, since Spark's OK proves nothing, and a code check that labels do not overlap what is drawn.

The new rules were written after seeing this topic fail and tested on this topic only, so one run on a different formula-based idea should confirm they hold before this is built in.
