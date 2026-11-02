// Seeded randomness. The same seed and name always give the same numbers, so frames stay pure.
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function seeded(seed: number | string): () => number {
  let a = (typeof seed === "number" ? seed : hash(seed)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth noise over time, between -1 and 1.
export function noise(t: number, seed: number): number {
  const at = (i: number) => seeded(seed + Math.imul(i, 2654435761))() * 2 - 1;
  const i = Math.floor(t);
  const u = t - i;
  const s = u * u * (3 - 2 * u);
  return at(i) + (at(i + 1) - at(i)) * s;
}
