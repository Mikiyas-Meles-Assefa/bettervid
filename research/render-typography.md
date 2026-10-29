# render-typography: render stack, math, typography, effects (retrieved 2026-10-29)

## TL;DR
1. Main renderer: **Remotion** (v4.0.539, 26 Oct 2026). Free for teams of up to 3 people, unlimited commercial use, so solo hackathon is fine. A later SaaS pays Automators: $0.01/render, $100/mo minimum. [verified] sources/render-typography/remotion-license.md
2. Remotion has first-party agent skills (`npx skills add remotion-dev/skills`, includes captions, docs-as-Markdown, saas). Best LLM tooling of any option. [verified]
3. Strong challenger: **HyperFrames** (HeyGen, Apache 2.0, HTML + GSAP, no fees, ~450 catalog blocks, Lambda adapter). LLMs write HTML well. Younger, single-machine claims are third-party. Keep as backup or for kinetic-type shots only. [verified repo / reported comparisons]
4. Do not mix two runtimes in 5 days. Pick Remotion, use CSS/SVG/canvas inside it. OpenMontage (72.8k stars, AGPL) mixes both; read it, do not copy code (AGPL). [verified]
5. Math: **Manim CE 0.22.1** (27 Oct 2026) in the `manimcommunity/manim` Docker image on Modal, output MP4 composited as a clip in Remotion. Use KaTeX inside Remotion for simple formulas. Skip ManimGL (needs OpenGL window). [verified]
6. Captions: **@remotion/captions** (MIT) + word timings from forced alignment, custom word-pop component. Do not use GSAP SplitText inside Remotion; use per-word React spans driven by frame. [verified]
7. Render cost: Remotion Lambda about $0.017 per 60 s (1080p, 2048 MB, official example), 15 to 60 s wall time. Heavy WebGL/blur/video-in-video raises it. Modal parallel chunks est. $0.03 to $0.10 per 60 s. [verified/unverified]
8. Avoid Shotstack/Creatomate: 5 to 20 cents per minute and a template DSL the LLM cannot extend with custom effects. [verified]
9. Lambda has no GPU, so WebGL (three.js, shaders) runs on software `swangle`: slow. Keep grain/LUT/light leaks as precomputed PNG/video overlays or CSS, not live WebGL. [verified]
10. Biggest risk: Chrome headless cost of box-shadow/text-shadow/blur at 1080x1920. Prebake stroke+shadow cutouts (SAM mask -> PNG) instead of CSS filters. [verified]

## 1. Programmatic video engines
| Tool | What / state | License | Agent fit | Verdict |
|---|---|---|---|---|
| Remotion 4.0.539 | React, Chrome frame capture, Player, Lambda, Studio. 68.7k stars. 4.0.537-539 added @remotion/effects (lensBlur, fractalNoise, pageTurn, shatter, curves). Chromium 157. | Custom: free <=3 people; Creators $25/seat/mo (manual); Automators $0.01/render, $100/mo min; Enterprise from $500/mo. Previews do not count as renders. Users may not upload their own Remotion code. [verified] | Official skills, `remotion-docs` skill fetches docs as Markdown, captions, saas. Strong. | USE |
| HyperFrames (HeyGen) | HTML + data attrs + seekable GSAP/Lottie/Three/Anime; Chrome beginFrame; 74.9k stars; Node 22+; @hyperframes/aws-lambda. [verified] Claimed 7-10 s vs 16-20 s for 5 s clip [reported, HeyGen-adjacent]. | Apache 2.0, no per-render fees [verified] | 18 agent skills, 450 catalog blocks (kinetic type, transitions, captions, charts). | BACKUP / watch. Free for later SaaS. |
| Revideo | TS generator scenes, headless, parallel render, React Player. MIT, 4.2k stars, built for Midrender. Telemetry default on. [verified] | MIT | OK, small ecosystem | SKIP (smaller ecosystem than Remotion) |
| Motion Canvas | TS generators, vector explainer editor, MIT, 19.6k stars. Editor-centric, no cloud render story. [verified] | MIT | Weak for agents | SKIP |
| Editly | Node + ffmpeg JSON specs, gl-transitions, Ken Burns, 9:16 OK. One maintainer. [verified] | MIT | JSON easy, but limited typography | SKIP (maybe quick fallback assembler) |
| MoviePy 2 | Python, TextClip, "maintainers wanted". [verified] | MIT | Python-friendly, slow, weak text | SKIP (MoneyPrinterTurbo-style output looks generic) |
| ffmpeg filtergraphs | drawtext, xfade, zoompan, lut3d, overlay. Use for final mux, loudnorm, LUT grade, encode. | LGPL/GPL | LLM errors common on complex graphs | USE only for post (grade, grain overlay, audio mix) |
| Shotstack | $10=50 min PAYG (20c/min); Starter $39/250 min; Pro $99/750 (13.2c); Scale $199/2000 (10c); Volume $499/10000 (5c). Billed per second. [verified] | SaaS | JSON templates | SKIP (cost + no custom effects) |
| Creatomate | Credits, ~14 credits per min 720p, Growth 10,000 credits ~12 h. $ not shown. [verified] | SaaS | JSON | SKIP |
| Etro | TS canvas video editor lib. Not researched live. | MIT [unverified] | - | SKIP |

