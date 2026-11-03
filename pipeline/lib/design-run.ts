// Where the scene stage hands an intent plan to the design brain: runDesign (engine/design/search/design.ts), the one
// run that asks the depicter and the director, searches every moment with the designer and the viewer panel, composes
// the whole video and measures it against the director's goals. The scene stage depends only on this contract;
// `useDesignRun` sets another run or other agents (tests inject fakes there).
//
// In production the Reasoner is a Meta model, which always answers (or fails loudly), so a run never stays pending; a
// run that does is an error, never a lesser composition.
import type { Scene, Theme } from "../../engine/core/types.ts";
import type { DirectorAnswer } from "../../engine/design/agents/api.ts";
import { brainAgents, runDesign, type DesignAgents, type DesignInputs, type DesignOptions } from "../../engine/design/search/design.ts";
import { remotionStills, type StillRenderer } from "../../engine/design/search/sheet.ts";
import type { DecisionRecord, Design, Reasoner } from "../../engine/design/types.ts";

export type { DesignInputs };

export type DesignResult = {
  scene: Scene;
  design: Design;
  decisions: DecisionRecord[];
  notes: string[];
  /** The director's corrections of the plan against the material or the world: each is shown, never silent. */
  corrections: DirectorAnswer["corrections"];
};

/** Runs the design brain on one plan, keeping its working files (tasks, sheets, readings, decisions) under `dir`. */
export type DesignRun = (dir: string, inputs: DesignInputs, reasoner: Reasoner, agents?: DesignAgents) => Promise<DesignResult>;

/**
 * The design brain with the given options: repair rounds, and stills for the contact sheets the designer and the viewer
 * panel look at (a renderer, or one made for the video's theme).
 */
export function designRun(opts: Omit<DesignOptions, "stills"> & { stills?: StillRenderer | ((theme: Theme) => StillRenderer) } = {}): DesignRun {
  return async (dir, inputs, reasoner, agents) => {
    const stills = typeof opts.stills === "function" ? opts.stills(inputs.theme) : opts.stills;
    const r = await runDesign(dir, inputs, reasoner, agents ?? brainAgents, { ...opts, stills });
    if (r.status === "pending") throw new Error(`the design brain is waiting on ${r.waiting.length} agent task${r.waiting.length > 1 ? "s" : ""} the reasoner did not answer: ${r.waiting.slice(0, 3).join(", ")}`);
    return { scene: r.scene, design: r.design, decisions: r.decisions, notes: r.notes, corrections: r.corrections };
  };
}

// Contact sheets are rendered small (a fifth of the frame) with the engine's preview composition; the stills are deleted
// once a sheet is joined.
let current: { run: DesignRun; agents?: DesignAgents } = { run: designRun({ stills: (theme) => remotionStills({ theme, scale: 0.2 }) }), agents: brainAgents };

/** Sets the design brain the scene stage uses: the run function and the agents it calls. */
export function useDesignRun(run: DesignRun, agents?: DesignAgents) {
  current = { run, agents };
}

export const designRunner = () => current;
