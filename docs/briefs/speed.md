# Brief: make a video faster without changing what it looks like

For a separate coding agent. Self-contained; read it fully before starting.

## Context
bettervid makes narrated 9:16 videos from a prompt or the user's files, through stages run in order by `pipeline/run.ts` (material, plan, research, writer, direction, voice, scene, timeline, mix, render, critic). Read `AGENTS.md`, `HANDOFF.md`, `pipeline/run.ts`, `pipeline/lib/meta.ts` and `pipeline/lib/project.ts`. A full 1-minute video takes about 15 minutes today. Real timings from `projects/merge-w2/run*.log` (a 4:42 video): writer 5.3 min, direction 6.8 min, voice 0.5 min, scene 2 to 10 min, mix under 1 min, render 4 to 6 min, critic 2.5 to 5 min. The slow stages are long Spark reasoning calls made one after another.

## The job
1. **Measure first.** Add per-stage and per-model-call timing to every run (wall time, model, effort, tokens in and out), written to the project's run log and to `projects/<id>/timings.json`. Report where the time goes on one real run.
2. **Run independent work at the same time.** Inside stages, model calls that do not depend on each other run in parallel (respect Spark's Contributor-tier limit of 150 requests a minute; `post` in `meta.ts` already retries 429s). Between stages, start a stage as soon as what it needs exists: for example, anything that only needs the script need not wait for unrelated stages. Do not change any stage's inputs, prompts or outputs.
3. **Reasoning effort.** Where a call's effort can drop without changing its output's quality, make it configurable per stage, keep today's values as defaults, and report which calls dominate time so the user can decide. Do not lower any default yourself.
4. **Caching.** Make sure no stage redoes work whose inputs did not change (stages are already cached by hash in places; find the gaps).
5. **Tests** for the scheduler (order, parallelism, a failed stage stops what depends on it) with fake stages. Keep `npx tsc --noEmit -p .`, `npm run -s test:pipeline` and `npm run -s test:engine` passing.
6. **One real check**: run one new 30-second project end to end before and after (same prompt), and report both total times and the per-stage table. Meta spend at most $1.

## Stay inside this folder
Read and write only inside this repository folder (`/Users/miki/Desktop/deskt/bettervid`, including your worktree under `.worktrees/`). Do not read, list or search anything outside it.

## Do not touch
`pipeline/stages/scene.ts`, `pipeline/stages/mix.ts`, `pipeline/lib/kit.ts`, `audio/`, `engine/`, `prompts/`, `app/` and `bench/`: other sessions are changing them now. Limit changes to `pipeline/run.ts`, `pipeline/lib/` (except kit.ts), new files, and the smallest timing hooks in other stages.

## Rules
- Work in a git worktree on a new branch, not in the main checkout: `git worktree add .worktrees/speed -b speed main`, then work in `.worktrees/speed` (symlink `node_modules` from the main checkout if missing; remove the link before committing). Commit with plain messages and NO Co-Authored-By or "Generated with" lines. Do not push; do not merge to main.
- No em dashes anywhere. Match the surrounding code style and comment density.
- Never change what a video looks or sounds like; only when work happens.
- Never commit `.env` or secrets.

## Report
At the end, write `docs/briefs/speed-report.md` in your worktree: what changed, the before and after timings, what still dominates, and spend.
