// Sorting on screen: bars or boxes that really compare and move, following engine/truth/sort.ts step by step.
import type { Kit, NodeSpec } from "../core/types.ts";
import { sort, SORTS, type SortEvent, type SortName } from "../truth/sort.ts";
import { frame, playSteps, Story, STEPS_DOC, text, textWidth, truthKind, type Board } from "./steps.ts";

const SIZE = 56;
const TALL = 640; // the tallest bar

// Items are named by where they started (from 1), so `s.item.3` is the same value wherever it goes.
export const sortPart = {
  item: (s: string, k: number) => `${s}.item.${k}`,
  shape: (s: string, k: number) => `${s}.item.${k}.shape`,
  value: (s: string, k: number) => `${s}.item.${k}.value`,
  pointer: (s: string) => `${s}.pointer`,
  finger: (s: string, side: "a" | "b") => `${s}.finger.${side}`, // merge: the front of the left run (a) and the right run (b)
  place: (s: string, level: number, p: number) => `${s}.place.${level}.${p + 1}`, // merge by level: a place a value left
};

// Forms a sort can take. `row`: every value in one row, as it would sit on a wide screen. `down` and `across` (merge
// with boxes): the runs are laid out by level, as the split tree a person draws by hand: each cut moves the two halves
// one level on, and each merge takes the values back into the level of the run they came from, so the process itself
// fills the frame. `down` puts the levels under each other, the values of a level side by side; `across` puts the
// levels side by side, the values of a level under each other, which on a tall frame leaves more room for each value.
export const SORT_FORMS = ["auto", "row", "down", "across"] as const;
const GAP_TREE = 0.35; // between runs of one level, in boxes
const PITCH_TREE = 1.08; // from one value to the next in a run, in boxes
// From one level to the next, in boxes: at least room for the fingers beside a level, and at most this much, so the
// levels spread over the room the values leave rather than bunching at the top.
const STEP_LEAST = { down: 2.1, across: 1.9 };
const STEP_MOST = 3.4;

// The levels of a merge sort: how deep each run is, and for each level the runs a position belongs to there.
function levelsOf(n: number, log: SortEvent[]) {
  const depth = new Map<string, number>([[`0-${n - 1}`, 0]]);
  for (const e of log) {
    if (e.type !== "divide") continue;
    const d = depth.get(`${e.lo}-${e.hi}`) ?? 0;
    depth.set(`${e.lo}-${e.mid}`, d + 1);
    depth.set(`${e.mid + 1}-${e.hi}`, d + 1);
  }
  const runs = [...depth].map(([k, d]) => ({ lo: Number(k.split("-")[0]), hi: Number(k.split("-")[1]), d }));
  const deepest = Math.max(...runs.map((r) => r.d));
  // At level L a position belongs to the deepest run that holds it and is no deeper than L.
  const owners = Array.from({ length: deepest + 1 }, (_, L) => Array.from({ length: n }, (_, p) => runs.filter((r) => r.lo <= p && p <= r.hi && r.d <= L).sort((a, b) => b.d - a.d)[0]!));
  const block = owners.map((owner) => {
    const ids = new Map<string, number>();
    return owner.map((r) => ids.get(`${r.lo}-${r.hi}`) ?? ids.set(`${r.lo}-${r.hi}`, ids.size).get(`${r.lo}-${r.hi}`)!);
  });
  // Whether a value ever sits at position p of level L: only where a run of exactly that depth holds it.
  const reached = (L: number, p: number) => owners[L]![p]!.d === L;
  return { depth: (lo: number, hi: number) => depth.get(`${lo}-${hi}`) ?? 0, deepest, block, reached };
}

