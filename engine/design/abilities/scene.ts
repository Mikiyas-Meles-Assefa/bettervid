// Staging: related things laid out as one scene, not stacked like a list. Each relation the author states (a on b, a
// tied to b, a beside b ...) puts a point of one thing on a point of the other: the depicter's named points (a deck's top,
// a rope's end, a seat), else the points the relation implies on each thing's box (a's bottom on b's top). Things keep
// their real sizes, so the whole scene shares one scale; the scene is solved once in centimetres and then fitted to
// whatever box the stage gives it. A thing the others rest on, stand in or hang over (a floor, a field, a body of water)
// may run past the box's sides when the design allows it, so the things on it keep a size the eye can read.
//
// The solver is geometry: no topic, no taste. What it cannot hold (two relations that disagree, a size that is missing)
// it reports, and the caller passes it on to whoever can repair it.
import type { RelationKind } from "../types.ts";
import type { Member } from "./stage.ts";

type Pt = [number, number];

/** A thing in a scene: its box in local units (origin at the base center, y up as negative numbers), its real size when known, and its named points. */
export type SceneThing = {
  id: string;
  w: number;
  h: number;
  realCm?: { w: number; h: number };
  /** A named point in local units, or undefined when it has none by that name. */
  point(name: string): Pt | undefined;
};

/**
 * One relation, as the solver reads it. `aPoints` and `bPoints` are point names to try first (a flow's outlet and
 * mouth); `at` is a place on b the author named; `gapCm` the distance the author gave; `gapShare` a gap as a share of
 * both things' heights together (a source's outlet held a little over a vessel's mouth).
 */
export type SceneRel = { a: string; b: string; kind: RelationKind; at?: string; gapCm?: number; gapShare?: number; aPoints?: string[]; bPoints?: string[]; words?: string };

/** Where a thing stands in the scene: its base center in centimetres (y down), and centimetres per local unit. */
export type ScenePlace = { x: number; y: number; k: number };

export type SceneCheck = { rel: SceneRel; held: boolean; offCm: number; by?: { a: string; b: string } };

export type SceneLayout = {
  places: Map<string, ScenePlace>;
  /** Back to front. */
  z: string[];
  /** Things the others rest on, stand in or hang over, and that rest on nothing: they may run past the box. */
  grounds: string[];
  /** Every relation, held or not, with how far it is off in centimetres; `by` names the points that were used. */
  checks: SceneCheck[];
  /** Things with no real size: drawn at an estimated size, which the depicter should replace with the real one. */
  unsized: string[];
  notes: string[];
};

export type SceneParams = {
  /** Space between things side by side, as a share of the smaller one's width (when the author gives no distance). */
  gap: number;
};

const SIDE: RelationKind[] = ["beside", "left", "right", "against"];
// Relations that place a on b; the rest arrange things that each stand on their own.
const SUPPORT: RelationKind[] = ["on", "over", "under", "in", "to", "at"];
// Which point of a, and of b, a relation joins when no point is named for it.
const A_POINT: Record<RelationKind, string> = { on: "bottom", over: "bottom", at: "bottom", under: "top", in: "center", to: "top", beside: "bottom", left: "bottom", right: "bottom", against: "bottom", behind: "bottom", front: "bottom", around: "center" };
const B_POINT: Record<RelationKind, string> = { on: "top", over: "top", at: "top", under: "bottom", in: "center", to: "top", beside: "bottom", left: "bottom", right: "bottom", against: "bottom", behind: "bottom", front: "bottom", around: "center" };
// Drawn in front of what it is related to (true) or behind it (false).
const FRONT: Record<RelationKind, boolean> = { on: true, over: true, at: true, to: true, in: true, front: true, under: false, behind: false, around: false, beside: true, left: true, right: true, against: true };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : undefined;
};

/** The point names tried on a and on b, in order: the relation's own, the place the author named, the other thing's id, the relation's default. */
export function relPoints(r: SceneRel): { a: string[]; b: string[] } {
  return { a: [...(r.aPoints ?? []), r.b, A_POINT[r.kind]], b: [...(r.bPoints ?? []), ...(r.at ? [r.at] : []), r.a, B_POINT[r.kind]] };
}

