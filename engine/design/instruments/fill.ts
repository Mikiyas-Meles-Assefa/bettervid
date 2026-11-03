// Fill and balance: how much of the usable frame (the frame outside its UI zones) holds anything, the tallest empty
// band and widest empty column, and where the visual weight sits: left against right, top against bottom, and its
// center of mass. Weight is area times contrast (Arnheim's visual weight: larger and stronger reads heavier).
// Works on any frame shape: the grid's cells are square, so a 16:9 frame gets more columns than rows.
import type { Instrument, MeasureInput, Reading, Viewing } from "../types.ts";
import { UI, area, clamp, framesOf, mean, meet, round, sampled, windowOf, type Rect } from "./sample.ts";

export type FillSettings = {
  perSecond: number;
  cells: number; // grid cells along the frame's shorter side
  occupied: number; // share of a cell something must cover to count it used
  backdrop: number;
  settled: boolean; // measure only frames where at most `busy` things change (what a viewer sees settle)
  busy: number;
  contrastWeight: number; // 0 to 1: how much contrast adds to a thing's visual weight beside its area
  pictureContrast: number; // the contrast a picture is taken to have (the scene does not know its pixels)
  why?: string;
};

export const fill: Instrument<FillSettings> = {
  name: "fill",
  describe:
    "Fill and balance of the usable frame (outside UI zones). Values: filled (share of usable cells with anything in them), emptyBand (tallest run of empty rows, share of the usable height), emptyColumn (widest run of empty columns, share of the width), " +
    "massX and massY (center of visual weight, 0 to 1 across the frame), balanceX (right minus left weight over their sum, -1 to 1), balanceY (bottom minus top). Series per frame. " +
    "Settings: cells (grid cells along the shorter side), occupied, settled and busy (skip frames caught mid change), perSecond.",
  suggest: (v: Viewing) => ({ perSecond: 2, cells: 9, occupied: 0.15, backdrop: 0.8, settled: true, busy: 2, contrastWeight: 0.7, pictureContrast: 0.6, why: `suggested for ${v.screen}: a 9-cell grid on the shorter side as the bench used, read on settled frames as a viewer sees a layout` }),
  measure(input: MeasureInput, set: FillSettings): Reading {
    const s = sampled(input.scene);
    const range = windowOf(input);
    const cell = Math.min(s.W, s.H) / set.cells;
    const [cols, rows] = [Math.max(1, Math.round(s.W / cell)), Math.max(1, Math.round(s.H / cell))];
    const zones = UI(input.viewing, s.W, s.H);
    const cells: (Rect & { usable: boolean; r: number; c: number })[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const b = { x0: (c * s.W) / cols, x1: ((c + 1) * s.W) / cols, y0: (r * s.H) / rows, y1: ((r + 1) * s.H) / rows };
        const inUi = zones.reduce((t, z) => t + area(meet(z, b)), 0) / area(b);
        cells.push({ ...b, usable: inUi < 0.5, r, c });
      }
    const usable = cells.filter((c) => c.usable);
    const usableRows = [...new Set(usable.map((c) => c.r))];
    const usableCols = [...new Set(usable.map((c) => c.c))];
    const frames = framesOf(s.fps, range, set.perSecond).filter((f) => !set.settled || s.act.filter((a) => a[f]).length <= set.busy);
    const series: Reading["series"] = [];
    const acc = { filled: [] as number[], band: [] as number[], column: [] as number[], mx: [] as number[], my: [] as number[], bx: [] as number[], by: [] as number[] };
    for (const f of frames) {
      const things = s.things(f, set.backdrop);
      const items = things.flatMap((t) => t.items).filter((t) => t.opacity >= 0.15);
      const used = new Set(usable.filter((c) => items.some((t) => area(meet(t.box, c)) > area(c) * set.occupied)).map((c) => `${c.r},${c.c}`));
      const isUsed = (r: number, c: number) => used.has(`${r},${c}`);
      const filled = usable.length ? used.size / usable.length : 0;
      let band = 0;
      for (let k = 0, run = 0; k < usableRows.length; k++) {
        run = usableCols.some((c) => isUsed(usableRows[k]!, c)) ? 0 : run + 1;
        band = Math.max(band, run);
      }
      let column = 0;
      for (let k = 0, run = 0; k < usableCols.length; k++) {
        run = usableRows.some((r) => isUsed(r, usableCols[k]!)) ? 0 : run + 1;
        column = Math.max(column, run);
      }
      // Visual weight: each thing's covered area times its contrast  and fade.
      let [w, wx, wy, L, R, T, B] = [0, 0, 0, 0, 0, 0, 0];
      for (const t of things) {
        const c = t.contrast === undefined ? set.pictureContrast : clamp(Math.log(t.contrast) / Math.log(21));
        const weight = t.area * (1 - set.contrastWeight + set.contrastWeight * c) * Math.min(1, t.opacity);
        const [cx, cy] = [(t.box.x0 + t.box.x1) / 2, (t.box.y0 + t.box.y1) / 2];
        w += weight;
        wx += weight * cx;
        wy += weight * cy;
        const share = (a: number, b: number, mid: number) => (b <= mid ? 1 : a >= mid ? 0 : (mid - a) / Math.max(1, b - a));
        const left = share(t.box.x0, t.box.x1, s.W / 2);
        const upper = share(t.box.y0, t.box.y1, s.H / 2);
        L += weight * left;
        R += weight * (1 - left);
        T += weight * upper;
        B += weight * (1 - upper);
      }
      const v = { filled, band: usableRows.length ? band / usableRows.length : 0, column: usableCols.length ? column / usableCols.length : 0, mx: w ? wx / w / s.W : 0.5, my: w ? wy / w / s.H : 0.5, bx: L + R ? (R - L) / (R + L) : 0, by: T + B ? (B - T) / (T + B) : 0 };
      acc.filled.push(v.filled);
      acc.band.push(v.band);
      acc.column.push(v.column);
      acc.mx.push(v.mx);
      acc.my.push(v.my);
      acc.bx.push(v.bx);
      acc.by.push(v.by);
      series.push({ frame: f, values: { filled: round(v.filled), emptyBand: round(v.band), balanceX: round(v.bx), balanceY: round(v.by) } });
    }
    const values = { filled: round(mean(acc.filled)), emptyBand: round(mean(acc.band)), emptyColumn: round(mean(acc.column)), massX: round(mean(acc.mx)), massY: round(mean(acc.my)), balanceX: round(mean(acc.bx)), balanceY: round(mean(acc.by)), frames: frames.length };
    const notes: string[] = [];
    if (!frames.length) notes.push("no settled frame in this window");
    else {
      notes.push(`${Math.round(values.filled * 100)}% of the usable frame holds something (${cols} by ${rows} cells${zones.length ? `, ${cells.length - usable.length} in UI zones left out` : ""}); tallest empty band ${Math.round(values.emptyBand * 100)}% of the height`);
      notes.push(`weight sits at ${Math.round(values.massX * 100)}% across and ${Math.round(values.massY * 100)}% down`);
    }
    return { instrument: "fill", values, notes, series };
  },
};
