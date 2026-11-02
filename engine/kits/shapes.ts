// Point lists for common shapes, in the flat [x, y, x, y] form paths and morphs use.
export function circle(cx: number, cy: number, r: number, n = 48): number[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [cx + Math.cos(t) * r, cy + Math.sin(t) * r];
  }).flat();
}
export function box(x: number, y: number, w: number, h: number): number[] {
  return [x, y, x + w, y, x + w, y + h, x, y + h, x, y];
}
