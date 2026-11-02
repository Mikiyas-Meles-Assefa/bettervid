// What a style does to each primitive, as plain data: a stack of layers to draw. Nothing here knows about React or
// the screen, and every result depends only on its inputs, so a frame looks the same however it is reached.
//
// There is deliberately no paintImage. Images are subjects: no pen, grain or tint ever touches them. Texture lives on
// the surface below everything, and on colored shapes the style itself drew.
import type { Props, StyleSpec, Theme } from "../core/types.ts";
import { apart, blend, contrast } from "./color.ts";
import { extend, hatchPath, outline, pathOf, type Pt, scribblePath, shift, slice, toPolyline, wobble, type Width } from "./geometry.ts";
import { hash, noise, random } from "./noise.ts";

export type Layer = { d: string; fill?: string; stroke?: string; width?: number; opacity: number; dry?: boolean };

const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const GLOW = [[9, 0.018], [7.6, 0.022], [6.4, 0.028], [5.3, 0.035], [4.3, 0.045], [3.4, 0.06], [2.6, 0.085], [2, 0.12], [1.5, 0.16]] as const;

function widthOf(w: number, style: StyleSpec, seed: number): Width {
  const { pressure, nib, grain } = style.line;
  return (s, total, angle) => {
    let v = w * (1 + pressure * 0.5 * noise(seed + 3, s / 80));
    if (pressure) {
      const end = Math.min(52, total * 0.35);
      const t = Math.min(1, Math.min(s, total - s) / (end || 1));
      v *= 1 - pressure * 0.8 * (1 - t * t);
    }
    if (nib) v *= 1 - nib * 0.6 * Math.abs(Math.cos(angle - Math.PI / 4));
    if (grain) v *= 1 + grain * 0.35 * noise(seed + 5, s / 6);
    return v;
  };
}

function glowLayers(d: string, color: string, width: number, amount: number): Layer[] {
  return GLOW.map(([times, opacity]) => ({ d, stroke: color, width: width * times, opacity: opacity * amount }));
}

function paintLine(base: Pt[], hand: Pt[], closed: boolean, color: string, width: number, style: StyleSpec, seed: number, drawn: number, strength: number): Layer[] {
  const { line } = style;
  const w = width * line.weight;
  const whole = closed && drawn >= 1;
  const layers: Layer[] = [];
  for (let pass = 0; pass < line.passes; pass++) {
    const hand2 = pass ? wobble(base, closed, line.wobble * 1.5 + 0.8, seed + pass * 97) : hand;
    const cut = drawn < 1 ? slice(hand2, 0, drawn) : hand2;
    if (cut.length < 2) continue;
    const ww = pass ? w * 0.72 : w;
    const opacity = (pass ? 0.6 : 1) * strength;
    if (line.glow) layers.push(...glowLayers(pathOf(cut, whole), color, ww, line.glow * strength));
    const varied = line.pressure || line.nib || line.grain;
    layers.push(varied
      ? { d: outline(cut, whole, widthOf(ww, style, seed + pass)), fill: color, opacity, dry: line.grain > 0 }
      : { d: pathOf(cut, whole), stroke: color, width: ww, opacity });
    if (line.glow) layers.push({ d: pathOf(cut, whole), stroke: blend(color, "#ffffff", 0.75), width: ww * 0.42, opacity: strength });
  }
  if (line.overshoot && !closed) {
    const cut = drawn < 1 ? slice(base, 0, drawn) : base;
    if (cut.length > 1) layers.unshift({ d: pathOf(extend(cut, line.overshoot)), stroke: color, width: Math.max(1, w * 0.3), opacity: 0.45 * strength });
  }
  return layers;
}

function paintFill(hand: Pt[], color: string, material: number, drawn: number, style: StyleSpec, surface: string, seed: number): Layer[] {
  const { fill } = style;
  const layers: Layer[] = [];
  const shape = pathOf(hand, true);
  if (fill.shadow) layers.push({ d: pathOf(shift(hand, fill.shadow, fill.shadow), true), fill: blend(surface, "#000000", 0.5), opacity: 0.55 * material * drawn });
  if (fill.glow) layers.push(...glowLayers(shape, color, 14, fill.glow * material * drawn));
  const turn = random(seed, 40) * Math.PI * 2;
  const held = fill.offset ? shift(hand, Math.cos(turn) * fill.offset * material, Math.sin(turn) * fill.offset * material) : hand;
  const body = pathOf(held, true);
  layers.push({ d: body, fill: blend(color, surface, 1 - fill.base), opacity: drawn });
  const strength = material * drawn;
  if (strength <= 0.01) return layers; // the surface's own color: an opaque gap with no material
  if (fill.kind === "hatch") {
    const width = fill.spacing * 0.34;
    layers.push({ d: hatchPath(held, fill.spacing, fill.angle, seed), stroke: color, width, opacity: strength });
    if (fill.cross) layers.push({ d: hatchPath(held, fill.spacing * 1.2, fill.angle + 90, seed + 1), stroke: color, width: width * 0.8, opacity: strength });
  } else if (fill.kind === "scribble") {
    layers.push({ d: scribblePath(held, fill.spacing, fill.angle, seed), stroke: color, width: fill.spacing * 0.68, opacity: strength, dry: true });
  } else if (fill.kind === "wash") {
    layers.push({ d: body, stroke: blend(color, "#000000", 0.25), width: 5, opacity: 0.4 * strength }); // pigment pools at the edge
  }
  return layers;
}

