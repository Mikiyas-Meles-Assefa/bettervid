# bettervid: the plan (v2)

Written 2026-10-29. Built on `research/` (six research files, `HYPOTHESIS.md`, `REVIEW.md`, `DECISIONS.md`). Diagram: `docs/pipeline.html`. v1 is in `docs/archive/PLAN-v1.md`.

Meta Global AI Developer Hackathon, Indie track, solo. **Submit by Wed Nov 4, 21:00 ET (Thu Nov 5, 05:00 Doha).** Aim to submit by Nov 4, 18:00 ET.

---

## 1. The product in one paragraph

**bettervid is a director in a box.** You give it a prompt, a PDF or a link, and it researches the topic, writes a script built to hold attention, voices it, pulls real archival images and generates art, cuts subjects out with SAM, edits everything to the narration with sound design and captions, then has a critic watch the result and fix what's weak. Out comes a sourced 9:16 video with the craft of Vox, Johnny Harris, Kurzgesagt or the best IG explainers, with its sources on screen. It works for anything: science, history, math, stories, social posts, series.

**Positioning:** "Original research per video, sources on screen, edited like a documentary." This is the opposite of the template slop YouTube started demonetizing in July 2026.

**Quality bar:** the user's bar, Veritasium and top IG creators. We do not claim viewers can't tell it from a human edit. We prove quality with side-by-side reference clips and the critic's before/after.

---

## 2. What we ship on Nov 4

| Deliverable | What it is |
|---|---|
| Hosted web app | Paste a prompt or PDF, pick a style or Auto. Watch the agents work step by step, play the live preview, edit a caption or switch style instantly, export the MP4. No login or keys for judges. |
| Gallery | 6 to 8 finished hero videos, one per mode and style, each with its full trail: fact sheet, script, shot list, critic tickets, before/after. |
| Replay mode | A recorded real run that plays back the whole pipeline if Meta rate-limits or the budget cap is hit. |
| Demo video | 3 minutes (plan in section 11). |
| Public repo | All code written during the event, a README with the architecture and the Meta model map, `research/` as evidence of process. |
| X post | One hero video plus the critic before/after clip, for the Most Viral prize. |

---

## 3. The pipeline (v2)

The diagram is `docs/pipeline.html`. Each stage reads and writes one field of a single **Project JSON**, and every stage output is cached by hash. A failed run resumes from the last good stage, and any one shot can be redone alone.

| # | Stage | Engine | Writes | Est. cost | Est. time |
|---|---|---|---|---|---|
| 0 | Ingest | our code: PDF text and page images, URL extraction (Readability), video via Voice Transcribe (stretch) | `sources` | ~$0 | seconds |
| 1 | Research | Muse Spark 1.3 + web search | `factSheet` (claims, numbers, quotes, each with a source) | $0.35 | 2 to 4 min |
| 2 | Writer | Muse Spark 1.3 + craft rulebook | `script` (beats, narrator tags) | $0.15 | 1 to 2 min |
| 3 | Voice first | ElevenLabs v4 with timestamps (fallback v3 or Scribe) | `narration` (audio, word times) | $0.12 | under 1 min |
| 4 | Director | Muse Wonder (Spark in cheap mode) | `styleBible`, `shots[]` on word times | $0.40 to $0.80 | 2 to 4 min |
| 5a | Real assets | archives in safe mode, Spark vision picks | `assets[]` with license records | $0.10 | 1 to 2 min |
| 5b | Art | Muse Image: reference first, then all shots in parallel with it attached | `assets[]` | $0.40 | 1.5 to 2 min |
| 5c | Cutouts | SAM 3.1, outline and shadow baked in code | `layers[]`, `masks[]` | $0.15 | 1 to 2 min |
| 5d | Music + SFX | cached ElevenLabs Music per mood, pre-made SFX kit | `audioBed` | $0.05 | seconds |
| 6 | Timeline fixer | our code | `timeline` | $0 | seconds |
| 7 | Preview + render | Remotion Player in browser, Remotion render, ffmpeg mix, Video Seal | `preview`, `mp4` | $0.10 | preview at 6 to 8 min, MP4 +2 min |
| 8 | Critic | auto checks, Spark on keyframes + shot list + transcript, Glimmer typo pass, MP4 pass as bonus | `tickets[]`, `score` | $0.40 | 2 to 4 min |
| 8b | One fix round | stages 4, 5 or 6 for flagged shots only | updated shots | $0.15 to $0.40 | 2 to 5 min |
| | **Total** | | | **~$3.10** | **18 to 25 min** |

### Why voice comes first
The narration's word timings are the master clock. The director places each shot on real words, captions are exact, and the timeline fixer can enforce pacing in code.

