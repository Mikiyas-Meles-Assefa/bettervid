// Turns the director's shots (pictures, timing, where the subject is, marks) into scene language, so documentaries run
// on the engine too. The scene stage hands each section's part to Spark as a starting point it can add to.
//
// Everything here is written with general words of the language (a picture that fills the frame, the camera, marks at
// places inside a picture, entrances, cuts), so what a documentary does, any scene can do, and Spark can edit it.
//
// Pictures are framed by what is in them, never by their middle. Annotate says where the subject is (the thing the
// picture is of) and where the narration's target is. A picture whose subject fits the tall frame fills it, cropped
// around the subject. One whose subject does not fit (a wide scene in a tall frame) is either travelled across, when it
// is a scene to scan, or shown whole over a blurred, darkened copy of itself. Marks are then checked against what the
// crop really shows at the moment they appear, and moved inside it or left out.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Asset, Box, Mark, Project, Shot, ShotType } from "../../schemas/project.ts";
import { safeArea } from "../../engine/language/layout.ts";
import { themeFrom } from "../../engine/render/theme.ts";
import type { Framing } from "../stages/annotate.ts";
import { dir } from "./project.ts";

const FPS = 30;
const W = 1080;
const H = 1920;
const SAFE = safeArea(W, H);
// Scans hold up to about this many times the covering size before they look soft.
const SHARP = 2.6;
// The look of a picture's own copy behind it: out of focus and stepped toward the page, so the picture in front reads
// as the subject. Each style says how (design.elements.backdrop, engine/style/design.ts).
export function backdropOf(style: string): string {
  const theme = themeFrom(style);
  const b = theme.design.elements.backdrop;
  const tint = b.tintAmount > 0 ? ` tint=${b.tint} tintAmount=${b.tintAmount}` : "";
  return `blur=${b.blur} brightness=${b.brightness} saturation=${b.saturation} contrast=${b.contrast}${tint} scaleX=1.5 scaleY=1.5`;
}
// Words over a picture name their role, so the style gives them a designed backing. The language accepts `role=` once
// the layout workstream merges it; until then the engine's own card under words on pictures does this job.
const ROLES_READY = true;
const caption = ROLES_READY ? " role=caption" : "";

