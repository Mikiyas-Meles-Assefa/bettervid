// The layout kind: a set of things placed by `arrange`, with no container of its own on screen. It can also hold states,
// each listing what is present, and things travel to their new places as others arrive or leave.
import type { CompileContext, Kit, NodeSpec, Props, Track, Value } from "../core/types.ts";
import { fontOf } from "../kits/text.ts";
import { measure as realMeasure } from "../kits/text-browser.ts";
import { arrange, type Frame, type Item, type Place, type Placement } from "./arrange.ts";
import { partBehaviors, register, type Box } from "./parts.ts";

export type LayoutItem = NodeSpec & { place?: Place };
export type LayoutData = Omit<Frame, "width" | "height"> & {
  items: LayoutItem[];
  states?: string[][]; // the ids present in each state; the first state is shown when added
  width?: number; // the area to fill, the whole frame by default
  height?: number;
};

const num = (v: Value | undefined, d: number) => (typeof v === "number" ? v : d);

// How much room any node takes, around its own origin. Kits are expanded and their primitives measured, so this works
// for anything from any kit. A kit that knows better leaves `data.box` on its first node.
export function boundsOf(spec: NodeSpec, ctx: CompileContext): Box {
  const kinds = Object.assign({}, ...(ctx.kits ?? []).map((k) => k.kinds));
  const expand = (n: NodeSpec): NodeSpec[] => {
    if (["group", "path", "text", "image"].includes(n.kind)) return [n];
    const make = kinds[n.kind];
    if (!make) throw new Error(`unknown kind ${n.kind} on ${n.id}`);
    return make(n, ctx).flatMap(expand);
  };
  const nodes = expand(spec);
  const first = nodes[0]!;
  if (Array.isArray(first.data?.box)) {
    const [left, top, right, bottom] = first.data.box as number[];
    return { left: left!, top: top!, right: right!, bottom: bottom! };
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const offset = (n: NodeSpec): [number, number, number] => {
    if (n === first) return [0, 0, 1]; // the thing's own place is what layout is about to decide
    const parent = n.parent ? byId.get(n.parent) : undefined;
    const [px, py, ps] = parent ? offset(parent) : [0, 0, 1];
    return [px + num(n.props?.x, 0) * ps, py + num(n.props?.y, 0) * ps, ps * num(n.props?.scaleX, 1)];
  };
  const boxes: Box[] = [];
  for (const n of nodes) {
    const p: Props = n.props ?? {};
    const [x, y, s] = offset(n);
    if (n.kind === "path") {
      const pts = p.points as number[];
      const stroke = p.stroke && p.stroke !== "none" ? num(p.strokeWidth, 6) / 2 : 0;
      const [xs, ys] = [pts.filter((_, i) => i % 2 === 0), pts.filter((_, i) => i % 2 === 1)];
      boxes.push({ left: x + (Math.min(...xs) - stroke) * s, right: x + (Math.max(...xs) + stroke) * s, top: y + (Math.min(...ys) - stroke) * s, bottom: y + (Math.max(...ys) + stroke) * s });
    } else if (n.kind === "image") {
      const [w, h] = [num(p.w, 0) * s, num(p.h, 0) * s];
      boxes.push({ left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 });
    } else if (n.kind === "text") {
      const size = num(p.size, 60) * s;
      const m = (ctx.measure ?? realMeasure)({ clusters: [String(p.text ?? "")], font: typeof p.font === "string" ? p.font : fontOf(ctx.theme), weight: num(p.weight, 400) });
      const w = m.edges[0]! * size;
      const h = (m.ascent + m.descent) * size;
      const shift = p.anchor === "start" ? w / 2 : p.anchor === "end" ? -w / 2 : 0;
      boxes.push({ left: x + shift - w / 2, right: x + shift + w / 2, top: y - h / 2, bottom: y + h / 2 });
    }
  }
  if (!boxes.length) throw new Error(`${spec.id} has nothing to measure`);
  return { left: Math.min(...boxes.map((b) => b.left)), top: Math.min(...boxes.map((b) => b.top)), right: Math.max(...boxes.map((b) => b.right)), bottom: Math.max(...boxes.map((b) => b.bottom)) };
}

export function placeAll(d: LayoutData, ctx: CompileContext, ids?: string[]): { items: Item[]; placed: Placement[] } {
  const only = ids ? new Set(ids) : undefined;
  const known = new Set(d.items.map((i) => i.id));
  for (const id of ids ?? []) if (!known.has(id)) throw new Error(`layout has no ${id}`);
  const items: Item[] = d.items.filter((i) => !only || only.has(i.id)).map((i) => ({ id: i.id, box: boundsOf(i, ctx), place: i.place }));
  return { items, placed: arrange(items, { ...d, width: d.width ?? ctx.width, height: d.height ?? ctx.height }) };
}

export const layoutKit: Kit = {
  name: "layout",
  kinds: {
    layout: (n, ctx) => {
      const d = n.data as LayoutData;
      if (!d?.items?.length) throw new Error(`${n.id} has nothing to lay out`);
      const states = (d.states ?? [d.items.map((i) => i.id)]).map((ids) => {
        const { placed } = placeAll(d, ctx, ids);
        return new Map(placed.map((p) => [p.id, p]));
      });
      const start = states[0]!;
      let current = 0;
      const live = new Map(d.items.map((i) => {
        const home = start.get(i.id) ?? states.flatMap((s) => [...s.values()]).find((p) => p.id === i.id);
        if (!home) throw new Error(`${i.id} is in no state`);
        return [i.id, { ...home, shown: start.has(i.id) }];
      }));
      register(ctx, n.id, {
        members: (part) => {
          const hit = part === "all" ? [...states[current]!.values()] : [states[current]!.get(part)].flatMap((p) => (p ? [p] : []));
          if (!hit.length) throw new Error(`${n.id} has no part called ${part}`);
          return hit.map((p) => ({ id: p.id, x: p.x, y: p.y, kind: "path" as const, live: {} }));
        },
        become: ({ start: at, args, ctx: c }) => {
          const next = states[Number(args.state)];
          if (!next) throw new Error(`${n.id} has no state ${String(args.state)}`);
          const frames = num(args.frames, c.theme.moveFrames * 2);
          const tracks: Track[] = [];
          for (const [id, was] of live) {
            const to = next.get(id);
            if (!to) {
              if (was.shown) tracks.push({ target: id, prop: "opacity", keys: [{ at, value: 1 }, { at: at + frames / 2, value: 0, ease: "smooth" }] });
              was.shown = false;
              continue;
            }
            if (!was.shown) {
              const set = (prop: string, value: number) => tracks.push({ target: id, prop, keys: [{ at, value }] });
              set("x", to.x);
              set("y", to.y);
              set("scaleX", to.scale);
              set("scaleY", to.scale);
              tracks.push({ target: id, prop: "opacity", keys: [{ at: at + frames / 2, value: 0 }, { at: at + frames, value: 1, ease: "smooth" }] });
            } else {
              const glide = (prop: string, from: number, value: number) => {
                if (from !== value) tracks.push({ target: id, prop, keys: [{ at, value: from }, { at: at + frames, value, ease: c.theme.ease }] });
              };
              glide("x", was.x, to.x);
              glide("y", was.y, to.y);
              glide("scaleX", was.scale, to.scale);
              glide("scaleY", was.scale, to.scale);
            }
            Object.assign(was, to, { shown: true });
          }
          current = Number(args.state);
          return tracks;
        },
      });
      const out: NodeSpec[] = [{ id: n.id, kind: "group", parent: n.parent, props: n.props }];
      for (const i of d.items) {
        const p = live.get(i.id)!;
        const props: Props = { ...i.props, x: p.x, y: p.y, scaleX: p.scale, scaleY: p.scale };
        if (!p.shown) props.opacity = 0;
        const { place: _, ...spec } = i;
        out.push({ ...spec, parent: n.id, props });
      }
      return out;
    },
  },
  behaviors: partBehaviors,
};
