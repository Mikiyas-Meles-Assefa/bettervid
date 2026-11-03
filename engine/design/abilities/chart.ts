// Redraw material: a chart that comes with its data is redrawn in the style, every bar addressable, starting exactly on
// the original picture's bars ("photo"), then moving to its own layout ("own") in either orientation, with its own
// words (title, a total) as header rows, values written once a part has been looked at, and level lines on its scale.
import type { Box, ChartData } from "../types.ts";
import { REFW, type Pic } from "./picture.ts";
import type { St, Triple } from "./types.ts";
import type { Writer } from "./writer.ts";

export type Chart = Pic & { data: ChartData & { ymax: number }; barsOf: Map<string, number[]> };

/** A round ceiling for a scale when the data gives none: the next 1, 2 or 5 times a power of ten above the largest value. */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= v * 1.0001) return m * e;
  return 10 * e;
}

/** Which bars each named part covers: the bars whose centers fall inside the part's box on the original picture. */
export function barsOfParts(data: ChartData & { ymax: number }, parts: Map<string, Box>): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (!data.plot) return out;
  const n = data.values.length;
  const [px0, py0, px1, py1] = data.plot;
  for (const [part, [u0, v0, u1, v1]] of parts) {
    const idx = data.values.map((_, i) => i).filter((i) => {
      const [u, v] = data.orient === "h" ? [px0 + ((data.values[i]! / data.ymax) * (px1 - px0)) / 2, py0 + ((i + 0.5) * (py1 - py0)) / n] : [px0 + ((i + 0.5) * (px1 - px0)) / n, (py0 + py1) / 2];
      return u >= u0 && u <= u1 && (data.orient !== "h" || (v >= v0 && v <= v1));
    });
    if (idx.length) out.set(part, idx);
  }
  return out;
}

export type ChartLook = {
  small: number; // px: category labels and small header rows
  valueFs: number; // px: values written at the bars
  headBig: number; // px: a header row that is the subject
  headShare: number; // a large header row takes at most this share of the chart's width
  rowLine: number; // em: the height of a header or label row
  gap: number; // px between header rows and the plot
  barFrac: number; // share of a slot a bar takes, in the chart's own layout
  photoBarFrac: number; // share of a slot a bar takes on the original, when its reading does not say
  dimBars: number; // opacity of bars not in focus while a part is held
  dimText: number; // opacity of words not in focus
  labelOpacity: number; // opacity of labels with nothing in focus
  levelPad: number; // px a level line runs past its bars
  em: (t: string) => number;
};

type BarR = { x0: number; y0: number; x1: number; y1: number };
const barRect = (b: BarR) => [b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1].map((v) => Math.round(v * 10) / 10);
export type ChartGeom = { hz: boolean; bars: BarR[]; axis: BarR; scale: number; labels: { x: number; y: number; left: boolean }[]; heads: Record<string, number>; headX: number; pw: number; ph: number };

