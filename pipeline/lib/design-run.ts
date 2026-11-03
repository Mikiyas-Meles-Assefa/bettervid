// Where the scene stage hands an intent plan to the design brain. The search loop (director, designer, viewer and the
// instruments, engine/design/search) and the agents that drive it (engine/design/agents) are set here by whoever wires
// them in, with `useDesignRun`, so the scene stage depends only on this contract and not on how the search is built.
//
// Until a search is set, a plan is composed once with the style's suggested design (engine/design/suggest.ts and
// compose.ts): the same composer the search runs, with no candidates tried. Every result says which one made it, as a
// visible note, so a video made without the search never passes for one made with it.
import type { Scene, Theme } from "../../engine/core/types.ts";
import type { Agents, DirectorAnswer } from "../../engine/design/agents/api.ts";
import { compose } from "../../engine/design/compose/compose.ts";
import { suggestDesign } from "../../engine/design/suggest.ts";
import type { DecisionRecord, Design, IntentPlan, PartCard, Reasoner, Requirement, Viewing, Word } from "../../engine/design/types.ts";

export type DesignInputs = {
  plan: IntentPlan;
  /** Every spoken word of the video, with global numbers, so the plan's `@N` and the scene's frames are the video's own. */
  words: Word[];
  holds: { id: string; afterWord: number; seconds: number; purpose?: string }[];
  /** The part of the narration this plan covers. */
  range: { id: string; firstWord: number; lastWord: number };
  frames: number;
  cards: PartCard[];
  requirements: Requirement[];
  /** The user's pictures by card name, as URLs the renderer can load (data URLs for stills). */
  assets: Record<string, string>;
  /** The user's request and what the plan stage knows, in plain text. */
  brief: string;
  /** The direction's events for this part, in plain text. */
  direction?: string;
  theme: Theme;
  styleName: string;
  viewing: Viewing;
};

export type DesignResult = {
  scene: Scene;
  design: Design;
  decisions: DecisionRecord[];
  notes: string[];
  /** The director's corrections of the plan against the material or the world: each is shown, never silent. */
  corrections: DirectorAnswer["corrections"];
};

/** Runs the design brain on one plan, keeping its working files (candidates, sheets, readings) under `dir`. */
export type DesignRun = (dir: string, inputs: DesignInputs, reasoner: Reasoner, agents?: Agents) => Promise<DesignResult>;

/** One composition with the style's suggested design: no search, no agents. */
export const composeOnce: DesignRun = async (_dir, x) => {
  const design = suggestDesign(x.plan, x.viewing, x.theme, x.cards, x.words);
  const out = compose(x.plan, design, { theme: x.theme, words: x.words, frames: x.frames, cards: x.cards, assets: x.assets });
  return { scene: out.scene, design, decisions: [...design.decisions, ...out.decisions], notes: ["composed once with the style's suggested design: no design search was set", ...out.notes], corrections: [] };
};

let current: { run: DesignRun; agents?: Agents } = { run: composeOnce };

/** Sets the design brain the scene stage uses: the search's run function and the agents it calls. */
export function useDesignRun(run: DesignRun, agents?: Agents) {
  current = { run, agents };
}

export const designRunner = () => current;
