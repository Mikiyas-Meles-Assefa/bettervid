# Video input
URL: https://dev.meta.ai/docs/video-understanding (retrieved 2026-10-29); files: https://dev.meta.ai/docs/file-handling
- Video: MP4 only. Audio: MP3, WAV. Page gives NO max duration, fps or frame sampling, token per frame.
- Pass: Files API upload purpose=user_data then input_file or input_video with file_id; or input_video video_url (public or base64 data URL); Chat Completions video_url part.
- "reads the visual frames and the embedded audio together"; one upload returns description plus transcript. Videos without audio valid.
- 1.3 caveat: audio understanding "currently not fully supported"; examples use muse-spark-1.2.
- Set max_tokens/max_output_tokens >= 4000 (reasoning shares budget; empty transcript with finish_reason length). For long clips use stream:true and/or lower reasoning_effort to avoid idle-timeout disconnects.
- Files: inline 50 MB; Files API 1 GiB; team storage 100 GiB; expires_after 3600..2592000 s. PDF: first 100 pages text, first 50 page images. Max 50 images per request. Image ~1280px costs 1,300-1,500 tokens. Grounding coords normalized 0-1000.
- HF model card Muse Spark Open: short/low-res clips (few seconds ~100px) may be refused; use >=448px short side.