Remotion add-ons: @remotion/captions (MIT), @remotion/transitions (TransitionSeries, since 4.0.53), @remotion/three (ThreeCanvas, needs gl=angle, Sequence layout="none"), @remotion/effects (custom effects in 2D/WebGL2/WebGPU), Lottie, Rive, Skia packages exist [unverified: not fetched, Lottie page 404 on my URL guess]. Cloud Run is alpha and unmaintained: do not use. [verified]

Remotion Player for a web editor: embeds in any React app, templates for Next.js, Next.js on Vercel Sandbox, React Router 7. Player use counts as an automation for licensing (Automators). [verified]

## 2. Math and diagrams
| Tool | Notes | Verdict |
|---|---|---|
| Manim CE 0.22.1 | Released 27 Oct 2026; 0.22.0 (8 Oct) broke CLI: `--format mp4/mov/webm/png-sequence`; 0.21 gave ~2.2x faster Cairo and parallel partial-movie encoding; Typst option; Python 3.11+. Docker `manimcommunity/manim` (tags latest/stable/vX.Y.Z), minimal TeX Live. [verified] Render speed per minute: not published; est. 20 to 90 s for a 20 s Cairo scene at 1080p60 [unverified]. Use `--format webm`/mov with alpha to composite over Remotion backgrounds. | USE for equations/graphs/geometry only, one Modal function |
| ManimGL (3b1b) | MIT, 95.8k stars, pip `manimgl`, OpenGL window required, installs not interchangeable with CE. [verified] | SKIP |
| KaTeX in React | Sync render to HTML, fast, no TeX install; set fonts bundled. [unverified, standard knowledge] | USE for formulas in Remotion |
| MathJax | SVG output, slower | backup |
| Mermaid / D3 / visx | D3/visx give deterministic SVG charts driven by `useCurrentFrame`; Mermaid is auto-layout, ugly. | USE D3 scales + hand SVG; SKIP Mermaid |
| rough.js / rough-notation | rough-notation MIT: underline, box, circle, highlight, strike-through, crossed-off, bracket. [verified] rough.js license not verified here (believed MIT). Seeded randomness keeps frames deterministic. | USE for whiteboard / hand-drawn |
| vivus / SVG stroke draw | `stroke-dashoffset` animation is 5 lines of CSS in Remotion; no library needed. | Hand-write |

