// The working-out behind SceneView: pure functions from properties to what SVG and CSS need, with no drawing here.
import { formatGradient, parseGradient, type Gradient } from "../core/evaluate.ts";
import type { Key, Props, Scene, SceneNode, Theme, Track, Value } from "../core/types.ts";

export const n = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
export const list = (v: unknown) => (Array.isArray(v) ? (v as number[]) : undefined);
export const fade = (color: string, amount: number) => (amount >= 1 ? color : `color-mix(in srgb, ${color} ${Math.max(0, amount) * 100}%, transparent)`);

// Ids can hold any characters, so they are spelled safely before going into a url(#...).
export const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`);

export const BLENDS = new Set(["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity", "plus-lighter"]);
export function blendOf(a: Props): string | undefined {
  if (a.blend === undefined || a.blend === "normal") return undefined;
  if (!BLENDS.has(String(a.blend))) throw new Error(`unknown blend ${a.blend}`);
  return String(a.blend);
}

// Paths share point lists across frames unless they are morphing, so their outlines are worked out once.
const LINES = new WeakMap<number[], Map<number, string>>();
export function line(points: number[], smooth: boolean, closed: boolean): string {
  const code = (smooth ? 1 : 0) + (closed ? 2 : 0);
  const seen = LINES.get(points) ?? LINES.set(points, new Map()).get(points)!;
  const hit = seen.get(code);
  if (hit !== undefined) return hit;
  const made = outline(points, smooth, closed);
  seen.set(code, made);
  return made;
}
function outline(points: number[], smooth: boolean, closed: boolean): string {
  const p: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 2) p.push([points[i]!, points[i + 1]!]);
  if (!p.length) return "";
  if (!smooth || p.length < 3) return `${p.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")}${closed ? " Z" : ""}`;
  let d = `M${p[0]![0]} ${p[0]![1]}`;
  for (let i = 1; i < p.length - 1; i++) d += ` Q${p[i]![0]} ${p[i]![1]} ${(p[i]![0] + p[i + 1]![0]) / 2} ${(p[i]![1] + p[i + 1]![1]) / 2}`;
  return `${d} L${p.at(-1)![0]} ${p.at(-1)![1]}${closed ? " Z" : ""}`;
}

