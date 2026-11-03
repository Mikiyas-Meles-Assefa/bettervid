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
  min?: number; // px: the smallest size any of its words may be set at, when room is short
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
  /** The width of a category label (labels are set in their own role's font), em units; `em` when not given. */
  emLabel?: (t: string) => number;
};

type BarR = { x0: number; y0: number; x1: number; y1: number };
const barRect = (b: BarR) => [b.x0, b.y0, b.x1, b.y0, b.x1, b.y1, b.x0, b.y1].map((v) => Math.round(v * 10) / 10);
/** A label or header row's lines, the first line's center and the pitch between lines. */
export type ChartText = { x: number; y: number; left: boolean; lines: string[]; lh: number; fs: number };
export type ChartGeom = { hz: boolean; bars: BarR[]; axis: BarR; scale: number; labels: ChartText[]; heads: Record<string, ChartText>; headX: number; pw: number; ph: number; small: number; valueFs: number; fits: boolean; needH: number };

/** The most lines a label or header row is broken into. */
export const CHART_LINES = 3;

/** Words broken into lines no wider than `width` (in em units); undefined when one word alone is wider. */
export function wrapWords(text: string, em: (t: string) => number, width: number): string[] | undefined {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (em(t) <= width) cur = t;
    else {
      if (!cur || em(w) > width) return undefined;
      lines.push(cur);
      cur = w;
    }
  }
  lines.push(cur);
  return lines;
}

/**
 * How the redrawn chart's words fit a box of w by h: sizes from the look (the design's type sizes), stepped down toward
 * the smallest size until every label, value and header row fits, broken into lines where it is wider than its room.
 * The bars keep the original's orientation when the labels fit that way, and turn when they only fit the other way.
 * Data is never shortened: when nothing fits even at the smallest size, `fits` is false and `needH` is the height it
 * needs at that width, for the composer to make room.
 */
export function chartFit(box: { w: number; h: number; sub?: string; lit?: string[] }, p: Chart, L: ChartLook) {
  const d = p.data;
  const n = d.values.length;
  const keys = Object.keys(d.texts ?? {});
  const subKey = keys.find((h) => box.sub === h || !!box.lit?.includes(h));
  const min = Math.min(L.min ?? L.small, L.small);
  const emL = L.emLabel ?? L.em;
  const at = (k: number) => {
    const small = Math.max(min, L.small * k);
    const valueFs = Math.max(min, L.valueFs * k);
    // Header rows stand a little over the labels while there is room; at the smallest size they are set at it too.
    const row = small > min + 1e-6 ? small * 1.1 : small;
    const big = Math.max(row, L.headBig * k);
    let ok = true;
    let headH = 0;
    const heads: Record<string, { lines: string[]; fs: number }> = {};
    for (const h of subKey ? [subKey, ...keys.filter((x) => x !== subKey)] : keys) {
      const t = d.texts![h]!;
      const fs = h === subKey ? Math.min(big, Math.max(row, (box.w * L.headShare) / Math.max(0.2, L.em(t)))) : row;
      const lines = wrapWords(t, L.em, (box.w * 0.96) / fs);
      if (!lines || lines.length > CHART_LINES) ok = false;
      heads[h] = { lines: lines?.slice(0, CHART_LINES) ?? [t], fs };
      headH += heads[h]!.lines.length * fs * L.rowLine;
    }
    if (d.title && !d.texts) headH += small * L.rowLine;
    if (headH) headH += L.gap;
    const valW = Math.max(...d.values.map((v) => L.em(String(v)))) * valueFs;
    const across = () => {
      const lab = d.labels.map((t) => wrapWords(t, emL, (box.w * 0.96) / small));
      const good = lab.every((l) => l && l.length <= CHART_LINES);
      const lines = lab.map((l, i) => l ?? [d.labels[i]!]);
      const need = headH + L.gap + lines.reduce((s, l) => s + l.length * small * L.rowLine + small * 0.6 + L.gap * 0.5, 0);
      return { hz: true, lines, good: good && valW + L.gap * 1.5 < box.w * 0.6, need };
    };
    const upright = () => {
      const slot = box.w / n;
      const lab = d.labels.map((t) => wrapWords(t, emL, (slot * 0.94) / small));
      const good = lab.every((l) => l && l.length <= 2) && valW <= slot * 0.96;
      const lines = lab.map((l, i) => l ?? [d.labels[i]!]);
      const need = headH + L.gap + valueFs * L.rowLine + Math.max(...lines.map((l) => l.length)) * small * L.rowLine * 1.05 + small * 3;
      return { hz: false, lines, good, need };
    };
    const ways = d.orient === "h" ? [across(), upright()] : [upright(), across()];
    const best = ways.find((x) => x.good && x.need <= box.h) ?? ways.find((x) => x.good) ?? ways[0]!;
    return { ...best, fits: ok && best.good && best.need <= box.h, small, valueFs, heads, headH, subKey };
  };
  let r = at(1);
  for (let k = 0.92; !r.fits && (L.small * (k + 0.08) > min || L.valueFs * (k + 0.08) > min || L.headBig * (k + 0.08) > min); k -= 0.08) r = at(Math.max(k, 0));
  return { ...r, needH: Math.max(r.need, box.h) };
}

