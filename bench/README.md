# The teaching bench

Wave 3 of `docs/ROADMAP.md`. It scores how well short moments of a bettervid video teach and hold attention in time: is the eye on the right thing, does the picture keep up with the words, slow first then faster, how much arrives at once, does each pause do its job, can a first-time learner answer questions after watching, and how a demanding designer and a distracted phone viewer see it.

Claude Haiku stands in for Muse Spark as the scene's author, so a run spends no Meta credits and no ElevenLabs credits (narration is timed from the text). Every model step is done by Claude subagents reading and writing files; the bench itself never calls a model.

## One command

Each step is `npm run -s bench -- <step> <run> [case ...]` from the repo root (no case names means all cases). The steps in order:

```
npm run -s bench -- read 2026-11-03-baseline        # the user's material into part cards (cases with material)
#   agents read: loop of read/ask/<task>.md -> read/answer/<task>.json -> read until every case has cards.json
npm run -s bench -- prepare 2026-11-03-baseline     # prompts for the authors
#   agents author: loop of next.md -> answer.txt -> submit until DONE
npm run -s bench -- map 2026-11-03-baseline         # id-map requests (map.md); an agent answers map.json
npm run -s bench -- measure 2026-11-03-baseline     # free measures -> work/<run>/scores.json
npm run -s bench -- render 2026-11-03-baseline      # clip.mp4, watch sheets, transcript, watch tasks
#   agents watch: watch-learner.md, watch-words.md, watch-follow.md, watch-designer.md, watch-scroll.md, watch-depict.md
npm run -s bench -- grade 2026-11-03-baseline       # grading requests (grade-N.md); an agent answers grades-N.json
npm run -s bench -- requirements 2026-11-03-baseline  # the material's requirements on the built scenes -> requirements.json
npm run -s bench -- report 2026-11-03-baseline      # bench/results/<run>/scores.md and summary.json
npm run -s bench -- status 2026-11-03-baseline      # where every author stands
```

Render needs `BETTERVID_CHROME` (the chrome-headless-shell under `node_modules/.remotion`) and takes `RENDER_CONCURRENCY` (default 3). Everything bulky lives in `bench/work/<run>/<case>/` (not committed): the prompts, every round's answer, `scene.txt`, `clip.mp4`, the sheets and every watcher's JSON. `bench/results/<run>/` is committed: `scores.md`, `summary.json`, and per case the final scene and every watcher's answer.

## Cases

`bench/cases/*.json`, one short moment each (one scene part, at most 85 words, 15 to 40 s). A case is written as a director and teacher would: the user's request, topic, intent, style, the direction plan (events with their look, rhythm, holds, reveals, withholds and demonstrations, anchored to phrases rather than word numbers so they cannot drift), any material the user supplied, and a quiz with reference answers. Each question says what a viewer needs to answer it: the words, the picture, or both. `material` holds what the user brought: notes, a document excerpt, a CSV, a code file (text goes to `plan.material`, as the pipeline does) or a picture in `bench/cases/material/` (offered to the author by name, as the pipeline offers the director's pictures).

Words are timed without a voice at about 2.4 words a second, weighted by length, with pauses after commas and sentences and each hold as a silence (`synthTiming` in `lib/case.ts`). `prepare --voice` records real narration instead, which costs ElevenLabs credits.

The frame's shape is the case's `measure.context.frame` ("9:16", "16:9", "4:5", "1:1"; 9:16 when absent): the project carries it (`input.frame`, the short side 1080 px), so the author's canvas, the build, the measures, the clip (16:9 renders 640 by 360) and the sheets' tiles all follow it, and the watch tasks name the video's shape and screen from the case's context.

## Material: part cards and requirements (`lib/read.ts`, `engine/design/material`)

`read` turns each case's material into part cards (`PartCard` in `engine/design/types.ts`): tables, code and text documents are read by code (rows and data, numbered lines, headings, sentences, items and quotes, each with its line); each picture is a reader task for an agent (named parts with boxes, the words in it, a chart's data). Every reading is checked against its source without a model (boxes inside the picture and not degenerate, values against the stated total, the bars' boxes and the parts' own numbers, words found in the document, data against a table in the project); problems go back to the reader as a repair task (`read.<name>.r1` ...). Once every card checks, a linker task reads all the cards and returns the requirements one file states about another or about the video, each citing its file and part; a check makes sure they name real files and parts, and repairs the same way. The tasks go through the file Reasoner (`engine/design/reasoner.ts`): `<case>/read/ask/<task>.md` is the task, `<case>/read/answer/<task>.json` the answer; run `read` again after answering. The result is `<case>/cards.json` (cards, requirements, any problems left). `scripts/design-brain/bench-setup.ts` hands the cards to the composer as `material.json` (by name, with the requirements about each), `requirements.json`, and the intent author's request.

