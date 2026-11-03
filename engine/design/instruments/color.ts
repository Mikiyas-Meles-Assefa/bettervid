// Colors as the eye compares them: parsing, blending by opacity, WCAG relative luminance and contrast ratio. Physical
// facts (sRGB and the WCAG 2 formula), no taste. Shared by the instruments and the bench's reading measure.
import { parseGradient } from "../../core/evaluate.ts";

export type RGB = [number, number, number];

/** A hex color (#rgb, #rrggbb, #rrggbbaa; alpha ignored). */
export function hexRgb(c: unknown): RGB | undefined {
  if (typeof c !== "string") return undefined;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c.trim());
  if (!m) return undefined;
  const h = m[1]!.length === 3 ? m[1]!.split("").map((x) => x + x).join("") : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** A hex color, or the mean of a gradient's stops. */
export function rgbOf(c: unknown): RGB | undefined {
  const hex = hexRgb(c);
  if (hex || typeof c !== "string") return hex;
  try {
    const g = parseGradient(c);
    const stops = (g?.stops ?? []).map((s) => rgbOf(s.color)).filter((x): x is RGB => !!x);
    if (stops.length) return [0, 1, 2].map((i) => stops.reduce((s, x) => s + x[i]!, 0) / stops.length) as RGB;
  } catch {
    /* not a gradient */
  }
  return undefined;
}

/** The alpha of an #rrggbbaa color, 1 otherwise. */
export function alphaOf(c: unknown): number {
  if (typeof c !== "string") return 1;
  const m = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(c.trim());
  return m ? parseInt(m[1]!, 16) / 255 : c === "none" || c === "transparent" ? 0 : 1;
}

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const lum = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
/** WCAG contrast ratio, 1 to 21. */
export const ratio = (a: RGB, b: RGB) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
/** `fg` painted at opacity `o` over `bg`. */
export const blend = (fg: RGB, bg: RGB, o: number): RGB => [0, 1, 2].map((i) => fg[i]! * o + bg[i]! * (1 - o)) as RGB;