export function paintPath(a: Props, id: string, style: StyleSpec, surface: string, pulseDefault: string): Layer[] {
  const { line, fill } = style;
  const seed = hash(id);
  const closed = !!num(a.closed);
  const drawn = num(a.drawn, 1);
  const base = toPolyline(a.points as number[], !!num(a.smooth), closed, line.grain ? 4 : 7);
  const hand = wobble(base, closed, line.wobble, seed);
  const layers: Layer[] = [];
  const color = typeof a.fill === "string" && a.fill !== "none" ? a.fill : undefined;
  const material = color ? apart(color, surface) : 0;
  if (color) layers.push(...paintFill(hand, color, material, drawn, style, surface, seed));
  const width = num(a.strokeWidth, 6);
  if (typeof a.stroke === "string" && a.stroke !== "none") layers.push(...paintLine(base, hand, closed, a.stroke, width, style, seed, drawn, 1 - (1 - fill.outline) * material));
  const pulse = num(a.pulse, -1);
  if (pulse >= 0 && pulse <= 1) {
    const plain: StyleSpec = { ...style, line: { ...line, pressure: 0, nib: 0, grain: 0, passes: 1, overshoot: 0 } };
    const dash = slice(hand, pulse * 0.86, pulse * 0.86 + 0.14);
    layers.push(...paintLine(dash, dash, false, String(a.pulseColor ?? pulseDefault), width * 2.2, plain, seed, 1, 1));
  }
  return layers;
}

export type TextPaint = { text: string; family: string; size: number; weight: number; spacing: number; color: string; rotate?: string; dy?: string; dry: boolean; glow: { width: number; opacity: number }[] };

export function paintText(a: Props, id: string, theme: Theme, style: StyleSpec, surface: string): TextPaint {
  const { type } = style;
  const size = num(a.size, 60);
  const font = String(a.font ?? "body");
  const family = font === "title" ? theme.fonts.title : font === "mono" ? (theme.fonts.mono ?? type.mono) : font === "body" ? theme.fonts.body : font;
  const raw = num(a.weight, 400);
  const text = type.case === "upper" ? String(a.text ?? "").toUpperCase() : String(a.text ?? "");
  const color = String(a.color ?? theme.colors.ink);
  const out: TextPaint = { text, family, size, weight: raw >= 600 ? type.bold : raw, spacing: type.tracking * size, color, dry: type.grain > 0, glow: [] };
  if (type.jitter) {
    const seed = hash(id);
    const chars = [...text];
    const lift = chars.map((_, i) => (random(seed, i) - 0.5) * size * 0.07 * type.jitter);
    out.rotate = chars.map((_, i) => ((random(seed + 1, i) - 0.5) * 9 * type.jitter).toFixed(1)).join(" ");
    out.dy = lift.map((v, i) => (v - (lift[i - 1] ?? 0)).toFixed(1)).join(" ");
  }
  if (type.glow && apart(color, surface) > 0.5) out.glow = GLOW.slice(3).map(([times, opacity]) => ({ width: size * 0.07 * times, opacity: opacity * type.glow }));
  return out;
}

export type SurfacePaint = {
  color: string;
  light?: { color: string; opacity: number };
  grain?: { color: string; opacity: number };
  smudge?: { color: string; opacity: number };
  grid?: { color: string; spacing: number; major: number; opacity: number };
};

// Everything the backdrop needs. It is painted once, below all objects, and never over them.
export function paintSurface(style: StyleSpec, color: string, theme: Theme): SurfacePaint {
  const { surface } = style;
  const ink = theme.colors.ink ?? "#000000";
  const dark = contrast(color, "#ffffff") > contrast(color, "#000000");
  const out: SurfacePaint = { color };
  if (surface.light) out.light = { color: surface.kind === "night" ? blend(color, theme.colors.accent ?? ink, 0.35) : blend(color, "#ffffff", dark ? 0.3 : 0.8), opacity: surface.light };
  if (surface.grain) out.grain = { color: dark ? ink : blend(ink, color, 0.3), opacity: surface.grain * (dark ? 0.3 : 0.16) };
  if (surface.smudge) out.smudge = { color: dark ? ink : blend(ink, color, 0.55), opacity: surface.smudge * (dark ? 0.06 : 0.05) }; // barely there: a stronger one reads as an oily film
  if (surface.grid) out.grid = { color: ink, spacing: surface.grid, major: surface.major, opacity: 0.16 };
  return out;
}