`requirements` checks each requirement on the built scene with plain geometry (`lib/requirements.ts`): a requirement about a picture or a part of one reports the seconds it is on screen, the longest stretch, the seconds it is also legible at the case's read sizes (the type size of its smallest words, from the card's boxes), and met or not; one that names colors reports the share of painted words and shapes in them; anything else is reported as not measured here. What counts as long enough is the case's `requirementSettings`.

## Authoring protocol (Haiku in Spark's seat)

`prepare` writes, per case, `system.md` (the engine language guide, `languagePrompt`, the system prompt Spark gets) and `request.md` (the very request `requestFor` in `pipeline/stages/scene.ts` builds for one part, with the scene header, direction, pictures and hand-offs). `submit` runs the stage's own `check()` on the answer and mirrors `compose()`:

1. Build rounds: the answer is checked; problems and hand-off misses go back with `repairRequest` (the stage's repair prompt, with line numbers). Up to `BUILD_ROUNDS` (4) rounds.
2. Review: once a part builds, what code can see about it (`review()`) goes back once with `reviewRequest`. The reviewed version is kept only if it builds and misses no more than before; if it breaks, one repair round; otherwise the built version stands.
3. Done: `scene.txt` holds the final part, `author.json` the state (`ok`, problems, warnings, whether the review was kept).

An author agent (model `haiku`) is told: read `system.md` and `next.md`, write the whole answer to `answer.txt`, run `npm run -s bench -- submit <run> <case>`, and repeat while it says NEXT. The look step (Spark judging rendered stills) is not part of the bench. The id map (plan words to scene ids, which the direction check asks Spark for) is written to `map.md` with the same prompt and schema; a Claude agent answers `map.json`.

The intent author is the same loop in `<case>/intent/`: `intent-prepare` writes `system.md` (the intent guide, `scripts/design-brain/intent-prompt.md`, with the lines a plan may pin), `request.md` (the request `intentRequestFor` builds for the scene stage's intent path: no scene-language rules, the material listed by its named parts from `cards.json`) and `next.md`. `intent-submit` checks `answer.txt` as the stage does (`checkPlan` in `pipeline/lib/intent-author.ts`), sends problems back for up to `BUILD_ROUNDS` rounds, and writes a plan that checks to `intent.txt`, for `scripts/design-brain/compose.ts` to compose.

## Settings: what good means for each case (`lib/settings.ts`)

The measures are instruments: no threshold is a constant in the code. Each case file has a `measure` block with its viewing context (screen, frame shape, distance, how the viewer watches, and why) and any setting that departs from the defaults; everything it leaves out takes the default. The block is derived once per case, by a person or an agent reading the request, intent, audience and platform, and recorded in the case file with a note on how. The defaults are the derived settings for teaching on a phone: a 9:16 frame at arm's length, the eye meant to be on the event's look, every silence working toward its purpose. The numbers quoted below are those defaults.

What a case can set: `read` (text sizes as shares of the frame's width, contrast, density, picture width, the subject's share, empty space, the layout's weights; read sizes scale with how wide the frame looks to the eye, so a classroom screen seen from the back needs larger text than a phone and a laptop at a desk smaller), `look.hidden` (events whose subject is meant to stay hidden, which eye skips: a suspense beat), `holds.still` (holds the plan asks to wait without motion, scored on nothing unrelated moving rather than on change), `holds.work`, `lag`, `load`, `pace.varied`, and `depict` (a symbol's score, the watch test's weight). `measure` stores the settings it used in each case's raw readings, and `report` lists the raw instrument readings beside the scores in `scores.md`, so a judge can reason over them.

## Free measures (no model; `lib/measure.ts`)

All are 0 to 1, computed from the built scene sampled frame by frame and the narration timing, the same for every case; raw values sit beside them in `summary.json`.

- **eye**: during each event, the share of on-screen change that is on the event's planned look (attentional synchrony). An absent or still look scores 0.
- **lag**: when the narration names something the screen writes, does it arrive or change from 0.5 s before to 1 s after the word (late within 3 s is half); and does each event's look, and each reveal, start moving near its first word (temporal contiguity).
- **pace**: rate of change varies across events (not a metronome), long events are not busier than short ones, demonstrations are not rushed, still or unsettled, and slow phases are slower than later fast ones (slow first, then faster).
- **load**: share of seconds where more than 6 new things arrive within 2 s, or more than 3 independent changes pull at once.
- **holds**: dead air costs. Per hold, the share of its frames in which something tied to its purpose is changing (the event's look, its demonstration, what the hold's `does` names, the prompt it shows); half the hold working is full marks, none is 0, so a frozen frame, a lone pulse in a three second silence or a clock ticking beside a still picture all score low. Unrelated change outweighing related change halves it; a predict hold that shows its answer scores 0.
- **reveal**: withheld things stay off screen until their moment, and the opening shows the promise.
- **read**: the frame as a tired viewer sees it on a phone at arm's length, every settled half second (`phoneRead`). A 1080 px frame is about 65 mm across on a phone, so text reads at a glance from 7% of the frame's width (75 px) and not at all under 3.5% (38 px), well above the style's hard floor. Per frame: **words**, each line weighted by its length, scores size times contrast against what is drawn behind it (WCAG 1.5:1 to 4.5:1 after its fade), and a picture shown narrower than the frame counts as a short line legible at 95% of the width, nothing at half (its detail shrinks with it); **density**, characters on screen (140 reads at a glance, 360 is a page); **subject**, the share of the usable frame the event's look covers (30% is full marks); **space**, the share of the usable frame in use and the tallest empty band. The frame scores words x (0.5 + 0.5 x (0.3 density + 0.35 subject + 0.35 space)), times 0.4 when words are cut by the frame, written over each other or a picture is covered: words that cannot be read are not saved by a good layout. The old layout-only score stays in `summary.json` as `raw.read.layout`.
- **depict** (free signal): does the picture show the thing or a box with its name in it (`depictFree`, from the scene source). Drawn: each thing is itself (a program's drawing, a picture, a graph, a kit's notation, code) 1, a bare symbol (an unnamed shape) 0.5, or a word in a shape (a box, circle, pill, diamond or triangle whose label or tag names it in a few words) 0; a scene with no picture at all is 0. Changes: each change of state is shown (a move, a recolour, a level, a drawing growing, a kit step) or told (a label rewritten, a tag added to a thing already on screen, a counter); emphasis (pulse, shake) is neither. The free signal is the mean of the two. It cannot tell a dot from a drawn climber, so the watch test weighs more.

`free` is their mean (depict counts its free signal only). A case that does not build scores 0 on all of them and counts in the averages.

## Watch tests (Claude subagents; `render` writes their tasks)

Clips are MP4s a third of the frame's size (360 by 640 for 9:16, 640 by 360 for 16:9) with the video's own captions and a clock. Watchers see them as sheets of 8 frames (2 s at 4 frames a second) with the narration cut to the same windows.

- **Learner** (`watch-learner.md`): a first-time learner watches every sheet with the words, then takes the quiz without outside knowledge, saying where each answer came from.
- **Words only** (`watch-words.md`): the same quiz from the narration alone. The **teach gap**, video learner minus words only over the whole quiz, is the bench's main teaching number: what the picture teaches beyond the narration.
- **Hard questions**: every case's quiz ends with three questions marked `"hard": true` that only a picture doing what the plan asks can answer (where a thing is after a step, what changed colour, which moved first, what the picture holds during a silence). The words-only learner should score near 0 on them; "hard gap" is the same difference on them alone. A hard question the words-only learner gets right is a weak question; replace it.
- **Depict** (`watch-depict.md`): a viewer lists every concrete thing the narration names and says how the picture gives it: itself (you would know it with its label covered), a symbol, only a word, or absent; and every change of state the narration names: shown as a visual change, told by words on screen, or missing. Score: things itself 1, symbol 0.5, word or absent 0; changes shown 1, told or missing 0; the mean of the two lists. The learner agent runs it after writing its quiz answers, from the sheets it already watched. The report's **depict** is 0.4 x the free signal + 0.6 x the watch score.
- **Follow** (`watch-follow.md`): per 2 s sheet, what the viewer looks at, what they wait for, and what confuses them.
- **Designer** (`watch-designer.md`): a demanding motion designer scores composition, type, motion, hierarchy and consistency from 1 to 10 and lists the worst issues by sheet.
- **Scroller** (`watch-scroll.md`): a tired phone viewer glances at each sheet, says whether they would still be watching, and what they would tell a friend.

A grader agent that never saw the clips (`grade-N.md`) marks quiz answers against the references, the follow entries against the plan's look and open question per window, and the scroller's retelling against the clip's goal. Scores are 1, 0.5 or 0.

Report columns: **teach gap** and **hard gap** lead; **depict (free)**, **depict (watch)** and **depict** as above; **hard Qs (video)** and **hard Qs (words)** are the share right on the hard questions; **quiz (video)** and **quiz (words)** are the share right; **follow on look** is how often the viewer's eye was on the plan's target; **confused** is the share of windows where the follow viewer reported confusion; **scroll kept** is the share of sheets watched before swiping; **scroll remembers** is whether the retelling carries the point.

Models for the 2026-11-03 baseline: Haiku authored every scene and sat in the scroller seat; Sonnet sat in the designer seat, wrote 9 of the 26 follow tests and graded. The learner and words-only tests and the other 17 follow tests were run by an earlier session that did not record its model.

The 2026-11-03 baseline was rescored with these measures: the hard questions, learner and depict tests by Sonnet, words only by Haiku, grading by Sonnet; designer, scroller and follow answers are from the first run.
