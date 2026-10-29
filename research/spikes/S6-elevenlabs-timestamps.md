# S6: ElevenLabs v4 word timestamps

Date: 2026-10-29. Script: `scripts/spikes/s6-elevenlabs-timestamps.ts`. Raw output: `media/spikes/s6/eleven_v4/` (gitignored).

**Verdict: PASS.** `eleven_v4` works on the normal `POST /v1/text-to-speech/{voice}/with-timestamps` endpoint (not only Text to Dialogue) and returns character timings that match the audio to within 50 ms. No need for v3 or Scribe.

## Inputs
- Model `eleven_v4`, voice George (`JBFqnCBsd6RMkjVDRZzb`, premade), `mp3_44100_128`.
- Text (131 chars): "In 1854, a doctor named John Snow drew a map. Not of streets, but of deaths. And that one map changed how we fight disease forever."

## Outputs
- `audio_base64` plus `alignment` and `normalized_alignment` (per character start and end seconds). For this text the two were identical ("1854" was not expanded).
- 26 words, 10.88 s of audio. Timing grid looks like 40 ms steps at word level; letters inside a word are spread evenly, so in-word timing is interpolated. Word starts are what matter.

## Check against the audio
Independent check: ffmpeg `silencedetect` (-35 dB, 120 ms) on the returned MP3, compared with word edges either side of every pause. Two takes, 11 pause edges each.

| Pause (take 2) | silencedetect | timestamps | diff |
|---|---|---|---|
| "1854," end / "a" start | 1.40 / 1.68 | 1.36 / 1.68 | 40 / 0 ms |
| "map." end / "Not" start | 4.07 / 4.63 | 4.08 / 4.64 | 10 / 10 ms |
| "streets," end / "but" start | 5.55 / 5.83 | 5.52 / 5.84 | 30 / 10 ms |
| "deaths." end / "And" start | 6.64 / 7.16 | 6.64 / 7.12 | 0 / 40 ms |
| "map" end / "changed" start | 8.19 / 8.32 | 8.24 / 8.32 | 50 / 0 ms |
| "forever." end | 10.52 | 10.48 | 40 ms |

Worst case 50 ms, about 1.5 frames at 30 fps. Good enough for word-pop captions and cutting on words.

## Gotcha found
Punctuation characters get their own time slots, so a naive "end of last character" makes word ends 0.1 to 0.3 s late (take 1: "1854," ended at 1.68 vs real 1.41). Fix in `toWords()`: only letters and digits extend a word's end. The pipeline's voice stage must reuse this.

## Cost and timing
- ~3.4 s latency for 11 s of audio.
- Response header `character-cost: 52` for 131 characters, and the account shows 52 used after the first call. So v4 seems to bill about 0.4 credits per character on this plan. If that holds, the Starter plan's 40,000 credits cover roughly 100k characters, not 40k, which may make the Creator upgrade unnecessary. Recheck after a longer script before deciding.
- Total spent: 2 calls, 262 characters (one call was an accidental rerun).
