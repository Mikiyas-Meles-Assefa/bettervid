// A simple packer that honours an arrangement: one anchor (the stage, or the subject) placed where the moment's design
// asks, and every other block placed around it in free space, so nothing overlaps. Arrangements:
//   stack   blocks before the anchor above it, blocks after it below, in rank order
//   row     blocks before the anchor to its left, after it to its right, each side a column
//   around  blocks take turns above, below, left and right of the anchor, where each fits best
//   split   the anchor takes one half of the frame along its long side; the rest share the other half
//   inset   the anchor stays large; the rest stand together in the largest free band, toward its outer corner
// An arrangement it does not know is packed as a stack and reported. The anchor may slide within the usable frame so
// what must be above or below it fits; the caller shrinks sizes when it still does not.
import type { Box, Viewing } from "../types.ts";

export type Rect = { x0: number; y0: number; x1: number; y1: number };
export const rw = (r: Rect) => r.x1 - r.x0;
export const rh = (r: Rect) => r.y1 - r.y0;
export const ARRANGEMENTS = ["stack", "row", "around", "split", "inset"] as const;

/** The usable frame: the frame inside its margin, with each UI zone cut away along the edge that loses least. */
export function usableRect(v: Pick<Viewing, "width" | "height" | "uiZones">, margin: number): { rect: Rect; cuts: string[] } {
  let r: Rect = { x0: margin, y0: margin, x1: v.width - margin, y1: v.height - margin };
  const cuts: string[] = [];
  for (const z of v.uiZones) {
    const [a, b, c, d] = z.box as Box;
    const zr: Rect = { x0: a * v.width, y0: b * v.height, x1: c * v.width, y1: d * v.height };
    if (zr.x1 <= r.x0 || zr.x0 >= r.x1 || zr.y1 <= r.y0 || zr.y0 >= r.y1) continue;
    // Four ways to keep clear of the zone: keep what is above, below, left or right of it. Keep the largest.
    const options: [string, Rect][] = [
      ["above", { ...r, y1: Math.min(r.y1, zr.y0 - margin * 0.5) }],
      ["below", { ...r, y0: Math.max(r.y0, zr.y1 + margin * 0.5) }],
      ["left of", { ...r, x1: Math.min(r.x1, zr.x0 - margin * 0.5) }],
      ["right of", { ...r, x0: Math.max(r.x0, zr.x1 + margin * 0.5) }],
    ];
    const best = options.filter(([, o]) => rw(o) > 0 && rh(o) > 0).sort((p, q) => rw(q[1]) * rh(q[1]) - rw(p[1]) * rh(p[1]))[0];
    if (!best) continue;
    r = best[1];
    cuts.push(`kept ${best[0]} the ${z.what}`);
  }
  return { rect: r, cuts };
}

/** The anchor's rectangle: w by h centered at `at` (fractions of the usable frame), kept inside it. */
export function anchorRect(U: Rect, w: number, h: number, at: [number, number]): Rect {
  const cx = Math.min(Math.max(U.x0 + at[0] * rw(U), U.x0 + w / 2), U.x1 - w / 2);
  const cy = Math.min(Math.max(U.y0 + at[1] * rh(U), U.y0 + h / 2), U.y1 - h / 2);
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}

/** For split: the half of the usable frame the anchor takes, and the half the rest share. */
export function splitHalves(U: Rect, at: [number, number]): { anchor: Rect; rest: Rect } {
  const wide = rw(U) >= rh(U);
  if (wide) {
    const mx = (U.x0 + U.x1) / 2;
    const left = { ...U, x1: mx };
    const right = { ...U, x0: mx };
    return at[0] <= 0.5 ? { anchor: left, rest: right } : { anchor: right, rest: left };
  }
  const my = (U.y0 + U.y1) / 2;
  const top = { ...U, y1: my };
  const bottom = { ...U, y0: my };
  return at[1] <= 0.5 ? { anchor: top, rest: bottom } : { anchor: bottom, rest: top };
}

