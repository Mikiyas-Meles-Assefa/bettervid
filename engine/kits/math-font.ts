// Reads glyph outlines from KaTeX's font files, and flattens outlines and SVG paths into the point lists paths use.
// Outlines make each symbol an ordinary path: no font has to load at render time, and any symbol can morph or recolor.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Font = { view: DataView; tables: Map<string, number>; unitsPerEm: number; ascent: number; descent: number; longLoca: boolean; hMetrics: number; lookup: (code: number) => number };
export type Pt = [number, number];

const FONTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/katex/dist/fonts");
const open = new Map<string, Font>();

function load(name: string): Font {
  const known = open.get(name);
  if (known) return known;
  const b = readFileSync(join(FONTS, `${name}.ttf`));
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16;
    tables.set(String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!), view.getUint32(at + 8));
  }
  const need = (t: string) => {
    const at = tables.get(t);
    if (at === undefined) throw new Error(`font ${name} has no ${t} table`);
    return at;
  };
  const head = need("head");
  const hhea = need("hhea");
  const cmap = need("cmap");
  let sub = -1;
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const at = cmap + view.getUint32(cmap + 8 + i * 8);
    if (view.getUint16(at) === 4) sub = at;
  }
  if (sub < 0) throw new Error(`font ${name} has no format 4 character map`);
  const n = view.getUint16(sub + 6) / 2;
  const [ends, starts, deltas, offsets] = [sub + 14, sub + 16 + n * 2, sub + 16 + n * 4, sub + 16 + n * 6];
  const lookup = (code: number) => {
    for (let i = 0; i < n; i++) {
      if (code > view.getUint16(ends + i * 2)) continue;
      const start = view.getUint16(starts + i * 2);
      if (code < start) return 0;
      const delta = view.getUint16(deltas + i * 2);
      const offset = view.getUint16(offsets + i * 2);
      if (!offset) return (code + delta) & 0xffff;
      const g = view.getUint16(offsets + i * 2 + offset + (code - start) * 2);
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
  const font: Font = { view, tables, unitsPerEm: view.getUint16(head + 18), ascent: view.getInt16(hhea + 4), descent: -view.getInt16(hhea + 6), longLoca: view.getInt16(head + 50) === 1, hMetrics: view.getUint16(hhea + 34), lookup };
  open.set(name, font);
  return font;
}

function contours(f: Font, glyph: number): Pt[][] {
  const { view, tables } = f;
  const [loca, glyf] = [tables.get("loca")!, tables.get("glyf")!];
  const offset = (g: number) => (f.longLoca ? view.getUint32(loca + g * 4) : view.getUint16(loca + g * 2) * 2);
  if (offset(glyph) === offset(glyph + 1)) return [];
  let at = glyf + offset(glyph);
  const count = view.getInt16(at);
  at += 10;
  if (count < 0) {
    const out: Pt[][] = [];
    for (;;) {
      const flags = view.getUint16(at);
      const part = view.getUint16(at + 2);
      at += 4;
      const words = flags & 1;
      if (!(flags & 2)) throw new Error("composite glyph placed by points");
      const dx = words ? view.getInt16(at) : view.getInt8(at);
      const dy = words ? view.getInt16(at + 2) : view.getInt8(at + 1);
      at += words ? 4 : 2;
      if (flags & 0xc8) throw new Error("composite glyph with scaling");
      out.push(...contours(f, part).map((c) => c.map(([x, y]): Pt => [x + dx, y + dy])));
      if (!(flags & 0x20)) return out;
    }
  }
  const ends = Array.from({ length: count }, (_, i) => view.getUint16(at + i * 2));
  at += count * 2;
  at += 2 + view.getUint16(at);
  const total = (ends.at(-1) ?? -1) + 1;
  const flags: number[] = [];
  while (flags.length < total) {
    const flag = view.getUint8(at++);
    flags.push(flag);
    if (flag & 8) for (let r = view.getUint8(at++); r > 0; r--) flags.push(flag);
  }
  const axis = (short: number, same: number) =>
    flags.map(((v) => (flag: number) => {
      if (flag & short) {
        const d = view.getUint8(at++);
        v += flag & same ? d : -d;
      } else if (!(flag & same)) {
        v += view.getInt16(at);
        at += 2;
      }
      return v;
    })(0));
  const xs = axis(2, 16);
  const ys = axis(4, 32);
  let first = 0;
  return ends.map((end) => {
    const on: { x: number; y: number; on: boolean }[] = [];
    for (let i = first; i <= end; i++) on.push({ x: xs[i]!, y: ys[i]!, on: !!(flags[i]! & 1) });
    first = end + 1;
    return flattenTrueType(on);
  });
}

function flattenTrueType(p: { x: number; y: number; on: boolean }[]): Pt[] {
  const full: typeof p = [];
  p.forEach((a, i) => {
    full.push(a);
    const b = p[(i + 1) % p.length]!;
    if (!a.on && !b.on) full.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
  });
  const start = full.findIndex((a) => a.on);
  const ring = [...full.slice(start), ...full.slice(0, start)];
  const out: Pt[] = [[ring[0]!.x, ring[0]!.y]];
  for (let i = 1; i <= ring.length; i++) {
    const a = ring[i % ring.length]!;
    if (a.on) {
      out.push([a.x, a.y]);
      continue;
    }
    const from = out.at(-1)!;
    const to = ring[(i + 1) % ring.length]!;
    curve(out, from, [a.x, a.y], [to.x, to.y]);
    i++;
  }
  return out;
}

function curve(out: Pt[], a: Pt, c: Pt, b: Pt, steps = 6) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
}

