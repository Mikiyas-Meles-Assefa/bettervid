# HYPOTHESIS: the bettervid pipeline (phase 2)

Written 2026-10-29 from the six phase 1 research files. Every number here traces to one of them; anything marked **TEST** is assumed and gets checked in phase 4 spikes.

## The claim

If we run the pipeline below, one prompt, PDF or URL becomes a 60 to 90 s, 9:16 video that a viewer cannot tell apart from a good human-edited explainer (Johnny Harris / Vox / Kurzgesagt-level craft), in **under 15 minutes** and for **about $2 to $3**, with Meta models doing all the thinking, seeing and image work.

Why it should work: the market's shared failure is generic B-roll, mismatched visuals, drifting style and made-up facts (craft-market B1). Each stage below removes one of those failures on purpose, and a critic that actually watches the render catches what slips through.

## Pipeline

Diagram: `docs/pipeline.html`.

| # | Stage | Engine | Output | Est. cost / 60 s | Est. time |
|---|---|---|---|---|---|
| 1 | **Research** | Muse Spark 1.3 + web search; reads PDF/URL/video natively | fact sheet: claims, numbers, quotes, each with a source | $0.30 | 1 to 2 min |
| 2 | **Writer** | Muse Spark 1.3 with the craft rulebook (hook, but/therefore, open loops, payoff) | script + narrator tags + beat list | $0.10 | 1 min |
| 3 | **Director** | Muse Wonder (Spark if quality is equal) | shot list JSON: per beat, primitive, asset need, on-screen text, motion, SFX cue, style bible | $0.30 to $0.85 | 1 to 2 min |
| 4a | **Asset pull** | open archives (Commons, Openverse, NASA, Met, Smithsonian, LoC, Internet Archive, Pexels/Pixabay) + Brave image search (opt-in editorial); Muse Spark vision ranks candidates | 1 to 3 candidates per beat with license records | $0.15 | 1 min, parallel |
| 4b | **Art** | Muse Image: style frame + character/place anchors, then per-shot art and original memes, chained for consistency | generated stills | $0.25 (25 images) | 1 min, parallel at 150 RPM |
| 4c | **Layers** | SAM 3.1 cutouts on every still (real or generated); Depth Anything 3 Small/Base for depth; prebaked stroke + shadow PNGs | layered assets, masks for callouts | $0.10 | 1 min |
| 4d | **B-roll (optional)** | Gemini Omni Flash or Wan 3.0 image-to-video, 2 to 4 clips of 3 to 5 s, only where motion matters | clips | $0 to $1.50 | 2 to 3 min |
| 5 | **Sound** | ElevenLabs v4 with-timestamp (narration + word times), Music v2.5, SFX v2 + CC0 library; ffmpeg ducking and -14 LUFS | mixed audio + word timings | $0.35 | 30 s to 1 min |
| 6 | **Edit + render** | Remotion: ~20 typed primitives the agent fills with props, word-pop captions, typography kit; Manim on Modal for math; render in parallel chunks | MP4 9:16 (16:9 from same timeline later) | $0.02 to $0.10 | 1 min |
| 7 | **Critic** | Muse Spark watches the MP4 (1.3 for picture, 1.2 or Voice Transcribe for audio) and scores it on the rubric; Muse Glimmer / Spark Open (open weights) runs the per-shot checks | fix tickets per shot; only failing shots re-render | $0.40 (2 passes) | 2 to 4 min |
| | **Total** | | | **about $2 to $3** (stills), **$3 to $4** with b-roll | **8 to 15 min** |

## How each known failure is removed

| Failure in today's tools | Our fix | Stage |
|---|---|---|
| Made-up facts | Every claim in the script points to a fact sheet source; receipts on screen | 1, 2, 6 |
| Weak, flat scripts | Craft rulebook in the writer prompt: hook in under 2 s, but/therefore beats, loops, payoff | 2 |
| Generic, mismatched B-roll | Per-beat asset choice by beat type (proof → receipt, example → real photo, abstract → generated art, joke → original meme) | 3, 4 |
| Style drift, mixed sources look messy | One style bible: anchors for generated art, one treatment (grade, grain, paper, stroke) for everything | 3, 4, 6 |
| Wobbly AI video, garbled text | Motion comes from code on stills and cutouts; all text is rendered by code | 4c, 6 |
| Captions out of sync | Word times straight from the TTS engine | 5, 6 |
| No quality control | The critic watches the actual render and re-renders only failing shots | 7 |

## Hypotheses to test (phase 4)

| ID | Hypothesis | How we test it | If it fails |
|---|---|---|---|
| H1 | Muse Image returns true 9:16 (e.g. 1152x2048) | request 1024x1792 / 1152x2048, check returned dims | generate 2:3, extend with edits or build the frame from layers |
| H2 | Muse Image holds a character and style across 6+ chained images | anchor sheet + 6 shots, blind check | pass anchor image as input every time; critic flags drift |
| H3 | Muse Image does each preset style well (whiteboard, anime, retro paper, flat, documentary, chalkboard) | 1 style frame per preset | drop weak presets or use Nano Banana / Recraft for that style |
| H4 | SAM 3.1 cleanly cuts subjects from photos, paintings and illustrations | 10 mixed images, concept prompts | BiRefNet (MIT) fallback |
| H5 | Muse Spark can watch a 60 s MP4 and catch planted errors (wrong caption, off-sync, typo, a frozen shot) | render a test video with 5 planted faults | sample frames + transcript instead of raw video |
| H6 | ElevenLabs v4 timestamps give word-exact captions | narrate 1 script, render captions, eyeball | Forced Alignment API or WhisperX |
| H7 | Remotion renders a 60 s 1080x1920 cut with cutouts, grain and captions in about 1 min | render on Modal | lighter effects, more chunks |
| H8 | Open archives return a usable asset for most proof/example beats | 3 test topics (history, science, current event) | opt-in Brave search, else generated art |
| H9 | The whole loop finishes under 15 min for 60 s | end-to-end slice | more parallelism, Spark instead of Wonder |
| H10 | Blind viewers rate our cut close to a human reference cut | 3 to 5 people, side by side | iterate on the weakest rubric dimension |

## Scale (first pass, phase 5 goes deeper)

- Tightest limit is **Muse Image at 150 RPM**: at 25 images per video that is about 6 videos/min, roughly 8,600 per day per key. Everything else is 3,000 RPM.
- Cost per video **$2 to $3** vs competitor plans of **$15 to $60/month**: a $19/month plan with 20 shorts would lose money unless the cost comes down. Levers: Spark instead of Wonder, contributor models for drafts, caching style anchors, fewer critic passes.
- 429s are common for Muse users today: every call needs backoff with Retry-After and a queue.

## Meta usage (judging: 25%)

Spark (research, writing, vision ranking, critic), Wonder (director), Image (all generated art, anchors, memes), SAM 3.1 (every cutout and callout position, video tracking), Voice Transcribe (audio QA, user's own voice), open weights Glimmer / Spark Open (critic checks, for the $10k prize). Non-Meta parts are the senses Meta doesn't sell: voice, music, renderer.
