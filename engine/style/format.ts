// The style format. A file in styles/ adds one `render` block, and a person or a model can write it in a few lines:
// pick a named pen, fill, surface and feel, then override any number. Everything left out comes from the preset.
// `render` is separate from the older fields (palette, fonts, art, surface, motion, grain, vignette), which the
// pipeline still reads and which mean something else there.
import type { Ease, FillKind, FillStyle, LineStyle, MotionFeel, MotionStyle, Pen, StyleSpec, SurfaceKind, SurfaceStyle, TypeStyle } from "../core/types.ts";
import { contrast } from "./color.ts";

export const PENS: Record<Pen, Omit<LineStyle, "pen">> = {
  vector: { weight: 1, wobble: 0, pressure: 0, nib: 0, passes: 1, grain: 0, glow: 0, overshoot: 0 },
  marker: { weight: 1.1, wobble: 2.2, pressure: 0.1, nib: 0.45, passes: 1, grain: 0, glow: 0, overshoot: 0 },
  ink: { weight: 0.95, wobble: 1.8, pressure: 0.8, nib: 0, passes: 1, grain: 0, glow: 0, overshoot: 0 },
  chalk: { weight: 1.15, wobble: 2.4, pressure: 0.2, nib: 0, passes: 2, grain: 0.7, glow: 0, overshoot: 0 },
  drafting: { weight: 0.5, wobble: 0, pressure: 0, nib: 0, passes: 1, grain: 0, glow: 0, overshoot: 22 },
  neon: { weight: 0.8, wobble: 0, pressure: 0, nib: 0, passes: 1, grain: 0, glow: 1, overshoot: 0 },
};

export const FILLS: Record<FillKind, Omit<FillStyle, "kind">> = {
  solid: { base: 1, spacing: 0, angle: 0, cross: 0, offset: 0, shadow: 0, glow: 0, outline: 1 },
  hatch: { base: 0.72, spacing: 12, angle: 45, cross: 0, offset: 0, shadow: 0, glow: 0, outline: 1 },
  scribble: { base: 0.72, spacing: 13, angle: 62, cross: 0, offset: 0, shadow: 0, glow: 0, outline: 1 },
  wash: { base: 0.8, spacing: 0, angle: 0, cross: 0, offset: 5, shadow: 0, glow: 0, outline: 1 },
};

export const SURFACES: Record<SurfaceKind, Omit<SurfaceStyle, "kind">> = {
  plain: { grain: 0, smudge: 0, light: 0, grid: 0, major: 0 },
  paper: { grain: 0.35, smudge: 0.15, light: 0.1, grid: 0, major: 0 },
  slate: { grain: 0.5, smudge: 0.6, light: 0.25, grid: 0, major: 0 },
  board: { grain: 0, smudge: 0.12, light: 0.05, grid: 0, major: 0 },
  blueprint: { grain: 0.2, smudge: 0.2, light: 0.2, grid: 54, major: 5 },
  night: { grain: 0.1, smudge: 0, light: 0.5, grid: 0, major: 0 },
};

export const FEELS: Record<MotionFeel, Omit<MotionStyle, "feel">> = {
  springy: { frames: 16, ease: "spring", enter: "pop" },
  calm: { frames: 26, ease: "smooth", enter: "draw" },
  snappy: { frames: 9, ease: "out", enter: "fade" },
  steady: { frames: 16, ease: "smooth", enter: "draw" },
};

const EASES: Ease[] = ["linear", "smooth", "in", "out", "spring", "bounce", "step"];
type Range = readonly [number, number];
const R01: Range = [0, 1];
const LINE: Record<string, Range> = { weight: [0.1, 4], wobble: [0, 12], pressure: R01, nib: R01, passes: [1, 3], grain: R01, glow: R01, overshoot: [0, 80] };
const FILL: Record<string, Range> = { base: [0.6, 1], spacing: [0, 60], angle: [-180, 180], cross: R01, offset: [0, 24], shadow: [0, 40], glow: R01, outline: R01 };
const SURFACE: Record<string, Range> = { grain: R01, smudge: R01, light: R01, grid: [0, 400], major: [0, 20] };
const TYPE: Record<string, Range> = { bold: [100, 900], tracking: [-0.1, 0.4], jitter: R01, grain: [0, 0.5], glow: R01 };
const MOTION: Record<string, Range> = { frames: [1, 90] };

type Raw = Record<string, unknown>;
const oneOf = (what: string, value: unknown, list: readonly string[]): string => {
  if (!list.includes(value as string)) throw new Error(`style ${what}: "${String(value)}" is not one of ${list.join(", ")}`);
  return value as string;
};

// Layers overrides onto a preset and refuses anything it does not understand, so a typo never quietly does nothing.
function merge<T extends Raw>(what: string, preset: T, raw: Raw, ranges: Record<string, Range>, strings: Record<string, (v: unknown) => unknown>): T {
  const out: Raw = { ...preset };
  for (const [key, value] of Object.entries(raw)) {
    if (key in strings) {
      out[key] = strings[key]!(value);
      continue;
    }
    const range = ranges[key];
    if (!range) throw new Error(`style ${what}.${key}: unknown setting. Known: ${[...Object.keys(ranges), ...Object.keys(strings)].join(", ")}`);
    if (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]) throw new Error(`style ${what}.${key}: ${String(value)} is outside ${range[0]} to ${range[1]}`);
    out[key] = value;
  }
  return out as T;
}

