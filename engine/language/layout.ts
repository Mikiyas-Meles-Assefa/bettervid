// Places things. A model says what is on the board and how it is arranged; this works out every position and size, so
// nothing is laid out blind. Everything is pure, so positions are known for every state and things can travel between them.
import type { Problem } from "./syntax.ts";
import type { Atom, Item } from "./syntax.ts";
import type { NodeSpec, Props, Theme } from "../core/types.ts";
import { circle } from "../kits/shapes.ts";

export type Box = { x: number; y: number; w: number; h: number }; // x and y are the center
export type Part = NodeSpec & { props: Props; line: number };
export type Measure = (text: string, size: number, font?: string) => number;
export type Env = {
  W: number; // canvas
  H: number;
  safe: Box; // where content may go
  theme: Theme;
  measure: Measure;
  natural: (item: Item) => { w: number; h: number }; // size of a kit, graph or program before scaling
  minText: number; // the smallest readable text, in pixels
};
export type Slot = { item: Item; box: Box; scale: number };
export type Laid = { parts: Part[]; boxes: Map<string, Box>; members: Map<string, string[]>; slots: Slot[]; links: { from: string; to: string; line: number }[]; problems: Problem[]; scale: number; smallest: number };

// Where content may go: clear of the edges, with the bottom left for captions. The camera frames into this area too.
export function safeArea(W: number, H: number): Box {
  const margin = W * 0.065;
  const top = H * 0.047;
  const usable = H * 0.765;
  return { x: W / 2, y: top + usable / 2, w: W - margin * 2, h: usable };
}

export const CHAR = 0.56; // average character width, in em
// Capitals and digits are wider than the average letter and spaces narrower, so words in capitals are not underestimated.
const charWidth = (c: string) => (/[A-Z0-9MW]/.test(c) ? 0.68 : c === " " ? 0.3 : CHAR);
export const estimate: Measure = (text, size, font) => (font === "mono" ? Math.max(0.6, [...text].length) * size * 0.6 : Math.max(0.6 * CHAR, [...text].reduce((sum, c) => sum + charWidth(c), 0)) * size);
const TEXT_SIZE: Record<string, number> = { huge: 136, big: 96, normal: 70, small: 50, note: 40 };
const CODE_SIZE = 40;
const MAX_SCALE = 1.6;
const MIN_SCALE = 0.4;

const n = (v: string | undefined, d: number) => (v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
const fontSize = (item: Item, fallback: number) => TEXT_SIZE[item.attrs.size ?? ""] ?? (item.attrs.size ? n(item.attrs.size, fallback) : fallback);
const round = (v: number) => Math.round(v * 10) / 10;
const NUMERIC = new Set(["weight", "opacity", "rotate", "strokeWidth"]);
const look = (item: Item, keys: string[]): Props => Object.fromEntries(keys.filter((k) => item.attrs[k] !== undefined).map((k) => [k, NUMERIC.has(k) ? n(item.attrs[k], 0) : item.attrs[k]!]));

// Greedy line breaking, done at natural size so the breaks stay the same when the whole board scales.
export function wrap(text: string, size: number, width: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split("\\n")) {
    let cur = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && measure(next, size) > width) {
        out.push(cur);
        cur = w;
      } else cur = next;
    }
    out.push(cur);
  }
  return out;
}

export function roundedBox(w: number, h: number, r: number): number[] {
  const out: number[] = [];
  const [x, y] = [w / 2 - r, h / 2 - r];
  const corners = [[x, y, 0], [-x, y, 1], [-x, -y, 2], [x, -y, 3]] as const;
  for (const [cx, cy, q] of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = (q + i / 6) * (Math.PI / 2);
      out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  }
  out.push(out[0]!, out[1]!);
  return out;
}
const ellipse = (w: number, h: number) => circle(0, 0, 1).map((v, i) => (i % 2 ? v * h / 2 : v * w / 2));

function shapePoints(kind: string, w: number, h: number): number[] {
  if (kind === "circle" || kind === "dot") return ellipse(w, h);
  if (kind === "pill") return roundedBox(w, h, Math.min(w, h) / 2 - 0.1);
  if (kind === "diamond") return [0, -h / 2, w / 2, 0, 0, h / 2, -w / 2, 0, 0, -h / 2];
  if (kind === "tri") return [0, -h / 2, w / 2, h / 2, -w / 2, h / 2, 0, -h / 2];
  return roundedBox(w, h, Math.min(w, h) * 0.1);
}

