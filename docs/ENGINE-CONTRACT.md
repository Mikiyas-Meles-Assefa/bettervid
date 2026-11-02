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
- **A style:** a file in `styles/`. `engine/render/theme.ts` reads it.
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
| Shader | `shader` (a name from `engine/render/shaders.ts`, or GLSL defining `vec4 shade(vec2 uv)`), `params` (up to 8 numbers), `colorA` to `colorC`, `density`, `time` (defaults to the frame's time). It has no clock or randomness of its own, so frames stay pure | images |
| Order | `z` among siblings, `layer` (not 0) lifts a part out of its group to draw over or under the whole scene. A lifted part keeps its position and fade but leaves its group's clip, matte, filter and blend | anything |

Lists blend item by item when their lengths match. Shapes with different point counts resample. Other lists change at the end of a move.

Shaders need WebGL in the render: pass `chromiumOptions: { gl: "angle" }`, as `engine/proof/rendering.ts` does. Without it they throw rather than draw nothing.

Not available yet: conic gradients, blur of what lies behind a part, motion blur.

## What every workstream must deliver

Tests in `*.test.ts` run by `npm run test:engine`, a clean `npm run typecheck`, and a proof that renders in at least two styles. Work on your own branch and files. Changes to `engine/core/types.ts` need review, because everything depends on it.

## Not yet decided

The scene language Spark writes, text split into letters, measured layout, 3D, and how the engine replaces `video/Stage.tsx` and `video/Board.tsx`. The foundation is not connected to the pipeline yet.
