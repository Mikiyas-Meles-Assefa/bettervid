# craft-market: craft grammar + market scan
Retrieved 2026-10-29. Sources in research/sources/craft-market/. Tags: [verified] official page read, [reported] third party, [unverified] inferred. Most craft evidence is secondary (creator interviews paraphrased by blogs); treat numeric cut rates as heuristics, not laws.

## TL;DR
1. Market is crowded with prompt-to-video tools (invideo, HeyGen Video Agent, Revid, Pictory, Vizard, Fotor, Pippit, Google Vids, NotebookLM Cinematic). All sell on volume and credits; the shared complaint is generic stock B-roll, mismatched visuals, credit burn, and a "slop" look. [reported]
2. YouTube's July 16 2026 policy demonetizes "generic, repetitive, or template-based" content and AI personas on health/finance. Template output is now a liability, so "craft with sources and receipts" is the defensible position. [reported, TechCrunch]
3. Positioning: not "AI makes video" but "a director that researches, cites, and edits like Johnny Harris/Vox/Kurzgesagt". Wow comes from visible craft: real receipts, a through-line, intentional sound, and a critic loop that fixes shots.
4. Hook: open with a concrete, visual question or contradiction in under 2 s; first 6 s decide commitment. Make the title/first frame promise and pay it off exactly (MrBeast, Galloway).
5. Structure every beat with but/therefore; withhold, tease, resolve; each answer opens the next question (Harris "narrative debt").
6. Cadence: new visual every 1 to 3 s; hook cuts under 1 s; a pattern interrupt every 5 to 8 s; music duck 6 to 10 dB; -14 LUFS.
7. Mixed sources (photo, archival, receipt, meme, generated art) need ONE style treatment (Vox: paper, halftone, imperfect).
8. Shorts: end on a loop back to the hook or an abrupt stop; never a sign-off.
9. Pricing hypothesis: free watermarked 1 video; Creator ~$19/mo (20 shorts); Pro ~$49/mo; per-video pay-as-you-go $2 to $5; edtech/publisher API custom. Competitors cluster at $15 to $60 for entry paid tiers.
10. Do not build around raw video-gen volume: NotebookLM/Veo/Sora-style realism no longer impresses (Sora app shut Apr 26 2026; Grok "Odyssey" ripped). Craft and cited facts do.

---
# PART A: CRAFT

## A1. Evidence base (what each creator does)
| Source | Pattern | Evidence tag |
|---|---|---|
| MrBeast guide | First minute is most important; show, do not tell; re-engagement spectacle ~min 3 and ~min 6; quick scene changes min 3 to 6; "No dull moments"; abrupt ending; do not signal the end; title/thumbnail promise delivered exactly; brand deals are content | [reported] (leak, unverified authenticity) |
| Paddy Galloway | +10% retention at 30 s can mean 100k vs 1M; confirm the click with a hook; first 15 s surprise then "let it breathe"; retention falls as audience widens (56% to 37%); Shorts best hold 70 to 90% viewed-vs-swiped | [reported] |
| Veritasium | Opens with a simple question whose obvious answer is wrong; friction/misconception teaches (PhD thesis) | [reported] Sci Am |
| Kurzgesagt | Script is the bottleneck (weeks to years); ~200 illustrated panels; visual metaphors planned at storyboard; narration recorded after visuals; expert fact-check; "fine line between over-simplifying and overly complicated" | [reported] |
| Johnny Harris | Hook montage under 1 s per shot, explanation 1 to 2 s per shot; question then report loop; maps appear as narrator names places; desaturated grade; stepped 12 fps annotation; SFX like paper and typing | [reported] vendor blog |
| Vox | Imperfect handmade look (construction paper), "not perfect, or it looks like an ad"; archival textures; slow push-ins with 2.5D parallax; recurring visual motif; end answers question then widens | [reported] |
| 3Blue1Brown | Motivate with a concrete example before the definition; visuals first then name it; everything in code (Manim) | [reported] |
| Wendover | "A system you do not think about, and why you should"; thesis as last line; find the one core bit that engages | [reported] |
| Lemmino | Core mystery in first 60 s; chapters per theory; claims grounded, speculation flagged; faceless silhouettes with one accent color; original ambient score | [reported] |
| Zack D. Films / history-science shorts | Strange opening question, visual reveal, fast explanation, final twist; 3D CGI; near-daily; tone via unsettling sound | [reported] |