// The form a sort takes, and for a form by level the step between levels. When the scene leaves the form to the kit, a
// merge of boxes on a tall frame is drawn by level, down or across, whichever lets each value be larger (down, the
// familiar picture, unless across is clearly larger); otherwise in a row.
type Shape = { form: "row" } | { form: "down" | "across"; step: number };
function shapeFor(asked: string, algo: SortName, show: string, n: number, log: SortEvent[], ctx: { width: number; height: number }): Shape {
  if (asked === "row" || (asked === "auto" && (algo !== "merge" || show !== "boxes" || ctx.height <= ctx.width * 1.2))) return { form: "row" };
  const { deepest, block } = levelsOf(n, log);
  const along = n * PITCH_TREE + Math.max(...block.map((b) => Math.max(...b))) * GAP_TREE;
  // The room a sort may have: the frame's safe width, and three quarters of its safe height, the rest for words.
  const [w, h] = [ctx.width * 0.87, ctx.height * 0.765 * 0.75];
  // The size of a value each way, and the step that spreads the levels over the room left the other way.
  const fit = (form: "down" | "across") => {
    const [wide, deep] = form === "down" ? [w, h] : [h, w];
    const least = STEP_LEAST[form];
    const cell = Math.min(wide / along, deep / (deepest * least + 1));
    return { form, cell, step: Math.max(least, Math.min(STEP_MOST, (deep / cell - 1) / Math.max(1, deepest))) };
  };
  const [down, across] = [fit("down"), fit("across")];
  const pick = asked === "down" ? down : asked === "across" ? across : across.cell > down.cell * 1.2 ? across : down;
  return { form: pick.form, step: pick.step };
}

