# visual-gen: video gen, image gen, 2.5D, matting, animation, upscaling, hosting
Researched 2026-10-29. Source excerpts in `research/sources/visual-gen/` (aa-i2v-leaderboard, video-pricing, image-models, cv-tools-licenses). The landscape moved a lot: several models you may remember are retired or renamed.

## TL;DR
1. Default to stills + code motion (Ken Burns, depth parallax, cutout layers). Generated video is a seasoning: 2 to 4 clips of 3 to 5 s per 60 s video.
2. Best generated-video pick for judges needing no credentials: Gemini Omni Flash 1.1 (`gemini-omni-1.1-flash`), about $0.10/s at 720p, 9:16, 3 to 10 s, audio, I2V. Google now tells people to use it over Veo. [verified, ai.google.dev pricing + video docs]
3. Veo 3.1 Preview in the Gemini API was shut down Oct 22, 2026. Do not build on `veo-3.1-*-preview`. [verified]
4. Sora is dead: Videos API and sora-2 models removed Sep 24, 2026. [reported]
5. Cheapest decent: Wan 3.0 ($0.05/0.10/0.20 per s at 480/720/1080, closed, API only) and Kling 3.0 ($0.084 to $0.168/s). Seedance 2.5 is #1 on quality but $0.23/s at 720p and slow.
6. Open weights: MiniMax H3 (rank 3 overall) has a license that EXCLUDES the US, EU, UK, S. Korea. Unusable for a US hackathon. LTX-2.5 is the usable open one (free under $10M revenue), Wan 2.2 Apache 2.0 is the safe older one.
7. Images: Nano Banana 2.1 (~$0.034/1K) for general art and typography; Recraft V4 Vector ($0.08) for real SVG; Ideogram 4 for heavy typography. Muse Image remains the core (other agent).
8. 2.5D: Depth Anything 3 Small/Base (Apache 2.0) or DA V2 Small; avoid Large/Giant (CC BY-NC), Depth Pro, DepthCrafter (non-commercial). Roll own parallax in Remotion/three.js; DepthFlow is AGPL.
9. Matting: BiRefNet (MIT) next to SAM 3.1. Skip RMBG-2.0 (CC BY-NC) and MatAnyone (S-Lab, likely NC).
10. Cost of a 60 s hybrid video: about $1.5 to $3. All-generated 60 s: $5 to $14. Modal L40S is $0.000542/s.

## 1. Video generation (image-to-video and b-roll)
Quality column: Artificial Analysis I2V arena v2.1 with audio, Elo (Kling 3.0 1080p = 1000 anchor). Price/min is AA's figure at its benchmark setting. Source: https://artificialanalysis.ai/video/leaderboard/image-to-video [verified]