const luminance = (c: string) => {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)?.[1];
  if (!h) return 0.5;
  const full = h.length === 3 ? [...h].map((x) => x + x).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
// Whichever of ink and paper can be read on a fill, so a label never disappears into its own shape.
export function readableOn(fill: string, theme: Theme): string {
  const c = theme.colors;
  if (!c.ink || !c.paper) return "ink";
  const on = luminance(c[fill] ?? c.paper);
  return Math.abs(on - luminance(c.ink)) >= Math.abs(on - luminance(c.paper)) ? "ink" : "paper";
}

export function layout(items: Item[], env: Env, cap = MAX_SCALE): Laid {
  const { measure } = env;
  const atomWidth = (a: Atom, size: number) => measure(a.text, size);
  const list = (a: Atom[], size: number) => a.reduce((sum, x) => sum + atomWidth(x, size), 0) + size * 0.16 * Math.max(0, a.length - 1);
  const columns = (rows: Atom[][], size: number) => rows[0]!.map((_, c) => Math.max(...rows.map((r) => atomWidth(r[c]!, size))) + size * 0.5);
  const textLines = (item: Item) => wrap(item.text ?? "", fontSize(item, TEXT_SIZE.normal!), n(item.attrs.w, env.safe.w), measure);
  const shapeSize = (item: Item, s: number) => {
    const size = fontSize(item, TEXT_SIZE.small!) * s;
    const label = item.text ? wrap(item.text, size, 460 * s, measure) : [];
    const tw = Math.max(0, ...label.map((l) => measure(l, size)));
    const th = label.length * size * 1.2;
    if (item.kind === "dot") return { w: n(item.attrs.w, 36) * s, h: n(item.attrs.h, n(item.attrs.w, 36)) * s, label, size };
    const round = item.kind === "circle" || item.kind === "diamond";
    const inner = round ? Math.max(tw * (item.kind === "diamond" ? 1.7 : 1.25), th * (item.kind === "diamond" ? 1.9 : 1.3)) : 0;
    const w = n(item.attrs.w, 0) * s || Math.max(round ? Math.max(inner, 150 * s) : tw + size * 1.4, 150 * s);
    const h = n(item.attrs.h, 0) * s || (round ? w : Math.max(th + size * 1, 110 * s));
    return { w, h, label, size };
  };

  // A container with `back` sits on a panel of that color, with room around its contents.
  const padOf = (item: Item, s: number) => (item.attrs.back && item.attrs.back !== "none" ? 48 * s : 0);
  const sizeOf = (item: Item, s: number): { w: number; h: number } => {
    const inner = innerSize(item, s);
    const pad = padOf(item, s);
    return pad ? { w: inner.w + pad * 2, h: inner.h + pad * 2 } : inner;
  };
  const innerSize = (item: Item, s: number): { w: number; h: number } => {
    const gap = n(item.attrs.gap, 44) * s;
    switch (item.kind) {
      case "atoms": {
        const size = TEXT_SIZE[item.size!]! * s;
        const space = n(item.attrs.gap, 0.26) * size;
        let w = 0;
        let h = size * 1.2;
        for (const p of item.parts!) {
          if (p.type === "text") w += atomWidth(p.atom, size);
          if (p.type === "frac") {
            w += Math.max(list(p.num, size), list(p.den, size)) + size * 0.3;
            h = Math.max(h, size * 2.5);
          }
          if (p.type === "matrix") {
            w += columns(p.rows, size).reduce((a, b) => a + b, 0) + size * 0.5;
            h = Math.max(h, p.rows.length * size * 1.3 + size * 0.3);
          }
        }
        return { w: w + space * Math.max(0, item.parts!.length - 1), h };
      }
      case "text": {
        const size = fontSize(item, TEXT_SIZE.normal!) * s;
        const lines = textLines(item);
        return { w: Math.max(...lines.map((l) => measure(l, size))), h: lines.length * size * 1.25 };
      }
      case "code": {
        const size = fontSize(item, CODE_SIZE) * s;
        return { w: Math.max(1, ...item.lines!.map((l) => measure(l, size, "mono"))), h: Math.max(1, item.lines!.length) * size * 1.45 };
      }
      case "image":
        return { w: n(item.attrs.w, 700) * s, h: n(item.attrs.h, 700) * s };
      case "space":
        return { w: 1, h: n(item.attrs.h, 60) * s };
      case "row": {
        const c = item.children.map((x) => sizeOf(x, s));
        return { w: c.reduce((a, b) => a + b.w, 0) + gap * Math.max(0, c.length - 1), h: Math.max(0, ...c.map((x) => x.h)) };
      }
      case "stack": {
        const c = item.children.map((x) => sizeOf(x, s));
        return { w: Math.max(0, ...c.map((x) => x.w)), h: c.reduce((a, b) => a + b.h, 0) + gap * Math.max(0, c.length - 1) };
      }
      case "chain": {
        const c = item.children.map((x) => sizeOf(x, s));
        const across = item.attrs.dir === "right" || item.attrs.dir === "left";
        const step = n(item.attrs.gap, 86) * s;
        return across
          ? { w: c.reduce((a, b) => a + b.w, 0) + step * Math.max(0, c.length - 1), h: Math.max(0, ...c.map((x) => x.h)) }
          : { w: Math.max(0, ...c.map((x) => x.w)), h: c.reduce((a, b) => a + b.h, 0) + step * Math.max(0, c.length - 1) };
      }
      case "grid": {
        const { widths, heights } = gridSizes(item, s);
        return { w: widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1), h: heights.reduce((a, b) => a + b, 0) + gap * Math.max(0, heights.length - 1) };
      }
      case "ring": {
        const cell = Math.max(0, ...item.children.map((x) => { const b = sizeOf(x, s); return Math.max(b.w, b.h); }));
        const d = ringRadius(item, cell, s) * 2 + cell;
        return { w: d, h: d };
      }
      case "free":
        return { w: n(item.attrs.w, 900) * s, h: n(item.attrs.h, 900) * s };
      case "run":
        if (item.attrs.on && !item.attrs.w && !item.attrs.h) return { w: 0, h: 0 };
      // falls through
      default: {
        if (["box", "circle", "pill", "diamond", "dot", "tri"].includes(item.kind)) return shapeSize(item, s);
        const b = env.natural(item);
        return { w: b.w * s, h: b.h * s };
      }
    }
  };
  const ringRadius = (item: Item, cell: number, s: number) => {
    const count = Math.max(1, item.children.length);
    return item.attrs.size ? (n(item.attrs.size, 700) * s) / 2 : Math.max(cell * 0.85, (cell * 1.25) / (2 * Math.sin(Math.PI / Math.max(3, count))));
  };
  const gridSizes = (item: Item, s: number) => {
    const cols = Math.max(1, n(item.attrs.cols, 2));
    const sizes = item.children.map((x) => sizeOf(x, s));
    const widths = Array.from({ length: Math.min(cols, Math.max(1, sizes.length)) }, () => 0);
    const heights = Array.from({ length: Math.ceil(sizes.length / cols) }, () => 0);
    sizes.forEach((b, i) => {
      widths[i % cols] = Math.max(widths[i % cols]!, b.w);
      heights[Math.floor(i / cols)] = Math.max(heights[Math.floor(i / cols)]!, b.h);
    });
    return { widths, heights };
  };

  // Things that fill the frame take no room in the arrangement. They sit behind it, centered on the frame.
  const framed: Item[] = [];
  const pull = (list: Item[]): Item[] =>
    list.flatMap((i) => {
      if (i.attrs.frame === undefined) return [{ ...i, children: pull(i.children) }];
      framed.push(i);
      return [];
    });
  items = pull(items);
  const root: Item = { kind: "stack", id: "board", line: 0, attrs: {}, children: items };
  let s = cap;
  let box = sizeOf(root, s);
  while ((box.w > env.safe.w || box.h > env.safe.h) && s > MIN_SCALE) box = sizeOf(root, (s = Math.round((s - 0.02) * 100) / 100));

  const out: Laid = { parts: [], boxes: new Map(), members: new Map(), slots: [], links: [], problems: [], scale: s, smallest: Infinity };
  if (box.w > env.safe.w || box.h > env.safe.h) {
    const at = items[0]?.line ?? 0;
    out.problems.push({ line: at, message: `This state does not fit even at ${Math.round(MIN_SCALE * 100)}% size: it needs ${Math.round(box.w)} by ${Math.round(box.h)} of ${Math.round(env.safe.w)} by ${Math.round(env.safe.h)}. Remove something or split it.` });
  }
  const seen = (size: number, line: number) => {
    if (size < out.smallest) out.smallest = size;
    if (size < env.minText - 0.5) out.problems.push({ line, message: `Text here comes out only ${Math.round(size)} pixels tall, too small to read, because this state holds too much to fit. Put less on screen at once or use shorter lines.` });
  };
  const text = (id: string, item: Item, content: string, x: number, y: number, size: number, extra: Props = {}, parent?: string) => {
    seen(size, item.line);
    out.parts.push({ id, kind: "text", line: item.line, ...(parent ? { parent } : {}), props: { x: round(x), y: round(y), text: content, size: round(size), color: "ink", weight: 400, ...extra } });
  };
  const rule = (id: string, points: number[], line: number) => out.parts.push({ id, kind: "path", line, props: { points: points.map(round), stroke: "ink", strokeWidth: 6 } });

  const place = (item: Item, cx: number, cy: number, s: number) => {
    const outer = sizeOf(item, s);
    out.boxes.set(item.id, { x: cx, y: cy, w: outer.w, h: outer.h });
    const pad = padOf(item, s);
    if (pad) out.parts.push({ id: `${item.id}.back`, kind: "path", line: item.line, props: { x: round(cx), y: round(cy), points: roundedBox(outer.w, outer.h, Math.min(outer.w, outer.h) * 0.06).map(round), closed: 1, fill: item.attrs.back!, stroke: "none", z: -1, shadowY: round(14 * s), shadowBlur: round(36 * s), shadowOpacity: 0.3, shadowColor: "#000000" } });
    const size = pad ? innerSize(item, s) : outer;
    const gap = n(item.attrs.gap, 44) * s;
    const members = (ids: string[]) => out.members.set(item.id, ids);
    switch (item.kind) {
      case "atoms": {
        const fs = TEXT_SIZE[item.size!]! * s;
        const extra: Props = { ...(item.size === "note" ? { opacity: 0.75 } : {}), ...look(item, ["color", "weight", "opacity", "rotate"]) };
        const ids: string[] = [];
        const put = (a: Atom, x: number, y: number) => {
          const w = atomWidth(a, fs);
          ids.push(a.id);
          text(a.id, item, a.text, x + w / 2, y, fs, extra);
          out.boxes.set(a.id, { x: x + w / 2, y, w, h: fs * 1.15 });
        };
        const space = n(item.attrs.gap, 0.26) * fs;
        let x = cx - size.w / 2;
        for (const p of item.parts!) {
          if (p.type === "text") {
            put(p.atom, x, cy);
            x += atomWidth(p.atom, fs);
          }
          if (p.type === "frac") {
            const fw = Math.max(list(p.num, fs), list(p.den, fs)) + fs * 0.3;
            const row = (a: Atom[], y: number) => {
              let ax = x + (fw - list(a, fs)) / 2;
              for (const t of a) {
                put(t, ax, y);
                ax += atomWidth(t, fs) + fs * 0.16;
              }
            };
            row(p.num, cy - fs * 0.68);
            row(p.den, cy + fs * 0.68);
            const bar = `bar.${p.num[0]!.id}`;
            rule(bar, [x, cy, x + fw, cy], item.line);
            ids.push(bar);
            x += fw;
          }
          if (p.type === "matrix") {
            const cols = columns(p.rows, fs);
            const tw = cols.reduce((a, b) => a + b, 0) + fs * 0.5;
            const th = p.rows.length * fs * 1.3;
            const top = cy - th / 2;
            const key = p.rows[0]![0]!.id;
            const hook = p.bars ? 0 : fs * 0.2;
            rule(`lb.${key}`, p.bars ? [x, top, x, top + th] : [x + hook, top, x, top, x, top + th, x + hook, top + th], item.line);
            rule(`rb.${key}`, p.bars ? [x + tw, top, x + tw, top + th] : [x + tw - hook, top, x + tw, top, x + tw, top + th, x + tw - hook, top + th], item.line);
            ids.push(`lb.${key}`, `rb.${key}`);
            p.rows.forEach((r, ri) => {
              let c = x + fs * 0.25;
              r.forEach((a, ci) => {
                const w = atomWidth(a, fs);
                put(a, c + (cols[ci]! - w) / 2, top + (ri + 0.5) * fs * 1.3);
                c += cols[ci]!;
              });
            });
            x += tw;
          }
          x += space;
        }
        members(ids);
        return;
      }
      case "text": {
        const fs = fontSize(item, TEXT_SIZE.normal!) * s;
        const lines = textLines(item);
        const left = item.attrs.align === "left";
        const extra: Props = { ...look(item, ["color", "weight", "opacity"]), ...(item.attrs.font === "title" ? { font: env.theme.fonts.title } : {}), ...(item.attrs.font === "mono" ? { font: env.theme.fonts.mono ?? "Menlo, monospace" } : {}), ...(left ? { anchor: "start" } : {}) };
        const dx = left ? -size.w / 2 : 0;
        // Always a group with one part per line, so a text can grow or shrink a line without changing what it is.
        out.parts.push({ id: item.id, kind: "group", line: item.line, props: { x: round(cx), y: round(cy), ...look(item, ["rotate"]) } });
        lines.forEach((l, i) => text(`${item.id}.l${i + 1}`, item, l, dx, (i - (lines.length - 1) / 2) * fs * 1.25, fs, extra, item.id));
        return;
      }
      case "code": {
        const fs = fontSize(item, CODE_SIZE) * s;
        const font = env.theme.fonts.mono ?? "Menlo, monospace";
        out.parts.push({ id: item.id, kind: "group", line: item.line, props: { x: round(cx), y: round(cy) } });
        item.lines!.forEach((l, i) => {
          const pad = l.length - l.trimStart().length;
          const id = `${item.id}.${i + 1}`;
          const y = (i - (item.lines!.length - 1) / 2) * fs * 1.45;
          text(id, item, l.trim() || " ", -size.w / 2 + pad * fs * 0.6, y, fs, { anchor: "start", font }, item.id);
          out.boxes.set(id, { x: cx, y: cy + y, w: size.w, h: fs * 1.3 });
        });
        return;
      }
      case "image":
        out.parts.push({ id: item.id, kind: "image", line: item.line, props: { x: round(cx), y: round(cy), w: round(size.w), h: round(size.h), src: item.attrs.asset ?? "", ...look(item, ["opacity", "rotate"]) } });
        return;
      case "space":
        return;
      case "row": {
        let x = cx - size.w / 2;
        for (const c of item.children) {
          const b = sizeOf(c, s);
          const y = item.attrs.align === "top" ? cy - size.h / 2 + b.h / 2 : item.attrs.align === "bottom" ? cy + size.h / 2 - b.h / 2 : cy;
          place(c, x + b.w / 2, y, s);
          x += b.w + gap;
        }
        return;
      }
      case "stack": {
        let y = cy - size.h / 2;
        for (const c of item.children) {
          const b = sizeOf(c, s);
          const x = item.attrs.align === "left" ? cx - size.w / 2 + b.w / 2 : item.attrs.align === "right" ? cx + size.w / 2 - b.w / 2 : cx;
          place(c, x, y + b.h / 2, s);
          y += b.h + gap;
        }
        return;
      }
      case "chain": {
        const dir = item.attrs.dir ?? "down";
        const across = dir === "right" || dir === "left";
        const step = n(item.attrs.gap, 86) * s;
        const ordered = dir === "left" || dir === "up" ? [...item.children].reverse() : item.children;
        let p = across ? cx - size.w / 2 : cy - size.h / 2;
        for (const c of ordered) {
          const b = sizeOf(c, s);
          if (across) place(c, p + b.w / 2, cy, s);
          else place(c, cx, p + b.h / 2, s);
          p += (across ? b.w : b.h) + step;
        }
        item.children.slice(1).forEach((c, i) => out.links.push({ from: item.children[i]!.id, to: c.id, line: item.line }));
        return;
      }
      case "grid": {
        const { widths, heights } = gridSizes(item, s);
        item.children.forEach((c, i) => {
          const col = i % Math.max(1, n(item.attrs.cols, 2));
          const row = Math.floor(i / Math.max(1, n(item.attrs.cols, 2)));
          const x = cx - size.w / 2 + widths.slice(0, col).reduce((a, b) => a + b + gap, 0) + widths[col]! / 2;
          const y = cy - size.h / 2 + heights.slice(0, row).reduce((a, b) => a + b + gap, 0) + heights[row]! / 2;
          place(c, x, y, s);
        });
        return;
      }
      case "ring": {
        const cell = Math.max(0, ...item.children.map((x) => { const b = sizeOf(x, s); return Math.max(b.w, b.h); }));
        const r = ringRadius(item, cell, s);
        item.children.forEach((c, i) => {
          const a = -Math.PI / 2 + (i / item.children.length) * Math.PI * 2;
          place(c, cx + Math.cos(a) * r, cy + Math.sin(a) * r, s);
        });
        if (item.attrs.arrows) item.children.forEach((c, i) => out.links.push({ from: c.id, to: item.children[(i + 1) % item.children.length]!.id, line: item.line }));
        return;
      }
      case "free": {
        for (const c of item.children) {
          const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(c.attrs.at ?? "");
          if (!m) {
            out.problems.push({ line: c.line, message: `Inside free, ${c.id} needs at=X,Y, in percent of the free area from its top left, as in at=30,70.` });
            continue;
          }
          place(c, cx - size.w / 2 + (Number(m[1]) / 100) * size.w, cy - size.h / 2 + (Number(m[2]) / 100) * size.h, s);
        }
        return;
      }
      default: {
        if (["box", "circle", "pill", "diamond", "dot", "tri"].includes(item.kind)) {
          const b = shapeSize(item, s);
          const fill = item.attrs.fill ?? (item.kind === "dot" ? "ink" : "paper");
          out.parts.push({ id: item.id, kind: "group", line: item.line, props: { x: round(cx), y: round(cy), ...look(item, ["opacity", "rotate"]) } });
          out.parts.push({ id: `${item.id}.shape`, kind: "path", parent: item.id, line: item.line, props: { points: shapePoints(item.kind, b.w, b.h).map(round), closed: 1, fill, stroke: item.attrs.stroke ?? (item.kind === "dot" ? "none" : "ink"), strokeWidth: n(item.attrs.strokeWidth, 6) } });
          b.label.forEach((l, i) => text(i ? `${item.id}.label${i + 1}` : `${item.id}.label`, item, l, 0, (i - (b.label.length - 1) / 2) * b.size * 1.2, b.size, { ...(item.attrs.color ? {} : { color: readableOn(fill, env.theme) }), ...look(item, ["color", "weight"]) }, item.id));
          return;
        }
        out.slots.push({ item, box: { x: cx, y: cy, w: size.w, h: size.h }, scale: s });
      }
    }
  };
  for (const f of framed) {
    const mode = f.attrs.frame;
    if (mode !== "fill" && mode !== "fit") {
      out.problems.push({ line: f.line, message: `frame is fill (cover the whole frame, cropping what spills over) or fit (show all of it as large as it goes), not ${mode}.` });
      continue;
    }
    const isShape = ["box", "circle", "pill", "diamond", "dot", "tri"].includes(f.kind);
    if (f.kind !== "image" && !isShape) {
      out.problems.push({ line: f.line, message: `Only images and shapes can fill the frame; ${f.id} is a ${f.kind}.` });
      continue;
    }
    const [w0, h0] = [n(f.attrs.w, env.W), n(f.attrs.h, env.H)];
    const k = mode === "fill" ? Math.max(env.W / w0, env.H / h0) : Math.min(env.W / w0, env.H / h0);
    const [w, h] = isShape && mode === "fill" ? [env.W, env.H] : [w0 * k, h0 * k];
    const [cx, cy] = [env.W / 2, env.H / 2];
    out.boxes.set(f.id, { x: cx, y: cy, w, h });
    if (f.kind === "image") out.parts.push({ id: f.id, kind: "image", line: f.line, props: { x: cx, y: cy, w: round(w), h: round(h), src: f.attrs.asset ?? "", z: -2, ...look(f, ["opacity", "rotate"]) } });
    else {
      const fill = f.attrs.fill ?? "paper";
      out.parts.push({ id: f.id, kind: "group", line: f.line, props: { x: cx, y: cy, z: -2, ...look(f, ["opacity"]) } });
      out.parts.push({ id: `${f.id}.shape`, kind: "path", parent: f.id, line: f.line, props: { points: (f.kind === "box" ? [-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2, -w / 2, -h / 2] : shapePoints(f.kind, w, h)).map(round), closed: 1, fill, stroke: f.attrs.stroke ?? "none", strokeWidth: n(f.attrs.strokeWidth, 6) } });
      if (f.text) text(`${f.id}.label`, f, f.text, 0, 0, fontSize(f, TEXT_SIZE.big!), { ...(f.attrs.color ? {} : { color: readableOn(fill, env.theme) }), ...look(f, ["color", "weight"]) }, f.id);
    }
  }
  // Content sits a little above the middle, with the free space shared around it.
  const { safe } = env;
  place(root, safe.x, safe.y - Math.max(0, safe.h - box.h) * 0.08, s);
  out.boxes.delete("board");
  const leaves = (item: Item): string[] => (item.kind === "atoms" ? out.members.get(item.id) ?? [] : item.children.length ? item.children.flatMap(leaves) : [item.id]);
  const walk = (item: Item) => {
    if (item.children.length) out.members.set(item.id, leaves(item));
    item.children.forEach(walk);
  };
  items.forEach(walk);
  return out;
}

