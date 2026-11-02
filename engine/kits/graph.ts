// Graphs: every node, edge, label and weight is its own part, so a scene can change any one of them.
import type { Kit, NodeSpec } from "../core/types.ts";
import { circle } from "./shapes.ts";

export type GraphData = { nodes: { id: string; x: number; y: number; label?: string }[]; edges: { id: string; from: string; to: string; weight?: number }[]; radius?: number };

// Part names, so scenes never have to spell them by hand.
export const part = {
  node: (g: string, n: string) => `${g}.node.${n}`,
  label: (g: string, n: string) => `${g}.label.${n}`,
  edge: (g: string, e: string) => `${g}.edge.${e}`,
  weight: (g: string, e: string) => `${g}.weight.${e}`,
};

export const graphKit: Kit = {
  name: "graph",
  kinds: {
    graph: (n) => {
      const d = n.data as GraphData;
      const r = d.radius ?? 62;
      const at = new Map(d.nodes.map((x) => [x.id, x]));
      const out: NodeSpec[] = [{ id: n.id, kind: "group", parent: n.parent, props: n.props }];
      for (const e of d.edges) {
        const [a, b] = [at.get(e.from)!, at.get(e.to)!];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
        out.push({ id: part.edge(n.id, e.id), kind: "path", parent: n.id, props: { points: [a.x + ux * r, a.y + uy * r, b.x - ux * r, b.y - uy * r], stroke: "ink", strokeWidth: 7 } });
        if (e.weight !== undefined) out.push({ id: part.weight(n.id, e.id), kind: "text", parent: n.id, props: { text: String(e.weight), x: (a.x + b.x) / 2 - uy * 34, y: (a.y + b.y) / 2 + ux * 34, size: 50, color: "ink" } });
      }
      for (const x of d.nodes) {
        out.push({ id: part.node(n.id, x.id), kind: "path", parent: n.id, props: { x: x.x, y: x.y, points: circle(0, 0, r), closed: 1, stroke: "ink", strokeWidth: 7, fill: "paper" } });
        out.push({ id: part.label(n.id, x.id), kind: "text", parent: n.id, props: { x: x.x, y: x.y, text: x.label ?? x.id, size: 62, color: "ink", weight: 700 } });
      }
      return out;
    },
  },
};
