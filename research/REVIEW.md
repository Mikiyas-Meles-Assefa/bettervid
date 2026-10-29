# REVIEW: adversarial read of HYPOTHESIS.md (2026-10-29)

Scope: BRIEF.md, HYPOTHESIS.md and the six research files. Spot-checked sources/meta, sources/voice-audio, sources/render-typography. Re-fetched dev.meta.ai/docs/pricing-rate-limits: it confirms Muse Image 150 RPM, billed per returned image, and says nothing on whether `n>1` counts as 1 or n requests toward the limit. It also gives no video token rate. No keys used, nothing signed up for.

## 1. Verdict

1. Feasible in 5 days: a narrow version is. The full 20-primitive, 7-stage, multi-vendor pipeline is not. You have about 3.5 real build days (Oct 30, 31, Nov 1, 3, and part of Nov 4, minus Nov 2 and the submission video/write-up).
2. Quality you can honestly reach: the top of the AI "faceless explainer" tier, a Vox/Harris-style paper-collage or flat-illustration look with strong captions, sound and receipts. Not Veritasium. Veritasium and Kurzgesagt win on real experiments, on-camera humans and hand-built animation; stills with parallax read as "very good slideshow" next to them.
3. The claim "a viewer cannot tell it apart from a good human-edited explainer" will fail H10 for most topics. Drop it. Claim "a sourced, edited explainer in minutes" instead.
4. The cost ($2 to $3) and time (8 to 15 min) are optimistic by about 20 to 60 percent once the critic loop is priced and sequenced honestly. Real: about $3 to $4 and 18 to 25 min, with b-roll $4.5 to $5.
5. The biggest risks are not model quality. They are: unproven critic-on-MP4, solo build scope, Remotion-on-Modal setup, the $150 credit budget, and the judge experience (a 20 minute job with shared keys and a 150 RPM limit).

## 2. Arithmetic check

Assumptions are stated per stage. Prices from meta.md / pricing-limits.md unless noted.

