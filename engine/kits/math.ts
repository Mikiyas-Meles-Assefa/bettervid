// Math: real typesetting by KaTeX where every symbol, fraction bar and bracket is its own part. Symbols are outlines,
// so they recolor and morph like any other shape. Equations can hold several states and rearrange symbol by symbol.
import type { CompileContext, Kit, NodeSpec } from "../core/types.ts";
import { buildCast, castEntry, castNodes, partBehaviors, register, type Atom, type Cast, type PartState } from "../layout/parts.ts";
import { glyph, joinRings, svgRings, type Pt } from "./math-font.ts";
import { EM, typeset, type Raw } from "./math-layout.ts";

export type MathData = {
  latex?: string;
  states?: string[]; // several forms of one equation; move between them with the `become` behavior
  size?: number; // pixels per em
  color?: string; // a theme name
  keep?: string; // a symbol, such as "=", that holds still from state to state
};

// Part names. Sets that are not groups (columns, named parts) go through the `each` and `swell` behaviors.
export const mathPart = {
  symbol: (m: string, n: number) => `${m}.sym.${n}`,
  frac: (m: string, f: number) => `${m}.frac.${f}`,
  num: (m: string, f: number) => `${m}.frac.${f}.num`,
  den: (m: string, f: number) => `${m}.frac.${f}.den`,
  matrix: (m: string, t = 0) => `${m}.matrix.${t}`,
  row: (m: string, r: number, t = 0) => `${m}.matrix.${t}.row.${r}`,
  cell: (m: string, r: number, c: number, t = 0) => `${m}.matrix.${t}.cell.${r}.${c}`,
};
// Sets for `part` arguments.
export const mathSet = { col: (c: number, t = 0) => `matrix.${t}.col.${c}`, row: (r: number, t = 0) => `matrix.${t}.row.${r}`, named: (name: string) => `named.${name}`, char: (c: string) => `char.${c}` };

function fontFile(r: Extract<Raw, { type: "char" }>): string {
  const name = r.family.replace(/^KaTeX_/, "");
  if (/^(AMS|Script|Typewriter|Size\d)$/.test(name)) return `KaTeX_${name}-Regular`;
  const style = `${r.weight >= 600 ? "Bold" : ""}${r.italic ? "Italic" : ""}` || "Regular";
  return `KaTeX_${name}-${style}`;
}

const center = (rings: Pt[][]) => {
  const all = rings.flat();
  const [xs, ys] = [all.map((p) => p[0]), all.map((p) => p[1])];
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { x: (left + right) / 2, y: (top + bottom) / 2, w: right - left, h: bottom - top };
};

function toAtoms(raw: Raw[], size: number, color: string): Atom[] {
  const k = size / EM;
  const shape = (rings: Pt[][], key: string, r: Raw): Atom => {
    const c = center(rings);
    const centred = rings.map((ring) => ring.map(([x, y]): Pt => [x - c.x, y - c.y]));
    return { key, chunk: r.chunk, x: c.x, y: c.y, w: c.w, h: c.h, kind: "path", home: r.home, of: r.of, props: { glyph: 1, points: joinRings(centred), closed: 1, fill: color } };
  };
  return raw.flatMap((r) => {
    if (r.type === "char") {
      const g = glyph(fontFile(r), r.char);
      if (!g.rings.length) return [];
      // The browser's text box runs from the font's ascent to its descent, which locates the baseline.
      const px = k * r.size;
      const baseline = (r.top + r.height * (g.ascent / (g.ascent + g.descent))) * k;
      const rings = g.rings.map((ring) => ring.map(([x, y]): Pt => [r.left * k + x * px, baseline + y * px]));
      return [shape(rings, r.char, r)];
    }
    if (r.type === "rule") {
      const [x, y, w, h] = [r.left * k, r.top * k, r.width * k, r.height * k];
      return [shape([[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]], "rule", r)];
    }
    const [a, b, c, d, e, f] = r.m as [number, number, number, number, number, number];
    const rings = svgRings(r.d).map((ring) => ring.map(([x, y]): Pt => [Math.min(r.clipRight, Math.max(r.clipLeft, a * x + c * y + e)) * k, (b * x + d * y + f) * k]));
    return rings.length ? [shape(rings, r.name, r)] : [];
  });
}

const cache = new WeakMap<CompileContext, Map<string, Cast>>();

export function layoutMath(id: string, d: MathData, ctx: CompileContext): Cast {
  const list = d.states ?? (d.latex !== undefined ? [d.latex] : []);
  if (!list.length) throw new Error(`${id} needs latex or states`);
  const size = d.size ?? 80;
  const key = JSON.stringify([id, list, size, d.color, d.keep]);
  const memo = cache.get(ctx) ?? cache.set(ctx, new Map()).get(ctx)!;
  const known = memo.get(key);
  if (known) return known;
  const raw = typeset(list);
  let pin: number | undefined;
  const states: PartState[] = raw.map((r) => {
    const atoms = toAtoms(r, size, d.color ?? "ink");
    const [xs, ys] = [atoms.flatMap((a) => [a.x - a.w / 2, a.x + a.w / 2]), atoms.flatMap((a) => [a.y - a.h / 2, a.y + a.h / 2])];
    const held = d.keep === undefined ? undefined : atoms.find((a) => a.key === d.keep);
    if (d.keep !== undefined && !held) throw new Error(`${id}: a state has no ${d.keep} to keep still`);
    const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    pin ??= held ? held.x - middle : undefined;
    const dx = held ? held.x - pin! : middle;
    const dy = (Math.min(...ys) + Math.max(...ys)) / 2;
    return { atoms: atoms.map((a) => ({ ...a, x: a.x - dx, y: a.y - dy })) };
  });
  const cast = buildCast(id, states, (_, i) => `sym.${i}`);
  memo.set(key, cast);
  return cast;
}

export const mathKit: Kit = {
  name: "math",
  kinds: {
    math: (n: NodeSpec, ctx) => {
      const cast = layoutMath(n.id, n.data as MathData, ctx);
      register(ctx, n.id, castEntry(cast, "sym"));
      // A formula is type: it is laid out at its own size, as words are, not stretched to fill its place.
      return castNodes(cast, n).map((x, i) => (i === 0 && x.id === n.id ? { ...x, props: { ...x.props, typeset: 1 } } : x));
    },
  },
  behaviors: partBehaviors,
};