/** Solves a scene: every thing's place in centimetres, by its relations, at one real scale. */
export function solveScene(things: SceneThing[], rels: SceneRel[], p: SceneParams): SceneLayout {
  const notes: string[] = [];
  const by = new Map(things.map((t) => [t.id, t]));
  const rs = rels.filter((r) => by.has(r.a) && by.has(r.b) && r.a !== r.b);
  // One scale: centimetres per local unit from each real size. A thing with none is drawn as long as the median thing.
  const sized = things.filter((t) => t.realCm && t.realCm.w > 0 && t.realCm.h > 0);
  const longCm = median(sized.map((t) => Math.max(t.realCm!.w, t.realCm!.h))) ?? 100;
  const k = new Map<string, number>();
  const unsized: string[] = [];
  for (const t of things) {
    if (t.realCm && t.realCm.w > 0) k.set(t.id, t.realCm.w / t.w);
    else {
      k.set(t.id, longCm / Math.max(t.w, t.h));
      unsized.push(t.id);
    }
  }
  if (unsized.length) notes.push(`${unsized.join(", ")} ${unsized.length > 1 ? "have" : "has"} no real size: drawn ${Math.round(longCm)} cm long, as the median thing in the scene`);
  const cm = (id: string, pt: Pt): Pt => [pt[0] * k.get(id)!, pt[1] * k.get(id)!];
  const pick = (id: string, names: string[]): { name: string; at: Pt } => {
    const t = by.get(id)!;
    for (const n of names) {
      const at = t.point(n);
      if (at) return { name: n, at: cm(id, at) };
    }
    return { name: "center", at: cm(id, [0, -t.h / 2]) };
  };
  const wCm = (id: string) => by.get(id)!.w * k.get(id)!;
  const hCm = (id: string) => by.get(id)!.h * k.get(id)!;
  // The offset from b's point to a's point a relation asks for.
  const gapOf = (r: SceneRel) => r.gapCm ?? (r.gapShare !== undefined ? r.gapShare * (hCm(r.a) + hCm(r.b)) : 0);
  const offset = (r: SceneRel): Pt => (r.kind === "over" ? [0, -gapOf(r)] : r.kind === "under" ? [0, gapOf(r)] : [0, 0]);
  const sideGap = (r: SceneRel) => r.gapCm ?? (r.kind === "against" ? 0 : p.gap * Math.min(wCm(r.a), wCm(r.b)));
  const sideDir = (r: SceneRel) => (r.kind === "left" ? -1 : 1);

  // The scene's root: what rests on nothing, the largest first.
  const placedBy = new Set(rs.filter((r) => SUPPORT.includes(r.kind)).map((r) => r.a));
  const sizeOf = (id: string) => wCm(id) * hCm(id);
  const free = things.filter((t) => !placedBy.has(t.id)).sort((a, b) => sizeOf(b.id) - sizeOf(a.id));
  const root = (free[0] ?? [...things].sort((a, b) => sizeOf(b.id) - sizeOf(a.id))[0])!;
  const places = new Map<string, ScenePlace>([[root.id, { x: 0, y: 0, k: k.get(root.id)! }]]);
  const used = new Set<SceneRel>();
  const points = new Map<SceneRel, { a: string; b: string }>();
  // Place one end of a relation from the other. Support relations first, then the ones that only arrange.
  const placeFrom = (r: SceneRel) => {
    const pa = places.get(r.a);
    const pb = places.get(r.b);
    if (SIDE.includes(r.kind)) {
      const ba = pick(r.a, [...(r.aPoints ?? []), "bottom"]);
      const bb = pick(r.b, [...(r.bPoints ?? []), "bottom"]);
      const d = sideDir(r);
      const dx = d * (wCm(r.a) / 2 + sideGap(r) + wCm(r.b) / 2);
      points.set(r, { a: ba.name, b: bb.name });
      if (pb) places.set(r.a, { x: pb.x + dx, y: pb.y + bb.at[1] - ba.at[1], k: k.get(r.a)! });
      else places.set(r.b, { x: pa!.x - dx, y: pa!.y + ba.at[1] - bb.at[1], k: k.get(r.b)! });
      return;
    }
    const names = relPoints(r);
    const a = pick(r.a, names.a);
    const b = pick(r.b, names.b);
    points.set(r, { a: a.name, b: b.name });
    const o = offset(r);
    if (pb) places.set(r.a, { x: pb.x + b.at[0] + o[0] - a.at[0], y: pb.y + b.at[1] + o[1] - a.at[1], k: k.get(r.a)! });
    else places.set(r.b, { x: pa!.x + a.at[0] - o[0] - b.at[0], y: pa!.y + a.at[1] - o[1] - b.at[1], k: k.get(r.b)! });
  };
  const order = [...rs].sort((x, y) => Number(!SUPPORT.includes(x.kind)) - Number(!SUPPORT.includes(y.kind)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of order) {
      if (used.has(r)) continue;
      const one = places.has(r.a) !== places.has(r.b);
      if (!one) continue;
      placeFrom(r);
      used.add(r);
      grew = true;
      break; // supports first, every time a thing is placed
    }
  }
  // Things no relation reaches (a scene of several parts): each part stands beside the last, on its ground.
  for (const t of things) {
    if (places.has(t.id)) continue;
    const ext = extentOf(places, by, k);
    places.set(t.id, { x: ext.x1 + p.gap * wCm(t.id) + wCm(t.id) / 2, y: ext.y1, k: k.get(t.id)! });
    notes.push(`${t.id} is related to nothing placed: it stands beside the scene`);
    // A part of the scene placed this way brings its own relations along.
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of order) if (!used.has(r) && places.has(r.a) !== places.has(r.b)) (placeFrom(r), used.add(r), (grew = true));
    }
  }
  // Every relation, checked against the places: the ones the spanning order did not use may disagree.
  const span = Math.max(1, ...things.map((t) => Math.max(wCm(t.id), hCm(t.id))));
  const checks: SceneCheck[] = rs.map((r) => {
    const pa = places.get(r.a)!;
    const pb = places.get(r.b)!;
    let off: number;
    if (SIDE.includes(r.kind)) {
      const ba = pick(r.a, [...(r.aPoints ?? []), "bottom"]);
      const bb = pick(r.b, [...(r.bPoints ?? []), "bottom"]);
      const want = pb.x + sideDir(r) * (wCm(r.a) / 2 + sideGap(r) + wCm(r.b) / 2);
      off = Math.hypot(pa.x - want, pa.y + ba.at[1] - (pb.y + bb.at[1]));
      if (!points.has(r)) points.set(r, { a: ba.name, b: bb.name });
    } else {
      const names = relPoints(r);
      const a = pick(r.a, names.a);
      const b = pick(r.b, names.b);
      const o = offset(r);
      off = Math.hypot(pa.x + a.at[0] - (pb.x + b.at[0] + o[0]), pa.y + a.at[1] - (pb.y + b.at[1] + o[1]));
      if (!points.has(r)) points.set(r, { a: a.name, b: b.name });
    }
    return { rel: r, held: off <= span * 0.02 + 0.5, offCm: off, by: points.get(r) };
  });
  for (const c of checks) if (!c.held) notes.push(`${c.rel.a} ${c.rel.words ?? c.rel.kind} ${c.rel.b} is ${Math.round(c.offCm)} cm off: another relation already placed ${c.rel.a} and ${c.rel.b}, and the two disagree`);
  // Depth: what rests on, hangs from or stands in front of a thing is drawn after it.
  const after = new Map<string, Set<string>>(things.map((t) => [t.id, new Set()]));
  for (const r of rs) {
    const [back, front] = FRONT[r.kind] ? [r.b, r.a] : [r.a, r.b];
    after.get(front)!.add(back);
  }
  const z: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string, path: Set<string>) => {
    if (seen.has(id) || path.has(id)) return;
    path.add(id);
    for (const b of after.get(id)!) visit(b, path);
    path.delete(id);
    seen.add(id);
    z.push(id);
  };
  for (const t of things) visit(t.id, new Set());
  const restOn = new Set(rs.filter((r) => ["on", "over", "in", "at"].includes(r.kind)).map((r) => r.b));
  const grounds = things.filter((t) => restOn.has(t.id) && !placedBy.has(t.id)).map((t) => t.id);
  return { places, z, grounds, checks, unsized, notes };
}