export function chartGeom(st: St, p: Chart, mode: "own" | "photo", L: ChartLook): ChartGeom {
  const d = p.data;
  const n = d.values.length;
  const hz0 = d.orient === "h";
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
      if (hz0) {
        const slot = (Y1 - Y0) / n;
        const cy = Y0 + (i + 0.5) * slot;
        return { x0: X0, x1: X0 + (v / d.ymax) * (X1 - X0), y0: cy - (slot * bf) / 2, y1: cy + (slot * bf) / 2 };
      }
      const slot = (X1 - X0) / n;
      const cx = X0 + (i + 0.5) * slot;
      return { x0: cx - (slot * bf) / 2, x1: cx + (slot * bf) / 2, y1: Y1, y0: Y1 - (v / d.ymax) * (Y1 - Y0) };
    });
    const headX = left + u0 * pw * 0.15;
    const headsAt = Object.fromEntries(heads.map((h) => [h, { x: headX, y: p.parts.get(h) ? top + ((p.parts.get(h)![1] + p.parts.get(h)![3]) / 2) * ph : top, left: true, lines: [d.texts![h]!], lh: 0, fs: L.small * 1.1 }]));
    const labels = bars.map((b, i) => (hz0 ? { x: left + u0 * pw * 0.1, y: (b.y0 + b.y1) / 2, left: true } : { x: (b.x0 + b.x1) / 2, y: b.y1 + (1 - v1) * ph * 0.5, left: false })).map((l, i) => ({ ...l, lines: [d.labels[i]!], lh: 0, fs: L.small }));
    return { hz: hz0, bars, axis: hz0 ? { x0: X0, y0: Y0, x1: X0, y1: Y1 } : { x0: X0, y0: Y1, x1: X1, y1: Y1 }, scale: hz0 ? (X1 - X0) / d.ymax : (Y1 - Y0) / d.ymax, labels, heads: headsAt, headX, pw, ph, small: L.small, valueFs: L.valueFs, fits: true, needH: ph };
  }
  const left = st.x - st.w / 2;
  const top = st.y - st.h / 2;
  const fit = chartFit({ w: st.w, h: st.h, sub: st.sub, lit: st.lit }, p, L);
  const { small, valueFs } = fit;
  // Header rows: the chart's own words above the plot, the one in focus first and large, each broken into lines.
  const headsAt: Record<string, ChartText> = {};
  let y = top;
  for (const h of fit.subKey ? [fit.subKey, ...heads.filter((x) => x !== fit.subKey)] : heads) {
    const r = fit.heads[h]!;
    const lh = r.fs * L.rowLine;
    headsAt[h] = { x: left, y: y + lh / 2, left: h !== fit.subKey, lines: r.lines, lh, fs: r.fs };
    y += r.lines.length * lh;
  }
  const headH = fit.headH;
  const lh = small * L.rowLine;
  if (fit.hz) {
    // One row per bar: the category's lines above its bar, the value at the bar's end.
    const plotTop = top + headH + L.gap;
    const avail = st.y + st.h / 2 - plotTop;
    const labH = fit.lines.map((l) => l.length * lh);
    const valueRoom = Math.max(...d.values.map((v) => L.em(String(v)))) * valueFs + L.gap * 1.5;
    const len = Math.max(1, st.w - valueRoom);
    const free = Math.max(0, avail - labH.reduce((a, b) => a + b, 0));
    const thick = Math.max(small * 0.6, Math.min(free / n - L.gap * 0.5, (avail / n) * L.barFrac));
    const spare = Math.max(0, (free - n * thick) / n);
    let yy = plotTop;
    const labels: ChartText[] = [];
    const bars: BarR[] = d.values.map((v, i) => {
      labels.push({ x: left, y: yy + lh / 2, left: true, lines: fit.lines[i]!, lh, fs: small });
      const y0 = yy + labH[i]!;
      yy = y0 + thick + spare;
      return { x0: left, x1: left + (v / d.ymax) * len, y0, y1: y0 + thick };
    });
    return { hz: true, bars, axis: { x0: left, y0: plotTop + labH[0]! * 0.7, x1: left, y1: Math.max(plotTop, yy - spare) }, scale: len / d.ymax, labels, heads: headsAt, headX: left, pw: st.w, ph: st.h, small, valueFs, fits: fit.fits, needH: fit.needH };
  }
  const labRows = Math.max(...fit.lines.map((l) => l.length));
  const labH = labRows * lh * 1.05;
  const base = top + st.h - labH;
  const plotH = Math.max(0, base - (top + headH + L.gap + valueFs * L.rowLine));
  const slot = st.w / n;
  const m = (1 - L.barFrac) / 2;
  const bars: BarR[] = d.values.map((v, i) => ({ x0: left + (i + m) * slot, x1: left + (i + 1 - m) * slot, y1: base, y0: base - (v / d.ymax) * plotH }));
  return { hz: false, bars, axis: { x0: left, y0: base, x1: left + st.w, y1: base }, scale: plotH / d.ymax, labels: bars.map((b, i) => ({ x: (b.x0 + b.x1) / 2, y: base + lh * 0.6, left: false, lines: fit.lines[i]!, lh, fs: small })), heads: headsAt, headX: left, pw: st.w, ph: st.h, small, valueFs, fits: fit.fits, needH: fit.needH };
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
  // Words are set at size 100 and scaled to the moment's size, so the design's type sizes reach them; a label or
  // header row has one node per line it may be broken into.
  d.values.forEach((v, i) => w.node(`${id}.val${i}`, "text", { text: String(v), size: 100, scaleX: c.valueFs / 100, scaleY: c.valueFs / 100, role: "heading", color: c.subject, opacity: 0 }));
  for (const [h, t] of Object.entries(d.texts ?? {})) for (let j = 0; j < CHART_LINES; j++) w.node(lineId(`${id}.hd.${h}`, j), "text", { text: j ? "" : t, size: 100, role: "title", color: c.subject, opacity: 0 });
  w.node(`${id}.base`, "path", { points: [0, 0, 1, 1], stroke: c.subject, strokeWidth: c.baseWidth, opacity: 0 });
  d.labels.forEach((t, i) => {
    for (let j = 0; j < CHART_LINES; j++) w.node(lineId(`${id}.lab${i}`, j), "text", { text: j ? "" : t, size: 100, scaleX: c.small / 100, scaleY: c.small / 100, role: "label", color: c.muted, opacity: 0 });
  });
  if (d.title && !d.texts) w.node(`${id}.title`, "text", { text: d.title, size: 100, scaleX: c.small / 100, scaleY: c.small / 100, role: "label", color: c.muted, opacity: 0 });
  for (const part of p.barsOf.keys()) {
    w.node(`${id}.lv.${part}`, "path", { points: [0, 0, 1, 1], stroke: c.pointer, strokeWidth: c.levelWidth, lineCap: "round", opacity: 0, trimEnd: 0 });
    w.node(`${id}.lt.${part}`, "text", { text: "", size: 100, scaleX: c.valueFs / 100, scaleY: c.valueFs / 100, role: "heading", color: c.pointer, opacity: 0 });
  }
}

