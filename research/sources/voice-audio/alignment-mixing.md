# Alignment and mixing (retrieved 2026-10-29)
arXiv 2610.17782 "Where Words Begin and End" (reported via search): MFA most precise; CTC aligners start words late; WhisperX ~60 ms late median; Qwen3-ForcedAligner within a few ms.
arXiv 2606.10675 (reported): WhisperX word accuracy on TIMIT within 10/25/50/100 ms = 22.4/52.7/82.4/94.2%.
Qwen3-ForcedAligner-0.6B https://github.com/QwenLM/Qwen3-ASR (reported): Apache 2.0, 11 languages (zh,en,yue,fr,de,it,ja,ko,pt,ru,es), NO Arabic, up to 300 s, word/char timestamps, released 2026-01-29.
Loudness (reported, many blogs; TikTok has no official spec): YouTube normalizes to about -14 LUFS (turns down only); Reels about -14; TikTok sources disagree (-14 vs hotter -10..-8). True peak <= -1 dBTP.
ffmpeg: loudnorm defaults I=-24 TP=-2, set I=-14:TP=-1:LRA=11, two-pass with measured_* and linear=true (https://ffmpeg.org/ffmpeg-filters.html). Ducking: asplit voice, sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500, then amix=normalize=0.
Chatterbox https://github.com/resemble-ai/chatterbox : MIT, 23 langs incl Arabic, Turbo English-only 350M with [laugh] tags, PerTh watermark, Multilingual V3 0.5B.
Qwen3-TTS https://github.com/QwenLM/Qwen3-TTS : Apache-2.0, 10 langs, NO Arabic, 3 s clone, 97 ms.
Kokoro https://huggingface.co/hexgrad/Kokoro-82M : Apache 2.0, 8 langs, 54 voices, no cloning.
