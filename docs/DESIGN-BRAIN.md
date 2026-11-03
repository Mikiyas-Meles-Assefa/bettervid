# The design brain (wave 4 proposal, Nov 3)

Status: proposal for the user to approve. No engine code has changed. The prototype lives in `scripts/design-brain/` and its renders in `projects/design-brain/` (not committed).

## In one paragraph

Today Spark places every thing by hand: it picks sizes, arrangements, entrances, light, dim, camera and timing in a 40 KB language. A weak author makes weak frames, and checks can only reject them. The design brain moves those decisions into the engine. The author says, moment by moment, what matters: the subject, what supports it, what is withheld, what changes, what is asked, what is the payoff, and the pace and feel. The engine then composes the frame and its motion the way a good motion designer would, with general algorithms (a type scale, a constraint and cost layout solver, identity-preserving transitions, a camera planner, timing rules from the attention and learning research), never with recipes per kind of video. Today's language stays as the override layer: anything an author writes explicitly wins, so a strong author loses nothing. The prototype shows that the typographic and timing half already works from a 3.4 KB guide; it also shows the hard half honestly: a weak author does not express relations (comparisons, counts, causes), so the engine must also infer what can be shown, not only lay out what it is told. Most videos will be made from people's own material (files, slides, screenshots, photos, charts, data, code), so that material is a first-class thing the engine understands into named parts and composes with (4.8). Every clip is judged by a demanding designer and by a distracted viewer glancing at a phone (4.9).

## 1. What is wrong now, and why checks cannot fix it

From the wave 2 sheets (`projects/merge-w2/watch10/sheet.jpg`, `projects/stats-w2/watch7/sheet.jpg`) and the three Haiku baselines in this prototype:

- **Small, high, sparse.** Most frames hold a few lines of body text at 3 to 6% of the width in the top third; the bottom half is empty. The build already notes "fills only 16% of the frame" on every Haiku baseline, and the Haiku author passed the check on the first round and left all of them.
- **Text as narration.** Baselines put the spoken sentence on screen in pieces ("of its power as heat", "needed about a year", "to copy a single Bible"). The redundancy research says this costs learning (section 3).
- **Everything competes.** Titles, headings, step labels, captions and kit labels share the frame at similar sizes, so there is no clear subject and no hierarchy.
- **Motion does not lead the eye.** Things arrive on the word or after it, several at once; nothing is staged.
- **Repair loops do not converge.** A check can say "empty" or "crowded", but the author who must fix it is the same author who made it, and a fix to one fault makes another.

The common cause: composition is the author's job, and the author is the weakest link. Spark scores about 13% on ProgramBench against 65% for Opus; the scene language is closer to programming than to writing.

## 2. The split: what the author says, what the engine decides

| The author says (meaning) | The engine decides (form) |
|---|---|
| The things that exist, by meaning: words, values, counts, computed things (kits), programs, and the user's own material by name and named part (`chart.jump`) | How each is drawn: type role and size, a mark grid, a bar, the real picture or a redrawn one, its crop and zoom |
| Per moment: the one subject (`show`) | Where it sits, how big, what lights it, what dims |
| What supports it (`keep`) and what leaves (anything not named) | Arrangement, order, steady places, exits |
| Relations: `compare`, `A -> B`, `A from B`, `A becomes X` | Side by side or stacked, magnitude on a shared scale, arrows, birth from a source, morph in place |
| Direction: `ask`, `reveal`, `wrong`, `withhold`, holds | Placeholders, think time, anticipation, payoff motion, strike-through |
| Weight and tempo: `stress`, `pace`, `feel`, `for` | Size step, camera push, durations, easing, how much dims, how much is labeled |
| Nothing about position, size, color, easing or frames | Everything about position, size, color, easing and frames |

The intent vocabulary is deliberately small (about a dozen words, `scripts/design-brain/intent-prompt.md`) and is about the viewer, not the screen. It holds for any use: a lesson, an ad, a history, a simulation all have a subject, support, change, a question and a payoff at each moment. Nothing in it names a kind of video.

## 3. What the research says the engine should do

Three research passes (sources at the end). Kept as knowledge the algorithms reason with, not as a menu.

**Attention.**
- Motion onset captures attention; ongoing motion does not (Abrams and Christ 2003).
  - So onsets are a budget: one onset for the subject per moment, and nothing else starts while it does.
- Saliency predicts where eyes land, and in video, motion and flicker dominate for about a second after a cut (Itti and Koch; Carmi and Itti 2006; Smith and Mital 2013).
  - So the subject must be the saliency peak of the frame, or the frame is wrong regardless of what the author meant.
- Signaling helps learning by about d = 0.4 to 0.5 (Schneider et al. 2018; Alpizar et al. 2020), but only when the cue points at what the viewer needs next (de Koning et al. 2009).
  - Dimming the rest to about 30 to 50% contrast works about as well as cueing the target (anti-cueing), and keeps context.

