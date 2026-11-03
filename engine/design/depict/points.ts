// Named points of a depiction, where it meets other things in a scene. The depicter names them (a deck's top, a post's
// top, a rope's ends, a seat), by the other thing's id or by the plan's own words for a place on the thing; a kind's
// own anchors (a surface, a mouth, an outlet) and parts are points too; and every depiction has the points of its box.
// Local units, origin at the base (bottom center), y up as negative numbers. Nothing here is about a topic.
import type { Depiction, Pt } from "./types.ts";

/** Words of a point's name, without articles or separators: "the far-end" and "far end" are one name. */
export const pointWords = (s: string) => s.toLowerCase().replace(/[_.-]+/g, " ").replace(/\b(the|its|a|an|of)\b/g, " ").replace(/\s+/g, " ").trim();

/** The points of a box w by h: its sides, corners and center. */
export function boxPoint(w: number, h: number, name: string): Pt | undefined {
  const n = pointWords(name);
  const x = /\bleft\b/.test(n) ? -w / 2 : /\bright\b/.test(n) ? w / 2 : 0;
  const y = /\b(top|upper)\b/.test(n) ? -h : /\b(bottom|base|lower)\b/.test(n) ? 0 : -h / 2;
  if (!/^(top|upper|bottom|base|lower|left|right|center|centre|middle)( (left|right|top|bottom|center|centre|middle))?$/.test(n)) return undefined;
  return [x, y];
}

/**
 * A named point of a depiction: the depicter's points first (by name, then by the one name that holds all the words
 * asked for: "end" finds "far end"), then the kind's anchors and parts, then its box's points. Undefined when
 * it has none by that name.
 */
export function pointOf(d: Depiction, name: string): Pt | undefined {
  const n = pointWords(name);
  if (!n) return undefined;
  const named = Object.entries(d.points ?? {});
  const exact = named.find(([k]) => pointWords(k) === n);
  if (exact) return exact[1];
  const want = n.split(" ");
  const loose = named.filter(([k]) => {
    const have = pointWords(k).split(" ");
    return want.every((w) => have.includes(w));
  });
  if (loose.length === 1) return loose[0]![1];
  const kind = d.anchor(name) ?? d.anchor(n);
  if (kind) return kind;
  return boxPoint(d.box.w, d.box.h, n);
}

/** The first of several names a depiction has a point by, with the name that found it. */
export function firstPoint(d: Depiction, names: (string | undefined)[]): { name: string; at: Pt } | undefined {
  for (const name of names) {
    if (!name) continue;
    const at = pointOf(d, name);
    if (at) return { name, at };
  }
  return undefined;
}
