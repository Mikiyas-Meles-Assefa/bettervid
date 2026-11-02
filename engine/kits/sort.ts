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
};

function sortBoard(id: string, d: Record<string, unknown>): Board {
  if (!Array.isArray(d.data)) throw new Error(`sort needs data, a list of numbers, as in sort s data=[5,2,8,1] algo=bubble`);
  const values = d.data.map((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v)) as number[];
  if (values.length < 2 || values.length > 16) throw new Error(`sort shows 2 to 16 values, not ${values.length}`);
  const algo = String(d.algo ?? "bubble") as SortName;
  if (!SORTS.includes(algo)) throw new Error(`algo must be one of ${SORTS.join(", ")}, not ${algo}`);
  const show = String(d.show ?? "bars");
  if (show !== "bars" && show !== "boxes") throw new Error(`show must be bars or boxes, not ${show}`);
  const log = sort(values, algo);
  const n = values.length;
  const labels = values.map(String);
  const box = Math.max(SIZE * 1.7, ...labels.map((l) => textWidth(l, SIZE) + SIZE * 0.8));
  const pitch = box * 1.12;
  const big = Math.max(...values.map(Math.abs)) || 1;
  const slotX = (p: number) => p * pitch + pitch / 2;
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
  const bottom = Math.max(algo === "merge" ? drop + (show === "bars" ? SIZE * 1.2 : box / 2) : 0, usesPointer ? pointerY + SIZE * 1.5 : below);
  parts.push(frame(`${id}.frame`, id, 0, -tallest - 10, n * pitch, bottom + 10));

  const s = new Story(parts);
  const at = values.map((_, i) => i + 1); // at[p] is the item at position p
  const val = (p: number) => values[at[p]! - 1]!;
  const shape = (p: number) => sortPart.shape(id, at[p]!);
  const open = { started: false, moved: false };
  const begin = (say: string) => {
    s.step(say);
    open.started = true;
    open.moved = false;
  };
  const pending: number[] = []; // merge: where each taken value lands, by its slot in the merged run
  for (let i = 0; i < log.length; i++) {
    const e: SortEvent = log[i]!;
    if (e.type === "compare") {
      const next = log[i + 1];
      const sign = e.result === "less" ? "<" : e.result === "greater" ? ">" : "=";
      const swaps = next?.type === "swap";
      begin(`compare ${e.a} ${sign} ${e.b}${swaps ? ", swap" : next?.type === "take" ? `, take ${val(next.from)}` : ""}`);
      s.flash(shape(e.i), "fill", "accent").flash(shape(e.j), "fill", "accent");
      if (show === "boxes") s.flash(shape(e.i), "stroke", "accent").flash(shape(e.j), "stroke", "accent");
    } else if (e.type === "swap") {
      if (!open.started || open.moved) begin(`swap ${val(e.i)} and ${val(e.j)}`);
      const [a, b] = [at[e.i]!, at[e.j]!];
      s.set(sortPart.item(id, a), "x", slotX(e.j), 0.35, 0.55).set(sortPart.item(id, b), "x", slotX(e.i), 0.35, 0.55);
      [at[e.i], at[e.j]] = [b, a];
      open.moved = true;
    } else if (e.type === "pivot" || e.type === "min") {
      if (!open.started || e.type === "pivot") begin(e.type === "pivot" ? `pivot ${val(e.i)}` : `smallest so far ${val(e.i)}`);
      s.set(sortPart.pointer(id), "opacity", 1, 0.6, 0.3).set(sortPart.pointer(id), "x", slotX(e.i), 0.6, 0.35);
    } else if (e.type === "split") {
      begin(`merge positions ${e.lo + 1} to ${e.mid + 1} with ${e.mid + 2} to ${e.hi + 1}`);
      for (let p = e.lo; p <= e.hi; p++) s.flash(sortPart.value(id, at[p]!), "color", "accent");
      pending.length = 0;
    } else if (e.type === "take") {
      if (!open.started || open.moved) begin(`take ${val(e.from)}`);
      const item = at[e.from]!;
      s.set(sortPart.item(id, item), "x", slotX(e.to), 0.35, 0.55).set(sortPart.item(id, item), "y", drop, 0.35, 0.55);
      pending.push(item);
      open.moved = true;
    } else if (e.type === "lift") {
      begin(`merged: ${pending.map((k) => values[k - 1]).join(" ")}`);
      pending.forEach((item, k) => {
        s.set(sortPart.item(id, item), "y", 0, 0.1 + (0.4 * k) / pending.length, 0.4);
        at[e.lo + k] = item;
      });
    } else if (e.type === "sorted") {
      if (!open.started) begin(`in place: ${e.i.map(val).join(" ")}`);
      for (const p of e.i) s.set(shape(p), "fill", "highlight", 0.85, 0.15);
      if (usesPointer && e.i.length) s.set(sortPart.pointer(id), "opacity", 0, 0.9, 0.1);
    }
  }
  return { parts, steps: s.finish() };
}

export const sortKit: Kit = {
  name: "sort",
  kinds: { sort: truthKind("sort", sortBoard, ["data", "algo", "show"]) },
  behaviors: { steps: playSteps },
  docs: {
    sort: "`sort s data=[5,2,8,1,9] algo=bubble|insertion|selection|merge|quick show=bars|boxes` runs the real sort; each comparison is a step (with its swap or move), so the count depends on the data: use `do steps s until=@N`. Parts: s.item.K (the value that started at place K, from 1; it travels), s.item.K.shape, s.item.K.value, s.pointer (pivot or smallest, quick and selection). Finished places turn highlight",
    steps: STEPS_DOC,
  },
};