**Load.**
- Visual working memory holds about 3 to 4 objects (Luck and Vogel 1997).
  - So at most about four things new or changing in one view; build dense things up in steps.
- Changes made during a cut, a camera move or another motion are missed (change blindness, Rensink et al. 1997).
  - So nothing important changes while the camera moves.
- Decoration that does not carry the idea costs learning (seductive details, Rey 2012; coherence).

**Timing to the voice.**
- Gaze reaches a named object about 200 to 400 ms after its word starts (Allopenna et al. 1998).
  - So a visual cue should start 200 to 500 ms before the word, and hold at least 1 s after it.
- A visual may lead its sound but should not trail it (Baggett 1984; Ginns 2006, contiguity d about 0.85).
- Verbatim on-screen text plus the same narration hurts; short labels and key terms help (Adesope and Nesbit 2012; Yue, Bjork and Bjork 2013).
  - So the engine never captions the voice inside the picture.
- Reading budget: about 0.3 s a word plus 1 s, never under 1.5 s for a label, at 12 to 15 characters a second (Szarkowska and Gerber-Moron 2018).

**Animation and pacing.**
- Animation helps only when the change shown is the change in the concept, and slow and simple enough to perceive (Tversky, Morrison and Betrancourt 2002; Hoffler and Leutner 2007, d about 0.37).
  - So motion must mean something; a still frame is the default.
- Segmenting with system-placed pauses helps (Rey et al. 2019).
- Event boundaries flush working memory (Zacks et al. 2010; Swallow et al. 2009).
  - So mark idea boundaries visibly, with a settle hold and a change of layout, and keep the takeaway on screen at the boundary.
- Prequestions help for exactly what is asked, by about g = 0.54, and do nothing for the rest (St. Hilaire et al. 2023).
  - So predict-then-reveal must target the very next reveal, with 2 to 4 s to think.
- Guidance that helps newcomers hurts experts (expertise reversal, Kalyuga et al. 2003).
  - So `for new|familiar` is a dial on cueing, labeling, build speed and holds.

