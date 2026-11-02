// Dijkstra's shortest path, played from the real run in engine/truth/dijkstra.ts on a graph the engine lays out.
import type { Kit, NodeSpec } from "../core/types.ts";
import { graphPositions } from "../language/layout.ts";
import { dijkstra, type Edge } from "../truth/dijkstra.ts";
import { graphKit, part } from "./graph.ts";
import { frame, playSteps, Story, STEPS_DOC, text, truthKind, type Board } from "./steps.ts";

const R = 62;

export const dijkstraPart = { ...part, dist: (g: string, n: string) => `${g}.dist.${n}`, total: (g: string) => `${g}.total` };

// "A-B:4,A-C:2" or [["A","B",4],["A","C",2]]. Edge ids are the two ends joined, as the language names graph edges.
function edgesOf(raw: unknown): Edge[] {
  const list: [string, string, number][] = Array.isArray(raw)
    ? raw.map((e) => {
        if (!Array.isArray(e) || e.length < 2) throw new Error(`each edge is ["A","B",4]`);
        return [String(e[0]), String(e[1]), e[2] === undefined ? 1 : Number(e[2])];
      })
    : String(raw ?? "").split(",").filter(Boolean).map((t) => {
        const m = /^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)(?::(-?\d+(?:\.\d+)?))?$/.exec(t.trim());
        if (!m) throw new Error(`cannot read the edge "${t}"; write edges as edges=A-B:4,A-C:2,B-C:1`);
        return [m[1]!, m[2]!, m[3] === undefined ? 1 : Number(m[3])];
      });
  if (!list.length) throw new Error(`dijkstra needs edges, as in edges=A-B:4,A-C:2,B-C:1`);
  const seen = new Set<string>();
  return list.map(([from, to, weight]) => {
    if (from === to) throw new Error(`the edge ${from}-${to} joins a node to itself`);
    const id = `${from}${to}`;
    if (seen.has(id)) throw new Error(`the edge ${from}-${to} is listed twice`);
    seen.add(id);
    return { id, from, to, weight };
  });
}

function dijkstraBoard(id: string, d: Record<string, unknown>, ctx: Parameters<NonNullable<Kit["kinds"]>[string]>[1]): Board {
  const edges = edgesOf(d.edges);
  const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  const start = String(d.from ?? nodes[0]);
  const goal = String(d.to ?? nodes.at(-1));
  const log = dijkstra(nodes, edges, start, goal);
  const at = graphPositions(nodes, edges, 1000, R);
  const graph: NodeSpec = { id, kind: "graph", data: { radius: R, nodes: nodes.map((n) => ({ id: n, ...at.get(n)! })), edges } };
  const parts = graphKit.kinds!.graph!(graph, ctx);
  for (const n of nodes) {
    const p = at.get(n)!;
    parts.push(text(dijkstraPart.dist(id, n), id, p.x, p.y - R - 46, "∞", 50, { color: "accent", weight: 700, opacity: 0 }));
  }
  const ys = nodes.map((n) => at.get(n)!.y);
  const xs = nodes.map((n) => at.get(n)!.x);
  const bottom = Math.max(...ys) + R + 120;
  parts.push(text(dijkstraPart.total(id), id, 0, bottom, "", 72, { weight: 700, opacity: 0 }));
  parts.push(frame(`${id}.frame`, id, Math.min(...xs) - R - 20, Math.min(...ys) - R - 90, Math.max(...xs) + R + 20, bottom + 50));
  const s = new Story(parts);
  const dist = new Map<string, number>();
  let current = start;
  for (const e of log) {
    if (e.type === "start") {
      s.step(`start at ${e.node} with distance 0; every other place is unknown`);
      for (const n of nodes) s.set(dijkstraPart.dist(id, n), "opacity", 1, 0, 0.4);
      s.set(dijkstraPart.dist(id, e.node!), "text", "0", 0.3, 0).play(part.node(id, e.node!), "pulse", 0.3);
      dist.set(e.node!, 0);
    } else if (e.type === "visit") {
      current = e.node!;
      s.step(`settle ${e.node}, the closest unsettled place, at ${e.dist}`);
      s.set(part.node(id, e.node!), "fill", "accent", 0, 0.4).set(part.label(id, e.node!), "color", "paper", 0, 0.4).play(part.node(id, e.node!), "pulse", 0);
    } else if (e.type === "relax") {
      const v = e.node!;
      const old = dist.get(v);
      s.step(`${v} through ${current}: ${dist.get(current)} + ${edges.find((x) => x.id === e.edge)!.weight} = ${e.dist}, ${e.better ? (old === undefined ? "the first route found" : `better than ${old}`) : `no better than ${old}`}`);
      s.play(part.edge(id, e.edge!), "flow", 0, { color: e.better ? "accent" : "ink", frames: 18 });
      if (e.better) {
        s.set(dijkstraPart.dist(id, v), "text", String(e.dist), 0.55, 0).play(dijkstraPart.dist(id, v), "pulse", 0.55);
        dist.set(v, e.dist!);
      } else s.play(dijkstraPart.dist(id, v), "shake", 0.55, { size: 10 });
    } else if (e.type === "done") {
      s.step(`the shortest path is ${e.path!.join(" ")}, total ${e.total}`);
      for (const x of edges) if (!e.edges!.includes(x.id)) s.set(part.edge(id, x.id), "opacity", 0.18, 0, 0.4);
      e.edges!.forEach((x, k) => s.set(part.edge(id, x), "stroke", "accent", 0.1 + k * 0.1, 0.3).set(part.edge(id, x), "strokeWidth", 16, 0.1 + k * 0.1, 0.3));
      s.set(dijkstraPart.total(id), "text", `${e.path!.join(" → ")} = ${e.total}`, 0, 0).set(dijkstraPart.total(id), "opacity", 1, 0.5, 0.4);
    }
  }
  return { parts, steps: s.finish() };
}

export const dijkstraKit: Kit = {
  name: "dijkstra",
  kinds: { dijkstra: truthKind("dijkstra", dijkstraBoard, ["edges", "from", "to"]) },
  behaviors: { steps: playSteps },
  docs: {
    dijkstra: "`dijkstra d edges=A-B:4,A-C:2,B-C:1,C-D:5 from=A to=D` a graph laid out by the engine that runs Dijkstra's shortest path for real. Steps: the start, then for each place settled one step to settle it and one per road checked from it (a better distance is written, a worse one shakes), then the path itself. Parts: d.node.A, d.label.A, d.edge.AB, d.weight.AB, d.dist.A (its distance so far), d.total",
    steps: STEPS_DOC,
  },
};
