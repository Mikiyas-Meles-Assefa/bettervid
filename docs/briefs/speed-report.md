# Speed work

Branch: `speed`. Base: `4392c3c`. Worktree: `.worktrees/speed`. No push or merge.

## Changes

- `pipeline/run.ts` uses an explicit dependency graph. Ready stages can start together. A failure prevents further scheduling and dependants, and work already in flight drains before the run exits. `--only`, `--until`, `--force`, engine and legacy routing retain their behavior. `PIPELINE_SCHEDULE=serial` provides a comparison mode for the stage scheduler.
- Assets and annotation use replenishing worker pools, keeping the existing concurrency of five and preserving result order. A slow item no longer holds up the next batch.
- Engine critic frame groups run independently, with up to five calls. Its visual review and direction check overlap, then their results are combined in the original order. Shot critic repairs remain sequential because later repairs can read earlier replacements.
- Every CLI invocation writes stage and Meta call wall times to the project's `run.log` and `timings.json`. Call records include the wire model, reasoning effort, input and output token counts, and success or failure. Meta call wall time includes rate-limit waiting and retries. Voice requests also have call timing; ElevenLabs does not report tokens, so these are `null`. No prompts, API keys, headers or responses are written by the timing hooks. `timings.json` describes the latest invocation; `run.log` retains earlier invocations.
- The Meta client admits at most 150 request attempts per rolling minute per process, including retries. Existing 429 and network retry behavior remains in place. Other sessions using the same credentials can still cause server-side 429s.
- `PIPELINE_EFFORT_<STAGE>` optionally replaces reasoning effort for that stage, for example `PIPELINE_EFFORT_DIRECTOR=low`. Valid values are `minimal`, `low`, `medium`, `high`. Unset preserves each call's existing default. Overrides participate in stage and partial cache hashes. No defaults were lowered, and no quality claim is made for lower effort.
- Cache gaps fixed: asset keys now include narration context, topic, user wishes and supplied pictures; a missing cached image is regenerated. Annotation keys include image contents, word timing, shot boundaries, user wishes and the annotation prompt. Mix detects a new narration at the same filename, and render detects a CRF change. Concurrent project saves are serialized and atomically replace `project.json`.

## Dependencies and remaining limits

The current engine chain mostly has genuine dependencies. Direction can insert words and holds into the script, so voice must wait for it. The director needs recorded word times, annotation needs images, scene needs those annotations, and render needs the mixed timeline. These were not overlapped. Scene already runs independent sections in a worker pool; `scene.ts`, `mix.ts`, `kit.ts`, engine, audio sources and prompts were left unchanged.

The serial comparison switch affects top-level scheduling. It does not revert the new worker pools or critic parallelism. The baseline was launched before those changes were loaded.

## Validation

- `npx tsc --noEmit -p .`: pass.
- `npm run -s test:pipeline`: 141 passed.
- `npm run -s test:engine`: 545 passed. The first run alongside the pipeline suite failed two existing wall-clock performance assertions. The final run with repository-local temporary files passed without changes to engine code or thresholds.
- New tests cover dependency order, independent overlap, failure blocking dependants and draining running work, serial scheduling, invalid graphs, replenishing workers, request admission at 150 per minute, timing and effort isolation, no prompt leakage, default preservation, partial cache invalidation, unchanged stage reuse, concurrent saves, and narration replacement at the same path.

## Real comparison

Both projects requested 30 seconds, flat style, default engine visuals and default reasoning effort, with this exact prompt:

> Explain in 30 seconds why a stack is last in, first out, using three plates. Show the operations on screen.

- Before: `projects/explain-in-30-seconds-why-a-stack-is-las-1e2e1c/video.mp4`, **30.03 seconds**, no generated pictures, 23 Meta calls.
- After: `projects/explain-in-30-seconds-why-a-stack-is-las-a97724/video.mp4`, **42.90 seconds**, two generated pictures, 31 Meta calls, plus four timed ElevenLabs requests. The existing writer and direction did not hold the requested length. I did not trim, shorten or alter their outputs to make the comparison look better.

**No end-to-end speedup was measured in this fresh pair.** Active processing took **711.3 seconds (11:51.3) before** and **1,024.5 seconds (17:04.5) after**, an increase of 313.2 seconds (44.0%). The after run was longer, made pictures and annotations, and had more scene repair work. Sampling and API latency also varied. These are real profiles, not a controlled estimate of the scheduler's effect.