**Craft** (Manim and 3Blue1Brown docs, Material 3 motion tokens, NN/g, Apple WWDC18 fluid interfaces, Willenskomer's UX in Motion, Kurzgesagt and Branch process material, TikTok and YouTube safe zones, Netflix timed-text guide).
- **Identity is everything.** A concept that persists never cuts; it transforms in place (Manim `Transform`, `TransformMatchingTex`, Keynote Magic Move, shared-element transitions). A new thing is born from the thing in focus (cloning).
- **Staging.** One idea per frame, read where the eye already is. Exits, then moves, then entrances (Heer and Robertson 2007, who also found that staged transitions help perception and that rescaling hurts it).
- **Easing by role.** Moves within the screen use a standard curve. Things entering decelerate and things leaving accelerate, and exits are about 0.7 times as long as entrances. Duration grows with distance and area: about 250 to 400 ms for a pop, 0.4 to 0.7 s for an entrance, 0.8 to 1.5 s for a meaningful morph, 1 to 2.5 s for a camera move. Springs bounce only when the motion carries momentum.
- **Hierarchy.** Use one dominant element at least 2 times larger than the rest, one accent color for "now", and two to three sizes per frame. Video type is larger than print: a minimum of about 44 to 48 px on a 1080 px wide frame, captions at 64 to 80, and a hero word or number at 160 to 320. Scale ratio 1.5 to 1.618.
- **The vertical frame.** Center-stacked, single column. The subject's focal point sits near the upper third to the middle. Keep the bottom 25 to 35% and the right rail clear of anything critical, because of phone and platform UI. Comparisons stack or alternate.
- **Camera.** A few intentional moves, each a static hold or one eased move, never continuous tracking (Gleicher and Liu, Re-Cinematography). Push into a part to change scale level (Kurzgesagt, Branch). Use parallax for depth.

**How generated layout works** (O'Donovan, Agarwala and Hertzmann 2014; DesignScape 2015; Cassowary; GRIDS (CHI 2020); Ngo et al.'s aesthetic measures; UMSI importance prediction; Lino and Christie's toric camera space; Galvane et al.'s continuity editing by dynamic programming).
- Learned generators (LayoutGAN, LayoutDM, LayoutGPT and LayoutPrompter) are stochastic and slow. They misalign, and they know element categories but not argument or emphasis.
- Industry tools (PowerPoint Designer, Canva Magic Design) retrieve and rank human templates.
- What fits a deterministic engine that must be fast is a pipeline:
  1. Roles become tokens on a scale.
  2. Enumerate a few structural candidates.
  3. Solve metrics with a linear constraint solver.
  4. Score with an energy of design terms.
  5. Plan the camera in coordinates where framing holds by construction.
  6. Diff transitions by identity.
  7. Verify the result.

## 4. How the engine decides

Six stages run per section, in this order. Each is a pure function of the plan, the words and the style, so the same input gives the same video.

### 4.1 Completing the intent: what can be shown

The prototype's most important finding: the Haiku author used `show` and `keep` and almost nothing else. Across the three plans:
- It wrote 0 `compare`, 0 `many`, 0 `->` and 0 `from`.
- In the press piece, "a year for one Bible" against "sixty a year from one shop" is the whole idea. The author still wrote it as eleven word cards in a row.
- When the relations were added by hand (`projects/design-brain/press/rich-sheet.jpg`), the frames finally carried the comparison.

So the engine must propose relations and forms itself, from the plan's things and the words. This is cheap and general:
- **Quantities.** Values with the same unit or kind (both books, both durations, both money) that are on screen together, or come one after the other, are compared on one shared scale. A quantity that changes is a `becomes`. A small count of countable things is a `many`.
- **Order and cause.** Things named in an order the words mark as order or cause ("then", "so", "because", "turns into") are a chain or an arrow.
- **Correction.** A thing the words contradict ("not ninety", "most people guess") is `wrong`.
- **A question in the narration** followed by its answer is an `ask` and `reveal` pair, with think time requested from the voice as a hold, using wave 2's hold mechanism.
- **Computed things.** A process a kit can compute is offered as that kit, and a thing that names a real object asks the pictures stage. This is wave 5's job, but the request starts here.

Each inferred relation is a proposal with a reason, written into the build notes. The author's explicit lines always win, and `plain` on a moment turns inference off.

Where words alone are ambiguous, one narrow Spark call per section answers multiple-choice questions ("is X compared with Y here? yes/no"). Classification is a task a weak model does well, unlike placement. Meta stays the model doing the thinking; the engine does the arithmetic.

### 4.2 Composition: a solver, not templates

1. **Roles to tokens.**
   - Each visible thing gets a role for the moment: subject, support, question, label, wrong or payoff.
   - Roles map to steps on the style's type scale, which `engine/style/design.ts` already has (`scale.base`, `scale.ratio`).
   - The subject is fitted: as large as the region allows, capped and floored by the style.
   - Support is about two scale steps down.
   - Emphasis (`stress`, a reveal) is one step up. "More important" is always a discrete step, so no frame gets an arbitrary size.
2. **Candidates.** From the relations and the count of visible things, enumerate a small fixed set of structures (typically 2 to 6):
   - a single column with the subject at the optical center;
   - the subject with satellites above and below;
   - a split for a comparison, side by side or stacked;
   - a chain down the frame;
   - a full-bleed picture with a caption band;
   - a kit in its portrait form, as the existing `form=` does;
   - a subject plus an inset of the whole.

   These are structures, not video types: any topic produces them from its relations.
3. **Metrics by constraints.** Solve each candidate with Cassowary (kiwi.js, about 20 KB, incremental). Constraints come in three strengths:
   - **Required:** safe area including the platform UI zone, no overlap within the branch, the readable floor.
   - **Strong:** alignment to a 4 or 8 px grid, scale steps, and a shared scale for compared quantities.
   - **Weak:** subject centering, preferred gaps.

   Required constraints that cannot all hold are reported as one plain problem, never silently squeezed.
4. **Score.** An energy over the solved candidate:
   - the subject's share of predicted saliency (area times contrast, plus onset);
   - fill of the usable area, including room the stretch keeps for later things;
   - balance and equilibrium (Ngo);
   - steadiness: distance moved by things that stay, compared with the previous moment;
   - reading order;
   - the number of type sizes;
   - the number of things that change in this moment, against the budget of about four.

   Pick the lowest. Weights are fixed and hand-set first, then fitted from the bench (section 7), in the spirit of O'Donovan et al.'s inverse optimization.
5. **Stretch steadiness.** The current `layout(items, env, cap, stretch)` union over a stretch is kept: it already makes things that stay keep their box. The solver becomes the place where that union is decided.

### 4.3 Motion and transitions: by identity

- **Diff by identity.** Every thing has an id that lives across moments. Each change between moments is classified as one of: stays, moves, changes size, changes content, born from a source, leaves, enters. This is FLIP: layout is computed per moment, and motion is the interpolation.
- **Staging order.** Exits, then moves and resizes, then entrances (Heer and Robertson). The subject's own change is the last onset and lands on its word. Other entrances are staggered 3 to 5 frames apart, and the whole group is capped near 1.5 times a single entrance.
- **Morph kinds**, chosen by what changed:
  - text that changes keeps its matched parts and moves only what differs (atoms and math already have parts; `TransformMatchingTex` is the model);
  - a number counts or rolls;
  - shapes morph, using the existing `matchShapes`;
  - a count adds or removes marks one by one;
  - a thing born from another grows out of it;
  - a wrong thing is struck through and steps back, and stays.

  Unrelated things never morph into each other, because that implies a false relation.
- **Durations and easings** come from distance, area and role, scaled by the style's `motion.feel` and the moment's `pace`. Within those bands, the style decides how motion feels: neon can be snappier and chalk calmer.
- **Across sections.** A thing that is in the last frame of one section and the first of the next is matched by identity, giving a match cut or a morph. Wave 2's handed-over objects already carry ids.

### 4.4 Camera and depth

- **Plan the whole section at once.** The camera is planned by dynamic programming over moments (Galvane et al.). Each moment chooses one of four camera states: rest, frame the subject, frame a part of it, or pull back to the whole. The cost adds:
  - framing error, from the subject's box against its target fill;
  - change cost, with no move during an important content change;
  - rhythm, so moves do not come too close together.
- **Moves.** Each move is a static hold or one eased move.
- **Framing.** Targets are screen-space boxes, solved in closed form for pan and zoom (the toric-space lesson: pick coordinates in which the framing rule is exact).
- **What exists today.** `follow.ts` (the camera follows computed work) becomes one case of this planner.
- **Moves with meaning.** A push in to change scale level, or a pull back for a recap. `stress` gives a slow push. A long still moment gets a 1 to 2% drift.
- **Depth.** Pictures and layered drawings get 2 to 3 depth layers with parallax during camera moves, using the existing `layer` and `z`.

### 4.5 Timing to the voice

- **Cue lead.** A change starts about 0.3 s before its word (the 200 to 500 ms band).
- **Minimum dwell.** At least 1.0 s per moment; 1.4 s for a reveal, an ask or a stress; scaled by pace and audience.
- **Moments too close together.** The engine first lets the visual trail by up to 0.5 s. If that is not enough, it merges the short moment's subject into the next as support. It never lets the visual run more than 0.5 s behind its word.
- **Read budget.** Labels must stay up for their reading time, or they are cut to key words, with a note.
- **Onset budget.** At most one subject onset per 0.5 to 1 s.
- **Holds.** Wave 2 holds are honored, and the engine checks that each has a job: a step plays, a question waits, or the takeaway settles.

### 4.6 Direction as reasoning

The engine knows the viewer's state as it goes. It tracks what has been shown, what is withheld, and which processes have already been demonstrated. From that it acts:
- **Slow first.** The first play of a process is slow. A process played again is faster unless the author says otherwise. This is wave 2's `pace`, applied automatically from the history.
- **Ask and reveal.** An ask creates a placeholder in the reveal's future place and freezes everything else. The reveal has anticipation, then the payoff, then a settle hold.
- **Boundaries.** An idea boundary gets a settle hold and a visible change of layout, and the takeaway stays on screen at the boundary.
- **Recaps.** A recap pulls back to the whole.
- **Audience.** `for new` adds labels and slows builds; `for familiar` removes them.

None of this is keyed to a kind of video. It is a model of attention and memory applied to whatever the plan contains.

### 4.7 Checking its own frames, and repairing them itself

After the build, a cheap analytic saliency estimate on sampled frames (size times contrast times onset, plus a center bias) checks that the subject is the peak, and that no more than four things change in a window. When either fails, the engine repairs its own decision: it dims more, moves the camera, steps the subject up, or splits the moment. It never sends the problem back to the author. This is what makes loops converge: the party that made the frame is the party with the algorithm to fix it. A learned importance model (UMSI) can confirm this later, on keyframes only.

### 4.8 The user's own material is first-class

Most videos will be made from what people bring: project files, documents, notes, slides, screenshots, photos, diagrams, charts, data, code. The video must beat what a human team would make from the same material. So material is not decoration placed by an author; it is a thing the design brain understands and composes with, as deeply as anything it draws itself.

- **Understand material once, on arrival.** Each file becomes an addressable thing with named parts, using the existing pieces (the annotate stage's vision pass, SAM cutouts, real font measuring) and new readers:
  - **Photos and pictures:** regions named by what they show (the vision pass boxes them).
  - **Screenshots and slides:** text blocks and controls (OCR plus a vision pass), titles, bullets and figures.
  - **Charts:** the chart type, axes, series and marks. When the data itself is present (a CSV, a spreadsheet, a table in a document) the numbers are read; otherwise the chart is digitized.
  - **Code and documents:** the real text, lines and quotes addressable.

  The author then says `show chart.jump` or `keep screen.button`, never coordinates.
- **Show it real, or redraw it.** Evidence stays as it is: a product screenshot, a photo, a signed document, a real chart someone will recognize. Information may be redrawn in the style: data becomes an engine chart whose bars can grow, morph and be compared on a shared scale; code is retypeset with addressable lines; a slide's bullets become things. The engine proposes, the author or user can lock either way, and the original stays one tap away for proof.
- **Compose with it.**
  - A picture that stays across moments is the stage: it keeps its box while its parts take turns as the subject.
  - A small part is brought forward by zooming the picture's content inside its own frame (an animated crop, never past its edges).
  - The rest is dimmed around a hole (anti-cue), and an outline draws on the part.
  - Words go beside the picture, not on it; when there is no room they sit on a caption card on the side away from the subject.
  - Crops choose by the parts that matter, not the center. This is the fix for review problem 8, where the subject was cropped out of the photo.
- **Respect its quality.**
  - A low-resolution screenshot is not zoomed past legibility.
  - Text inside material that would land below the readable floor is zoomed or retyped.
  - Material keeps its own colors unless the style's picture treatment is wanted.
  - A user's brand (colors, fonts, logo in their files) can become a custom style through the existing style writer.
- **Infer from it.** Material carries facts the words may not: the chart's numbers, the slide's order, the document's headings. Completion (4.1) uses them: the founder who says "it jumped" gets the jump measured from the data.

The prototype's fourth moment (`signups`: a team update made from the founder's own exported chart) tests this end to end.

### 4.9 Two judges: a demanding designer and a distracted viewer

Every frame and every clip is judged twice, and the bench carries both.

- **The demanding designer** asks whether a studio would ship it:
  - one clear hierarchy;
  - alignment to a grid;
  - type on a scale, two or three sizes per frame;
  - color used for meaning only;
  - consistent spacing and rhythm;
  - motion with purpose and staging;
  - no orphans, widows, tangents or near-misses at edges;
  - the material shown at its best.

  This judge compares the clip with a human-made reference for the same material where one exists (wave 7 makes this blind).
- **The distracted ordinary viewer** is on a phone with sound off, glancing up for about a second every few seconds, ready to scroll.
  - At random one-second glimpses, the judge asks: does the glance land on the subject, and does the viewer get the point from that glance alone?
  - Is the first second already meaningful?
  - Would the viewer keep watching?

  The design brain's rules serve this viewer most: one big subject, words that are short labels, a payoff that reads at a glance.

## 5. How authors override (strong authors lose nothing)

Precedence, from strongest:
1. Any explicit line in today's language inside a moment (a `row`, a `camera`, a `set`, a `light`, `enter=`, `move=`, `w=`, `h=`, a size word). It wins for that thing in that moment, and the engine composes the rest around it.
2. Explicit intent: `show`, `keep`, relations, `ask`, `reveal`, `pace`.
3. Inferred intent (4.1), always written to the notes with its reason, and turned off with `plain`.
4. The engine's own defaults from the style and the research.

A whole scene can still be written in today's language. The two mix line by line, so the migration never forces a rewrite of what works (truth kits, `do steps`, holds, withholds, programs, pictures, marks).

## 6. Fitting the existing engine (migration, not a rewrite)

Kept as they are:
- **The core:** `compile`, `evaluate`, the four primitives, roles, styles and design tokens.
- **The kits and truth engines.**
- **The language's parser, build checks, withholds, holds and the follow camera.**

The design brain is a new module, `engine/design/`. A moment plan becomes a list of language states (items, light, dim, camera, enter and move settings) with every decision explicit. Today's `build()` then compiles it, so every existing check and capability applies unchanged. Pieces of `layout.ts` (subject growth, stack spreading) move behind the solver one at a time, each measured on the bench.

Order of migration:
1. Moment blocks parse inside today's scene files (`@N` followed by intent lines). The scene step's prompt becomes the short intent guide plus the parts of the old guide that cover kits, pictures and programs.
2. The composer fills in layout, type, motion and timing. The old layout path stays for scenes with no moment lines.
3. Inference, camera planning and self-repair land.
4. Once the bench shows the new path at least as good everywhere, the old craft paragraphs in `prompts/engine-language.md` shrink, because the engine does what they asked the author to do.

Changes to `engine/core/types.ts` are expected to be none or small (perhaps a `Scene.decisions` list for the critic); any change goes to review as the contract requires.

## 7. Workstreams, order, subagents, sizes, and how each is scored

Wave 4 is size 100 on the roadmap and was estimated at about 30% done. The table splits it into ten workstreams. "Share" is each workstream's part of the wave, and "Done now" is its progress, counting the existing engine work and this prototype. The weighted total is about 26%: slightly under the roadmap's figure, because the user's material (J) widens the wave.

| # | Workstream | Share | Done now | Subagents | Depends on |
|---|---|---|---|---|---|
| A | Intent language: parse moments inside scene files, the short author guide, override rules, notes | 8 | 40% (prototype parser and guide) | 1 Sonnet builder, 3 Haiku authors as testers | none |
| B | Intent completion: inferring relations, forms, asks and wrong ideas from words and material; the narrow Spark classifier | 12 | 5% | 1 builder, 1 researcher for word cues across languages | A |
| C | Composition solver: tokens, candidates, kiwi constraints, energy, stretch steadiness, shared scales | 18 | 25% (steady places and subject growth exist; the prototype solved columns) | 1 builder for the solver, 1 for the energy terms and fitting | A |
| D | Type and hierarchy: roles to scale steps, fitting, reading budget, readable floor per style | 7 | 50% (`design.ts` roles and scale exist) | 1 builder with the style owner | C |
| E | Motion and transitions: identity diff, staging, morph kinds, durations and eases by feel, cross-section matching | 13 | 35% (morphs, `keep`, entrances exist; the prototype has staging, born-from, becomes, strike) | 1 builder, 1 for text and math part matching | A, C |
| F | Camera and depth: the DP planner, framing in closed form, parallax layers; `follow.ts` folded in | 8 | 30% (follow camera, camera lines) | 1 builder | C, E |
| G | Timing and direction: cue lead, dwell and merge, onset budget, ask and reveal, slow first from history, boundaries, audience dial | 11 | 45% (wave 2 holds, pace, withhold; prototype dwell and merge) | 1 builder | A, E |
| H | Self-check and repair: analytic saliency, change budget, glance test, the engine fixing its own decisions | 7 | 10% (the look step measures fill and overlap) | 1 builder | C, F, G |
| I | Proof and tuning: bench runs per milestone, the designer and glance judges, Spark confirmation, fitting the energy weights | 6 | 0% | the lead, with the bench owner | all |
| J | The user's material: readers for photos, screenshots, slides, charts, data, code and documents into named parts; real or redrawn; composing pictures as stages | 10 | 15% (annotate stage, SAM cutouts, image crops and marks exist; prototype parts and crop zoom) | 1 builder for the readers, 1 for chart and data redraw | A, C |

Order:
- A first, then C and E in parallel.
- D with C. B in parallel with C, since it needs only A. J's readers in parallel from the start, since they need nothing; its composing follows C.
- G after the first E, then F, then H, then I.

Every merge to main is preceded by a bench run.

Scoring on the wave 3 bench (clips of 15 to 40 s, Haiku as the author, the same clip set each time). The bench needs clips made from supplied material (screenshots, a chart with its data, slides, photos, code) alongside clips from words alone; this proposal asks the bench owner for them. Each workstream owns the measures it should move, and no change may make any other measure worse:

| Measure (bench) | Moved mainly by | Target for the wave |
|---|---|---|
| Eye guidance: share of moments where the subject is the saliency peak | C, D, H | above 90% (estimate today: under 50%) |
| Words-to-picture lag: from a word to the onset of its visual | G | the visual leads by 0.2 to 0.5 s; never trails by more than 0.5 s |
| Pace: slow first and faster later; onsets per second; dwell | G, E | first plays at least 1.5 times slower than repeats; no moment under 1 s |
| Load: things new or changing per 2 s window | C, E, G | at most 4 |
| Holds: each hold has one job, and nothing else moves during it | G | all |
| Fill and size: subject share of the usable area; smallest text | C, D | subject at least 25% of the usable area; no text below the floor |
| Steadiness: things that stay and still moved or resized | C, E | only where the plan changes them |
| Glance test: random 1 s glimpses, sound off; does the glance land on the subject and get the point | C, D, H | above 80% |
| Designer review against a human-made reference from the same material | all, J | preferred or tied in most clips by wave 7 |
| Material: share of moments built on the user's material where its subject part is legible and framed | J, C, F | all; no crop that loses the part |
| First-time learner quiz | all | higher than today on the same clips (the main outcome) |
| Author effort: build rounds; prompt size | A, B | first-round builds; prompt under 10 KB |

## 8. The prototype

**What was built.**
- Three moments, none from the test topics:
  - **interest:** a personal finance short, 24 s.
  - **press:** a history short about who could own a book, 23 s.
  - **charger:** a 17 s ad for a fictional charger.
- Word times are invented, as in `engine/language/trial.ts`.
- For each moment, two separate Claude Haiku authors wrote from scratch:
  - one wrote today's scene language from the full 40 KB guide, with the real build check and up to 3 repair rounds;
  - one wrote the intent plan from the 3.4 KB guide, with no check at all.
- `scripts/design-brain/compose.ts` (about 900 lines, written by a Sonnet subagent against its own test plans, then run on the three) turns a plan into a scene from primitives and roles, compiled by the engine's own `compile()`.
- Both versions are rendered in `flat`; press is also rendered in `neon`.

**Where to look** (all in `projects/design-brain/`):
- `NAME/compare.jpg` (top: today's engine; bottom: composed; one still a second)
- `NAME/compare.mp4` (side by side: today's engine on the left, composed on the right)
- `press/composed-neon-frames/`
- `press/rich-sheet.jpg` (the press plan with relations added by hand)

The authors' plans and scenes are copied into `scripts/design-brain/samples/`.

**What it shows (honest judgment).**
- **Better: size, hierarchy, focus.** Every composed frame has one subject at 2 to 4 times the size of today's text, centered where the eye lands, with support visibly quieter. Today's frames from the same author are small text at the top of an empty page (the build itself says "fills only 16%"). This holds in flat and neon unchanged.
- **Better: timing.** Changes lead their words by 0.3 s. The engine resolved moments that came too close:
  - 6 delays and 1 merge in the ad;
  - it kept a reveal on screen for 1.4 s;
  - it gave an ask a placeholder and 3.7 s of think time.

  None of this was the author's job.
- **Better: identity.** "$100" becomes "$110", then "$121", in the same place with a pulse. A wrong guess is struck and stays beside the answer. A count of marks is born out of the thing that produced it.
- **Better: the author's burden.** The guide is about 12 times smaller (3.4 KB against 40 KB). Every plan was usable as written. All three baselines also built on the first round, but they left every "looks empty" note unfixed.
- **Not good yet: it is kinetic type.** With only words to show, the composed video is one big word card after another. That beats today's frames, but it is not yet a great video. The lower half is still mostly empty, partly on purpose (the UI zone), partly because nothing visual exists to fill it.
- **Not good yet: relations are weak.** In the hand-enriched plan:
  - a lone count of 1 is drawn as one huge dot, while the 60 are small, so the two are not on a shared scale;
  - the comparison of "1 book a year" against "60 books a year" is small text with a hairline bar;
  - the arrow and its label are tiny.

  These are exactly the solver terms in 4.2 that the prototype does not have: a shared scale for compared quantities, and relations sized as a subject.
- **Not good yet: transitions overlap.** Old and new text overlap for a few frames when the subject changes ("printing press" under "1 scribe"). Proper staging needs exits to finish before the subject enters, or a true morph.
- **Not good yet: authors write cards.** The weak author does not use the relational words, which is why 4.1 (completion) is a full workstream and not an afterthought.

**Verdict.** The core idea holds: the same weak author, given intent words instead of layout words, gets frames that are clearly more readable and better directed. The engine's timing and composition carried the improvement, not the author. The prototype also shows where the real work is:
- inferring what to show;
- composing relations and pictures, not only words;
- staging transitions cleanly.

The prototype was not run through the wave 3 bench, which is still being built, and no Spark run was made.

## 9. Risks

- **Inference proposes wrong relations.** Mitigations: it proposes only from explicit values, words and order; it writes its reason; the author's lines win; and a bench measure counts false relations (the quiz and the follow test catch a comparison the words did not make).
- **Sameness.** One solver could make every video look alike. Mitigations: styles carry their own tokens for scale ratio, motion feel, dim treatment, panel and caption design; the candidate set includes picture-led and kit-led structures; `feel` changes rhythm and easing. Still, this needs the user's eye at each milestone.
- **Fighting explicit authors.** Mixing explicit lines and composed things in one frame can collide. Overrides are pinned constraints in the solver, so the rest is solved around them; conflicts that remain are reported, not squeezed.
- **Energy weights tuned to the bench clips.** Fit on half the clip set and test on the other half, and add new clips of new kinds as wave 5 lands.
- **Scope creep into wave 5.** The design brain composes what exists; making pictures, maps and simulations is wave 5. The request for "a picture of X here" is the interface between them.
- **Bigger prompts for Spark again.** Keep the author guide under 10 KB by moving craft into the engine, and test with Haiku before Spark.

## 10. Open questions for the user

1. **Inference on by default?** Should the engine propose relations (comparisons, counts, wrong ideas, asks) by default, with the author able to turn them off, or only when the author asks?
2. **Kinetic type as a floor.** When a moment has nothing to show but words, is big kinetic type the right floor, or should the engine always ask the pictures stage for a visual first (cost and time per section)?
3. **Who gets the intent guide.** Should Spark write intent only, or intent plus today's language for kits and pictures, in the first build? I suggest the mix, with the long guide kept only for kits, pictures and programs.
4. **One Spark classifier call per section** for ambiguous relations: acceptable, or keep the engine fully deterministic and ask the author instead?
5. **The bottom UI zone.** The prototype keeps the bottom 22% clear for captions and platform UI. Should that depend on the target (a feed short against a lesson watched full screen)?
6. **Milestone review.** Which clips do you want to watch at each milestone, beyond the bench's automatic ones?
7. **Real or redrawn by default.** When a user's chart comes with its data, or their slide with its text, should the engine redraw it in the style by default (animatable, every part addressable) and keep the original for proof, or show the original by default and redraw only when asked? I suggest: redraw information, keep evidence real, and always let the user lock either way.
8. **Material readers.** Is a vision pass per uploaded file at upload time acceptable in cost? This is one Spark call per picture or slide; charts with data and code need none.

## Sources

Craft and motion:
- Manim CE docs: Animation defaults, Transform, TransformMatchingTex, rate functions, indication (docs.manim.community).
- Material Design 3 motion tokens (github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md).
- NN/g, "Animation duration" (nngroup.com/articles/animation-duration).
- Apple WWDC18, "Designing Fluid Interfaces" (developer.apple.com/videos/play/wwdc2018/803).
- Willenskomer, "UX in Motion Manifesto" (uxmag.com).
- Kurzgesagt process (kurzgesagt.org/youtube).
- TikTok creative best practices (ads.tiktok.com/help/article/creative-best-practices).
- Netflix English timed text style guide (partnerhelp.netflixstudios.com).
- Reap safe zones (reap.video/blog/short-form-video-safe-zones).
- Gallo, *The Presentation Secrets of Steve Jobs*.
- Duarte on the One Big Idea.

Attention and learning:
- Abrams and Christ 2003, *Psychological Science* (pubmed 12930472).
- Itti and Koch 2000; Carmi and Itti 2006; Smith and Mital 2013.
- Schneider, Beege, Nebel and Rey 2018, *Educational Research Review* 23.
- Alpizar, Adesope and Wong 2020, *ETR&D* 68.
- Richter, Scheiter and Eitel 2016.
- de Koning et al. 2009.
- Xie et al. 2021, *J. Computer Assisted Learning*.
- Tversky, Morrison and Betrancourt 2002, *IJHCS* 57.
- Hoffler and Leutner 2007, *Learning and Instruction* 17.
- Berney and Betrancourt 2016.
- Rey et al. 2019, *Educational Psychology Review* 31 (segmenting).
- Leahy and Sweller 2011, 2016 (transient information).
- Ginns 2006, *Learning and Instruction* 16.
- Baggett 1984.
- van Wassenhove, Grant and Poeppel 2007.
- Schwartz and Savariaux 2014, *PLoS Comput Biol*.
- Allopenna, Magnuson and Tanenhaus 1998; Huettig et al. 2011 (visual world paradigm).
- Adesope and Nesbit 2012, *J. Educational Psychology* 104.
- Yue, Bjork and Bjork 2013.
- Szarkowska and Gerber-Moron 2018, *PLoS ONE* 13.
- St. Hilaire, Chan and Ahn 2023, *Psychonomic Bulletin and Review*.
- Brod 2021.
- Kornell, Hays and Bjork 2009.
- Zacks et al. 2010, *Frontiers in Human Neuroscience*.
- Swallow, Zacks and Abrams 2009, *JEP: General* 138.
- Kalyuga et al. 2003, *Educational Psychologist* 38.
- Luck and Vogel 1997, *Nature* 390.
- Rensink, O'Regan and Clark 1997.
- Rey 2012, *Educational Research Review* 7 (seductive details).
- Guo, Kim and Rubin 2014 (MOOC video engagement).

Several effect sizes above were confirmed only through secondary sources. They are directions for the engine, not numbers to quote externally.

Layout, camera and transitions:
- Badros, Borning and Stuckey 2001, "The Cassowary Linear Arithmetic Constraint Solving Algorithm", *ACM TOCHI*; kiwi.js.
- Dayama et al. 2020, "GRIDS", CHI.
- O'Donovan, Agarwala and Hertzmann 2014, "Learning Layouts for Single-Page Graphic Designs", *IEEE TVCG*; DesignScape, CHI 2015.
- Christensen, Marks and Shieber 1995 (label placement).
- Ngo, Teo and Byrne 2000 (aesthetic measures).
- Bylinskii et al. 2017; Fosco et al. 2020 (UMSI).
- Lok and Feiner 2001 (survey).
- Li et al. 2019 (LayoutGAN); Gupta et al. 2021 (LayoutTransformer); Inoue et al. 2023 and Chai et al. 2023 (LayoutDM); Kikuchi et al. 2021 (constrained layout via latent optimization).
- Feng et al. 2023 (LayoutGPT); Lin et al. 2023 (LayoutPrompter).
- Christie, Olivier and Normand 2008, "Camera Control in Computer Graphics".
- Lino and Christie 2015 (toric space), SIGGRAPH.
- Galvane, Ronfard, Lino and Christie 2015, "Continuity Editing for 3D Animation", AAAI.
- Heck, Wallick and Gleicher 2007, "Virtual Videography".
- Gleicher and Liu 2008, "Re-Cinematography".
- Lee, Forlizzi and Hudson 2002, "The Kinetic Typography Engine".
- Heer and Robertson 2007, "Animated Transitions in Statistical Data Graphics", InfoVis.
- Paul Lewis, FLIP.
- Apple Keynote Magic Move documentation.
