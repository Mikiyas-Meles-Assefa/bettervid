# Cartesia websocket TTS
URL: https://docs.cartesia.ai/api-reference/tts/websocket (retrieved 2026-10-29)
- add_timestamps:true -> events type "timestamps" with word_timestamps{words[],start[],end[]} in seconds; add_phoneme_timestamps also available
- generation_config: speed 0.6-1.5, volume 0.5-2.0, emotion enum neutral|calm|angry|content|sad (else inferred from text)