function sortBoard(id: string, d: Record<string, unknown>, ctx: { width: number; height: number }): Board {
  if (!Array.isArray(d.data)) throw new Error(`sort needs data, a list of numbers, as in sort s data=[5,2,8,1] algo=bubble`);
  const values = d.data.map((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v)) as number[];
  if (values.length < 2 || values.length > 16) throw new Error(`sort shows 2 to 16 values, not ${values.length}`);
  const algo = String(d.algo ?? "bubble") as SortName;
  if (!SORTS.includes(algo)) throw new Error(`algo must be one of ${SORTS.join(", ")}, not ${algo}`);
  const show = String(d.show ?? "bars");
  if (show !== "bars" && show !== "boxes") throw new Error(`show must be bars or boxes, not ${show}`);
  const order = String(d.order ?? "calls");
  if (order !== "calls" && order !== "levels") throw new Error(`order must be calls or levels, not ${order}`);
  if (order === "levels" && algo !== "merge") throw new Error(`order=levels is for algo=merge, which can cut every run first and then merge level by level`);
  const log = sort(values, algo, order);
  const asked = String(d.form ?? "auto");
  if (!(SORT_FORMS as readonly string[]).includes(asked)) throw new Error(`form must be one of ${SORT_FORMS.join(", ")}, not ${asked}`);
  if ((asked === "down" || asked === "across") && (algo !== "merge" || show !== "boxes")) throw new Error(`form=${asked} draws a merge sort of boxes level by level: use algo=merge show=boxes, or form=row`);
  const drawn = shapeFor(asked, algo, show, values.length, log, ctx);
  if (drawn.form !== "row") return treeBoard(id, values, log, drawn.form, drawn.step);
  const n = values.length;
  const labels = values.map(String);
  const box = Math.max(SIZE * 1.7, ...labels.map((l) => textWidth(l, SIZE) + SIZE * 0.8));
  const pitch = box * 1.12;
  const big = Math.max(...values.map(Math.abs)) || 1;
  const merging = algo === "merge";
  // Merge sort shows its runs apart: each cut opens a gap, each merge closes one, and a cut of a longer run opens a
  // wider gap, so the halves of halves still read as one half. `cuts` maps b, a gap between places b and b + 1, to its
  // share of the widest gap.
  const GAP = merging ? box * 0.8 : 0;
  const cuts = new Map<number, number>();
  const width = (b: number) => Math.max(0.35, b / n); // a cut of a run of b values
  // The widest the gaps ever get together, which the frame reserves; the row stays centered in it as gaps open and close.
  let widest = 0;
  const gaps = new Map<number, number>();
  for (const e of log) {
    if (e.type === "divide") gaps.set(e.mid, width(e.hi - e.lo + 1));
    widest = Math.max(widest, [...gaps.values()].reduce((a, b) => a + b, 0));
    if (e.type === "split") gaps.delete(e.mid); // it closes as this merge ends, and no gap opens before then
  }
  const sum = (list: [number, number][]) => list.reduce((t, [, w]) => t + w, 0);
  const slotX = (p: number, ignore?: number) => {
    const open = [...cuts].filter(([b]) => b !== ignore);
    return p * pitch + pitch / 2 + GAP * (sum(open.filter(([b]) => b < p)) + (widest - sum(open)) / 2);
  };
  const height = (v: number) => (Math.abs(v) / big) * TALL * Math.sign(v || 1);
  // The row merged values drop to, below the rest.
  const drop = show === "bars" ? TALL + SIZE * 2.4 + (values.some((v) => v < 0) ? TALL : 0) : box * 1.6;
  const parts: NodeSpec[] = [{ id, kind: "group", props: {} }];
  values.forEach((v, i) => {
    const k = i + 1;
    parts.push({ id: sortPart.item(id, k), kind: "group", parent: id, props: { x: slotX(i), y: 0 } });
    if (show === "bars") {
      const h = Math.max(6, Math.abs(height(v)));
      const top = v >= 0 ? -h : 0;
      const w = box * 0.82;
      parts.push({ id: sortPart.shape(id, k), kind: "path", parent: sortPart.item(id, k), props: { points: [-w / 2, top, w / 2, top, w / 2, top + h, -w / 2, top + h, -w / 2, top], closed: 1, fill: "paper", stroke: "ink", strokeWidth: 5 } });
      parts.push(text(sortPart.value(id, k), sortPart.item(id, k), 0, v >= 0 ? SIZE * 0.75 : -SIZE * 0.75, labels[i]!, SIZE, { weight: 700 }));
    } else {
      const w = box * 0.9;
      parts.push({ id: sortPart.shape(id, k), kind: "path", parent: sortPart.item(id, k), props: { points: [-w / 2, -w / 2, w / 2, -w / 2, w / 2, w / 2, -w / 2, w / 2, -w / 2, -w / 2], closed: 1, fill: "paper", stroke: "ink", strokeWidth: 5 } });
      parts.push(text(sortPart.value(id, k), sortPart.item(id, k), 0, 0, labels[i]!, SIZE, { weight: 700 }));
    }
  });
  const usesPointer = algo === "quick" || algo === "selection";
  const below = show === "bars" ? SIZE * 1.6 + (values.some((v) => v < 0) ? TALL : 0) : box * 0.55 + SIZE * 0.4;
  const pointerY = below + SIZE * 0.3;
  if (usesPointer) {
    const s = SIZE * 0.32;
    parts.push({ id: sortPart.pointer(id), kind: "group", parent: id, props: { x: slotX(0), y: pointerY, opacity: 0 } });
    parts.push({ id: `${sortPart.pointer(id)}.mark`, kind: "path", parent: sortPart.pointer(id), props: { points: [0, 0, s, s * 1.5, -s, s * 1.5, 0, 0], closed: 1, fill: "accent", stroke: "accent", strokeWidth: 3 } });
    parts.push(text(`${sortPart.pointer(id)}.label`, sortPart.pointer(id), 0, s * 1.5 + SIZE * 0.55, algo === "quick" ? "pivot" : "smallest", SIZE * 0.6, { color: "accent" }));
  }
  const tallest = show === "bars" ? Math.max(...values.map((v) => (v > 0 ? height(v) : 0)), SIZE) : box / 2;
  const bottom = Math.max(merging ? drop + (show === "bars" ? SIZE * 1.2 : box / 2) : 0, usesPointer ? pointerY + SIZE * 1.5 : below);
  parts.push(frame(`${id}.frame`, id, 0, -tallest - 10, n * pitch + GAP * widest, bottom + 10));
  // Merge: a finger under the front of each run being merged, which moves on as its value is taken.
  const fingerY = show === "bars" ? SIZE * 1.15 : box * 0.5 + 4;
  if (merging) for (const side of ["a", "b"] as const) {
    const f = SIZE * 0.34;
    parts.push({ id: sortPart.finger(id, side), kind: "group", parent: id, props: { x: slotX(0), y: fingerY, opacity: 0 } });
    parts.push({ id: `${sortPart.finger(id, side)}.mark`, kind: "path", parent: sortPart.finger(id, side), props: { points: [0, 0, f, f * 1.5, -f, f * 1.5, 0, 0], closed: 1, fill: "accent", stroke: "accent", strokeWidth: 3 } });
  }

  const s = new Story(parts);
  const at = values.map((_, i) => i + 1); // at[p] is the item at position p
  const positions = at;
  const val = (p: number) => values[at[p]! - 1]!;
  const shape = (p: number) => sortPart.shape(id, at[p]!);
  const open = { started: false, moved: false };
  const begin = (say: string) => {
    s.step(say);
    open.started = true;
    open.moved = false;
  };
  const pending: number[] = []; // merge: where each taken value lands, by its slot in the merged run
  const xNow = values.map((_, i) => slotX(i)); // by item
  // Every item to where its place now is, after gaps open or close.
  const place = (at: number, dur: number) => {
    for (let p = 0; p < n; p++) {
      const item = positions[p]!;
      const x = slotX(p);
      if (Math.abs(xNow[item - 1]! - x) < 0.5) continue;
      s.set(sortPart.item(id, item), "x", x, at, dur);
      xNow[item - 1] = x;
    }
  };
  const run = { lo: 0, mid: 0, hi: 0, a: 0, b: 0 }; // the merge under way and where each finger is
  const finger = (side: "a" | "b", p: number, last: number) => {
    if (p <= last) s.set(sortPart.finger(id, side), "x", slotX(p), 0.5, 0.4).set(sortPart.finger(id, side), "opacity", 1, 0.5, 0.2);
    else s.set(sortPart.finger(id, side), "opacity", 0, 0.5, 0.3);
  };
  const vals = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, k) => val(lo + k)).join(" ");
  for (let i = 0; i < log.length; i++) {
    const e: SortEvent = log[i]!;
    if (e.type === "compare") {
      const next = log[i + 1];
      const sign = e.result === "less" ? "<" : e.result === "greater" ? ">" : "=";
      const swaps = next?.type === "swap";
      begin(`compare ${e.a} ${sign} ${e.b}${swaps ? ", swap" : next?.type === "take" ? `, take ${val(next.from)}` : ""}`);
      // Bars light their fill, with their values outside them; boxes light their edge and value, which sit on the page.
      if (show === "bars") s.flash(shape(e.i), "fill", "accent").flash(shape(e.j), "fill", "accent");
      else s.flash(shape(e.i), "stroke", "accent").flash(shape(e.j), "stroke", "accent").flash(sortPart.value(id, at[e.i]!), "color", "accent").flash(sortPart.value(id, at[e.j]!), "color", "accent");
    } else if (e.type === "swap") {
      if (!open.started || open.moved) begin(`swap ${val(e.i)} and ${val(e.j)}`);
      const [a, b] = [at[e.i]!, at[e.j]!];
      s.set(sortPart.item(id, a), "x", slotX(e.j), 0.35, 0.55).set(sortPart.item(id, b), "x", slotX(e.i), 0.35, 0.55);
      [at[e.i], at[e.j]] = [b, a];
      open.moved = true;
    } else if (e.type === "pivot" || e.type === "min") {
      if (!open.started || e.type === "pivot") begin(e.type === "pivot" ? `pivot ${val(e.i)}` : `smallest so far ${val(e.i)}`);
      s.set(sortPart.pointer(id), "opacity", 1, 0.6, 0.3).set(sortPart.pointer(id), "x", slotX(e.i), 0.6, 0.35);
    } else if (e.type === "divide") {
      begin(`split ${vals(e.lo, e.hi)} into ${vals(e.lo, e.mid)} and ${vals(e.mid + 1, e.hi)}`);
      cuts.set(e.mid, width(e.hi - e.lo + 1));
      place(0.1, 0.6);
    } else if (e.type === "split") {
      begin(`merge ${vals(e.lo, e.mid)} with ${vals(e.mid + 1, e.hi)}: a finger on the front of each`);
      for (let p = e.lo; p <= e.hi; p++) s.flash(sortPart.value(id, at[p]!), "color", "accent");
      Object.assign(run, { lo: e.lo, mid: e.mid, hi: e.hi, a: e.lo, b: e.mid + 1 });
      s.set(sortPart.finger(id, "a"), "x", slotX(e.lo), 0, 0).set(sortPart.finger(id, "b"), "x", slotX(e.mid + 1), 0, 0);
      s.set(sortPart.finger(id, "a"), "opacity", 1, 0.1, 0.4).set(sortPart.finger(id, "b"), "opacity", 1, 0.1, 0.4);
      pending.length = 0;
    } else if (e.type === "take") {
      if (!open.started || open.moved) begin(`take ${val(e.from)}${e.from <= run.mid ? (run.b > run.hi ? ", the right side is used up" : "") : run.a > run.mid ? ", the left side is used up" : ""}`);
      const item = at[e.from]!;
      // The merged run below is laid out as it will stand once the gap between its halves closes.
      const x = slotX(e.to, run.mid);
      s.set(sortPart.item(id, item), "x", x, 0.35, 0.55).set(sortPart.item(id, item), "y", drop, 0.35, 0.55);
      xNow[item - 1] = x;
      if (e.from <= run.mid) finger("a", ++run.a, run.mid);
      else finger("b", ++run.b, run.hi);
      pending.push(item);
      open.moved = true;
    } else if (e.type === "lift") {
      begin(`merged: ${pending.map((k) => values[k - 1]).join(" ")}`);
      cuts.delete(run.mid);
      pending.forEach((item, k) => {
        s.set(sortPart.item(id, item), "y", 0, 0.1 + (0.4 * k) / pending.length, 0.4);
        at[e.lo + k] = item;
      });
      s.set(sortPart.finger(id, "a"), "opacity", 0, 0, 0.2).set(sortPart.finger(id, "b"), "opacity", 0, 0, 0.2);
      place(0.5, 0.4);
    } else if (e.type === "sorted") {
      if (!open.started) begin(`in place: ${e.i.map(val).join(" ")}`);
      // A bar is filled, its value sits outside it. A box keeps its fill, since its value sits on it, and takes the
      // highlight in its edge and its value, which reads on any page.
      for (const p of e.i) {
        if (show === "bars") s.set(shape(p), "fill", "highlight", 0.85, 0.15);
        else s.set(shape(p), "stroke", "highlight", 0.85, 0.15).set(sortPart.value(id, at[p]!), "color", "highlight", 0.85, 0.15);
      }
      if (usesPointer && e.i.length) s.set(sortPart.pointer(id), "opacity", 0, 0.9, 0.1);
    }
  }
  const how = algo === "merge"
    ? `drawn as one row (form=row): a cut opens a gap between the halves in the row; in a merge the smaller value moves down out of the row into the merged run below it, and the last step of that merge lifts the merged run back up into the row`
    : `drawn as one row of ${show}: a swap exchanges two places in the row, and a value that moves slides along it`;
  return { parts, steps: s.finish(), drawn: how };
}