export function chartGeom(st: St, p: Chart, mode: "own" | "photo", L: ChartLook): ChartGeom {
  const d = p.data;
  const n = d.values.length;
  const hz = d.orient === "h";
  const heads = Object.keys(d.texts ?? {});
  if (mode === "photo") {
    const pw = st.w;
    const ph = (pw * p.h) / p.w;
    const left = st.x - pw / 2;
    const top = st.y - ph / 2;
    const [u0, v0, u1, v1] = d.plot ?? [0, 0, 1, 1];
    const [X0, Y0, X1, Y1] = [left + u0 * pw, top + v0 * ph, left + u1 * pw, top + v1 * ph];
    const bf = d.barFrac ?? L.photoBarFrac;
    const bars: BarR[] = d.values.map((v, i) => {
      if (hz) {
        const slot = (Y1 - Y0) / n;
        const cy = Y0 + (i + 0.5) * slot;
        return { x0: X0, x1: X0 + (v / d.ymax) * (X1 - X0), y0: cy - (slot * bf) / 2, y1: cy + (slot * bf) / 2 };
      }
      const slot = (X1 - X0) / n;
      const cx = X0 + (i + 0.5) * slot;
      return { x0: cx - (slot * bf) / 2, x1: cx + (slot * bf) / 2, y1: Y1, y0: Y1 - (v / d.ymax) * (Y1 - Y0) };
    });
    const headY = Object.fromEntries(heads.map((h) => [h, p.parts.get(h) ? top + ((p.parts.get(h)![1] + p.parts.get(h)![3]) / 2) * ph : top]));
    const labels = bars.map((b) => (hz ? { x: left + u0 * pw * 0.1, y: (b.y0 + b.y1) / 2, left: true } : { x: (b.x0 + b.x1) / 2, y: b.y1 + (1 - v1) * ph * 0.5, left: false }));
    return { hz, bars, axis: hz ? { x0: X0, y0: Y0, x1: X0, y1: Y1 } : { x0: X0, y0: Y1, x1: X1, y1: Y1 }, scale: hz ? (X1 - X0) / d.ymax : (Y1 - Y0) / d.ymax, labels, heads: headY, headX: left + u0 * pw * 0.15, pw, ph };
  }
  const left = st.x - st.w / 2;
  const top = st.y - st.h / 2;
  // Header rows: the chart's own words, one row each above the plot, with room for one set large.
  const headH = heads.length ? L.headBig * L.rowLine + (heads.length - 1) * L.small * L.rowLine + L.gap : 0;
  const headY = Object.fromEntries(heads.map((h, i) => [h, top + L.headBig * 0.6 + i * L.small * L.rowLine]));
  if (hz) {
    // One row per bar: the category name above its bar, the value at the bar's end.
    const plotTop = top + headH + L.gap;
    const slot = (st.y + st.h / 2 - plotTop) / n;
    const valueRoom = L.em("0000") * L.valueFs + L.gap * 1.5;
    const len = st.w - valueRoom;
    const labelRoom = L.small * L.rowLine;
    const thick = Math.max(L.small * 0.4, Math.min(slot - labelRoom, slot * L.barFrac));
    const bars: BarR[] = d.values.map((v, i) => {
      const y0 = plotTop + i * slot + labelRoom;
      return { x0: left, x1: left + (v / d.ymax) * len, y0, y1: y0 + thick };
    });
    return { hz, bars, axis: { x0: left, y0: plotTop + labelRoom * 0.7, x1: left, y1: st.y + st.h / 2 }, scale: len / d.ymax, labels: bars.map((b) => ({ x: left, y: b.y0 - labelRoom * 0.45, left: true })), heads: headY, headX: left, pw: st.w, ph: st.h };
  }
  const labH = L.small * L.rowLine * 1.15;
  const base = top + st.h - labH;
  const plotH = base - (top + headH + L.gap + L.valueFs * L.rowLine);
  const slot = st.w / n;
  const m = (1 - L.barFrac) / 2;
  const bars: BarR[] = d.values.map((v, i) => ({ x0: left + (i + m) * slot, x1: left + (i + 1 - m) * slot, y1: base, y0: base - (v / d.ymax) * plotH }));
  return { hz, bars, axis: { x0: left, y0: base, x1: left + st.w, y1: base }, scale: plotH / d.ymax, labels: bars.map((b) => ({ x: (b.x0 + b.x1) / 2, y: base + labH / 2, left: false })), heads: headY, headX: left, pw: st.w, ph: st.h };
}

/** The screen box of a part of the redrawn chart (the bars it covers, or a header row). */
export function chartPartBox(st: St, p: Chart, part: string, L: ChartLook) {
  const g = chartGeom(st, p, "own", L);
  const bs = (p.barsOf.get(part) ?? []).map((i) => g.bars[i]!);
  if (!bs.length) return { x0: st.x - st.w / 2, y0: st.y - st.h / 2, x1: st.x + st.w / 2, y1: st.y - st.h / 2 + L.headBig };
  return { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) };
}