## A2. Rules by craft area (rule-like, for writer/director/editor)
### Hooks
- H1. First sentence is a concrete claim, contradiction or question about a specific thing. No greetings, no "in this video", no context first.
- H2. First frame must be a readable, specific image (a face, object, headline, number) with the hook text overlay, not black, not a logo. Shorts swipe decision happens in about 1 to 1.5 s. [reported]
- H3. 0 to 3 s hook and pattern interrupt, 3 to 12 s value, 12 s to end payoff plus loop setup (Shorts three-zone). [reported]
- H4. Hook must create a knowledge gap that only the rest of the video closes (Harris). Never answer it in the first 15 s.
- H5. The title/hook promise must be paid off exactly (MrBeast). No bait the script cannot deliver.
- H6. Long-form: best, most surprising material in the first minute, "start showing, stop telling what they will watch".

### Structure, open loops, but/therefore
- S1. Between every two beats the connector must be "but" or "therefore", never "and then" (Parker/Stone). Critic: flag any "and then" chain.
- S2. Open a loop in the hook, open a second loop before closing the first. Close loops in reverse importance, keep the biggest for the end. Zeigarnik effect. [reported]
- S3. Question to report cycle: a question on screen, an answer that raises a sharper question (Harris).
- S4. Misconception first (Veritasium): state the intuitive answer, then break it. Friction beats clarity.
- S5. Motivate before formalism (3B1B): show a concrete case before naming the concept.
- S6. One idea per beat. One visual per idea. Length of beat equals length of the sentence it illustrates.
- S7. Ending: answer the opening question, then widen to a bigger idea (Vox/Wendover thesis line). In Shorts, either loop the last line into the first or stop abruptly. Do not signal the end (MrBeast).
- S8. Re-engagement spike on a schedule: long-form every ~3 min, 90 s Shorts at ~30 s and ~60 s (scaled heuristic) [unverified scaling].

### Pacing (cut frequency by format) [heuristic ranges from reported sources]
| Format | Hook | Body | Notes |
|---|---|---|---|
| Shorts 60 to 90 s | new visual every 0.7 to 1.5 s | every 2 to 3 s, text change each 1 s | beat every 2 to 3 s (Shorts guide) |
| Harris style doc | under 1 s per shot | 1 to 2 s per shot | cuts densely, still breathes on maps |
| Kurzgesagt/Veritasium | 2 to 4 s | continuous motion, scene change on idea change | animation never static |
| Horror/story shorts | 1 to 2 s | 2 to 4 s, hold silent beats | tension from restraint |
| Math (3B1B) | slow, 4 to 10 s | holds so viewer can think; transformations animate | pause before the reveal |
- P1. Never hold an identical frame over 3 s without motion (push-in, parallax, text change).
- P2. Let a key reveal breathe 0.5 to 1.5 s of near silence before it (Galloway "let it breathe").
- P3. Pattern interrupt (zoom punch, shot type change, SFX, color flash, meme) every 5 to 8 s; vary type, do not repeat the same one three times in a row.

### B-roll, visuals, receipts
- V1. B-roll density: every sentence gets a distinct visual; never talking-voice over a static still.
- V2. Visual hierarchy per beat: receipt/real asset first (headline, tweet, paper, archival photo, map), then generated art, then abstract motion. Real beats generated. B-roll as "narrative punctuation", not filler (Harris).
- V3. Receipts: show the source on screen for 1.5 to 3 s, highlight the quoted line, with outlet name. Drives trust and differentiates from slop.
- V4. Visual metaphor: one metaphor per concept, reused consistently as a recurring character (Kurzgesagt, Vox motif). Plan at storyboard.
- V5. Maps: reveal place names as narrator says them; draw routes stepped (12 fps feel), paper grain.
- V6. One style treatment on mixed sources: shared grade, grain, paper/halftone, drop shadow (Vox). Imperfect on purpose.
- V7. Humor and memes: one meme/reaction per 20 to 30 s max, only when it makes the point sharper, 0.8 to 1.5 s long, never after sad or sensitive content.
- V8. Text overlays only on key phrases, never a transcript.

