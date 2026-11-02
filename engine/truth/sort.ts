// Sorting algorithms run on the real values, reporting every comparison and every move. Positions count from 0 and
// `ids` name each value by where it started, so an animation can follow one value as it travels.
import type { TruthEvent } from "../core/types.ts";

export const SORTS = ["bubble", "insertion", "selection", "merge", "quick"] as const;
export type SortName = (typeof SORTS)[number];

export type SortEvent =
  | TruthEvent<{ type: "compare"; i: number; j: number; a: number; b: number; result: "less" | "equal" | "greater" }>
  | TruthEvent<{ type: "swap"; i: number; j: number }>
  | TruthEvent<{ type: "pivot"; i: number }> // quick: the value everything in this range is compared with
  | TruthEvent<{ type: "min"; i: number }> // selection: the smallest seen so far in this pass
  | TruthEvent<{ type: "divide"; lo: number; mid: number; hi: number }> // merge: a run is cut in two, lo..mid and mid+1..hi, before either is sorted
  | TruthEvent<{ type: "split"; lo: number; mid: number; hi: number }> // merge: two sorted runs about to be merged
  | TruthEvent<{ type: "take"; from: number; to: number }> // merge: the value at `from` goes to slot `to` of the merged run, below
  | TruthEvent<{ type: "lift"; lo: number; hi: number }> // merge: the merged run goes back up in place
  | TruthEvent<{ type: "sorted"; i: number[] }> // these places hold their final value
  | TruthEvent<{ type: "done"; order: number[]; values: number[] }>; // order[k] is the id at position k

// `levels` (merge only): every run is cut first, level by level, and then the runs are merged level by level from the
// smallest, which is the same merges as the recursion makes, in the order a person working by hand would do them.
export function sort(values: number[], algo: SortName, order: "calls" | "levels" = "calls"): SortEvent[] {
  if (!values.length) throw new Error("there is nothing to sort");
  if (values.some((v) => typeof v !== "number" || !Number.isFinite(v))) throw new Error(`sort data must be numbers, as in [5,2,8,1]`);
  const a = [...values];
  const ids = a.map((_, i) => i);
  const log: SortEvent[] = [];
  const cmp = (i: number, j: number) => {
    const r = a[i]! < a[j]! ? "less" : a[i]! > a[j]! ? "greater" : "equal";
    log.push({ type: "compare", i, j, a: a[i]!, b: a[j]!, result: r });
    return r;
  };
  const swap = (i: number, j: number) => {
    if (i === j) return;
    [a[i], a[j]] = [a[j]!, a[i]!];
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    log.push({ type: "swap", i, j });
  };
  const n = a.length;
  if (algo === "bubble") {
    for (let end = n - 1; end > 0; end--) {
      let swapped = false;
      for (let i = 0; i < end; i++) {
        if (cmp(i, i + 1) === "greater") {
          swap(i, i + 1);
          swapped = true;
        }
      }
      log.push({ type: "sorted", i: swapped ? [end] : Array.from({ length: end + 1 }, (_, k) => k) });
      if (!swapped) break;
    }
    if (!log.some((e) => e.type === "sorted" && e.i.includes(0))) log.push({ type: "sorted", i: [0] });
  } else if (algo === "insertion") {
    for (let i = 1; i < n; i++) {
      for (let j = i; j > 0 && cmp(j - 1, j) === "greater"; j--) swap(j - 1, j);
    }
    log.push({ type: "sorted", i: ids.map((_, k) => k) });
  } else if (algo === "selection") {
    for (let i = 0; i < n - 1; i++) {
      let m = i;
      log.push({ type: "min", i: m });
      for (let j = i + 1; j < n; j++) {
        if (cmp(j, m) === "less") {
          m = j;
          log.push({ type: "min", i: m });
        }
      }
      swap(i, m);
      log.push({ type: "sorted", i: [i] });
    }
    log.push({ type: "sorted", i: [n - 1] });
  } else if (algo === "quick") {
    // Lomuto partition: the last value of each range is the pivot.
    const quick = (lo: number, hi: number) => {
      if (lo > hi) return;
      if (lo === hi) {
        log.push({ type: "sorted", i: [lo] });
        return;
      }
      log.push({ type: "pivot", i: hi });
      let s = lo;
      for (let j = lo; j < hi; j++) {
        if (cmp(j, hi) === "less") {
          swap(s, j);
          s++;
        }
      }
      swap(s, hi);
      log.push({ type: "sorted", i: [s] });
      quick(lo, s - 1);
      quick(s + 1, hi);
    };
    quick(0, n - 1);
  } else if (algo === "merge") {
    const join = (lo: number, mid: number, hi: number) => {
      log.push({ type: "split", lo, mid, hi });
      const [va, vi] = [a.slice(lo, hi + 1), ids.slice(lo, hi + 1)];
      const out: number[] = [];
      let [i, j] = [lo, mid + 1];
      // Positions in `compare` and `take` are where the values sit before this merge moves anything.
      while (i <= mid || j <= hi) {
        let from: number;
        if (i > mid) from = j++;
        else if (j > hi) from = i++;
        else from = cmp(i, j) === "greater" ? j++ : i++;
        log.push({ type: "take", from, to: lo + out.length });
        out.push(from);
      }
      out.forEach((from, k) => {
        a[lo + k] = va[from - lo]!;
        ids[lo + k] = vi[from - lo]!;
      });
      log.push({ type: "lift", lo, hi });
    };
    const merge = (lo: number, hi: number) => {
      if (lo >= hi) return;
      const mid = Math.floor((lo + hi) / 2);
      log.push({ type: "divide", lo, mid, hi });
      merge(lo, mid);
      merge(mid + 1, hi);
      join(lo, mid, hi);
    };
    if (order === "levels") {
      const levels: [number, number, number][][] = [];
      for (let level = [[0, n - 1]] as [number, number][]; level.length; ) {
        const runs = level.filter(([lo, hi]) => lo < hi).map(([lo, hi]) => [lo, Math.floor((lo + hi) / 2), hi] as [number, number, number]);
        if (!runs.length) break;
        levels.push(runs);
        level = runs.flatMap(([lo, mid, hi]) => [[lo, mid], [mid + 1, hi]] as [number, number][]);
      }
      for (const runs of levels) for (const [lo, mid, hi] of runs) log.push({ type: "divide", lo, mid, hi });
      for (const runs of [...levels].reverse()) for (const [lo, mid, hi] of runs) join(lo, mid, hi);
    } else merge(0, n - 1);
    log.push({ type: "sorted", i: ids.map((_, k) => k) });
  } else throw new Error(`algo must be one of ${SORTS.join(", ")}, not ${algo}`);
  log.push({ type: "done", order: [...ids], values: [...a] });
  return log;
}
