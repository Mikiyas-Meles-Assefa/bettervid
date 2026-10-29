# voice-audio research (retrieved 2026-10-29)

Sources are saved in `research/sources/voice-audio/`. Tags: [verified] official page read, [reported] third party or search summary, [unverified] inferred.

## TL;DR
1. Narration primary: ElevenLabs Eleven v4 (`eleven_v4`). #2 on the Artificial Analysis (AA) provider arena (Elo 1334; v4 Turbo 1336 is #1), audio tags, 90+ languages incl Arabic, voice cloning, character-level timestamps endpoint. API $0.08 per 1K chars, about $0.08 per minute. [verified: aa-tts-leaderboard, elevenlabs-api-pricing]
2. Cheap narration fallback: Gemini 3.8 Flash TTS. #5 on AA (1283), best Arabic MSA/Egyptian in Google's own arena (1204 vs Eleven v3 1020), about $0.014/min until 2026-12-31, then double. Free tier exists. Max 2 speakers per request, no timestamps. [verified pricing, vendor claim on Arabic]
3. Open-source narration fallback: Chatterbox (MIT, 23 langs incl Arabic, cloning) for Arabic and multilingual. Kokoro (Apache, English strong, no cloning) for fast English. Qwen3-TTS (Apache, 10 langs, NO Arabic) is a good English option. Avoid Fish S2 Pro weights, Breeze TTS 2, OmniVoice, XTTS, MMS (non-commercial or special license).
4. Skip: Hume (APIs sunset 2026-11-13), PlayHT (shut down, acquired by Meta), VibeVoice (license withdrawn), MiniMax ($100/1M chars, weak Arabic).
5. Word timing: free path first. ElevenLabs `with-timestamp` TTS endpoint gives character times from the synthesis itself. For any other TTS, run an aligner on the audio: ElevenLabs Forced Alignment (word times, <1 GB, price not published) or open-source Qwen3-ForcedAligner (Apache, but no Arabic) / WhisperX / MFA. Arabic needs WhisperX/MMS wav2vec2 or ElevenLabs.
6. Music primary: ElevenLabs Music v2.5 (`music_v2_5`, 3 s to 5 min, instrumental, composition plan, licensed training data, commercial use on Starter+). $0.15/min list. Cheap: Google Lyria 3.5 ($0.08 per song) or Stable Audio 2.5/3.0 ($0.08 per generation). Open: ACE-Step 1.5 (MIT). Do NOT use Meta MusicGen weights commercially (CC-BY-NC 4.0). Suno has no official API; Udio is a walled garden.
7. SFX: ElevenLabs SFX v2 (30 s max, loop, 48 kHz, $0.12/min metered per generation) plus a pre-pulled CC0 library (Freesound CC0 filter, Pixabay). MMAudio for video-to-audio is optional. Verify MMAudio/Hunyuan-Foley licenses before use (not checked).
8. Mix: duck music with ffmpeg `sidechaincompress`, music about -20 dB below voice bed, final two-pass `loudnorm` I=-14, TP=-1. TikTok has no official spec; -14 is safe, the others are hotter guesses.
9. Meta angle: Meta has no TTS/music generator usable commercially here. SAM Audio (separation, SAM License) is the only relevant Meta open audio model; AudioCraft weights are non-commercial. Audio will not count as the "Meta core", so keep cost and risk low.
10. Cost per 60 s video: primary about $0.30, cheap about $0.10, open-source about $0 plus GPU time (see end).

## 1. TTS comparison (price per ~1 minute of narration; 1 min is about 1,000 chars)