export type Glyph = { rings: Pt[][]; ascent: number; descent: number; advance: number };

// Outlines in ems, with y pointing down and the origin on the baseline at the pen position.
export function glyph(fontFile: string, char: string): Glyph {
  const f = load(fontFile);
  const code = char.codePointAt(0)!;
  const g = f.lookup(code);
  if (!g) throw new Error(`no glyph for ${JSON.stringify(char)} in ${fontFile}`);
  const hmtx = f.tables.get("hmtx")!;
  const u = f.unitsPerEm;
  return {
    rings: contours(f, g).map((c) => c.map(([x, y]): Pt => [x / u, -y / u])),
    ascent: f.ascent / u,
    descent: f.descent / u,
    advance: f.view.getUint16(hmtx + Math.min(g, f.hMetrics - 1) * 4) / u,
  };
}

// Several closed outlines become one point list. Each outline is reached along a thin bridge and the bridges are walked
// back again, so they enclose no area: holes stay holes and separate pieces stay separate when filled.
export function joinRings(rings: Pt[][]): number[] {
  const out: number[] = [];
  const visible = rings.filter((r) => r.length > 1);
  for (const r of visible) for (const [x, y] of [...r, r[0]!]) out.push(x, y);
  for (let i = visible.length - 2; i >= 0; i--) out.push(visible[i]![0]![0], visible[i]![0]![1]);
  return out;
}

// SVG path data into outlines. KaTeX's stretchy shapes (roots, tall brackets, arrows) only use lines and curves.
export function svgRings(d: string): Pt[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const rings: Pt[][] = [];
  let ring: Pt[] = [];
  let [x, y, sx, sy] = [0, 0, 0, 0];
  let last: Pt | undefined;
  let cmd = "";
  let i = 0;
  const num = () => Number(tokens[i++]);
  const close = () => {
    if (ring.length > 1) rings.push(ring);
    ring = [];
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const [ox, oy] = rel ? [x, y] : [0, 0];
    const big = cmd.toUpperCase();
    const smooth = (): Pt => (last ? [2 * x - last[0], 2 * y - last[1]] : [x, y]);
    if (big === "M") {
      close();
      x = ox + num();
      y = oy + num();
      [sx, sy] = [x, y];
      ring.push([x, y]);
      cmd = rel ? "l" : "L";
      last = undefined;
    } else if (big === "L" || big === "H" || big === "V") {
      if (big !== "V") x = ox + num();
      if (big !== "H") y = oy + num();
      ring.push([x, y]);
      last = undefined;
    } else if (big === "C" || big === "S") {
      const c1 = big === "C" ? ([ox + num(), oy + num()] as Pt) : smooth();
      const c2: Pt = [ox + num(), oy + num()];
      const to: Pt = [ox + num(), oy + num()];
      for (let t = 1 / 8; t <= 1.0001; t += 1 / 8) {
        const u = 1 - t;
        ring.push([u * u * u * x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * to[0], u * u * u * y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1]]);
      }
      last = c2;
      [x, y] = to;
    } else if (big === "Q" || big === "T") {
      const c = big === "Q" ? ([ox + num(), oy + num()] as Pt) : smooth();
      const to: Pt = [ox + num(), oy + num()];
      curve(ring, [x, y], c, to);
      last = c;
      [x, y] = to;
    } else if (big === "Z") {
      close();
      [x, y] = [sx, sy];
      ring.push([x, y]);
      last = undefined;
    } else {
      throw new Error(`unsupported path command ${cmd}`);
    }
  }
  close();
  return rings;
}