/** How wide blocks on each side may be, for an arrangement, before they are built. */
export function sideWidths(arrangement: string, U: Rect, A: Rect, gap: number): { before: number; after: number } {
  switch (arrangement) {
    case "row":
      return { before: Math.max(0, A.x0 - U.x0 - gap), after: Math.max(0, U.x1 - A.x1 - gap) };
    case "split": {
      const rest = rw(A) < rw(U) - 1 && Math.abs(A.y0 - U.y0) < 1 && Math.abs(A.y1 - U.y1) < 1 ? rw(U) - rw(A) - gap : rw(U);
      return { before: rest, after: rest };
    }
    default:
      return { before: rw(U), after: rw(U) };
  }
}

export type PackItem = { key: string; w: number; h: number; before: boolean };
export type Packed = { anchor: Rect; rects: Map<string, Rect>; fits: boolean; over: number; arrangement: string };

const column = (items: PackItem[], gap: number) => items.reduce((s, b) => s + b.h, 0) + gap * Math.max(0, items.length - 1);
const centeredX = (U: Rect, cx: number, w: number) => Math.min(Math.max(cx, U.x0 + w / 2), Math.max(U.x0 + w / 2, U.x1 - w / 2));

/** Places a column of items top-down from y inside x-center cx. */
function placeColumn(out: Map<string, Rect>, items: PackItem[], U: Rect, cx: number, y: number, gap: number) {
  for (const b of items) {
    const x = centeredX(U, cx, b.w);
    out.set(b.key, { x0: x - b.w / 2, y0: y, x1: x + b.w / 2, y1: y + b.h });
    y += b.h + gap;
  }
}

