# Muse Image
URL: https://dev.meta.ai/docs/image-generation (retrieved 2026-10-29)
- muse-image-1.0, $0.01/image, n bills n. Endpoints POST /v1/responses, /v1/images/generations, /v1/images/edits.
- size "WxH" e.g. 1024x1536, 1536x1024, 1792x1024: "sets only the aspect ratio. Output comes at the generator's own resolution". Ratios beyond 16:1 return 400. Omit size or "auto".
- Responses: previous_response_id + new instruction for multi-turn; store=false replay image_generation_call with result null. Tool entry image_generation with enable_image_search, enable_web_search, enable_shell (default true), reasoning_strength high|low, size, output_format webp|png|jpeg.
- Images endpoint: n 1-10, response_format b64_json|url, stream, extension reasoning_strength and tool_enablement via extra_body. background always opaque (no transparency). No seed, no mask, no style presets.
- Edits: 1-10 input images, compose multiple. mask, input_fidelity, partial_images rejected.
- Errors 400 content_policy_violation, 503 retry.
Third party: img.ly benchmark p50 17.8s, text accuracy 5/5, typography 4.3/5 (https://img.ly/ai-benchmarks/models/meta-muse-image/); OpenRouter latency 17.45s; Leap ~10s; model card ~2.5 megapixels; providers list 9:16 (https://layer.ai/models/meta-muse-image). None tested 9:16 specifically.