export function chartNodes(w: Writer, id: string, p: Chart, c: { subject: string; muted: string; pointer: string; small: number; valueFs: number; baseWidth: number; levelWidth: number }) {
  const rh = (REFW * p.h) / p.w;
  w.node(id, "group", { opacity: 0, scaleX: 0.01, scaleY: 0.01, x: w.width / 2, y: w.height / 2, clip: [-REFW / 2, -rh / 2, REFW / 2, -rh / 2, REFW / 2, rh / 2, -REFW / 2, rh / 2] });
  w.node(`${id}.c`, "group", {}, id);
  w.node(`${id}.c.img`, "image", { src: p.src, w: REFW, h: rh }, `${id}.c`);
  const d = p.data;
  // Bars are unit squares from their corner, stretched to their rectangle, so both orientations share one shape.
  // Bars are drawn by their own corner points in frame pixels, so both orientations morph from the original's bars.
  d.values.forEach((_, i) => w.node(`${id}.bar${i}`, "path", { points: barRect({ x0: 0, y0: 0, x1: 0, y1: 0 }), closed: 1, fill: c.subject, opacity: 0 }));
  d.values.forEach((v, i) => w.node(`${id}.val${i}`, "text", { text: String(v), size: c.valueFs, role: "heading", color: c.subject, opacity: 0 }));
  for (const [h, t] of Object.entries(d.texts ?? {})) w.node(`${id}.hd.${h}`, "text", { text: t, size: 100, role: "title", color: c.subject, opacity: 0 });
  w.node(`${id}.base`, "path", { points: [0, 0, 1, 1], stroke: c.subject, strokeWidth: c.baseWidth, opacity: 0 });
  d.labels.forEach((t, i) => w.node(`${id}.lab${i}`, "text", { text: t, size: c.small, role: "label", color: c.muted, opacity: 0 }));
  if (d.title && !d.texts) w.node(`${id}.title`, "text", { text: d.title, size: c.small, role: "label", color: c.muted, opacity: 0 });
  for (const part of p.barsOf.keys()) {
    w.node(`${id}.lv.${part}`, "path", { points: [0, 0, 1, 1], stroke: c.pointer, strokeWidth: c.levelWidth, lineCap: "round", opacity: 0, trimEnd: 0 });
    w.node(`${id}.lt.${part}`, "text", { text: "", size: c.valueFs, role: "heading", color: c.pointer, opacity: 0 });
  }
}

const rp = (v: number) => Math.round(v * 10) / 10;

