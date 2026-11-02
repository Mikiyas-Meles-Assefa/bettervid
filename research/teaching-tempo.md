# Direction: how a video holds attention and does its job, and how to give the pipeline a sense of time

Date: 2026-11-02. Research and design only; no code was changed. Grounded in `docs/ENGINE-CONTRACT.md`, `docs/ENGINE-PLAN.md`, `pipeline/run.ts`, `pipeline/stages/{writer,voice,scene}.ts`, `prompts/{writer,scene,engine-language}.md`, spikes S6 and S13, and the sources listed at the end. This is the third revision: the first answered "why do our lessons rush", the second widened to videos that are not lessons, and this one folds both into a single model, because real requests are mixed: a technical explainer that is also a story, a history that teaches a method, a lesson with suspense in it.

## What this whole thing is called, in one paragraph

The craft of deciding what the viewer sees and hears at every second, so that they keep watching and the video does what it is for, is called **visual storytelling** by practitioners and **visual narrative** or **audiovisual narration** in film studies. Its grammar is **film editing and montage** (Kuleshov, Eisenstein, Murch); its structure comes from **screenwriting** (beats, setups and payoffs, stakes); its science is spread across **cognitive film theory** (Bordwell, Tim Smith's attentional theory of continuity, Zacks's event segmentation), **media psychology** (Annie Lang's limited capacity model, the orienting response), **narrative psychology** (transportation, Green and Brock), **curiosity research** (Loewenstein's information gap), and, whenever the video has to leave something in the viewer's head, **multimedia learning** and **cognitive load theory** (Mayer, Sweller: segmenting, pre-training, signaling, worked examples, the transient information effect). YouTube creators call the applied version **retention**: hooks, open loops, payoffs. The one idea under all of it: a viewer has a small working memory and an attention system pulled by change, faces, motion and unanswered questions; a video is a schedule of what you give that system and what you withhold from it. Teaching, showing how a machine works, scaring, moving, amusing and persuading are not different crafts; they are the same schedule with different settings, and most videos change the settings several times from start to end. Inside bettervid the layer that writes this schedule should be called **direction**. Tempo (giving the viewer time) is one of its tools, used whenever the video needs it, which is often, and not a mode.

## The user's words, verbatim

First question (lightly cleaned by the lead): "Not everything is narration. The animation can't happen without real-time thinking. Human video makers think about how their target viewer moves. When showing quicksort they might slow down the first swap, pause, say 'go on', do the next slowly, and after some rounds establish the pattern and show how everything else would go, fast. Ours does everything fast, assuming the narration makes me understand everything at once. That's why people love The Organic Chemistry Tutor, 3Blue1Brown, Veritasium. Something said once is not understandable for humans; AIs read everything at once. Where does this fall? It has to have its own discipline name, right?"

Follow-up: "no no am saying ask the same sub agent to expand it to broader sectionns like what if its not learning video and stuff like that the way visual narration works and so on visual story telling could be sth could be veristasium like could be sth like idk depends ..... could be entertaining videos could be anything that preserves attention and does what it wants to do
If. it wants to make learn someone something does that want to scare someone does that very wanna tell history entertainingly but preserves attnedion and not ocg overload it withhout reducing what it want to teach and stuff id but so broad adn broad ...... can u include the exact prompt i wrote fdor it"

Clarification: "liek contuinue the chat saying the previous 2 resposnes twgether like didnt mean the only thing to be that ... some vidoes are teaching some are technical some are this that"

## Why ours rushes, and what is missing

The pipeline today: plan, research, writer, voice, then the scene stage fits visuals to the recorded words. Timing flows one way, words to frames. Nothing in the loop experiences the video in time. The writer writes prose; the scene author sees the whole narration and all word numbers at once (exactly the "AI reads everything at once" the user noticed). The engine can do any timing (states at `@N+frames`, `do steps ... from= to= each= until=`, behaviors, camera drift, cuts, programs with `T0` and `T1`), but it is only ever asked to keep up with the voice. So a quicksort demonstration gets however many words the writer happened to spend on it, and the swaps play at whatever rate spreads them under those words. A history video cannot hold on a face before the turn, because no one decided there was a turn. A scare cannot withhold the threat, because the director was never told what to withhold.

The one place a model walks the video in order is the sequence reviewer from S13, and that runs after the render. What is missing is a stage before the voice is recorded that walks the video as the viewer and writes down, moment by moment, what the viewer knows, what they are waiting for, where their eye is, how they should feel, and what the picture and the voice each have to do about it.

## The viewer's machinery: what is true for every video

Whatever the video is for, the same system is watching it.

**One small working memory, and it empties as it goes.** Cognitive load theory's transient information effect: speech and motion vanish as they pass, so if more arrives than the viewer can hold, the rest is lost; text and still pictures can be looked at again, video cannot. Annie Lang's limited capacity model is the media psychology version: a fixed pool of processing resources, and every cut, motion, sudden sound or new face takes some of it automatically through the orienting response. Up to a point more cuts help memory; past that point memory drops. The same fact makes a lesson fail when it is too dense and a thriller fail when it is cut too fast. "Do not overload" is a constant, not a teaching rule.

