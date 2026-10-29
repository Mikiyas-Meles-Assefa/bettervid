# Models page
URL: https://dev.meta.ai/docs/models (retrieved 2026-10-29)
- Wonder/Spark inputs: text, image, video, audio, PDF; output text. 1,048,576 context. Same request shape; swap model ID.
- Wonder: muse-wonder-1.0 preview, Standard only on API; reasoning minimal..max. Wonder Full only in Muse Code paid plans. Not in South Korea.
- Spark 1.3 "Recommended for new work", better coding; audio "not fully supported", quality may be degraded. 1.2 "Recommended for audio input". 1.1 original, Standard only.
- Standard: content not used for training. Contributor: may train future Meta models, cheaper, selected by model ID.
- Voice Transcribe: turn-level timestamps only, 25 evaluated languages, no TTS, no word-level timestamps.
- SAM 3.1: noun-phrase, box or point prompts; boxes and masks; video tracking.
- Muse Image: agentic, can search web and run code before rendering.
- Reasoning page (https://dev.meta.ai/docs/reasoning): effort none (rejected 400 for Wonder/Spark), minimal, low, medium, high, xhigh, max (not on 1.3-contributor). Reasoning tokens billed as output. max_tokens shares budget. No logprobs.