// A deterministic layout for a graph, in a 1000 by 1000 box: start on a circle, then let edges pull and nodes push.
export function graphPositions(ids: string[], edges: { from: string; to: string }[], size = 1000, radius = 62): Map<string, { x: number; y: number }> {
  const p = ids.map((_, i) => {
    const a = -Math.PI / 2 + (i / ids.length) * Math.PI * 2;
    return { x: Math.cos(a) * 300, y: Math.sin(a) * 300 };
  });
  const at = new Map(ids.map((id, i) => [id, i]));
  const k = Math.sqrt((size * size) / Math.max(1, ids.length)) * 0.75;
  for (let step = 0; step < 300; step++) {
    const force = p.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < p.length; i++) {
      for (let j = 0; j < p.length; j++) {
        if (i === j) continue;
        const [dx, dy] = [p[i]!.x - p[j]!.x, p[i]!.y - p[j]!.y];
        const d = Math.max(1, Math.hypot(dx, dy));
        force[i]!.x += (dx / d) * (k * k) / d;
        force[i]!.y += (dy / d) * (k * k) / d;
      }
    }
    for (const e of edges) {
      const [a, b] = [at.get(e.from)!, at.get(e.to)!];
      const [dx, dy] = [p[a]!.x - p[b]!.x, p[a]!.y - p[b]!.y];
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = (d * d) / k;
      force[a]!.x -= (dx / d) * f;
      force[a]!.y -= (dy / d) * f;
      force[b]!.x += (dx / d) * f;
      force[b]!.y += (dy / d) * f;
    }
    const cool = 40 * (1 - step / 300) + 1;
    p.forEach((q, i) => {
      const m = Math.max(1, Math.hypot(force[i]!.x, force[i]!.y));
      q.x += (force[i]!.x / m) * Math.min(m, cool);
      q.y += (force[i]!.y / m) * Math.min(m, cool);
    });
  }
  const [minX, maxX] = [Math.min(...p.map((q) => q.x)), Math.max(...p.map((q) => q.x))];
  const [minY, maxY] = [Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.y))];
  const scale = (size - radius * 2) / Math.max(1, maxX - minX, maxY - minY);
  return new Map(ids.map((id, i) => [id, { x: Math.round((p[i]!.x - (minX + maxX) / 2) * scale), y: Math.round((p[i]!.y - (minY + maxY) / 2) * scale) }]));
}
