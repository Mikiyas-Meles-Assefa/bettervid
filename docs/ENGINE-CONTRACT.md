# Engine contract

For anyone building on the engine, including parallel workstreams. The vision is in `docs/ENGINE-PLAN.md`. The types are in `engine/core/types.ts`, and they decide any conflict with this page.

## How it fits together

1. A **scene document** is a list of steps, each at a moment.
2. `compile()` turns it into a **scene**: it expands kits into primitives, resolves spoken moments, and writes tracks.
3. `evaluate(scene, frame)` works out every property for one frame.
4. `SceneView` draws the frame, and Remotion renders the video.

Files: `engine/core` (contract, compile, evaluate, behaviors), `engine/render` (drawing, themes), `engine/kits`, `engine/truth`, `engine/proof`.

## Rules of the contract

- **Four primitives only:** `group`, `path`, `text`, `image`. A kit never adds a new one. It expands into these, and that is why anything from any kit can be recolored, morphed, blended and styled.
- **Everything is addressable.** Parts are nodes with dotted ids, such as `g.edge.AB`. A kit exports helpers for its part names.
- **Moments follow the voice.** Use `{ word, offset }`. Raw frames are only for silent tests.
- **Frames are pure.** `evaluate` has no state, no randomness and no clock.
- **No real colors or fonts in plans or kits.** Use theme names such as `ink` and `accent`. Styles supply the rest.
- **Capabilities, not rules.** Kits add abilities. They do not decide how a topic should be taught.
- **Truth comes first.** If something can be computed, a truth engine computes it and returns an ordered log, and the animation is built from that log.
- **Fail loudly.** A bad id or kind throws. Nothing silently draws nothing.

## Adding to the engine

- **A kit:** export a `Kit` with `kinds` and, if useful, `behaviors`. Example: `engine/kits/graph.ts`.
- **A truth engine:** a pure function returning `TruthEvent`s. Example: `engine/truth/dijkstra.ts`.
- **A behavior:** a function returning tracks. Examples: `engine/core/behaviors.ts`.
- **A style:** a file in `styles/` with a `render` block: a named pen, fill, surface and feel, plus any overrides. `engine/style/format.ts` holds the presets, the checks, and `STYLE_GUIDE`, the short brief a model needs to write one. `engine/render/theme.ts` reads it. Texture goes on the surface and on colored shapes. Images are never touched, and nothing is laid over the whole frame.
- **A property on a primitive:** add it in `SceneView`, then document it here. Everything else already animates it.

## What the renderer can draw

All of this is plain properties on the four primitives (`RenderProps` in `engine/core/types.ts`), so `set`, behaviors and tracks animate every one. Effects cost nothing until they are used. A property a node never set starts from rest, so `set: { a: { blur: 10 } }` eases in rather than jumping.