export type Box = { x: number; y: number; w: number; h: number };
export function bounds(points: number[]): Box {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const [x, y] = [points[i]!, points[i + 1]!];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < x0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Where a gradient sits. With a box it uses real coordinates, because a browser's own bounding box is empty for a
// straight horizontal or vertical line, and such a line would then draw nothing. Without a box, use the part's bounds.
export function gradientGeometry(g: Gradient, box?: Box): Record<string, number | string> {
  const b = box ?? { x: 0, y: 0, w: 1, h: 1 };
  const gradientUnits = box ? "userSpaceOnUse" : "objectBoundingBox";
  if (g.type === "radial") {
    const [cx, cy, r] = g.args as [number, number, number];
    return { gradientUnits, cx: b.x + b.w * cx, cy: b.y + b.h * cy, r: r * Math.max(b.w, b.h) };
  }
  const t = (g.args[0]! * Math.PI) / 180;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  const half = (Math.abs(b.w * c) + Math.abs(b.h * s)) / 2;
  const [mx, my] = [b.x + b.w / 2, b.y + b.h / 2];
  return { gradientUnits, x1: mx - c * half, y1: my - s * half, x2: mx + c * half, y2: my + s * half };
}

// The CSS filter chain for a node, or nothing when every effect is at rest. Order: color, then blur, then what spills.
export function filterOf(a: Props, theme: Theme, tintRef?: string): string | undefined {
  const f: string[] = [];
  const [brightness, saturation, contrast, hue] = [n(a.brightness, 1), n(a.saturation, 1), n(a.contrast, 1), n(a.hue)];
  if (brightness !== 1) f.push(`brightness(${Math.max(0, brightness)})`);
  if (saturation !== 1) f.push(`saturate(${Math.max(0, saturation)})`);
  if (contrast !== 1) f.push(`contrast(${Math.max(0, contrast)})`);
  if (hue !== 0) f.push(`hue-rotate(${hue}deg)`);
  if (tintRef) f.push(`url(#${tintRef})`); // last among colors, so draining a color first leaves the tint strong
  if (n(a.blur) > 0) f.push(`blur(${n(a.blur)}px)`);
  const [sx, sy, sb] = [n(a.shadowX), n(a.shadowY), n(a.shadowBlur)];
  const shadowAmount = n(a.shadowOpacity, 1);
  if ((sx || sy || sb > 0) && shadowAmount > 0) f.push(`drop-shadow(${sx}px ${sy}px ${Math.max(0, sb)}px ${fade(String(a.shadowColor ?? theme.colors.ink), shadowAmount)})`);
  const glow = n(a.glow);
  const glowAmount = n(a.glowOpacity, 1);
  if (glow > 0 && glowAmount > 0) {
    const color = fade(String(a.glowColor ?? theme.colors.accent), glowAmount);
    f.push(`drop-shadow(0 0 ${glow * 0.35}px ${color})`, `drop-shadow(0 0 ${glow}px ${color})`); // a tight core and a wide halo
  }
  return f.length ? f.join(" ") : undefined;
}

// Pushes a node toward one color, keeping its light and dark. Returns the feColorMatrix values, or nothing at rest.
export function tintMatrix(color: string | undefined, amount: number): string | undefined {
  if (!color || amount <= 0) return undefined;
  if (!/^#[0-9a-f]{6}/i.test(color)) throw new Error(`tint needs a full hex or theme color, not ${color}`);
  const t = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const k = Math.min(1, amount);
  const luma = [0.2126, 0.7152, 0.0722];
  const row = (i: number) => [0, 1, 2].map((c) => (c === i ? 1 - k : 0) + k * t[i]! * luma[c]!).join(" ");
  return `${row(0)} 0 0 ${row(1)} 0 0 ${row(2)} 0 0 0 0 0 1 0`;
}

// Affine transforms as [a, b, c, d, e, f], for moving a matte from one part's coordinates into another's.
export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export const times = (m: Matrix, o: Matrix): Matrix => [
  m[0] * o[0] + m[2] * o[1], m[1] * o[0] + m[3] * o[1],
  m[0] * o[2] + m[2] * o[3], m[1] * o[2] + m[3] * o[3],
  m[0] * o[4] + m[2] * o[5] + m[4], m[1] * o[4] + m[3] * o[5] + m[5],
];
export function matrixOf(a: Props): Matrix {
  const r = (n(a.rotate) * Math.PI) / 180;
  const skew = Math.tan((n(a.skew) * Math.PI) / 180);
  const rotated: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), n(a.x), n(a.y)];
  return times(times(rotated, [1, 0, skew, 1, 0, 0]), [n(a.scaleX, 1), 0, 0, n(a.scaleY, 1), 0, 0]);
}
export function inverse(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
export const transformOf = (a: Props) => `translate(${n(a.x)} ${n(a.y)}) rotate(${n(a.rotate)}) skewX(${n(a.skew)}) scale(${n(a.scaleX, 1)} ${n(a.scaleY, 1)})`;

// Theme names in every paint property, including inside gradients. compile only does this for a few plain colors, so
// doing it here means any color property can use names and blend between them, and a scene can change style at once.
const PAINTS = new Set(["fill", "stroke", "color", "pulseColor", "shadowColor", "glowColor", "tint", "colorA", "colorB", "colorC"]);
function named(v: Value, theme: Theme): Value {
  if (typeof v !== "string") return v;
  if (theme.colors[v]) return theme.colors[v]!;
  const g = parseGradient(v);
  if (!g) return v;
  return formatGradient({
    ...g,
    stops: g.stops.map((s) => {
      const color = theme.colors[s.color] ?? s.color;
      if (!color.startsWith("#")) throw new Error(`unknown color ${s.color} in ${v}`);
      return { ...s, color };
    }),
  });
}
const paintProps = (p: Props, theme: Theme): Props => {
  let out = p;
  for (const k in p) {
    if (!PAINTS.has(k)) continue;
    const v = named(p[k]!, theme);
    if (v === p[k]) continue;
    if (out === p) out = { ...p };
    out[k] = v;
  }
  return out;
};
const paintKeys = (keys: Key[], theme: Theme) => keys.map((k) => ({ ...k, value: named(k.value, theme) }));

const THEMED = new WeakMap<Scene, WeakMap<Theme, Scene>>();
export function themed(scene: Scene, theme: Theme): Scene {
  const seen = THEMED.get(scene) ?? THEMED.set(scene, new WeakMap()).get(scene)!;
  const hit = seen.get(theme);
  if (hit) return hit;
  const nodes: SceneNode[] = scene.nodes.map((node) => {
    const props = paintProps(node.props, theme);
    return props === node.props ? node : { ...node, props };
  });
  const tracks: Track[] = scene.tracks.map((t) => (PAINTS.has(t.prop) ? { ...t, keys: paintKeys(t.keys, theme) } : t));
  const made = { ...scene, nodes, tracks, background: String(named(scene.background, theme)) };
  seen.set(theme, made);
  return made;
}
