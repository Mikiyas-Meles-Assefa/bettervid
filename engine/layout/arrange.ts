// Placing things relative to each other. Things stack by default, nothing lands on anything else unless it was asked
// to sit inside it, and the whole arrangement fits the frame. It works from sizes alone, so it knows no kit or topic.
import type { Box } from "./parts.ts";

export type Place = {
  rightOf?: string;
  leftOf?: string;
  above?: string;
  below?: string;
  inside?: string; // centered within another thing; it shrinks to fit and may overlap that thing
  center?: boolean | "x" | "y"; // centered in the frame on that axis
  fill?: boolean; // grows to take whatever room is left, or all of the thing it is inside
  align?: "start" | "center" | "end"; // along the edge of the thing it is placed against
  gap?: number;
};
export type Item = { id: string; box: Box; place?: Place }; // box is around the item's own origin, at scale 1
export type Frame = { width: number; height: number; pad?: number; gap?: number; flow?: "down" | "right"; grow?: boolean };
export type Placement = { id: string; x: number; y: number; scale: number };

const wide = (b: Box) => b.right - b.left;
const tall = (b: Box) => b.bottom - b.top;
type Spot = { item: Item; left: number; top: number; scale: number; w: number; h: number };

const touches = (a: Spot, b: Spot) => a.left < b.left + b.w - 0.01 && b.left < a.left + a.w - 0.01 && a.top < b.top + b.h - 0.01 && b.top < a.top + a.h - 0.01;

function solve(items: Item[], f: Required<Pick<Frame, "gap" | "flow">>, scales: Map<string, number>): Map<string, Spot> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const done = new Map<string, Spot>();
  const busy = new Set<string>();
  let last: string | undefined; // the thing stacking continues from
  const refOf = (p?: Place) => p?.rightOf ?? p?.leftOf ?? p?.above ?? p?.below ?? p?.inside;

  const put = (item: Item): Spot => {
    const known = done.get(item.id);
    if (known) return known;
    if (busy.has(item.id)) throw new Error(`${item.id} is placed relative to itself`);
    busy.add(item.id);
    const p = item.place ?? {};
    const name = refOf(p);
    const follow = !name && !p.center ? last : undefined;
    const ref = name ?? follow;
    const target = ref ? byId.get(ref) : undefined;
    if (ref && !target) throw new Error(`${item.id} is placed relative to ${ref}, which does not exist`);
    const anchor = target ? put(target) : undefined;
    const s = scales.get(item.id) ?? 1;
    const spot: Spot = { item, left: 0, top: 0, scale: s, w: wide(item.box) * s, h: tall(item.box) * s };
    const gap = p.gap ?? f.gap;
    const across = (start: number, room: number, size: number) => (p.align === "start" ? start : p.align === "end" ? start + room - size : start + (room - size) / 2);
    const side = p.rightOf ? "right" : p.leftOf ? "left" : p.above ? "above" : p.below ? "below" : p.inside ? "inside" : follow ? (f.flow === "right" ? "right" : "below") : undefined;
    if (anchor) {
      if (side === "right" || side === "left") {
        spot.left = side === "right" ? anchor.left + anchor.w + gap : anchor.left - gap - spot.w;
        spot.top = across(anchor.top, anchor.h, spot.h);
      } else if (side === "above" || side === "below") {
        spot.top = side === "below" ? anchor.top + anchor.h + gap : anchor.top - gap - spot.h;
        spot.left = across(anchor.left, anchor.w, spot.w);
      } else {
        spot.left = across(anchor.left, anchor.w, spot.w);
        spot.top = anchor.top + (anchor.h - spot.h) / 2;
      }
    }
    // Pushed along its own direction until clear, so stacked things can never land on each other.
    if (!p.inside) {
      for (let tries = 0; tries < items.length * 2; tries++) {
        const hit = [...done.values()].find((o) => !o.item.place?.inside && touches(spot, o));
        if (!hit) break;
        if (side === "right") spot.left = hit.left + hit.w + gap;
        else if (side === "left") spot.left = hit.left - gap - spot.w;
        else if (side === "above") spot.top = hit.top - gap - spot.h;
        else spot.top = hit.top + hit.h + gap;
      }
    }
    done.set(item.id, spot);
    busy.delete(item.id);
    return spot;
  };
  for (const i of items) {
    put(i);
    if (!i.place?.inside) last = i.id;
  }
  return done;
}

