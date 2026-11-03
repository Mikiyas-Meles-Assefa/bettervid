// Requirements from the user's material, checked on a compiled scene with plain geometry: for each requirement about a
// picture or one of its parts, is it on screen, is it legible at the case's viewing, and for how long; for one that
// names colors, how much of what is painted uses them. A requirement geometry cannot see (a claim to say, a word never
// to use) is listed as not measured here. The numbers it judges against are settings (REQUIRE below, overridable per
// case in `requirementSettings`); read sizes come from the case's read settings (lib/settings.ts), so legibility
// follows the viewing. Small and replaceable: the instruments builder's `requirement` instrument does this richly.
import { evaluate } from "../../engine/core/evaluate.ts";
import type { Resolved, Scene } from "../../engine/core/types.ts";
import type { Box, PartCard, Requirement } from "../../engine/design/types.ts";
import { resolve } from "../../engine/design/material/link.ts";
import { inventory, type Rect } from "../../pipeline/lib/look.ts";
import { DEFAULTS, type Settings } from "./settings.ts";

export type RequireSettings = {
  /** Share of the required part that must be inside the frame and its picture's box for it to count as on screen. */
  seen: number;
  /** Opacity below which a picture is not on screen (it is fading in or out). */
  opacity: number;
  /** Legibility (0 at read.small, 1 at read.comfortable) at which the part counts as legible. */
  legible: number;
  /** Seconds a required part must be on screen and legible, when the case says how long is long enough. */
  seconds?: number;
  /** Share of the painted area in the named colors for a color requirement to count as met. */
  palette: number;
  /** How near (RGB distance, 0 to 441) a painted color must be to a named one to count as it. */
  near: number;
  /** Samples a second. */
  rate: number;
  /** A tight box around written words is about this share of their type size (cap height, plus descenders where
   * there are some, in common faces): a fact of type, used to compare a reader's boxes with read sizes, which are type sizes. */
  capHeight: number;
};
// Suggestions for a case that says nothing: half the part in view counts as shown, legibility halfway between "cannot
// be read at a glance" and "reads comfortably", most of the painting in the named colors, colors within a few steps of
// rounding of the named ones, 4 samples a second (the watch sheets' rate).
export const REQUIRE: RequireSettings = { seen: 0.5, opacity: 0.5, legible: 0.5, palette: 0.8, near: 24, rate: 4, capHeight: 0.8 };

export type RequirementCheck = {
  id: string;
  kind: string;
  applies?: string;
  measured: "picture" | "colors" | "no";
  met?: boolean;
  /** Seconds the part was on screen, the longest unbroken stretch, and seconds it was also legible. */
  seconds?: number;
  longest?: number;
  legibleSeconds?: number;
  firstAt?: number;
  /** The type size of the part's smallest words on screen at its best frame, as a share of the frame's width. */
  textShare?: number;
  /** Its width on screen at its best frame, as a share of the frame's width. */
  widthShare?: number;
  paletteShare?: number;
  notes: string[];
};

type Pic = { card: PartCard; src: string };

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
const cut = (a: Rect, b: Rect): Rect => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function imageProps(list: Resolved[], out = new Map<string, Resolved["props"]>()) {
  for (const r of list) {
    if (r.kind === "image") out.set(r.id, r.props);
    imageProps(r.children, out);
  }
  return out;
}

/** Where a part of a picture (a box in the picture's fractions) is drawn on the frame, for an image node at its box. */
export function partOnFrame(part: Box, nodeBox: Rect, props: Resolved["props"], size?: [number, number]): Rect {
  const [w, h] = [num(props.w, 1), num(props.h, 1)];
  const crop = Array.isArray(props.crop) && props.crop.length === 4 ? (props.crop as number[]) : undefined;
  const [W, H] = crop ? [num(props.srcW, w), num(props.srcH, h)] : (size ?? [w, h]);
  const win = crop ? [crop[0]! * W, crop[1]! * H, crop[2]! * W, crop[3]! * H] : [0, 0, W, H];
  const fit = props.fit;
  const [sx, sy] = fit === "fill" ? [w / win[2]!, h / win[3]!] : fit === "cover" ? Array(2).fill(Math.max(w / win[2]!, h / win[3]!)) : Array(2).fill(Math.min(w / win[2]!, h / win[3]!));
  const [ox, oy] = [(w - win[2]! * sx) / 2, (h - win[3]! * sy) / 2];
  // Local box coordinates (0..w, 0..h), then onto the frame by the node's box (its transform, without rotation).
  const [kx, ky] = [(nodeBox.x1 - nodeBox.x0) / w, (nodeBox.y1 - nodeBox.y0) / h];
  const at = (u: number, v: number) => [nodeBox.x0 + kx * (ox + (u * W - win[0]!) * sx), nodeBox.y0 + ky * (oy + (v * H - win[1]!) * sy)];
  const [x0, y0] = at(part[0], part[1]);
  const [x1, y1] = at(part[2], part[3]);
  return { x0: x0!, y0: y0!, x1: x1!, y1: y1! };
}

const hex = (c: string): [number, number, number] | undefined => {
  const m = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return undefined;
  const s = m[1]!.length === 3 ? m[1]!.replace(/./g, (x) => x + x) : m[1]!;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
};