AA Elo is from the provider-voice arena [verified: https://artificialanalysis.ai/text-to-speech/leaderboard]. Cost per minute is computed by me from listed unit prices.

| Model | AA rank / Elo | Price (unit) | ~$/min | Timestamps | Arabic | Clone | Emotion / control | Verdict |
|---|---|---|---|---|---|---|---|---|
| ElevenLabs Eleven v4 | #2, 1334 | $0.08/1K chars [verified] | 0.08 | Yes, char-level via `/with-timestamp` [verified] | Yes (90+ langs) [reported GitHub issue, verified model list says 90+] | IVC 10 s; PVC Creator+ | Stackable audio tags, Text to Dialogue (multi-speaker), stability/style/speed | USE |
| ElevenLabs v4 Turbo | #1, 1336 | $0.04/1K [verified, "Flash / Turbo" line] | 0.04 | Not documented for TTS | Yes | same | tags; ~100 ms median; websocket | USE for cheap drafts |
| ElevenLabs v3 | #22, 1188 | $0.08/1K [verified] | 0.08 | Yes | Yes | IVC | tags; 5,000 char limit | superseded by v4 |
| ElevenLabs Flash v2.5 | not in top 30 | $0.04/1K | 0.04 | Yes | Yes (32 langs) | IVC | no tags | backup |
| Cartesia Sonic 3.6 | #4, 1296 | $49/1M (AA); plans $5 to $299; about 750-800 credits/min [verified pricing page] | 0.04-0.05 | Word and phoneme timestamps (websocket) [verified] | Yes (44 langs) [verified] | IVC from Pro $5 | emotion enum, speed 0.6-1.5, volume | BACKUP; leads AA multilingual arenas (reported) |
| Gemini 3.8 Flash TTS | #5, 1283 | $9/1M audio tokens out, 25 tok/s [verified]; $18 from 2027-01-01 | 0.0135 (0.027 in 2027) | None documented | Yes, MSA and Egyptian; 130+ langs [verified] | Voice replication + design [verified] | Style prompt + `<laugh>` `<short pause>` tags; 2 speakers/request | USE as cheap fallback, best Arabic evidence |
| Gemini 3.8 Flash-Lite TTS | #9, 1259 | $6/1M out | 0.009 | None | Yes, 100+ langs | yes | same | cheapest hosted |
| Inworld Realtime TTS-2 | #7, 1267 | $25/1M (on-demand), $20 Creator | 0.02-0.025 | Listed as feature [verified] | "200+ langs", Arabic not named | IVC all tiers | | BACKUP 3 |
| Fish Audio s2.1-pro | #21, 1188 (Drama 3 Preview #11, 1240) | $15/1M UTF-8 bytes; drama-3 $50 (promo $10 to 2026-11-12) [verified] | 0.015 (Arabic costs more bytes) | not found | 83 langs (reported) | yes | tags | OK; open S2 Pro weights NOT free commercially [reported] |
| OpenAI gpt-4o-mini-tts | not in top 30; Google arena Arabic 911 | $0.60/1M text in, $12/1M audio out; tts-1 $15/1M chars [verified] | about 0.015 (reported, tokens/min not verified) | none | weak | no (preset voices) | instructions prompt | SKIP, no newer TTS listed |
| MiniMax Speech 2.8 HD | #26, 1174 | $100/1M chars [reported] | 0.10 | n/a | partial | $1.50/voice | | SKIP |
| Hume Octave 2 | n/a | $0.12-0.15/1K overage [reported] | 0.10-0.15 | | | | | SKIP: TTS and EVI APIs end 2026-11-13 [reported; official changelog URL 404'd] |
| PlayHT / PlayAI | n/a | | | | | | | DEAD, Meta acquired Jul 2025, shut down 2025-12-31 [reported] |
| Resemble (hosted), Microsoft Azure | not researched in depth | | | | | | | not evaluated (open question) |

Top AA models not in your list but notable: Qwen-Audio-3.1-TTS-Plus (#3, 1305, $19.3/1M, Alibaba API, closed), Speechify Simba 3.2 ($6.6/1M, #10), Mistral Voxtral 3 TTS ($13/1M, #14). [verified leaderboard] I did not check their Arabic, timestamps, or terms.

Evidence caveats: AA Elo gaps under about 15 points are noise [verified, page lists ±10-16]. ElevenLabs v3 outranks nobody on the newest list but AA's Controlled Voice Arena (same 8 cloned voices) had Cartesia Sonic 3.5 first (1122) over Eleven v3 (1088) [reported]. If you clone a voice, Cartesia may beat ElevenLabs. Eleven v4 latency claims (150 ms vs Cartesia 262 ms) are ElevenLabs' own tests [reported].

### ElevenLabs details
- Models: `eleven_v4` (10,000 chars per request, about 10 min, via Text to Dialogue API), `eleven_v4_turbo`, `eleven_v3` (5,000 chars), `eleven_multilingual_v2`, `eleven_flash_v2_5`. [verified: elevenlabs.io/docs/overview/models]
- Launch 2026-09-28; clone from ~10 s; stackable audio tags; PVC back. [reported: TechCrunch fetched; rest verified by TechCrunch text]
- Launch 72% discount ended 2026-10-12 [reported]. Use the $0.08/$0.04 list prices.
- Consumer plans: Starter $6 (30k credits, commercial license, IVC), Creator $22 (121k credits, PVC), Pro $99 (600k). About 1 credit per char. Extra minutes cost $0.17-0.20/min, so API is cheaper at about $0.08/min. [verified: elevenlabs.io/pricing]
- API tiers list included chars (Starter $6 = 75k v3/v2 chars, Creator $22 = 275k) [verified: elevenlabs.io/pricing/api]. Judges need no credentials if you pre-render or use your own key server side.
- Commercial terms for TTS are not stated on the API price page; commercial license starts at Starter on the consumer page [verified]. Free tier is not commercial.
- `with-timestamp` endpoint: returns `audio_base64` plus `alignment` and `normalized_alignment` (parallel arrays of characters, start and end seconds). Supports `previous_text`/`next_text` for continuity across chunks, `seed`, `speed`. [verified]
- Gotcha: v4 chunking at 10k chars is fine for 60-120 s (about 1,000-2,000 chars). Use request stitching for multi-paragraph voice consistency.

### Multi-voice stories
- ElevenLabs Text to Dialogue (v4) handles multiple speakers in one script [reported/verified model list]. Gemini: max 2 speakers per request, so generate per line and concatenate for more. [verified]

### Arabic
- Best evidence: Gemini 3.8 Flash TTS (Google-run arena Arabic MSA: 1204, Flash-Lite 1181, Eleven v3 1020, gpt-4o-mini-tts 911) [reported; vendor-run]. A developer test in Oct 2026 also preferred Gemini for Egyptian narration but did not blind-test ElevenLabs [reported].
- Independent: AA has an Arabic leaderboard (Controlled Voice Arena, 9 languages) but I could not read the Arabic page (X link returned 402). Cartesia leads 8 of 9 languages [reported]. Check artificialanalysis.ai directly. Open question below.
- Open source with Arabic: Chatterbox Multilingual (MIT, Arabic listed) [verified GitHub]. IndexTTS-2.5 lists Arabic but license needs commercial permission [reported]. Qwen3-TTS and Kokoro: no Arabic [verified/reported].

## 2. Open-source TTS

| Model | License | Langs | Clone | Notes | Verdict |
|---|---|---|---|---|---|
| Chatterbox (Resemble) | MIT [verified] | 23 incl Arabic; Turbo is English-only 350M with `[laugh]` `[cough]` tags | Yes (reference clip) | PerTh watermark in output; Multilingual V3 0.5B; AA open-weights score 1020 (Aug, reported) | USE as OSS fallback |
| Kokoro-82M | Apache 2.0 [verified] | 8 langs, 54 voices | No | AA 1060 (reported); tiny, CPU real-time | USE for English drafts |
| Qwen3-TTS 0.6B/1.7B | Apache 2.0 [verified] | 10, no Arabic | 3 s clone, voice design | 97 ms streaming | USE for English/EU if clone needed |
| Step Audio EditX | Apache 2.0 (reported) | | | highest Apache AA open model 1102 (Aug, reported) | watch |
| Fish Audio S2 / Drama 3 weights | Research license, commercial needs paid license [reported] | | | top open model on AA (1240) but hosted API is $15/1M | API only |
| Breeze TTS 2, OmniVoice, XTTS-v2, MMS | non-commercial [reported] | | | | skip |
| VibeVoice | MIT withdrawn [reported] | | | | skip |
| Dia/Dia2, Sesame CSM, F5-TTS, Orpheus, Higgs Audio, IndexTTS | not individually verified this pass | | | Higgs V3 research license (reported); IndexTTS needs commercial request (reported) | not evaluated |

Word timestamps from OSS TTS: none give reliable word times; run an aligner (below).

## 3. Word timing

| Tool | How | Accuracy | Price / license | Arabic | Verdict |
|---|---|---|---|---|---|
| ElevenLabs TTS `with-timestamp` | char times returned with synthesis | exact to the generated audio (no alignment error) [unverified claim; derived from model output] | included in TTS price | yes | USE first |
| ElevenLabs Forced Alignment | POST /v1/forced-alignment, file+text, word and char times with loss | not published | price not on API pricing page [verified absent] | likely (languages not stated) | USE when TTS elsewhere |
| Cartesia websocket | `add_timestamps:true`, word start/end | native | included | yes | use if Cartesia |
| Qwen3-ForcedAligner-0.6B | HF model, non-autoregressive, 300 s limit | beats NFA, WhisperX per Qwen; within a few ms of MFA in 2610.17782 [reported] | Apache 2.0 | NO (11 langs) | OSS for English |
| WhisperX | wav2vec2 phoneme CTC after Whisper | median word starts about 60 ms late; 52.7% within 25 ms on TIMIT [reported] | BSD, free | yes via wav2vec2 Arabic model (reported, check) | OSS fallback, good enough for captions |
| Montreal Forced Aligner | Kaldi, needs dictionary + acoustic model | most precise on English [reported] | MIT, free | Arabic model exists (not verified here) | heavy setup, skip in hackathon |
| ElevenLabs Scribe v2 | ASR, word timestamps | | $0.22/hour [verified] | yes | alternative; cheap |

For karaoke captions, 60 ms error is invisible at 30 fps (33 ms per frame, so about 2 frames). Add a small negative offset (~40-60 ms) to start times for CTC aligners.

## 4. Music

| Option | Quality / control | Price | License / rights | Verdict |
|---|---|---|---|---|
| ElevenLabs Music v2.5 | Composition plans, section edit, audio reference, instrumental, 3 s-5 min; stems/loops not documented [verified] | $0.15/min list [verified]; Vercel shows $0.07/min promo to 2026-11-09 [reported] | "cleared for nearly all commercial uses"; Starter+ ($6) [verified]. Self-serve excludes film/TV/games [reported]. Licensed training (Merlin, Kobalt, Believe, UMG deal) [reported] | USE |
| Google Lyria 3.5 (Gemini API) | up to ~3 min songs, 44.1 kHz | $0.08 per song, paid tier [reported]; clip preview $0.04/30 s | SynthID watermark; commercial statement not found [reported] | BACKUP (cheap) |
| Stable Audio 2.5 / 3.0 | 2.5 up to 3 min, 3.0 up to 6 min, audio-to-audio, inpainting | 8 credits = $0.08 each [verified] | 2.5 closed weights, API usable commercially (reported); 3.0 small models open under Community License below $1M revenue (reported) | BACKUP (loop-friendly instrumentals) |
| ACE-Step 1.5 / XL | full songs, 48 kHz, lyrics, <4 GB VRAM, fast | free, GPU | MIT [reported; GitHub]; training data claims licensed/royalty-free | OSS fallback |
| MusicGen / AudioGen (Meta) | 30 s clips, older quality | free | code MIT, weights CC-BY-NC 4.0 [verified] | SKIP (non-commercial) |
| YuE | lyrics-to-song, heavy | free | Apache 2.0 (from memory, unverified) | skip |
| Suno | best vocals | consumer plans from ~$10 | NO official API; unofficial wrappers violate ToS [reported] | SKIP |
| Udio | | | downloads disabled, walled garden [reported] | SKIP |

Practical: bettervid needs 60-90 s instrumental underscore. Generate once per mood (ElevenLabs/Lyria), cache, and trim/loop with ffmpeg `afade`. Royalty-free fallback: pre-bundled CC0 loops.

## 5. SFX

| Option | Detail | Price / license | Verdict |
|---|---|---|---|
| ElevenLabs SFX v2 (`eleven_text_to_sound_v2`) | 0.5-30 s, `loop`, 48 kHz [reported] | $0.12/min, metered per generation [verified]; "royalty-free" [verified] | USE for whooshes, hits, ambience |
| Stable Audio 2.5 | SFX capable | $0.08/gen | backup |
| MMAudio (video-to-audio, open) | 1-30 s synced to video | open weights, license not verified here | optional; Hunyuan-Foley/ThinkSound not researched |
| Freesound | CC0 filter, API; CC-BY needs credit, CC-BY-NC banned for commercial [verified] | free | USE CC0 only, store license per file |
| Pixabay | free commercial, no attribution, no standalone resale [reported] | free | OK |
| Zapsplat | free tier requires credit to ZapSplat, MP3 only [reported] | free/premium | avoid (attribution burden) |
| Meta SAM Audio | separation only, SAM License [reported] | free | could isolate stems from found audio; not a generator |

## 6. Mixing recipe (ffmpeg) [reported + ffmpeg docs]
- Normalize narration to about -16 LUFS before mix. Music bed -20 to -24 LUFS under voice, ducked further with sidechain.
- Ducking: `[1:a]asplit=2[sc][vox];[0:a][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[duck];[duck][vox]amix=inputs=2:normalize=0[a]`. Attack 5-20 ms so first syllable is not covered; release about 500 ms.
- Final: two-pass `loudnorm=I=-14:TP=-1:LRA=11` with measured values and `linear=true`. Defaults (-24/-2) are wrong for social. [verified: ffmpeg docs per search]
- Targets: YouTube Shorts about -14 LUFS (only attenuates louder) ; Reels about -14; TikTok has no published spec, sources say -14 or hotter (-10 to -8). Pick -14 and check true peak after AAC encode. [reported]
- Add SFX on a third bus at about -12 to -18 dB under voice. Render audio in one ffmpeg pass outside Remotion, then mux, so the critic hears the final mix.

## 7. Recommended stack and cost per 60 s video
Assumptions: 60 s video, about 150 words, about 950-1,000 chars narration (Arabic about same), 1 music bed (60-90 s), 6 SFX clips (2-3 s each).

| Layer | Primary | Cheap fallback | Open-source fallback |
|---|---|---|---|
| Narration | ElevenLabs v4: ~$0.08 (retakes x1.5 = $0.12) | Gemini 3.8 Flash TTS: ~$0.014 (Lite $0.009); $0.027 after 2027-01-01 | Chatterbox Multilingual (Arabic) or Kokoro/Qwen3-TTS (English): $0 + GPU |
| Timing | ElevenLabs `with-timestamp`: $0 | ElevenLabs Forced Alignment (price unknown) or WhisperX | WhisperX / Qwen3-ForcedAligner (no Arabic) |
| Music | ElevenLabs Music v2.5: $0.15 (about $0.07 promo) | Lyria 3.5 $0.08 or Stable Audio $0.08 | ACE-Step 1.5 (MIT): $0 + GPU |
| SFX | ElevenLabs SFX: about $0.02-0.10 (6 generations; per-generation rate unclear, upper bound = 200 credits each if billed via credits) | CC0 Freesound/Pixabay: $0 | same + MMAudio |
| Mix | ffmpeg: $0 | | |
| Total | about $0.25-0.35 | about $0.10-0.12 | about $0 (plus GPU seconds on Modal) |

Recommendation: ship ElevenLabs end-to-end for quality, with Gemini TTS as automatic fallback and the language router "Arabic -> Gemini (or v4 after a listening test)". Keep Chatterbox + ACE-Step as the "open weights" story, optional. Cache all generated audio so judges' reruns cost nothing.

## 8. Open questions
1. Independent Arabic ranking on AA (page not readable); a 10-minute blind listen of Gemini 3.8 vs Eleven v4 on one Arabic script should decide it.
2. Elevenlabs Forced Alignment price and supported languages (not on API pricing page).
3. Whether ElevenLabs Music v2.5 API exposes stems/loops (docs silent) and which music price ($0.15 vs promo $0.07) applies.
4. Lyria 3.5 commercial-use terms (no official statement found).
5. Hume sunset was found only via search; official changelog URL 404'd.
6. Not evaluated: Resemble hosted, Microsoft Azure/VibeVoice, Dia2, Sesame, F5, Orpheus, Higgs V3, IndexTTS licenses, MMAudio/Hunyuan-Foley licenses, YuE license, OpenAI tokens-per-minute for gpt-4o-mini-tts.
7. Whether an ElevenLabs API key can be bundled for judges (brief says judges need no credentials); likely route calls via a server-side key or pre-rendered demo assets.