type Ext = { x0: number; y0: number; x1: number; y1: number };
function extentOf(places: Map<string, ScenePlace>, by: Map<string, SceneThing>, k: Map<string, number>, only?: (id: string) => boolean): Ext {
  const e: Ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [id, p] of places) {
    if (only && !only(id)) continue;
    const t = by.get(id)!;
    const kk = k.get(id) ?? p.k;
    e.x0 = Math.min(e.x0, p.x - (t.w * kk) / 2);
    e.x1 = Math.max(e.x1, p.x + (t.w * kk) / 2);
    e.y0 = Math.min(e.y0, p.y - t.h * kk);
    e.y1 = Math.max(e.y1, p.y);
  }
  return Number.isFinite(e.x0) ? e : { x0: 0, y0: 0, x1: 0, y1: 0 };
}

/** A thing's box in the scene, centimetres: x0, y0, x1, y1 (y down). */
export function sceneBox(layout: SceneLayout, t: SceneThing): [number, number, number, number] {
  const p = layout.places.get(t.id)!;
  return [p.x - (t.w * p.k) / 2, p.y - t.h * p.k, p.x + (t.w * p.k) / 2, p.y];
}

export type SceneFitParams = {
  /** A ground may run past the box's sides, so the rest keeps a readable size. */
  bleed: boolean;
  /** Around the things on a ground that runs past, this share of their extent shows on each side. */
  margin: number;
  /**
   * A thing the window closes in on: drawn at least `share` of the box (its width of the box's width or its height of
   * the box's height, whichever it reaches first), the rest of the scene around it and running past the box. 0 holds
   * the whole scene.
   */
  focus?: { id: string; share: number };
};

