// The real algorithm, reporting everything it does. The animation is built from this record, so it cannot be wrong.
import type { TruthEvent } from "../core/types.ts";

export type Edge = { id: string; from: string; to: string; weight: number };
export type DijkstraEvent = TruthEvent<{ node?: string; edge?: string; dist?: number; better?: boolean; path?: string[]; edges?: string[]; total?: number }>;

export function dijkstra(nodes: string[], edges: Edge[], start: string, goal: string): DijkstraEvent[] {
  const dist = new Map(nodes.map((n) => [n, Infinity]));
  const via = new Map<string, Edge>();
  const left = new Set(nodes);
  const log: DijkstraEvent[] = [];
  dist.set(start, 0);
  log.push({ type: "start", node: start, dist: 0 });
  while (left.size) {
    const u = [...left].sort((a, b) => dist.get(a)! - dist.get(b)!)[0]!;
    if (dist.get(u) === Infinity) break;
    left.delete(u);
    log.push({ type: "visit", node: u, dist: dist.get(u)! });
    for (const e of edges) {
      if (e.from !== u && e.to !== u) continue;
      const v = e.from === u ? e.to : e.from;
      if (!left.has(v)) continue;
      const d = dist.get(u)! + e.weight;
      const better = d < dist.get(v)!;
      log.push({ type: "relax", edge: e.id, node: v, dist: d, better });
      if (better) {
        dist.set(v, d);
        via.set(v, e);
      }
    }
  }
  const path = [goal];
  const used: string[] = [];
  for (let at = goal; at !== start; ) {
    const e = via.get(at)!;
    used.unshift(e.id);
    at = e.from === at ? e.to : e.from;
    path.unshift(at);
  }
  log.push({ type: "done", path, edges: used, total: dist.get(goal)! });
  return log;
}
