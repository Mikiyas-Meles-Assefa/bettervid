# HANDOFF (2026-10-29, Doha time ~14:35)

For the next agent picking up bettervid. Read `AGENTS.md`, then `docs/PLAN.md` (v2, source of truth), then `research/DECISIONS.md`.

## Where things stand
- Phases 0 to 3b are done: research (6 files), `research/HYPOTHESIS.md`, `research/REVIEW.md`, `research/DECISIONS.md` (27 items), `docs/PLAN.md` v2, `docs/pipeline.html` (v2 diagram).
- Everything is pushed to https://github.com/Mikiyas-Meles-Assefa/bettervid (public). No product code yet.
- **Next: phase 4 spikes** S1 to S10 in `docs/PLAN.md` section 8. Start with the cheap, fast ones: S1 (Muse Image true 9:16), S6 (ElevenLabs v4 word timestamps), S9 (`n=4` vs 150 RPM), S10 (critic video token cost via the free token-count endpoint). Save each result in `research/spikes/S<n>-<name>.md` with inputs, outputs, cost, timing, verdict, and add them to `research/README.md`.
- Then the build per `docs/PLAN.md` section 9. **Gate: a complete 30 s video end to end by Fri Oct 30 night.**

## Keys (`.env`, gitignored, chmod 600)
- `ELEVENLABS_API_KEY`: set and verified (Starter plan, 40,000 chars/month, 0 used). The plan budgeted ~150k chars, so an upgrade to Creator may be needed later; ask the user first (it costs money).
- `META_API_KEY`: **not set yet.** The user chose a new key named "bettervid" on https://dev.meta.ai/api-keys?team_id=1085092900678378. The previous agent clicked Create, but the T3 browser session got logged out (401) right after, so it's unknown whether the key was created. Ask the user to log in to dev.meta.ai in the T3 browser (or create the key themselves), check the key list first so there's no duplicate, and copy the key into `.env`. Never paste keys into chat or commit them.
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