## 3. Typography for viral video
- Word-by-word caption styles (Hormozi: 1 to 3 words, bold sans, yellow/green active word, black stroke; MrBeast: heavy condensed caps, color pop, big scale bounce; Ali Abdaal: lighter, highlighter box behind keyword). Build as one `<Caption>` component with variants. Data: Remotion `Caption[]` with `startMs/endMs` per word; page grouping function from the captions package [name `createTikTokStyleCaptions` not confirmed in fetched docs; [unverified]].
- Libraries: **GSAP** is now free for commercial use including SplitText and MorphSVG; ban only on building tools that compete with Webflow's visual animation builder (bettervid is not one). AI-generated code is allowed. [verified https://gsap.com/standard-license/] But Remotion renders by frame, so use `interpolate`/`spring` and per-word spans instead. GSAP matters only if HyperFrames is chosen. Framer Motion and anime.js are real-time clocks and fight frame-based rendering [unverified]: skip.
- 3D text: three.js + troika-three-text inside `<ThreeCanvas>` works but is slow on Lambda (software GL). Fake 3D with stacked CSS text-shadows only for one-off hero titles; prebake if possible.
- Text effects: stroke (`-webkit-text-stroke` or `paint-order: stroke fill`), glow (shadow, slow, prebake), highlighter (rough-notation or SVG rect scaleX), gradient fill via `background-clip:text`.
- Fonts (licensing is from background knowledge, not verified; the Google Fonts FAQ fetch returned only headings): Google Fonts are OFL/Apache and generally fine for video. Suggested: whiteboard = Patrick Hand / Caveat / Kalam; anime = Bangers / Dela Gothic One / Zen Dots; retro paper = Playfair Display / DM Serif Display / Special Elite / Courier Prime; documentary = Inter / Source Serif 4 / Oswald; flat motion (Kurzgesagt-like) = Poppins / Montserrat / Baloo 2; viral captions = Anton / Bebas Neue / Montserrat Black / Luckiest Guy. Use `@remotion/google-fonts` or self-host WOFF2; variable fonts allow weight animation. [unverified]

## 4. Rendering at scale
- Lambda: vCPUs scale with memory (2 vCPU up to 3008 MB, 6 at 8846+ MB). Disk 512 MB to 10 GB. No GPU. Default gl swangle. [verified]
- Official example: 1 min video, 2048 MB, us-east-1: $0.017 and 18.9 s warm, $0.021 and 15.5 s cold; 10 min HD $0.103 / 56 s. Landing page: 80 s video in 15 s, up to 200x concurrency. 1080x1920 has same pixels as 1920x1080, so expect same. Video-in-video costs "significantly" more. [verified]
- Modal option (we need Meta/Modal stack anyway): Chrome in container, split frame ranges across N containers, concat with ffmpeg. Modal: $0.0000131/core/s, $0.00000222/GiB/s, T4 $0.000164/s, $30/mo free. 8 cores + 16 GiB = ~$0.00014/s; 4 CPU-minutes of work total ~ $0.03 to $0.05 per 60 s. [prices verified; total unverified]. GPU Chrome on Modal needs vulkan setup (guide uses g4dn, Vulkan, chrome-for-testing; no benchmark published) [verified]: skip within 5 days.
- Concurrency tips: `npx remotion benchmark`, use JPEG frames, `<Video>` from @remotion/media (not Html5Video/OffthreadVideo), avoid blur/shadow filters, downscale with `--scale`. [verified]
- Decision: Lambda is the least code (`renderMediaOnLambda`) but needs an AWS account and judges would need none for a hosted demo. Modal is more consistent with the rest of the pipeline. If time is short, render locally in demo (3 to 7 min/60 s, third-party estimate [reported]).

## 5. Effects in code (what is cheap vs. slow)
| Effect | How | Cost |
|---|---|---|
| Film grain | Prebaked looping grain MP4/PNG overlay with mix-blend, or ffmpeg `noise` at final pass | cheap |
| Paper texture | Static JPG background + multiply | cheap |
| Color grade / LUT | ffmpeg `lut3d` on final MP4 (one pass), not per frame WebGL | cheap |
| Light leaks | Prebaked screen-blend clips | cheap |
| Cutout white stroke + shadow | Prebake in Python from SAM alpha (dilate mask, blur shadow) into PNG | cheap; CSS drop-shadow is slow |
| Camera shake | `translate/rotate` from seeded noise per frame | cheap |
| Motion blur | Remotion `<CameraMotionBlur>` renders sub-frames (multiplies render time) [unverified] | expensive; use sparingly |
| Ken Burns | scale+translate via interpolate | cheap |
| Parallax from depth map | Needs WebGL displacement (three.js, software GL on Lambda) or prebake: split depth into 3 to 4 layers in Python, parallax with plain CSS transforms | prebake |
| @remotion/effects (lensBlur, fractalNoise, shatter, curves) | new in 4.0.537-539 | try, check speed |

