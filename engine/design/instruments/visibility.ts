// Visible and hidden: for each thing, how long it is on screen and clear, covered by something painted over it, cut by
// the frame's edge, inside a UI zone (the platform's captions and buttons, or room the director keeps clear), or
// withheld (never shown in the window). The bench's reveal and read measures asked parts of this; here it is one table.
import type { Instrument, MeasureInput, Reading, Viewing } from "../types.ts";
import { UI, area, covers, framesOf, meet, namesOf, round, sampled, windowOf, type Item, type Rect } from "./sample.ts";

export type VisibilitySettings = {
  perSecond: number;
  covered: number; // share of a thing's box under opaque things painted after it to count as covered
  cut: number; // share of its box outside the frame to count as cut
  ui: number; // share of its box inside UI zones to count as in a UI zone
  backdrop: number;
  why?: string;
};

type Row = { clear: number; covered: number; cut: number; ui: number; shown: number };

/** How a set of items stands on one frame: covered, cut, inside a UI zone. */
export function standing(items: Item[], all: Item[], W: number, H: number, zones: Rect[], set: VisibilitySettings): { covered: boolean; cut: boolean; ui: boolean } {
  const frame = { x0: 0, y0: 0, x1: W, y1: H };
  const box = items.reduce((b, t) => ({ x0: Math.min(b.x0, t.box.x0), y0: Math.min(b.y0, t.box.y0), x1: Math.max(b.x1, t.box.x1), y1: Math.max(b.y1, t.box.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const a = area(box);
  if (!a) return { covered: false, cut: false, ui: false };
  const top = Math.min(...items.map((t) => t.order));
  const units = new Set(items.map((t) => t.unit));
  // Opaque things painted later, from other units; their overlap with the box, capped at the box.
  const over = all.filter((t) => t.order > top && !units.has(t.unit) && t.filled && t.opacity > 0.85 && area(t.box) < W * H * set.backdrop);
  let hidden = 0;
  for (const o of over) hidden += area(meet(o.box, box));
  const inFrame = area(meet(box, frame));
  const inUi = zones.reduce((t, z) => t + area(meet(z, box)), 0);
  return { covered: Math.min(1, hidden / a) >= set.covered, cut: 1 - inFrame / a > set.cut, ui: inUi / a >= set.ui };
}

export const visibility: Instrument<VisibilitySettings> = {
  name: "visibility",
  describe:
    "For each named thing (or every thing, without an ids map): seconds on screen and clear, covered, cut by the frame, inside a UI zone, and whether it is withheld (never shown in the window). " +
    "Values: seen.<name>, covered.<name>, cut.<name>, ui.<name> (seconds), withheld.<name> (1 when never shown), and over all things: coveredShare, cutShare, uiShare (shares of on-screen thing-seconds). " +
    "Settings: covered, cut, ui (shares of a thing's box), perSecond.",
  suggest: (v: Viewing) => ({ perSecond: 4, covered: 0.5, cut: 0.04, ui: 0.25, backdrop: 0.8, why: `suggested for ${v.screen}: half covered hides a thing, 4% outside the frame shows as cut letters, a quarter inside a UI zone (${v.uiZones.map((z) => z.what).join(", ") || "none here"}) competes with it` }),
  measure(input: MeasureInput, set: VisibilitySettings): Reading {
    const s = sampled(input.scene);
    const range = windowOf(input);
    const frames = framesOf(s.fps, range, set.perSecond);
    const dt = (range[1] - range[0]) / Math.max(1, frames.length) / s.fps;
    const zones = UI(input.viewing, s.W, s.H);
    const names = namesOf(s, input);
    const rows = new Map<string, Row>(Object.keys(names).map((n) => [n, { clear: 0, covered: 0, cut: 0, ui: 0, shown: 0 }]));
    let tot = 0;
    let cov = 0;
    let cutN = 0;
    let uiN = 0;
    for (const f of frames) {
      const all = s.items(f);
      const things = s.things(f, set.backdrop);
      for (const t of things) {
        const st = standing(t.items, all, s.W, s.H, zones, set);
        tot++;
        cov += +st.covered;
        cutN += +st.cut;
        uiN += +st.ui;
      }
      for (const [name, ids] of Object.entries(names)) {
        const mine = all.filter((it) => ids.some((x) => covers(x, it)) && !(it.kind === "shape" && area(it.box) > s.W * s.H * set.backdrop));
        if (!mine.length) continue;
        const r = rows.get(name)!;
        const st = standing(mine, all, s.W, s.H, zones, set);
        r.shown++;
        if (st.covered) r.covered++;
        if (st.cut) r.cut++;
        if (st.ui) r.ui++;
        if (!st.covered && !st.cut && !st.ui) r.clear++;
      }
    }
    const values: Record<string, number> = { coveredShare: round(tot ? cov / tot : 0), cutShare: round(tot ? cutN / tot : 0), uiShare: round(tot ? uiN / tot : 0) };
    const notes: string[] = [];
    const named = !!input.ids && Object.keys(input.ids).length > 0;
    for (const [name, r] of rows) {
      if (named) {
        values[`seen.${name}`] = round(r.clear * dt, 2);
        values[`covered.${name}`] = round(r.covered * dt, 2);
        values[`cut.${name}`] = round(r.cut * dt, 2);
        values[`ui.${name}`] = round(r.ui * dt, 2);
      }
      if (named) values[`withheld.${name}`] = r.shown ? 0 : 1;
      if (r.covered || r.cut || r.ui) notes.push(`${name}: ${[r.covered && `covered ${(r.covered * dt).toFixed(1)} s`, r.cut && `cut by the frame ${(r.cut * dt).toFixed(1)} s`, r.ui && `in a UI zone ${(r.ui * dt).toFixed(1)} s`].filter(Boolean).join(", ")} of ${(r.shown * dt).toFixed(1)} s shown`);
      else if (named && !r.shown) notes.push(`${name}: not on screen in this window`);
    }
    return { instrument: "visibility", values, notes };
  },
};
