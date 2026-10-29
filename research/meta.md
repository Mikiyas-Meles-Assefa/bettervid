# Meta stack for bettervid (research date 2026-10-29)

## TL;DR
1. Everything runs on one base URL, https://api.meta.ai/v1, with OpenAI SDK compatibility (Responses, Chat Completions, Messages). Key format LLM|id|secret. [verified] sources/meta/models.md
2. Use Muse Spark 1.3 Standard ($1.25 in / $4.25 out per 1M, 3,000 RPM) as the workhorse for research, writing and critic. Wonder ($4 / $20) only for the Director shot-list step if quality needs it. [verified] sources/meta/pricing-limits.md
3. Critic: Spark CAN take MP4 (Files API, up to 1 GiB, or inline 50 MB) and reads frames plus embedded audio, but 1.3 audio is officially "not fully supported". Plan: send the MP4 to 1.3 for visual critique, and either use muse-spark-1.2 for the audio pass or transcribe audio separately with Voice Transcribe. Fps, max length and per-frame token cost are NOT documented. Run a 1 minute test first. [verified, with gaps]
4. Muse Image: $0.01/image, ~10-18 s each, 150 RPM only (the tightest limit). Text rendering is excellent (img.ly 5/5 accuracy). No seed, no mask, no transparency. For 9:16 request size 1024x1536 or 1024x1792 (ratio only is honored, then check dims); 1152x2048 reported on the Muse site. Test it. [verified docs / reported sizes]
5. SAM 3.1: $0.20/1k frames, $2.50/1k images. Output is text tokens with base85 masks at low resolution (not RLE), so budget parser time (use @meta-sam/parser or meta-sam-parser) and upscale masks. One concept per request, max 16 objects, 15,000 frames. [verified]
6. Voice Transcribe is turn-level timestamps ONLY, so it cannot do word captions. Use forced alignment (whisper/WhisperX or MFA) for word timings. No Meta TTS exists. [verified]
7. Open weights bonus ($10k): Muse Glimmer 30B (Apache 2.0, image-in, text-out, 24-64 GB) is the safe choice, available on Together, Fireworks and others. Muse Spark Open ($1.25/$4.25 on Baseten/Fireworks, native video+audio input) is the heavy option. Put a visible open-weights role in the pipeline (e.g. Glimmer as shot-list or caption-style agent) to claim the prize. [verified/reported]
8. Meta OSS for media is mostly NON-commercial (MusicGen/AudioGen/MAGNeT CC-BY-NC, MMS-TTS CC-BY-NC, CoTracker, Sapiens). Commercial-OK: DINOv3, VGGT-1B-Commercial (gated form), Video Seal (MIT), SAM license. Music/TTS must come from non-Meta sources. [verified]
9. Watch for 429s under load: many hackathon repos report 429s and retry fixes. Use backoff with Retry-After, cap parallelism for Image (150 RPM), enable stream for long video calls. [reported]
10. Official hackathon rules were not yet visible; hackathon page only lists tracks and criteria. Confirm external-API rules before relying on non-Meta TTS. [verified gap]

