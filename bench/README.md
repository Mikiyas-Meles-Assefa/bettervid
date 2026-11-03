# The teaching bench

Wave 3 of `docs/ROADMAP.md`. It scores how well short moments of a bettervid video teach and hold attention in time: is the eye on the right thing, does the picture keep up with the words, slow first then faster, how much arrives at once, does each pause do its job, can a first-time learner answer questions after watching, and how a demanding designer and a distracted phone viewer see it.

Claude Haiku stands in for Muse Spark as the scene's author, so a run spends no Meta credits and no ElevenLabs credits (narration is timed from the text). Every model step is done by Claude subagents reading and writing files; the bench itself never calls a model.

## One command

Each step is `npm run -s bench -- <step> <run> [case ...]` from the repo root (no case names means all cases). The steps in order:

```
npm run -s bench -- prepare 2026-11-03-baseline     # prompts for the authors
#   agents author: loop of next.md -> answer.txt -> submit until DONE
npm run -s bench -- map 2026-11-03-baseline         # id-map requests (map.md); an agent answers map.json
npm run -s bench -- measure 2026-11-03-baseline     # free measures -> work/<run>/scores.json
npm run -s bench -- render 2026-11-03-baseline      # clip.mp4, watch sheets, transcript, watch tasks
#   agents watch: watch-learner.md, watch-words.md, watch-follow.md, watch-designer.md, watch-scroll.md
npm run -s bench -- grade 2026-11-03-baseline       # grading requests (grade-N.md); an agent answers grades-N.json
npm run -s bench -- report 2026-11-03-baseline      # bench/results/<run>/scores.md and summary.json
npm run -s bench -- status 2026-11-03-baseline      # where every author stands
```

Render needs `BETTERVID_CHROME` (the chrome-headless-shell under `node_modules/.remotion`) and takes `RENDER_CONCURRENCY` (default 3). Everything bulky lives in `bench/work/<run>/<case>/` (not committed): the prompts, every round's answer, `scene.txt`, `clip.mp4`, the sheets and every watcher's JSON. `bench/results/<run>/` is committed: `scores.md`, `summary.json`, and per case the final scene and every watcher's answer.

## Cases

`bench/cases/*.json`, one short moment each (one scene part, at most 85 words, 15 to 40 s). A case is written as a director and teacher would: the user's request, topic, intent, style, the direction plan (events with their look, rhythm, holds, reveals, withholds and demonstrations, anchored to phrases rather than word numbers so they cannot drift), any material the user supplied, and a quiz with reference answers. Each question says what a viewer needs to answer it: the words, the picture, or both. `material` holds what the user brought: notes, a document excerpt, a CSV, a code file (text goes to `plan.material`, as the pipeline does) or a picture in `bench/cases/material/` (offered to the author by name, as the pipeline offers the director's pictures).

Words are timed without a voice at about 2.4 words a second, weighted by length, with pauses after commas and sentences and each hold as a silence (`synthTiming` in `lib/case.ts`). `prepare --voice` records real narration instead, which costs ElevenLabs credits.

## Authoring protocol (Haiku in Spark's seat)

`prepare` writes, per case, `system.md` (the engine language guide, `languagePrompt`, the system prompt Spark gets) and `request.md` (the very request `requestFor` in `pipeline/stages/scene.ts` builds for one part, with the scene header, direction, pictures and hand-offs). `submit` runs the stage's own `check()` on the answer and mirrors `compose()`:

1. Build rounds: the answer is checked; problems and hand-off misses go back with `repairRequest` (the stage's repair prompt, with line numbers). Up to `BUILD_ROUNDS` (4) rounds.
2. Review: once a part builds, what code can see about it (`review()`) goes back once with `reviewRequest`. The reviewed version is kept only if it builds and misses no more than before; if it breaks, one repair round; otherwise the built version stands.
3. Done: `scene.txt` holds the final part, `author.json` the state (`ok`, problems, warnings, whether the review was kept).

An author agent (model `haiku`) is told: read `system.md` and `next.md`, write the whole answer to `answer.txt`, run `npm run -s bench -- submit <run> <case>`, and repeat while it says NEXT. The look step (Spark judging rendered stills) is not part of the bench. The id map (plan words to scene ids, which the direction check asks Spark for) is written to `map.md` with the same prompt and schema; a Claude agent answers `map.json`.

## Free measures (no model; `lib/measure.ts`)

All are 0 to 1, computed from the built scene sampled frame by frame and the narration timing, the same for every case; raw values sit beside them in `summary.json`.

- **eye**: during each event, the share of on-screen change that is on the event's planned look (attentional synchrony). An absent or still look scores 0.
- **lag**: when the narration names something the screen writes, does it arrive or change from 0.5 s before to 1 s after the word (late within 3 s is half); and does each event's look, and each reveal, start moving near its first word (temporal contiguity).
- **pace**: rate of change varies across events (not a metronome), long events are not busier than short ones, demonstrations are not rushed, still or unsettled, and slow phases are slower than later fast ones (slow first, then faster).
- **load**: share of seconds where more than 6 new things arrive within 2 s, or more than 3 independent changes pull at once.
- **holds**: each silence keeps the picture working on its event (not frozen, nothing unrelated pulling), and a predict hold never shows its answer.
- **reveal**: withheld things stay off screen until their moment, and the opening shows the promise.
- **read**: layout checks every half second: text cut by the frame, under the style's readable size, writing on writing, a covered picture, a mostly empty frame.

`free` is their mean. A case that does not build scores 0 on all of them and counts in the averages.

## Watch tests (Claude subagents; `render` writes their tasks)

Clips are 360 by 640 MP4s with the video's own captions and a clock. Watchers see them as sheets of 8 frames (2 s at 4 frames a second) with the narration cut to the same windows.

- **Learner** (`watch-learner.md`): a first-time learner watches every sheet with the words, then takes the quiz without outside knowledge, saying where each answer came from.
- **Words only** (`watch-words.md`): the same quiz from the narration alone. The gap between the two is what the picture adds; "picture Qs" are the questions only the picture can answer.
- **Follow** (`watch-follow.md`): per 2 s sheet, what the viewer looks at, what they wait for, and what confuses them.
- **Designer** (`watch-designer.md`): a demanding motion designer scores composition, type, motion, hierarchy and consistency from 1 to 10 and lists the worst issues by sheet.
- **Scroller** (`watch-scroll.md`): a tired phone viewer glances at each sheet, says whether they would still be watching, and what they would tell a friend.

A grader agent that never saw the clips (`grade-N.md`) marks quiz answers against the references, the follow entries against the plan's look and open question per window, and the scroller's retelling against the clip's goal. Scores are 1, 0.5 or 0.

Report columns: **quiz (video)** and **quiz (words)** are the share right; **follow on look** is how often the viewer's eye was on the plan's target; **confused** is the share of windows where the follow viewer reported confusion; **scroll kept** is the share of sheets watched before swiping; **scroll remembers** is whether the retelling carries the point.

Models for the 2026-11-03 baseline: Haiku authored every scene and sat in the scroller seat; Sonnet sat in the designer seat, wrote 9 of the 26 follow tests and graded. The learner and words-only tests and the other 17 follow tests were run by an earlier session that did not record its model.
