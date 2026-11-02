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

## What every workstream must deliver

Tests in `*.test.ts` run by `npm run test:engine`, a clean `npm run typecheck`, and a proof that renders in at least two styles. Work on your own branch and files. Changes to `engine/core/types.ts` need review, because everything depends on it.

## Not yet decided

The scene language Spark writes, text split into letters, measured layout, 3D, shaders, and how the engine replaces `video/Stage.tsx` and `video/Board.tsx`. The foundation is not connected to the pipeline yet.
