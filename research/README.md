# research/

Ground truth for bettervid. Read this first after any context reset.

| File | What it is |
|---|---|
| `BRIEF.md` | Shared brief for research agents: project, pipeline hypothesis, output rules |
| `meta.md` | Every Meta model and Meta open-source tool we can use: Muse Spark/Wonder/Image, SAM 3.1, Voice Transcribe, open weights, other Meta OSS |
| `voice-audio.md` | TTS, forced alignment, STT, music, SFX: ElevenLabs vs cheaper and open-source options |
| `visual-gen.md` | Image and video generation for b-roll, depth/parallax, animating stills, matting, upscaling, talking characters |
| `assets-rights.md` | Where real images, clips, archival and memes come from, search APIs, licenses and attribution |
| `render-typography.md` | Remotion, Manim and alternatives, captions, typography and fonts, render speed and cost |
| `craft-market.md` | How top editors and channels build videos, retention craft, competitors, pricing, users |
| `HYPOTHESIS.md` | Phase 2: the pipeline claim, model per stage, cost and time, hypotheses H1 to H10 with tests and fallbacks |
| `REVIEW.md` | Phase 3: adversarial feasibility review of the hypothesis |
| `DECISIONS.md` | What we take, change or reject from REVIEW.md (27 items). Source of truth for v2 |
| `../docs/pipeline.html` | Pipeline diagram (open in a browser) |
| `spikes/` | Phase 4 spike results, one file each: `S1-muse-image-916.md`, `S2-character-consistency.md`, `S3-styles.md`, `S4-sam-cutouts.md`, `S5-critic-faults.md`, `S6-elevenlabs-timestamps.md`, `S7-remotion-render.md`, `S8-archive-coverage.md`, `S9-image-n4-rpm.md`, `S10-video-tokens.md`. All PASS (S4 with conditions) |
| `sources/<topic>/` | Saved excerpts of primary sources (URL, date retrieved, verbatim key parts) |

Phase 4 done: all ten spikes S1 to S10 passed (S4 with conditions). Next: the build per `docs/PLAN.md` section 9.

Confidence tags used in all files: `[verified]` official source read, `[reported]` third party, `[unverified]` inferred.