| Ability | Properties | On |
|---|---|---|
| Gradients | Any paint can be `linear(angle, color at, ...)` or `radial(cx, cy, r, color at, ...)`. Angle 0 runs left to right, 90 top to bottom; `at` is 0 to 1 and optional. Theme names work inside. Gradients blend into each other and into plain colors | `fill`, `stroke`, text `color`, scene background |
| Shadow | `shadowX`, `shadowY`, `shadowBlur`, `shadowColor`, `shadowOpacity`. Direction stays fixed as a part turns | anything |
| Glow, blur | `glow` (radius), `glowColor`, `glowOpacity`, `blur` | anything |
| Color | `brightness`, `saturation`, `contrast` (1 is unchanged), `hue` (degrees), `tint` with `tintAmount` | anything |
| Blend | `blend` (the CSS blend modes), `isolate: 1` on a group keeps blends inside it | anything |
| Clip | `clip` (a point list in the part's own coordinates, so it travels with the part), `clipSmooth`, `feather` for a soft edge | anything |
| Matte | `mask` (the id of any part, wherever it is in the tree), `maskMode` (`alpha` or `luminance`), `maskInvert`. A part used as a matte is not drawn itself | anything |
| Line | `dash` (list), `dashOffset`, `lineCap`, `lineJoin`, `strokeOpacity`, `trimStart`, `trimEnd` | paths |
| Shape | `d` (raw path data, which allows holes, but does not morph), `fillRule`, `fillOpacity` | paths |
| Text | `stroke`, `strokeWidth`, `tracking` | text |
| Crop | `crop` (`[x, y, w, h]` as fractions, so moving it pans and zooms), `srcW` and `srcH` for the true shape, `fit` (`contain`, `cover`, `fill`) | images |
| Border | `border` (a theme color), `borderWidth`: a mat around the picture, outside its box | images |
| Style light | `glowLevel` (0 to 1, default 1): how much of the style's own glow a part carries (its pen's line, fill and type glow). A dimmed neon tube keeps its hue and loses its light. Roles set it from their `glow` | paths, text |
| Role | `role` (a name from `ROLES`): the part takes that role's look for anything it did not set itself: color, weight, font, size, capitals, glow level, opacity, and for a pointer its stroke and width | paths, text |
| Shader | `shader` (a name from `engine/render/shaders.ts`, or GLSL defining `vec4 shade(vec2 uv)`), `params` (up to 8 numbers), `colorA` to `colorC`, `density`, `time` (defaults to the frame's time). It has no clock or randomness of its own, so frames stay pure | images |
| Order | `z` among siblings, `layer` (not 0) lifts a part out of its group to draw over or under the whole scene. A lifted part keeps its position and fade but leaves its group's clip, matte, filter and blend | anything |

Lists blend item by item when their lengths match. Shapes with different point counts resample. Other lists change at the end of a move.

Shaders need WebGL in the render: pass `chromiumOptions: { gl: "angle" }`, as `engine/proof/rendering.ts` does. Without it they throw rather than draw nothing.

Not available yet: conic gradients, blur of what lies behind a part, motion blur.

## What every workstream must deliver

Tests in `*.test.ts` run by `npm run test:engine`, a clean `npm run typecheck`, and a proof that renders in at least two styles. Work on your own branch and files. Changes to `engine/core/types.ts` need review, because everything depends on it.

## Connecting to the pipeline (Nov 2)

The engine becomes the one visual step for every video, documentaries included. Shared fields are in `schemas/project.ts`: `Plan.intent`, `Project.scene` (`ScenePlan`, sections of scene language with global word numbers), and an `engine` clip carrying a compiled `Scene` and `Theme`. Kits are listed in `engine/kits/index.ts`. The old stage, board and shot renderers stay until a side-by-side test shows the engine is at least as good.

Flow: plan, research, writer, voice, director, assets, annotate (pictures for any video that needs them), then `scene` (Spark writes scene language per section, starting from `shotsToScene` where there are shots), then timeline (compiles the scene into an `engine` clip), mix, render, critic.

The language gained general words for this: `image ... frame=fill|fit`, `camera`, marks and tags placed inside a thing with `at=`, `@N cut`, entrances on any thing, and panels with `back=`. Readability floors live in each style's `render.read` (`text`, the smallest text as a share of the shorter side, and `dim`, the lowest opacity `dim` and `focus` reach); a scene may override them with `read text= dim=`. Truth kits (`matrix`, `det`, `cramer`, `matvec`, `sort`, `trace`, `dijkstra`) play with `do steps`, and once a part builds, Spark sees the computed steps once to tie them to words.

Each workstream owns its files. A change outside them needs the lead's review.

| Workstream | Owns |
|---|---|
| Scene step | `pipeline/stages/scene.ts`, `prompts/scene*.md`, `pipeline/run.ts` |
| Language and documentaries | `engine/language/*`, `prompts/engine-language.md`, `prompts/engine-repair.md`, `pipeline/lib/shots-scene.ts`, `engine/motion/camera.ts` |
| Player | `video/*`, `pipeline/stages/timeline.ts`, `pipeline/stages/render.ts` |
| Truth engines | `engine/truth/*`, new kits in `engine/kits/*` (one line each in `engine/kits/index.ts`) |
| Intent | `pipeline/stages/plan.ts`, `pipeline/stages/writer.ts`, `pipeline/stages/research.ts`, `prompts/plan.md`, `prompts/research.md`, `prompts/writer.md`, `prompts/cut.md`, `prompts/structure.md`, `prompts/review.md` |
| Website and styles | `app/*`, `styles/*` (new files only), `pipeline/tools/style-writer.ts`, `prompts/style-writer.md` |

## Wave 1: design quality (Nov 2)

The first three engine videos are reviewed in `docs/reviews/2026-11-02-three-videos.md` (21 problems). The fix starts upstream: styles become real design systems, and scenes name roles instead of looks. Roles are in `engine/core/types.ts` (`ROLES`, `RoleLook`, `Theme.roles`): a scene says a thing is a `title`, `answer`, `muted`, `caption` and so on, and the style decides its color, size, surface, glow and how it steps back. Every pairing a style allows must stay readable.

| Workstream | Owns |
|---|---|
| Style design | `styles/*.json` (all, including custom and previews), `engine/style/*`, `engine/render/theme.ts`, `pipeline/tools/style-writer.ts`, `prompts/style-writer.md`, `app/preview.ts` |
| Layout and drawing | `engine/language/layout.ts`, `build.ts`, `syntax.ts`, `engine/render/SceneView.tsx`, `engine/core/compile.ts`, `evaluate.ts`, the syntax reference lines in `prompts/engine-language.md` for anything it adds |
| Pictures on screen | `pipeline/lib/shots-scene.ts`, `pipeline/stages/annotate.ts`, `prompts/annotate.md` |
| Picture choice | `pipeline/stages/assets.ts`, `pipeline/stages/director.ts`, `prompts/director.md`, picker prompts |
| Scene writing | `prompts/engine-language.md` (all but the syntax reference lines), `prompts/scene.md`, `prompts/scene-cast.md`, `prompts/engine-repair.md`, `engine/language/author.ts`, `pipeline/stages/scene.ts` except the look step |
| Checking | `pipeline/lib/look.ts` (new), the look step inside `pipeline/stages/scene.ts`, `prompts/scene-look.md`, `pipeline/stages/critic.ts`, `prompts/critic.md`, `engine/review/*` |

### How the design layer reaches the drawing

A theme from `themeFrom` carries `design` (`Theme.design`, `engine/style/design.ts`). With it, any scene in any style gets the designed look; without it (a test theme), `engine/core/roles.ts` works looks out from the palette as before.

- **Words.** `roleLook(theme, role, on)` in `engine/core/roles.ts` gives a role's look sitting on a surface: size on the style's scale (a share of the shorter side, used when the scene names the role), color, weight, font, capitals and glow (drawn as `glowLevel`). On a surface the style lists, words take that surface's ink unless the role keeps its own color there; on any other fill, a color that would not read gives way to the ink that does. Words with no role are `body`; words in a shape are `label`.
- **Panels.** `role=panel` and `back=` draw `elements.panel` (corner, edge, hard shadow, lean, padding) in the panel role's back. `back=paper` is the style's panel. A `back=` the style does not list in `design.surfaces` is reported. A shape with no fill is made of the panel.
- **Captions and labels.** `role=caption` words, and tags with `role=caption`, sit on `elements.caption`: a strip in the caption back with its rule, padding and lean. Other words on pictures sit on `elements.label.back`. Words tagged inside a picture are drawn on `layer: 1`, so a neighbor never covers them.
- **Dim and focus.** Colors move with `dimColor` (toward the page, or down in lightness keeping hue), `glowLevel` drops to `dim.glow`, lines thin by `dim.stroke`, at full opacity; pictures fade. Words never dim past 3 to 1 on what is behind them. `amount=` can only dim less than the style does.
- **Pictures.** Every image takes `design.picture` (saturation, contrast, brightness, tint). A picture placed on the page also gets its border, shadow and an alternating lean up to `rotate`; one shown whole (`frame=fit`) gets the border and shadow; one filling the frame only the color. The blurred copy behind a picture shown whole (`pipeline/lib/shots-scene.ts`) uses `elements.backdrop`, which a style file may give and which is otherwise worked out from its page and picture treatment (`backdropOf`).
- **Tables, highlights, pointers.** A grid of words is a table: its first row takes `elements.table.header`, with rules (`lines`, `rule`, `ruleWidth`) and stripes (`zebra`). `mark highlight` draws `elements.highlight` (a marker band whose words take its ink, an underline, ring, box, or a glow on the words). Arrows and marks use `elements.pointer` (width, open, solid or no heads, hand or clean rings) and the pointer role's color, stroke and glow.

### Frame fixes after the reruns (Nov 2)

- **Measured in real fonts.** `engine/language/measure.ts` measures each character of the style's title, body and mono fonts once in the render browser (cached on disk); the scene step lays out with it, so wide faces keep the side margins.
- **Changes between states.** What leaves where something arrives (new, returning or moving in, kits included) goes in a fast fade, and what arrives comes up quickly a frame or two later: the board is never bare and old words never sit under new ones.
- **Attached words converge.** Words too wide for the view break onto two lines or come down to the readable size; with no room beside their target they go to the nearest free place with a short line back to it; captions at points never cover each other and keep the margins. A camera set earlier follows (pans, then pulls back as little as it must) when words arrive under it. What still cannot fit is reported with the camera line, a zoom that holds it, or how many characters fit.
- **Order.** `NodeSpec.under` places a part just beneath another that already exists, so a card added later sits under its words.
- **Tables.** In a grid, a line holding exactly as many values as the grid has columns is one row: each value gets a cell, and the line's id names the row. Rows typed as separate lines get a note toward a grid.
- **Formulas** take their role's color, and typeset symbols get the style's type treatment (grain, glow).
- **Rings** in tight places hug what they ring. Build results carry `notes` for states crowded with sentences or mostly empty.
- **The look step** rewrites a section once when the version it kept is still severely broken, and reports what remains (`!!!` in the log, `severe on screen` in its notes).

## Wave 2: direction in the picture (Nov 3)

The direction stage writes `p.direction` (events with job, look, holds, demo phases, withholds; `schemas/project.ts`), and the voice records each hold as a real silence in `p.narration.holds`. The scene step and the language carry it out (`research/teaching-tempo.md`, the Scene paragraph).

- **Hold moments.** `BuildOptions.holds` takes the recorded silences. `@h2` is where a hold's silence begins, `@h2.end` where the voice returns, and `@h2+10`, `@h2.end-5` count frames from them, anywhere a moment is written (states, `until=`, `at=`). `engine/language/holds.ts` rewrites them into `@N+frames` on the word the hold follows before the scene is parsed, line for line, so everything after reads plain moments; a name that is not a hold is a build problem listing the real ones. Sections are stored with hold moments already written as word moments, so joining, the player and the critic need nothing new.
- **Phases.** `do steps ID ... pace=slow|normal|fast` (`engine/kits/steps.ts`, `PACES`): without `at=` or `until=` the pace sets each step's time; with them it is the least time a step may have, and a stretch too short is a build error that says how many steps fit, which faster pace would fit, and how to report a hold that is too short (a line `# needs h2 6s: why`, which the scene step logs and keeps in the section's notes for the direction to lengthen the hold). A phase is one `do steps` with `from=`, `to=` and its pace.
- **Replays.** A kit thing with `replay=ID` takes the input of the earlier thing it names (kind, data and settings; not its place or size) and plays its own steps, so a replay is the same computation again beside or after the first.
- **Withhold.** `withhold a,b until=@N` (anywhere in a scene, like `read`) keeps those ids, and everything inside them, off screen until that moment. After compile the build looks at the scene every two frames and fails loudly on the first frame that shows one. `withhold none until=@N` declares that a part shows nothing of it. The scene step requires the declaration in every section that plays before the withhold's `until` event and after the event that set it, so the mapping from the direction's words to ids is made by the one author who chose the ids.
- **Words of order.** A tag or a mark with words that says numbers are sorted or in order (ascending unless the words say descending) is checked on the built scene as its state ends: the numbers inside what it is attached to, read row by row, must be in that order, or it is a build problem. It works the same on a kit and on a hand-made row.
- **Merge sort shows its method.** The `sort` kit's merge cuts each run as a step (a gap opens between the halves), puts a finger (`s.finger.a`, `s.finger.b`) under the front of each half when a merge starts, moves the finger on with each value taken into the merged run below, and lifts the merged run as the gap closes. `order=levels` cuts everything first and merges level by level; the default follows the recursion.
- **Scene step.** With a direction, sections end on event boundaries (an event with a demonstration may run half as long again before it is split). Each section's request lists its events in plain words, its holds with seconds, frames and their moments, its demonstration as phases mapped to moments, and the withholds in force; the word list marks each silence. The cast pass sees the events and the truth kits, so a demonstration across parts is carried as one computed thing. A part that plays no truth steps where the direction demonstrates computed steps is sent back once and then reported.