/** The chart's targets. In "own" the original is hidden and the bars stand in the chart's box, lit by what the moment holds; in "photo" the original shows and the bars wait, unseen, exactly on its bars. */
export function chartTargets(id: string, st: St, p: Chart, mode: "own" | "photo", seen: Set<number>, L: ChartLook, c: { subject: string; muted: string; pointer: string }): Triple[] {
  const d = p.data;
  const g = chartGeom(st, p, mode, L);
  const pg = chartGeom(st, p, "photo", L);
  const own = mode === "own";
  const out: Triple[] = [[id, "x", st.x], [id, "y", st.y], [id, "scaleX", pg.pw / REFW], [id, "scaleY", pg.pw / REFW], [id, "opacity", own ? 0 : 1]];
  const lit = new Set((st.lit ?? []).flatMap((x) => p.barsOf.get(x) ?? []));
  const held = new Set([st.sub, ...(st.sup ?? [])].flatMap((x) => (x ? p.barsOf.get(x) ?? [] : [])));
  const focus = lit.size > 0 || held.size > 0;
  g.bars.forEach((b, i) => {
    const on = lit.has(i);
    out.push([`${id}.bar${i}`, "points", barRect(b)], [`${id}.bar${i}`, "fill", on ? c.pointer : c.subject], [`${id}.bar${i}`, "opacity", !own ? 0 : !focus || on || held.has(i) ? 1 : L.dimBars]);
    const lb = g.labels[i]!;
    const lw = L.em(d.labels[i]!) * L.small;
    out.push([`${id}.lab${i}`, "x", lb.left ? lb.x + lw / 2 : lb.x], [`${id}.lab${i}`, "y", lb.y], [`${id}.lab${i}`, "opacity", !own ? 0 : on ? 1 : focus && !held.has(i) ? L.dimText : L.labelOpacity], [`${id}.lab${i}`, "color", on ? c.pointer : c.muted]);
    const vw = L.em(String(d.values[i])) * L.valueFs;
    const show = own && (on || held.has(i) || seen.has(i));
    out.push([`${id}.val${i}`, "x", g.hz ? b.x1 + L.gap + vw / 2 : (b.x0 + b.x1) / 2], [`${id}.val${i}`, "y", g.hz ? (b.y0 + b.y1) / 2 : b.y0 - L.valueFs * 0.7], [`${id}.val${i}`, "opacity", show ? (on || !focus || held.has(i) ? 1 : L.dimText) : 0], [`${id}.val${i}`, "color", on ? c.pointer : c.subject]);
  });
  const A = g.axis;
  // Lines are drawn by their own points, never by stretching a unit line: a stretched stroke stretches its caps too.
  out.push([`${id}.base`, "points", [A.x0, A.y0, A.x1, A.y1].map(rp)], [`${id}.base`, "opacity", own ? 1 : 0]);
  if (d.title && !d.texts) out.push([`${id}.title`, "x", st.x], [`${id}.title`, "y", st.y - st.h / 2 + L.small * 0.9], [`${id}.title`, "opacity", own ? 1 : 0]);
  const keys = Object.keys(d.texts ?? {});
  const subI = keys.findIndex((x) => st.sub === x || st.lit?.includes(x));
  for (const h of keys) {
    const isSub = st.sub === h || !!st.lit?.includes(h);
    const isHeld = !!st.sup?.includes(h);
    const fs = isSub ? Math.min(L.headBig, (st.w * L.headShare) / L.em(d.texts![h]!)) : L.small * 1.1;
    const wd = L.em(d.texts![h]!) * fs;
    const i = keys.indexOf(h);
    const top = st.y - st.h / 2;
    const y = own && subI >= 0 ? (i === subI ? top + L.headBig * 0.6 : top + L.headBig * L.rowLine + L.small * 0.7 + (i < subI ? i : i - 1) * L.small * L.rowLine) : g.heads[h]!;
    out.push([`${id}.hd.${h}`, "x", isSub && own ? st.x : g.headX + wd / 2], [`${id}.hd.${h}`, "y", y], [`${id}.hd.${h}`, "scaleX", fs / 100], [`${id}.hd.${h}`, "scaleY", fs / 100], [`${id}.hd.${h}`, "opacity", own ? (isSub || isHeld || !focus ? 1 : L.dimText) : 0], [`${id}.hd.${h}`, "color", isSub ? c.pointer : c.subject]);
  }
  for (const part of p.barsOf.keys()) {
    const lv = own ? st.levels?.find((l) => l.part === part) : undefined;
    const bs = p.barsOf.get(part)!.map((i) => g.bars[i]!);
    const lo = g.hz ? Math.min(...bs.map((b) => b.y0)) - L.levelPad : Math.min(...bs.map((b) => b.x0)) - L.levelPad;
    const hi = g.hz ? Math.max(...bs.map((b) => b.y1)) + L.levelPad : Math.max(...bs.map((b) => b.x1)) + L.levelPad;
    const at = lv ? (g.hz ? A.x0 + lv.v * g.scale : A.y0 - lv.v * g.scale) : g.hz ? A.x0 : A.y0;
    const [x, y, sx, sy] = g.hz ? [at, lo, 0, hi - lo] : [lo, at, hi - lo, 0];
    out.push([`${id}.lv.${part}`, "points", [x, y, x + sx, y + sy].map(rp)], [`${id}.lv.${part}`, "opacity", lv ? 1 : 0], [`${id}.lv.${part}`, "trimEnd", lv ? 1 : 0]);
    out.push([`${id}.lt.${part}`, "x", g.hz ? at : (lo + hi) / 2], [`${id}.lt.${part}`, "y", g.hz ? lo - L.valueFs * 0.65 : at - L.valueFs * 0.9], [`${id}.lt.${part}`, "opacity", lv?.tag ? 1 : 0]);
    if (lv?.tag) out.push([`${id}.lt.${part}`, "text", lv.tag]);
  }
  return out;
}

