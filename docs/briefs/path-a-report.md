# Path A report (Nov 3)

Branch `claude/path-a-b76481`. It has the wave 4 lead's final state (staging, steadiness, the hand-drawn redraw), merged from `worktree-agent-a728f58e26270f026` at 6cbfbe4. Nothing is pushed or merged to main.

## What path A is

Spark keeps writing whole scenes in the scene language. Path A turns on with `"sceneAuthor": "toolbox"` in a project's `input`. The language then also offers the design brain's abilities as words the writer may use. Code carries out what is written and measures it; it never decides layout, motion or timing.

The old path (`"language"`, today's default) is unchanged. Its writer's guide is byte-identical to the one before this work, and a test checks that every whole-scene example in the path A guide builds as written.

## What path A added

**Depicted things.** `depict ID "what it is"`, with `tier=sprite` or `asset=NAME`. Its states change with `do change ID STATE=VALUE`, and it acts with `do act ID verb="..." to=OTHER amount=N`. Its parts are addressable as `ID.PART`.
- The depicter on Muse Spark prepares each thing before the build, from the verbs, states and relations the scene uses.
- Depictions are cached per project in `scene/toolbox.json`.
- After a build, the writer is told each thing's states, verbs, parts and points.
- Files: `engine/language/toolbox.ts`, and the `depict` hook in `build.ts`.

**Staging.** A `stage` arrangement with relation lines in the writer's words, such as `cup sits on tray "the right side"`, `lamp above table "1 m"` or `rope tied to post`.
- Relation lines can also be written at a state's edge in keep states, so things can join a stage later.
- The staging solver (`engine/design/abilities/scene.ts`) places everything at one real scale. Real sizes come from the depicter or from `cm=`.
- `bleed=` and `focus=ID share=` are available. Relations that disagree go back to the writer.
- Files: `syntax.ts`, `layout.ts`, `build.ts`.

**The board.** `board ID w= h= follow=writing`: one canvas larger than the frame, written state by state. The camera can follow the writing, and `camera ID` shows the whole board.
- Files: `engine/language/board.ts`, plus `layout.ts` and `build.ts`.

**Motion.** Every move in the vocabulary is taught with its form and when it serves: travel, cut, fade, stay, morph, spring, drop, arc, hop, follow, orbit, squash, jiggle and wiggle.
- `arc` and `hop` gained `to=ID`, so the writer names a destination instead of giving pixels (`engine/motion/moves.ts`).
- The style's leanings are shown to the writer as suggestions (`leansText` in `author.ts`).

**Sprites and pictures.** `pipeline/lib/depict-makers.ts`:
- Muse Image draws the sprite in the style's own words.
- SAM cuts it into parts.
- Real pictures get named parts through the material reader and SAM.
- `findPicture` searches the archives.
- Everything is cached by description and style, or by the picture's bytes.

**Art direction.** The director's plan has a video-wide `look` (emphasis, scale, motifs, texture), and every path A writer is given it.
- A plan written before the look existed gets one from a single call.
- Files: `prompts/art-direction.md`, `direction.ts`, `scene.ts`.

**Review and repair.**
- The design brain's instruments measure a part and turn the readings into plain notes (`pipeline/lib/instrument-notes.ts`), and Spark reviews the rendered stills with those notes (`prompts/scene-review.md`).
- On request, everything goes back in **one repair round** (`"sceneRepair": "once"`): write, build, mend slips in code, render and look once, then send the build notes, code's notes, the look's issues and the instrument readings together in one request.
  - The repair is kept if it builds.
  - It is asked again only if the repair does not build. If that second answer also fails, the first version is kept when it built.
- Slips with exactly one fix are mended in code before any model call (`pipeline/lib/mend.ts`).

**The guide.** The path A parts of `prompts/engine-language.md` teach every new tool at the depth the old tools get: what it does, its form, examples, and when it serves.
- New craft paragraphs and a whole-scene example ("Why a kettle whistles") use the new tools as fully as the bicycle example uses the old ones.
- No example is about sorting or a bench topic.
- Words: path A guide 9,806; old path guide 6,859.

**Fixes found with the real depicter:**
- color names were not resolved (liquids came out black);
- a depicter's verb mapping could override the kind's own verb (a burette tipped instead of dripping);
- named points were matched against the wrong box (a flask floated above its bench);
- parts did not go by their own names.

**Tests:**
- `engine/language/toolbox.test.ts`: 9 tests. They cover the guide's whole scenes and every motion move.
- `board.test.ts`: 10 tests.
- `pipeline/stages/review.test.ts`: 6 tests.
- `depict-makers.test.ts`: 5 tests, with fake image and SAM makers.
- `mend.test.ts`: 1 test.
- tsc is clean. `test:engine` passes 560 and `test:pipeline` passes 142.

## Clips

All clips use `projects/merge-w2`'s own voice, cut to a stretch with `scripts/path-a-clips.ts`, in neon, rendered at 810 by 1440. The final 1-minute files are trimmed to end exactly where the narration ends: no sources card, no black tail.

**1-minute clips.** Words 225 to 365 ("Now merge." to "so 3 goes down next."), 63.03 s, three sections, one repair round each, run in parallel:

| Clip | File | Total time | Scene stage | Repairs per section (s1, s2, s3) | Spend |
|---|---|---|---|---|---|
| A, path A | `projects/path-a-clips/merge-1min-a.mp4` | 255 s | 172 s | 1, 1, 1 | $0.025 |
| B, old path | `projects/path-a-clips/merge-1min-b.mp4` | 321 s | 258 s | 2, 1, 2 | $0.021 |

In B, s1's first answer did not build, so its one round went to fixing that build. In s3, the look was done but the repair did not build, so it was asked again.

**Tools A's writer used:** the sort kit with `do steps`, `light` (20 times), `do pulse` (8), `camera` (3), `dim` (2), `tag` (1), and `ease=smooth` (2). It used none of the new tools: `scene/toolbox.json` is empty, and there is no stage, board, depicted thing or new motion. B used the same kinds of tools.

**15 s clips** (earlier, words 328 to 357, before the one-round rule):
- `projects/merge-clip-a/video.mp4`: path A, $0.026.
- `projects/merge-clip-b/video.mp4`: old path, $0.011.
- These still end with the 4 s credits card.
- Clip C (the intent path) was dropped on the user's say after its scene stage ran ($0.106). It was never rendered.

**Total Meta spend for all clips:** $0.19.

## What is weak

- **The writer does not reach for the new tools on this subject.** Even with the deeper guide, path A's writer drew merge sort with the sort kit only. On a computed process that may well be the right call, but these clips do not show the new tools at all. A subject with real things in a place (a machine, a kitchen, a landscape) is where they would show. Only `scripts/toolbox-live.ts`, a live depicter on a staged lab scene, shows them working end to end: a burette over a flask on a bench, dripping, the flask turning pink.
- **The clips are steady within a part, not across parts.** In both, the demonstration row changes size and place at section joins and under the follow camera. In the 1-minute clips it jumps between y 130 and 195 at 810 wide. It is small in the frame, with large empty bands.
- **A and B look alike.** Both have about 20 lights, pulses and the kit's own fingers, and both put on screen captions that repeat the voice. Neither is near the bar of the best human explainers.
- **Steps the depicter's drawings do not show.** `drips into` moves the contents but draws no falling drops (the design brain's flow ability is not wired into the language). Part names depend on the depicter's kind, so a part the writer imagines ("spout") may not exist; the writer is told the real ones after the first build.
- **The real makers are only partly proven.** The sprite and picture makers have only run against fakes; no live Muse Image or SAM call was made.
- **One repair round is mostly untested.** It has a unit test for the mend step only. The round itself was exercised only by the two live clips.
- **The instruments only describe.** Their readings go to the writer as notes; the gate that keeps a repair does not weigh them.
- **The old 15 s clips were not re-trimmed.** They still end with the credits card.