## Layout: the subject and steady places (Nov 3)

Review problems 1 and 2 (`docs/reviews/2026-11-02-three-videos.md`) and the wave 2 stills (a row of small sort boxes high in an empty phone frame; the row jumping when a question card arrives). Causes found:

- **Small.** Layout used one scale for everything on the board, and a kit was fitted into a square the width of the safe area. A kit that is wider than tall (a sort row, a matrix) is then bound by the width; one that is taller (bars, a trace, a tall picture) was capped at a square and never used the height; a picture given at its pixel size (`w=1920`) shrank every word on the board with it.
- **High.** The free height was spread into the gaps of the outer stack and the block was set a little above the middle. A kit's box also holds room for what its later steps show (the merge row under a sort), so what it shows at first sat in the top part of that box, high in the frame.
- **Jumps.** Each state was laid out on its own. The stretch (a plain state and its keep states) shared one scale, but every state was centered and spread again, so a question card added under a row moved the row and the title, and a table moved as each row arrived.

What `engine/language/layout.ts` does now:

- **Steady places.** `layout(items, env, cap, stretch)` takes the boards of every state of the stretch (`build.ts` collects them first). The children of every container are united over the stretch: each thing any state shows holds the room of its largest version in every state; things that are never on the board together may share one place, so what replaces a dropped thing takes its spot; what a state does not show is room only (not drawn, no box). A container whose children come in a different order in some state is laid out as it is. So everything that stays keeps its box exactly (same center, same size) unless the scene changes it, and additions arrive in room kept for them. In a stack each thing sits at the top of the room it holds, so words that grow by a line grow downward. A table draws its rules and stripes only as far as the rows shown. `Laid.held` lists the kept room, and tags and labels avoid it (`build.ts` adds it to their obstacles), so a tag is not placed where a later thing will come. A tag or mark label also stays where it was in the state before while that place is clear and beside the same target; a callout moves back beside its target once it can.
- **The subject grows.** Kits, graphs, programs and pictures down the main column (the outer stack and stacks in it without a panel) are the subject. After the board fits at its usual scale, the subject grows (up to 3 times, in steps of 0.01) as far as the width allows and until the board leaves 12% of the safe height free; then the words may grow up to 1.25 times their role size in what is left. Words are never shrunk for the subject. Pictures and programs start at their given size but never larger than the safe width on either side.
- **Composition.** The largest subject is centered just above the middle of the safe area by what it shows at first (`env.natural` returns `rest`, the middle of the parts visible before any step, from `build.ts`), not by the room it keeps for later steps. The free room above and below then goes between the subject and what is above and below it (up to 15% of the safe height each side), so a title goes up toward the top, what comes under the subject goes down, and the subject keeps the middle. Boards without a subject are laid out as before.
- **Camera.** Words of a thing that arrives in a state count as cut by the camera when they are wholly out of view, so a camera set in the same state shifts or pulls back to hold them instead of leaving them just outside. Words left wholly out of view are still not reported, since a camera may frame something else on purpose.

