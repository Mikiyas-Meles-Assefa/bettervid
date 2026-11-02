// How motion accelerates. Each maps progress 0 to 1 onto eased progress, and may overshoot.
import type { Ease } from "./types.ts";

export const EASES: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  smooth: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  spring: (t) => (t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(11 * t)),
  bounce: (t) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
  step: (t) => (t < 1 ? 0 : 1),
  // Pulls back before it goes.
  anticipate: (t) => t * t * (2.7 * t - 1.7),
  // Goes too far, then comes back.
  overshoot: (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
  // Both of the above.
  swing: (t) => (t < 0.5 ? (2 * t) ** 2 * (3.6 * 2 * t - 2.6) / 2 : ((2 * t - 2) ** 2 * (3.6 * (2 * t - 2) + 2.6) + 2) / 2),
  elastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * 2 * Math.PI) / 3) + 1),
};
