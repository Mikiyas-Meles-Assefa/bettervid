# Sound work report

Branch: `sound`. Worktree: `.worktrees/sound`. No push or merge.

## Built

The mix stage now collects moments from the compiled scenes already stored on timeline clips. It includes every emit, timed changes and landings on computed truth-kit parts, animated entrances and reveals, direction boundaries and reveals, and recorded hold starts and ends. One Spark JSON call chooses sparse effects and music cues from these moments with the intent, style and event feel. No event-to-sound table or mode-to-music lookup drives placement.

Effects stay at least 1.5 seconds apart and cannot overlap their kit durations. Their gain is capped at -18 dB after peak normalization and they duck under voice. Music cues select beds, levels and near-silence with short fades and speech ducking. New reusable effects persist in audio/sound-additions.json with a 20-item ceiling and 0.5 to 2 second durations. Source MP3s are cached. Two-pass loudnorm and output measurement remain; future masters use a -1.2 dBTP internal ceiling to leave intersample headroom. A successful mix invalidates the render cache. Verification rejects non-finite measurements, loudness more than 0.5 LUFS from target, or true peak above -1 dBTP.

## Real checks

Only mix was run on isolated copies of merge-w2 and stats-w2 using `--only mix --force mix`. Each used one successful Spark call. Initial sandbox DNS failures incurred no recorded spend. Original project folders were not edited.

### merge-w2

Measured output: -14.20 LUFS, -1.02 dBTP. Meta: $0.0169002. ElevenLabs: 2400 credits.

Effects:

- 2.57s: number-tick, -24 dB. first box landing anchors the messy 8 without voicing every tick
- 6.37s: number-tick, -28 dB. later landing keeps count feel while staying sparse
- 39.13s: whoosh, -22 dB. single split whoosh marks divide motion, others left silent
- 107.57s: finger-tap, -26 dB. first two fingers drop for 5 vs 1, teaches the move
- 167.87s: impact, -28 dB. low copy-the-rest thud for final 7 in left quad
- 253.40s: sorted-chime, -22 dB. payoff chime exactly on 1-8 Sorted reveal

Music:

- 0.00s: curious, -10 dB relative to the normalized bed. playful inquisitive bed for messy hook
- 96.70s: focus, -12 dB relative to the normalized bed. clear calm bed for slow first merge teaching
- 207.90s: tension, -12 dB relative to the normalized bed. low suspense bed for final 4-vs-4 interleave
- 218.63s: tension, -80 dB relative to the normalized bed. silence for 1-or-2 predict hold so tick and voice lead
- 254.43s: documentary, -10 dB relative to the normalized bed. warm resolve for why programmers love it and cost

### stats-w2

Measured output: -14.12 LUFS, -1.00 dBTP. Meta: $0.0017133. ElevenLabs: 200 credits.

Effects:

- 51.63s: number-tick, -24 dB. Mean 3 lands after slow add to 15, one quiet tick marks the early win without ticking every add.
- 83.57s: pop, -28 dB. -2 x -2 = +4 pops once, marks the sign-flip aha in the squaring step.
- 145.07s: sorted-chime, -22 dB. Big sqrt4 = 2 reveal, single warm chime for triumph after silent guess hold.

Music:

- 0.00s: focus, -14 dB relative to the normalized bed. Start calm focus bed under Friday promise title, low to stay under voice.
- 138.53s: focus, -80 dB relative to the normalized bed. Drop to silence for h6 predict hold What is sqrt4 so final root lands in silence.
- 145.07s: focus, -10 dB relative to the normalized bed. Restore gentle bed for standard deviation is 2 triumph and units note.
- 176.13s: focus, -16 dB relative to the normalized bed. Soften to calm bed for full table checklist recap to calm ready close.

Total Meta: $0.0186135, below $0.50. Total ElevenLabs: 2,600 credits, six new source items: focus and tension beds (900 credits each), number-tick, finger-tap, sorted-chime and pop (200 each). The first three effects extend the named kit; pop already had a definition but needed its source generated.

## Validation and limits

- TypeScript passed. Pipeline tests: 133 passed. Engine tests: 544 passed, one skipped.
- Tests exercise compiled moments, a fake sound reasoner, spacing including full effect duration, music silence and changes, and invalid references.
- Computed operations are exposed as actual property changes and landing frames with target ids and values. The compiled engine currently emits only one `steps` event per batch, not a semantic label per compare, swap or take. This implementation supplies the actual tracks, rather than inventing semantic step labels or changing the truth engine outside the permitted scope. A per-step semantic event contract would improve the reasoner input and reduce its size.
- The collector includes opacity and draw reveals broadly, so the reasoner sees decorative candidates as well as directed subjects. It chooses restraint, but this has not been judged against human studio work.
- Music cues restart a selected bed; phrase-aware continuity and musical downbeat alignment are not implemented.
- No audio listening tool is available in this session. Listening is incomplete; the measured outputs must not be described as auditioned.
- Local evidence is under the two worktree project folders: sound-plan.json, sound-measurement.json, mix.wav and run logs. These are ignored project outputs, not committed.

The first merge output measured -0.97 dBTP. A deterministic 0.05 dB trim brought it to -1.02 dBTP, with final loudness -14.20 LUFS. No additional model call was used.

Render check: `stats-w2 --only render` initially hit the sandbox local-port restriction. It was retried with local-server permission and the Chrome path, concurrency 3 and Python setting specified in the brief. The mix stage now invalidates the render cache so audio changes are muxed again.

The stats re-render completed successfully: 6,274 frames in 498 seconds of rendering (501 seconds for the stage), concurrency 3. Output: projects/stats-w2/video.mp4. The encoded MP4 measures -14.13 LUFS and -0.96 dBTP. Listening remains incomplete because this session has no audio-listening capability.

AAC encoding raised the initial MP4 peak to -0.96 dBTP. A deterministic 0.1 dB audio trim with video copied brought the delivered MP4 to -14.24 LUFS / -1.06 dBTP. This cost no model or ElevenLabs credits. The new -1.2 dBTP internal master target provides headroom for subsequent renders; encoded-output checking in the render stage remains outside this change.
