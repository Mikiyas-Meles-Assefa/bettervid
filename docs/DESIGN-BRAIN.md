# The design brain (wave 4 proposal, Nov 3)

Status: proposal for the user to approve. No engine code has changed. The prototype lives in `scripts/design-brain/` and scored three wave 3 bench cases; its clips and sheets are in `projects/design-brain/bench-compare/` and its bench run in `bench/results/2026-11-03-design-brain/`.

## In one paragraph

Today a weak author (Spark, about Haiku level) writes low-level scene code for every frame, so the frames come out hand-placed by a weak author, and repair loops cannot create quality. The design brain moves design out of the author's hands, but not into fixed rules: nobody knows what hundreds of thousands of people will make, so there is no universal "good frame" to hardcode. A horror beat may hide its threat, an ambient piece may want no focal point, a meme may be cramped on purpose, and the output may be a phone, a TV or a slide. So the design brain has five layers. (1) **Abilities**: what the engine can do, with no opinions (place, size, layer, move, transform, crop, camera, depict a thing as itself with parts that change, redraw the user's material, time to the voice). (2) **Instruments**: measurements of any property of a rendered moment (salience, legibility at a given viewing size, change load, likely eye path, what is visible or hidden, timing against the voice), which report and never judge. (3) **Reasoning agents** that decide, per video and per moment, what good means here, from the intent, audience, material, requirements, platform and purpose. (4) **Search and look loops**: agents try options with the abilities, measure them against the goals they set, watch them as different viewers, and revise. (5) **Style values** as overridable suggestions. The author only says what matters; strong authors can still write every frame by hand.

## 1. What is wrong now

Evidence: the wave 2 sheets (`projects/merge-w2/watch10/sheet.jpg`, `projects/stats-w2/watch7/sheet.jpg`), the review of Nov 2 (`docs/reviews/2026-11-02-three-videos.md`), and the wave 3 bench baseline (`bench/results/2026-11-03-baseline/`: free measures 0.75, designer 3.9 of 10, none above 6, scroller kept 59%, learners 0.95 with the video against 0.81 with words only, so the picture adds little teaching).

Symptoms (a list of symptoms, not the definition of the goal):
- **Labels instead of things.** Titration is a box labelled NaOH over a box labelled "acid + phenolphthalein" with the word "pink" beside it: no liquid, no drop, no color change. The Magna Carta is a rectangle with a circle labelled "seal".
- **Demonstrations that do not happen.** Balls that never drop, a counter stuck at 0.
- **Content small in the top third**, the bottom half empty; text as narration in pieces.
- **Holds that are dead air** where a scroller swipes.
- **Everything competes**; motion does not lead the eye; answers arrive early.
- **Repairs do not converge**: the author who must fix a frame is the author who made it.
- A likely bug for the bench owner: `role=key` on equation lines draws the word "key".

The cause is structural: composition, depiction and direction are the author's job, and the author is the weakest link. Spark scores about 13% on ProgramBench against 65% for Opus; the scene language is closer to programming than to writing.

## 2. The five layers

### 2.1 Abilities (no opinions)

What the engine can do. An ability has parameters and no defaults that encode taste.

| Ability | What it does | Exists today |
|---|---|---|
| place, size, layer | put anything anywhere, at any size, in front of or behind | yes (core primitives, `layer`, `z`) |
| move, transform | interpolate any property; morph shapes; transform text and math by matched parts | yes (`set`, `matchShapes`, math parts) |
| crop, zoom inside | show part of a picture, animated, within its own frame | yes (image crop, prototype part zoom) |
| camera | pan, zoom, hold, drift, cut | yes (camera lines, follow camera) |
| depict | draw a thing as itself, with parts that carry state (a liquid with a level and color, a body that falls, a scale that can be read, a hand that turns) | prototype only (`depict.ts`) |
| redraw material | turn a chart with data into live bars on its own scale, starting on the original's bars | prototype only |
| compute | truth kits (sort, graph, math, steps, trace) that compute what is shown | yes (`engine/kits`) |
| time | start, hold, stretch, wait for a word, a hold or another change | yes (word anchors, holds, withholds) |
| sound cue | a sound tied to a change (a drop lands, a ball hits the floor) | wave 6 interface |

