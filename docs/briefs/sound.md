# Brief: sound tied to what happens on screen

For a separate coding agent. Self-contained; read it fully before starting.

## Context
bettervid makes narrated 9:16 videos; the goal is the best video creation platform in the world, for any purpose. Read `AGENTS.md` (including the user's own words), `docs/ROADMAP.md` (wave 6), `HANDOFF.md` (the Sound paragraph: the kit, the mix, loudness targets), `research/teaching-tempo.md` (the "sound from events" and "music moves at event boundaries" notes), and `docs/ENGINE-CONTRACT.md`.

Today `pipeline/stages/mix.ts` places a few effects by shot type (`placeEffects`), lays a music bed by mode, ducks it under the voice, and masters to -14 LUFS / -1 dBTP. `audio/kit.json` and `pipeline/lib/kit.ts` define and generate the effects and music with ElevenLabs once, keeping source MP3s in `audio/kit/src/`. Engine scenes already carry events: `emit NAME` in the scene language (`prompts/engine-language.md`) becomes `emit(name, frame, data)` in the compiled scene, and truth-kit steps (a comparison, a swap, a merge) happen at known frames. The direction plan (`Project.direction`, types in `schemas/project.ts`) marks events with `feel`, `sound`, holds and reveals.

## The job
1. **Collect sound moments from the built scene**: every `emit`, every computed step (compare, swap, take, land), entrances and reveals of things the direction marks, and the direction's holds and event boundaries. Read them from the compiled scene the timeline already builds (see `pipeline/stages/timeline.ts`), not by guessing from text.
2. **Choose sounds by reasoning, not rules.** One Spark call per video (see `pipeline/lib/meta.ts` `json`) gets the moments with what each one is (and the video's intent, style and `feel` per event) and picks, for each moment worth a sound, a sound from the kit or a new kit item to generate, with a level. It may leave most moments silent; restraint is part of the job. Never fixed tables of "event type X gets sound Y": the user has said there must be no hardcoding, because nobody knows what people will use this for.
3. **Music that follows the story**: music changes where the direction's `feel` changes and at event boundaries, sits lower or drops out under holds and reveals when that serves the moment, and never swells on top of an event it should support. Decided by the same reasoning, per video.
4. **Grow the kit when needed**: if a chosen sound is not in the kit, generate it once with ElevenLabs (as `kit.ts` does), cache it, and reuse it across videos. Keep each generation small; at most 20 new kit items in total, and report the credits used.
5. **Keep the master clean**: no more than one effect pulling attention at a time, effects quieter than the voice, loudness on target. Measure loudness with ffmpeg as the stage does today.
6. **Tests**: unit tests for collecting moments from a compiled scene, the placement and spacing, and the music changes, with a fake reasoner (see existing `*.test.ts`). Keep `npx tsc --noEmit -p .`, `npm run -s test:pipeline` and `npm run -s test:engine` passing.
7. **One real check**: run only `--only mix --force mix` on two existing engine projects in `projects/` (for example `merge-w2` and `stats-w2`, which have scenes, narration and a direction plan), then re-render one with `--only render` and listen to it. Meta spend at most $0.50.

## Do not touch
`engine/design/`, `bench/`, `app/`, and the early pipeline stages (plan, research, writer, direction): other sessions are changing them now. Limit changes to `pipeline/stages/mix.ts`, `pipeline/lib/kit.ts`, `audio/`, new files, and the smallest read-only hook in `pipeline/stages/timeline.ts` if needed.

## Rules
- Work on a new branch (`git checkout -b sound` from main). Commit with plain messages and NO Co-Authored-By or "Generated with" lines, ever. Do not push; do not merge to main.
- No em dashes anywhere. Match the surrounding code style and comment density.
- General, never tuned to one video or topic; repair over fallbacks.
- Never commit `.env` or secrets. Do not create keys on dev.meta.ai.
- Rendering needs `BETTERVID_CHROME=/Users/miki/Desktop/deskt/bettervid/node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell RENDER_CONCURRENCY=3 PYTHON=python3.14`.

## Report
At the end, write `docs/briefs/sound-report.md`: what was built, which sounds were chosen where in the two test videos and why, loudness numbers, credits and Meta spend, and what is weak.