### Timeline fixer rules (deterministic)
From `research/craft-market.md`:
- No still longer than 3 s. Hook shots under 1 s.
- A pattern interrupt (zoom, cutout pop, type slam, meme, SFX hit) every 5 to 8 s.
- Captions: 1 to 3 words, one highlighted keyword, inside the safe zone (never the bottom 25% or right 15%), never covering the subject or the receipt.
- Whoosh 10 to 20 ms before cuts. J-cuts on audio, 8 to 12 frames.
- Music 20 to 25 dB under the voice, ducked on speech, final mix -14 LUFS, true peak -1 dB.
- A held beat or silence before the biggest reveal.
- Ending loops back to the hook or cuts hard. Never "thanks for watching".

---

## 4. The critic

**Fail gates** (any one means "must fix"): audio clipping or voice buried by music, caption in an unsafe zone, a claim with no source, blank first frame, a static frame over 4 s, a sign-off ending.

**Rubric** (0 to 5 each, weighted, pass at 80 with no gates failed; to be calibrated on reference clips):

| Dimension | Weight |
|---|---|
| Hook (0 to 3 s) | 20 |
| Narrative drive | 15 |
| Visual evidence (receipts, real assets, sources named) | 15 |
| Pacing | 10 |
| Style unity | 10 |
| Sound | 10 |
| Accuracy and honesty | 10 |
| Captions and typography | 5 |
| Ending / loop | 5 |

**Inputs, in order of trust:**
1. Auto checks in code: safe zones, static frames, loudness, caption timing against word times, an OCR check of on-screen text against the script.
2. Spark 1.3 on keyframes at every cut, plus the shot list, transcript and fact sheet.
3. Glimmer (open weights, Fireworks) on every keyframe for typos and alt text.
4. Spark watching the full MP4 (1.2 for audio), as a bonus signal once spike S5 shows it's reliable.

**Tickets come from a fixed menu:** swap the image, regenerate the image with a note, change caption text, change a duration, move or drop a sound, re-cut a beat. One fix round, only the flagged shots re-render, and the before/after is kept for the demo.

---

## 5. Styles, modes and shot types

### Styles (data files, not code)
A style file holds the palette, fonts, art-prompt prefix, reference image, color grade, grain and texture, motion curves, transition kit, caption look, music mood and voice. Adding a style means adding a file.

| Style | Status | Look |
|---|---|---|
| **Vox / Johnny Harris documentary collage** | build first, flagship | real archival photos and SAM cutouts with a white outline, paper texture, halftone and grain, receipts, maps with routes, highlighter callouts |
| **Flat illustrated** (Kurzgesagt-like) | build first | bold flat shapes, clean palette, smooth easing |
| **Whiteboard / chalk** | build first | line art revealed by hand, marker underlines and circles, for math and teaching |
| **Anime** | test on day 1, add if Muse Image passes | cel look, speed lines, dramatic camera |
| **Retro paper** | test on day 1, add if Muse Image passes | paper cutouts, stop-motion jitter, warm grain |
| **Auto** | build | the director writes a new style file for the topic, Muse Image makes its reference image, and the user can save it as a preset |

### Modes (settings the director reads; Auto picks one)
- **Explain** (science and ideas): misconception, then mechanism; real footage and diagrams; the paper credited on screen.
- **History / documentary:** cold open on a vivid moment; archival, maps, dates in huge type.
- **Math:** concrete case, then pattern, then definition; KaTeX step-by-step plus plots; color stays tied to meaning.
- **Story / series:** cold open on the oddest detail, escalation, cliffhanger; one story bible shared across episodes.
- **Social** is a pacing preset (30 to 45 s, faster cuts) that works with any mode.

### Shot types (build order, not a ceiling)
1. `photo_kenburns`: full-bleed still with push-in, grade and grain
2. `cutout_on_paper`: SAM cutout with white outline and shadow over paper or color (the Vox/Harris signature)
3. `parallax2`: cutout layer over a blurred copy of the original, moving at different speeds
4. `receipt`: re-typeset headline, quote or paper card with the quoted line highlighted, outlet, date and URL
5. `number_chart`: counter, bar or line drawing in
6. `map_reveal`: d3-geo on Natural Earth, pins, route, place names timed to the words
7. `formula`: KaTeX step-by-step plus an SVG plot
8. `whiteboard_reveal`: line art revealed by an animated mask, rough circles and underlines
9. `kinetic_title` / `keyword_slam`: scale, shake, SFX hit
10. `list_or_compare`: split screen or icon list pop
11. `meme_sticker`: an original reaction image cut out and popped in, at most one per 20 to 30 s
12. `Caption`: two variants, word-pop and highlighter box

