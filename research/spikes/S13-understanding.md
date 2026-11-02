# S13: can model reviewers tell a video that teaches from one that only looks clean?

Date: 2026-11-02. Code: `engine/review/`. Raw reports: `projects/review/teach-me-how-to-do-cramers-rule-i-know-t-76cad8/` and the fixed quiz, ideas, needs and scope in `projects/review/fixed/` (gitignored). Spend: $4.74 of Meta on the shared ledger (`project: engine-review`).

**Verdict: PARTIAL.** One measure, `held` (is what this moment builds on still on screen), ranked the three Cramer's rule cuts the way the user did in every pass, by a margin wider than its run-to-run drift. Two more, `fit` and sound off, separate the image cut from the other two, but rank the camera board level with or above the final cut. The first-time learner quiz does not separate the cuts at all, and it cannot reproduce the user's finding that audio alone taught better. The plain overall mean did not reliably rank the final cut first. This is one topic and one narration, so nothing here is a general calibration yet.

## Test set
One request, one narration (122.5 s, 278 words), three renders with identical sound:

| Cut | What it is | User's verdict |
|---|---|---|
| `video-before.mp4` | Generated drawings (balloon, sailboat, yarn) with small handwritten notes | terrible |
| `video-board.mp4` | Camera moving over a large whiteboard with real matrices | terrible, worse than audio alone |
| `video.mp4` | Teaching stage: the system and results stay on screen and change in place | really better |

Because the sound is the same, any difference the reviewers find has to come from the pictures across time. That makes this a clean test, but a narrow one.

## What was built
- **Sequence reviewer** (`sequence.ts`). Walks the video in order, one call per ~24 s chunk, with frames from the start, middle and end of each spoken sentence and the sentence beside them. It carries a written record of the screen from chunk to chunk. Per sentence it reports: is the thing spoken visible (`shown`), what the sentence builds on and where that is now (`needs`: on screen, has left, never shown), the voice moving on while the screen does not (`stale`), decoration or anything that pulls the eye (`competing`), and anything unreadable. It also lists every claim on screen for the truth check. Code adds a pixel measurement of frozen stretches that ignores tiles that change all the time (captions), and says nothing when the whole frame moves.
- **Sound-off reviewer** (`silent.ts`). Spark 1.3 watches silent clips with no script and no topic and keeps an account. A separate grader, which never sees the video, scores that account against idea units written from the script.
- **First-time learner** (`learner.ts`). The quiz is written from the request alone, before anyone sees the script, and kept fixed for every version. Spark 1.2 watches video with sound and takes notes. A separate call answers using only the notes and must quote them, and code checks the quotes. Each run has four arms on the same quiz: video with sound, narration alone (a black video with the same audio), the sound-off account, and nothing.
- **Truth check** (`truth.ts`). Claims on screen are checked against the narration, fact sheet sources and truth engine logs. Anything flagged false is looked at again at full size around that moment, so a misread or a half-finished change is not reported as false.
- **Tickets** (`RepairTicket` in `engine/core/types.ts`). Each ticket is tied to spoken words (`{ word }` moments) and says what was said, what was seen and what fails for the viewer. Tickets never say how to fix anything. Touching tickets of one kind merge.
- **Benchmark** (`benchmark.ts`): 100 requests in 12 kits, each with a note on what makes it hard. Also a runner that resumes and counts failures as not run (`scoreboard.ts`), a scoreboard that compares versions only on requests both finished, a noise band, and a repair loop that keeps the earlier version if a repair makes things worse.
- **Fixed yardstick per narration**: idea units, the needs map and quiz scope are written once and reused, so every version is measured against the same list.

## Results

Pass 1 used the first design. Pass 2 added the fixed needs map, the decoration test, quoted answers and quiz scope. Pass 3 fixed a bug where each chunk rewrote the running account and dropped early parts, and ran twice. Pass 3's learner columns were re-scored after a second bug fix (below); the cap cut the re-score short for board run 2 and the final cut, so those learner numbers are missing.

| Measure | Before | Board | Final | Ranks like the user? |
|---|---|---|---|---|
| held, pass 2 | 0.44 | 0.50 | 0.74 | yes |
| held, pass 3 run 1 | 0.61 | 0.58 | 0.79 | yes |
| held, pass 3 run 2 | 0.61 | 0.56 | not run (cap) | yes, so far |
| fit, pass 1 / 2 / 3a / 3b | 0.78 / 0.60 / 0.61 / 0.48 | 1.00 / 0.81 / 0.97 / 0.93 | 0.76 / 0.81 / 0.82 / n.r. | no: board scores highest |
| sound off, pass 1 / 2 / 3a / 3b | 0.62 / 0.92 / 0.92 / 0.92 | 1.00 / 0.96 / 1.00 / 1.00 | 1.00 / 0.54* / 1.00 / n.r. | before is lowest; board and final tie at the ceiling |
| learner quiz, video (pass 3 re-scored) | 0.80, 0.80 | 0.70 | n.r. | no |
| learner quiz, audio alone | 0.80, 0.70 | 0.80 | n.r. | the cuts score about the same as audio alone |
| learner quiz, nothing watched | 0.00 | 0.00 | 0.00 | leak closed (was 0.63 in pass 1) |
| overall mean, pass 1 | 0.61 | 0.83 | 0.75 | no |
| overall mean, pass 2 | 0.61 | 0.77 | 0.75 | no |
| overall mean, pass 3 re-scored | 0.74, 0.70 | 0.81 | not measured | unknown |

