// Depiction: drawing a thing as itself, with parts that carry state. The one entry point the composer imports.
// Tiers (docs/DESIGN-BRAIN.md 2.1): drawn kinds (kinds/), generated sprites cut with SAM (sprite.ts), the user's own
// pictures and found pictures with parts (picture.ts). Each gives the same Depiction: a box, named parts, states, verbs.
//
// The prototype's drawn props (drawn.ts: resolve, propNodes, liquidPoly ...) stay exported while the composer moves to
// the Depiction interface; new code uses depictionFrom and the depicter.
export * from "./drawn.ts";
export type { ActResult, Change, DepictLook, Depiction, Part, Pt, StateDef, StateMap, StateValue, Timing, VerbDef, VerbSet } from "./types.ts";
export { PROP_SPEC_SCHEMA, sizeCm, type PropSpec, type SpecVerb, type Unit } from "./spec.ts";
export { changesToSteps, checkSpec, depictionFrom, suggestLook, transfer, type DepictOptions, type SpecProblem } from "./depict.ts";
export { DEPICTER_SYSTEM, depict, depicterTask, type DepictAnswer, type DepictRequest } from "./depicter.ts";
export { KINDS } from "./kinds/index.ts";
export { findVerb, POSE_STATES, POSE_VERBS, type KindDef } from "./make.ts";
export { getSprite, loadSprite, saveSprite, SPRITE_CACHE, spriteDepiction, spriteKey, spriteRequest, type LoadedSprite, type SpriteMaker, type SpriteMeta, type SpriteRequest } from "./sprite.ts";
export { pictureDepiction } from "./picture.ts";