Plus 3 transitions (flash, whip, paper wipe) and one global pass (grade, grain, vignette). Next if time: `callout_on_mask` (an arrow or circle that lands on a SAM mask), `timeline`, `quote_portrait`, `split_before_after`, `tracked_caption` for user video.

---

## 6. Meta usage (25% of the score)

| Meta model | Job in bettervid |
|---|---|
| Muse Spark 1.3 | research with web search, writer, picking the best real asset by vision, judging best-of-n art, the critic |
| Muse Spark 1.2 | the critic's audio pass |
| Muse Wonder | director: style file and shot list |
| Muse Image | all generated art, reference images, title cards, thumbnail, infographics, original memes |
| SAM 3.1 | every cutout, mask positions for callouts, speaker tracking in user video (stretch) |
| Muse Voice Transcribe | reading user videos and checking the final audio against the script |
| Muse Glimmer (open weights, Fireworks) | typo and alt-text pass on every keyframe, for the $10k open-weights prize |
| Video Seal (Meta open source) | invisible watermark on every export |

Non-Meta parts are only the things Meta doesn't offer: voice, music and SFX (ElevenLabs), the renderer (Remotion) and the archives. Organizers confirmed external APIs are fine if Meta models are the core and judges need no credentials.

**Bonus prizes in reach:** open weights ($10k, Glimmer), Best Creative with Muse Image ($5k), Best Agentic ($5k, the critic loop), Most Viral on X ($20k), Community Vote ($10k).

---

## 7. Tech stack and repo layout

**One language, TypeScript, end to end.** Remotion is React, Meta's API works with the OpenAI SDK, and SAM has an npm parser (`@meta-sam/parser`).

| Layer | Choice |
|---|---|
| Web app | Next.js + Remotion Player, live trail view over server-sent events |
| Pipeline | Node worker, one module per stage, Project JSON in and out, a cache keyed by hash |
| LLM calls | OpenAI SDK against `https://api.meta.ai/v1`, structured output with JSON schema, backoff on 429 with Retry-After, background mode for long calls |
| Images | sharp for compositing cutouts, baking outline and shadow, and textures |
| Render | `@remotion/renderer`; where it runs (one strong server or Modal) is decided by spike S7 |
| Audio | ffmpeg: sidechain ducking, two-pass loudnorm |
| Storage | project folders per run; on the host, a volume plus signed URLs |
| Hosting | decided by spike S7; the web app and worker can split (Vercel + Modal or one VM) |

```
bettervid/
  AGENTS.md            start here after a context reset
  docs/                PLAN.md, pipeline.html, archive/
  research/            evidence: research files, HYPOTHESIS, REVIEW, DECISIONS, spikes/
  app/                 Next.js web app (input, trail view, Player, gallery)
  pipeline/            stages: ingest, research, writer, voice, director, assets, art, cutouts, audio, fixer, render, critic
  video/               Remotion compositions: shot types, captions, transitions, global grade
  styles/              style files (JSON) and their reference images
  prompts/             craft rulebook, writer, director and critic prompts (data, versioned)
  schemas/             Project JSON schema (fact sheet, script, shots, assets, tickets)
  scripts/             spikes and batch jobs
```

---

## 8. Day 1 spikes (research/spikes/, one result file each)

Each spike has a pass bar and a fallback ready.

| ID | Question | Pass bar | Fallback |
|---|---|---|---|
| S1 | Does Muse Image return true 9:16? | 1080 x 1920 class output, full bleed | generate 2:3 and extend, or build the frame from layers |
| S2 | Does it keep one character and style across 8 shots with the reference attached? | a blind check finds no drift | stronger reference prompt, Spark flags drift |
| S3 | Which styles does it do well? (collage, flat, whiteboard, anime, retro paper) | 3 or more look professional | drop the weak styles |
| S4 | Does SAM 3.1 cut cleanly from photos, paintings and illustrations? | clean edges on 8 of 10 | flat-background generation, BiRefNet |
| S5 | Can Spark catch 5 planted faults in a test video? | catches 4 of 5, low false alarms | keyframes and auto checks only |
| S6 | Does ElevenLabs v4 return word timestamps? | timings match the audio | v3 or Scribe word timestamps |
| S7 | How long does Remotion take to render 60 s at 1080 x 1920 with cutouts and captions? | under 3 min | lighter effects, more chunks |
| S8 | Do the archives return a usable asset for most proof and example beats? | 70% of beats across 3 topics | opt-in web search, generated art |
| S9 | Does `n=4` count as one request against the 150 RPM limit? | yes means best-of-n is free throughput | single images |
| S10 | What does the critic's video input really cost? (free token-count endpoint) | known tokens per second | keyframes only |

---

## 9. Schedule

