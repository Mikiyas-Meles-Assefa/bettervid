// Depiction: drawing a thing as itself, with parts that carry state. The one entry point the composer imports.
// Tiers (docs/DESIGN-BRAIN.md 2.1): drawn kinds (kinds/), generated sprites cut with SAM (sprite.ts), the user's own
// pictures and found pictures with parts (picture.ts). Each gives the same Depiction: a box, named parts, states, verbs.
//
// The composer draws through the Depiction interface (depictionFrom and the depicter). The prototype's drawn props
// (drawn.ts: resolve, propNodes, liquidPoly ...) are no longer used outside their own tests and can be removed.
export * from "./drawn.ts";
export type { ActResult, Change, DepictLook, Depiction, Part, Pt, StateDef, StateMap, StateValue, Timing, VerbDef, VerbSet } from "./types.ts";
export { PROP_SPEC_SCHEMA, PROP_SPEC_SCHEMA_PLACED, sizeCm, type PropSpec, type SpecVerb, type Unit } from "./spec.ts";
export { changesToSteps, checkSpec, depictionFrom, suggestLook, suggestMagnify, transfer, type DepictOptions, type SpecProblem } from "./depict.ts";
export { DEPICTER_SYSTEM, depict, depicterTask, type DepictAnswer, type DepictRequest } from "./depicter.ts";
export { KINDS } from "./kinds/index.ts";
export { findVerb, POSE_STATES, POSE_VERBS, type KindDef } from "./make.ts";
export { getSprite, loadSprite, saveSprite, SPRITE_CACHE, spriteDepiction, spriteKey, spriteRequest, type LoadedSprite, type SpriteMaker, type SpriteMeta, type SpriteRequest } from "./sprite.ts";
export { pictureDepiction } from "./picture.ts";
export { boxPoint, firstPoint, pointOf, pointWords } from "./points.ts";
