# HANDOFF (updated 2026-10-30)

For the next agent picking up bettervid. Read `AGENTS.md`, then `docs/PLAN.md` (v2, source of truth), then `research/DECISIONS.md`.

## Latest state (Oct 30)
Open items and the user's ideas live in `docs/FIXES.md`. Read it first.

Pipeline order: plan, research, writer (draft, cut, review, structure), voice, director, assets, annotate, timeline, mix, render, critic. `--only <stage>` runs one stage, `--force <stage>` redoes one.
- **Plan** (`pipeline/stages/plan.ts`): reads the user's message once and sorts what they explicitly asked for by part of the work. Empty means the usual way. Each stage gets its part, marked as deliberate.
- **Writer** is prose-first, and saves each step so a failed run resumes. Personas are data in `personas/`.
- **Length**: `seconds` defaults to 0, so the story decides; a length in the message wins.
- **Images**: styles describe `art` by image type (scene, object, diagram), so subjects stay clear; texture comes from `surface` in the video. Nothing generated stands in for a specific real thing (`mustBeReal`). Broader archive search, a 6 s hold, reuse (at most 3 shots per image), an honest `idea` illustration, then a title card. Generated images are checked for fake writing and redone blank.
- **Annotate** (`pipeline/stages/annotate.ts`, `video/marks.tsx`): Spark looks at an image twice and draws ring, box, underline, arrow, line, dots, label or path, timed to spoken words. Most shots get none.
- **Critic** (`pipeline/stages/critic.ts`): reviews one frame per shot and files tickets; one fix round re-renders.
- **Board** (`video/Board.tsx`): `motion: "board"` in a style makes one continuous canvas with a moving camera and a final pull-back. Whiteboard uses it.
- **Credits**: end card plus a source line on real images. Render uses CRF 23.
- **Web app** (`app/server.ts`, `app/public/index.html`, no new packages): `npm run app`, then http://localhost:4173. Prompt box, optional style, narrator and length, live stages, the plan, player, script, critic notes, sources and gallery. Caption editing re-renders with no model calls. Replay walks through a finished run for free, for when the budget or rate limits stop new videos. It spawns the real pipeline, one run at a time, and listens on 127.0.0.1 only. Setting `HOST` makes it public: new videos are limited (`RUNS_PER_DAY` 20, `RUNS_PER_VISITOR` 2) and editing is off; those limits are tested, and `BUDGET_USD` is the hard stop. A `Dockerfile` is written but has never been built, because Docker was not running. Not hosted yet: the user must pick a provider, and it needs a volume at /srv/projects and the keys passed in at run time.
- **Simulations**: not in the pipeline. `research/spikes/S11-simulation.md` has the result: formula-based ideas only, and they need a frame review. Spike code is in `scripts/s11/`.
- **Network from Doha**: IPv4 only (`pipeline/lib/meta.ts`). Background tasks die when the session restarts, so long renders should run detached with a log in the project folder.
- **Dev budget**: $15, raised by the user on Oct 30. The ledger misses the simulation spikes, about $0.37.

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