type Moment = { word: number; offset: number };
type Event = { at: Moment; lines: string[]; cut?: boolean; move?: number };
// A rectangle inside a picture, as fractions of it.
export type Rect = { x0: number; y0: number; x1: number; y1: number };
type View = { panX: number; panY: number; zoom: number };
// A picture as the layout places it: its size on the canvas, centered on the frame.
type Laid = { bw: number; bh: number };

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const quote = (s: string) => `"${s.replace(/"/g, "”").replace(/\s+/g, " ").trim()}"`;
const moment = (m: Moment) => `@${m.word}${m.offset > 0 ? `+${m.offset}` : m.offset < 0 ? `${m.offset}` : ""}`;
const later = (a: Moment, b: Moment) => a.word - b.word || a.offset - b.offset;
const lim = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rect = (b: Box): Rect => ({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
const wOf = (r: Rect) => r.x1 - r.x0;
const hOf = (r: Rect) => r.y1 - r.y0;
const grow = (r: Rect, k: number): Rect => {
  const [dx, dy] = [(wOf(r) * k) / 2, (hOf(r) * k) / 2];
  return { x0: r.x0 - dx, y0: r.y0 - dy, x1: r.x1 + dx, y1: r.y1 + dy };
};
const inside = (r: Rect, b: Rect, slack = 0) => r.x0 >= b.x0 - slack && r.y0 >= b.y0 - slack && r.x1 <= b.x1 + slack && r.y1 <= b.y1 + slack;
const meet = (a: Rect, b: Rect): Rect | undefined => {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : undefined;
};
const at4 = (r: Rect) => [r.x0, r.y0, r.x1, r.y1].map(r3).join(",");
// A camera region as the language takes it. Places run from -0.5 to 1.5 of a thing, so a region wider than that (a view
// a little wider than the picture, to show it whole) is written as a smaller region with the same center and a zoom
// that undoes the difference: the camera lands in the same place.
function place(r: Rect): string {
  const [cx, cy] = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
  const half = Math.max(wOf(r) / 2, hOf(r) / 2);
  const room = Math.min(cx + 0.45, 1.45 - cx, cy + 0.45, 1.45 - cy);
  if (half <= room) return `at=${at4(r)}`;
  const k = room / half;
  const small = { x0: cx - (wOf(r) / 2) * k, y0: cy - (hOf(r) / 2) * k, x1: cx + (wOf(r) / 2) * k, y1: cy + (hOf(r) / 2) * k };
  return `at=${at4(small)} zoom=${r3(k)}`;
}

// The size of a PNG, read from its header, for cut-outs whose size the asset does not record.
function pngSize(path: string): [number, number] | undefined {
  try {
    const b = readFileSync(path);
    return b.toString("ascii", 12, 16) === "IHDR" ? [b.readUInt32BE(16), b.readUInt32BE(20)] : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The camera, as engine/language/build.ts works it out, so a framing can be checked before it is written.

// A picture's place on the canvas: covering the frame (fill) or all of it as large as it goes (fit).
export const laid = (iw: number, ih: number, mode: "fill" | "fit"): Laid => {
  const k = mode === "fill" ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
  return { bw: iw * k, bh: ih * k };
};

// Where the camera lands for `camera pic at=region zoom=zoomBy`, given the picture filling the frame behind (`filler`).
export function cameraFor(pic: Laid, filler: Laid, r: Rect, zoomBy = 1): View {
  const px = { x: W / 2 + ((r.x0 + r.x1) / 2 - 0.5) * pic.bw, y: H / 2 + ((r.y0 + r.y1) / 2 - 0.5) * pic.bh, w: wOf(r) * pic.bw, h: hOf(r) * pic.bh };
  const cover = Math.max(W / filler.bw, H / filler.bh);
  const fit = Math.min(SAFE.w / Math.max(1, px.w), SAFE.h / Math.max(1, px.h));
  const zoom = Math.max(fit, cover) * zoomBy;
  const z = Math.max(zoom, cover);
  const [hw, hh] = [W / (2 * z), H / (2 * z)];
  const panX = lim(px.x, W / 2 - filler.bw / 2 + hw, W / 2 + filler.bw / 2 - hw);
  const panY = lim(px.y - (SAFE.y - H / 2) / z, H / 2 - filler.bh / 2 + hh, H / 2 + filler.bh / 2 - hh);
  return { panX, panY, zoom: z };
}

// The part of a picture the screen shows from a view: the whole frame, or the clear area, which is the frame's width
// (a picture may run to its edges) less a sliver, above the band kept for captions.
export function seen(pic: Laid, v: View, area: "frame" | "clear" = "frame"): Rect {
  const s = area === "clear" ? { x: W / 2, y: SAFE.y, w: W * 0.94, h: SAFE.h } : { x: W / 2, y: H / 2, w: W, h: H };
  // A point on the screen (sx, sy) shows the canvas point pan + (s - center) / zoom.
  const cx = (sx: number) => v.panX + (sx - W / 2) / v.zoom;
  const cy = (sy: number) => v.panY + (sy - H / 2) / v.zoom;
  const fx = (x: number) => (x - (W / 2 - pic.bw / 2)) / pic.bw;
  const fy = (y: number) => (y - (H / 2 - pic.bh / 2)) / pic.bh;
  return { x0: fx(cx(s.x - s.w / 2)), y0: fy(cy(s.y - s.h / 2)), x1: fx(cx(s.x + s.w / 2)), y1: fy(cy(s.y + s.h / 2)) };
}

// The region to ask for so the camera lands at `zoom` times the covering size, centered on (cx, cy) of the picture.
function regionAt(pic: Laid, filler: Laid, zoom: number, cx: number, cy: number): Rect {
  const cover = Math.max(W / filler.bw, H / filler.bh);
  const z = Math.max(zoom, cover);
  const [w, h] = [SAFE.w / z / pic.bw, SAFE.h / z / pic.bh];
  return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
}

// Moves a region so the view stays on the picture along each axis where, at that zoom, the picture is larger than the
// frame. The engine only keeps the view on what fills the frame behind, so a picture in front needs this itself.
function within(pic: Laid, filler: Laid, r: Rect): Rect {
  const v = seen(pic, cameraFor(pic, filler, r));
  const z = cameraFor(pic, filler, r).zoom;
  const shift = (lo: number, hi: number, covers: boolean) => (!covers ? 0 : lo < 0 ? -lo : hi > 1 ? 1 - hi : 0);
  const dx = shift(v.x0, v.x1, pic.bw * z >= W);
  const dy = shift(v.y0, v.y1, pic.bh * z >= H);
  return { x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy };
}

// ---------------------------------------------------------------------------------------------------------------------
// Framing: how one picture is shown, decided by where its subject is, how long it is on screen, and what is said.

type Move = { at: number; frames: number; region: Rect; drift: number }; // `at` and `frames` in frames from the shot's cut
export type Framed = {
  kind: "fill" | "pan" | "whole" | "plain";
  pic: Laid; // the picture marks belong to
  filler: Laid; // what covers the frame behind it
  moves: Move[];
};

// The view at a frame of the shot, from its moves: each lands after its frames, then drifts closer.
export function viewAt(f: Framed, frame: number): View {
  let v: View = cameraFor(f.pic, f.filler, f.moves[0]!.region);
  for (let i = 0; i < f.moves.length; i++) {
    const m = f.moves[i]!;
    if (frame < m.at) break;
    const to = cameraFor(f.pic, f.filler, m.region);
    const t = m.frames <= 1 ? 1 : Math.min(1, (frame - m.at) / m.frames);
    const e = t * t * (3 - 2 * t);
    const next = f.moves[i + 1]?.at ?? Infinity;
    const landed = m.at + m.frames;
    const drift = frame > landed ? 1 + (m.drift * (Math.min(frame, next) - landed)) / FPS : 1;
    v = { panX: v.panX + (to.panX - v.panX) * e, panY: v.panY + (to.panY - v.panY) * e, zoom: (v.zoom + (to.zoom - v.zoom) * e) * drift };
  }
  return v;
}

export type FrameInput = { iw: number; ih: number; subject?: Box; target?: Box; zoom?: boolean; pan?: boolean; frames: number; again?: boolean };

export function frame(i: FrameInput): Framed {
  const { iw, ih, frames } = i;
  const fill = laid(iw, ih, "fill");
  const seconds = frames / FPS;
  const S = i.subject ? rect(i.subject) : i.target ? rect(i.target) : undefined;
  const T = i.target ? rect(i.target) : S;
  const centre = (r: Rect): [number, number] => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
  // The largest zoom (times covering) at which a rectangle still sits inside the frame's width and the caption-free height.
  const room = (pic: Laid, r: Rect, filler: Laid) => {
    const cover = Math.max(W / filler.bw, H / filler.bh);
    return Math.min((W * 0.94) / Math.max(1, wOf(r) * pic.bw), SAFE.h / Math.max(1, hOf(r) * pic.bh)) / cover;
  };
  // A slow push that keeps `r` in view until the shot ends.
  const driftFor = (pic: Laid, r: Rect | undefined, z: number, filler: Laid, want: number) => {
    if (!r) return want;
    const spare = room(pic, r, filler) / z - 1;
    return r3(lim(Math.min(want, spare / Math.max(0.5, seconds)), 0, want));
  };
  // A push in on the target, landing before the shot is half over, when annotate says the camera should move in.
  const pushTo = (pic: Laid, filler: Laid, from: number): Move | undefined => {
    if (!i.zoom || !T || frames < FPS * 1.6) return undefined;
    const region = grow(T, 1.4);
    const cover = Math.max(W / filler.bw, H / filler.bh);
    const want = Math.min(SAFE.w / Math.max(1, wOf(region) * pic.bw), SAFE.h / Math.max(1, hOf(region) * pic.bh));
    // Sharpness is about the source's pixels: a picture shown whole starts smaller than one covering the frame.
    const z = Math.min(Math.max(want, from * 1.15), (SHARP * filler.bw) / pic.bw / cover);
    if (z <= from * 1.05) return undefined;
    const land = Math.max(6, Math.round(Math.min(frames * 0.5, 2.2 * FPS)));
    return { at: 1, frames: land, region: within(pic, filler, regionAt(pic, filler, z * cover, ...centre(T))), drift: driftFor(pic, T, z, filler, 0.012) };
  };

  if (!S) {
    // Nothing known about the picture: its middle, with a slow push.
    const [from, to] = i.again ? [1.3, 1.45] : [1.04, 1.16];
    return { kind: "plain", pic: fill, filler: fill, moves: [{ at: 0, frames: 1, region: regionAt(fill, fill, from, 0.5, 0.5), drift: r3((to / from - 1) / Math.max(0.5, seconds)) }] };
  }

  const fits = room(fill, grow(S, 0.06), fill);
  if (fits >= 1) {
    // The subject fits the tall frame: fill it, cropped around the subject, a little closer when it is shown again.
    const z = Math.min(fits, i.again ? 1.3 : 1.04);
    const first: Move = { at: 0, frames: 1, region: regionAt(fill, fill, z, ...centre(S)), drift: driftFor(fill, S, z, fill, i.again ? 0.03 : 0.015) };
    const push = pushTo(fill, fill, z);
    return { kind: "fill", pic: fill, filler: fill, moves: push ? [{ ...first, drift: 0 }, push] : [first] };
  }

  // The subject is wider or taller than the frame can hold. A scene meant to be scanned is travelled across, ending on
  // the target; a single thing is shown whole, over its own blurred copy.
  const span = Math.max((wOf(S) * fill.bw) / W, (hOf(S) * fill.bh) / SAFE.h);
  if (i.pan && seconds >= 3 && span <= 3.2) {
    const wide = (wOf(S) * fill.bw) / W >= (hOf(S) * fill.bh) / SAFE.h;
    const [sx, sy] = centre(S);
    const [tx, ty] = centre(T ?? S);
    const ends: [number, number][] = wide
      ? [[S.x0 + W / fill.bw / 2, sy], [S.x1 - W / fill.bw / 2, sy]]
      : [[sx, S.y0 + SAFE.h / fill.bh / 2], [sx, S.y1 - SAFE.h / fill.bh / 2]];
    // End where the narration's target is.
    const d = (p: [number, number]) => Math.hypot(p[0] - tx, p[1] - ty);
    if (d(ends[0]!) < d(ends[1]!)) ends.reverse();
    return {
      kind: "pan",
      pic: fill,
      filler: fill,
      moves: [
        { at: 0, frames: 1, region: regionAt(fill, fill, 1.04, ...ends[0]!), drift: 0 },
        { at: 1, frames: Math.max(FPS, frames - 2), region: regionAt(fill, fill, 1.04, ...ends[1]!), drift: 0 },
      ],
    };
  }
  const fit = laid(iw, ih, "fit");
  // The whole subject as large as the frame's width and the area clear of captions allow, so the picture is the screen's
  // subject rather than a strip on a backdrop.
  const z0 = Math.max(1, room(fit, grow(S, 0.04), fill));
  const region = regionAt(fit, fill, z0, ...centre(S));
  if (fit.bw * z0 >= W * 0.98 && fit.bh * z0 >= H * 0.98) {
    // Shown that large it covers the frame anyway (a tall subject in a tall picture): fill, around the subject.
    const at: Move = { at: 0, frames: 1, region: regionAt(fill, fill, 1, ...centre(S)), drift: i.again ? 0.02 : 0.01 };
    const push = pushTo(fill, fill, 1);
    return { kind: "fill", pic: fill, filler: fill, moves: push ? [{ ...at, drift: 0 }, push] : [at] };
  }
  const first: Move = { at: 0, frames: 1, region, drift: driftFor(fit, S, z0, fill, 0.01) };
  const push = pushTo(fit, fill, z0);
  return { kind: "whole", pic: fit, filler: fill, moves: push ? [{ ...first, drift: 0 }, push] : [first] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Marks, checked against what the crop shows when they appear: moved inside it, or left out when they would point at
// something the viewer cannot see.

export function fitMark(m: Mark, view: Rect): Mark | undefined {
  const pad = Math.min(wOf(view), hOf(view)) * 0.03;
  const v = { x0: view.x0 + pad, y0: view.y0 + pad, x1: view.x1 - pad, y1: view.y1 - pad };
  const inV = ([x, y]: [number, number]) => x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1;
  const pts = m.points;
  if (m.tool === "ring" || m.tool === "box") {
    if (pts.length < 2) return undefined;
    const r = { x0: Math.min(pts[0]![0], pts[1]![0]), y0: Math.min(pts[0]![1], pts[1]![1]), x1: Math.max(pts[0]![0], pts[1]![0]), y1: Math.max(pts[0]![1], pts[1]![1]) };
    const hit = meet(r, v);
    const a = wOf(r) * hOf(r);
    // Most of it cut off, or around most of the screen: it no longer points at one thing.
    if (!hit || wOf(hit) * hOf(hit) < 0.6 * a || a > 0.55 * wOf(v) * hOf(v)) return undefined;
    return { ...m, points: [[hit.x0, hit.y0], [hit.x1, hit.y1]] };
  }
  if (m.tool === "label") {
    if (!pts.length) return undefined;
    return { ...m, points: [[lim(pts[0]![0], v.x0, v.x1), lim(pts[0]![1], v.y0, v.y1)]] };
  }
  if (m.tool === "dots") {
    const kept = pts.filter(inV);
    return kept.length ? { ...m, points: kept } : undefined;
  }
  if (m.tool === "arrow") {
    if (pts.length < 2) return undefined;
    const tip = pts.at(-1)!;
    if (!inV(tip)) return undefined;
    // A tail off screen is pulled toward the tip until it shows.
    let tail = pts[0]!;
    for (let k = 0; k < 20 && !inV(tail); k++) tail = [tail[0] + (tip[0] - tail[0]) * 0.15, tail[1] + (tip[1] - tail[1]) * 0.15];
    if (!inV(tail) || Math.hypot(tail[0] - tip[0], tail[1] - tip[1]) < 0.08 * Math.min(wOf(v), hOf(v))) return undefined;
    return { ...m, points: [tail, tip] };
  }
  // Lines, underlines and paths: all of it in view, or nearly.
  const share = pts.filter(inV).length / Math.max(1, pts.length);
  return share >= (m.tool === "path" ? 0.8 : 1) ? m : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------

// `source` uses global spoken-word numbers; `assets` maps asset names used in the source to files in the project folder.
export function shotsToScene(p: Project): { source: string; assets: Record<string, string>; notes: string[] } {
  const words = p.narration?.words ?? [];
  const shots = [...(p.shots ?? [])].sort((a, b) => a.start - b.start);
  if (!words.length || !shots.length) throw new Error(`shotsToScene needs narration and shots (project ${p.id})`);
  const BACKDROP = backdropOf(p.input.style);
  const byShot = new Map((p.assets ?? []).map((a) => [a.shotId, a as Asset & Framing]));
  const assets: Record<string, string> = {};
  const notes: string[] = [];
  const nameOf = (path: string) => {
    const name = basename(path).replace(/\.[a-z0-9]+$/i, "").replace(/[^A-Za-z0-9]/g, "") || "picture";
    let unique = name;
    for (let i = 2; assets[unique] !== undefined && assets[unique] !== path; i++) unique = `${name}${i}`;
    assets[unique] = path;
    return unique;
  };
  // The spoken word a shot starts on: shots are snapped to word times, so this is the word at (or just after) its start.
  const wordAt = (seconds: number) => {
    const i = words.findIndex((w) => w.start >= seconds - 0.02);
    return i < 0 ? words.length - 1 : i;
  };
  const sameFile = (a?: string, b?: string) => {
    if (!a || !b) return false;
    if (a === b) return true;
    try {
      return readFileSync(join(dir(p), a)).equals(readFileSync(join(dir(p), b)));
    } catch {
      return false;
    }
  };

  const events: Event[] = [];
  // The picture on screen, so a shot that shows it again keeps it and moves closer instead of cutting to a copy.
  let last: { path: string; id: string; kind: Framed["kind"]; marks: string[] } | undefined;
  let first = true;
  shots.forEach((shot, index) => {
    const a = byShot.get(shot.id);
    // A shot with no honest image is dropped, and the shot before holds through it (at the very start, the next one).
    if (a?.missing) return;
    const type: ShotType = a?.override?.type ?? shot.type;
    const start: Moment = { word: first ? 0 : wordAt(shot.start), offset: 0 };
    const next = shots.slice(index + 1).find((s) => !byShot.get(s.id)?.missing);
    const endWord = next ? wordAt(next.start) : words.length;
    const seconds = Math.max(0.5, (next ? next.start : (words.at(-1)?.end ?? shot.end) + 0.6) - words[start.word]!.start);
    const frames = Math.round(seconds * FPS);
    const made = shotLines(shot, a, type, index, start, frames, endWord);
    if (!made) return;
    first = false;
    events.push(...made);
  });
  const ordered = events.map((e, i) => ({ e, i })).sort((x, y) => later(x.e.at, y.e.at) || x.i - y.i).map((x) => x.e);
  // Two events at one moment become one state.
  const merged: Event[] = [];
  for (const e of ordered) {
    const prev = merged.at(-1);
    if (prev && !later(prev.at, e.at) && !e.cut) prev.lines.push(...e.lines);
    else merged.push({ ...e, lines: [...e.lines] });
  }
  const source = merged.map((e) => [`${moment(e.at)}${e.cut ? " cut" : " keep"}${e.move ? ` move=${e.move}` : ""}`, ...e.lines].join("\n")).join("\n");
  return { source: `${source}\n`, assets, notes };

  function shotLines(shot: Shot, a: (Asset & Framing) | undefined, type: ShotType, index: number, start: Moment, frames: number, endWord: number): Event[] | undefined {
    const id = `s${index + 1}`;
    const out: Event[] = [];
    const cut = (lines: string[]) => out.push({ at: start, cut: true, lines });
    const keep = (at: Moment, lines: string[], move?: number) => out.push({ at, lines, ...(move ? { move } : {}) });

    if (type === "kinetic_title" || (!a?.path && (a?.override?.text ?? shot.text))) {
      const text = (a?.override?.text ?? shot.text ?? "").toUpperCase().split(/\s+/).map((w) => w.replace(/[\s=:"{}[\]|]/g, "")).filter(Boolean);
      if (!text.length) return undefined;
      // Words slam down one after another, on a field of ink; the last one in the highlight color.
      const per = Math.max(4, Math.floor(Math.min(frames * 0.6, FPS * 1.2) / text.length));
      const lines: number[][] = [[]];
      text.forEach((w, i) => {
        const line = lines.at(-1)!;
        if (line.length && [...line.map((j) => text[j]!), w].join(" ").length > 11) lines.push([i]);
        else line.push(i);
      });
      const atomsUpTo = (n: number) =>
        lines
          .map((line) => line.filter((i) => i <= n))
          .filter((line) => line.length)
          .map((line, li) => `huge ${id}t${li + 1} color=paper enter=slam: ${line.map((i) => `${id}w${i + 1}=${text[i]!}`).join(" ")}`);
      text.forEach((_, i) => {
        const body = [...(i === 0 ? [`box ${id}bg frame=fill fill=ink`] : []), ...atomsUpTo(i), ...(i === text.length - 1 && text.length > 1 ? [`set ${id}w${i + 1} color=highlight`] : [])];
        if (i === 0) cut(body);
        else keep({ word: start.word, offset: i * per }, body);
      });
      last = undefined;
      return out;
    }

    if (type === "receipt" && shot.receipt) {
      const r = shot.receipt;
      // A source card: who said it and when, the quoted line, and where it lives. The line gets a highlighter sweep.
      const words = r.quote.split(/\s+/);
      let q = "";
      for (const w of words) if ((q + " " + w).length <= 280) q = q ? `${q} ${w}` : w;
      if (q.length < r.quote.trim().length) q += "…";
      const where = r.url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
      const head = [r.outlet, r.date].filter(Boolean).join(" · ").toUpperCase();
      cut([
        `box ${id}bg frame=fill fill=ink opacity=0.14`,
        `stack ${id} back=paper gap=34 align=left enter=rise`,
        ...(head ? [`  text ${id}o ${quote(head)} size=small align=left opacity=0.7`] : []),
        `  text ${id}q ${quote(`“${q}”`)} size=${q.length > 160 ? "small" : "normal"} w=${q.length > 160 ? 720 : 760} align=left`,
        ...(where ? [`  text ${id}u ${quote(where)} size=small align=left opacity=0.6`] : []),
      ]);
      keep({ word: start.word, offset: 12 }, [`mark highlight ${id}q`], 24);
      last = undefined;
      return out;
    }

    if (!a?.path) return undefined;
    const [iw, ih] = a.size ?? [W, H];
    const picture = nameOf(a.path);

    if (type === "cutout_on_paper" && a.cutout) {
      // The cut-out subject springs out of its own picture, which sits behind it out of focus and darker.
      const cutName = nameOf(a.cutout);
      const [cw, ch] = pngSize(join(dir(p), a.cutout)) ?? [iw, ih];
      const side = index % 2 ? "slide" : "slide-left";
      cut([`image ${id}bk asset=${picture} w=${iw} h=${ih} frame=fill`, `set ${id}bk ${BACKDROP}`, `image ${id}c asset=${cutName} w=${cw} h=${ch} enter=${side} rotate=${index % 2 ? 2.5 : -2.5}`, `camera zoom=1 drift=${r3(0.02 / Math.max(1, frames / FPS))}`]);
      last = undefined;
      return out;
    }

    // A picture, framed by its subject. The same picture as the shot before stays the same thing, and the camera moves.
    const again = !!last && sameFile(last.path, a.path);
    const f = frame({ iw, ih, subject: a.subject, target: a.focus, zoom: a.zoom, pan: a.pan, frames, again });
    // Shown again, it keeps its framing kind: a picture that was shown whole stays whole.
    const reuse = again && (last!.kind === "whole") === (f.kind === "whole");
    const pid = reuse ? last!.id : id;
    const shown =
      f.kind === "whole"
        ? [`image ${pid}bk asset=${picture} w=${iw} h=${ih} frame=fill`, `set ${pid}bk ${BACKDROP}`, `image ${pid} asset=${picture} w=${iw} h=${ih} frame=fit`, `set ${pid} shadowY=18 shadowBlur=60 shadowOpacity=0.45`]
        : [`image ${pid} asset=${picture} w=${iw} h=${ih} frame=fill`];
    const camera = (m: Move) => `camera ${pid} ${place(m.region)}${m.at ?` frames=${m.frames} ease=${f.kind === "pan" ? "linear" : "smooth"}` : ""}${m.drift ? ` drift=${m.drift}` : ""}`;

    // Marks, each checked against the crop at the moment it appears.
    const marks: { line: string[]; at: Moment; id: string }[] = [];
    (a.marks ?? []).filter((m) => m.word < endWord).forEach((m, k) => {
      let at: Moment = { word: Math.max(start.word, m.word), offset: 0 };
      const frameIn = Math.round((words[at.word]!.start - words[start.word]!.start) * FPS);
      let fitted = fitMark(m, seen(f.pic, viewAt(f, frameIn), "clear"));
      // Spoken while the camera is still moving and out of view for now: it arrives as the camera settles.
      const moving = f.moves.find((x) => x.at <= frameIn && frameIn < x.at + x.frames);
      if (!fitted && moving && moving.at + moving.frames < frames - FPS * 0.6) {
        const land = moving.at + moving.frames;
        fitted = fitMark(m, seen(f.pic, viewAt(f, land), "clear"));
        if (fitted) at = { word: start.word, offset: land };
      }
      if (!fitted) {
        notes.push(`${shot.id}: a ${m.tool} at ${m.points.map((q) => q.map(r3).join(",")).join(" ")} is outside the crop, so it is left out`);
        return;
      }
      const mid = `${id}m${k + 1}`;
      marks.push({ line: markLine(fitted, pid, mid), at, id: mid });
    });
    const onCut = marks.filter((m) => !later(m.at, start)).flatMap((m) => m.line);
    if (reuse) {
      // The same picture again: it stays, the earlier marks leave, and the camera moves to the new framing.
      keep(start, [...(last!.marks.length ? [`drop ${last!.marks.join(" ")}`] : []), `camera ${pid} ${place(f.moves[0]!.region)} frames=${Math.min(18, Math.max(6, Math.round(frames / 3)))} ease=smooth${f.moves[0]!.drift ? ` drift=${f.moves[0]!.drift}` : ""}`, ...onCut]);
    } else cut([...shown, camera(f.moves[0]!), ...onCut]);
    for (const m of f.moves.slice(1)) keep({ word: start.word, offset: m.at }, [camera(m)]);
    for (const m of marks) if (later(m.at, start) > 0) keep(m.at, m.line);
    last = { path: a.path, id: pid, kind: f.kind, marks: marks.map((m) => m.id) };
    return out;
  }

  function markLine(m: Mark, pid: string, mid: string): string[] {
    const pts = m.points.flatMap(([x, y]) => [r3(lim(x, -0.4, 1.4)), r3(lim(y, -0.4, 1.4))]);
    const color = m.color ? ` color=${m.color}` : "";
    if (m.tool === "label") return m.text ? [`tag ${pid} ${quote(m.text)} at=${pts.slice(0, 2).join(",")} id=${mid}${caption}`] : [];
    if ((m.tool === "ring" || m.tool === "box") && pts.length < 4) return [];
    if (m.tool !== "dots" && pts.length < 4) return [];
    return [`mark ${m.tool} ${pid} at=${(m.tool === "ring" || m.tool === "box" ? pts.slice(0, 4) : pts).join(",")}${color} id=${mid}`];
  }
}