export type RedrawParams = {
  /** Frames the original shows before its bars are redrawn on top of it, when the moment has room. */
  holdOriginal: [number, number];
  /** Frames left at the end of the moment once the redraw is done. */
  settle: number;
  /** Below this many frames of room the original holds and the next moment redraws it; below `minRoom` the bars just grow in. */
  minRoomBoth: number;
  minRoom: number;
  fade: number; // frames the original takes to fade in or out
  move: number; // frames the bars take to move to their own layout
  late: number; // frames after the move starts that words and lines arrive
  lateFrames: number;
  growStagger: number; // frames between bars growing in, when there is no room to show the original
  grow: number;
};

/**
 * The chart's entrance. The original arrives as it is; when there is room its bars are redrawn exactly on the
 * original's bars, the original fades, and the bars move to the chart's own layout, keeping identity. Without room the
 * original holds and the next moment does the redraw; without even that, the bars grow in one by one.
 */
export function enterChart(w: Writer, id: string, p: Chart, photo: Triple[], own: Triple[], t: { prep: number; at: number; room: number; nextHas: boolean }, R: RedrawParams): string {
  if (t.room < R.minRoomBoth && t.nextHas) {
    for (const [n, q, v] of photo) w.put(n, q, v, t.prep);
    w.put(id, "opacity", 0, t.prep);
    w.put(id, "opacity", 1, t.at, R.fade, "out");
    return "the user's own chart shows as it is; the next moment redraws it on its own bars";
  }
  if (t.room >= R.minRoom) {
    for (const [n, q, v] of photo) w.put(n, q, v, t.prep);
    w.put(id, "opacity", 0, t.prep);
    w.put(id, "opacity", 1, t.at, R.fade, "out");
    const tm = t.at + Math.max(R.holdOriginal[0], Math.min(R.holdOriginal[1], t.room - R.settle));
    p.data.values.forEach((_, i) => w.put(`${id}.bar${i}`, "opacity", 1, tm, Math.max(1, Math.round(R.fade * 0.6)), "out"));
    w.put(id, "opacity", 0, tm + Math.round(R.fade * 0.6), R.fade, "in");
    for (const [n, q, v] of own) {
      if (n === id && q === "opacity") continue;
      const late = /\.(lv|lt|lab\d+|val\d+|hd\.|title|base)/.test(n) || q === "fill";
      w.put(n, q, v, late ? tm + R.late : tm + Math.round(R.fade * 0.6), late ? R.lateFrames : R.move, "smooth");
    }
    return `the user's own chart shows as it is for ${tm - t.at} frames, then its ${p.data.values.length} bars are redrawn on top of the originals and move to the chart's own layout`;
  }
  const hz = p.data.orient === "h";
  for (const [n, q, v] of own) {
    const bar = /\.bar(\d+)$/.exec(n);
    const delay = bar ? R.growStagger * Number(bar[1]) : 0;
    if (bar && q === "points") {
      // Grows from its base: from the left edge (horizontal) or the baseline (vertical).
      const [x0, y0, x1, , , y1] = v as number[];
      w.put(n, q, hz ? barRect({ x0: x0!, y0: y0!, x1: x0!, y1: y1! }) : barRect({ x0: x0!, y0: y1!, x1: x1!, y1: y1! }), t.prep);
      w.put(n, q, v, t.at + delay, R.grow, "out");
    } else if (bar && q === "opacity") (w.put(n, q, 0, t.prep), w.put(n, q, v, t.at + delay, Math.max(1, Math.round(R.fade * 0.6)), "out"));
    else w.put(n, q, v, t.at + (/\.(val|lv|lt)/.test(n) ? R.late : 0), R.fade, "out");
  }
  return "the chart is redrawn in the style, its bars growing in one by one";
}
