// Spike S11: the style-owned drawing kit a simulation draws with. A simulation never picks its own look.
export type Style = { name: string; palette: Record<string, string>; fonts: { body: string } };

// How each style draws a line: wobble in pixels and a width multiplier.
const HAND: Record<string, { wobble: number; weight: number }> = {
  collage: { wobble: 2.5, weight: 1 },
  whiteboard: { wobble: 1.5, weight: 1.5 },
  flat: { wobble: 0, weight: 1.2 },
};

export const SAFE = { x: 90, y: 150, w: 900, h: 950 };

export function makeKit(ctx: CanvasRenderingContext2D, style: Style) {
  const hand = HAND[style.name] ?? HAND.flat!;
  const color = (c = "ink") => style.palette[c] ?? style.palette.ink!;
  // A stable wobble from the coordinates, so a mark does not shimmer from frame to frame.
  const off = (x: number, y: number) => Math.sin(x * 0.37 + y * 0.73) * hand.wobble;
  const path = (points: number[][], o: { color?: string; width?: number } = {}) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x! + off(x!, y!), y! + off(y!, x!)) : ctx.moveTo(x!, y!)));
    ctx.strokeStyle = color(o.color);
    ctx.lineWidth = (o.width ?? 6) * hand.weight;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };
  return {
    safe: SAFE,
    background() {
      ctx.fillStyle = style.palette.paper!;
      ctx.fillRect(0, 0, 1080, 1920);
    },
    dot(x: number, y: number, r: number, o: { color?: string } = {}) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color(o.color);
      ctx.fill();
    },
    ring(x: number, y: number, r: number, o: { color?: string; width?: number } = {}) {
      const n = Math.max(24, Math.round(r / 3));
      path(Array.from({ length: n + 1 }, (_, i) => [x + Math.cos((i / n) * Math.PI * 2) * r, y + Math.sin((i / n) * Math.PI * 2) * r]), o);
    },
    line(x1: number, y1: number, x2: number, y2: number, o: { color?: string; width?: number } = {}) {
      path([[x1, y1], [(x1 + x2) / 2, (y1 + y2) / 2], [x2, y2]], o);
    },
    path,
    label(text: string, x: number, y: number, o: { size?: number; color?: string; align?: CanvasTextAlign } = {}) {
      ctx.font = `bold ${o.size ?? 56}px ${style.fonts.body}, sans-serif`;
      ctx.textAlign = o.align ?? "center";
      ctx.fillStyle = color(o.color);
      ctx.fillText(text, x, y);
    },
  };
}

// The code arrives as a module; this turns it into an object. The same loader runs in Node (checks) and in the render.
export function loadSim(code: string) {
  return new Function(code.replace(/export\s+default/, "return"))() as {
    setup(a: { width: number; height: number; rng: () => number; kit: unknown }): any;
    step(s: any, a: { t: number; dt: number; rng: () => number; cues: Record<string, number> }): void;
    draw(s: any, kit: unknown, a: { t: number; cues: Record<string, number> }): void;
  };
}

// Seeded random numbers (mulberry32), so every run and every render worker gets the same simulation.
export function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
