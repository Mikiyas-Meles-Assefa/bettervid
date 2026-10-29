# ElevenLabs models, v4, alignment
URL: https://elevenlabs.io/docs/overview/models (retrieved 2026-10-29)
- eleven_v4: 90+ langs, 10,000 char limit; offered via Text to Dialogue API. eleven_v4_turbo: ~100ms median, audio tags, Text to Dialogue websocket
- eleven_v3: 70+ langs, 5,000 chars. eleven_multilingual_v2: 29 langs. eleven_flash_v2_5: 32 langs, ~75ms, 40k chars
- eleven_text_to_sound_v2 (SFX); music_v2_5 / music_v2 / music_v1
- scribe_v2: word-level timestamps, 90+ langs
URL: https://techcrunch.com/2026/09/28/elevenlabs-new-v4-speech-model-supports-more-expression-control-and-90-languages/
- v4 + v4 Turbo launched 2026-09-28, 90+ languages, clone from ~10 s, stackable audio tags
URL (search aggregate, reported): launch 72% API discount ended Oct 12; list $0.08/1k (v4), $0.04/1k (Turbo)
URL: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
- POST /v1/text-to-speech/{voice_id}/with-timestamp -> audio_base64, alignment{characters, character_start_times_seconds, character_end_times_seconds}, normalized_alignment. Params: stability, similarity_boost, style, speed, seed, previous_text/next_text, previous_request_ids
URL: https://elevenlabs.io/docs/api-reference/forced-alignment/create
- POST /v1/forced-alignment multipart (file, text) -> characters[{text,start,end}], words[{text,start,end,loss}], loss. File < 1GB. Price not on page. Diarization unsupported.