| Model | AA Elo (rank) | Price | Max length | 9:16 | Latency | Providers | License | Verdict |
|---|---|---|---|---|---|---|---|---|
| Seedance 2.5 | 1148 (1) | $0.103/0.231/0.569 per s at 480/720/1080 [reported, BytePlus via cellcog/techforum] | 30 s | yes (assume) | slow, 3 to 5 min for 8 s (Seedance generation) [reported] | BytePlus, Replicate, fal ($0.473/s 720p), Runway | closed | backup for hero shots; one source says not sold in US [unverified] |
| Seedance 2.0 | 1132 (2) | $22.45/min AA; Runway 30 cr/s=$0.30 at 720p [verified runway] | 15 s approx | yes | slow | same | closed | skip, 2.5 or Kling better |
| MiniMax H3 / Hailuo 3 | 1126 (3, 768p) | official 2K $0.13/s; 768p ~$0.08/s, fal $0.03/s listed [verified fal page] | 4 to 15 s | yes (HF card) | n/a | MiniMax, fal, OpenRouter, Replicate, Runway | open weights, 33B, but excludes US/EU/UK/KR [verified HF LICENSE] | API only for us; cheap and good. Check judges' region rules |
| Wan 3.0 | 1108 (5) | $0.05/0.10/0.20 per s [reported, Alibaba/fal/Runway verified 5/10/20 cr] | 30 s one pass | not confirmed | ~85 s per clip (older Wan) | Alibaba Model Studio, fal, Runway, OpenRouter | closed, no weights | use (cheap) |
| Gemini Omni Flash 1.1 | 1044 (9) | ~$0.10/s 720p [verified]; Runway 10 cr/s | 3 to 10 s, extend to 40 s [reported] | yes 16:9/9:16 [reported] | n/a | Gemini API, Runway, Krea | closed | USE as default |
| Kling 3.0 (Pro) | 1000 (13) | $0.084 to $0.168/s; fal v3 Pro $0.14 [verified fal] | 3 to 15 s | I2V follows start image aspect [reported] | ~60 s for 5 s at 720p [reported] | Kling, fal, Runway, Replicate | closed | backup; good motion, cheap |
| Veo 3.1 / Fast / Lite | 956 / 933 / 927 | Lite $0.05 to $0.08, Fast $0.10 to $0.12, Std $0.40 per s [reported] | 8 s | yes | under 2 min | Gemini API preview dead; Vertex GA; Runway; fal | closed | skip (Omni Flash replaced it) |
| Runway Gen-4.5 | not in top 25 | $0.12/s [reported], Gen-4 Turbo $0.05/s [verified credits] | 2 to 10 s | 9:16 at 720x1280 [reported] | ~5 min [reported] | Runway API | closed | skip, pricey and slow |
| Runway Aleph 2 | n/a | $0.28/s, min 56 cr [verified] | 2 to 30 s | yes | n/a | Runway | closed | video-to-video edit only; possible restyle tool, skip |
| Luma Ray 3.2 | not in top 25 | 5 s: $0.15 (540p), $0.30 (720p), $1.20 (1080p) [verified lumalabs] | 5/10 s | yes | no SLA | Luma API | closed | cheap at 540p/720p; backup |
| Pika 2.5 | n/a | $0.04/s 720p, $0.09 1080p; needs $10/mo API Club [reported] | 5 s | ? | n/a | Pika | closed | skip |
| Sora 2 | n/a | n/a | n/a | n/a | n/a | removed Sep 24, 2026 [reported] | n/a | dead |
| Grok Imagine Video 1.5 | 1047 | $15/min AA | ? | ? | ? | xAI | closed | not needed |
| LTX-2.5 (Fast/Pro) | 917 / 913 | AA $7.80/$10.20 per min | ~5 s default, longer w/ duration head | any multiple of 32 | 8-step distilled | Lightricks, fal, self-host | LTX-2.x Community: free under $10M revenue [verified HF card] | the open-weights option; self-host on Modal |
| Wan 2.2 | not listed | Replicate Wan 2.1 i2v $0.09 to $0.25/s [verified] | 5 s | yes | ~minutes on A100 | Apache 2.0 | open | safe open fallback, lower quality |
| HunyuanVideo 1.5 | n/a | self-host | 121 frames | ? | 14GB w/ offload | custom, excludes EU/UK/KR [reported, conflicting] | semi-open | skip |
| CogVideoX | n/a | n/a | 6 s | n/a | n/a | mixed per checkpoint | skip, obsolete |

Gotchas:
- Elo gaps inside the top 7 are inside the confidence interval (+/-17), so choose on price, 9:16 and API stability, not rank. [reported inference]
- Different AA board versions show different Elo; compare only within one version.
- Gen audio is baked in on most; strip it, our narrator track is separate.
- "1080p/4K" on Omni Flash and Seedance 2.5 above 1080p are upscales (reported).
- Aspect ratio for Kling I2V comes from the start image, so feed a 9:16 still.
- For vertical talking b-roll, image conditioning: Omni Flash accepts a start frame and up to 10 tagged refs [reported].