const HEX = /^#[0-9a-f]{6}$|^#[0-9a-f]{3}$/i;
export type StyleFileLike = { name?: string; palette?: Record<string, string>; fonts?: { title?: string; body?: string }; hand?: { wobble?: number; weight?: number }; render?: Raw };

// A style that cannot be read is a broken style, so this fails rather than letting it reach a video.
export function checkPalette(p: Record<string, string> | undefined): void {
  for (const name of ["paper", "ink", "accent", "highlight"]) if (!p?.[name]) throw new Error(`style palette needs ${name}`);
  for (const [name, c] of Object.entries(p!)) if (!HEX.test(c)) throw new Error(`style palette.${name}: ${c} must be a hex color, or it cannot blend`);
  const need = (a: string, b: string, min: number) => {
    const c = contrast(p![a]!, p![b]!);
    if (c < min) throw new Error(`style palette: ${a} on ${b} has contrast ${c.toFixed(1)}, needs ${min}`);
  };
  need("ink", "paper", 4.5); // everyday lines and words
  need("accent", "paper", 2); // a colored mark must stand out from the surface, and words sit on colored shapes
}

export function resolveStyle(file: StyleFileLike): StyleSpec {
  checkPalette(file.palette);
  const r = file.render ?? {};
  for (const key of Object.keys(r)) oneOf("render key", key, ["line", "fill", "surface", "type", "motion"]);
  const part = (name: string) => (r[name] ?? {}) as Raw;

  const pen = oneOf("line.pen", part("line").pen ?? "vector", Object.keys(PENS)) as Pen;
  const older = r.line ? {} : { wobble: file.hand?.wobble ?? 0, weight: file.hand?.weight ?? 1 }; // files with only `hand`
  const line = merge<LineStyle>("line", { pen, ...PENS[pen], ...older }, part("line"), LINE, { pen: (v) => v });

  const fillKind = oneOf("fill.kind", part("fill").kind ?? "solid", Object.keys(FILLS)) as FillKind;
  const fill = merge<FillStyle>("fill", { kind: fillKind, ...FILLS[fillKind] }, part("fill"), FILL, { kind: (v) => v });

  const surfaceKind = oneOf("surface.kind", part("surface").kind ?? "plain", Object.keys(SURFACES)) as SurfaceKind;
  const surface = merge<SurfaceStyle>("surface", { kind: surfaceKind, ...SURFACES[surfaceKind] }, part("surface"), SURFACE, { kind: (v) => v });

  const title = file.fonts?.title ?? "Georgia";
  const body = file.fonts?.body ?? title;
  const plain: TypeStyle = { title: `"${title}", "Liberation Sans", sans-serif`, body: `"${body}", "Liberation Sans", sans-serif`, mono: `Menlo, "Courier New", "Liberation Mono", monospace`, bold: 700, tracking: 0, case: "asis", jitter: 0, grain: 0, glow: 0 };
  const font = (v: unknown) => {
    if (typeof v !== "string" || !v.trim()) throw new Error(`style type: a font must be a name, got ${String(v)}`);
    return v;
  };
  const type = merge<TypeStyle>("type", plain, part("type"), TYPE, { title: font, body: font, mono: font, case: (v) => oneOf("type.case", v, ["asis", "upper"]) });

  const feel = oneOf("motion.feel", part("motion").feel ?? "steady", Object.keys(FEELS)) as MotionFeel;
  const motion = merge<MotionStyle>("motion", { feel, ...FEELS[feel] }, part("motion"), MOTION, { feel: (v) => v, ease: (v) => oneOf("motion.ease", v, EASES), enter: (v) => oneOf("motion.enter", v, ["fade", "draw", "pop"]) });

  return { line, fill, surface, type, motion };
}

// Given to a model that turns a person's description into a style file.
export const STYLE_GUIDE = `A style is a JSON file. Add a "render" object, and write only what you want to change from the presets.
Colors go in "palette" as hex: paper (the background), ink (lines and words), accent (what matters), highlight.
ink on paper needs contrast of at least 4.5, and accent on paper at least 2.

render.line:    pen = ${Object.keys(PENS).join(" | ")}. Optional: weight, wobble, pressure, nib, passes, grain, glow, overshoot.
render.fill:    kind = ${Object.keys(FILLS).join(" | ")}. Optional: base, spacing, angle, cross, offset, shadow, glow, outline.
render.surface: kind = ${Object.keys(SURFACES).join(" | ")}. Optional: grain, smudge, light, grid, major.
render.type:    title, body and mono are CSS font stacks ending in a safe font. Optional: bold, tracking, case, jitter, grain, glow.
render.motion:  feel = ${Object.keys(FEELS).join(" | ")}. Optional: frames, ease, enter.

Texture goes on the surface and on colored shapes. Images are never touched, and nothing is ever laid over the whole frame.

Example, "pencil on grey paper, unhurried":
{ "line": { "pen": "ink", "pressure": 0.3, "grain": 0.4, "passes": 2 }, "fill": { "kind": "hatch" }, "surface": { "kind": "paper" }, "motion": { "feel": "calm" } }`;