Today, Oct 29, is the Chemistry exam. Shell Lab is due Mon Nov 2. Fireworks session Fri Oct 30, 12:00 ET (20:00 Doha).

| Day | Goal | Done when |
|---|---|---|
| **Thu Oct 29** (after the exam) | Keys in `.env`, repo skeleton, spikes S1, S6, S9, S10 (cheap and fast) | results saved in `research/spikes/` |
| **Fri Oct 30** | Remaining spikes. Project JSON schema. Remotion skeleton with captions and shot types 1, 2, 4, 9. Stages 1 to 3 working. | **Gate: one complete 30 s video end to end by night**, ugly allowed |
| **Sat Oct 31** | Director, real assets, art, cutouts. Shot types 3, 5, 6, 7, 8, 10, 11. Style file loader with the 3 core styles. License records and credits card. | 3 topics produce a full video |
| **Sun Nov 1** | Timeline fixer, critic with one fix round, music and SFX kit, Auto style, anime and retro paper if they passed S3. Queue gallery renders overnight. | critic before/after works on 3 topics |
| **Mon Nov 2** | Shell Lab day. No new code. Gallery batch renders run; review them in breaks. | 6 to 8 gallery candidates |
| **Tue Nov 3** | Web app: input, trail view, Player with live edits, gallery, replay mode. Hosting, budget caps, load test. Record demo footage. Stretch: video input with SAM tracking. | a friend uses it cold with no help |
| **Wed Nov 4** | Code freeze at noon ET. Demo video, README, X post, submit. | submitted by 18:00 ET |

If the Oct 30 gate is missed, cut harder: drop Auto style and the stretch goals, and keep the 3 core styles and 8 shot types.

---

## 10. Budget

| Item | Plan |
|---|---|
| Meta credit | $150, about 48 full videos at ~$3.10 |
| Allocation | ~15 dev runs in cheap mode (Spark instead of Wonder, ~$1.50 each) ≈ $25; ~15 full dev runs ≈ $45; 8 gallery videos ≈ $25; judge live runs capped at $40; reserve ≈ $15 |
| Spend tracking | every API call logs its cost to the Project JSON; a running total shows in the trail view and gets checked daily |
| Judge live runs | one job at a time, a per-IP limit, a hard daily dollar cap, then replay mode |
| ElevenLabs | a paid plan sized to ~150k characters for the event (exact plan picked when the key is set up) |
| Fireworks | $25 credit (Glimmer), Modal $100 if approved |

---

## 11. Demo video (3 minutes)

| Time | Beat |
|---|---|
| 0:00 to 0:15 | Cold open: 10 seconds of a finished hero video, then "an AI made this from one sentence, and every claim has a source" |
| 0:15 to 0:35 | The problem: AI video today is generic, wrong and unfixable; making a great video takes a team weeks |
| 0:35 to 1:35 | Live run: type a prompt; the trail shows the fact sheet with sources, the script, narration, shot list, real archival and generated art, SAM cutouts; the live preview plays |
| 1:35 to 2:05 | The critic: split-screen before/after with its tickets ("caption covers the map", "claim at 0:14 has no source") |
| 2:05 to 2:30 | Range: the same topic switched live to whiteboard and anime; a history piece, a math piece, a story episode |
| 2:30 to 2:50 | Under the hood: the Meta model map, costs, credits card, watermark |
| 2:50 to 3:00 | Close on the strongest hero video |

---

## 12. Risks

| Risk | Early warning | Response |
|---|---|---|
| Critic can't watch video reliably | S5, S10 | keyframes plus auto checks carry it |
| Scope too big for solo | Oct 30 gate | cut list in section 9 |
| Muse Image style or 9:16 weak | S1 to S3 | fewer styles, layered frames |
| Meta 429s during judging | load test Nov 3 | queue, backoff, cache, replay mode |
| Credits run out | daily spend check | cheap mode for dev, caps for judges |
| Rights question from judges | rights audit on 3 topics | safe mode, license records, credits card |
| Render setup eats a day | S7 | render on one strong server first |
| ElevenLabs timestamps missing | S6 | v3 or Scribe |

---

## 13. After the hackathon (roadmap slide)

Landscape 16:9 from the same timeline, chat-to-edit any shot, Arabic and other languages, generated b-roll for hero shots, Manim for advanced math, depth parallax, the full shot-type library, series memory with recurring characters, and the cost floor of ~$0.60 per video (Spark-only, code checks, cached music, cheaper voice) for pricing around $29 for 12 videos or $2 to $3 per video.

---

## 14. Waiting on the user

1. ElevenLabs API key, entered through the private secret box
2. Which Meta API key to use, or create a new one called "bettervid"
3. OK to push `docs/` and `research/` to the public repo
4. Discord login in the Aside browser (optional, for organizer answers)