/**
 * The scene fitted to a box: the members the box shows (all, or `present`) at one scale, centered in the window the
 * fit uses. The window is the whole scene, or, when a ground runs past, the things on it with a margin, across its
 * whole height. Members' `dx` is the center offset from the window's center, `dy` their base from its top (as the
 * stage's other compositions). `w` is at least the box's width when something runs past it.
 */
export function fitScene(layout: SceneLayout, things: SceneThing[], box: { w: number; h: number }, p: SceneFitParams, present?: Set<string>) {
  const by = new Map(things.map((t) => [t.id, t]));
  const k = new Map([...layout.places].map(([id, pl]) => [id, pl.k]));
  const all = extentOf(layout.places, by, k);
  const grounds = new Set(layout.grounds);
  const rest = [...layout.places.keys()].filter((id) => !grounds.has(id));
  let win = all;
  const bleeds: string[] = [];
  if (p.bleed && grounds.size && rest.length) {
    const core = extentOf(layout.places, by, k, (id) => !grounds.has(id));
    const m = p.margin * Math.max(core.x1 - core.x0, core.y1 - core.y0);
    win = { x0: Math.max(all.x0, core.x0 - m), x1: Math.min(all.x1, core.x1 + m), y0: all.y0, y1: all.y1 };
    for (const g of grounds) {
      const [x0, , x1] = sceneBox(layout, by.get(g)!);
      if (x0 < win.x0 - 0.5 || x1 > win.x1 + 0.5) bleeds.push(g);
    }
  }
  let ww = Math.max(1e-6, win.x1 - win.x0);
  let wh = Math.max(1e-6, win.y1 - win.y0);
  let px = Math.min(box.w / ww, box.h / wh);
  // Closing in: the window shrinks around the focus until it is drawn at its share, and stays inside the scene where
  // the scene is larger than the window.
  let closer = false;
  const f = p.focus && p.focus.share > 0 && layout.places.has(p.focus.id) ? p.focus : undefined;
  if (f) {
    const [x0, y0, x1, y1] = sceneBox(layout, by.get(f.id)!);
    const need = f.share * Math.min(box.w / Math.max(1e-6, x1 - x0), box.h / Math.max(1e-6, y1 - y0));
    if (need > px * 1.001) {
      px = need;
      ww = box.w / px;
      wh = box.h / px;
      const along = (c: number, size: number, lo: number, hi: number) => (hi - lo <= size ? (lo + hi) / 2 - size / 2 : Math.min(Math.max(c - size / 2, lo), hi - size));
      const wx0 = along((x0 + x1) / 2, ww, all.x0, all.x1);
      const wy0 = along((y0 + y1) / 2, wh, all.y0, all.y1);
      win = { x0: wx0, y0: wy0, x1: wx0 + ww, y1: wy0 + wh };
      closer = true;
    }
  }
  const cx = (win.x0 + win.x1) / 2;
  const members: Member[] = [];
  let spills = false;
  for (const id of layout.z) {
    if (present && !present.has(id)) continue;
    const t = by.get(id)!;
    const pl = layout.places.get(id)!;
    const [x0, y0, x1, y1] = sceneBox(layout, t);
    if (x0 < win.x0 - 0.5 || x1 > win.x1 + 0.5 || y0 < win.y0 - 0.5 || y1 > win.y1 + 0.5) spills = true;
    members.push({ id, dx: (pl.x - cx) * px, dy: (pl.y - win.y0) * px, w: t.w * pl.k * px, h: t.h * pl.k * px, scale: pl.k * px });
  }
  // What runs past the window takes the box's whole width, so nothing else is packed where it is drawn.
  return { members, w: bleeds.length || closer ? Math.max(ww * px, box.w) : ww * px, h: wh * px, pxPerCm: px, bleeds, closer, spills };
}
