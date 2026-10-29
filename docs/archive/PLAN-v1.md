# bettervid: plan

Meta Global AI Developer Hackathon, Indie track. Build window Oct 27 to Nov 4, 2026 (submit by Nov 4 21:00 ET).

## 1. What we are building

**A director in a box.** You give it an intent ("explain how CRISPR works", "tell the story of the fall of Constantinople", "a 5-part horror series about a lighthouse keeper", a PDF, a URL, a video) and it produces a finished, beautiful, narrated video with the craft of a top creator: a hook in the first second, a story that pulls you through, visuals that move with the words, sound design, music, captions.

Not an explainer tool. Explaining is the first and strongest use case, but the engine is general: education, storytelling, history, science, math, social media posts, episodic series.

### The problem

- Making one great video (Veritasium, Kurzgesagt, 3Blue1Brown, top IG/TikTok explainers) takes a skilled team days to weeks: research, script, storyboard, art, animation, voice, sound, edit.
- Current AI video tools are fast but bad in the ways that matter: generic look, weak scripts, made-up facts, characters that drift between shots, captions out of sync, no control after generation (from reviews of Invideo, NotebookLM video overviews, Higgsfield, faceless-story tools).
- Pure video generation (Veo, Kling...) gives pretty 8 second clips, not a coherent 60 second story with correct text, diagrams and pacing. Sora's API was shut down on Sep 24, 2026.

### The core idea

**A video is a program, written by a team of agents, then watched and fixed by a critic.**

1. Every video is a structured timeline (shots, layers, timings, motion, audio) rendered by code. So text is always crisp, math is always right, timing is word-exact, and any shot can be changed and re-rendered alone.
2. Art is generated with Muse Image, cut into layers with SAM 3.1, and animated (parallax, puppet motion, builds). This gives the hand-crafted motion-design look, not AI-video wobble.
3. A critic agent (Muse Spark, which can watch the rendered MP4 with its audio) scores every cut against a quality rubric and files shot-level fix tickets until it passes.

## 2. What the user gets

| Input | Output |
|---|---|
| A prompt, a PDF/paper, a URL, notes, or their own video/voice | A finished video: 9:16 first (60 to 120 s), 16:9 next |
| Optional: mode, style, length, audience, voice, language | Captions burned in (style matched), music, SFX |
| | Sources/citations card for factual modes |
| | An editable project: chat to change any shot ("make the hook darker", "slow down here", "swap to anime") and only that shot re-renders |
| | Series memory: characters, world and style carry into episode 2, 3... |

### Modes (not hardcoded: a mode is a config the planner reads, and auto picks one)

- **Explain**: concept or paper to explainer. Accuracy and sourcing first.
- **Story**: narrative with characters, arcs, cliffhangers.
- **Documentary**: real history/science with archival/map/timeline grammar.
- **Social**: tight 30 to 60 s posts, pattern interrupts every few seconds.
- **Series**: Story or Documentary across episodes with a persistent story bible.

### Styles

Auto style plus presets. A style is **data, not code**: a "style bible" with palette, type, image-prompt language, motion grammar (easing, cut rhythm, camera), transition kit, caption look, music mood, voice. Presets to ship:

- Whiteboard (hand-drawn reveal, marker strokes)
- Anime (cel look, speed lines, dramatic camera)
- Retro paper (paper cutout, grain, stop-motion jitter)
- Flat motion design (Kurzgesagt-like bold shapes)
- Documentary (archival photo, Ken Burns, maps, film grain)
- Kinetic type (typography-led, for social)
- Chalkboard / blueprint (math and engineering)

**Auto style** = the planner writes a new style bible for the topic and tone, then Muse Image renders a style frame that every later image is anchored to. Users can also save any generated style as their own preset.

## 3. Architecture