### Sound
- A1. Mix order: voice first, effects second, music last. Music 20 to 25 dB under voice for explainers, 12 to 15 dB for energetic; duck 6 to 10 dB (attack 10 to 30 ms, release 300 to 600 ms); music can rise to -12 to -18 dB in gaps. Final -14 LUFS, true peak under -1 dBTP. HPF voice 80 to 100 Hz. [reported]
- A2. SFX at -18 to -12 dB; whoosh starts 10 to 20 ms before the visual change, 400 to 500 ms. [reported]
- A3. Use whoosh on transitions between scene types only, risers only into reveals, impact only on the key stat. Audit: if more than one SFX per ~2 s, remove. Overused = noise.
- A4. Silence is a tool: drop music 0.3 to 1 s before the biggest reveal (inferred from "let it breathe" [unverified]).
- A5. Music choice: documentary/history = low ambient, minor, slow pulse; science = light rhythmic, curious; horror = drones, sparse; shorts = trend-neutral loopable beat. Change or evolve music roughly every 20 s in Vox-style pieces [reported].
- A6. J/L cuts: audio of the next shot starts 8 to 12 frames before the picture (J) or the previous audio trails into the next shot (L) to avoid slideshow feel. [unverified numbers, standard editing practice]
- A7. Narrator delivery: vary sentence length (short, medium, long); stress words marked in script; no flat read.

