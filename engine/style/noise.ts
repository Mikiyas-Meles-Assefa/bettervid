// Seeded noise. The same seed and position always give the same number, so a hand-drawn line looks identical on every
// frame and in every render. Nothing here reads a clock or any outside randomness.
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// A number from 0 to 1 for a seed and an index.
export function random(seed: number, i: number): number {
  let t = (Math.imul(seed | 0, 31) + Math.imul(i | 0, -1640531535) + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Smooth noise along a line, from -1 to 1.
export function noise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return (random(seed, i) * (1 - s) + random(seed, i + 1) * s) * 2 - 1;
}

// The slow drift of a hand, with a little quicker tremor on top.
export const drift = (seed: number, s: number) => noise(seed, s / 95) * 0.72 + noise(seed + 11, s / 29) * 0.28;