```
intent / sources
   |
   v
[1 Research]  Muse Spark 1.3 + web_search, reads PDF/URL/video (native video+audio input)
   |          -> fact sheet with citations (structured output)
   v
[2 Writer]    Muse Spark -> script built for retention: hook, open loops, "but/therefore"
   |          beats, payoff; voice performance tags for the narrator
   v
[3 Director]  Muse Wonder (planning) -> shot list as JSON: shot type, duration, layers,
   |          motion, transitions, on-screen text, SFX cues, style bible
   v
[4 Assets]    Per beat, the editor picks the best source: real photo/archival, stock or
   |          archival clip, document "receipt", meme/reaction, Muse Image art, diagram/code
   |          Sourcing: web + open archives (Openverse, Wikimedia Commons, LoC, NASA,
   |          Smithsonian, Pexels/Pixabay video), Muse Spark vision ranks candidates
   |          Muse Image: anchor sheets + chained per-shot art where nothing real fits
   |          SAM 3.1: cutouts from any source (photos, clips, art), masks for callouts
   |          Style treatment unifies mixed sources (grade, grain, paper, stroke)
   |          Depth (Depth Anything 3, Apache variants): depth map for 2.5D camera moves
   v
[5 Sound]     ElevenLabs v4 narration -> Forced Alignment API -> word timings
   |          ElevenLabs Music (scored to sections) + SFX on cuts and reveals
   v
[6 Editor]    Remotion (portrait + landscape from the same timeline, safe areas)
   |          shot primitives + TikTok-style word captions; Manim sidecar for math
   |          Rendered per shot in parallel on Modal, then stitched
   v
[7 Critic]    Muse Spark watches the MP4 (frames + audio) and checks it against the script,
   |          sources and style bible -> rubric scores -> fix tickets per shot -> loop
   v
final video + project file (editable)
```

### How the editor thinks (the craft we encode)

Real editors at Veritasium, Johnny Harris, Vox, Kurzgesagt, and top IG/TikTok channels work beat by beat. For every line of narration they ask "what does the viewer need to see right now to believe, understand, or feel this?" and then pull the best asset for it, real or made. Our editor agent works the same way:

1. **Beat map**: split the script into beats and tag each one (claim, proof, example, joke, reveal, transition, emotional moment, number, quote).
2. **Asset pull**: for each beat, choose a source. Proof beats get **receipts** (a real headline, paper, tweet, map, archival photo, rebuilt as a crisp mockup or cropped from the source). Example beats get real photos or clips. Abstract beats get Muse Image art or diagrams. Joke beats get a meme, a reaction, or a visual gag (freeze frame + record scratch, sudden zoom, "x years later" card).
3. **Rough cut on the voice**: picture follows the narration with word-level timing; J/L cuts, a visual change every 2 to 4 s in Social.
4. **Polish**: SFX on every cut and reveal (whoosh, pop, riser, bass hit), music ducking, callouts (circle, arrow, highlight) placed on SAM masks so they land exactly on the thing being talked about, collage moments where several cutouts stack up.
5. **Treatment**: everything passes through the style bible, so a 1453 painting, a NASA photo and a generated character all look like one video (same grade, grain, paper texture, cutout stroke).

This decides per beat, with nothing hardcoded: a history video naturally leans archival + maps + paintings, a science video leans diagrams + real footage + generated art, a story leans fully on generated art.

**Rights**: default to sources that are licensed for reuse (Openverse/CC, Wikimedia Commons, public domain archives, NASA, Pexels/Pixabay), and keep a credits list per video. Reaction/meme beats default to original memes generated in the video's style; well-known templates and user-supplied clips are opt-in.

### Text and typography

On-screen text is rendered in code, not baked into images, so it is always sharp, spelled right, and animatable. The style bible sets the type system (fonts, weights, colors, stroke, shadow), and the typography kit covers: word-pop captions with emphasis words, kinetic type, highlighter and underline reveals, typewriter, 3D extruded titles, labeled callouts with arrows to SAM masks, number counters, quote cards, and receipt mockups (headline, tweet, paper abstract). Muse Image is used for stylized lettering only when a style calls for it (an anime title logo, a hand-painted chapter card), and the critic checks the spelling.

### Shot primitives (the motion vocabulary)

The director mostly composes from a library of high-quality Remotion components, and can drop to custom code for something new:

parallax still, puppet character (SAM-cut parts with motion), diagram build, kinetic type, map flyover, timeline, chart/data, equation (KaTeX or Manim), split compare, zoom-to-detail, quote card, receipt (headline/tweet/paper), collage, meme/reaction beat, archival photo with cutout, real b-roll clip, user footage with cutout subject (SAM 3.1 video tracking).

This is how we get quality and flexibility together: the primitives are hand-tuned to look great, the agent decides how to combine them, and nothing about the topic is hardcoded.

### Why each Meta model is load-bearing (Use of Meta tooling, 25%)