## 2. Image generation
| Model | Style range | Text rendering | Consistency / refs | Price | Native vector | License |
|---|---|---|---|---|---|---|
| Nano Banana 2.1 (Gemini) | broad, photoreal and illustration | strong; headlines ~100%, <15 words ~95%, >30 words ~60% (NB Pro test, reported) | multi-ref, edit | $0.0336 1K, $0.0504 2K [verified]; batch half | no | closed |
| Nano Banana Pro | broad | best infographics | strong | $0.134 1K/2K [verified] | no | closed |
| GPT Image 2 / 2.5 | broad | very strong at high quality | edit, refs | ~$0.053 medium, ~$0.21 high at 1K [reported]; OpenAI page conflict | no | closed |
| FLUX 3 Image | broad, photoreal | not found | multi-ref, bbox edit [reported] | not found | no | API; Klein 5.6B open weights Oct 15, license unverified |
| FLUX.1 Kontext / FLUX.2 | editing, consistency | ok | in-context edit | Replicate flux-1.1-pro $0.04 [verified] | no | dev NC; pro API |
| Ideogram 4 | design/poster | best published typography (reported, TeamDay) | style refs | $0.03/0.06/0.10 on fal [reported] | no | 9.3B open weights per one source [unverified] |
| Recraft V4.1 | design, icons, flat illustration | good | style control | raster $0.035, Vector $0.08, Pro Vector $0.30, vectorize $0.01 [reported] | YES, SVG | closed |
| Seedream 5.0 | broad | good incl. Chinese | multi-ref | Flash $0.018, Lite $0.035, Pro ~$0.045 [reported] | no | closed |
| Qwen-Image 2512 / Edit / Layered | broad | strong, esp. Chinese | Layered gives RGBA layers | self-host; 2.0/3.0 API only; 2.1 research-only [reported] | no | 2512 line Apache 2.0 [reported] |
Takeaways: Recraft is the only real SVG source (animatable shapes in Remotion). Qwen-Image-Layered (Apache 2.0, 20B) outputs layers, useful for parallax, but heavy to host. For typography in an image, Nano Banana Pro or Ideogram 4; for animated text, render in code instead.

## 3. 2.5D and parallax
| Tool | Role | License | Verdict |
|---|---|---|---|
| Depth Anything 3 Small (0.08B) / Base (0.12B) | monocular depth | Apache 2.0 [verified GitHub] | USE |
| DA3 Large/Giant/Nested | better depth | CC BY-NC 4.0 [verified] | skip (hackathon may be fine, but not shippable) |
| Depth Anything V2 Small | depth | Apache 2.0; others CC-BY-NC [reported] | backup |
| Apple Depth Pro | metric depth | research only [reported] | skip |
| Marigold | diffusion depth, slow | LCM ckpt Apache 2.0 [reported] | backup for quality |
| DepthCrafter | video depth | non-commercial [reported] | skip |
| DepthFlow | parallax renderer | AGPL-3.0 [verified repo] | skip; copying shader logic into Remotion/three.js is easy |
| LaMa | inpaint holes behind cutouts | Apache 2.0 [unverified, from memory] | use for background fill |
| FLUX fill / Nano Banana edit | generative fill | API | use Nano Banana "remove object, fill background" |
Method: cutout (SAM 3.1/BiRefNet) gives layers; background inpainted; each layer moves at depth-scaled speed. Cheaper and more controllable than I2V, and no generative drift.

## 4. Matting
BiRefNet (MIT) for hair/edge-quality alpha. RMBG-2.0 is CC BY-NC (commercial needs BRIA agreement). MatAnyone/MatAnyone2 under S-Lab 1.0, likely non-commercial. RobustVideoMatting GPL-3.0. For moving video, run SAM 3.1 video masks, then BiRefNet per frame if edges look rough. [reported, see cv-tools-licenses.md]

