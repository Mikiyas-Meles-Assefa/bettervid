// Ongoing motion, available to every kit and style. A behavior only writes tracks, so it renders like anything else.
import { EFFECTS } from "../motion/effects.ts";
import { MOVES } from "../motion/moves.ts";
import { PARTS } from "../motion/parts.ts";
import type { Behavior, Value } from "./types.ts";

const num = (v: Value | undefined, d: number) => (typeof v === "number" ? v : d);

export const BEHAVIORS: Record<string, Behavior> = {
  // A pulse of color travels the length of a line.
  flow: ({ target, start, args, ctx }) => {
    const frames = num(args.frames, ctx.theme.moveFrames * 2);
    return [
      { target, prop: "pulseColor", keys: [{ at: start, value: args.color ?? "accent" }] },
      { target, prop: "pulse", keys: [{ at: start, value: 0 }, { at: start + frames, value: 1, ease: "smooth" }, { at: start + frames + 1, value: -1, ease: "step" }] },
    ];
  },
  // A quick grow and return, to say "look here". An offset, so it can overlap a move or another pulse.
  pulse: ({ target, start, args, ctx }) => {
    const frames = num(args.frames, ctx.theme.moveFrames);
    const size = num(args.size, 1.25);
    return ["scaleX", "scaleY"].map((prop) => ({ target, prop, blend: "multiply" as const, keys: [{ at: start, value: 1 }, { at: start + frames / 2, value: size, ease: "out" as const }, { at: start + frames, value: 1, ease: "spring" as const }] }));
  },
  // A short shake on any number, side to side by default. An offset, so it survives a move underneath it.
  shake: ({ target, start, args }) => {
    const size = num(args.size, 14);
    const prop = typeof args.prop === "string" ? args.prop : "x";
    return [{ target, prop, blend: "add" as const, keys: [0, 1, -1, 0.6, -0.6, 0].map((d, i) => ({ at: start + i * 3, value: d * size, ease: "linear" as const })) }];
  },
  ...MOVES,
  ...PARTS,
  ...EFFECTS,
};