// Merge sort by level. Each run sits at the level of its depth in the split tree: a cut moves both halves one level on,
// a merge takes each value back into the level of the run being merged, in order, while a finger under (or beside) the
// front of each half moves on. The values end where they started, at the first level, sorted.
function treeBoard(id: string, values: number[], log: SortEvent[], form: "down" | "across", levelStep: number): Board {
  const n = values.length;
  const labels = values.map(String);
  // Boxes fit their values closely, so at any size the value is most of what is seen.
  const box = Math.max(SIZE * 1.3, ...labels.map((l) => textWidth(l, SIZE) + SIZE * 0.45));
  const { depth, deepest, block, reached } = levelsOf(n, log);
  const pitch = box * PITCH_TREE;
  const gap = box * GAP_TREE;
  const step = box * levelStep;
  // Where position p sits at level L: along its level, centered, with a gap between runs; and the level itself.
  const span = (L: number) => n * pitch + Math.max(...block[L]!) * gap;
  const along = (p: number, L: number) => p * pitch + block[L]![p]! * gap - span(L) / 2 + pitch / 2;
  const at = (p: number, L: number) => (form === "down" ? { x: along(p, L), y: L * step } : { x: L * step, y: along(p, L) });
  const w = box * 0.9;
  const parts: NodeSpec[] = [{ id, kind: "group", props: {} }];
  // The tree stays drawn: where a value leaves a place, a faint outline of that place remains, so the levels the
  // process went through, and the places merged values come back to, are seen.
  const outline = [-w / 2, -w / 2, w / 2, -w / 2, w / 2, w / 2, -w / 2, w / 2, -w / 2, -w / 2];
  for (let L = 0; L <= deepest; L++) for (let p = 0; p < n; p++) if (reached(L, p)) parts.push({ id: sortPart.place(id, L, p), kind: "path", parent: id, props: { ...at(p, L), points: outline, closed: 1, fill: "none", stroke: "ink", strokeWidth: 3, opacity: 0 } });
  // A place a value left stays as a faint outline, but only on the levels being worked (the level a step takes values
  // from and the level it takes them to): outlines everywhere else would fill the frame with empty boxes.
  const QUIET = 0.3;
  const left = new Set<string>();
  const shown = new Map<string, number>();
  const working = new Set<number>();
  const show = (key: string, start: number) => {
    const [L, p] = key.split(",").map(Number) as [number, number];
    const want = working.has(L) ? QUIET : 0;
    if ((shown.get(key) ?? 0) === want) return;
    s.set(sortPart.place(id, L, p), "opacity", want, start, 0.4);
    shown.set(key, want);
  };
  const work = (levels: number[], start: number) => {
    working.clear();
    levels.forEach((L) => working.add(L));
    for (const key of left) show(key, start);
  };
  const leave = (L: number, p: number, start: number) => {
    left.add(`${L},${p}`);
    show(`${L},${p}`, start);
  };
  values.forEach((_, i) => {
    const k = i + 1;
    parts.push({ id: sortPart.item(id, k), kind: "group", parent: id, props: at(i, 0) });
    parts.push({ id: sortPart.shape(id, k), kind: "path", parent: sortPart.item(id, k), props: { points: [-w / 2, -w / 2, w / 2, -w / 2, w / 2, w / 2, -w / 2, w / 2, -w / 2, -w / 2], closed: 1, fill: "paper", stroke: "ink", strokeWidth: 5 } });
    parts.push(text(sortPart.value(id, k), sortPart.item(id, k), 0, 0, labels[i]!, SIZE, { weight: 700 }));
  });
  // A finger points at the front of each half being merged: under it when levels go down, beside it when they go across.
  const f = SIZE * 0.34;
  const fingerAt = (p: number, L: number) => {
    const c = at(p, L);
    return form === "down" ? { x: c.x, y: c.y + w / 2 + 6 } : { x: c.x + w / 2 + 6, y: c.y };
  };
  const mark = form === "down" ? [0, 0, f, f * 1.5, -f, f * 1.5, 0, 0] : [0, 0, f * 1.5, -f, f * 1.5, f, 0, 0];
  for (const side of ["a", "b"] as const) {
    parts.push({ id: sortPart.finger(id, side), kind: "group", parent: id, props: { ...fingerAt(0, 0), opacity: 0 } });
    parts.push({ id: `${sortPart.finger(id, side)}.mark`, kind: "path", parent: sortPart.finger(id, side), props: { points: mark, closed: 1, fill: "accent", stroke: "accent", strokeWidth: 3 } });
  }
  const wide = Math.max(...block.map((_, L) => span(L)));
  const deep = deepest * step;
  const reach = w / 2 + 6 + f * 1.5 + 10; // room past the last level for its fingers
  parts.push(form === "down" ? frame(`${id}.frame`, id, -wide / 2, -box / 2 - 10, wide / 2, deep + reach) : frame(`${id}.frame`, id, -box / 2 - 10, -wide / 2, deep + reach, wide / 2));

  const s = new Story(parts);
  const order = values.map((_, i) => i + 1); // order[p]: the item at position p
  const val = (p: number) => values[order[p]! - 1]!;
  const shape = (p: number) => sortPart.shape(id, order[p]!);
  const vals = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, k) => val(lo + k)).join(" ");
  const move = (item: number, to: { x: number; y: number }, start: number, dur: number) => s.set(sortPart.item(id, item), "x", to.x, start, dur).set(sortPart.item(id, item), "y", to.y, start, dur);
  const run = { lo: 0, mid: 0, hi: 0, a: 0, b: 0, d: 0 };
  const pending: number[] = [];
  const finger = (side: "a" | "b", p: number, last: number) => {
    if (p <= last) {
      const c = fingerAt(p, run.d + 1);
      s.set(sortPart.finger(id, side), "x", c.x, 0.5, 0.4).set(sortPart.finger(id, side), "y", c.y, 0.5, 0.4);
    } else s.set(sortPart.finger(id, side), "opacity", 0, 0.5, 0.3);
  };
  let open = { started: false, moved: false };
  const begin = (say: string) => {
    s.step(say);
    open = { started: true, moved: false };
  };
  for (let i = 0; i < log.length; i++) {
    const e = log[i]!;
    if (e.type === "compare") {
      const next = log[i + 1];
      const sign = e.result === "less" ? "<" : e.result === "greater" ? ">" : "=";
      begin(`compare ${e.a} ${sign} ${e.b}${next?.type === "take" ? `, take ${val(next.from)}` : ""}`);
      s.flash(shape(e.i), "stroke", "accent").flash(shape(e.j), "stroke", "accent").flash(sortPart.value(id, order[e.i]!), "color", "accent").flash(sortPart.value(id, order[e.j]!), "color", "accent");
    } else if (e.type === "divide") {
      begin(`split ${vals(e.lo, e.hi)} into ${vals(e.lo, e.mid)} and ${vals(e.mid + 1, e.hi)}`);
      const L = depth(e.lo, e.hi) + 1;
      work([L - 1, L], 0.1);
      for (let p = e.lo; p <= e.hi; p++) {
        move(order[p]!, at(p, L), 0.1, 0.6);
        leave(L - 1, p, 0.1);
      }
    } else if (e.type === "split") {
      begin(`merge ${vals(e.lo, e.mid)} with ${vals(e.mid + 1, e.hi)}: a finger on the front of each`);
      for (let p = e.lo; p <= e.hi; p++) s.flash(sortPart.value(id, order[p]!), "color", "accent");
      Object.assign(run, { lo: e.lo, mid: e.mid, hi: e.hi, a: e.lo, b: e.mid + 1, d: depth(e.lo, e.hi) });
      work([run.d, run.d + 1], 0);
      for (const [side, p] of [["a", e.lo], ["b", e.mid + 1]] as const) {
        const c = fingerAt(p, run.d + 1);
        s.set(sortPart.finger(id, side), "x", c.x, 0, 0).set(sortPart.finger(id, side), "y", c.y, 0, 0).set(sortPart.finger(id, side), "opacity", 1, 0.1, 0.4);
      }
      pending.length = 0;
    } else if (e.type === "take") {
      if (!open.started || open.moved) begin(`take ${val(e.from)}${e.from <= run.mid ? (run.b > run.hi ? ", the right side is used up" : "") : run.a > run.mid ? ", the left side is used up" : ""}`);
      move(order[e.from]!, at(e.to, run.d), 0.35, 0.55);
      leave(run.d + 1, e.from, 0.35);
      if (e.from <= run.mid) finger("a", ++run.a, run.mid);
      else finger("b", ++run.b, run.hi);
      pending.push(order[e.from]!);
      open.moved = true;
    } else if (e.type === "lift") {
      begin(`merged: ${pending.map((k) => values[k - 1]).join(" ")}`);
      pending.forEach((item, k) => (order[e.lo + k] = item));
      s.set(sortPart.finger(id, "a"), "opacity", 0, 0, 0.2).set(sortPart.finger(id, "b"), "opacity", 0, 0, 0.2);
    } else if (e.type === "sorted") {
      if (!open.started) begin(`in place: ${e.i.map(val).join(" ")}`);
      for (const p of e.i) s.set(shape(p), "stroke", "highlight", 0.85, 0.15).set(sortPart.value(id, order[p]!), "color", "highlight", 0.85, 0.15);
    }
  }
  const how = form === "down"
    ? `drawn as levels stacked downward (form=down): a cut moves the halves one level down; in a merge each value moves up into the level above, so merged values travel upward and the sorted run ends in the top level`
    : `drawn as levels side by side (form=across), each level a column: a cut moves the halves one level to the right; in a merge each value moves left into the level before, so merged values travel leftward and the sorted run ends in the first column`;
  return { parts, steps: s.finish(), drawn: how };
}