**Attention is pulled by change, faces, motion and the center.** Tim Smith and Parag Mital's eye-tracking shows viewers' gazes cluster (attentional synchrony) on motion, flicker, faces and the center of the frame, and that for about a second after a cut only those low-level pulls matter. Smith's attentional theory of cinematic continuity explains why continuity editing is invisible: every rule (match on action, shot and reverse shot, point of view) uses a cue that is already moving the eye. For an engine that knows every object's position this is directly usable: at any moment the thing that carries the idea must also be the thing that moves, lights up or holds a face, and nothing else should.

**The brain cuts the stream into events on its own.** Zacks's event segmentation theory: viewers automatically segment ongoing activity at changes of character, object, place, goal or cause; at those boundaries working memory is flushed and a new model is built. Memory is best for what sits at boundaries and worst for what sits in the middle; cueing boundaries with a pause or a marker improved memory for young and old viewers alike. Only about a tenth of a film's cuts are event boundaries; the rest are invisible. The real units of a video are events, not shots or sentences.

**Rhythm is variation, not speed.** Cutting, DeLong and Nothelfer measured 150 Hollywood films and found shot lengths drifting toward a 1/f pattern, the same pattern as fluctuations in human attention, and it is about variation around the mean, independent of how fast the cutting is. A video with one uniform rate of change, slow or fast, is the thing to avoid. Murch's rule of six is the editor's version: a cut is judged first by emotion, then story, then rhythm, then eye trace, then screen geometry.

**Meaning comes from juxtaposition.** The Kuleshov effect (the same neutral face reads as hunger, grief or desire depending on the shot before it) and Eisenstein's montage (two shots collide to make a third idea) show that order and adjacency carry meaning that neither picture holds alone. "What came just before this" is a direction decision.

**Curiosity is a gap, strongest when the gap is small.** Loewenstein's information gap theory, and Kang et al.'s inverted U: little curiosity when you know nothing or everything, most when you almost know. This is the mechanism behind hooks, open loops and prediction pauses, and it says how to set them: give enough that the viewer can nearly guess, then withhold the last piece.

**Being carried into a story changes beliefs.** Green and Brock's transportation research and van Laer's meta-analysis of 132 effects: the more absorbed a viewer is, the more the story changes beliefs and intentions, and imaginable plots, identifiable people and believability raise absorption. Absorption also lowers critical thought, which is why the truth check must stay in the pipeline whatever the goal.

**Mechanisms are understood one link at a time.** Hegarty's mental animation research: when people work out how a machine moves, they animate its parts one by one in the order of the causal chain, not all at once, and people with lower spatial ability make more errors; an external animation does not beat a static diagram unless it respects that order. Mayer's pre-training principle (know the names and places of the parts before the mechanism is explained) has a median effect size of 0.85 in five of five tests. This governs every how-it-works video, whatever else it is.

**The first seconds decide whether there is a video at all.** YouTube's retention report defines the intro metric as the share still watching after 30 seconds; practitioners treat losing 30 to 40 percent there as normal and more as a failed hook. The MrBeast production manual (leaked 2024, not verified by the company) says the first minute is where people click off and minutes 3 to 6 are the next most important stretch. For a 9:16 short the hook is in the first second. The opening confirms the promise and opens a gap.

## The toolkit: moves, grouped by what they do to the viewer

These are the capabilities the direction layer can use at any moment of any video. None is tied to a kind of video.

