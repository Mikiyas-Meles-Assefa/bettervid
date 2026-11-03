// A board: one canvas larger than the frame, written state by state while the camera travels over it. Layout places it
// (its top left screen is the frame at rest); this works out what was written in a state and, when the scene turned
// the follow on, where the camera goes to show it.
import type { Box } from "./layout.ts";
import type { Item } from "./syntax.ts";

export type View = { panX: number; panY: number; zoom: number };
export const BOARD_FOLLOW = ["writing", "no"];

// What is written on a board, piece by piece: each atom by its words, every other thing by what it is and says. A
// piece whose entry changes between two states was written (or rewritten) in the later one.
export function writingOf(board: Item): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (i: Item) => {
    if (i.kind === "atoms") {
      for (const p of i.parts ?? []) for (const a of p.type === "text" ? [p.atom] : p.type === "frac" ? [...p.num, ...p.den] : p.rows.flat()) out.set(a.id, a.text);
    } else if (i.children.length) i.children.forEach(walk);
    else out.set(i.id, JSON.stringify([i.kind, i.text ?? "", i.lines ?? [], i.attrs.asset ?? "", i.edges ?? [], i.attrs.w ?? "", i.attrs.h ?? ""]));
  };
  board.children.forEach(walk);
  return out;
}

// Where the camera goes to show what was just written: at the zoom the writing was laid out for (closer never, wider
// only when the writing is larger than a screen), moving as little as it must to hold it whole in the part of the
// frame clear of captions, and never showing past the board's edges. Undefined when it already shows it.
export function followWriting(region: Box, board: Box, view: View, safe: Box, W: number, H: number): View | undefined {
  const zoom = Math.min(1, safe.w / Math.max(1, region.w), safe.h / Math.max(1, region.h));
  const same = Math.abs(view.zoom - zoom) < 1e-3;
  // The safe area as a view shows it, in the board's coordinates.
  const shift = { x: (safe.x - W / 2) / zoom, y: (safe.y - H / 2) / zoom };
  const [hw, hh] = [safe.w / zoom / 2, safe.h / zoom / 2];
  let [cx, cy] = same ? [view.panX + shift.x, view.panY + shift.y] : [region.x, region.y];
  // Shift each way only as far as the writing needs: its far edge in, then its near edge (the near edge wins).
  const fit = (c: number, half: number, lo: number, hi: number) => {
    let at = c;
    if (hi > at + half) at = hi - half;
    if (lo < at - half) at = lo + half;
    return at;
  };
  cx = fit(cx, hw, region.x - region.w / 2, region.x + region.w / 2);
  cy = fit(cy, hh, region.y - region.h / 2, region.y + region.h / 2);
  // Inside the board, or centered on it where the view is wider than the board.
  const keep = (c: number, half: number, mid: number, size: number) => (half * 2 >= size ? mid : Math.min(Math.max(c, mid - size / 2 + half), mid + size / 2 - half));
  cx = keep(cx, hw, board.x, board.w);
  cy = keep(cy, hh, board.y, board.h);
  const next = { panX: Math.round((cx - shift.x) * 10) / 10, panY: Math.round((cy - shift.y) * 10) / 10, zoom: Math.round(zoom * 10000) / 10000 };
  return same && Math.abs(next.panX - view.panX) < 0.5 && Math.abs(next.panY - view.panY) < 0.5 ? undefined : next;
}
