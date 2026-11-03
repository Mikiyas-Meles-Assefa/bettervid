// The stage and its compositions of objects. The stage is what persists (depicted objects, the user's material): it keeps
// its place while words take turns around it. Objects that act on each other are composed as one thing: an apparatus
// (a source over the vessel it pours or drips into, its outlet over the mouth) and a fall group (things that fall
// together, side by side at one height over a floor, at their true relative sizes).
//
// Objects come as shapes read off their depictions: a box in local units with its origin at its base (bottom center,
// y up as negative numbers), the anchors that matter here, and the real size when it is a fact. An object's `dy` is
// where its base sits.

/** What the stage needs to know of a depicted thing. */
export type ObjShape = {
  w: number;
  h: number;
  /** Where contents leave it (an outlet's tip, or its mouth when it pours), local units. */
  outlet?: [number, number];
  /** Where things go into it, local units. */
  mouth?: [number, number];
  /** Its real size in centimetres, when the depicter gave one. */
  realCm?: { w: number; h: number };
};

/** A thing placed inside a composition: center x offset from the composition's center, base y from its top. */
export type Member = { id: string; dx: number; dy: number; w: number; h: number; scale: number };

export type ApparatusParams = {
  sourceShare: number; // share of the composition's height the source takes
  gapShare: number; // share of the height between the source's outlet and the vessel's mouth
  sourceWidth: number; // the source is at most this share of the composition's width
  vesselWidth: number; // the vessel is at most this share of the width
  satelliteShare: number; // other objects needed now stand beside the vessel, at most this share of the height
  satelliteGap: number; // px between the vessel and a satellite
};

/** A source over the vessel it pours or drips into, in a box of w by h, with satellites beside the vessel. */
export function apparatus(src: { id: string; shape: ObjShape }, dst: { id: string; shape: ObjShape }, sats: { id: string; shape: ObjShape }[], box: { w: number; h: number }, p: ApparatusParams) {
  const ps = src.shape;
  const pd = dst.shape;
  const ss = Math.min((p.sourceShare * box.h) / ps.h, (p.sourceWidth * box.w) / ps.w);
  const sd = Math.min(((1 - p.sourceShare - p.gapShare) * box.h) / pd.h, (p.vesselWidth * box.w) / pd.w);
  const hs = ps.h * ss;
  const hd = pd.h * sd;
  const gap = p.gapShare * box.h;
  // The source's outlet sits over the vessel's mouth: offset the source so the outlet's x matches the mouth's x.
  const tipX = (ps.outlet?.[0] ?? 0) * ss;
  const mouthX = (pd.mouth?.[0] ?? 0) * sd;
  const members: Member[] = [
    { id: src.id, dx: mouthX - tipX, dy: hs, w: ps.w * ss, h: hs, scale: ss },
    { id: dst.id, dx: 0, dy: hs + gap + hd, w: pd.w * sd, h: hd, scale: sd },
  ];
  let side = 1;
  const vw = pd.w * sd;
  for (const s of sats) {
    const room = box.w / 2 - vw / 2 - p.satelliteGap;
    const sc = Math.max(0, Math.min((p.satelliteShare * box.h) / s.shape.h, room / s.shape.w));
    members.push({ id: s.id, dx: side * (vw / 2 + p.satelliteGap + (s.shape.w * sc) / 2), dy: hs + gap + hd, w: s.shape.w * sc, h: s.shape.h * sc, scale: sc });
    side = -side;
  }
  return { members, h: hs + gap + hd, w: Math.max(...members.map((m) => 2 * Math.abs(m.dx) + m.w)) };
}

export type FallGroupParams = {
  bigShare: number; // the largest thing's width as a share of the composition's width
  gapShare: number; // space between things, as a share of the width
  minShare: number; // a small thing is never drawn narrower than this share of the width
  roomShare: number; // at least this share of the height stays free for the fall
  floorGap: number; // px between the floor line and where things land
};

/**
 * Things that fall together, side by side at one height, at their true relative sizes when their sizes are known.
 * `fallen` are already down (they fell in an earlier moment). Returns the members, the fall distance in px, and the
 * scale of the drawing in px per metre when a real size is known (for physical time).
 */