Measured on twelve rebuilt sections with `scripts/state-sheet.ts` (every state settled, with `pipeline/lib/look.ts` findings and what moved between states). States where something that stayed moved or changed size: 30 before, 9 after, and the 9 left are changes the scenes ask for (a new plain state, a size the scene changed, a picture's entrance, a camera move). Off-frame and overlap findings: none before or after, though before, the stats answer `s = √4 = 2` was cut at the right edge (math is drawn as paths, which the look does not measure) and is whole now. Measured `empty` findings: 20 before (all moderate), 34 after (7 severe): the merge sort row (17 in both), and the first states of build-up stretches, which now keep room for their later lines. What stays weak: a subject bound by the width (a row of four sort boxes) cannot grow, so such a frame stays sparse until the kit itself has a portrait form (merge sort as a tree going down, say); and a stretch that builds up from little (a list written line by line) now starts high with the room for its later lines kept free below, which the look's measured `empty` finding reports on its first states. (Both are addressed in the next section.)

### Kits that fill a tall frame, attached words, kept room (Nov 3, second pass)

- **Why the sort was tiny.** In a row, a merge sort of eight boxes was about 70 px wide a box: all eight values share one row across the width, the row also keeps width for the gaps that open as runs are cut (more than a quarter of it), and each box was nearly twice the height of its digits. No growth of the subject can help a thing bound by the width.
- **Forms chosen by the kit.** A kit picks its form from the frame shape and its data, and a scene may ask for one with `form=`; the steps are the same in every form, so `from=` and `to=` keep their meaning. The kit is the one that knows how its process can be drawn, and the frame shape is in its context (`CompileContext.width`, `height`; the kit cache is keyed by them), so no writer has to know the arithmetic. `sort` (`engine/kits/sort.ts`): `form=auto|row|down|across`. On a frame taller than wide, merge sort with boxes is drawn by level (`treeBoard`): each run sits at the level of its depth in the split tree, a cut moves both halves one level on, a merge takes each value back into its run's level in order while the fingers move along the halves, and the values end at the first level, sorted. `down` stacks the levels; `across` sets them side by side with each level's values in a column. Auto takes down unless across gives values at least 1.2 times larger. The step between levels spreads them over the height the values leave (2.1 to 3.4 boxes), boxes fit their values closely, and where a value leaves a place a faint outline stays (`s.place.L.K`), so the split tree stays drawn and merged values visibly come back to their places. Other algorithms, bars, and wide frames keep the row.
- **Where a kit is centered.** `natural().rest` is now the middle of what the kit shows averaged over every step of its story (from `storyOf` in `engine/kits/steps.ts`), not only before the first step, so a kit whose later steps use its lower part is centered on where its parts mostly are.
- **Tags and math.** Math is drawn as glyph outlines (parts with `glyph: 1`), so for tags and labels each glyph now counts as writing (`glyphWords` in `build.ts`): a place that covers any piece of writing by more than 15% of it counts as crowded and the words go to a free place with a line back (counted by the things crossed, not their letters), on a finer search grid; if no place is free they try again at the smallest readable size; only then do they sit on a card. The layout also leaves room for attached words: `layout(..., spare)` keeps about a line and a half per tag or labeled mark of the stretch out of the subject's growth and the frame's spreading.
- **Kept room in the look.** The built scene carries `held` (`Scene.held`): for each state, the room the layout keeps for later things and every kit's box, on the frame. `measureLayout(..., kept)` counts those cells as used in its `empty` check (`keptAt(scene, frame)` in `pipeline/lib/look.ts`), so the first states of a build-up and a kit waiting for its later steps no longer push rewrites. The look step and the critic pass it. Outlines with no fill no longer count as dimmed content.
- **A fix found on the way.** Each state of a stretch had its own copy of the stretch list, so states could not be matched by it; one shared list per stretch now (it decides the stretch's scale and spare room).

Measured with `scripts/state-sheet.ts` before and after this pass (merge-w2scene s8 with four values, s8 written again with eight values `[7,3,6,4,2,1,8,5]` and the predict card, the same with sixteen and with `form=across`, s3; stats-w1 s3, s9, s10; merge-w1 s3; wright-w1 s8): a box of the four-value sort is 154 px with its value set at 109 px (was 139 px and 91 px), of the eight-value sort 76 px with 65 px values (was 72 px and 47 px): the boxes grew little, since the values of a level still share the width, but the values grew by a fifth to two fifths, and the eight-value sort now spans the height of the safe area level by level. Measured `empty` findings fell from 39 (12 severe) to none. For the sorts this is the drawing itself: with kept room left out of the check, the four- and eight-value frames still have no `empty` finding; for build-up stretches it is the kept room. Off-frame and overlap: none. The stats tags no longer sit on the formulas: in s10 the tag goes under the formula with a line back, in s9's last state, which is full, it sits at the readable floor in the gap beside the fraction. What stays weak: with sixteen values a box is still 38 px (was 37), in either form, since sixteen values share one side of the frame; a camera that follows the run being merged would be the way to show them large.

### The camera follows computed work (Nov 3, third pass)

Many values cannot all be large at once on a phone (eight values by level give 76 px boxes, sixteen give 38 px), so the engine shows the whole and then the part being worked on. It is an ability of the build, for every truth kit (`engine/language/follow.ts`, the follow block in `build.ts` before the camera moves are written), not of the sort:

- **When.** A truth kit whose words come out smaller than about nine hundredths of the frame's width (the middle of its text sizes, at its slot's scale) is followed during each `do steps` play. Larger ones are left alone. `follow=no` on the kit keeps the camera still.
- **What.** `stepAreas` takes each step of the story and the parts it changes (its changes and plays), where they are before and after it, as one region. `stepSchedule` (`engine/kits/steps.ts`) gives the frame each step plays at, as `playSteps` places them.
- **Pace.** Steps are framed in spans: each step at `pace=slow` (a hold that plays a slow step gets a close look), spans of at least 1.2 s at normal and 1.8 s at fast, so quick stretches are framed wider and the camera moves at a pace a viewer can follow. The view comes as close as makes the words about a tenth of the frame's width (at most three times).
- **Whole.** Before the first step the whole shows; when a play ends (and its last change has run) the camera pulls back to the whole, unless the next play of the same kit starts within a second. The end of the story is a play's end, so a recap sees the whole.
- **Readable.** A view holds the region whole, holds every tag and every line of words that arrived in that state whole (a question put up during a hold), and leaves every other line of words, the kit's own values where its steps put them included, whole or wholly out of view. It tries the centered view and then the nearest views around it whose edges fall between things; where none works it goes wider, and below 1.12 times it does not move. A span that cannot be framed shows the whole.
- **The scene's camera.** A play whose state moves the camera, or keeps it moved, is not followed, and following stops at the next camera move the scene makes (including a plain state's return to rest).

