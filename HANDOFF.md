# HANDOFF (updated 2026-11-03, evening)

For the next agent picking up bettervid. Read `AGENTS.md`, then `docs/PLAN.md` (v2, source of truth), then `research/DECISIONS.md`.

## Latest state (Nov 3, about 20:05 Doha)
Merged into main at 20:00: path A (behind `"sceneAuthor": "toolbox"`), sound tied to scene moments (Codex), speed (timings, stage scheduling, parallel critic, cache fixes; Codex) and the taste rerun report. Checks after the merges: tsc clean, test:engine 564, test:pipeline 157. Reports: `docs/briefs/path-a-report.md`, `sound-report.md`, `speed-report.md`, `taste-rerun-report.md`. The request layer (material, research, plan) is briefed for Codex in `docs/briefs/request.md`. Goals per layer are in `docs/layers.html`. Then, about 21:00, the visuals pass on main (no clips made, by Miki's choice): (1) the one-round loop in `pipeline/stages/scene.ts` (`writeOnce`) now builds the draft first (build repairs before any look, so every section is seen once), runs the look review, the art director and the instruments on the same stills, sends the writer its own frames spread over the part with the instruments' readings, and after a built repair renders again and asks the art director whether its fixes landed; if not, one last request (`prompts/scene-review.md` "Check"). The taste review runs on both authoring paths now. (2) The art director is told the writer's means, read from the language and the kits (`meansOf` in scene.ts, `vocabulary` in `engine/language/syntax.ts`), and names them in each fix; it also gets the instruments' readings per frame (`prompts/taste-review.md`). (3) The fill instrument reports `largest`, the share of the usable frame the biggest single thing covers. (4) The truth path: a program may call `measure(name, frame, value)` and declare `proves="..."`; the numbers come back to the writer and reviewers as plain lines (`measureLines` in `engine/language/build.ts`, shown under "What code sees"); taught in `prompts/engine-language.md`. Then (5), after Miki watched merge-min-a3 and saw a value move before its words and 'down' drawn upward: every step a truth thing plays is now a `step` event; `stepLines` (engine/kits/steps.ts) reports when each step played and the words under it, in 'What code sees'; a craft note flags `do steps ... until=` on a few steps; the guide and `STEPS_DOC` say the first time a process plays, each step goes on its words with at=. The sort kit says how it is drawn and which way merges move (`drawn` on the board, shown with the truth steps), and the writer is told to set form= whenever the words say a direction. Tests: engine 570, pipeline 159, tsc clean. The paragraph below is from before these merges.

## State before the merges (Nov 3, about 19:45 Doha)
Deadline: code freeze Wed Nov 4, noon ET (20:00 Doha); submit by 18:00 ET, hard deadline 21:00 ET. Nothing for the submission exists yet (README, demo video, hosting). main is 177 commits ahead of origin and has never been pushed; pushing is Miki's call.

**Read first:** `AGENTS.md` (Miki's own words), `NEXT.md`, `docs/ROADMAP.md` ("Wave 4 status" and "How waves are judged"), `docs/DESIGN-BRAIN.md`, `docs/layers.html` (status chart), and the memory rules in `/Users/miki/.claude/projects/-Users-miki-Desktop-deskt-bettervid/memory/`.

**Rules from today:** every Claude agent doing development runs on Opus; the product roles in test videos are real Muse Spark (Contributor tier, the default in `pipeline/lib/meta.ts`; `META_TIER=standard` switches back). No bench: judge with real clips made through the pipeline that Miki watches, never with bench runs, replays or grading. Judge against the best human work, never against our old engine. Code never decides layout, motion or timing: agents (Spark) write, code carries out and measures. One repair round per section. Equal depth for every tool in the writer's guide, no topic examples. Zero hardcoding; styles may lean choices only as suggestions.

**On main:** wave 4's design brain (`engine/design/`), its three fixes (staging with relations at real scale, steadiness with the full motion vocabulary offered to agents, the hand-drawn texture and empty-first-moment fixes), uploads in the app with PDF, Word, PowerPoint and Excel readers (`pipeline/stages/material.ts`), the Contributor tier, the taste review module (`engine/review/taste.ts`, `prompts/taste-review.md`), and the bundle cleanup. Tests: test:engine 545, test:pipeline 130, tsc clean.

**On branches, not merged:**
- `claude/path-a-b76481` (19 commits ahead of main): path A, the planned main scene path. Spark writes each scene in the scene language with the design brain as a toolbox (`engine/language/toolbox.ts`: depict, sprites made with Muse Image plus SAM, real and found pictures, the stage with relations, the board, every motion), the director's video-wide look, the new tools taught at the old tools' depth in `prompts/engine-language.md` (the old path's guide is byte-identical), one repair round per section (build, look once, every note in one request, unambiguous slips mended in code), and the taste review joined to that round. Selected per project by `"sceneAuthor": "toolbox"`; the old path is still the default. Tests: engine 558, pipeline 141. Report: `docs/briefs/path-a-report.md` on that branch.
- `claude/taste-rerun-45ab70`: a report only (`docs/briefs/taste-rerun-report.md`).
- `sound` and `speed`: Codex is building these now in `.worktrees/sound` and `.worktrees/speed` from `docs/briefs/sound.md` and `docs/briefs/speed.md`. They report in `docs/briefs/sound-report.md` and `speed-report.md` in their worktrees. The school ChatGPT account may not have the keys; their paid real checks may need to run here after merging.
- Uploads round 2 (`docs/briefs/uploads-2.md`, Pro account) was briefed; no `uploads-2` branch exists yet.

**What the clips showed (merge sort, neon, same narration):** `projects/merge-min-a` (path A), `merge-min-b` (old path), `merge-min-a2` (path A with the taste review), each 1:08; the scene stage plus render takes about 4 to 5 minutes for a 1-minute clip when the voice is reused, and a full new 1-minute video takes about 15 minutes. A and B look nearly the same: Spark used none of the new tools (empty `scene/toolbox.json`), and both show small numbers in a mostly empty frame. The taste review named exactly that with specific fixes, but Spark applied only the cheap line-level ones. The first section got no review because its first draft did not build.

**Proposed next fixes for path A (not started, Miki has not approved yet):** (1) send the stills to the writer with the repair notes, so it sees its own frame; (2) the taste reviewer gives its fixes as scene-language lines; (3) find why the sort kit draws itself small on a tall frame (possibly an engine sizing bug); (4) run the look and taste review after a build repair too, still within one round. Then re-run `merge-min-a` once. Muse Wonder as the repair writer was offered and declined for now.

**Then the submission:** merge path A into main (behind its switch), README and submission text, 3 or 4 showcase videos with Spark (one from uploaded files, one with real objects where staging and depictions matter), Miki's decisions on hosting and pushing, the demo video.

**Spend:** Meta budget $100, $64.46 on the ledger (`projects/spend.jsonl`), plus about $10 in older worktree ledgers. Clips today cost cents each on the Contributor tier.

## Earlier state (Nov 2)
**Next job: the universal engine.** Read `docs/ENGINE-PLAN.md`, then start with the foundation. `docs/FABLE-START.md` is the starting prompt. The user wants it as ambitious as possible and is fine with many parallel subagents. It sits on top of Remotion. The user dislikes the word "object" for what viewers see: on screen everything must feel like part of the video, with no boxes.

Hackathon deadline: Wed Nov 4, 21:00 ET, code freeze noon ET, aim to submit by 18:00 ET. Dev budget: $25, with $20.47 on the ledger plus about $0.60 untracked; a higher cap is needed for this work. A Manim test is in progress in `scripts/manim/`; its report will be `research/spikes/S12-manim.md`. Manim is optional.

Open items and the user's ideas live in `docs/FIXES.md`. Read it first.

Pipeline order: plan, research, writer (draft, cut, review, structure), voice, director, assets, annotate, timeline, mix, render, critic. `--only <stage>` runs one stage, `--force <stage>` redoes one.
- **Plan** (`pipeline/stages/plan.ts`): reads the user's message once and sorts what they explicitly asked for by part of the work. Empty means the usual way. Each stage gets its part, marked as deliberate.
- **Writer** is prose-first, and saves each step so a failed run resumes. Personas are data in `personas/`.
- **Length**: `seconds` defaults to 0, so the story decides; a length in the message wins.
- **Images**: styles describe `art` by image type (scene, object, diagram), so subjects stay clear; texture comes from `surface` in the video. Nothing generated stands in for a specific real thing (`mustBeReal`). Broader archive search, a 6 s hold, reuse (at most 3 shots per image), an honest `idea` illustration, then a title card. Generated images are checked for fake writing and redone blank.
- **Annotate** (`pipeline/stages/annotate.ts`, `video/marks.tsx`): Spark looks at an image twice and draws ring, box, underline, arrow, line, dots, label or path, timed to spoken words. Most shots get none.
- **Critic** (`pipeline/stages/critic.ts`): reviews one frame per shot and files tickets; one fix round re-renders.
- **Board** (`video/Board.tsx`, `pipeline/stages/board.ts`, `prompts/board.md`): `motion: "board"` swaps the director, assets and annotate for one live whiteboard. Spark plans scenes (hero, pair, steps, cycle, statement), code lays them out, drawings are generated and trimmed, and the camera ends on the whole board.
- **Stage** (`video/Stage.tsx`, `pipeline/stages/stage.ts`): the teaching engine. When the plan sets `notation`, any style uses it instead of shots or the board. Spark writes states as compact text; atoms with the same id travel between states. No camera.
- **Credits**: end card plus a source line on real images. Render uses CRF 23.
- **Web app** (`app/server.ts`, `app/public/index.html`, no new packages): `npm run app`, then http://localhost:4173. Prompt box, optional style, narrator and length, live stages, the plan, player, script, critic notes, sources and gallery. Caption editing re-renders with no model calls. Replay walks through a finished run for free, for when the budget or rate limits stop new videos. It spawns the real pipeline, one run at a time, and listens on 127.0.0.1 only. Setting `HOST` makes it public: new videos are limited (`RUNS_PER_DAY` 20, `RUNS_PER_VISITOR` 2) and editing is off; those limits are tested, and `BUDGET_USD` is the hard stop. A `Dockerfile` is written but has never been built, because Docker was not running. Not hosted yet: the user must pick a provider, and it needs a volume at /srv/projects and the keys passed in at run time.
- **Simulations**: not in the pipeline. `research/spikes/S11-simulation.md` has the result: formula-based ideas only, and they need a frame review. Spike code is in `scripts/s11/`.
- **Network from Doha**: IPv4 only (`pipeline/lib/meta.ts`). Background tasks die when the session restarts, so long renders should run detached with a log in the project folder.
- **Dev budget**: $100, raised by the user on Nov 3. Older agent worktrees kept their own ledgers, about $10 outside projects/spend.jsonl. The ledger misses the simulation spikes, about $0.37.

Rules from the user: every fix must be general, never tuned to one video, and prompt examples must not come from the test topic. They dislike fallbacks: prefer repair loops, and say so plainly if a fallback remains. Discuss design ideas first unless told to go ahead.

## Where things stand
- Phases 0 to 3b are done: research (6 files), `research/HYPOTHESIS.md`, `research/REVIEW.md`, `research/DECISIONS.md` (27 items), `docs/PLAN.md` v2, `docs/pipeline.html` (v2 diagram).
- Repo: https://github.com/Mikiyas-Meles-Assefa/bettervid (public).
- **Done Oct 29:** repo skeleton (plan section 7). Spikes S1, S2, S3, S5, S6, S7, S8, S9, S10 PASS, S4 PASS with conditions; results in `research/spikes/`, scripts in `scripts/spikes/`. Key facts: request 1152x2048 for 9:16; anchor + parallel `/images/edits` keeps a character; all 5 styles work; SAM edges are clean but phrases need retries (`@meta-sam/parser` installed to decode masks); Spark video costs ~261 tokens/s at 2 fps, chunk to ~10 s; the critic caught 5 of 5 planted faults from MP4 and 4 of 5 from keyframes; Remotion 4.0.539 renders 60 s at 1080x1920 in ~100 s on the M4 (best at concurrency 4 to 5, `video/spike/`); free archives (Commons, NASA) gave a usable licensed image for 21 of 24 beats across 3 topics, Openverse was down. Spent about $0.73 Meta in total (S1 and S9 were run twice by two agents at once) and 262 ElevenLabs characters.
- Node needs `setDefaultAutoSelectFamilyAttemptTimeout(2000)` to reach api.meta.ai reliably from Doha (`scripts/lib/util.ts`); `scripts/lib/meta.ts` also retries network errors.
- **Phase 4 is done.**
- **Build, Oct 29 evening: the Fri Oct 30 gate is met early.** `npm run pipeline -- new "<prompt>" --style collage --mode history --seconds 30` runs stages 1 to 7 and writes `projects/<id>/video.mp4` (gitignored). First video: John Snow, 34 s, 15 shots, $0.51 of Meta, ~4 min end to end (render ~60 s).
  - `schemas/project.ts`: the Project JSON contract. `styles/*.json` (collage, flat, whiteboard) and `prompts/*.md` (craft rules, research, writer, director) are data.
  - `pipeline/stages/`: research (Spark + web_search, structured output), writer, voice (ElevenLabs v4 word times), director (shots on word indices; receipts filled from the fact sheet by code), assets (archives + Spark pick, Muse Image fallback, SAM cutouts baked by `pipeline/tools/bake_cutout.py`), timeline, render (Remotion, concurrency 4).
  - Caching: each stage is skipped when its inputs are unchanged; assets also cache per shot. Code changes are not in the cache key, so use `--force <stage>` after editing a stage.
  - Spend ledger: `projects/spend.jsonl`; `BUDGET_USD` (default 5) stops runs at the cap. The user approved $5 of dev runs on Oct 29; $2.76 used so far. ElevenLabs: about 3,600 credits used for the kit plus ~175 per narration (Starter plan).
  - Asset rules (Oct 29, after reviewing 3 test videos): the picker gets the topic and rejects images whose visible labels name another event or mission; real images need 1000 px on the short side; `styles/*.json` `realAssets` is "prefer" (collage) or "proof" (flat, whiteboard: generate almost everything); no cutouts of scenery; never generate a likeness of a named real person (title card instead). The asset stage never edits shots: fallbacks go in `Asset.override` and the timeline applies them. Bump `RULES_VERSION` in `pipeline/stages/assets.ts` when picking rules change.
  - Commons only serves standard thumbnail widths: `/400px-` returns 400, `/500px-` works.
  - Sound (stage `mix`, between timeline and render): `audio/kit.json` defines the SFX and music moods (mood by mode). `pipeline/lib/kit.ts` generates each item once with ElevenLabs (SFX 200 credits, music 900 credits/min), keeps the source MP3 in `audio/kit/src/` (committed) and rebuilds the normalized WAVs from it (gitignored). Effects: impact on title slams, paper on cutouts and receipts, whoosh only on shot-type changes, at least 1.5 s apart. Music ducks under the voice (sidechaincompress), two-pass loudnorm to -14 LUFS / -1 dBTP; all three test videos measure -14.0 to -14.1 LUFS.
  - Test videos so far: John Snow (collage), Apollo 13 (collage), why the sky is blue (flat), all in `projects/`.
  - Gotchas found: with web search Spark sends progress messages before the JSON (take the last message); Muse Image refuses some prompts (beer, bodies) with `content_policy_violation` (retry with the neutral query, else title card).
- **Next (plan section 9, Sat Oct 31):** shot types 3, 5, 6, 7, 8, 10, 11; style loader with the 3 core styles tested; license records and credits card; music and SFX (stage 5d); then the critic (stage 8) and the fix round.

## Keys (`.env`, gitignored, chmod 600)
- `ELEVENLABS_API_KEY`: set and verified (Starter plan, 40,000 chars/month, 0 used). The plan budgeted ~150k chars, so an upgrade to Creator may be needed later; ask the user first (it costs money).
- `META_API_KEY`: set. It is the user's existing key named "vid". Do not create new keys: creating one on dev.meta.ai logs the session out every time.
- Fireworks (Glimmer), Modal, Baseten: accounts exist, keys not in `.env` yet. Fill in when needed.

## User preferences (follow strictly)
- Never use em dashes, in replies or files.
- No attribution lines in commits or code.
- Subagents run on **Sonnet**. Opus only as a backup if Sonnet is rate-limited, and say so.
- Never submit, spend money or take irreversible actions without an explicit yes.
- Run long jobs in the background and keep talking.
- Commit and push only when the user asks (they OKed pushing docs and research on Oct 29).
- Quality bar is the user's, not lowered: Veritasium and top IG creator level. Nothing hardcoded: styles and modes are data.
- The user is Mikiyas, a CMU Qatar student in Doha, solo on the Indie track. Exams: Chemistry Oct 29; Shell Lab due Mon Nov 2 (no new code that day).

## Context outside this repo
- Hackathon notes, accounts and credits: `/Users/miki/Desktop/deskt/Me/applications/hackathons/2026/meta-global-ai-developer-hackathon/application.md`
- Deadline: Wed Nov 4, 21:00 ET (Thu Nov 5, 05:00 Doha). Aim to submit by 18:00 ET.
- Meta API: base `https://api.meta.ai/v1`, OpenAI SDK compatible. Watch for 429s: backoff with Retry-After.