/** `fixed`: the anchor keeps exactly its place (a stage that persists); otherwise it may slide so what is around it fits. */
export function pack(arrangement: string, U: Rect, A0: Rect, items: PackItem[], gap: number, fixed = false): Packed {
  const known = (ARRANGEMENTS as readonly string[]).includes(arrangement);
  const arr = known ? arrangement : "stack";
  const rects = new Map<string, Rect>();
  let A = { ...A0 };
  const before = items.filter((b) => b.before);
  const after = items.filter((b) => !b.before);
  const acx = () => (A.x0 + A.x1) / 2;
  const acy = () => (A.y0 + A.y1) / 2;
  if (arr === "stack" || arr === "around" || arr === "inset") {
    let up = before;
    let down = after;
    let left: PackItem[] = [];
    let right: PackItem[] = [];
    if (arr === "around") {
      // Take turns: above, below, left, right; each goes where it fits, the side with the most room first.
      up = [];
      down = [];
      const sides: { list: PackItem[]; room: () => number; fit: (b: PackItem) => boolean }[] = [
        { list: up, room: () => A.y0 - U.y0 - column(up, gap) - (up.length ? gap : 0), fit: (b) => b.w <= rw(U) },
        { list: down, room: () => U.y1 - A.y1 - column(down, gap) - (down.length ? gap : 0), fit: (b) => b.w <= rw(U) },
        { list: left, room: () => (A.x0 - U.x0) * rh(A) - left.reduce((s, b) => s + b.w * b.h, 0), fit: (b) => b.w + gap <= A.x0 - U.x0 && column([...left, b], gap) <= rh(A) },
        { list: right, room: () => (U.x1 - A.x1) * rh(A) - right.reduce((s, b) => s + b.w * b.h, 0), fit: (b) => b.w + gap <= U.x1 - A.x1 && column([...right, b], gap) <= rh(A) },
      ];
      items.forEach((b, i) => {
        const turn = [sides[i % 4]!, ...sides].filter((s, j, all) => all.indexOf(s) === j);
        const fitting = turn.filter((s) => s.fit(b) && (s.list === up || s.list === down ? s.room() >= b.h + gap : true));
        (fitting[0] ?? sides[b.before ? 0 : 1]!).list.push(b);
      });
    }
    if (arr === "inset") {
      // Everything else in the largest band around the anchor.
      const bands = [
        { side: "up", area: rw(U) * (A.y0 - U.y0) },
        { side: "down", area: rw(U) * (U.y1 - A.y1) },
        { side: "left", area: (A.x0 - U.x0) * rh(U) },
        { side: "right", area: (U.x1 - A.x1) * rh(U) },
      ].sort((p, q) => q.area - p.area);
      up = [];
      down = [];
      const side = bands[0]!.side;
      if (side === "up") up = items;
      else if (side === "down") down = items;
      else if (side === "left") left = items;
      else right = items;
    }
    const needUp = up.length ? column(up, gap) + gap : 0;
    const needDown = down.length ? column(down, gap) + gap : 0;
    // Slide the anchor so what goes above and below fits, when the frame has the room.
    if (!fixed && needUp + rh(A) + needDown <= rh(U) + 0.5) {
      const y0 = Math.min(Math.max(A.y0, U.y0 + needUp), U.y1 - needDown - rh(A));
      A = { ...A, y0, y1: y0 + rh(A0) };
    }
    placeColumn(rects, up, U, arr === "inset" ? centeredX(U, U.x0 + Math.max(...up.map((b) => b.w), 0) / 2, 0) : acx(), A.y0 - needUp, gap);
    placeColumn(rects, down, U, arr === "inset" ? centeredX(U, U.x1 - Math.max(...down.map((b) => b.w), 0) / 2, 0) : acx(), A.y1 + gap, gap);
    for (const [list, sideLeft] of [[left, true], [right, false]] as const) {
      if (!list.length) continue;
      const wmax = Math.max(...list.map((b) => b.w));
      const cx = sideLeft ? A.x0 - gap - wmax / 2 : A.x1 + gap + wmax / 2;
      const hcol = column(list, gap);
      const y = arr === "inset" ? (sideLeft ? U.y1 - hcol : U.y0) : Math.min(Math.max(acy() - hcol / 2, U.y0), U.y1 - hcol);
      placeColumn(rects, list, { x0: sideLeft ? U.x0 : A.x1 + gap, y0: U.y0, x1: sideLeft ? A.x0 - gap : U.x1, y1: U.y1 }, cx, y, gap);
    }
  } else if (arr === "row") {
    const wl = before.length ? Math.max(...before.map((b) => b.w)) + gap : 0;
    const wr = after.length ? Math.max(...after.map((b) => b.w)) + gap : 0;
    if (!fixed && wl + rw(A) + wr <= rw(U) + 0.5) {
      const x0 = Math.min(Math.max(A.x0, U.x0 + wl), U.x1 - wr - rw(A));
      A = { ...A, x0, x1: x0 + rw(A0) };
    }
    for (const [list, sideLeft] of [[before, true], [after, false]] as const) {
      if (!list.length) continue;
      const wmax = Math.max(...list.map((b) => b.w));
      const cx = sideLeft ? A.x0 - gap - wmax / 2 : A.x1 + gap + wmax / 2;
      const hcol = column(list, gap);
      placeColumn(rects, list, { x0: sideLeft ? U.x0 : A.x1 + gap, y0: U.y0, x1: sideLeft ? A.x0 - gap : U.x1, y1: U.y1 }, cx, Math.min(Math.max(acy() - hcol / 2, U.y0), Math.max(U.y0, U.y1 - hcol)), gap);
    }
  } else {
    // split: the rest share the half the anchor left, as one centered column in rank order.
    const wide = rw(U) >= rh(U);
    const rest: Rect = wide ? (acx() < (U.x0 + U.x1) / 2 ? { ...U, x0: A.x1 + gap } : { ...U, x1: A.x0 - gap }) : acy() < (U.y0 + U.y1) / 2 ? { ...U, y0: A.y1 + gap } : { ...U, y1: A.y0 - gap };
    const hcol = column(items, gap);
    placeColumn(rects, items, rest, (rest.x0 + rest.x1) / 2, Math.max(rest.y0, (rest.y0 + rest.y1) / 2 - hcol / 2), gap);
  }
  // How far anything runs outside the usable frame or into another block.
  let over = 0;
  const all = [A, ...rects.values()];
  for (const r of all) over += Math.max(0, U.x0 - r.x0) + Math.max(0, r.x1 - U.x1) + Math.max(0, U.y0 - r.y0) + Math.max(0, r.y1 - U.y1);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) over += overlap(all[i]!, all[j]!);
  return { anchor: A, rects, fits: over < 0.5, over, arrangement: arr };
}

/** The overlap of two rectangles along their shorter crossing, 0 when apart. */
export function overlap(a: Rect, b: Rect): number {
  const x = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const y = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return x > 0.5 && y > 0.5 ? Math.min(x, y) : 0;
}
