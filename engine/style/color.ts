// Small color helpers. Colors reach the renderer as hex (#rgb, #rgba, #rrggbb or #rrggbbaa), so anything else is left
// as it is. A color with alpha keeps it: a see-through color blends as see-through, and how far it stands from the
// surface is judged by what shows, the color laid over that surface.
type RGBA = [number, number, number, number];
const rgba = (c: string): RGBA | undefined => {
  const s = /^#[0-9a-f]{3,4}$/i.test(c) ? `#${[...c.slice(1)].map((x) => x + x).join("")}` : c;
  if (!/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return undefined;
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), s.length > 7 ? parseInt(s.slice(7, 9), 16) / 255 : 1];
};
const rgb = (c: string): [number, number, number] | undefined => rgba(c)?.slice(0, 3) as [number, number, number] | undefined;
const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");

export function blend(a: string, b: string, t: number): string {
  const [x, y] = [rgba(a), rgba(b)];
  if (!x || !y) return t < 0.5 ? a : b;
  const al = x[3] + (y[3] - x[3]) * t;
  return `#${[0, 1, 2].map((i) => hex2(x[i]! + (y[i]! - x[i]!) * t)).join("")}${al < 1 ? hex2(al * 255) : ""}`;
}

/** A color laid over an opaque one: what the eye sees. Opaque colors come back as they are. */
export function over(c: string, under: string): string {
  const [x, y] = [rgba(c), rgba(under)];
  if (!x || !y || x[3] >= 1) return c;
  return `#${[0, 1, 2].map((i) => hex2(x[i]! * x[3] + y[i]! * (1 - x[3]))).join("")}`;
}

// How far apart two colors are, from 0 (same) to 1 (clearly different). A shape filled with the surface's own color
// is just an opaque gap, so it gets no material. Being continuous, this also carries a color change with no jump.
export function apart(a: string, b: string): number {
  const [x, y] = [rgb(over(a, b)), rgb(b)];
  if (!x || !y) return 1;
  return Math.min(1, Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) / 90);
}

const luminance = (c: string): number => {
  const v = (rgb(c) ?? [0, 0, 0]).map((n) => (n / 255 <= 0.03928 ? n / 255 / 12.92 : ((n / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
};

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