| Stage | My assumptions | Cost | Time | HYPOTHESIS | Verdict |
|---|---|---|---|---|---|
| 1 Research | 6 to 8 agentic turns, 8 searches ($0.0025 each = $0.02), context grows 10k to 80k tokens; 360k input tokens re-read (uncached $0.45, cached $0.12), 12k output ($0.05). PDF of 50 page-images adds ~70k tokens ($0.09). | $0.20 to $0.55 | 2 to 4 min (search turns plus reasoning) | $0.30, 1 to 2 min | Cost OK. Time low by about 2x. Docs say multi-hop search is "less dependable". |
| 2 Writer | 14k in ($0.018), 15k out incl. reasoning ($0.064), 2 to 3 drafts | $0.10 to $0.25 | 1 to 2 min | $0.10, 1 min | Low by up to 2.5x. Trivial in dollars. |
| 3 Director (Wonder) | 12k in ($0.048); out = 7k JSON + 10 to 30k reasoning = 17 to 37k at $20/M | $0.39 to $0.79; x2 on a schema retry | 2 to 4 min (20 to 40k output tokens at ~100 to 200 tok/s; speed unpublished) | $0.30 to $0.85, 1 to 2 min | Cost range OK. Time low by 2x. |
| 4a Asset pull | 12 beats x 3 candidates = 36 images x 1.4k tokens = 50k ($0.06) plus prompts | $0.08 to $0.12 | 1 to 2 min (LoC blocks curl, Openverse anon 200/day) | $0.15, 1 min | OK. |
| 4b Art | 25 images x $0.01, plus ~30% rejected/regenerated (visual-gen's own retry rate) = 33. Latency p50 18 s, p95 maybe 40 s. Anchor sheet must finish before fan-out. | $0.25 to $0.40 | 1.5 to 2 min (anchor 18 s, then fan-out to slowest of 25 = ~45 s) | $0.25, 1 min | Cost OK, retries ignored. Time low by 1.5 to 2x. |
| 4c Layers | SAM: one concept per request, so ~2 requests per image x 25 = 50 x $0.0025 = $0.125. Depth + parse + stroke/shadow bake on GPU: 0.5 GPU-min = $0.02, plus Modal cold start 15 to 40 s. | $0.12 to $0.20 | 1 to 2 min | $0.10, 1 min | Low by up to 2x. |
| 4d B-roll | Omni Flash 720p $0.10/s. "2 to 4 clips of 3 to 5 s" = 6 to 20 s = $0.60 to $2.00; 30% retry = $0.8 to $2.6 | $0.8 to $2.6 | 2 to 5 min, can run parallel to 4c | "$0 to $1.50", 2 to 3 min | Upper bound wrong: 4 x 5 s is $2.00, not $1.50. |
| 5 Sound | TTS $0.08 (x1.5 retakes = $0.12) + music $0.15 + 6 SFX $0.02 to $0.10 | $0.25 to $0.40 | 0.5 to 1 min | $0.35 | OK. But see sequencing note below. |
| 6 Render | 1800 frames (30 fps) at 1080x1920 with cutouts. Lambda example is 1440 frames of a simple comp ($0.017, 19 s), so scale by 1.25 and by "images cost more": $0.03 to $0.10. Modal cold start 20 to 40 s for Chrome + bundle. | $0.03 to $0.10 | 1.5 to 3 min first render | $0.02 to $0.10, 1 min | Cost OK. Time low by 2 to 3x. Each critic fix adds a re-render. |
| 7 Critic | Per pass: video tokens unknown. Sensible bracket: 1 fps x 60 x 1.4k = 84k tokens, up to 2 fps = 168k, in at $1.25/M = $0.10 to $0.21; out 6k incl. reasoning $0.03; separate 1.2 audio pass on the same MP4 adds about the same again. | $0.25 to $0.45 per pass, so $0.5 to $0.9 for 2 | 2 to 4 min per pass | $0.40 for 2 passes, 2 to 4 min total | Cost low by 25 to 125%. Time low by 2x (it is 2 to 4 min per pass, not total). |
| 7b Fix loop (not in the table at all) | Re-gen ~8 images ($0.08), 8 SAM ($0.02), partial re-render ($0.03). If any script or word changes, TTS re-run ($0.12) and all downstream word times shift, so a full re-render. | $0.15 to $0.40 per iteration | 2 to 5 min per iteration | not counted | Missing line item. |

Totals (stills only, one fix iteration):
- Cost: $0.35+0.15+0.55+0.10+0.33+0.16+0.35+0.08+0.70+0.30 = about **$3.1** (range $2.3 to $4.0). Hypothesis says $2 to $3. Off by +$0.3 to +$1.0.
- With b-roll: **$4.5 to $5.1** (hypothesis $3 to $4). Off by about +$1.
- Time: sequential chain is research 2 to 4, writer 1 to 2, TTS 0.5 to 1 (must come before the director or at least before layout, see below), director 2 to 4, art 1.5 to 2, layers 1 to 2, mix 0.5, render 1.5 to 3, critic 2 to 4, fix + re-render 2 to 4, re-check 2 to 4. That is **14 to 33 min, typical 18 to 25**. Hypothesis says 8 to 15. Even the hypothesis's own time column sums to 11.5 to 17 min serially, which already exceeds the headline "under 15".
- visual-gen.md prices a stills-only video at about $1.00 and hybrid at $3.00 using Nano Banana and 14 stills. HYPOTHESIS uses Muse Image and 25 stills. The baselines differ and the hypothesis does not say so. Visual-gen includes 30% retries; the hypothesis does not.

150 RPM Muse Image limit:
- Per video: 25 stills + ~8 retries + 1 anchor + 2 to 6 memes/title cards = **35 to 40 images**, not 25. At 150 RPM that is about 4 videos/min and about **5,500 to 6,000 videos/day**, not 8,600.
- The real bound is bursts. A video fires 30+ images inside one minute, so 5 concurrent videos hit 150 RPM and throw 429s. Also unknown: whether `n=4` in one call counts as 1 or 4 against the limit (docs silent). Test it day 1; if it counts as 1, batch variants for free throughput.
- The limit is per team: every judge and every dev test shares one 150 RPM bucket.
- "Chained for consistency" via `previous_response_id` is serial. 6 chained images at 15 to 18 s = 90 to 110 s for one chain, which contradicts "1 min, parallel". The parallel design is: anchor sheet first, then fan out `/images/edits` calls each carrying the anchor as an input image. Hypothesis does not say which one it is.
- `enable_web_search` / `enable_shell` default to true in Muse Image. That can add latency per call. Set them false for plain art and low `reasoning_strength` for bulk.

Other numbers off:
- "Everything else is 3,000 RPM": false for the non-Meta parts. Pexels 200/h and 20k/month (about 22 videos/day at 30 queries each), Openverse anonymous 20/min and 200/day sustained, Pixabay 100/60 s, Smithsonian DEMO_KEY 10, Omni Flash quota unknown, ElevenLabs concurrency by plan (Fish lists 5/15/50 for comparison; ElevenLabs not checked). These cap you before Meta does.
- Contributor tier is 150 RPM, not 3,000, and trains on your data. The hypothesis lists it as a cost lever in the same breath as "everything else is 3,000 RPM".
- "$19/month with 20 shorts would lose money" is understated. 20 x $3.1 = $62 cost vs $19 revenue: loss of $43 per user per month. Pro $49 x 60 videos = $186 cost: loss of $137. Every proposed tier is negative gross margin, not marginal.
- Credit budget: $150 (third-party reported, not on the official page) / $3.1 = **48 full videos for the entire hackathon**, dev tests and judges included. Not mentioned anywhere.

## 3. Breakpoints (top 10)

| # | Failure | Likelihood | Impact | Early detection test | Mitigation |
|---|---|---|---|---|---|
| 1 | Critic cannot reliably watch the MP4. 1.3 audio is "not fully supported", fps and max length unpublished, no benchmark, 2 fps sampling misses fast kinetic text. Loop becomes noise or false positives that re-render good shots. | High (60%) | High: it is the headline differentiator and the Meta-tooling story | H5 on day 1, 2 hours: render with 5 planted faults, call `/v1/responses/input_tokens` on the MP4 (free token count) to learn real fps and token cost, run 3 times and measure hit rate and false-positive rate. | Primary signal = keyframes at cut points + EDL/shot list + transcript (all deterministic, cheap), MP4 as secondary. Restrict fix tickets to a closed enum (swap asset, change caption text, change duration, drop SFX). Cap at 1 loop iteration. Use `background` mode or stream to avoid idle timeouts. |
| 2 | Solo build scope. 20 typed primitives + captions kit + 3 to 6 style presets + Modal render + web UI + ingest of PDF/URL/video in about 3.5 days with exams and a lab on Nov 2. Each primitive needs 1 to 2 hours to look good at 1080x1920 and be agent-fillable. | Very high (80%) | Critical | Day-1 gate: one end-to-end 30 s video with 4 primitives by end of Oct 30. If not done, cut harder. | Section 5. 10 to 12 primitives, 3 style presets as data, no Manim, no depth map, no gen video. |
| 3 | Remotion on Modal (Chrome, fonts, bundling, chunk concat, cold starts) eats a day. Software GL, shadow/blur filters slow. | Medium (45%) | High | H7 day 1: render a 60 s 1080x1920 comp with 12 cutout PNGs and captions on Modal, time it; also render locally. | Use local/server render on one beefy box or `renderMedia` with `concurrency` as default; Modal chunks only if time. Prebake stroke+shadow. Show the **Remotion Player** in the browser for instant preview (zero render wait), and treat MP4 as an export. |
| 4 | Style drift and quality of Muse Image across a series: no seed, no style presets, no alpha, no mask. Presets (anime, retro paper, chalkboard) may look wrong or inconsistent. | Medium-high (55%) | High (the whole "one style" claim) | H2/H3 day 1: anchor sheet + 8 shots in 3 styles; blind-compare. Check true 9:16 (H1). | Fewer presets (3). Style = prompt prefix + anchor image + code-side grade, not a model feature. Generate "subject on flat color background" for cutouts. Best-of-n (n=2 or 3) judged by Spark vision, if `n` counts as 1 RPM. |
| 5 | Judge experience with no credentials: a live run takes 18 to 25 min, uses shared keys (Meta, ElevenLabs, Modal), shared 150 RPM, burns your $150. A judge clicks, waits 90 s, leaves. A bot or a curious judge runs 30 jobs and drains credits. | High (70%) | High (Demo is 25%) | Day 3: have a friend run the hosted app cold with no instructions. | Gallery of 6 to 8 pre-rendered videos with full artifact trace (fact sheet, script, shot list, critic tickets, before/after). Live run limited to 1 global concurrent job + per-IP cap + a hard dollar cap, progressive results (script and shot list appear in 2 min, Player preview in 6 to 8 min, MP4 later). "Replay" mode that animates a recorded run when budget is exhausted or Meta 429s. |
| 6 | Meta API 429s / 503s / idle timeouts at demo time (reported by several hackathon repos, Muse Code quota issues acknowledged). 150 RPM shared with all judges. | High (60% at least one 429 during judging) | High | Load test at day 4: 6 parallel pipelines. | Backoff with Retry-After, queue with concurrency 12 for images, idempotent stage caching (every stage output stored by hash; rerun resumes), pre-warmed examples, fallback to Spark 1.2 or Contributor for text if 1.3 is throttled. |
| 7 | Asset rights / legal: Commons "wrong file" matches and US-only PD; CC BY-SA remix; SAM-cutting and restyling real photos of identifiable people; Muse Image `enable_image_search` depicting real people; Content ID on found audio; YouTube's July 2026 "template-based" demonetization; screenshots of tweets/news. | Medium (35%) that something specific bites; High that a judge asks | Medium-high (Impact score, trust) | Day 2: 3-topic test (H8) with a rights audit: every asset has an AssetRecord and passes the allowlist (CC0, PD, CC BY). | `rights_mode=safe` default only, allowlist CC0/PD/CC BY, store per-asset record, auto end-card of credits (shows judges the care). No real-person generation, no Brave, no YouTube clips, no real screenshots; receipts are re-typeset quote cards. Mark modifications. Label "recreation" for generated depictions. |
| 8 | Non-Meta dependency risk: ElevenLabs v4 may not support `/with-timestamp` (docs say v4 is offered via Text to Dialogue API; the with-timestamp doc was only confirmed for the endpoint, not for v4). Plan cost and plan tier needed for commercial/API (Starter API is 75k chars). | Medium (40%) | High (captions are core craft) | Day 1, 30 min: call v4 with-timestamp on 1 paragraph. Check `alignment` arrays are returned and drift-free. | Fall back to v3 (documented with-timestamp) or Scribe v2 word timestamps ($0.22/h) on the final audio, or Forced Alignment endpoint, or WhisperX. Gemini TTS as automatic fallback. Meta rules: "Meta models core" is fine if judges need no creds, but confirm in Official Rules (still unpublished as of research). |
| 9 | SAM 3.1 quality and plumbing: base85 low-res masks (not RLE), one concept per request, no published performance on illustrations; hair/edge quality poor; parse time. Needs a prompt per cutout. | Medium (40%) | Medium-high (cutouts are the Vox look) | H4 day 1: 10 mixed images, measure edge quality and latency. | Generate art with a flat-color background so cutting is trivial (Muse Image cannot do alpha). Feather and 2 to 3 px erode. BiRefNet (MIT) as a fallback on Modal. Use SAM visibly for callout positions and tracking so Meta usage still counts. |
| 10 | Director output quality: one LLM call designing 24+ beats with typed props across 10+ primitives is the part most likely to produce incoherent pacing, wrong durations, missing assets. Timing: director needs real narration durations, but the pipeline runs TTS after assets (stage 5). | High (65%) | High | Day 2: run director on 3 topics, check schema pass rate and that every beat fits its sentence length. | Run TTS first (audio timeline = ground truth); director places beats on sentence/word times; deterministic post-pass fixes durations, enforces "no static frame over 3 s" and "pattern interrupt every 5 to 8 s" in code, not by asking the LLM. |

Honorable mentions: Meta $150 credit only reported by third parties; Wonder is "preview"; Remotion Player/automation license questions if deployed as a public app (free tier OK under 4 people, users cannot upload their own Remotion code, which you are not letting them do); Modal $100 credit for "select participants"; no fallback when Brave/Pexels keys are missing.

## 4. Contradictions and stale facts

1. HYPOTHESIS claims "Meta models doing all the thinking, seeing and image work." Visual-gen recommends Nano Banana, Recraft, Omni Flash, Kling and Wan as part of the stack. Omni Flash b-roll is Google, not Meta. If you keep 4d, the sentence is false.
2. "Spark reads PDF/URL/video natively." meta.md documents PDF and video input and `web_search`; it does **not** document fetching an arbitrary URL. Do your own fetch + readability extraction server-side.
3. "Voice Transcribe (audio QA, user's own voice)". meta.md: Voice Transcribe is ASR only (turn-level timestamps, no TTS, no cloning). "User's own voice" would be ElevenLabs IVC, not Meta. Voice Transcribe is only useful for ingest and for transcribing the final mix to compare with the script.
4. "Word times straight from the TTS engine" assumes `eleven_v4` supports `/with-timestamp`. The source file shows the endpoint but lists v4 as served via Text to Dialogue. Unconfirmed.
5. "Everything else is 3,000 RPM" vs the Contributor 150 RPM note in the same section, and vs the non-Meta rate limits in assets-rights.md (see section 2).
6. Image consistency "chained" vs "parallel at 150 RPM": chaining is serial.
7. H1 says "request 1024x1792 / 1152x2048"; meta.md says only the ratio is honored (output ~2.5 MP, 1152x2048 seen on the web UI) and a PR claims only 3 sizes are accepted. The fallback "generate 2:3 and extend" is fine; note 2:3 to 9:16 means a crop or a 12% bar, which breaks full-bleed.
8. Depth: HYPOTHESIS uses Depth Anything 3 Small/Base; meta.md recommends VGGT-1B-Commercial (gated form, approval delay). Pick one; DA3 Small is the faster route and avoids a gated form.
9. Render time: render-typography says Lambda 15 to 60 s but judges need no AWS account; Modal is "est. 30 to 90 s, unverified"; local is 3 to 7 min. Hypothesis assumes Modal speed without a measurement.
10. Fonts "Google Fonts are fine" is background knowledge, not verified. Music "cleared for nearly all commercial uses" excludes film/TV/games (fine here) but the $0.15/min vs $0.07 promo is ambiguous.
11. Craft-market pricing ($19 for 20 shorts) conflicts with the cost model (each plan negative margin).
12. YouTube July 2026 policy: "generic, repetitive, template-based content" is demonetized. HYPOTHESIS "series" and "style presets" are templates by nature. The defense (original sourcing, per-video research, receipts) should be explicit in the pitch.
13. Stale/dead items still in the research that the hypothesis correctly avoids: Veo 3.1 preview (shut Oct 22), Sora, Tenor, Bing Search API, Hume (sunset Nov 13), PlayHT. No problem there, but Hume is listed as "skip" only in passing; ok.
14. voice-audio says Gemini TTS $0.014/min "until 2026-12-31 then double". Fine for the hackathon; irrelevant at scale.
15. Spark Open (816B) "native video+audio input" on partner hosts is unverified (vLLM does text+image only). The hypothesis uses it for "per-shot checks" without noting this.

## 5. Scope cut

**Principle:** everything that reaches the screen is either (a) a Muse Image still, (b) a real public-domain/CC0/CC BY photo, (c) typography or SVG/chart rendered by code. No generated video, no Manim, no depth-model parallax.

### Must be in the build (real, not faked)
Pipeline: research (Spark + web_search, citations) -> writer (rulebook) -> TTS with word times (do this early) -> director (Wonder or Spark, JSON schema) -> assets -> deterministic timeline fixer -> Remotion -> critic (1 loop).

**Primitives (11 plus captions):**
1. `photo_kenburns` full-bleed still/archival with push-in, grade, grain.
2. `cutout_on_paper`: subject (SAM mask) with white stroke + shadow baked in Python, over paper/color background. This is the Vox/Harris signature.
3. `parallax2`: two layers only (cutout on top of original/blurred copy, different speeds). Fake 2.5D without a depth model.
4. `receipt`: re-typeset quote/headline/paper card with highlight on the quoted line and outlet/date/URL. Real differentiator vs slop.
5. `number_chart`: D3 counter / bar / line drawing in (stroke-dashoffset).
6. `map_reveal`: d3-geo + Natural Earth, pin, stepped route, place names timed to narration (Harris signature). One primitive covers history, news, geography.
7. `formula`: KaTeX step-by-step reveal + SVG function plot. This is the math mode, instead of Manim.
8. `whiteboard_reveal`: Muse Image line-art revealed by an animated mask (hand-drawn feel) plus rough-notation circles/underlines.
9. `kinetic_title` / `keyword_slam` (scale, shake, SFX hit).
10. `list_or_compare`: split-screen/icon list pop.
11. `meme_sticker`: original Muse Image reaction card cut out and popped, max 1 per 20 to 30 s.
12. `Caption` component with 2 variants (Hormozi word-pop, highlighter-box), in the safe zone, word times from TTS.
Plus 3 transitions (flash, whip, paper wipe) and one global grain/vignette/LUT pass.

**Style presets (3, all data):** (1) paper-collage documentary, (2) flat illustrated explainer (Kurzgesagt-like, SVG-friendly palette), (3) whiteboard/chalk for math and teaching. A style bible JSON = palette, fonts, art prompt prefix, anchor image, grade, grain, motion curve. Adding anime or retro later is a JSON file, which is the "nothing hardcoded" answer for the demo. Show it by making a 4th style live on stage.

**Modes (what to show):** explainer (science), history (maps + archival), math (KaTeX + plots), story/series (shared bible across 3 episodes). Input: prompt and PDF are real. URL via own extraction.

**Sound:** one ElevenLabs voice, music generated once per mood and cached (3 moods), SFX pre-generated library of about 12 (whoosh, hit, riser, paper, click) with ffmpeg ducking and loudnorm. That brings audio cost to about $0.12 per video.

**Meta showcase that must be real:** Spark (research, writer, vision ranking, critic), Wonder (director), Image (art, anchors, memes, title cards, thumbnail), SAM 3.1 (cutouts, callout positions), one cheap open-weights role (Glimmer on Fireworks/Together for alt-text, keyword emphasis, or per-frame typo check) to qualify for the $10k prize.

### Fake or pre-bake
- Gallery of 6 to 8 pre-rendered, hand-checked videos (one per mode/style). Live run exists but is not what carries the demo.
- Series mode: run the same bible three times, pre-render, show the series card. Real code path, pre-run output.
- Landscape: not built; show the Player re-laying out one composition if time (probably not).
- "Replay" of a recorded pipeline run for judges when the budget or Meta is down.
- Music/SFX library pre-generated.

### Cut or defer
- Gen video b-roll (4d). Biggest cost and time line item, non-Meta, 30% retries, and visual-gen itself says never animate real archival. Spend the saved $1.5 and 3 min elsewhere. At most one hero opener, pre-baked, only if everything else is done.
- Manim on Modal, depth models (DA3/VGGT), Qwen-Layered, LaMa fill, lip-sync, upscaling.
- Brave/web image search, YouTube CC, real screenshots, Giphy/Imgflip.
- HyperFrames, Lambda, Cloud Run.
- Arabic router and Gemini TTS: keep Gemini TTS only as an env-switch fallback (20 lines). Do Arabic only if there is time on Nov 3 (see section 7).
- Hyper-precise Montreal Forced Aligner, Qwen aligner.
- Seeds of 20 primitives; the long tail goes in the roadmap slide.

### Days
- Oct 30: spikes H1, H2, H4, H5, H6 (4 hours), skeleton Remotion with captions + 3 primitives, one 30 s video end to end by night.
- Oct 31: director + 8 more primitives, style bible loader, rights ledger and credits card.
- Nov 1: critic loop (frames + EDL + MP4), timeline fixer, 3 topics through the full pipeline.
- Nov 2: exams/lab. Only run pre-queued batch renders for the gallery; no new code.
- Nov 3: web UI with Player preview + trace view + gallery, hosting, budget caps, load test, record demo footage.
- Nov 4: freeze by noon, demo video, write-up, submit well before 21:00 ET.

## 6. Scale (1,000 videos/day)

Per-video resource use (my numbers): about 40 Muse Image calls, 50 SAM calls, 600 to 800k Spark/Wonder tokens (video critic dominates), 1,000 TTS chars, 1 music + 6 SFX, 1 to 2 renders, 8 to 12 external asset queries.

| Item | Per day | Per month |
|---|---|---|
| Total cost at $3.1 | $3,100 | about $93k |
| Muse Image 40,000 | $400 (avg 28 RPM, peak 5x = 140 RPM, **at the limit**) | $12k |
| SAM | $125 | $3.8k |
| Spark/Wonder (research, writer, director, critic) | about $1,900 | about $57k (critic alone about $700/day) |
| ElevenLabs: 1M chars/day = 30M chars/month | $80 TTS + $150 music + SFX | about $7k at list; enterprise terms needed (concurrency, commercial terms) |
| Render (Modal) | $30 to $100 | $1 to $3k. Remotion Automators: $0.01/render x ~45k renders + $100 min = about $550/month once the company is 4+ people or you are a SaaS |

Throughput: 1,000/day = 0.7 videos/min arrival; at about 20 min each that is about 14 pipelines in flight. Meta text limits (3,000 RPM, 4M TPM) are fine (about 450k TPM average, 5x peaks 2.2M). Bottlenecks in order: Muse Image 150 RPM at peak (request an increase), external archive/stock limits (Pexels 20k/month = 22 videos/day; need partner limits or mirrored/cached corpora), ElevenLabs concurrency, Omni Flash quota if used, Modal cold starts.

Unit economics vs $19/month:
- 20 videos x $3.1 = $62 cost against $19 revenue (Stripe takes about $0.85): **-$44/user/month**. Pro $49 for 60 videos: -$137. Pay-per-video $2 to $5 gives -$1.1 to +$1.9 before support and free tier.
- To reach 60% gross margin on $19 you need about **$0.50/video**, a 6x reduction.

What would have to change (estimated floors):
| Lever | New cost |
|---|---|
| Research with Contributor tier (data trains Meta; not OK for paid private docs) or cache/shared fact sheets for trending topics | $0.35 -> $0.06 |
| Writer + director on Spark 1.3 (no Wonder), one draft, constrained schema | $0.70 -> $0.12 |
| Critic: deterministic checks in code (overflow, safe zone, static frames, loudness, OCR vs script) + Glimmer on 8 keyframes; full-MP4 Spark only for failing cases or the premium tier | $0.70 -> $0.10 |
| Narration: Gemini Flash TTS ($0.014) or ElevenLabs Turbo ($0.04) | $0.12 -> $0.03 |
| Music/SFX: cached per mood library | $0.15 -> $0.01 |
| Art: fewer, reuse style assets and character library; best-of-1 | $0.33 -> $0.20 |
| Layers: cut only where needed, self-host SAM on Modal | $0.16 -> $0.06 |
| Render: batched, warm containers | $0.08 -> $0.04 |
| **Floor** | about **$0.60** |
Realistic plan: free tier of 1 watermarked video, Creator $29 for 12 videos, pay-per-video $2 to $3 including the critic, enterprise/API pricing for edtech. The $19/20-video plan only works after the above, and not at the hackathon stage. Also: 1,000/day on a hackathon key violates reasonable use; this needs a production agreement with Meta (and Remotion Automators licence).

## 7. Missed opportunities (raise quality or judging score)

1. **Remotion Player as the live demo surface.** The video is code. Show an instantly playable, editable preview as soon as assets exist (about 5 to 7 min) while the MP4 renders. Judges can drag the shot list, change a caption or swap a style and see it update without a render. This beats NotebookLM's "cannot edit" (craft-market B1) and hides the 20-minute latency. Demo +, Technical depth +.
2. **Muse Image's strengths are unused.** meta.md: text accuracy 5/5, infographics, charts, QR codes, search-grounded real-world references (`enable_image_search`). Use it for title cards, thumbnail (frame 0 = thumbnail), infographic beats and landmark/product references. Also helps the $5k Best Creative prize. HYPOTHESIS says "all text is rendered by code"; keep that for animated text only.
3. **Best-of-n with Spark vision as judge**: `n` up to 10 per image call at $0.01 each; Spark ranks. Cheap quality lift if `n` counts as one request (test).
4. **Video input intent.** BRIEF promises "a video" as input. The pipeline has no path for it. SAM cookbook 07 has working recipes (video to stickers, speech-bubble captions anchored to tracked heads) and Spark/Spark Open take video+audio. A 20 s demo "paste a clip, get captions that follow the speaker + a re-edited explainer" is a strong Meta tooling story (SAM 3.1 video tracking + Spark video understanding).
5. **Video Seal (MIT, Meta)** invisible watermark plus a visible "AI-assisted, sources in description" end card: cheap (about 1 hour), Meta-native, and answers the "AI slop / provenance" worry directly. Impact (30%).
6. **Rights ledger as a feature.** AssetRecord per file, auto credits card, `rights_mode` badge on the timeline. The hypothesis lists "license records" but not the on-screen proof. Judges asking about legality get an answer in one click.
7. **Arabic/multilingual narration** (voice-audio spent real effort: Gemini TTS for Arabic, Chatterbox open-source). Impact angle for global Meta users and your own context. A single Arabic example in the gallery is cheap if the captions and fonts are RTL-safe (test early; RTL in word-pop captions is a real trap, so only if time).
8. **Show the critic's before/after** (craft-market demo advice) as a split-screen with ticket text. This is the hook for the X/viral bonus and for the "agentic" prize, and it works even if the critic only fixes 2 to 3 things.
9. **Background responses (600/min)** for long calls and `/v1/responses/input_tokens` to price the critic for free. Both are in meta.md and unused.
10. **Open-weights role that is visible**: Glimmer reading the final keyframes for "alt-text + typo check" shown in the trace. Cheap, qualifies the $10k bonus, and runs on Fireworks/Together (credit via partners).
11. **Craft rubric as enforced code**, not prose: cut cadence, no static frame over 3 s, caption safe zone, ducking, -14 LUFS, pattern interrupt spacing. These are deterministic checks that make the "critic" credible and cheap, and the rubric in craft-market A5 is already written.
12. **Positioning**: the YouTube July 2026 policy demonetizes templated content. Lead the pitch with "sourced, receipts on screen, original per-video research", which is exactly what the pipeline does and what competitors (invideo, Revid) cannot claim.

## Bottom line for the build decision
Build the narrow version: 11 primitives, 3 data-driven styles, TTS-first timeline, Player preview, one critic loop with deterministic checks plus MP4 as a bonus signal, no gen video, pre-rendered gallery plus a budget-capped live run. State the bar honestly: "best-in-class AI explainer, Vox/Harris-style craft", not "indistinguishable from Veritasium".
