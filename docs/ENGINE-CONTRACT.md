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

## Not yet decided

The scene language Spark writes, text split into letters, measured layout, 3D, and how the engine replaces `video/Stage.tsx` and `video/Board.tsx`. The foundation is not connected to the pipeline yet.
