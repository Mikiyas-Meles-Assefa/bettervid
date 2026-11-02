// Ongoing motion, available to every kit and style. A behavior only writes tracks, so it renders like anything else.
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
  // A quick grow and return, to say "look here".
  pulse: ({ target, start, args, ctx, now }) => {
    const frames = num(args.frames, ctx.theme.moveFrames);
    const size = num(args.size, 1.25);
    return ["scaleX", "scaleY"].map((prop) => {
      const base = num(now(prop), 1);
      return { target, prop, keys: [{ at: start, value: base }, { at: start + frames / 2, value: base * size, ease: "out" as const }, { at: start + frames, value: base, ease: "spring" as const }] };
    });
  },
  // A short side-to-side shake.
  shake: ({ target, start, args, now }) => {
    const size = num(args.size, 14);
    const x = num(now("x"), 0);
    return [{ target, prop: "x", keys: [0, 1, -1, 0.6, -0.6, 0].map((d, i) => ({ at: start + i * 3, value: x + d * size, ease: "linear" as const })) }];
  },
};