### Captions (Shorts)
- C1. Word-level karaoke captions, 1 to 3 words on screen, ALL CAPS heavy sans (Montserrat Black/Anton), ~100 px at 1080 wide, white with 8 to 10 px black stroke, one yellow (#FFD93D) keyword per line, Y about 1150 to 1300 of 1920, inside central ~900 px, never in bottom 25% or right 15% UI zones. [reported]
- C2. Captions never cover the subject of the shot or the receipt being shown.
- C3. Highlight emphasis words only (numbers, names, the surprising word), not every other word.

### Thumbnail / first frame
- T1. First frame doubles as the thumbnail: one subject, one emotion or contrast, 3 to 5 words, high contrast, readable at 100 px wide. Delivers the same promise as the hook (MrBeast "must match").

## A3. Genre grammar
- History/documentary: cold open on a vivid moment, then "how did we get here" (Harris/Lemmino). Archival photo, map with place reveals, desaturated grade, paper SFX, dates as huge type, grounded claims, flag speculation. End: thesis line.
- Science: misconception then demonstration (Veritasium). Real experiment/clip or animation of mechanism with consistent metaphors (Kurzgesagt). Numbers shown with scale comparisons. Credit the paper on screen.
- Math: concrete case, then pattern, then definition (3B1B). Animate transformations; keep color to meaning (same color same object); pause before insight. Render in Manim.
- Storytelling/horror series: cold open on the worst moment or an odd detail; but/therefore escalation; restraint (silhouettes, shadow, sound carry the fear); cliffhanger ending that pulls the next episode; recurring visual identity and series card. YouTube flags "off-putting content designed to be distressing to chase views", so stories need a point, not gore. [reported]
- News explainer: start with the thing that happened in one concrete image + date, then "why you should care", receipts (headline, filing, tweet), neutral tone, steelman both sides, sources on screen. AI persona on health/finance/legal is a monetization risk. [reported]
- Short-form explainers (Zack D. style): odd question, visual reveal, fast explanation, twist, loop.

## A4. Checklists
### Writer
[ ] First line is a specific claim/question, under 12 words
[ ] No "and then" connectors; every beat is but/therefore
[ ] Two loops open by 15 s; biggest saved for last
[ ] Each claim has a source in the fact sheet; speculation flagged
[ ] One idea per sentence block, with a named visual
[ ] Sentence length varied; stress words marked
[ ] Ending answers the hook and widens, or loops
### Director
[ ] Every beat has an asset type with priority real > generated > abstract
[ ] Receipt beats scheduled at each key claim
[ ] Pattern interrupt plan every 5 to 8 s, varied
[ ] Recurring visual metaphor defined
[ ] Hook shots under 1 s; frame 0 is the thumbnail
### Editor
[ ] No static frame over 3 s; all stills have motion
[ ] Single grade/grain/shadow treatment across sources
[ ] Captions in safe zone, 1 to 3 words, single highlight
[ ] Music ducked, -14 LUFS, SFX not stacked, silence before the reveal
[ ] J/L cuts at scene changes
[ ] Ends on loop or abrupt cut

## A5. Scoring rubric for critic (0 to 5 each, weights in brackets; fail gates first)
Fail gates (any = ticket "must fix"): audio clipping or voice masked by music; caption in unsafe zone; unsupported factual claim; frame 0 blank; static frame over 4 s; sign-off ending ("thanks for watching").
| Dimension | What a 5 looks like | Weight |
|---|---|---|
| Hook (0 to 3 s) | specific claim/question + readable first frame, gap opened | 20 |
| Narrative drive | but/therefore chain, loops opened and paid, no flat stretch | 15 |
| Visual evidence | receipts and real assets at key claims, sources named | 15 |
| Pacing | cuts match format table, interrupts varied, breathing at reveals | 10 |
| Style unity | one treatment, consistent metaphor, no mixed-quality jumps | 10 |
| Sound | mix levels, whoosh sync, silence used, music fits genre | 10 |
| Captions/typography | safe zone, emphasis restraint, readable | 5 |
| Accuracy and honesty | claims match sources, speculation flagged | 10 |
| Ending/loop | loop or abrupt, answers hook | 5 |
Critic output: per-shot ticket {timestamp, dimension, problem, fix}; overall score; list of top 3 fixes. Pass at 80+ with no gates failed. [unverified thresholds, to be calibrated]

---
# PART B: MARKET

## B1. Competitors (pricing as of Oct 2026; official pages fetched unless noted)
| Tool | What | Entry to mid price | Complaints / quality | Verdict |
|---|---|---|---|---|
| invideo AI | Prompt to video agent, bundles Seedance/Veo/Nano Banana | Starter $20 (annual $10), Plus $60 ($30), Max $150 ($75); credits do not roll over [verified] | Credits burn fast, refunds hard, mismatched visuals; "low quality unusable videos" (Software Advice, Trustpilot/G2) [reported] | Main incumbent; compete on craft and cited accuracy |
| HeyGen Video Agent | Prompt/script/PDF to explainer with avatars | Free 3 videos/mo; Creator $29 ($24 annual); Pro $49; Business $149 [verified] | Its own guide: "visuals can look a bit off from scene to scene"; "isn't magic" [verified] | Closest "explainer agent"; avatar-led |
| Synthesia | Avatar training/corporate video | Free 10 min; Starter $19 ($14 annual); Pro $89 ($59 annual); 100 credits/min [verified] | Avatar-centric, corporate look | Not a direct competitor |
| Pictory | Script/URL to stock-footage video | $29/$59/$199 monthly ($25/$35/$119 annual); has "AI video agent"; SCORM on Enterprise [verified] | Stock B-roll slideshow feel [reported] | Edtech angle (SCORM, quizzes) |
| Opus Clip | Long to short clipping | Free, $15, $29, custom [verified] | Processing failures, billing and cancellation, wrong auto-B-roll (coffee cup for podcast gear) [reported Trustpilot] | Different job |
| Revid.ai | Short-form viral remix, auto-mode, API/MCP | Growth $39 (2,000 credits), Ultra $199; credits do not roll over [verified] | "Viral" template focus, which collides with YouTube template policy | Showcases motion-graphics explainers (Shazam 602K views) [reported] |
| Captions/Mirage | Talking-head editing, AI actors | Pro $9.99, Max $24.99, Scale $69.99 [reported] | n/a | Skip |
| Descript | Text-based editor | Free; $16/$24/$50 annual [verified] | Editor, not creator | Skip |
| CapCut/Pippit | Editor plus Agent Mode | CapCut Pro raised to $19.99 [reported] | Template look | Skip |
| Higgsfield | Cinema-model hub | Starter $19, Plus $59, Ultra $129 [reported] | Credit complexity | Model supplier-like |
| Hedra | Talking characters | Basic $20 to Ultra $100 (changed Sep 23 2026); API $0.05/s 720p [reported] | Per-second burn | Skip |
| NotebookLM / Gemini Notebook | Doc to Cinematic Video Overview (Gemini 3, Nano Banana Pro, Veo 3), Mar 2026 | Needs AI Pro $19.99 or Ultra; English; 2 to 5 min; renamed Jul 2026 [reported] | Cannot edit; up to 30+ min; quotas | Biggest "document to video" rival; no cited receipts or editability is our gap |
| Google Vids | Workspace editor with free Veo 3.1 clips | 10 free gens/mo claim, AI Pro $19.99 [reported, conflicting] | 8 s 720p clips | Not a story director |
| 2026 agents | Vizard Agent, Fotor Video Agent, Hera (PH 416 upvotes), Pippit, Pexo | Mostly $10 to $40 [reported] | Crowded | Differentiate on research plus critic |
| Faceless.video, AutoShorts | Not researched in depth | n/a | n/a | [unverified] |

## B2. Who pays and how much
| Segment | Pays today | Need | Evidence |
|---|---|---|---|
| Faceless channel operators | $20 to $200/mo (invideo, Revid, Pictory) | Volume plus policy safety | Hit by July 2026 policy; need original input [reported] |
| Educators and edtech | Pictory/Synthesia $19 to $199; enterprise custom | Accurate, citable, SCORM/quiz | Pictory Enterprise has SCORM |
| Creators (shorts) | $15 to $60 | Hooks, captions, B-roll | Opus $15 to $29, Captions $10 to $25 |
| Marketers | $29 to $149 | Product explainers | HeyGen Business $149 |
| Publishers/news | custom | Explainers with sources | [unverified] |
Market: AI video generator ~$0.85B to $1.2B in 2026, ~18 to 20% CAGR, ~$3.4B to $3.8B by 2034; broad definitions incl. avatars/editing ~$3.7B [reported, differing definitions]. Creator economy ~$310B in 2026 (Grand View), Goldman $480B by 2027 [reported]. 48.7% of US creators earn under $10k/yr, so the price-sensitive majority caps ARPU [reported]. Faceless share-of-new-channels 38% is a vendor claim [unverified].

## B3. Wow vs slop
Slop signals [reported]: uncanny faces, inconsistent style between scenes, stock footage mismatched to words, template voice, no sources, gore for views, credit-burning retries, AI replacing visible human craft. Ipsos/Syracuse (May 2026): only 13% could tell an ad was AI, yet AI ads lost, so "feels cheap" matters, not detection. Realism alone no longer impresses (Grok Odyssey). Sora app shut down Apr 26 2026.
Wow signals (inferred from above, partly [unverified]): visible directing intelligence (shot list, reasons), receipts and sources on screen, one consistent handmade style, audio craft, a critic loop shown fixing real flaws (before/after), a clean 60 to 90 s result that looks like Vox/Kurzgesagt. Viral X evidence is thin: only Revid's showcased Shazam motion-graphics explainer (602K views) and Squad.so launch (1.27M) found, both vendor-reported; likely drivers are a concrete one-prompt story ("prompt in, finished video out"), a real example topic, and short motion-graphics clips. Demo advice: post the video natively, show prompt to result split, and a before/after of the critic's fixes.

## Final: 10 craft rules that matter most
1. Open with a specific claim or contradiction and a readable first frame; never context first.
2. Join every beat with "but" or "therefore"; never "and then".
3. Open a loop in the hook and another before closing the first; pay off the biggest last.
4. A new visual every 1 to 3 s (under 1 s in hook montage); no static frame over 3 s.
5. Real receipts (headline, paper, tweet, archival) at every key claim, source named on screen.
6. One unified style treatment (grade, grain, paper/halftone, shadow) across mixed assets, imperfect by design.
7. Mix: voice first, music 20 to 25 dB under, duck on speech, -14 LUFS; whoosh 10 to 20 ms ahead of cuts; sparing SFX.
8. Use silence or a held beat before the biggest reveal.
9. Captions: 1 to 3 words, one highlighted keyword, safe zone, never cover the evidence.
10. End by looping to the hook or cutting abruptly; the ending answers the opening question.

## Positioning statement
bettervid is the director in a box that researches, cites and cuts like a documentary editor: one prompt, PDF or URL becomes a sourced, narrated, edited 9:16 explainer with receipts on screen, and a critic agent that watches the render and fixes it before you see it. Not template slop; every shot has a reason, and every claim has a source.

## Pricing hypothesis [unverified; to test]
- Free: 1 watermarked 60 s video, no card.
- Creator $19/mo: 20 shorts, captions, receipts, critic pass (below invideo $20/Plus $60, HeyGen $29, near Opus $15 to $29).
- Pro $49/mo: 60 shorts, landscape, custom style kit, series mode (matches HeyGen Pro $49).
- Pay-per-video: $2 to $5 for non-subscribers (avoids credit-burn complaints; no expiring credits, retries on critic failures are free).
- Edtech/publisher: API plus SCORM-style export, custom.
Cost guard: Veo ~$0.20 to $0.35/s [reported] makes generated video expensive, so favor real assets, stills with parallax, and code-rendered motion graphics.

## Open questions
- Faceless.video, AutoShorts, Kling/Veo apps not researched; Higgsfield/Google Vids official pages unreadable.
- Primary sources for MrBeast guide are summaries; authenticity unverified.
- Numeric cut rates and rubric weights are heuristics; need calibration against reference videos.
- No hard data on what goes viral on X for AI video demos; check @tibo_maker and hackathon winners directly.
- Hedra, Captions pricing unverified from official pages.