Measured on merge-w2scene s8 written again with sixteen values (`do steps` fast and slow, with the predict card): the slow and fast spans of the merges are framed at up to three times, so a box reads at about 110 px instead of 38, and the camera returns to the whole between phases; eight values are followed at about 1.5 times (a box about 115 px). Weak: a span whose region cannot be framed without cutting a value shows the whole for that span, so a fast stretch may go close, wide and close again; and tags placed for the whole view grow with the zoom (they are kept whole, not resized).

### After the first directed run (Nov 3)

- **One computed thing, many parts.** Sections are written at the same time, so the scene step gives each one the truth plan from the direction (`truthPlan` in `pipeline/stages/scene.ts`): the computed thing's exact line, with the id `demo1` (`demo2`...) in every part, how many steps the parts before it played, and exactly the steps its own phases play. A kit thing may start part way with `done=K` (it shows how it stands after step K and plays on from K + 1). Each part is checked before joining: the same id and input, `done=` matching where the demonstration stands, and its own steps, no more and no fewer (`truthChecked`).
- **Steps played twice and one id with two inputs** are build problems on the line that does it, so a joined scene names the part to change.
- **The joined scene repairs its parts.** When the whole does not build, each problem is mapped back to the part whose lines it names (`joinWithSpans`), that part is sent back with the error, and the parts are joined again (two rounds). There is no throw while a part can still be repaired.
- **Demonstrations fit their words.** A phase whose words name values of the computed thing that its steps never show is a problem (`pipeline/lib/demo.ts`). The direction stage repairs it while planning; the scene step checks the plan it gets and, where it does not fit, has Spark choose the thing's settings (an order of steps, such as `order=levels`) and phases that do, before any part is written (`prompts/scene-demo.md`).
- **Words in view.** Words a state puts up, or changes, must be wholly in view under the scene's own camera; only words that stayed from before may fall out of a close view. The camera that follows small kits keeps the same words in view and goes only as close as they allow.
- **Tags on moving parts.** A tag on a part of a computed thing travels with it as its steps play; where that carries it onto the thing's values at any step, it is a build problem naming the step.

## Not yet decided

The scene language Spark writes, text split into letters, measured layout, 3D, and how the engine replaces `video/Stage.tsx` and `video/Board.tsx`. The foundation is not connected to the pipeline yet.
