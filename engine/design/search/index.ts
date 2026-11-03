// The search and look loop (docs/DESIGN-BRAIN.md 2.4): candidates, measurement against agents' goals, sheets, the loop.
export { missOf, scoreGoal, scoreCandidate, scoresText } from "./score.ts";
export { budgetFor, cameraPlans, changingIds, fieldValue, generate, onScreen, packerVariants, rng, sampleSpace, stretchOf, timingOptions, viewOf, withFields, type Generated, type GenContext, type Source } from "./generate.ts";
export { candidateText, composeCached, designHash, evaluate, holdsFrom, LAYOUT, layoutReading, measureGoals, newCache, windowOf, withMoment, type EvalCache, type EvalContext, type Evaluated } from "./evaluate.ts";
export { candidateSheet, composeSheet, remotionStills, sheetFrames, type StillRenderer } from "./sheet.ts";
export { goalsFor, runSearch, type MomentOutcome, type RoundLog, type SearchInput, type SearchResult } from "./run.ts";
export { keepDirector, roundOf, standInAgents } from "./stand-in.ts";