export const sortKit: Kit = {
  name: "sort",
  kinds: { sort: truthKind("sort", sortBoard, ["data", "algo", "show", "order", "form"]) },
  behaviors: { steps: playSteps },
  docs: {
    sort: "`sort s data=[5,2,8,1,9] algo=bubble|insertion|selection|merge|quick show=bars|boxes` runs the real sort; each comparison is a step (with its swap or move), so the count depends on the data: use `do steps s until=@N`. Merge shows the whole method: each cut of a run is a step that opens a gap between its halves; each merge starts with a step that puts a finger under the front of each half, every comparison takes the smaller value down into the merged run below while that finger moves on, and a last step lifts the merged run back up as the gap closes. `order=levels` (merge) cuts every run first, level by level, then merges level by level from the smallest; the default follows the recursion. Parts: s.item.K (the value that started at place K, from 1; it travels), s.item.K.shape, s.item.K.value, s.pointer (pivot or smallest, quick and selection), s.finger.a and s.finger.b (merge: the fronts of the two halves), s.place.L.K (merge by level: the faint outline of place K at level L, from 0, left where a value moved away). Finished places turn highlight. `form=row|down|across` (merge with boxes): on a tall frame the kit draws merge sort by level unless told otherwise: each cut moves the halves one level on and each merge takes the values back into the level above, ending in the first level, sorted; `down` stacks the levels (merged values move up into the level above), `across` sets them side by side with each level's values in a column (merged values move left), and `row` keeps one row where merged values move down into a run below and are lifted back up. Set form= whenever the words say a direction (down, up, left, right): the picture must move the way the words say. When the direction plans the demonstration, form= belongs in its truth data, and every part writes the thing exactly as planned. Left to auto, the kit picks whichever of down and across lets the values be larger, and the build then tells you which it drew and which way its moves go. Its steps say what each does, so a label it shows is always true",
    steps: STEPS_DOC,
  },
};