## 6. Assets (licenses mostly unverified; not fetched)
Free SFX: Freesound (CC mixed, check each), Pixabay (own license), Mixkit. Lottie: LottieFiles (mixed licenses). Icons: Lucide (ISC), Tabler (MIT), Phosphor (MIT), Heroicons (MIT), Material Symbols (Apache 2.0), Font Awesome Free (mixed). Emojis: Twemoji/Noto (CC-BY/OFL, attribution). Archive: Archive.org, NASA, Wikimedia per OpenMontage defaults. [unverified]

## 7. Open-source agents to learn from [reported via search 2026-10-29]
- calesthio/OpenMontage: AGPL, 72.8k stars, YAML pipelines + markdown "director skills", Remotion and HyperFrames, budget caps ($10 default). Best architecture reference. [verified README]
- Vincentwei1021/video-shotcraft: 124 shot recipe cards for Remotion. Closest to our "shot primitives" idea.
- Romay777/agent-video-gen-pack, digitalsamba/claude-code-video-toolkit, Agents365-ai/video-podcast-maker, 0xsline/OpenChatCut (conversational editor), itsPremkumar/Automated-Video-Generator (MIT).
- harry0703/MoneyPrinterTurbo: MIT, ~136k stars, stock footage + Edge TTS + subtitles; generic look, no typography craft. ShortGPT not checked.

## 8. Recommended render stack
- Director JSON shot list -> LLM writes/fills typed Remotion components (not free-form React): the agent picks a primitive and passes props. Free-form code is the fallback for one-off shots, guided by remotion-best-practices skill.
- Remotion 4.0.539 + @remotion/captions + @remotion/transitions + KaTeX + D3 + rough-notation, one root composition 1080x1920 at 30 fps.
- Manim CE Docker on Modal for math clips (webm/mov alpha).
- Python prebake step (Modal): SAM cutouts with stroke+shadow PNG, depth layers, grain/paper/leak overlays.
- Render: Modal parallel chunks (or Lambda if account exists), ffmpeg concat + LUT + loudnorm + final encode.
- Critic loop re-renders only failed shots (Remotion `--frames` range).

## 9. First ~20 primitives
Shots: 1 full-bleed photo with Ken Burns; 2 cutout subject with white stroke + shadow over paper/color bg; 3 2.5D parallax (prebaked layers); 4 video clip with crop, speed, color treatment; 5 receipt (headline/tweet/paper card, highlight on keyword); 6 map/route zoom [unverified: skills mention maps]; 7 animated chart (D3 bar/line/number counter); 8 Manim equation/graph clip; 9 KaTeX formula reveal step by step; 10 whiteboard sketch draw-on (stroke dash + rough.js); 11 timeline/date strip; 12 split-screen compare; 13 icon/emoji pop list; 14 meme/reaction sticker pop.
Typography: 15 word-pop captions (Hormozi variant); 16 caption variant with highlighter box (Abdaal); 17 big kinetic title with per-letter spring + stroke; 18 keyword slam (scale + shake + SFX hook); 19 handwritten annotation (circle/underline/arrow via rough-notation); 20 lower-third with source credit. Transitions: whip/slide, flash-white, paper wipe from @remotion/transitions. Global: grain + vignette + LUT pass.

## 10. Cost / time per 60 s portrait video (render only)
| Path | Time | Cost |
|---|---|---|
| Remotion Lambda | 15 to 60 s | ~$0.017 to $0.05 compute (official $0.017 example) + Remotion Automators $0.01 only if company of 4+ |
| Modal 8-core x 8 chunks | 30 to 90 s est. | ~$0.03 to $0.10 est. |
| Local laptop | 3 to 7 min | $0 [reported] |
| Shotstack (comparison) | - | 5 to 20 cents |
Manim clips add ~20 to 90 s each on one container, cents [unverified]. Per-video LLM/TTS/image cost not in this topic.

## Open questions
- Real speed of our composition (grain, cutouts, captions) at 1080x1920 on Modal vs Lambda: benchmark on day 1.
- Exact @remotion/captions helper names and @remotion/transitions preset list (docs pages only rendered tables of contents).
- Whether HyperFrames Lambda distributed render matches Remotion (claims conflict: blog says single machine, repo shows aws-lambda adapter).
- Font and asset licenses and rough.js license need a direct check before shipping.
- Remotion license when judges run the project: free tier covers <=3 people, but re-check if the repo is deployed as a public app.