export function fallGroup(mem: { id: string; shape: ObjShape }[], box: { w: number; h: number }, fallen: Set<string>, p: FallGroupParams) {
  const sizes = mem.map((m) => m.shape.realCm?.w);
  const big = Math.max(...sizes.map((s) => s ?? 0), 0);
  let D = mem.map((m, i) => (big && sizes[i] ? Math.max(p.minShare * box.w, (p.bigShare * box.w * sizes[i]!) / big) : p.bigShare * box.w * (m.shape.w / Math.max(...mem.map((x) => x.shape.w)))));
  const maxD = (1 - p.roomShare) * box.h;
  const k = Math.min(1, maxD / Math.max(...D.map((d, i) => (d * mem[i]!.shape.h) / mem[i]!.shape.w)), box.w / (D.reduce((a, b) => a + b, 0) + p.gapShare * box.w * (mem.length - 1)));
  D = D.map((d) => d * k);
  const gx = p.gapShare * box.w * k;
  const total = D.reduce((a, b) => a + b, 0) + gx * (mem.length - 1);
  const H = D.map((d, i) => (d * mem[i]!.shape.h) / mem[i]!.shape.w);
  const Hmax = Math.max(...H);
  const fallTo = box.h - p.floorGap;
  let x = -total / 2;
  const members: Member[] = mem.map((m, i) => {
    const dx = x + D[i]! / 2;
    x += D[i]! + gx;
    return { id: m.id, dx, dy: fallen.has(m.id) ? fallTo : Hmax, w: D[i]!, h: H[i]!, scale: D[i]! / m.shape.w };
  });
  const sized = mem.findIndex((m) => m.shape.realCm);
  const pxPerM = sized >= 0 ? D[sized]! / (mem[sized]!.shape.realCm!.w / 100) : undefined;
  return { members, fall: fallTo - Hmax, floorY: fallTo + p.floorGap / 2, floorW: Math.max(total, box.w * 0.9), h: box.h, w: Math.max(total, box.w * 0.9), pxPerM };
}

/** A single object scaled to fit a box. */
export const fitObject = (shape: ObjShape, box: { w: number; h: number }) => Math.min(box.w / shape.w, box.h / shape.h);

/**
 * Things compared, side by side on one baseline. When every one has a real size they share one scale (px per cm), so
 * the eye reads their true ratio; otherwise each fills an equal cell, and `toScale` is false so the caller says so.
 * `cap` bounds a member's own scale (type keeps its size beside words). The members' `dy` is where their base sits.
 */
export function sideBySide(mem: { id: string; shape: ObjShape; cap?: number }[], box: { w: number; h: number }, gap: number) {
  const n = mem.length;
  const toScale = n > 1 && mem.every((m) => m.shape.realCm && m.shape.realCm.w > 0);
  const free = Math.max(1, box.w - gap * (n - 1));
  let scales: number[];
  if (toScale) {
    // One px-per-cm for all: the widest row that fits the box, and no member taller than the box.
    const real = mem.map((m) => m.shape.realCm!.w);
    const k = Math.min(free / real.reduce((a, b) => a + b, 0), ...mem.map((m, i) => box.h / ((real[i]! * m.shape.h) / m.shape.w)));
    scales = mem.map((m, i) => (real[i]! * k) / m.shape.w);
  } else scales = mem.map((m) => Math.min(free / n / m.shape.w, box.h / m.shape.h));
  scales = scales.map((s, i) => Math.min(s, mem[i]!.cap ?? Infinity));
  const ws = mem.map((m, i) => m.shape.w * scales[i]!);
  const hs = mem.map((m, i) => m.shape.h * scales[i]!);
  const total = ws.reduce((a, b) => a + b, 0) + gap * (n - 1);
  const H = Math.max(...hs);
  let x = -total / 2;
  const members: Member[] = mem.map((m, i) => {
    const dx = x + ws[i]! / 2;
    x += ws[i]! + gap;
    return { id: m.id, dx, dy: H, w: ws[i]!, h: hs[i]!, scale: scales[i]! };
  });
  return { members, w: total, h: H, toScale };
}