The baseline stopped at timeline because the default `python3` lacked Pillow. Its saved scene was resumed with the repository-documented `PYTHON=python3.14`, without rerunning the models. The original critic from `4392c3c` was used for this sequential tail. Baseline active time sums the two timed invocations and includes the failed timeline attempt. Its chronological elapsed time was **808.4 seconds (13:28.4)**, including 97.1 seconds between invocations. A prior sandbox DNS failure reached no API. The after run completed in one invocation. Temporary files for the resumed tail and after run were kept under `projects/.tmp`.

Per-stage wall time, in seconds. Material had no files; board and teaching-stage routing were skipped. Stage rows exclude cache-key construction and checkpoint persistence, so they do not quite sum to invocation totals.

| Stage | Before | After |
|---|---:|---:|
| plan | 27.7 | 33.0 |
| research | 25.4 | 38.1 |
| writer | 133.6 | 193.3 |
| direction | 65.6 | 53.9 |
| voice | 6.2 | 7.1 |
| director | 51.7 | 80.3 |
| assets | 0.0 | 34.7 |
| annotate | 0.0 | 38.0 |
| scene | 260.5 | 369.6 |
| timeline | 1.5 | 1.4 |
| mix | 4.0 | 6.2 |
| render | 31.8 | 101.8 |
| critic | 102.3 | 67.0 |

Both videos finished the standard critic. Its visual design score was 3/5 before and 2/5 after, with one severe visual issue each. The after scene also reported unresolved severe issues after its existing repair and rewrite loop. These runs are not quality passes. The speed changes preserve prompts, defaults and repair rules; this experiment does not establish equal visual quality between independent model samples.

## Controlled critic comparison

The new critic was also run on the **same baseline MP4**, with the direction-map cache removed so both versions made all three model calls. Model, effort and input-token counts matched: visual review 7,066 input tokens at medium, direction map 2,305 at low, opening check 3,953 at low.

- Sequential: **102.3 seconds**.
- Parallel: **45.6 seconds**.
- Observed reduction: **56.6 seconds (55.4%)**.
- The parallel call durations sum to 71.0 seconds and span 44.4 seconds: about **26.6 seconds of actual overlap**. Faster individual API responses account for much of the remaining difference. This is one sample, not a guaranteed 55% speedup.
- The MP4's SHA-256 before and after was identical. This check did not re-render the video.

Evidence: `projects/speed-evidence/critic-parallel-timings.json`, `critic-parallel.log`, `baseline-video.sha256`, plus the baseline project's `timings-before-tail.json` and `timings-baseline-tail.json`. Full stdout logs and final validation logs are in `projects/speed-evidence/`. The baseline resume helper and original critic copy are local measurement artifacts in `projects/`, not production code.

## What still dominates

Scene is the largest stage: 260.5 seconds before, 369.6 after. Its independent sections already overlap, but authoring, checking, repairs and reviews within a section depend on earlier results. The brief excludes changes to `scene.ts`.

The other costly calls, with all defaults preserved:

| Call group | Before calls / total call seconds | After calls / total call seconds |
|---|---:|---:|
| Scene, medium | 10 / 358.8 | 11 / 429.2 |
| Writer, high | 4 / 121.6 | 4 / 176.8 |
| Direction, high | 1 / 65.6 | 1 / 53.9 |
| Director, medium | 1 / 51.7 | 1 / 80.3 |
| Critic visual review, medium | 1 / 70.3 | 1 / 43.9 |
| Critic direction checks, low | 2 / 30.7 | 2 / 62.9 |

Call seconds include overlapping calls and must not be added to stage wall times. Writer draft, cut, review and demonstration check form a dependent chain. Changing high effort there is a quality experiment for a later decision, not a default change made here. The director, annotation and critic are candidates for separate lower-effort evaluation. No such quality evaluation was performed in this budget.

## Spend

The isolated worktree ledger, `projects/spend.jsonl`, totals **$0.15214 Meta**, below the $1 allowance:

- Before project through its original critic: $0.05856.
- Fresh after project: $0.09149.
- Controlled parallel critic check: $0.00209.

The runs used **292 ElevenLabs plan credits** for narration (129 before, 163 after). Music and sound effects used committed cached sources and generated no new kit content. Runs used `BUDGET_USD=1`. No additional keys, paid plans, push or merge were used.
