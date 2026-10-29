# HANDOFF (2026-10-29, Doha time ~19:45)

For the next agent picking up bettervid. Read `AGENTS.md`, then `docs/PLAN.md` (v2, source of truth), then `research/DECISIONS.md`.

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
  - Spend ledger: `projects/spend.jsonl`; `BUDGET_USD` (default 5) stops runs at the cap. The user approved $5 of dev runs on Oct 29; $2.61 used so far.
  - Asset rules (Oct 29, after reviewing 3 test videos): the picker gets the topic and rejects images whose visible labels name another event or mission; real images need 1000 px on the short side; `styles/*.json` `realAssets` is "prefer" (collage) or "proof" (flat, whiteboard: generate almost everything); no cutouts of scenery; never generate a likeness of a named real person (title card instead). The asset stage never edits shots: fallbacks go in `Asset.override` and the timeline applies them. Bump `RULES_VERSION` in `pipeline/stages/assets.ts` when picking rules change.
  - Commons only serves standard thumbnail widths: `/400px-` returns 400, `/500px-` works.
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