**Give time (the tempo tools).**
- *Segment and hold*: a silent stretch where the picture keeps working. Rey et al.'s 2019 meta-analysis (56 studies) finds a reliable gain from segmenting with pauses, including system-placed ones; Lin, Liu and Kalyuga (2022) find system-placed pauses beat learner-controlled ones because viewers lack the judgment to pause; Biard et al. (2018) saw viewers seldom press pause. Merkt et al. (2018) found empty pauses do nothing, so every hold must have a job: look, predict, settle, recap, reveal.
- *Slow first instance, then fade*: the first case fully worked, the next with less help, the rest fast (Renkl and Atkinson's fading, backward fading best; Salden's adaptive fading beats fixed; expertise reversal means the schedule depends on who is watching).
- *Concrete first, then the pattern* (Fyfe et al. 2014; Sanderson's "resist starting with the general thing").
- *Wait time*: about three seconds after a question (Rowe).
- *Apprehension*: keep the rate of visual change low enough to be seen at all (Tversky 2002; Hasler and Sweller; Boucheix).

**Open and close gaps (the curiosity tools).**
- *Promise and hook*: confirm the title, open the first gap, in the first seconds.
- *Prediction before the reveal*: a question the viewer can nearly answer, a beat, then the answer; wrong predictions produce surprise and better memory (Brod 2018, 2021), interpolated questions halve mind wandering (Szpunar 2013), and the first question must not come too early (Wachtler 2016).
- *Misconception first*: voice the wrong idea, then break it (Muller's thesis: the dialogue felt confusing and taught about twice as much as the clean exposition).
- *Open loop and payoff*: a question posed early and answered late; stakes stated early (Hitchcock: tell the audience about the bomb).
- *Withhold*: the one thing that must not appear until its moment (the threat, the turn, the punchline, the answer).

**Guide the eye (the attention tools).**
- *One thing moves*: the thing that carries the idea is the only thing that moves, lights or holds a face (Smith and Mital; S13's `competing` measure).
- *Signal*: mark, ring, focus, dim (Mayer's signaling, d about 0.4).
- *Keep what later steps build on in view* (S13's `held`, the measure that matched the user's own ranking).
- *Camera*: still by default; a drift to keep a still alive (Ken Burns); a push-in to narrow attention; a cut to reset it.
- *Reaction*: a face reacting tells the viewer how to feel about what they see (Kuleshov; horror eye-tracking finds viewers on faces, and dread built from reactions to the threat rather than the threat).

**Build the model (the explanation tools).**
- *Pre-train*: name and place the parts before the mechanism moves (Mayer, d 0.85).
- *Causal chain, one link at a time*: animate the mechanism in the order it causes itself (Hegarty).
- *Truth engines*: the real algorithm, the real trace, the real simulation runs, so the picture cannot lie, and its steps are the natural units for slow and fast phases.
- *Take apart and reassemble*: Branch Education's stated method; a whole, then its pieces, then the whole again.
- *Recap frame*: after building something in pieces, show it whole at once (an event boundary, Zacks).
- *Repetition with one thing changed*: replay with a different input (Primer's second run with one parameter changed).

**Shape feeling (the emotion tools).**
- *Suspense*: known danger, withheld moment, long holds, small motion, sound stretched, one fast release.
- *Surprise*: a pattern set, then broken; before a high-surprise line comedians pause longer (1.37 s versus 1.01 s, Ma et al. 2026), and punchlines predictable in direction rate funnier.
- *Transport*: identifiable people, imaginable scenes, believable specifics; first-person letters and dated facts for history (Ken Burns); active "who did what" sentences (Johnny Harris).
- *Sound from events*: a step, a swap, a collision, a reveal each with its own sound; music moves at event boundaries, not on top of them.
- *Energy*: brisk narration keeps viewers (Guo, Kim and Rubin 2014: fast speakers retained about twice as long). Slowness belongs in the demonstration, not in the narrator.

**Structure (the story tools).**
- *Events with clean boundaries*: a cut, a hold, a recap, a change of place marks where one thing ends and the next begins.
- *Setups and payoffs, callbacks*: something shown early returns later with new meaning.
- *Emotional arc*: Reagan et al. found six basic shapes across 1,300 stories; a video has a shape, and the planner should know which.
- *Re-engagement*: a new promise every few minutes in a long piece (the MrBeast manual's minutes 3 to 6).

## How goals use the toolkit

Not a lookup table: a description of what each goal tends to need, so the planner recognizes the need wherever it appears in a mixed video.

**Teach a method (do it afterwards).** Needs the tempo tools most: slow first instance, holds to look and predict, fading, a recap frame, and the truth engine so every step is right. The Organic Chemistry Tutor's shape: the first problem of a type worked line by line with every step spoken; the second and third with less commentary; by the fourth the pattern is stated once and applied fast. Khan Academy's handwriting speed is the tempo: never more than one line appears at the rate it can be written and read. A cramming student gets one worked instance and fast repetitions; a first-timer gets the prediction pause and the slow first instance.

**Technical and how-it-works (a machine, a system, software, an engineering structure, a science process).** Needs the explanation tools most, and they have their own evidence. Pre-train: the parts, named and placed, before anything moves (Mayer, d 0.85). Then the causal chain one link at a time (Hegarty): the viewer builds the mechanism the way they would mentally animate it, and skipping ahead loses them. Good channels all do this and then add a second move:
- *Branch Education* (photorealistic 3D): take the thing apart, show each piece working, reassemble; the camera travels inside, and each piece gets its own event before the whole runs. Pacing is slow at the first pass through the chain and fast on the second pass when the whole runs.
- *Practical Engineering* (Grady Hillhouse): a physical model on the bench; the principle is shown failing before it is shown working (the sinkhole forms, the dam leaks), so the viewer sees the cause; narration states the engineering rule after the demonstration, not before.
- *Steve Mould*: a seemingly impossible demonstration as the hook, then a cross-section or 2D version so the mechanism is visible, then the rule, then the demonstration again now that the viewer can see it (a callback with new meaning).
- *Primer*: a simulation with the real rules runs in silence for several seconds, then one sentence names what emerged, then the same simulation with one parameter changed.
- *3Blue1Brown* on a mechanism (a neural network, a Fourier transform): a concrete instance animated with no words or a single phrase, then the voice returns to name what happened; an on-screen "pause and ponder" before the general statement.
- *Code walkthroughs*: the research is thin (live coding is at least as good as static code; practitioners say "go slower than if you were coding alone"; expert process videos help novices), so lean on the general tools: one line at a time, the trace engine so values are real, a hold after the line that changes the state, the whole program shown again at the end.
For our engine this goal maps directly to truth kits (`trace`, `dijkstra`, `matrix`, `sort`), programs for simulations, and the pictures-as-objects path (SAM cutouts of a real machine with marks and tags). The withheld thing in a how-it-works video is usually the answer to "why does it fail" or "what is inside".

**Tell history or a true story.** Transport tools: the real document, map and face; dated specifics; first person; one slow camera move so the eye has one place to go. Withhold the turning point; hold on a face before it. If the viewer knows the outcome, reveal it early and make the story the how. Ken Burns's slow pan over stills works only with the right narration and score.

**Suspense, dread, a scare.** Tell the danger early (the bomb under the table: fifteen minutes of suspense beat fifteen seconds of shock). Withhold the moment and the face of the threat; long holds with small motion; sound and silence stretched; the ordinary scene with one wrong detail; reaction faces; then one fast release. The director must not generate the monster in the establishing shot.

**Wonder and curiosity (Veritasium, Vsauce, 3Blue1Brown).** Pose a question the viewer can nearly answer; voice the misconception; a hold; the experiment or simulation runs for real before it is explained; a beat before the reveal; then name what was seen.

**Humor.** Set a pattern so the direction of the punchline is guessable; withhold the wording or the image; a measurably longer pause before it; a straight picture the line undercuts, or the reverse; cut away quickly after.

**Persuade or explain a position.** Stakes first, then mechanism, then the ask; identifiable people and one chart that carries the claim; a trusted narrator with concrete cases; counterarguments only once the viewer is absorbed, and the truth check on every claim because absorption lowers skepticism.

**News, briefing, cramming.** Everything, in order of importance, fast and uniform; chapter markers instead of holds; dense, labeled, scannable frames; brisk voice. The one goal where the tempo tools are mostly off.

**Entertainment and spectacle.** Promise in the first seconds, biggest payoff withheld to the end, re-engagement every few minutes, high variation (1/f), novelty, scale, faces, motion.

**Other kinds the pipeline will meet.** *Tutorial or product demo* ("how to do X in Y"): a how-it-works video where the viewer must reproduce the steps, so the tempo tools come back on and each step gets its own event and hold. *Inspire or motivate*: transport plus arc; a slow build to one line; sound carries more than usual. *Compare or review*: pre-train the criteria, then one event per criterion with the same frame layout each time (repetition with one thing changed), a recap table at the end. *Data story*: one chart that morphs (same ids across states), a reveal when the surprising number appears, a held frame on it. *Meditative or ambient*: almost no narration, long events, the picture and sound do everything.

## Mixed videos: blending goals moment by moment

Most real requests are several of these at once, and the mix changes across the video. "Teach me how a nuclear reactor works" is a how-it-works video that wants a suspense hook (what happens if the coolant stops), a slow causal chain (neutrons, moderator, control rods, one link at a time), a wonder payoff (the same chain run fast as a whole), and, if the user is a student, a worked instance of the one calculation that matters. "Why did Rome fall, entertainingly" is a history that teaches a mechanism (a feedback loop of debased coin and unpaid soldiers), so it needs transport tools for the people and places and the explanation tools for the loop, with the loop's first turn slow and the later turns fast. "Explain quicksort" for a curious viewer opens with a wonder gap (how can sorting a million things take so few steps), then a slow first partition, then fading, then a recap frame; for a cramming student it drops the gap and keeps the fading.

The direction layer does this by walking the video as the viewer and asking, at each event, five questions: what does the viewer know now, what are they waiting for, where should their eye be, how should they feel, and what must not be shown yet. The answers decide the moves. Intent (from the plan and the user's own words) sets the starting settings: a cramming student does not get prediction pauses, a scare does not get a recap frame. Content sets the rest: a truth engine with eleven steps invites slow-then-fast; a document with one face invites a hold; a mechanism with five parts invites pre-training; a surprising number invites a withheld reveal. A hook built on suspense followed by a slow worked demonstration followed by a wonder payoff is not a template; it is what falls out when a how-it-works request from a curious viewer meets content that has a danger, a chain and an emergent whole. A different request meets the same content and gets a different walk.

This is why the plan is written per moment rather than per video: each moment carries its own job.

## What holds attention without overload or dumbing down

- Variation, not speed (Cutting; Lang's cut-rate curve). Mix long and short events.
- One thing at a time, but the thing can be hard (Lang; Smith). Overload comes from competing pulls, not from difficult content.
- Gaps that are nearly closed (Loewenstein; Kang).
- Events with clean boundaries (Zacks). Memory lives at boundaries.
- Parts before mechanism, chain in causal order (Mayer; Hegarty).
- Reactions, not just the thing (Kuleshov; horror eye-tracking).
- Stakes told early (Hitchcock).
- Absorption over argument, with the truth check kept (Green and Brock).
- The promise confirmed in the first seconds (YouTube retention; MrBeast manual).
- Brisk voice, slow demonstration (Guo; Tversky).

What only feels nice: smooth gapless narration (Muller: clear and easy, taught less), uniform fast cutting (Lang), decoration and motion that is not the idea (S13 `competing`), music swells not tied to an event, a question with no setup (Wachtler), an empty pause (Merkt).

## Design: one direction stage

### Principle

Capabilities and intent, never rules. One stage, `direction`, after the writer (after structure gives beats and `visual` per beat) and before voice. It receives: the plan's `intent` and the user's own words, the persona, the script with beats, the pictures that exist, and the kit docs (`STEPS_DOC` and kit lines, so it knows a sort has one step per comparison and a trace has one per line). It gets the toolkit above as knowledge of what each move does to a viewer, in the way `engine-language.md` describes abilities. It is asked to walk the video as the viewer, event by event, answer the five questions, and write the moves. It may insert holds, insert short cue lines (new spoken sentences such as "Watch the first swap." or "Now the same thing, faster.", new beats flagged `cue`, never new facts), and attach demonstration phases and withholds to events. It never moves or deletes the writer's words, so the writer's ownership and structure's word-for-word guarantee stand.

Same stage, every video. A lesson, a reactor explainer, a dread piece, a comic history and a 40 second cramming card all go through it and come out with different walks.

### The plan: one format, each moment with its own job

```ts
type DirectionPlan = {
  goal: string;        // one line: what this video is for and what the viewer should have or feel at the end
  promise: string;     // what the opening must confirm within the first seconds
  arc: string;         // the emotional shape in a phrase (rise, fall then rise, steady build to one line, ...)
  events: Event[];     // the video as the viewer segments it, in order; every word belongs to exactly one event
  cues: Cue[];         // short spoken lines to add before a word
};

type Event = {
  id: string;                          // "e3"
  firstWord: number; lastWord: number; // global word numbers
  job: string;                         // this moment's purpose, in plain words ("name the parts", "first swap, slowly", "the turn")
  knows: string;                       // what the viewer knows by the end of this event
  waiting: string;                     // the open question or stake carried through it ("" if none)
  look: string;                        // the one thing the eye should be on
  feel: string;                        // calm, curious, tense, amused, moved, urgent, wonder
  rhythm: "long" | "short";            // held, or quick succession; the planner mixes them (Cutting)
  reveal?: { word: number; what: string };     // closes a gap here
  withhold?: { what: string; until: string };  // must not be shown or said before event `until`
  holds?: Hold[];                      // silences inside this event
  demo?: Demo;                         // a truth thing or program playing through this event
  sound?: string;                      // a sound or music move tied to a moment here
  camera?: string;                     // still, drift, push in, cut: the intent; the scene author chooses how
};

type Hold = {
  id: string;                          // "h2"
  afterWord: number;                   // silence begins when this word ends
  seconds: number;                     // the planner decides; typically 0.8 to 8
  purpose: "look" | "predict" | "settle" | "recap" | "reveal";
  does: string;                        // what the picture does during it
  shows?: string;                      // an on-screen prompt for a predict hold
};

type Demo = {
  what: string;                        // "quicksort on [5,2,8,1,9], bars", "trace of the loop", a program idea
  phases: Phase[];                     // together cover the demonstration once, replays included
};

type Phase = {
  steps?: [number, number];            // which truth steps, from 1; omitted for a program or a replay
  pace: "slow" | "normal" | "fast";
  at: { word: number } | { hold: string };
  until?: { word: number } | { hold: string };
  replay?: boolean;
  why: string;                         // the teaching or story reason, one line
};

type Cue = { beforeWord: number; text: string };
```

`job` is the field that makes it one framework: every event says what it is for, and the tools attached to it (holds, demo, withhold, reveal, camera, sound) are whatever that job needs. A how-it-works event reads "name the parts" with no holds and a `look` on each part in turn; the next reads "first link of the chain, slowly" with a demo phase and a look hold; a history event reads "the turn" with a withhold, a long rhythm, a camera push and a sound; a scare event reads "the ordinary room" with a withhold and a hold whose `does` is "nothing moves except the curtain".

### How each stage consumes it

**Voice.** ElevenLabs facts checked today: `eleven_v4` (our model) and v3 do not support SSML `<break>`; they take audio tags such as `[pause]`, `[short pause]`, `[long pause]` and mood tags like `[quietly]` or `[building tension, measured pace]`, with no controllable length; Multilingual v2 and Flash support `<break>` up to 3 s and the docs warn many breaks destabilize output; `voice_settings.speed` runs 0.7 to 1.2 and the docs do not say which models honor it; request stitching (`previous_text`, `next_text`, `previous_request_ids`) is unavailable on v3 and unstated for v4. So: split the script at every hold, one TTS call per segment with `previous_text` and `next_text`, join with ffmpeg inserting exactly `seconds` of silence (or a style room-tone bed so a hold does not sound like a dropout), offset word times by the running total. The result is still one `narration.mp3` and one word list, so every later stage works unchanged; `p.narration.holds` records the gaps. `feel` per event can set a v4 mood tag at the start of its segment. If v4 honors `speed`, it stays within 0.9 to 1.1; the slowness comes from fewer words per step and from silence, not from a slow narrator. A failed segment is regenerated alone with `next_request_ids`. Credits: the same characters plus cue lines; 3 to 8 calls instead of 1. One 30 second test settles `speed` and stitching on v4.

**Scene.** The engine needs almost nothing: moments are `{ word, offset }`, and `@N+frames`, `until=`, `do steps from= to= at= each= until=`, `focus`, `dim`, `camera ... drift=`, `@N cut`, entrances and `emit` already exist. The section prompt lists its events in plain words (job, knows, waiting, look, feel, withhold, rhythm, sound, camera) with holds as frame lengths and demos as phases: "hold h2: after word 212, 4.0 s (120 frames), predict, the two bars pulse and nothing else moves, show 'Which one moves?'"; "demo: steps 1 to 2 slow under words 198 to 212, steps 3 to 4 during h2, steps 5 to 11 fast under 213 to 230, then replay steps 1 to 3 beside the finished array under 231 to 240". Optional sugar `@h2` and `@h2.end` compile to `{word: 212, offset: 1}` and `{word: 213, offset: -1}`. Replays use a second instance of the kit thing with the same data. `withhold` is the one hard constraint: a named thing must not appear before its `until` event; the build checks it from the compiled scene and fails loudly. Repair stays as today: a phase that cannot fit comes back as a build error, and the repair compresses it or reports the hold as too short so the direction stage can lengthen it.

**Pictures** (director, assets, annotate). `look` and `withhold` go to the director so the monster is not in the establishing shot and the turn is not in the first image. This is the FIXES item "no visual spoilers" with a source of truth.

**Sound and music.** `sound` entries become `emit` names the mix stage keys music and effects to; `feel` changes across event boundaries are where music cues belong (engine plan section 9, with a planner behind it).

**Review.** The S13 sequence reviewer gets the event list as its yardstick. From scene data, no vision call: is `look` the thing that moves or lights during each event; is anything withheld visible early; does change density vary across the video (Cutting) rather than sit flat. From frames and audio: is each hold silent (ffmpeg `silencedetect`, as S6) and do its frames match `does`; at each demo phase boundary, does the slow phase show one step at a time with the compared parts signaled and the fast phase end on the finished state; do the first 30 seconds show the `promise`; for a pre-train event, are the parts named and placed before the chain moves. The first-time learner quiz asks about the demonstration itself ("after the first swap, where is the 8?"). Tickets name the event id and go back to the direction stage for repair, not to a fallback.

### Smallest version that can ship by Wednesday

1. **Direction stage** (`pipeline/stages/direction.ts`, `prompts/direction.md`): one Spark JSON call. Output `goal`, `promise`, `events` with `job`, `look`, `waiting`, `reveal`, `withhold`, `holds`, and a free-text `tempo` note per event in place of `demo` phases ("first two comparisons slow, rest fast"), plus `cues`. Drop `arc`, `feel`, `rhythm`, `sound`, `camera` for now. The prompt is the toolkit as abilities plus the five questions, with no numbers prescribed and no table by video type.
2. **Voice**: split at holds, one call per segment with `previous_text`/`next_text`, ffmpeg concat with silence, offset word times, store `narration.holds`. A 30 second test first for `speed` and stitching on v4; if neither works, nothing in the design changes.
3. **Scene prompt**: list the section's events and holds with frame lengths, purpose, `does` and the tempo note. No language change; `@N+frames` and `do steps ... each=` cover it. Add the withhold check over the compiled scene (a few lines).
4. **Review**: the "hold honored" check only (silence present, frames inside the hold differ from the frame before it).

Touches `run.ts` (one stage line), `schemas/project.ts` (the types), `voice.ts`, `scene.ts` prompt assembly, one new stage and prompt. It makes a lesson slow down where it should, makes a how-it-works video name its parts and play its chain one link at a time, and stops a story spoiling itself, which are the three visible failures today, for one extra Spark call.

### Full version after

Demo phases and `@hold` sugar; `arc`, `feel`, `rhythm`, `sound`, `camera` in the plan; music and effect cues keyed to `emit`; v4 mood tags per event; prediction holds that put a question card on screen as a scene object and remove it on the reveal word; the look, variation, promise and pre-train checks in the reviewer, with a direction score in the benchmark beside `held`; benchmark requests across goals (a dread piece, a comic history, a reactor explainer, a persuasive piece, a tutorial) each scored by its own measure (learner quiz, a sound-off "what is the viewer waiting for" account, a transportation self-report from a model reader); intent-aware fading from the previous version's quiz result (Salden's adaptive fading); in the player, events become chapters and holds become natural pause points, and a predict hold can wait for a click in the interactive export.

### Cost per video

One Spark call (on the order of $0.03 to $0.10 at current effort and prices, about 5 to 15 percent of a video's model cost); the same ElevenLabs credits plus cue lines, in 3 to 8 calls; a few hundred more prompt tokens per scene section; render and review time up by the holds, typically 10 to 30 seconds on a 2 minute lesson or explainer and near zero for a briefing. Net: about 10 to 20 percent more for a video that needs holds, near zero for one that does not. The withhold and look checks run on scene data and cost nothing.

## Sources

Learning and explanation

- Rey, G. D. et al. (2019). A meta-analysis of the segmenting effect. Educational Psychology Review. https://www.doi.org/10.1007/S10648-018-9456-4 and https://is.tuebingen.mpg.de/publications/rey2018segmenting
- Mayer, R. E. and Pilegard, C. Principles for managing essential processing (segmenting, pre-training, modality). Cambridge Handbook of Multimedia Learning. https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/principles-for-managing-essential-processing-in-multimedia-learning/A9E77D0172F905AC957689D1771E2888
- Mayer, R. E., pre-training principle (brakes, d 0.85). https://www.cambridge.org/core/books/abs/multimedia-learning/pretraining-principle/01791D57F5D4164251269E6DF56A8BF1
- Mayer, R. E. and Fiorella, L. Principles for reducing extraneous processing (coherence, signaling, temporal contiguity). https://core-prod.cambridgecore.org/core/books/cambridge-handbook-of-multimedia-learning/principles-for-reducing-extraneous-processing-in-multimedia-learning-coherence-signaling-redundancy-spatial-contiguity-and-temporal-contiguity-principles/CD5B7AE1279A9AB81F8EEBB53DBEC86E
- Hegarty, M., mental animation of mechanical systems (1992; Hegarty and Sims 1994; Hegarty, Kriz and Cate 2003). https://link.springer.com/content/pdf/10.3758/BF03200867.pdf and https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/multimedia-learning-about-physical-systems/DF23D5FBD27F575CBA72D3881E454F87
- Tversky, B., Morrison, J. B. and Betrancourt, M. (2002). Animation: can it facilitate? https://hci.stanford.edu/courses/cs448b/papers/Tversky_AnimationFacilitate_IJHCS02.pdf
- Hasler, Kersten and Sweller (2007), learner control and instructional animation. https://core.ac.uk/works/19653879
- Lowe, R. and Boucheix, J. M., animation processing and pacing. https://www.earli.org/assets/images/keynote-presentation-rlowe-jmboucheix.pdf
- Lin, Liu and Kalyuga (2022), learner control and pausing in video. https://springerlink.bibliotecabuap.elogim.com/content/pdf/10.1007/s11251-022-09600-w.pdf
- Merkt, Ballmann, Felfeli and Schwan (2018). Pauses in educational videos. https://researchr.org/publication/MerktBFS18/bibtex
- Biard, Cojean and Jamet (2018). Segmentation and pacing in procedural learning by video. https://eld.bl.uk/catalog/100178776721_0x000001
- Hoogerheide and Seppälä (2024), six evidence-informed tips for instructional video. https://researchers.une.edu.au/en/publications/six-evidence-informed-tips-on-how-to-optimize-learning-from-instr/
- Renkl, Atkinson, Maier and Staley (2002), fading worked examples. https://typeset.io/pdf/from-example-study-to-problem-solving-smooth-transitions-15tfd8h0l4.pdf
- Salden et al. (2009), adaptive fading. https://faculty.engineering.asu.edu/mre/wp-content/uploads/sites/31/2020/02/MoRO09.pdf
- Expertise reversal and worked examples. https://www.bohrium.com/paper-details/the-expertise-reversal-effect-and-worked-examples-in-tutored-problem-solving/811838108407431172-11376
- Fyfe, McNeil, Son and Goldstone (2014). Concreteness fading. https://www.doi.org/10.1007/S10648-014-9249-3
- Brod, G. (2021). Predicting as a learning strategy. https://pmc.ncbi.nlm.nih.gov/articles/PMC9722848
- Brod, Hasselhorn and Bunge (2018). The element of surprise. https://www.bohrium.com/paper-details/when-generating-a-prediction-boosts-learning-the-element-of-surprise/813049403781677057-11581
- Brod and Breitwieser (2019). Predictions and curiosity. https://www.pedocs.de/volltexte/2022/25224/pdf/NPJ_2019_4_Brod_et_al_Lighting_the_wick_in_the_candle_of_learning_A.pdf
- Szpunar, Khan and Schacter (2013). Interpolated memory tests reduce mind wandering. PNAS. https://pmc.ncbi.nlm.nih.gov/articles/PMC3631699/
- Wachtler et al. (2016), questions in interactive learning videos. https://elearningblog.tugraz.at/archives/9080
- Rowe, M. B., wait time (summary). https://www.structural-learning.com/research-briefings/wait-time-three-seconds
- Muller, D. (2008), PhD thesis and Tackling misconceptions in introductory physics using multimedia. https://openjournals.library.sydney.edu.au/IISME/article/view/6345 and https://www.scribd.com/doc/286516446/Derek-Muller-PhD-Thesis
- Guo, Kim and Rubin (2014). How video production affects student engagement. https://up.csail.mit.edu/other-pubs/las2014-pguo-engagement.pdf
- Hundhausen, Douglas and Stasko (2002), algorithm visualization meta-study, as cited in https://www.scitepress.org/Papers/2009/18251
- Live coding evidence: ten quick tips (PLOS). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7482837/ and expert live coding with reflection (IEEE TE 2022). https://scholar.lib.ntnu.edu.tw/en/publications/teaching-programming-by-revealing-thinking-process-watching-exper/
- Pearson and Gallagher (1983), gradual release of responsibility. https://www.structural-learning.com/post/i-do-we-do-you-do

Attention, film and story

- Lang, A., limited capacity model (LC4MP), orienting response and cut rate. https://en.wikipedia.org/wiki/LC4MP and https://en.wikipedia.org/wiki/Annie_Lang
- Smith, T. J. (2012). The attentional theory of cinematic continuity. Projections 6(1). https://ualresearchonline.arts.ac.uk/id/eprint/21187/
- Smith, T. J. and Mital, P. K. (2013). Attentional synchrony in static and dynamic scenes. Journal of Vision 13(8). https://ualresearchonline.arts.ac.uk/id/eprint/21177/ and the survey https://arxiv.org/pdf/2102.13378
- Bordwell, D., on Smith's eye-tracking. https://davidbordwell.net/blog/2011/02/14/watching-you-watch-there-will-be-blood/trackback/
- Zacks, J. M. et al. (2010). The brain's cutting-room floor: segmentation of narrative cinema. https://www.frontiersin.org/articles/10.3389/fnhum.2010.00168/text
- Swallow, Zacks and Abrams, event boundaries and memory. https://supp.apa.org:443/psycarticles/supplemental/a0022160/swallow_zacks_abrams_fixed_wdeletions.pdf
- Gold et al. (2016), cueing event boundaries improves memory for film. https://cognitiveresearchjournal.springeropen.com/track/pdf/10.1186/s41235-016-0043-2
- Cutting, DeLong and Nothelfer (2010), 1/f shot lengths; Cutting, DeLong and Brunick (2018), temporal fractals in movies and mind. https://pmc.ncbi.nlm.nih.gov/articles/PMC3485803/ and https://www.psychologicalscience.org/observer/the-science-of-hollywood-blockbusters-2
- Walter Murch, In the Blink of an Eye, rule of six. https://nofilmschool.com/2016/11/6-rules-good-cutting-according-oscar-winning-editor-walter-murch
- Kuleshov effect and Eisenstein montage. https://human.libretexts.org/Courses/Nashville_State_Community_College/Tokyo_in_Film/04%3A_Post-Production/4.03%3A_Editing_and_Animation/4.3.02%3A_Soviet_Montage_And_The_Kuleshov_Effect and https://retrospectjournal.com/2024/01/28/soviet-era-cinema-on-the-development-of-montage-theory/
- Hitchcock and Truffaut, surprise versus suspense. https://nofilmschool.com/alfred-hitchcock-and-francois-truffaut-explain-surprise-vs-suspense and https://www.davidbordwell.net/blog/2013/11/29/hitchcock-lessing-and-the-bomb-under-the-table/trackback/
- Recreational Fear Lab (Aarhus), eye tracking during jump scares. https://cc.au.dk/recreational-fear-lab/blog/view/artikel/boo-aaah-an-investigation-of-where-our-attention-is-guided-during-a-jump-scare-sequence-1
- Loewenstein (1994), information gap; Kang et al. (2009), inverted U; Golman and Loewenstein. https://www.cmu.edu/dietrich/sds/docs/golman/golman_loewenstein_curiosity.pdf and https://pmc.ncbi.nlm.nih.gov/articles/PMC10243256
- Green and Brock (2000), transportation; van Laer et al. (2014), meta-analysis. https://core.ac.uk/download/82917355.pdf and https://openaccess.city.ac.uk/id/eprint/6755/1/SSRN-id2033192.pdf
- Reagan et al. (2016). The emotional arcs of stories are dominated by six basic shapes. https://epjds.epj.org/articles/epjdata/abs/2016/01/13688_2016_Article_93/13688_2016_Article_93.html
- Ma, Peng, Lyu, Zhang and Zhu (2026). Timing is everything: temporal scaffolding of semantic surprise in humor. https://arxiv.org/pdf/2605.00143
- YouTube Help, audience retention report. https://support.google.com/youtube/answer/1715160?hl=en-GB
- MrBeast production manual coverage (leaked 2024, unverified). https://www.tubefilter.com/2024/09/17/mrbeast-internal-production-guide-leaked-key-points/amp/ and https://www.creatorhandbook.net/leaked-document-allegedly-reveals-mrbeasts-secrets-to-youtube-success-the-key-takeaways/

Creators

- 3Blue1Brown FAQ on pacing. https://www.3blue1brown.com/faq/
- Sanderson at Stanford, "pause and ponder". https://www.stanforddaily.com/2020/01/24/3blue1brown-creator-grant-sanderson-15-talks-engaging-with-math-using-stories-and-visuals
- Sanderson on concrete before abstract. https://blog.dropbox.com/topics/work-culture/grant-sanderson-channels-his-passion-for-math-into-marvelously-i and https://www.voll-ki.fau.de/en/?p=433
- Sanderson, MAA FOCUS interview. https://digitaleditions.walsworth.com/article/3Blue1Brown+An+Interview+With+Grant+Sanderson/3201151/529803/article.html
- Veritasium, Khan Academy and the effectiveness of science videos. https://rosetta.to/u/veritasium/khan-academy-and-the-effectiveness-of-science-videos
- Kurzgesagt, our video process. https://kurzgesagt.org/youtube/
- Branch Education, process interview with Teddy Tablante. https://poddtoppen.se/podcast/1664054824/inspiring-computing/animating-engineering-with-teddy-the-mind-behind-branch-education
- Practical Engineering, Grady Hillhouse interview (building demonstration models). https://www.podchaser.com/podcasts/full-momentum-an-hec-ras-podca-4259959/episodes/episode-18-interview-with-prac-130247683 and https://sagroups.ieee.org/icicle/2021/10/19/october-2021-newsletter-2/
- Steve Mould profiles (impossible demonstration as hook, cross-section mechanisms). https://www.f4group.co.uk/artistes/steve-mould and https://plus.maths.org/node/6770
- Ken Burns effect and craft. https://en.wikipedia.org/wiki/Ken_Burns_effect and https://www.masterclass.com/articles/how-to-use-the-ken-burns-effect-in-a-documentary
- Johnny Harris on writing script and visual direction together. https://recapio.com/digest/why-every-johnny-harris-video-goes-viral-by-david-perell
- Vsauce's question-led structure. https://digiday.com/media/secret-sauce-behind-youtube-giant-vsauce/

ElevenLabs

- How can I add pauses (v4 and v3 use audio tags, no SSML break; break up to 3 s on v2 and Flash). https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-can-i-add-pauses
- Prompting controls (speed 0.7 to 1.2, pauses, pacing). https://elevenlabs.io/docs/best-practices/prompting/controls and https://elevenlabs.io/docs/product/prompting/pauses
- Request stitching. https://elevenlabs.io/docs/eleven-api/guides/cookbooks/text-to-speech/request-stitching
- Text to speech API reference. https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- Eleven v3 audio tags. https://elevenlabs.io/blog/v3-audiotags
