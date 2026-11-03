// One interface for every depiction tier (docs/DESIGN-BRAIN.md 2.1): a box, named parts, and states. A verb the author
// writes maps to state changes declared as data by each kind of thing; `apply(state)` turns a state into property
// changes over time that the engine animates. Nothing here is about a topic.
//
// Local units: a depiction is drawn with its origin at its base (bottom center), y going up as negative numbers, inside
// `box` (x from -w/2 to w/2, y from -h to 0). The caller places and scales the root group; everything else is inside.
import type { Ease, NodeSpec, Value } from "../../core/types.ts";
import type { Decided } from "../types.ts";

export type Pt = [number, number];
export type StateValue = number | string | boolean | Pt;
export type StateMap = Record<string, StateValue>;

export type StateDef = {
  type: "number" | "color" | "angle" | "point" | "bool" | "text";
  about: string;
  min?: number;
  max?: number;
  unit?: string;
  initial: StateValue;
};

/** A named part: the node subtree that draws it, where it is (local units, at the initial state) and its box. */
export type Part = { node: string; anchor: Pt; box?: [number, number, number, number]; about: string };

/** One property change: `at` and `frames` are relative to the start of the change the caller asked for. */
export type Change = { id: string; prop: string; value: Value; at: number; frames: number; ease: Ease };

/** How long a state change takes and how it eases: always the caller's (the director's or the designer's). */
export type Timing = { frames: number; ease?: Ease; fps?: number };

/**
 * What a verb does, as data. `sets` changes states: to a fixed value, to the verb's argument, or by an amount.
 * `motion` is the shape of the change over its time: "to" goes and stays, "pulse" goes and comes back, "shake" goes
 * back and forth and settles, "cycle" runs a whole turn of a periodic state. `ease` is a physical ease where the
 * physics decides it (a fall accelerates). `needs` names parts the verb cannot work without.
 */
export type VerbSet = { state: string; value?: StateValue; arg?: boolean; by?: number };
export type VerbDef = {
  about: string;
  sets: VerbSet[];
  motion?: "to" | "pulse" | "shake" | "cycle";
  ease?: Ease;
  arg?: "number" | "color" | "text" | "point" | "angle" | "none";
  needs?: string[];
  /** The verb involves another thing (drips into, pours into, moves to): the caller passes it. */
  target?: boolean;
};

export type ActResult =
  | { known: true; verb: string; state: StateMap; changes: Change[]; notes: string[] }
  | { known: false; verb: string; notes: string[] };

/** How a depiction is drawn at its size on screen: values the caller decides (the designer, or the style's suggestion). */
export type DepictLook = {
  /** Stroke width of outlines in this depiction's local units (the caller knows its scale on screen). */
  line: Decided<number>;
  /** How strongly a glassy or glossy surface shows its highlight, 0 to 1. */
  shine: Decided<number>;
  /** How much shading gives volume to a body (a darker side, a deeper bottom), 0 to 1. */
  shade: Decided<number>;
  /** How far light reaches around a lit thing, local units. */
  glow: Decided<number>;
};

export interface Depiction {
  id: string;
  kind: string;
  form?: string;
  tier: 1 | 2 | 3 | 4;
  label: string;
  box: { w: number; h: number };
  /** The real size when it is a fact, so things side by side keep their true proportion. */
  size?: { w: number; h: number; unit: string };
  /** The root group `id` and its subtree, ready for a SceneDoc's `add`. */
  nodes: NodeSpec[];
  parts: Record<string, Part>;
  states: Record<string, StateDef>;
  /** The current state; `apply` and `act` move it. */
  state: StateMap;
  verbs: Record<string, VerbDef>;
  /** Named points where it meets other things in a scene (the depicter's), local units; see `pointOf`. */
  points?: Record<string, Pt>;
  /** Named points that depend on state (a liquid's surface, a mouth, an outlet, a needle's tip), local units. */
  anchor(name: string, state?: StateMap): Pt | undefined;
  /** Property changes that take the drawing from the current state to `next`, over the caller's timing. */
  apply(next: StateMap, timing: Timing): Change[];
  /** A verb from the author: the states it changes and the property changes that show it. */
  act(verb: string, arg?: StateValue, timing?: Timing): ActResult;
  /** What the thing reads at a state, in its own units, when it has a scale. */
  read?(state?: StateMap): string | undefined;
  /** The level (0 to 1, as the `level` state) where its scale reads a value, when it has a scale. */
  levelAt?(value: number): number | undefined;
  /** How much level one minor step of its scale spans: the smallest difference a reader of the scale can see. */
  minorLevel?: number;
  /** For things that hold something: the amount at a level (in `unit`, such as mL) and the level of an amount. */
  capacity?: { unit: string; at(level: number): number; levelOf(amount: number): number };
  notes: string[];
}