| Model | Job |
|---|---|
| Muse Spark 1.3 | research with web search, script, structured shot list, critic that watches video with audio |
| Muse Wonder | director/planner for long, multi-step planning and repair |
| Muse Image | generated art where nothing real fits, anchored character/world consistency, style frames, original memes, stylized lettering |
| SAM 3.1 | cutouts from any source (web photos, archival, clips, generated art), masks that place callouts, subject tracking in clips and user video |
| Muse Voice Transcribe | QA that the narration audio matches the script; "record your own voice" mode; transcribing user video sources |
| Muse Spark Open (Baseten/Fireworks) | the critic loop on open weights, to enter the $10k open-weights bonus |

Organizer rulings (Discord): external APIs and OSS libraries are fine as long as Meta models are core and judges do not need their own credentials; partner-served Meta models count as Meta models. So ElevenLabs, Remotion, Manim are allowed. Meta has no TTS or music model, so those come from ElevenLabs.

## 4. Quality bar

"Not meh" made concrete:

- **Critic rubric** per cut, scored 0 to 10, must pass a threshold: hook strength (first 2 s), pacing (visual change every 2 to 4 s in Social, 4 to 8 s in Explain), text legibility and safe areas, caption sync (word timing), style consistency across shots, character consistency, factual accuracy vs fact sheet, audio mix (voice above music), ending payoff.
- **Benchmark set**: 5 reference clips from creators we want to match (one per mode). We compare our output side by side before calling a feature done.
- **Hero videos**: for the demo we polish 4 to 6 videos across modes and styles rather than show many average ones.

## 5. Cost per 60 s video (estimate)

About 25 images x $0.01, LLM calls about $0.50 to $1.00, narration about 900 chars x $0.08/1k, music 1 min x $0.15, SAM calls under $0.10. Roughly $1 to $2 per video, well inside the credits.

## 6. Schedule

Exams come first: Matrices quiz Wed Oct 28, Chemistry exam Thu Oct 29. Shell Lab due Mon Nov 2. Qai hackathon starts Nov 5 17:00 Doha.

| Day | Goal |
|---|---|
| Tue 27 / Wed 28 | Spikes (no product code): Muse Image at 1080x1920 and 1920x1080, style tests for each preset, SAM 3.1 layer cuts, ElevenLabs v4 + forced alignment, Remotion portrait render, Spark watching an MP4. Watch Agents 101/102. |
| Thu 29 night / Fri 30 | Vertical slice end to end: prompt to 9:16 video in one style. Ugly is fine, complete is required. |
| Sat 31 | Layers + parallax + puppet motion, captions, music and SFX, critic loop v1. |
| Sun Nov 1 | Style bible system (presets + auto), modes, sources (PDF/URL/video), anchors for consistency. |
| Mon Nov 2 | Light day (Shell Lab). Web app with live production timeline. |
| Tue Nov 3 | Chat-to-edit per shot, series memory, 16:9, hero videos, deploy. |
| Wed Nov 4 | Demo video (made partly with bettervid), README, X post, submit before 21:00 ET. |

## 7. Deliverables

- Public repo (this one), all built during the event.
- Hosted web app judges can use with no keys (our keys server-side, with rate limits), plus a pre-rendered gallery.
- 3 minute demo video.
- Gallery: hero videos across modes and styles.
- X post of a bettervid video (Most Viral prize) and community vote push.

Bonus prizes in reach: Best Creative Build (Muse Image, $5k), Best Agentic ($5k), Best open-weights build ($10k), Most Viral ($20k), Community Vote ($10k).

## 8. Risks and how we handle them

| Risk | Plan |
|---|---|
| Muse Image may not honor true 9:16 | Test day 1. Fallback: generate 2:3 (1024x1536) and extend/crop, or compose the frame from layers so the background can be wider than the subject. |
| Muse Image latency (multi-pass reasoning) | Generate in parallel (150 RPM), use reasoning_strength=low for drafts, high for finals. |
| Character drift | Anchor sheets + previous_response_id chaining + critic checks consistency. |
| ElevenLabs v4 word timestamps not documented | Use the Forced Alignment API on the final audio (returns words). |
| Judges need no credentials | Server-side keys, usage caps, cached gallery. |
| Scope | Vertical slice first; every later day adds to a working product, never a rewrite. |

## 9. Open questions

- Muse Image true 9:16 output and per-style quality: answered by Tuesday spikes.
- Discord organizer answers beyond what is quoted above: pending read.
