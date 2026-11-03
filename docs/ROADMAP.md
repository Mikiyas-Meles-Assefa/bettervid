# Roadmap after wave 2 (agreed with the user, Nov 3)

Goal: the best video engine and platform in the world, for any use (lessons, ads, social, history, simulations, uses nobody foresaw). No hardcoded video types or recipes: capabilities plus reasoning. Waves 1 (style and frames) and 2 (direction, pauses, demonstrations) are done. Layer estimates are in the layers chart (design brain 25%, scene authoring 35%, direction 45%, truth engines 35%, pictures 55%, styles 60%, sound 50%, voice 80%, platform 20%, benchmark 10%, render 85%, checks 45%, writer 65%, research and plan 70%).

Save Meta credits: test the engine with Haiku agents as stand-in authors (Haiku 5.5 is about Muse Spark 1.3 level) and short clips, not full videos. Spark runs only to confirm a wave.

| Wave | Covers | Size (1-100) | Now |
|---|---|---|---|
| 3. Teaching bench | Benchmark, quick version | 60 | 10% |
| 4. Design brain (huge) | Design brain, scene authoring, direction | 100 | about 30% |
| 5. What can be shown (huge) | Truth engines, pictures | 90 | about 45% |
| 6. Styles, sound, voice | Styles, sound, voice | 60 | about 60% |
| 7. Proof | Full blind benchmark against NotebookLM and human-made videos | 50 | 10% |
| 8. Platform (huge) | Chat-to-edit, live preview, uploads and material library, interactive export, dubbing, sharing, hosting, accounts | 95 | 20% |
| 9. Speed and cost | Render, caching, Spark only where it matters | 30 | about 80% |
| Every wave | Checks and repairs that only improve, writer examples and stories, truthful research | 50 | about 60% |

## Wave 3: the teaching bench
Judges teaching in time, not stills: 20 to 30 clips of 15 to 40 s across very different uses, each with narration and timing, scenes written by Haiku agents. Measured from scene data and audio: is the eye on the right thing, does the picture keep up with the words, slow first then faster, how much arrives at once, does each pause do its job. Measured by a model: a first-time learner watches the clip as timed frames with the words and is quizzed; a follow test asks what the viewer looks at and waits for at each moment. The user watches a few clips at each milestone.

## Wave 4: the design brain
Its own wave with a lead agent that runs its own sub-agents (composition and layout, type, motion and transitions, camera, direction, Haiku authors). The author says what matters at each moment; the engine composes the frame and its motion like a top motion designer, so a weak author still gets a great frame. Direction (attention, pacing, reveals, pauses) is an ability the engine reasons with, never a recipe per video type, because nobody knows what people will use it for. Every change is scored on the bench.

## Wave 5: what can be shown
The user's own material comes first: most people will bring project files, docs, notes, slides, images and data. Reading that material (planning and intent from it, faithful to it) and composing with their images and content as first-class pieces belong here, not only in the platform wave. Agentic parsing: an agent reads the files with tools (PDF, slides, docs, spreadsheets, code, images), finds structure, claims, steps, figures, tables, equations and data, reads figures with vision, and checks its reading against the source. Bring static material to life, faithfully: a chart image becomes its data and a live chart that draws, highlights and morphs; a diagram splits into parts and arrows animated one link at a time; a photo splits into objects with SAM (depth, parallax, parts that move or get marked); a screenshot gets zoomed regions, highlights and stepped flows; a table fills, sorts and compares; an equation image becomes typeset math that transforms; code runs with real values. Modular so it works for 1 file or 1,000 (NotebookLM quality drops well before its 300-source limit): (1) ingest, one reader per file type, every piece keeps its location; (2) a cached source card per source written by a small agent in parallel (claims with locations, figures and what they show, tables, data, terms), so no model reads everything at once; (3) index over cards, passages and figures; (4) agentic planning from the cards, pulling exact passages and figures as needed, with layered summaries for very large sets; (5) grounding, every claim and visual linked to its source location and checked; (6) bring-to-life converters, one per kind, each with a faithfulness check. Each module is its own cached stage with fixed interfaces. Truth engines (physics and simulations, charts that morph, maps and timelines, 3D, running code, chemistry) and pictures (search, generation, framing on the subject, real and generated footage). New bench clips for each new kind. Can overlap with wave 4.