export function checkRequirementsOnScene(reqs: Requirement[], cards: PartCard[], scene: Scene, pictures: Record<string, string>, read: Settings["read"] = DEFAULTS.read, over: Partial<RequireSettings> = {}): RequirementCheck[] {
  const set = { ...REQUIRE, ...over };
  const pics: Pic[] = cards.filter((c) => pictures[c.name]).map((c) => ({ card: c, src: pictures[c.name]! }));
  const srcOf = new Map(scene.nodes.filter((n) => n.kind === "image").map((n) => [n.id, n.props.src]));
  const step = Math.max(1, Math.round(scene.fps / set.rate));
  const frames = Array.from({ length: Math.ceil(scene.frames / step) }, (_, k) => k * step);
  const frame: Rect = { x0: 0, y0: 0, x1: scene.width, y1: scene.height };
  const legibility = (share: number) => clamp((share - read.small) / (read.comfortable - read.small));

  // One pass over the frames: every image on screen with its box and props.
  const shots = frames.map((f) => {
    const things = inventory(scene, f);
    const props = imageProps(evaluate(scene, f));
    return { f, things, images: things.filter((t) => t.kind === "image").map((t) => ({ t, props: props.get(t.id) ?? {}, src: srcOf.get(t.id) ?? props.get(t.id)?.src })) };
  });

  return reqs.map((r): RequirementCheck => {
    const base = { id: r.id, kind: r.kind, ...(r.applies ? { applies: r.applies } : {}) };
    const target = r.applies ? resolve(r.applies, cards) : undefined;
    const pic = target && pics.find((p) => p.card === target.card);
    if (pic) {
      const card = pic.card;
      const box: Box = target!.part ? (card.parts[target!.part]?.box ?? [0, 0, 1, 1]) : [0, 0, 1, 1];
      // The words that must read: text parts inside the required box (or the part itself).
      const inside = (b: Box) => b[0] >= box[0] - 1e-3 && b[1] >= box[1] - 1e-3 && b[2] <= box[2] + 1e-3 && b[3] <= box[3] + 1e-3;
      const texts = Object.values(card.parts).filter((p) => p.text && p.box && inside(p.box)).map((p) => p.box!);
      let on = 0, run = 0, longest = 0, legibleFrames = 0, first: number | undefined;
      let best = { score: -1, text: undefined as number | undefined, width: 0 };
      for (const s of shots) {
        let shown = false;
        let score = 0;
        for (const im of s.images) {
          if (im.src !== pic.src || im.t.opacity < set.opacity) continue;
          const drawn = partOnFrame(box, im.t.box, im.props, card.size);
          const visible = area(cut(cut(drawn, im.t.box), frame)) / Math.max(1e-9, area(drawn));
          if (visible < set.seen) continue;
          shown = true;
          const width = (drawn.x1 - drawn.x0) / scene.width;
          const textShare = texts.length ? Math.min(...texts.map((b) => { const d = partOnFrame(b, im.t.box, im.props, card.size); return (d.y1 - d.y0) / set.capHeight / scene.width; })) : undefined;
          const sc = textShare !== undefined ? legibility(textShare) : clamp((width - read.pictureLow) / (read.pictureFull - read.pictureLow));
          score = Math.max(score, sc);
          if (sc > best.score) best = { score: sc, text: textShare, width };
        }
        if (shown) {
          on++, run++;
          first ??= s.f / scene.fps;
          if (score >= set.legible) legibleFrames++;
        } else run = 0;
        longest = Math.max(longest, run);
      }
      const sec = (n: number) => +((n * step) / scene.fps).toFixed(2);
      const notes: string[] = [];
      if (!on) notes.push(`${r.applies} never on screen`);
      else if (!legibleFrames) notes.push(`${r.applies} on screen but never legible at this viewing (its smallest words at ${((best.text ?? 0) * 100).toFixed(1)}% of the frame's width; ${(read.small * 100).toFixed(1)}% cannot be read)`);
      if (set.seconds !== undefined && sec(legibleFrames) < set.seconds) notes.push(`legible for ${sec(legibleFrames)} s of the ${set.seconds} s asked`);
      const met = legibleFrames > 0 && (set.seconds === undefined || sec(legibleFrames) >= set.seconds);
      return { ...base, measured: "picture", met, seconds: sec(on), longest: sec(longest), legibleSeconds: sec(legibleFrames), ...(first !== undefined ? { firstAt: +first.toFixed(2) } : {}), ...(best.text !== undefined ? { textShare: +best.text.toFixed(4) } : {}), widthShare: +best.width.toFixed(3), notes };
    }
    // Named colors: how much of what is painted (words and filled shapes, by area) is near one of them.
    const palette = [...`${r.detail}`.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)].map((m) => hex(m[0])!).filter(Boolean);
    if (palette.length) {
      let inPal = 0, all = 0;
      const off = new Map<string, number>();
      const near = (c: [number, number, number]) => palette.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) <= set.near);
      const bg = hex(scene.background);
      for (const s of shots) {
        const painted = [...s.things.filter((t) => t.color && (t.kind === "text" || t.filled)).map((t) => ({ color: t.color!, a: area(cut(t.box, frame)) * t.opacity }))];
        for (const p of painted) {
          const c = hex(p.color);
          if (!c || !p.a) continue;
          all += p.a;
          if (near(c)) inPal += p.a;
          else off.set(p.color, (off.get(p.color) ?? 0) + p.a);
        }
      }
      const share = all ? inPal / all : 0;
      const worst = [...off.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, a]) => `${c} ${((a / all) * 100).toFixed(0)}%`);
      const bgNote = `background ${scene.background}${bg && near(bg) ? " is" : " is not"} one of the named colors`;
      if (!all) return { ...base, measured: "colors", notes: [bgNote, "nothing but pictures is painted: no words or filled shapes to check"] };
      return { ...base, measured: "colors", met: share >= set.palette, paletteShare: +share.toFixed(3), notes: [bgNote, ...(worst.length ? [`other colors painted: ${worst.join(", ")}`] : [])] };
    }
    return { ...base, measured: "no", notes: [target ? `${r.applies} is not a picture the scene can show` : "not something geometry can check"] };
  });
}
