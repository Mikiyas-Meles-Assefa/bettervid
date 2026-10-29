# HANDOFF (2026-10-29, Doha time ~14:35)

For the next agent picking up bettervid. Read `AGENTS.md`, then `docs/PLAN.md` (v2, source of truth), then `research/DECISIONS.md`.

## Where things stand
- Phases 0 to 3b are done: research (6 files), `research/HYPOTHESIS.md`, `research/REVIEW.md`, `research/DECISIONS.md` (27 items), `docs/PLAN.md` v2, `docs/pipeline.html` (v2 diagram).
- Everything is pushed to https://github.com/Mikiyas-Meles-Assefa/bettervid (public). No product code yet.
- **Done Oct 29:** repo skeleton (plan section 7). Spikes S1, S2, S3, S5, S6, S9, S10 PASS, S4 PASS with conditions; results in `research/spikes/`, scripts in `scripts/spikes/`. Key facts: request 1152x2048 for 9:16; anchor + parallel `/images/edits` keeps a character; all 5 styles work; SAM edges are clean but phrases need retries (`@meta-sam/parser` installed to decode masks); Spark video costs ~261 tokens/s at 2 fps, chunk to ~10 s; the critic caught 5 of 5 planted faults from MP4 and 4 of 5 from keyframes; Remotion 4.0.539 renders 60 s at 1080x1920 in ~100 s on the M4 (best at concurrency 4 to 5, `video/spike/`). Spent about $0.60 Meta in total (S1 and S9 were run twice by two agents at once) and 262 ElevenLabs characters.
- Node needs `setDefaultAutoSelectFamilyAttemptTimeout(2000)` to reach api.meta.ai reliably from Doha (`scripts/lib/util.ts`); `scripts/lib/meta.ts` also retries network errors.
- **Left in phase 4:** S8 (archives cover 70% of beats across 3 topics).
- **Earlier plan, phase 4 spikes** S1 to S10 in `docs/PLAN.md` section 8. Start with the cheap, fast ones: S1 (Muse Image true 9:16), S6 (ElevenLabs v4 word timestamps), S9 (`n=4` vs 150 RPM), S10 (critic video token cost via the free token-count endpoint). Save each result in `research/spikes/S<n>-<name>.md` with inputs, outputs, cost, timing, verdict, and add them to `research/README.md`.
- Then the build per `docs/PLAN.md` section 9. **Gate: a complete 30 s video end to end by Fri Oct 30 night.**

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