## 1. Muse Spark / Wonder (text+vision+video LLMs)
| Item | Fact | Source | Tag |
|---|---|---|---|
| IDs | muse-spark-1.3, 1.2, 1.1; -contributor for 1.3 and 1.2; muse-wonder-1.0 (preview) | dev.meta.ai/docs/models | verified |
| Context | 1,048,576 tokens, no long-context premium | models, pricing-rate-limits | verified |
| Inputs | text, image, video (MP4), audio (MP3/WAV), PDF; output text only | docs/models | verified |
| 1.3 vs 1.2 | 1.3 recommended for new work, better agentic/coding, ~20% fewer tool calls and 25% fewer tokens (Meta eval); 1.3 audio degraded, 1.2 recommended for audio | docs/models; layer3labs.io/guides/muse-spark-1-3-review | verified / reported |
| 1.3 release | 2026-09-02; Model API public preview 2026-07-09 | wavespeed / therouter summaries | reported |
| Price Spark Std | cached $0.15, in $1.25, out $4.25 per 1M | docs/pricing-rate-limits | verified |
| Price Spark Contributor | cached $0.002, in $0.10, out $0.20 per 1M; data may train Meta models; 150 RPM, 3M TPM; no "max" effort on 1.3-contributor | same | verified |
| Price Wonder | cached $0.20, in $4.00, out $20.00; Standard only; 3,000 RPM | same | verified |
| Rate limit | 3,000 RPM and 4M TPM per team per model (Std); background 600/min | same | verified |
| Web search | tools:[{"type":"web_search"}] on Responses and Messages API only (not Chat Completions); $2.50 per 1k queries; search_context_size; citations via url_citation; include web_search_call.results | docs/search-grounding | verified |
| Image search tool for Spark | Not documented. Image search/code exist only inside Muse Image (enable_image_search, enable_web_search, enable_shell) | docs/image-generation | verified |
| Code/shell tool | Function tools and parallel tool calls supported; a built-in shell tool is not documented for Spark | docs/models, cookbook | verified (gap) |
| Structured output | json_schema constrained decoding (response_format / text.format); no recursion, depth 10, 5,000 props; strict false acts like true | docs/structured-output | verified |
| Reasoning | effort minimal/low/medium/high/xhigh/max (none rejected 400); reasoning tokens billed as output; summaries via reasoning.summary (Responses). Set max_output_tokens >= 4000 | docs/reasoning | verified |
| Latency | Not published; reasoning default causes first-token delay | docs | verified (gap) |
| Quirk | Messages tool names browser.* reserved; OpenAI SDK needs explicit api_key | docs, cookbook README | verified |

Video input details (docs/video-understanding, file-handling):
- Formats: MP4 only. Pass via Files API (purpose=user_data; 1 GiB cap; expires_after optional) with input_video/input_file file_id, or video_url (public or data URL, inline 50 MB).
- Model reads frames plus embedded audio in one call. Silent renders are valid.
- NOT documented: max duration, fps sampled, tokens per frame. For comparison, Spark Open samples 2 FPS capped at 96 frames with "Time: 3.5s" stamps (HF blog), which is a hint but not a statement about the API. [unverified for API]
- Long clips: use stream:true and/or lower reasoning to avoid idle-timeout disconnects. Empty output if max_tokens too low.
- Can it critique a rendered MP4 reliably? Unproven. No published video benchmark for 1.3 (kingy.ai); no hands-on report found. A 2 FPS-ish sampling can miss fast kinetic text and cuts, so ask the critic for per-timestamp tickets and also feed it extracted keyframes and the render's shot list/EDL for cross-checking. For audio, run a separate 1.2 or Voice Transcribe pass. [unverified]
Verdict: Spark 1.3 = USE (research, writer, critic). Wonder = USE sparingly for Director if Spark plans look weak; 3x input and ~5x output cost. Contributor tier = cheap (12x less) but trains on your data; fine for a hackathon if no private user data, check rules.

