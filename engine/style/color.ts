// Small color helpers. Colors reach the renderer as hex, so anything else is left as it is.
const rgb = (c: string): [number, number, number] | undefined => {
  const s = /^#[0-9a-f]{3}$/i.test(c) ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
  if (!/^#[0-9a-f]{6}$/i.test(s)) return undefined;
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
};

export function blend(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  if (!x || !y) return t < 0.5 ? a : b;
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

// How far apart two colors are, from 0 (same) to 1 (clearly different). A shape filled with the surface's own color
// is just an opaque gap, so it gets no material. Being continuous, this also carries a color change with no jump.
export function apart(a: string, b: string): number {
  const [x, y] = [rgb(a), rgb(b)];
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
