# S15: voice holds on eleven_v4 (speed, stitching, audio tags)

Date: 2026-11-02. Scripts: `scripts/spikes/s15-voice-holds.ts`, `scripts/spikes/s15-alignment.ts`. Raw takes: `media/spikes/s15/` (gitignored). Voice George (`JBFqnCBsd6RMkjVDRZzb`), `eleven_v4`, `mp3_44100_128`, the `with-timestamps` endpoint.

**Verdict:** split the script at holds and stitch with `previous_text` and `next_text`; do not use `speed`; audio tags work but are not used yet.

## a) `voice_settings.speed`: ignored
The same 89-character sentence at default, 0.8 and 1.2: 6.32 s, 6.24 s, 6.32 s, with the inner pauses in the same places to within 0.1 s. The request is accepted (200) and the setting does nothing on v4. So slowness has to come from silence and fewer words, as the design says; the pipeline sends no speed.

## b) Request stitching: accepted, free, and safe for timing
- `previous_text`, `next_text` and `previous_request_ids` are all accepted on v4 (200). The context text is not billed: `character-cost` was 30 for the stitched second sentence and 30 for the same sentence alone.
- Prosody: the stitched second sentence opens a little lower (median pitch over its first 1.5 s 163 Hz against 168 Hz alone) and at the same level, which is what a continuation sounds like; the first sentence read with `next_text` ends at the same pitch as alone. A small effect, in the right direction.
- Alignment accuracy is not hurt by context. The same 389-character passage, word starts against the pauses in its own audio (silencedetect -35 dB, 120 ms): alone 188 ms median error twice, with `previous_text` 81 ms.
- The pipeline uses the text fields only, not `previous_request_ids`. Text context lets segments run three at a time and be cached by their exact request, so a run that stops part way never pays for a segment twice; request ids would force them in order and tie a cached segment to an id that may expire.

## c) Audio tags at a segment start: work, but stay out for now
- `[quietly]` is strong: the take is 6 dB quieter (-28.1 against -22.4 dB) with the pitch down from 154 to 113 Hz. `[building tension, measured pace]` barely changed the read (6.48 s against 6.32 s, same level).
- In the alignment a tag is ordinary characters squeezed into the first 0.03 to 0.16 s, before the first word (`[@0 q@0.053 ... ]@0.107`), so it is easy to strip, but a plain `toWords` would make it timed words (four of them for a tag with spaces). Tags are billed as text.
- Not used in this wave: the effect ranges from a 6 dB level drop to nothing depending on the tag, and a mood that changes level mid-narration would sound like an edit at every hold. If `feel` tags come later, strip bracketed spans from the alignment before `toWords` and match loudness per segment.

## Joining
- The narrator's own pauses sit near -78 dB RMS (peaks -65 dB), effectively digital silence, so the held silence is digital zero; a room-tone bed would be inaudible under that floor, and the mix lays music under the hold anyway.
- At the end of a request ElevenLabs stretches the last word to the end of the audio: "opposite." was timed to end 0.35 s after its speech did. The stage measures each segment's speech edges (10 ms windows over -50 dB) and keeps every word time inside them, or captions would hang into the hold.
- The joined MP3 must be written to a file, not a pipe: from a pipe ffmpeg cannot write the header that carries the encoder delay, and the audio lands about 25 ms after the word times.

## Real test (`projects/merge-w2voice`, a copy of merge-w1 with three hand-written holds)
| Hold | After word | Asked | Recorded start | silencedetect (-50 dB, 0.7 s) | Word end / next word start |
|---|---|---|---|---|---|
| h1 look | 10 "10." | 2.0 s | 6.08 | 6.096 to 8.076, 1.980 s | 6.00 / 8.08 |
| h2 predict | 30 "opposite." | 3.0 s | 15.24 | 15.256 to 18.242, 2.986 s | 15.24 / 18.24 |
| h3 settle, mid-sentence | 84 "half," | 1.2 s | 39.75 | 39.763 to 40.955, 1.191 s | 39.75 / 40.95 |

Every silence is within 20 ms of what was asked and starts within 16 ms of the recorded start. Four segments, 441 words, no count mismatch. Captions break at each hold and leave the screen 0.4 s after the last word; the music bed comes up to its full level within 0.2 s of a hold starting (the sidechain duck releases), so the hold is not ducked as if speech were there.

Inside segments, word times against the audio are as good as ElevenLabs gives: this take's long last segment has a 90 ms median start error, and the whole-script merge-w1 take had 39 ms. The 389-character passage above (188 ms alone) shows the spread is per take, not caused by splitting. A pass that snaps word edges to the pauses in the audio would help every narration and is a separate fix.

## Spend
ElevenLabs: 709 characters for part one, 1,167 for the alignment check, 2,249 for the real test, 4,125 characters in all (1,649 credits). No Meta calls.