Depiction is one ability among these, not the center. Its tiers share one interface (a box, named parts, states):
1. **Drawn props** built from vector parts in the style's own ink (the prototype's vessel, burette, ball, clock).
2. **Generated sprites in the style**, cut into parts with SAM, with state as overlays (a tint on the liquid mask, a part that moves).
3. **The user's own images** with parts found by vision and SAM.
4. **Real pictures** found by the wave 5 picture hunter, with parts.

A weak author writes "the flask turns faint pink" and gets it, whichever tier draws the flask.

### 2.2 Instruments (measure and report, never judge)

An instrument takes a rendered moment or clip and returns numbers and pictures. It has settings (for example a viewing size and distance for legibility, or a window for change load); an agent chooses the settings for this video. It never says "pass" or "fail".

| Instrument | Reports | Basis |
|---|---|---|
| salience map | where attention is likely to go in a frame and after a change, and the share each thing gets | analytic (size, contrast, onset, center) first; a learned model (UMSI) on keyframes later |
| legibility | for each piece of text, its size and contrast at a chosen viewing size and distance | font metrics and the style's surfaces (`engine/style/design.ts` already checks contrast) |
| change load | how many things start, move or change per window, and how many pull at once | scene sampling (`bench/lib/measure.ts`) |
| eye path | the likely order the eye visits things over time, and which changes it may miss (during a camera move, during another change) | salience over time plus change blindness windows |
| visible and hidden | what is on screen, covered, cut by the frame, or withheld at each moment | scene sampling (the bench's reveal and read measures) |
| timing against the voice | for each named thing, when it appears or changes relative to its word; each hold's activity | word timings and scene sampling (bench lag and holds) |
| fill and balance | occupied area, empty bands, visual weight left and right, steadiness of things that stay | layout boxes (the build's "fills only 16%" note) |
| viewer panels | what a first-time learner, a follow viewer, a demanding designer and a distracted scroller see and remember | Claude subagents on sheets (the wave 3 bench) |

The bench measures are instruments too. They evaluate; the engine does not optimize toward them blindly. The prototype shows why: the load instrument counts each falling drop as a new thing, so a stream of drops scores as overload, while every viewer read it as one stream.

### 2.3 Reasoning agents (decide what good means here)

Agents read the intent, the audience, the user's material and its requirements, the platform and the purpose, and write goals per video and per moment in plain terms, with the instrument settings that would show them met. Examples of goals an agent might write (not defaults):
- "At 0.5 s the viewer of this phone feed should already see the two balls at one height; the question can wait."
- "During the hold, the faint pink is the only thing that changes; the timer may tick."
- "This horror beat keeps the threat below 10% of salience until the cut."
- "This TV lecture keeps the whole derivation on screen; nothing leaves while it is referred to."

Agents:
- **Director** (per video): purpose, audience, platform, the arc, what the viewer should know and feel at each event, which demonstrations happen and how fast, what is withheld and why. Wave 2's direction plan is its first form.
- **Designer** (per moment): what matters now and how strongly; which abilities to try; the goals and instrument settings for this moment; style suggestions to keep or override.
- **Material reader** (per file, once): named parts, data, text, requirements found in the material (section 2.6).
- **Viewer panel** (per candidate): a learner, a distracted scroller, a demanding designer, and viewers the director names for this audience (a chemistry teacher, a non-native speaker, someone watching on a TV), each reporting what they saw.

Agents are Meta models in production (Muse Spark for the cheap high-volume calls, a stronger model where a decision carries the video); the prototype used Claude Haiku as the author and Claude Sonnet as viewers, at $0 Meta spend.

### 2.4 Search and look loops

Per moment, or per stretch of moments that share things:
1. The designer agent proposes a few candidate arrangements and motions with the abilities (not one), or asks a cheap generator for them (a constraint solver for placements, a planner for camera paths, enumeration of transition orders).
2. The engine renders each candidate as keyframes and short motion samples.
3. Instruments measure each candidate with the agent's settings.
4. The agent compares the measurements with its own goals, looks at the best candidates as the viewer panel, and keeps, mixes or revises.
5. Budgets bound the loop (candidates per moment, rounds, model calls); the agent spends more where the director marked a moment as carrying the video.

This is what makes repairs converge: the party that composes is the party with the abilities and the instruments, and it compares options instead of patching one.

### 2.5 Style values as suggestions

A style (`styles/*.json`, `engine/style/design.ts`) supplies data: a type scale and ratio, spacing units, colors and the surfaces they may sit on, motion feel, dim treatment, pointer and panel looks, picture treatment. These are suggestions the designer agent starts from and may override for a moment or a video (a meme that is cramped on purpose, a calm piece with slower motion). Overrides are written down with a reason.

### 2.6 The user's material and its requirements

Most people bring their own material: files, docs, slides, screenshots, photos, charts, data, code. Their pieces are first class:
- **Read once, into named parts**: a slide's title, total and bars; a photo's regions; a chart's data; a document's quotes and headings; code lines. The prototype's support-tickets slide was read by hand into parts and data (`scripts/design-brain/bench-setup.ts`); in the pipeline a reader agent does it (vision, SAM, the data file when present, a check of the reading against the source). This overlaps wave 5's agentic parsing and uses the same cards.
- **Requirements**: one part of a project can say what matters in another. A syllabus marks a chart in the lecture slides as essential; a brand guide fixes colors and logo; a brief names must-say claims. The planner turns these into requirements of the video ("show this exact figure", "use these colors", "never say that"). The designer agent takes required pieces as given and composes around them; instruments check each requirement is met (the figure is on screen, legible at the chosen size, for long enough).
- **Real or redrawn** is the agent's call per piece and purpose: evidence the viewer should recognise stays real; information that should come to life may be redrawn, starting exactly on the original (the prototype's slide shows as it is, then its bars are redrawn on top and move to their new places).

## 3. What the author says

The author states intent per moment; the agents and the engine do the rest. The vocabulary is small and about the viewer, not the screen (`scripts/design-brain/intent-prompt.md`, 5.3 KB against 40 KB for today's language guide):
- **Things**: `thing` (words or a value), `many` (countable marks), `object` (a real thing to see, described in plain words), and the user's material by name and part (`slide.login`).
- **Per moment** (`@N` on a spoken word): `show` (the one subject), `keep` (what stays as support), relations (`compare`, `A -> B`, `A from B`, `becomes`), direction (`ask`, `reveal`, `wrong`, `stress`, `pace`), and plain verbs for what objects do (`drips into`, `turns`, `flashes`, `swirls`, `falls`, `fills`, `reads`, `runs`, `moves to`).
- **Top lines**: `feel`, `for new|familiar`.
- Nothing about position, size, color, easing or frames.

Strong authors lose nothing: any line of today's language inside a moment wins for that thing in that moment, and the agents compose the rest around it (section 6).

## 4. How each area is decided (and by whom)

Every decision below is made by an agent against goals it wrote, informed by instruments, or by search over options. Where today's engine or the prototype uses a fixed value, it is listed in section 8 as a stand-in to be removed.

### 4.1 Composition and use of the frame
- **Decided by**: the designer agent, per moment, from candidates.
- **Abilities**: place, size, layer, crop, the stage (things that persist keep their place while words take turns around them).
- **Instruments**: fill and balance, salience share of what the agent named as subject, steadiness across moments, legibility at the platform's viewing size, platform UI zones (read from the target: a feed short has captions and buttons at the bottom and right; a TV or a lesson watched full screen has none).
- **Search**: a constraint solver (Cassowary, kiwi.js) proposes metric layouts for a few structures the agent names; candidates are rendered and measured; the agent picks.

### 4.2 Type and hierarchy
- **Decided by**: the designer agent; the style's scale is the starting suggestion.
- **Instruments**: legibility at the chosen viewing size and distance, the number of sizes in a frame, reading time against how long the words stay.
- **Agent reasoning**: whether words appear at all (the narration already says them; the redundancy research says verbatim text costs learning, but a muted feed viewer needs captions), and which words carry a moment.

### 4.3 Depicting things as themselves
- **Decided by**: the material reader and the designer: which tier draws a thing, which parts and states it needs, real or redrawn.
- **Abilities**: depict (four tiers), state changes timed to words.
- **Instruments**: visible and hidden (is the changing part on screen and big enough to see change), legibility of the part (a meniscus at a phone's size), the follow viewer (what did they think the thing was).

### 4.4 Motion and transitions
- **Decided by**: the designer agent; transition orders and morph kinds are enumerated and measured.
- **Abilities**: move, morph by identity, born from a source, strike through, count, crossfade a picture into its redrawing.
- **Instruments**: change load per window, eye path (does the eye arrive where the next change happens), steadiness, motion that carries no change in the concept (flagged for the agent, not removed).
- **Research the agent can consult**: staging exits before moves before entrances (Heer and Robertson 2007); identity-preserving transforms (Manim `Transform`, Keynote Magic Move); easing by role and duration by distance (Material 3 motion tokens, NN/g). These are knowledge, not rules.

### 4.5 Camera
- **Decided by**: the designer agent, per stretch, from candidate camera paths (a planner over moments, as in Galvane et al.'s continuity editing, with framing solved in closed form as in Lino and Christie's toric space).
- **Instruments**: what the camera hides or cuts, changes that happen during a move (change blindness, Rensink et al. 1997), legibility after zoom.
- The follow camera (`engine/language/follow.ts`) becomes one candidate generator.

### 4.6 Timing to the voice
- **Decided by**: the director for the video's tempo, the designer per moment.
- **Instruments**: timing against the voice (each named thing's onset relative to its word), dwell (how long each thing stays against its reading or viewing time), holds (what changes during each silence).
- **Research the agent can consult**: gaze reaches a named object about 200 to 400 ms after its word starts (Allopenna et al. 1998); visuals may lead their sound but should not trail it (Ginns 2006). The agent decides the lead for this audience and this moment.

### 4.7 Direction as reasoning
- **Decided by**: the director agent, with the designer.
- **Abilities**: hold, withhold, ask with a placeholder, reveal with anticipation, demonstrate (a flow, a fall, a computed process) at a chosen speed, replay, recap by pulling back.
- **Reasoning, not recipes**: the agent keeps a model of the viewer (what has been shown, what is withheld, which processes have been seen) and decides. Examples the prototype exposed: a demonstration is never cut short by the next moment; revealed words wait for the landing they describe; an apparatus stays whole while any of its parts is on screen. In the build these are things the director reasons about, not switches.
- **Instruments**: the follow test (what is the viewer waiting for), the learner quiz, holds, reveal.

### 4.8 Eye guidance and load
- **Decided by**: the designer, with goals that may be "one focal point", "two things compared", "no focal point", or "the threat stays hidden".
- **Instruments**: salience share, eye path, change load, viewer panels.

### 4.9 Sound cues
- An interface to wave 6: an ability to tie a sound to a change (a drop lands, a ball hits the floor, a bar fills). The designer agent proposes cues; the sound stage decides the sound.

### 4.10 Readability and design quality
- Readability for a distracted phone viewer and quality for a demanding designer are viewer panels and instruments, used by agents to judge their own candidates, at settings the director chose for this audience and platform.

## 5. Research grounding (knowledge for agents, not rules)

Kept as a library the agents consult when they reason. Several effect sizes were confirmed only through secondary sources; they are directions, not numbers to quote externally.

**Attention**: motion onset captures attention, ongoing motion does not (Abrams and Christ 2003); saliency predicts where eyes land and in video motion dominates for about a second after a cut (Itti and Koch 2000; Carmi and Itti 2006; Smith and Mital 2013); signaling helps learning by about d = 0.4 to 0.5 when the cue points at what is needed next (Schneider et al. 2018; Alpizar et al. 2020; de Koning et al. 2009).

**Load**: visual working memory holds about 3 to 4 objects (Luck and Vogel 1997); changes during a cut or a move are missed (Rensink, O'Regan and Clark 1997); decoration that does not carry the idea costs learning (Rey 2012).

**Timing to the voice**: Allopenna, Magnuson and Tanenhaus 1998; Baggett 1984; Ginns 2006 (contiguity, d about 0.85); verbatim on-screen text plus the same narration hurts, short labels help (Adesope and Nesbit 2012; Yue, Bjork and Bjork 2013); reading speed for timed text (Szarkowska and Gerber-Moron 2018).

**Animation and pacing**: animation helps when the change shown is the change in the concept and is slow enough to perceive (Tversky, Morrison and Betrancourt 2002; Hoffler and Leutner 2007); segmenting helps (Rey et al. 2019); event boundaries flush working memory (Zacks et al. 2010; Swallow, Zacks and Abrams 2009); prequestions help for what is asked (St. Hilaire, Chan and Ahn 2023); guidance that helps newcomers hurts experts (Kalyuga et al. 2003).

**Craft**: Manim CE docs (Transform, TransformMatchingTex, rate functions); Material Design 3 motion tokens; NN/g "Animation duration"; Apple WWDC18 "Designing Fluid Interfaces"; Willenskomer's UX in Motion; Kurzgesagt process material; TikTok creative best practices and platform safe zones; the Netflix timed text style guide.

**Generated layout and camera**: Cassowary (Badros, Borning and Stuckey 2001; kiwi.js); GRIDS (Dayama et al., CHI 2020); O'Donovan, Agarwala and Hertzmann 2014 and DesignScape (CHI 2015); Ngo, Teo and Byrne 2000 (aesthetic measures); Bylinskii et al. 2017 and Fosco et al. 2020 (UMSI importance); LayoutGAN, LayoutDM, LayoutGPT and LayoutPrompter (learned generators: stochastic, slow, unaware of argument and emphasis, useful as candidate generators at most); Christie, Olivier and Normand 2008; Lino and Christie 2015; Galvane et al. 2015; Gleicher and Liu 2008; Lee, Forlizzi and Hudson 2002 (kinetic typography engine); Heer and Robertson 2007; Paul Lewis's FLIP.

## 6. Overrides: strong authors lose nothing

Precedence, from strongest:
1. Any explicit line of today's language in a moment (a `row`, a `camera`, a `set`, `enter=`, a size). It is a pinned constraint; agents compose the rest around it and report conflicts.
2. The author's intent lines.
3. Agents' proposals (relations they infer, demonstrations they add), written to the notes with a reason, and refused with `plain`.
4. Style suggestions.

Users can override any decision from the platform (wave 8's chat-to-edit) in the same way.

## 7. Migration from today's language

Kept: the core (`compile`, `evaluate`, primitives, roles, styles), kits and truth engines, the parser, holds, withholds, the follow camera, the bench.

Steps:
1. Moment blocks (`@N` with intent lines and object verbs) parse inside today's scene files. The scene step's prompt becomes the short intent guide plus the parts of the old guide that cover kits, pictures and programs.
2. Abilities that exist only in the prototype (depict, redraw material, apparatus, falls, flows, readings) move into `engine/design/` as engine abilities with no defaults.
3. Instruments are collected behind one interface (salience, legibility, load, eye path, visibility, timing, fill and balance), starting from `bench/lib/measure.ts`, the build's layout checks and the look step.
4. The designer agent and its search loop replace the prototype's fixed composer, one area at a time (composition first, then motion, camera, timing).
5. The old craft paragraphs in `prompts/engine-language.md` shrink as agents take those decisions.

Changes to `engine/core/types.ts`: likely none; perhaps a `Scene.decisions` list (each decision, its goal, its measurements) for review, which the contract requires to go to review.

## 8. The prototype

### 8.1 What was built

- `scripts/design-brain/compose.ts`: a composer that turns an intent plan into a compiled scene from primitives and roles. It is a probe for abilities, not the proposed architecture: it decides with fixed rules where the design brain will decide with agents (section 8.4).
- `scripts/design-brain/depict.ts`: drawn props with stateful parts (vessels with a liquid level and color, a burette with a scale that can be read, balls at their true relative sizes, a clock with a hand) and a card for anything unknown.
- Abilities the prototype adds: object verbs (`drips into`, `turns`, `flashes`, `swirls`, `falls`, `fills`, `reads`, `runs`); apparatus (a source composed over the vessel it drips into); falling together with a trail and a level line; a reading taken off the drawn scale, which the drops really emptied; a chart with data redrawn on its own bars, in either orientation, with levels, values and the chart's own words; compared quantities as columns on one scale; a stage that stays put while words take turns.
- `scripts/design-brain/bench-setup.ts`: turns a bench run into the composer's input, with the slide read by hand into parts and data.
- `bench/lib/steps.ts`: the bench now scores a compiled scene from another composer (`composed.scene.json`) as it is.
- Earlier probes (personal finance, a printing history short, a charger ad, a founder's signup chart) remain in `projects/design-brain/` with their notes.

### 8.2 The test

Three bench cases chosen to exercise many areas at once:
- **titration-lab** (from a lab handout, chalkboard): depiction, a demonstration fast then slow, a color change that flashes then persists, a timed hold, a reading.
- **support-tickets** (the user's meeting slide, flat): the user's material as first-class, redraw versus real, a predict hold, a settle hold, the takeaway.
- **ball-drop** (predict then reveal, chalkboard): a dare, a predict hold, a demonstration that must truly happen, a reason.

For each, a fresh Claude Haiku agent wrote the intent plan from the bench's own request (the same direction plan the baseline author got, with the language rules taken out), reading only the intent guide. The composer built it; the bench rendered, measured and watched it exactly as it did the baseline (Sonnet as designer, learner, follow viewer and grader; Haiku as scroller; the words-only answers reused, since the narration is the same). No repair rounds, no Meta calls.

### 8.3 Results

Where to look: `projects/design-brain/bench-compare/<case>.jpg` (top row today, bottom row the prototype, one frame a second) and `<case>.mp4` (side by side, today on the left). Full numbers in `bench/results/2026-11-03-design-brain/scores.md` against `bench/results/2026-11-03-baseline/scores.md`.

| case | free (today, proto) | designer /10 | scroll kept | scroll remembers | confused | follow on look | quiz (video) |
|---|---|---|---|---|---|---|---|
| titration-lab | 0.88, 0.72 | 3, 5 | 0.54, 1.00 | 0.5, 1.0 | 1.00, 0.54 | 0.81, 0.85 | 1.00, 1.00 |
| support-tickets | 0.74, 0.82 | 5, 4 | 0.89, 0.54 | 1.0, 1.0 | 0.44, 0.22 | 0.89, 1.00 | 1.00, 1.00 |
| ball-drop | 0.61, 0.69 | 3, 3 | 0.33, 0.08 | 0.0, 1.0 | 1.00, 0.67 | 0.79, 0.83 | 0.88, 1.00 |

My judgment, as a demanding designer and as a distracted viewer:
- **Titration is the clearest win, and it is depiction plus direction, not layout.** The burette drips into a flask of liquid; pink blooms where drops land and fades; the stream slows to single drops that hang at the tip and fall; the flask settles to a pale pink while a stopwatch runs; the camera closes in on the burette and the reading (18.32 mL, read off the scale the drops emptied) stands beside the meniscus. The scroller watched to the end and retold the procedure with the reading; the designer moved from 3 to 5. Its free score fell (0.88 to 0.72) mainly because the load instrument counts each drop as a new thing and the eye instrument sees the drops and the flask's bloom as competing; I read those as instrument settings to revisit, not as faults of the clip. Real faults the designer found: the opening question "When do you stop?" floats over a still apparatus for 6 s, the bloom drifts past the flask's edge once, the jump to the reading is abrupt, the stopwatch is small.
- **Support-tickets is mixed.** The user's slide shows as it is, then its bars are redrawn on top and move into a taller chart; the total becomes the subject, then each bar lights in turn with its value; the follow viewer was on the plan's look every time and was confused less (0.44 to 0.22). But the designer scored it lower (5 to 4) and the scroller left at sheet 8: the original appears small in a large empty frame, the chart fills only the top half, "half the queue" is a pale label with an arrow rather than a shown half, and the end holds on a static chart. The baseline author ignored the slide and drew four boxes; that was simpler and looked cleaner.
- **Ball-drop shows the limits of fixed rules.** The balls are drawn at their true relative sizes, hang at one height through the question, fall together with a dashed line joining their bottoms and faint marks where they passed, and the words "They land together" wait for the landing. Learners got every question and the scroller's retelling carried the point (0 to 1). But the scroller left after 2 s of two still balls, the designer saw the slow fall as "drifting" with no visible floor, and the balls sit high and left in an empty frame. A director agent would have reasoned that a 1 m drop takes under half a second, shown it at real speed and then replayed it slowly; my composer applied "slow when it is a reveal".
- **Common to all three**: the frames are better directed than they are composed. Fixed sizes and positions left large empty areas; captions (the bench's own) dominate the bottom. Composition by search against agent goals (section 4.1) is the work this prototype does not do.
- **The author's burden fell**: each Haiku plan was usable as written, in one pass, from a 5.3 KB guide. Haiku used objects and verbs readily (burette, flask, timer; two balls that fall) but also wrote things the language does not have (`withhold ... until=@19`), an ask with no reveal, and `turns "pink"` before `turns "faint pink"`, which a chemistry teacher would correct. Agents must check plans against the material (the handout says faint pink), not only render them.

### 8.4 Ledger: every decision the prototype makes, and where it goes

Everything below is a fixed value or rule in the prototype. None of it is proposed as engine behavior. Each becomes a goal an agent writes, an instrument setting it chooses, or a style suggestion.

| Prototype decision (fixed) | Template-like? | Moves to |
|---|---|---|
| Subject placed near 47% of the usable height; stage top at 13% | yes | composition search against the agent's balance, fill and salience goals |
| Bottom 22% kept clear | yes | a platform property (UI zones) read from the target, measured by the visible instrument |
| Apparatus heights 42% and 37% of the usable height; balls 40% of the width; chart 68% | yes | composition search; the designer picks scale from what must be seen (a meniscus, a bloom) at the viewing size |
| One subject per moment, others dimmed to 0.72 or 0.22 | yes | the designer's goal per moment (one focus, two, none, hidden); dim treatment is a style suggestion |
| Type sizes capped at 24% of the width, floor 4.5% of the width | yes | legibility instrument at the chosen viewing size; the style's scale as suggestion |
| Change starts 0.3 s before its word; dwell 1.0 to 1.5 s; merge when closer | yes | timing instrument plus the director's tempo; the agent decides lead and dwell per audience |
| Same-unit quantities compared on one scale automatically | yes | a proposal the designer may make when the intent supports it, with its reason |
| Words that name a quantity on a chart become a level line | partly | an ability (draw a level on a redrawn chart); the designer decides when it helps |
| A word shown while one chart part is held gets a pointer | yes | a proposal, checked with the eye path instrument |
| A flow stops before a "turns"; slow flows drip every 0.7 s; fast streams at 2.6 mL/s | yes | the director's demonstration plan (how many drops, how fast, where it rests); physics and the material (the handout's volumes) as constraints |
| A reveal with a fall waits for the landing; a demonstration is never cut short | partly | director reasoning; good examples for the agent, not rules |
| A fall lasts 1.8 s when revealed | yes | the director decides real speed, slow motion, replay |
| An apparatus stays whole while any part is on screen | partly | director reasoning (physical continuity), overridable |
| Color words to colors; "faint" means paler | partly | the material reader and the style (the handout and the indicator define the color) |
| A redrawn chart shows the original first for 0.7 to 2 s | yes | the designer's real-or-redrawn decision for this piece and purpose |
| Think line under a question (turned off after the eye instrument flagged it) | yes | an ability the designer may use |
| Stress pushes the camera to 1.05; long still moments drift to 1.02 | yes | camera candidates measured against hold activity and the agent's goal for the moment |
| A burette's scale numbers appear only when it is read | partly | legibility instrument (numbers below the viewing size are hidden or enlarged by the agent) |

## 9. Workstreams

Wave 4 is size 100 on the roadmap. Share is each workstream's part of the wave (1 to 100, summing to 100); "now" is its progress counting existing engine work and this prototype. Weighted total: about 25%.

| # | Workstream | Share | Now | Subagents | Depends on |
|---|---|---|---|---|---|
| A | Abilities: engine verbs with no opinions, moved out of the prototype into `engine/design/` (stage, apparatus, flows, falls, readings, redraw material, morph by identity, born from, compare columns, levels) | 16 | 35% | 1 builder for motion abilities, 1 for material redraw | none |
| B | Depiction: the four tiers behind one interface (drawn props, generated sprites cut with SAM, the user's images with parts, real pictures with parts); states and verbs; a growing prop library by kind of thing, never by topic | 14 | 12% | 1 builder for drawn props and states, 1 for sprites and SAM parts (with wave 5's picture hunter) | A |
| C | Instruments: salience map, legibility at a viewing size, change load, eye path, visible and hidden, timing against voice, fill and balance, steadiness; one interface, settings chosen by agents | 14 | 30% | 1 builder, 1 researcher for the eye path and salience models | none |
| D | Intent, goals and requirements: the director and designer agents writing goals and instrument settings per video and moment from intent, audience, platform, purpose and the material's requirements | 12 | 15% | 1 prompt and agent builder, 3 Haiku authors as testers | C |
| E | Search and look loop: candidate generators (constraint solver, camera planner, transition orders), rendering keyframes and motion samples, viewer panels, revise, budgets | 14 | 10% | 1 builder for generators, 1 for the loop and budgets | A, C, D |
| F | Direction reasoning: holds that work, predict then reveal, demonstrations that truly happen at the right speed, replays, recaps, slow first then faster, from the viewer model | 8 | 40% | 1 builder with the director prompt | D, E |
| G | Material: reader agents into parts, data and text; requirements across files; real or redrawn; shared with wave 5's cards | 8 | 20% | 1 builder (with the wave 5 lead) | none |
| H | Styles as suggestions: every style value marked as a suggestion with an override path; per-style dim, panel and motion treatments | 4 | 60% | the style owner | A |
| I | Author interface and overrides: the intent language inside scene files, the short guide, precedence, notes, strong-author paths | 5 | 45% | 1 builder | A |
| K | Proof: bench runs per milestone as instruments, new bench cases for new kinds (material, depiction, TV and 16:9 outputs, purposes where the subject should hide), user review at milestones, Spark confirmation | 5 | 20% | the lead, with the bench owner | all |

Order:
- A, C and G start at once (they need nothing).
- B with A. D once C has a first interface.
- E after A, C and D have first versions; F alongside E.
- H and I in parallel throughout. K at every milestone.
- Every merge to main follows a bench run, read as instruments, with the user watching a few clips.

## 10. How each workstream is scored on the bench

The bench (wave 3: 28 cases of 15 to 40 s, Haiku as author, free measures plus learner, words-only, follow, designer and scroller tests) is used as a set of instruments, never as a target to optimize blindly. Each workstream names what it expects to move and checks that nothing else gets worse; disagreements between instruments and viewers are read, not averaged away (as with the drop count in load).

| Workstream | Expected to move | Watched for harm |
|---|---|---|
| A, B | picture questions in the quiz, follow on look, designer motion and composition, scroller kept | load, read |
| C | the agreement between instruments and viewer panels (instruments that disagree with every viewer are recalibrated) | none (it changes no clip) |
| D | follow "waiting", quiz on what was intended, requirement checks on material cases | any measure on cases with no material |
| E | designer overall, scroller kept, read, fill and balance (as reported) | lag, holds |
| F | holds, reveal, pace, follow "waiting", scroller kept through holds | lag |
| G | material cases: quiz, designer, requirement checks | none |
| H | designer consistency per style | read |
| I | author effort (rounds, guide size), first-pass usable plans | none |
| K | the user's verdict at milestones | none |

The bench needs more cases for this wave: outputs other than a phone (16:9, a TV lesson), purposes where the goal is not a focal point (an ambient piece, a horror beat), more cases from supplied material, and cases with requirements across files.

## 11. Risks

- **Agents cost time and money.** A search loop per moment multiplies calls. Mitigations: budgets set by the director per moment, cheap instruments first, viewer panels only on finalists, caching across similar moments, Spark only where it matters (wave 9).
- **Instruments that are wrong teach agents wrong things.** The load instrument's drop count is an example. Mitigations: instruments report raw values and pictures, agents see them with the frames, and every instrument is checked against viewer panels on the bench.
- **Sameness.** One designer agent could make every video alike. Mitigations: goals come from the purpose and audience, styles carry real differences, and the bench grows cases that need different goals.
- **Plans that are wrong about the world** ("turns pink" before "faint pink"). Mitigations: agents check plans against the material and the research cards (wave 5 grounding).
- **Depiction becoming a library of special cases.** Mitigations: props are kinds of things with general parts and states; the long tail comes from sprites with SAM parts and real pictures, not from more hand-drawn props.
- **Fighting explicit authors.** Explicit lines are pinned constraints; conflicts are reported.
- **Scope overlap with wave 5** (material reading, pictures). The interface is the part card and the depiction tier; the leads share the readers.

## 12. Open questions for the user

1. **Budget per video for search and look**: how many agent calls per moment is acceptable, and should the director spend unevenly (more on the moments that carry the video)?
2. **Real or redrawn by default** when the user's chart comes with data: the prototype showed the original, then redrew it; the designer viewer found the original too small to read. Should the agent decide per piece, with the original always reachable?
3. **Who checks the plan against the world**: should the designer agent correct the author's science (pink before faint pink) silently, or note it for the user?
4. **Captions**: the bench draws its own captions at the bottom; in the product, are captions the design brain's decision per platform (they compete with the frame for space and attention)?
5. **Depiction tiers**: is a generated sprite cut with SAM acceptable for things the drawn props do not cover, given its cost per object, or should the first build favor drawn props and real pictures?
6. **Milestone review**: which clips do you want to watch at each milestone, beyond the bench's?