export function arrange(items: Item[], frame: Frame): Placement[] {
  const flow = frame.flow ?? "down";
  const gap = frame.gap ?? Math.round(frame.height * 0.03);
  const pad = frame.pad ?? Math.round(Math.min(frame.width, frame.height) * 0.07);
  const [roomW, roomH] = [frame.width - pad * 2, frame.height - pad * 2];
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.id)) throw new Error(`two things are called ${i.id}`);
    seen.add(i.id);
  }

  // Something too big for the frame shrinks alone, so one wide thing does not make everything around it small.
  const scales = new Map<string, number>();
  for (const i of items) {
    const most = Math.min(roomW / wide(i.box), roomH / tall(i.box));
    if (most < 1 && !i.place?.inside) scales.set(i.id, most);
  }
  const sizing = { gap, flow } as const;
  const extent = (spots: Iterable<Spot>) => {
    const list = [...spots].filter((s) => !s.item.place?.inside);
    const [l, r, t, b] = [Math.min(...list.map((s) => s.left)), Math.max(...list.map((s) => s.left + s.w)), Math.min(...list.map((s) => s.top)), Math.max(...list.map((s) => s.top + s.h))];
    return { l, r, t, b };
  };

  // Things that fill share the room the others leave along the direction of flow.
  const fillers = items.filter((i) => i.place?.fill && !i.place.inside);
  if (fillers.length) {
    for (const i of fillers) scales.set(i.id, 1e-6);
    const e = extent(solve(items, sizing, scales).values());
    const leftOver = (flow === "down" ? roomH - (e.b - e.t) : roomW - (e.r - e.l)) / fillers.length;
    for (const i of fillers) {
      const mainRoom = Math.max(1, leftOver);
      const [w, h] = flow === "down" ? [roomW, mainRoom] : [mainRoom, roomH];
      scales.set(i.id, Math.min(w / wide(i.box), h / tall(i.box)));
    }
  }

  let spots = solve(items, sizing, scales);
  const e = extent(spots.values());
  const shrink = Math.min(roomW / (e.r - e.l), roomH / (e.b - e.t));
  const fit = frame.grow ? shrink : Math.min(1, shrink);

  // Inside things shrink to their holder, or grow to it when they fill.
  const inner = (id: string, holder: Spot, item: Item) => {
    const margin = 0.82;
    const most = Math.min((holder.w * margin) / wide(item.box), (holder.h * margin) / tall(item.box));
    scales.set(id, item.place?.fill ? most : Math.min(scales.get(id) ?? 1, most));
  };
  for (let round = 0; round < 3; round++) for (const i of items) if (i.place?.inside) inner(i.id, spots.get(i.place.inside)!, i);
  spots = solve(items, sizing, scales);

  const [cx, cy] = [(e.l + e.r) / 2, (e.t + e.b) / 2];
  return items.map((i) => {
    const s = spots.get(i.id)!;
    const p = i.place;
    const midX = s.left + s.w / 2;
    const midY = s.top + s.h / 2;
    const x = frame.width / 2 + (p?.center === true || p?.center === "x" ? 0 : (midX - cx) * fit);
    const y = frame.height / 2 + (p?.center === true || p?.center === "y" ? 0 : (midY - cy) * fit);
    const scale = s.scale * fit;
    // The placement is for the item's origin, which need not be the middle of its box.
    return { id: i.id, x: x - ((i.box.left + i.box.right) / 2) * scale, y: y - ((i.box.top + i.box.bottom) / 2) * scale, scale };
  });
}

// Every pair of things sharing space, other than those asked to sit inside each other. Empty means a clean layout.
export function overlaps(items: Item[], placed: Placement[]): [string, string][] {
  const byId = new Map(placed.map((p) => [p.id, p]));
  const rect = (i: Item) => {
    const p = byId.get(i.id)!;
    return { left: p.x + i.box.left * p.scale, right: p.x + i.box.right * p.scale, top: p.y + i.box.top * p.scale, bottom: p.y + i.box.bottom * p.scale };
  };
  const out: [string, string][] = [];
  items.forEach((a, n) => {
    for (const b of items.slice(n + 1)) {
      if (a.place?.inside === b.id || b.place?.inside === a.id) continue;
      const [x, y] = [rect(a), rect(b)];
      if (x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5) out.push([a.id, b.id]);
    }
  });
  return out;
}

// True when every thing is inside the frame.
export function inFrame(items: Item[], placed: Placement[], frame: Pick<Frame, "width" | "height">): boolean {
  const byId = new Map(placed.map((p) => [p.id, p]));
  return items.every((i) => {
    const p = byId.get(i.id)!;
    return p.x + i.box.left * p.scale >= -0.5 && p.y + i.box.top * p.scale >= -0.5 && p.x + i.box.right * p.scale <= frame.width + 0.5 && p.y + i.box.bottom * p.scale <= frame.height + 0.5;
  });
}