## 2. Muse Image (muse-image-1.0)
| Item | Fact | Source | Tag |
|---|---|---|---|
| Endpoints | POST /v1/responses (stateful), /v1/images/generations, /v1/images/edits | docs/image-generation | verified |
| Price | $0.01 per generated image, search included, failures not billed | pricing | verified |
| RPM | 150 (no TPM) | pricing | verified |
| Latency | p50 17.8 s (img.ly), 17.45 s (OpenRouter), ~10 s (Leap); reasoning_strength low is faster | img.ly/ai-benchmarks, openrouter.ai/meta/muse-image | reported |
| Sizes | size "WxH" sets ONLY aspect ratio; output at generator's own res (~2.5 MP); ratios beyond 16:1 return 400; docs examples 1024x1536, 1536x1024, 1792x1024. 9:16 on Muse site returned 1152x2048 | docs; useapi.net | verified/reported |
| True 9:16? | Ask for 1024x1792 or 1024x1536 (closest ratios 0.571/0.667) or 1152x2048 (exact 9:16). Because only ratio matters, 1152x2048 or 1080x1920 should yield 9:16, but a cookbook-derived PR claims the Responses API only accepted three sizes. Test day 1; fallback generate 2:3 and crop or outpaint. | PR #94 CALENDARIOS-MARKETING-APP | unverified |
| Consistency | Responses API previous_response_id plus new instruction (store default true); or stateless replay with result:null | docs | verified |
| Edits | 1-10 reference images, compose scenes; no mask, no input_fidelity | docs | verified |
| Reference images | input_image parts interleaved with captions in Responses; up to 10 | docs, layer.ai | verified |
| Search flags | enable_image_search, enable_web_search, enable_shell (default true); reasoning_strength high/low; output webp default, png, jpeg | docs | verified |
| Text rendering | img.ly 5.0/5 text accuracy, typography 4.3/5; also does charts, infographics, QR codes (layer.ai) | img.ly | reported |
| Limits | No seed, no styles preset, output always opaque (no alpha), n up to 10 | docs | verified |
Good at: infographics, text-in-image, search-grounded real-world references (landmarks, products). Verdict: USE for generated art and title cards. Throttle to ~2 requests/s max, pipeline parallelism limited by 150 RPM and ~15 s latency (about 40 concurrent calls steady state). Backup: Flux/other non-Meta (other researchers' topic).

## 3. SAM 3.1 (sam-3.1)
- Grammar: concept prompt = one short noun phrase per request in input_text; or object prompts <Nf>id<|box;x1;y1;x2;y2;w;h|> / <|point;x;y;w;h|> (negative point prefix "-"), not mixed with phrases. metadata: propagation_direction both/forward/backward, include_confidence "true", mask_encoding lossless(~)/one_bit(!). [verified] sources/meta/sam.md
- Output: stream of response.output_text.delta lines, one per frame; box in source pixels; mask data=H,W,<enc>base85 (low-res raster, x=y=0). Not RLE. Use @meta-sam/parser (TS) / meta-sam-parser (Python), decodeMaskToRaster, convert to COCO RLE or SVG path via client libs. Cookbook 07_sam has working recipes (video to sticker pack, speech-bubble captions anchored to tracked heads). [verified]
- Video: MP4/MOV, H.264/H.265/MPEG-4 only; up to 15,000 frames; 16 objects; ids sparse, key by id. Faststart remux recommended. [verified]
- Price: $2.50/1k images ($0.0025 each); $0.20/1k frames, min 50 frames. 3,000 RPM. [verified]
- Open weights: facebook/sam3.1 on HF, gated, license "other" = SAM License (2025-11-19): royalty-free limited license, no explicit commercial ban, bans military/ITAR/weapons, requires shipping the license on redistribution, indemnity clause. Code github.com/facebookresearch/sam3, no Transformers integration. Object Multiplex ~7x faster at 128 objects on H100. VRAM not published; SAM3 (848M) class so a 16-24 GB GPU is plausible [unverified]. [verified license]
- Arbitrary photos, paintings, illustrations: SAM 3 is open-vocabulary by noun phrase and works on any image; for paintings/illustrations expect lower confidence on stylized content; use include_confidence and fallback to box/point prompts. No published test on paintings. [unverified]
- Cut-out caveat: masks are binary, hair/fur edges will be hard; feather/refine in editor. Muse Image can also clean up cut-outs (stallsnap PR #10 does this). [reported]
Verdict: USE for subject cut-outs and tracking. Backup: self-host facebook/sam3.1 on Modal (open-weights credit).

## 4. Muse Voice Transcribe (muse-voice-transcribe-1.0)
- $0.18/hour; realtime wss://api.meta.ai/v1/asr/realtime and POST /v1/asr/transcribe; 256 concurrent streams; 16,000 streams/hour. 25 evaluated languages with code-switching, diarization, keyword biasing. TURN-LEVEL timestamps only; no word timing, no TTS, no emotion tags. [verified]
Verdict: use only for diarized/URL ingestion (user video input to script). Word captions need forced alignment from another tool (WhisperX, MFA, or ctc-forced-aligner; MMS forced alignment `torchaudio` MMS_FA bundle is Meta but CC-BY-NC [unverified]).

## 5. Open-weight Muse
| Model | Size | License | Inputs | Hardware | Hosts and price | Tag |
|---|---|---|---|---|---|---|
| Muse Glimmer 30B (meta-models/Muse-Glimmer-30B, released 2026-08-10) | 29.6B dense, 131k ctx | Apache 2.0, all artifacts | text+image (video as frames, no audio) | 64 GB BF16, 32 GB, 24 GB (17 GB quant); RTX 5090 75 -> 233 tok/s with DFlash | HF, Ollama, LM Studio, vLLM, SGLang, Together, Fireworks, OpenRouter; no Meta API | verified/reported |
| Muse Spark Open 816B-A42B (released 2026-10-15) | 816B MoE, 42B active, 1M ctx | Muse Model License: commercial OK, "Built with Muse Spark Open" credit, >$20M MaaS needs agreement, gated form, bans disinformation, minors | text, image, video, audio -> text | 700 GB NVFP4, 2 TB BF16 | Baseten, Fireworks, Together, Modal, Nebius at $1.25/$4.25/$0.15 cached per 1M; LiteLLM IDs baseten/meta-models/muse-spark-open and fireworks_ai/accounts/fireworks/models/muse-spark-open; speed ~147-200 tok/s Baseten, ~68 Fireworks, 40 Together | verified/reported |
Hackathon partners: Baseten ($100 + 2M TPM), Modal ($100), Fireworks ($100) for select participants. Note vLLM serves Spark Open text+image only; SGLang does video+audio; on partner APIs video support is unverified. Glimmer reasoning set in system prompt "Reasoning strength: <value>". Verdict: use Glimmer for a cheap bulk role (alt-text, caption styling, beat classification, Muse Image prompt expansion) to qualify for the open-weights prize; Spark Open for a hosted video-critic fallback if its host accepts video [unverified].

## 6. Other Meta OSS
| Tool | Does | License | Commercial? | Usefulness for bettervid |
|---|---|---|---|---|
| AudioCraft (MusicGen, AudioGen, MAGNeT, EnCodec) | music and SFX generation | code MIT, weights CC-BY-NC 4.0 | No | Skip for the final product; ok only if rules permit (risky) [verified] |
| Audiobox / Seamless / Voicebox | speech/sound gen, translation | Not found open in 2026; historically CC-BY-NC or research | likely No | Skip [unverified] |
| MMS-TTS | per-language VITS TTS, 36M params | CC-BY-NC 4.0 | No | Robotic quality; skip [verified] |
| Meta TTS in Muse | none | n/a | n/a | No Meta narrator exists [verified] |
| DINOv3 | dense visual features | DINOv3 License | Yes | Image similarity / stock-pick reranking [verified] |
| VGGT | depth, cameras, point maps from images, <1 s per scene | code commercial; VGGT-1B-Commercial checkpoint by auto-approved form | Yes (commercial ckpt) | Best Meta option for depth for 2.5D parallax; also multi-view/camera moves [verified] |
| Depth Anything | Not Meta (ByteDance/HKU) | n/a | n/a | Use as depth backup [reported by brief] |
| Sapiens | human depth, normals, parts, pose | CC BY-NC 4.0 | No | Skip [verified] |
| CoTracker3 | point tracking | mostly CC-BY-NC | No | Skip; SAM 3.1 tracking covers it [verified] |
| Video Seal | invisible watermark | MIT | Yes | Optional "AI provenance" polish [verified] |
| Movie Gen | text-to-video 30B, 16 s 16 fps; audio 13B | not released, no API | n/a | Not available [reported] |
| Llama | superseded by closed Muse Spark in April 2026; older Llama licenses carry the 700M MAU clause | Llama Community | yes w/ limits | Not needed [reported] |

## 7. Quirks, outages, community
- Hackathon: Oct 26 to Nov 4 21:00 ET, judging Nov 4-8; Official Rules not visible yet (check Discord). [verified]
- 429s common: Muse Code subscription quota issues acknowledged by Meta; hackathon repos add retries on 429/500/502/503/504. Voice stream rejection code 1013. [reported]
- Idle-timeout disconnects on long video calls; streaming advised. [verified]
- Spark 1.3 audio is degraded; OpenRouter lists 1.3 without audio input. [reported]
- Contributor tier cap only 150 RPM (one guide says 100). [verified/reported]
- Muse Wonder "max" via API is not "Wonder Full"; 1.3 "max" tier described as partner-only preview by one review but the reasoning doc lists max as working on 1.3 [conflict, verified doc wins].
- No batch endpoint (third party). [reported]
- No outage reports found for Meta Model API. dev.meta.ai/docs has an API Status page (not read). [unverified]

## 8. Pipeline mapping
| Pipeline stage | Best Meta option | Backup |
|---|---|---|
| Research + fact sheet | Muse Spark 1.3 + web_search (Responses API, citations) | Spark 1.3 Contributor ($0.10 in) or Glimmer, non-Meta search APIs |
| Writer | Muse Spark 1.3 (reasoning medium/high) | Wonder |
| Director / shot list JSON | Muse Wonder 1.0 with json_schema | Spark 1.3 high effort |
| Real photo/archival picking | Spark vision to rerank candidates (image input, 50/req); DINOv3 embeddings | Glimmer |
| Generated art / title cards | Muse Image (previous_response_id for series consistency) | non-Meta image models |
| Subject cut-out / tracking | SAM 3.1 API (concept or box prompts) | self-hosted facebook/sam3.1 on Modal |
| Depth for parallax | VGGT-1B-Commercial (gated form) | Depth Anything (non-Meta) |
| Style unification | Muse Image edit with reference images | color grade in code |
| Narration TTS | none from Meta | non-Meta TTS (other researcher topic) |
| Forced alignment / word timing | none (Voice gives turns only) | WhisperX / MFA / ctc aligner |
| Music and SFX | none commercial (MusicGen is NC) | non-Meta licensed libraries |
| Ingest user video/audio | Voice Transcribe (diarized) + Spark video understanding | Whisper |
| Critic | Spark 1.3 on MP4 (visual) + Spark 1.2 or Voice Transcribe for audio | Spark Open via Baseten/Fireworks (if video accepted) |
| Open-weights bonus slot | Muse Glimmer 30B (Apache 2.0) on Fireworks/Together/Modal | Muse Spark Open on Baseten |

## Open questions
1. Real video sampling rate, max length and per-frame token cost for Spark 1.3 API (run a probe with counting via POST /v1/responses/input_tokens).
2. Does Muse Image accept 1080x1920 / 1152x2048 / 1024x1792 via the API and what dimensions return?
3. Does the Spark 1.3 critic notice timing issues, text overflow and audio sync? Needs a calibration test with a deliberately broken render.
4. SAM 3.1 quality on paintings/illustrations and GPU size for self-hosting.
5. Official Rules: are non-Meta APIs (TTS, music) allowed, and how are credits ($150) applied?
6. Do Baseten/Fireworks endpoints accept video/audio for Spark Open?
7. Whether the dev.meta.ai status page shows known incidents.
