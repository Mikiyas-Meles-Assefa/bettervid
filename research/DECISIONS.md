# DECISIONS: what we take from REVIEW.md (2026-10-29)

Triage of the phase 3 adversarial review (`REVIEW.md`). Almost all of it is taken. Pushback is limited to lowering the quality bar, plus two places where it cuts things the user specifically asked for.

## Taken as-is

**Numbers**
1. Corrected figures: about $3.10 and 18 to 25 minutes per video, 35 to 40 images instead of 25.
2. **Credit budget.** $150 is only about 48 full videos for the whole hackathon, so track spend per test run.

**How the pipeline runs**

3. **Voice first.** Narration is generated before the director plans shots, so every shot is placed on real word timings.
4. **Craft rules enforced by code, not by asking the AI.** No still frame longer than 3 seconds, a pattern interrupt every 5 to 8 seconds, captions inside the safe area, music ducking, -14 LUFS.
5. **A cheaper, reliable critic.** Main inputs: still frames at each cut, the shot list, the transcript, and automatic checks. Watching the full MP4 is a bonus on top. The critic can only file a fixed set of fixes (swap the image, change a caption, change a duration, drop a sound), with at most one fix round. Use Meta's free token-count check to learn what video actually costs before spending.
6. **Images:**
   - Make the style and character reference image first, then generate the rest in parallel with that reference attached, not chained one after another.
   - Turn off Muse Image's web search and shell by default; use low reasoning for bulk images.
   - Test whether asking for 4 images in one call counts as 1 request toward the rate limit. If it does, generate 2 or 3 versions and let Spark pick the best.
7. **Easy cutouts.** Generated subjects get a flat background so SAM's cutouts come out clean; outlines and shadows are drawn ahead of time. BiRefNet is the backup.
8. **Fixes to the hypothesis:**
   - Spark can't open URLs, so we extract web pages ourselves.
   - Voice Transcribe is only for reading input videos and checking the final audio. It can't record or clone a voice.
   - Check on day 1 that ElevenLabs v4 actually gives word timestamps. If not, use v3 or ElevenLabs' transcription.
   - Remove the "Meta does everything" sentence.

**Demo and judges**

9. **Live preview in the browser as the main demo screen** (Remotion Player). It plays as soon as assets are ready, and judges can change a caption or style and see it update instantly, with no render wait. The review's best idea.
10. **Judge experience:**
    - A gallery of 6 to 8 finished videos with the full trail: fact sheet, script, shot list, critic tickets.
    - One live run at a time, with a dollar cap.
    - Results appear in steps (script, then preview, then MP4).
    - A "replay" mode if Meta is down or the budget runs out.
11. **Reliability:** retries with backoff, every stage's output saved so a failed run resumes instead of restarting, and a load test on day 4.
12. **Critic before/after split screen** as the highlight of the demo video and the X post.

**Meta usage and prizes**

13. **Muse Image draws more text:** title cards, the thumbnail and infographics, since its text quality is rated excellent. Animated text stays in code.
14. **A visible open-weights job:** Glimmer reads the final frames and checks for typos and alt text. Qualifies for the $10k prize.
15. **Video as input.** Paste a clip and SAM tracks the speaker so captions follow them. Strong Meta story; stretch goal for Nov 3.
16. **Video Seal** (Meta's free watermark) plus an "AI-assisted, sources in description" end card.

**Rights**

17. **Safe mode by default:**
    - Only public domain, CC0 and CC BY.
    - A license record for every asset and an automatic credits card.
    - No generated images of real people.
    - Headlines and tweets rebuilt as quote cards.
    - Credits shown on screen, as a feature.

**Pitch, scale and planning**

18. **Positioning:** "original research per video, sources on screen", which answers YouTube's July 2026 rule against template content.
19. **Scale:** cost floor is about $0.60 per video (Spark instead of Wonder, code-based critic checks, cached music library, cheaper voice). Realistic price: about $29 for 12 videos, or $2 to $3 per video.
20. **Day 1 gate:** one complete 30-second video by Oct 30 night. If it isn't done, cut harder.
21. **Arabic** only if there's time on Nov 3.

## Taken with changes

22. **Start with the review's 11 shot types**, as the build order, not a hard limit. Add more if time allows.
23. **Styles:** build its 3 first, plus auto style:
    - **Vox / Johnny Harris documentary collage:** real archival photos and SAM cutouts with a white outline, on paper texture with halftone and grain, receipts, maps with routes, highlighter callouts. The flagship style for history, news and science.
    - **Flat illustrated** (Kurzgesagt-like).
    - **Whiteboard / chalk** for math and teaching. **Anime** and **retro paper** (user asked for them) get tested on day 1 and added as style files if Muse Image does them well.
24. **Generated video:** cut from the main pipeline, but keep one opening shot for one hero video if everything else is done.
25. **Manim and the depth model:** cut for the hackathon. Math uses formula rendering (KaTeX) plus plots; depth becomes a simple 2-layer parallax.
26. **Web image search:** the review cuts it, but the user specifically wants real images from the web. Keep it as an opt-in "editorial" mode, off in the default demo.

## Rejected

27. **Lowering the goal to "not Veritasium".** Drop the claim that viewers can't tell it from a human edit (that was an overreach). The target stays the user's bar; the day 1 tests show what's actually reachable.

## Next
Fold these into `HYPOTHESIS.md` v2 and `docs/PLAN.md` v2, then run the phase 4 tests (needs the ElevenLabs key and a Meta key choice).
