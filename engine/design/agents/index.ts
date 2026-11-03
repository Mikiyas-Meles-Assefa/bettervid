// The reasoning agents (docs/DESIGN-BRAIN.md 2.3): the director per video, the designer per moment, the viewer panel on
// finalists. Their contract is ./api.ts; each task is a pure function of its input, and each answer is checked
// (checkDirector, checkDesigner, checkViewer) before it is applied, so a repair round can fix what is wrong.
import type { Agents } from "./api.ts";
import { designerTask, applyDesigner } from "./designer.ts";
import { directorTask, applyDirector } from "./director.ts";
import { viewerTask } from "./viewer.ts";

export const agents: Agents = { directorTask, applyDirector, designerTask, applyDesigner, viewerTask };

export { allocate, applyCorrections, checkDirector, checkViewing, DIRECTOR_SCHEMA, directorSystem, VIEWING_SCHEMA } from "./director.ts";
export { checkDesigner, DESIGNER_SCHEMA, designerSystem, shareOf } from "./designer.ts";
export { checkViewer, seatsOf, STANDING_SEATS, VIEWER_SCHEMA } from "./viewer.ts";
export { instrumentInfo, PROMPTS, prompt, SPACE_FIELDS, PROPOSAL_KINDS, FOCI } from "./common.ts";
export { directorTask, applyDirector, designerTask, applyDesigner, viewerTask };
export type * from "./api.ts";
