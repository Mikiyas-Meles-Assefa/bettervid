// Where a computed demonstration is working at each step: the parts a step changes, where they are before it and after
// it, in the kit's own coordinates. The camera follows this so the cells being worked on read large on a phone.
import type { NodeSpec, Value } from "../core/types.ts";
import type { Board } from "../kits/steps.ts";
import { estimate } from "./layout.ts";

export type Area = { x: number; y: number; w: number; h: number };
type State = Map<string, Value>;

const key = (id: string, prop: string) => `${id}\u0000${prop}`;

export function stepAreas(board: Board, nodes: NodeSpec[], from: number, to: number): (Area | undefined)[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = nodes[0]?.id;
  const prop = (id: string, p: string, s: State): number => Number(s.get(key(id, p)) ?? byId.get(id)?.props?.[p] ?? (p === "opacity" ? 1 : 0));
  const up = (id: string): NodeSpec[] => {
    const out: NodeSpec[] = [];
    for (let n = byId.get(id); n && n.id !== root; n = n.parent ? byId.get(n.parent) : undefined) out.push(n);
    return out;
  };
  const shown = (id: string, s: State) => up(id).every((n) => prop(n.id, "opacity", s) > 0.02);
  const under = (id: string) => nodes.filter((n) => n.id !== root && up(n.id).some((a) => a.id === id));
  // The box of one part in the kit's coordinates, at a moment of its story.
  const boxOf = (n: NodeSpec, s: State): Area | undefined => {
    const [ox, oy] = up(n.id).reduce(([x, y], a) => [x + prop(a.id, "x", s), y + prop(a.id, "y", s)], [0, 0]);
    const pts = n.props?.points;
    if (Array.isArray(pts) && pts.length >= 4) {
      if ((n.props?.stroke ?? "none") === "none" && (n.props?.fill ?? "none") === "none") return undefined;
      const xs = (pts as number[]).filter((_, i) => i % 2 === 0);
      const ys = (pts as number[]).filter((_, i) => i % 2 === 1);
      const [l, r, t, d] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      return { x: ox + (l + r) / 2, y: oy + (t + d) / 2, w: r - l, h: d - t };
    }
    if (n.kind === "text" && n.props?.text !== undefined) {
      const size = Number(n.props.size ?? 60);
      return { x: ox, y: oy, w: estimate(String(n.props.text), size), h: size * 1.2 };
    }
  };
  const union = (list: Area[]): Area | undefined => {
    if (!list.length) return undefined;
    const [l, r] = [Math.min(...list.map((b) => b.x - b.w / 2)), Math.max(...list.map((b) => b.x + b.w / 2))];
    const [t, d] = [Math.min(...list.map((b) => b.y - b.h / 2)), Math.max(...list.map((b) => b.y + b.h / 2))];
    return { x: (l + r) / 2, y: (t + d) / 2, w: r - l, h: d - t };
  };
  const out: (Area | undefined)[] = [];
  for (let i = from; i <= to; i++) {
    const step = board.steps[i - 1];
    if (!step) break;
    const before: State = i > 1 ? board.steps[i - 2]!.after : new Map();
    const ids = [...new Set([...step.changes.map((c) => c.id), ...step.plays.map((p) => p.id)])].filter((id) => id !== root);
    const boxes: Area[] = [];
    for (const s of [before, step.after]) {
      for (const id of ids) {
        const n = byId.get(id);
        if (!n) continue;
        for (const part of [n, ...under(id)]) {
          if (!shown(part.id, s)) continue;
          const b = boxOf(part, s);
          if (b) boxes.push(b);
        }
      }
    }
    out.push(union(boxes));
  }
  return out;
}

// Every line of words a kit shows once a step is done (step 0: before any), in the kit's coordinates, so a view can keep
// each whole or wholly out of it while the parts move. (A cell may be cut by the edge of a close view; its value not.)
export function wordsAfter(board: Board, nodes: NodeSpec[], step: number): { id: string; box: Area; text: string }[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = nodes[0]?.id;
  const s: State = step > 0 ? board.steps[step - 1]?.after ?? new Map() : new Map();
  const prop = (id: string, p: string): number => Number(s.get(key(id, p)) ?? byId.get(id)?.props?.[p] ?? (p === "opacity" ? 1 : 0));
  const out: { id: string; box: Area; text: string }[] = [];
  for (const n of nodes) {
    if (n.kind !== "text" || n.props?.text === undefined) continue;
    let [x, y, seen] = [0, 0, true];
    for (let a = byId.get(n.id); a && a.id !== root; a = a.parent ? byId.get(a.parent) : undefined) {
      x += prop(a.id, "x");
      y += prop(a.id, "y");
      if (prop(a.id, "opacity") <= 0.02) seen = false;
    }
    if (!seen) continue;
    const size = Number(n.props.size ?? 60);
    out.push({ id: n.id, box: { x, y, w: estimate(String(n.props.text), size), h: size * 1.2 }, text: String(n.props.text) });
  }
  return out;
}

// The size words in a kit are set at, as most of them are: the middle of its text sizes.
export function textSize(nodes: NodeSpec[]): number | undefined {
  const sizes = nodes.filter((n) => n.kind === "text").map((n) => Number(n.props?.size ?? 0)).filter((v) => v > 0).sort((a, b) => a - b);
  return sizes.length ? sizes[Math.floor(sizes.length / 2)] : undefined;
}
