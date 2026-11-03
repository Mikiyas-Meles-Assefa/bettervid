// The depicter's answer: what a thing is, as a kind of thing with parameters, parts and colors. Colors of real things are
// facts from the material (the handout says faint pink) or plain knowledge, each with its source; structure (outlines,
// glass) takes the style's theme names. Sizes are real sizes, so things side by side keep their true proportion.
import type { StateMap, StateValue, VerbSet } from "./types.ts";

export type Unit = "mm" | "cm" | "m" | "km" | "in" | "ft";
export const UNIT_CM: Record<Unit, number> = { mm: 0.1, cm: 1, m: 100, km: 100000, in: 2.54, ft: 30.48 };

export type SpecVerb = { like?: string; arg?: StateValue; sets?: VerbSet[]; motion?: "to" | "pulse" | "shake" | "cycle"; about?: string };

export type PropSpec = {
  kind: string;
  form?: string;
  label: string;
  /** The real size, width and height as seen from the front. */
  size?: { w: number; h: number; unit: Unit };
  params?: Record<string, unknown>;
  /** Named colors of the real thing, as #rrggbb or #rrggbbaa; the kind says which names it reads. */
  colors?: Record<string, string>;
  /** Where each color comes from: a quote from the material, or "known: ..." for plain knowledge. */
  colorSources?: Record<string, string>;
  /** Starting states, by the kind's state names. */
  state?: StateMap;
  /**
   * Named points where it meets other things in the scene, [x, y] as 0 to 1 of its box (x from the left, y from the
   * top): a deck's top, a post's top, a rope's two ends, a seat. Named by the other thing's id or by the plan's own
   * words for a place on it ("far end"); top, bottom, left, right and center are its box's unless named here.
   */
  points?: Record<string, [number, number]>;
  /** The plan's own verbs for this thing, mapped onto the kind's verbs (`like`) or onto state changes (`sets`). */
  verbs?: Record<string, SpecVerb>;
  /** 1 drawn (default), 2 a generated sprite in the style, 3 the user's picture, 4 a found picture. */
  tier?: 1 | 2 | 3 | 4;
  /** For tier 2: the parts to cut (SAM phrases) and how each changes. */
  sprite?: { parts: { name: string; phrase: string; changes: ("tint" | "move" | "turn" | "hide")[] }[] };
  /** For tiers 3 and 4: the picture's part card name. */
  picture?: { card: string };
  why: string;
};

const pt = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 };
const stateValue = { anyOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }, pt] };

/** JSON schema of a PropSpec, for the depicter's AgentTask. Per kind parameters are described in the system prompt. */
export const PROP_SPEC_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["kind", "label", "why"],
  additionalProperties: false,
  properties: {
    kind: { type: "string", description: "one of the kinds of thing listed in the instructions" },
    form: { type: "string", description: "the kind's form, when it has forms" },
    label: { type: "string", description: "the plain name of the thing" },
    size: { type: "object", required: ["w", "h", "unit"], additionalProperties: false, properties: { w: { type: "number", exclusiveMinimum: 0 }, h: { type: "number", exclusiveMinimum: 0 }, unit: { enum: Object.keys(UNIT_CM) } } },
    params: { type: "object", description: "the kind's parameters, as the instructions list them" },
    colors: { type: "object", additionalProperties: { type: "string", pattern: "^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$" } },
    colorSources: { type: "object", additionalProperties: { type: "string" } },
    state: { type: "object", additionalProperties: stateValue },
    verbs: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: {
          like: { type: "string" },
          arg: stateValue,
          about: { type: "string" },
          motion: { enum: ["to", "pulse", "shake", "cycle"] },
          sets: { type: "array", items: { type: "object", required: ["state"], additionalProperties: false, properties: { state: { type: "string" }, value: stateValue, arg: { type: "boolean" }, by: { type: "number" } } } },
        },
      },
    },
    tier: { enum: [1, 2, 3, 4] },
    sprite: { type: "object", required: ["parts"], properties: { parts: { type: "array", items: { type: "object", required: ["name", "phrase", "changes"], properties: { name: { type: "string" }, phrase: { type: "string" }, changes: { type: "array", items: { enum: ["tint", "move", "turn", "hide"] } } } } } } },
    picture: { type: "object", required: ["card"], properties: { card: { type: "string" } } },
    why: { type: "string" },
  },
};

/** The schema with `points`, for a thing the plan places relative to others (only then is it asked for). */
export const PROP_SPEC_SCHEMA_PLACED: Record<string, unknown> = {
  ...PROP_SPEC_SCHEMA,
  properties: { ...(PROP_SPEC_SCHEMA.properties as Record<string, unknown>), points: { type: "object", description: "named points where it meets other things: [x, y], 0 to 1 of its box, x from the left, y from the top", additionalProperties: pt } },
};

/** A real size in centimetres, when the spec gives one. */
export const sizeCm = (s: PropSpec) => (s.size ? { w: s.size.w * UNIT_CM[s.size.unit], h: s.size.h * UNIT_CM[s.size.unit] } : undefined);
