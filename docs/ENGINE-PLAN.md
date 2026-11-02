# The Engine: plan

Status: vision and plan, nothing built yet. Replaces the earlier extended engine plan.

## 1. The ambition

Most tools make a video of something. This engine makes a working model of the idea and films it.

Today's options each stop somewhere. Manim has beautiful math, but it needs an expert writing code. Motion graphics tools need a skilled human. AI video generators make pixels nobody can edit, and they cannot be trusted with facts. Nothing lets an AI build a truthful, living explanation of any topic in any style, then lets a person change any part of it.

Our target is that. The test is simple: a viewer with the sound off should still follow the idea, and a viewer who knew nothing should be able to explain it afterwards.

"Best in the world" is a goal to measure against, not a claim. Section 12 says how we measure it.

## 2. Five beliefs

1. **Everything is an object.** Anything on screen, down to one letter, one graph edge, or one person cut from a photo, can be addressed and animated.
2. **Truth is computed, not drawn.** If something can be calculated, run it. The visuals show what really happened, so they cannot be wrong.
3. **Capabilities, not rules.** The engine gives Spark abilities. It never decides how a topic must be taught.
4. **A video is a program.** It stays alive as data, so it can be edited, re-styled, translated, and explored.
5. **Understanding is the score.** Beauty that does not teach is failure. We test for understanding, not looks.

## 3. Architecture

| Layer | Job |
|---|---|
| Story | Plan, research, script, voice (exists) |
| Visual thinker | Decides how to make the idea visible |
| Scene language | The one format everything is written in |
| Truth engines | Real computation that produces facts and event timelines |
| Domain kits | Ready-made worlds: graphs, code, math, maps and more |
| Scene graph | Every object and part, with every property over time |
| Motion and camera | How things move, and where the eye goes |
| Style renderer | Turns the same scene into any look |
| Sound | Effects and music driven by scene events |
| Understanding loop | Watches the result, tests it, repairs it |
| Player and output | Live preview, editing, interaction, MP4 |

## 4. Scene graph

- Every object has an id, parts, and properties. Parts have ids too, all the way down.
- Any property of anything can change over time: position, size, squash, rotation, skew, 3D position, color, gradient, stroke, glow, blur, opacity, drawn amount, material.
- Anything can be grouped, cloned, split into parts, merged, morphed into something else, attached to something else, or made to follow a path.
- Every frame is a pure function of time, so renders are exact and run in parallel.
- 2D and 3D share one world, so a flat diagram can tilt into 3D and back.
- Layers include real depth order, masks, blend modes, and shaders.

## 5. Scene language

Spark writes in three levels, and can mix them in one scene:

1. **States:** what is on the board at each spoken moment. The engine animates the difference.
2. **Behaviors:** ongoing things such as "pulse along this edge", "orbit", "spread through the network", "follow this data".
3. **Programs:** sandboxed code that creates objects and motion, for anything the language has no word for.

**Self-growing library.** When Spark invents something useful at level 3, such as a new kind of chart, it can be tested, reviewed and saved as a new reusable part. The engine gets better with use.

Timing is always tied to spoken words, never to raw seconds, so a change in the narration moves the visuals with it.

## 6. Truth engines

- **Algorithms:** the real algorithm runs in a sandbox and records every step. Dijkstra's visited nodes, distances and queue are real events, and the animation follows them.
- **Code:** real execution with a tracer: the current line, every variable, the call stack, memory, pointers.
- **Math:** a computer algebra system checks each step of a derivation, so a wrong line never reaches the screen.
- **Physics and simulation:** real solvers for motion, waves, fields, fluids and spreading processes, tuned to land on spoken cues.
- **Data:** real sources, real numbers, with the source shown.
- **Geography and time:** real map shapes, borders, and dated events.

## 7. Domain kits

Each kit is a world of parts with its own truth engine. The first set:

| Kit | What it can do |
|---|---|
| Graphs and algorithms | Nodes, edges, weights, trees, heaps, queues, traversal, any graph algorithm |
| Code and systems | Editors, execution, memory, networks, packets, databases, operating systems |
| Math | Notation, derivations, matrices as transformations, geometry, calculus, probability |
| Machine learning | Neurons, layers, training, attention, embeddings moving in space |
| Data | Charts that morph into each other, sorting, distributions, live tables |
| Science | Molecules, cells, circuits, forces, waves, the solar system |
| Maps and history | Borders moving, armies, routes, trade, timelines |
| Language and text | Sentences rearranging, grammar, translation, etymology |
| Economics and society | Flows of money, networks of people, cause and effect loops |
| Music | Notes, waves, harmony tied to real audio |

Kits are not walled off. A map can hold a graph, a graph node can hold a photo, and a code run can drive a chart.

## 8. Living images

Photos and art become scene objects:

- **SAM** separates a picture into objects, so one person can be lifted out, recolored, moved or tracked. Meta models stay at the core.
- **Muse Image** fills the hole left behind, so the background stays whole.
- **Depth** turns a still into layers with real parallax. Which depth model to use is an open question.
- Real documents can have their words found and pointed at, with text pulled out into live objects.
- Generated pictures come in layers, so their parts can move too.
- Video input: SAM tracks objects through footage, so marks and diagrams stick to moving things.

The rule of honesty stays: nothing generated passes itself off as a specific real person or document.

## 9. Cinematography and sound

- **Attention model:** the engine knows what the viewer should look at each moment, and uses motion, light, focus and stillness to guide the eye.
- **Camera:** still by default, and expressive when it helps, including 3D moves. Spark chooses.
- **Rhythm:** pacing follows the voice's own emphasis and pauses.
- **Sound from events:** a node visited, a sort swap or a collision can each trigger sound, so the audio is part of the explanation.
- **Captions as objects:** a caption word can fly into the scene and become part of it.

## 10. Style renderer

A style is a renderer, not a filter. The same scene can come out as:

Chalkboard, marker whiteboard, ink on paper, blueprint, neon, clean flat, paper cutout, clay 3D, newspaper, terminal.

- Styles control materials, line quality, type, color, lighting, motion feel and sound.
- Anyone can describe a new style in words, and Spark writes the style file. Brand kits work the same way.
- Styles can change mid-video, and one scene can mix them.

## 11. A video is a program

- **Instant preview:** the scene plays live in the browser, before any render.
- **Talk to it:** click anything and say what to change: "make this edge red", "slow this down", "use a bigger example".
- **Pause and play with it:** viewers can stop, drag a slider, change a graph, and see the real engine respond.
- **Ask it:** pause and ask a question, and it answers using the scene on screen.
- **Re-make it:** new language, audience level, style or length, without starting over.
- **Export:** MP4, vertical or wide, or an interactive page.

## 12. Understanding loop and measures

**Three reviewers** watch every video before it ships:

1. **Sound off:** can a model follow the idea from the visuals alone?
2. **First-time learner:** a model that does not know the topic watches, then takes a quiz.
3. **Truth check:** every claim on screen is compared with the truth engine and sources.

Failures become repairs to the scene, in a loop.

**The benchmark:** a fixed set of 100 hard requests across every kit, such as Dijkstra's algorithm, backpropagation, how a CPU runs a loop, why the Roman Empire fell, Cramer's rule, how mRNA vaccines work. Every engine change runs against it. We also compare side by side with the best human videos on the same topics, and test real viewers against audio alone.

Targets: viewers understand more than from audio alone, zero factual errors on screen, and a person can change anything in one sentence.

## 13. Build plan

**Phase 0: contract, done first and alone.** The scene graph, scene language, and how kits plug in. Everything depends on this, so parallel work starts only after it is settled.

**Phase 1: the core, in parallel.**

| Workstream | Output |
|---|---|
| A. Scene graph runtime | Objects, parts, properties, frame-pure evaluation |
| B. Motion | Morphing, paths, springs, behaviors |
| C. Layout and text | Real measurement, per-letter control |
| D. Style renderer | Materials, line quality, 3 styles first |
| E. Scene language and sandbox | Parser, sandboxed programs, safety |
| F. Understanding loop | Reviewers, benchmark runner |

**Phase 2: kits, one subagent each.** Graphs and algorithms first as the proof, then code, math, data, living images, science, maps.

**Phase 3: live.** Instant preview, talk-to-edit, viewer interaction, new styles, the self-growing library.

**Phase 4: 3D, video input, render farm, and the remaining kits.**

Each workstream gets its own branch, a written contract, tests, and a demo video. A review pass checks each one before it merges. Two workstreams never change the same files.

## 14. Hackathon cut (Wed Nov 4)

Phases 0 and 1, the graphs and code kits, and math on the new engine are the goal. One Dijkstra video and one run-through of code, in two styles, would make the demo unforgettable. Everything else goes on the roadmap slide. Hosting must still happen, or judges cannot use it, so it runs as its own workstream.

## 15. Manim

Manim is not the engine. If the test goes well, it can plug in as one more source of clips for hard math morphs and 3D. The plan does not depend on it.

## 16. Risks

- **Spark's ability.** Planning this much detail is the hardest part. If Spark cannot use the language well, a stronger Meta model or more repair rounds are the first answers.
- **Sandboxing.** Running generated code on a public site needs real isolation.
- **Render speed.** Rich scenes and 3D will slow rendering. The hosted setup needs testing early.
- **Scope.** This is years of ambition. Only the benchmark keeps it honest.
- **Costs.** Claude subscriptions pay for building. Meta and ElevenLabs test runs need a much larger budget than $25.
- **New packages.** KaTeX, a 3D library, a computer algebra system and a sandbox all need the user's OK.