## 5. Animating characters from stills
- Rig-from-cutout (2D puppet): split character into limbs via SAM, pivot joints, animate with sine/spring in Remotion. Free, deterministic, on-brand. Recommended over generative character video.
- Talking heads: LatentSync 1.6 (Apache 2.0, CUDA, video-to-video lip replace), MuseTalk (30+ fps), Hedra (~$0.05/s [reported]), OmniHuman via BytePlus (not verified), Sync Labs (price not found). For a stylized explainer, mouth-flap swap of 3 to 4 mouth shapes by phoneme is enough.
- Interpolation: RIFE (MIT), FILM (Apache-2.0, unverified); only needed to smooth 12 fps generated clips.
- Live2D: proprietary SDK, skip.

## 6. Upscaling archival
Real-ESRGAN (BSD-3, frame-wise, flicker, weak on faces/text), SeedVR2 (best quality, needs A100/H100, license conflicting, verify), FlashVSR (Apache-2.0), Video2X (AGPL wrapper). For stills, upscale with Nano Banana ("upscale, keep detail") or Real-ESRGAN on a T4 ($0.000164/s). [reported]

## 7. Hosting prices (per second)
| GPU | Modal [verified] | Replicate [verified] | fal list/low (per hour) [verified] |
|---|---|---|---|
| T4 | 0.000164 | 0.000225 | n/a |
| L4 | 0.000222 | n/a | n/a |
| L40S | 0.000542 | 0.000975 | n/a |
| A100 80GB | 0.000694 | 0.0014 | n/a |
| H100 | 0.001097 | 0.001525 | $4.50 / $2.49 |
| H200 | 0.001261 (committed only) | 0.001525 | $6.00 / $2.99 |
| B200 | 0.001736 | n/a | $7.99 / $5.49 |
Modal Starter gives $30/month free compute. Depth + BiRefNet per image on L40S costs well under $0.01.

## 8. Recommendations
Use gen video when: a physical motion no still can fake (water, crowd, explosions, camera push into a scene), abstract mood b-roll, or a hero opener. Use stills + motion when: explaining concepts, anything with text, real photos/archival (never animate real people or archival with gen video; it fabricates), consistent characters, maps, diagrams. Budget: at most 10 to 15 s of gen video per 60 s.

Stack:
- Stills: Muse Image (core) plus Nano Banana 2.1 (text, edit, fill), Recraft V4 Vector (SVG).
- Cutout: SAM 3.1 + BiRefNet. Depth: DA3 Base. Parallax: own Remotion layer code.
- Gen video: Gemini Omni Flash default; Kling 3.0 or Wan 3.0 via fal as fallback; LTX-2.5 on Modal if an open-weights story is wanted.
- Lip-sync only if a face talks: LatentSync on Modal.
- Upscale: Real-ESRGAN on Modal T4.

Cost per 60 s portrait video (assume 24 beats):
| Item | Cost |
|---|---|
| 14 generated stills, Nano Banana 2.1 1K | $0.47 |
| 4 SVG, Recraft V4 Vector | $0.32 |
| Depth + matting + fill, ~2 GPU-min L40S | $0.07 |
| 3 gen clips x 5 s = 15 s, Omni Flash 720p | $1.50 |
| Retries 30% on generation | ~$0.60 |
| Total hybrid | about $3.00 |
| Stills only (no gen video) | about $1.00 |
| All-generated 60 s: Omni Flash $6.00, Kling 3 720p $5.04, Wan 3 720p $6.00 (480p $3.00), Seedance 2.5 720p $13.90, Luma 720p $3.60 | $3 to $14 |

## Open questions
- Does Gemini Omni Flash 1.1 expose a no-credentials path for judges (API key owned by us is fine, confirm quota/rate limits)? Latency and 9:16 I2V details not in official docs fetched.
- Wan 3.0 9:16 support and fal vs Alibaba price (reports: $0.05/0.10/0.20).
- FLUX 3 Image price and Klein license; GPT Image 2 true price (OpenAI page vs reports differ 2x).
- Kling official price page was not reachable; numbers are third party.
- MiniMax H3 territory exclusion: does API use via fal count as use in US? Avoid.
- SeedVR2, MatAnyone, LaMa, FILM licenses need checking at repo before use.
- Muse Image/Wonder video capability (other agent) may replace several rows.