const rp = (v: number) => Math.round(v * 10) / 10;
/** The node of line j of a label or header row: the row's own id for its first line. */
export const lineId = (row: string, j: number) => (j ? `${row}.l${j}` : row);

/** A row of words broken into lines: each line's text, place, size and opacity (lines it does not use are hidden). */
function rowTargets(row: string, t: ChartText, em: (s: string) => number, op: number, color: string, centerX?: number): Triple[] {
  const out: Triple[] = [];
  for (let j = 0; j < CHART_LINES; j++) {
    const n = lineId(row, j);
    const line = t.lines[j];
    // A left-aligned line is anchored at its start, so its left edge is exact whatever the font's true width.
    const start = centerX === undefined && t.left;
    out.push([n, "text", line ?? ""], [n, "anchor", start ? "start" : "middle"], [n, "x", centerX ?? t.x], [n, "y", t.y + j * t.lh], [n, "scaleX", t.fs / 100], [n, "scaleY", t.fs / 100], [n, "opacity", line ? op : 0], [n, "color", color]);
  }
  return out;
}

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
    out.push(...rowTargets(`${id}.lab${i}`, g.labels[i]!, L.emLabel ?? L.em, !own ? 0 : on ? 1 : focus && !held.has(i) ? L.dimText : L.labelOpacity, on ? c.pointer : c.muted));
    const vf = g.valueFs;
    const vw = L.em(String(d.values[i])) * vf;
    const show = own && (on || held.has(i) || seen.has(i));
    out.push([`${id}.val${i}`, "x", g.hz ? b.x1 + L.gap + vw / 2 : (b.x0 + b.x1) / 2], [`${id}.val${i}`, "y", g.hz ? (b.y0 + b.y1) / 2 : b.y0 - vf * 0.7], [`${id}.val${i}`, "scaleX", vf / 100], [`${id}.val${i}`, "scaleY", vf / 100], [`${id}.val${i}`, "opacity", show ? (on || !focus || held.has(i) ? 1 : L.dimText) : 0], [`${id}.val${i}`, "color", on ? c.pointer : c.subject]);
  });
  const A = g.axis;
  // Lines are drawn by their own points, never by stretching a unit line: a stretched stroke stretches its caps too.
  out.push([`${id}.base`, "points", [A.x0, A.y0, A.x1, A.y1].map(rp)], [`${id}.base`, "opacity", own ? 1 : 0]);
  if (d.title && !d.texts) out.push([`${id}.title`, "x", st.x], [`${id}.title`, "y", st.y - st.h / 2 + g.small * 0.9], [`${id}.title`, "scaleX", g.small / 100], [`${id}.title`, "scaleY", g.small / 100], [`${id}.title`, "opacity", own ? 1 : 0]);
  for (const h of Object.keys(d.texts ?? {})) {
    const isSub = st.sub === h || !!st.lit?.includes(h);
    const isHeld = !!st.sup?.includes(h);
    out.push(...rowTargets(`${id}.hd.${h}`, g.heads[h]!, L.em, own ? (isSub || isHeld || !focus ? 1 : L.dimText) : 0, isSub ? c.pointer : c.subject, isSub && own ? st.x : undefined));
  }
  for (const part of p.barsOf.keys()) {
    const lv = own ? st.levels?.find((l) => l.part === part) : undefined;
    const bs = p.barsOf.get(part)!.map((i) => g.bars[i]!);
    const lo = g.hz ? Math.min(...bs.map((b) => b.y0)) - L.levelPad : Math.min(...bs.map((b) => b.x0)) - L.levelPad;
    const hi = g.hz ? Math.max(...bs.map((b) => b.y1)) + L.levelPad : Math.max(...bs.map((b) => b.x1)) + L.levelPad;
    const at = lv ? (g.hz ? A.x0 + lv.v * g.scale : A.y0 - lv.v * g.scale) : g.hz ? A.x0 : A.y0;
    const [x, y, sx, sy] = g.hz ? [at, lo, 0, hi - lo] : [lo, at, hi - lo, 0];
    out.push([`${id}.lv.${part}`, "points", [x, y, x + sx, y + sy].map(rp)], [`${id}.lv.${part}`, "opacity", lv ? 1 : 0], [`${id}.lv.${part}`, "trimEnd", lv ? 1 : 0]);
    out.push([`${id}.lt.${part}`, "x", g.hz ? at : (lo + hi) / 2], [`${id}.lt.${part}`, "y", g.hz ? lo - g.valueFs * 0.65 : at - g.valueFs * 0.9], [`${id}.lt.${part}`, "scaleX", g.valueFs / 100], [`${id}.lt.${part}`, "scaleY", g.valueFs / 100], [`${id}.lt.${part}`, "opacity", lv?.tag ? 1 : 0]);
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