\* The 0.54 was the account-rewrite bug: the account kept only the last chunk. The fix brought it back to 1.00.

`held` in detail (pass 3 run 1, counts of needed things across all sentences): before 33 on screen and 11 gone, board 29 on screen and 15 gone, final 34 on screen and 5 gone. This matches what the user saw: the board camera slides away from the system and earlier results, and the final cut keeps them in view.

Run-to-run drift seen on the same video: held up to 0.03 within pass 3 and 0.17 across designs; fit up to 0.13; sound off 0.00 within pass 3. The scoreboard's default noise band is 0.08, which fits held and is too tight for fit.

## Example tickets (real, unedited apart from length)
- Board, 84.1 to 97.4 s, `{word:197}`, left_screen: "Needed now but not on screen: finding x with its own determinant (has left); y (has left)."
- Before, 0 to 21 s, competing: "winding road sketch, tangled yarn ball sketch, railroad tracks sketch".
- Before, 21.6 to 29.2 s, left_screen: "coefficient matrix (has left); D (has left)."
- Final, 21.6 to 32.2 s, left_screen: "coefficient matrix (never shown)". This is true: the stage shows D but never the matrix it comes from.
- Final, 53 to 63 s, unreadable: "final frames overlap fading y formula with Dx calculation, ghosted numbers hard to parse".
- Board, 91.5 to 98.5 s, frozen (measured): "nothing on screen changes for 7.0 s while the voice keeps talking".
- All three cuts, 13 to 19.6 s, false_claim (severity 3): the screen says Cramer's rule is for "2x2 only", but sources say it works for any square system. The narration says the same, so the error starts in the script and the screen faithfully repeats it. Correct and useful, but it is a script error, not a picture error, and it is not reported every time: in pass 1 the second look set the board's "two by two" aside as not wrong, and in pass 3 the board was not flagged at all.

## What fails, plainly
1. **The learner quiz does not measure the picture.** A model hears the narration perfectly and its attention cannot be pulled away, so video with sound scores about the same as audio alone on every cut. The user's sharpest finding, that audio alone taught better than the board, is not reproduced by any quiz arm. The quiz is still useful as a script check (questions out of scope, wrong steps), and its tickets are real, but as a measure of the visuals it should be read as noise.
2. **Fit and sound off reward a screen full of correct text.** The board writes everything legibly somewhere, so a model reading frames one at a time finds what is spoken almost every time. They do catch decoration (the image cut) but not lost context. Held is what catches lost context, because it forces the reviewer to account for each earlier thing a moment depends on.
3. **The overall mean is not trustworthy yet.** I did not reweight it to fit this one test, because that would be tuning to one topic. With the data so far, held is the only measure to trust for sequence problems.
4. **Cost.** About $0.30 to $0.48 per two-minute video, so a full 100-request benchmark run is about $40 per version. Sequence and the learner notes are the main costs. The audio-alone arm is shared between renders of one narration.
5. **Two bugs found by calibration and fixed.** (a) Running accounts and notes rewritten by the model each chunk quietly dropped early material: these are now append-only in code, with a test. (b) The quote check rejected answers when the model stitched several excerpts together, which zeroed the video arm in pass 3. Quotes are now a list, each piece is checked, and there are tests. The pass 3 learner numbers above come from re-scoring saved notes with `run.ts rescore`, which re-sits the quiz without re-watching.
6. **Not tested:** any other topic, any truth engine log (none of these renders had one), the benchmark runner on real videos (the engine is not connected to the pipeline yet; only the mock runs in tests), and repeat runs of the final cut after the fixes.

## For the engine
- Use `held` and the `left_screen`, `competing` and `unreadable` tickets as the main signal from the understanding loop now. Treat fit and sound off as checks for decoration and missing pictures, and the quiz as a check on the script.
- Next experiment, about $1.50: the three cuts again, three repeats with the fixed code, plus two other topics with renders the user has judged, to see whether held holds up outside one narration.
- Ideas to make the learner sensitive to the picture, not yet tried: give the note-taker the sound in short bursts so it must lean on the screen; or test at pause points, from a single frame plus the last sentence, whether the viewer can say what happens next.

## How to run
```
PROJECTS_DIR=/path/projects node --env-file=.env --experimental-strip-types engine/review/run.ts review <projectDir> video-before.mp4 video.mp4 --repeat 2 --cap 2
node --env-file=.env --experimental-strip-types engine/review/run.ts rescore <projectDir> --cap 0.3
node --env-file=.env --experimental-strip-types engine/review/run.ts bench <version> --map map.json --cap 5   # map: request id to project folder
node --experimental-strip-types engine/review/run.ts board [versionA versionB]
```
`--cap` is a hard stop on dollars for that command. Every call is written to `projects/spend.jsonl`.
