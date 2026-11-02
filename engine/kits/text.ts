// Text where every letter and word is its own part, placed from real measured widths so nothing collides. Each letter
// is a plain text primitive in the style's own font, and a sentence can hold states and rearrange word by word.
import type { CompileContext, Kit, Measured, MeasureRequest, NodeSpec, Theme } from "../core/types.ts";
import { buildCast, castEntry, castNodes, partBehaviors, register, type Atom, type Cast, type PartState } from "../layout/parts.ts";
import { measure as realMeasure, measureMany } from "./text-browser.ts";

export type Run = { text: string; size?: number; color?: string; weight?: number; role?: "title" | "body" | "mono" };
export type TextData = {
  text?: string | Run[];
  states?: (string | Run[])[]; // several forms of one sentence; move between them with the `become` behavior
  size?: number;
  color?: string; // a theme name
  weight?: number;
  role?: "title" | "body" | "mono"; // which of the style's fonts
  width?: number; // wrap to this many pixels
  align?: "left" | "center" | "right";
  lineHeight?: number; // in multiples of the size
  tracking?: number; // extra pixels between letters
  split?: "letter" | "word"; // how finely to cut
  balance?: boolean; // even out wrapped lines instead of filling each in turn; on unless set false
};

export const textPart = {
  word: (t: string, w: number) => `${t}.word.${w}`,
  letter: (t: string, n: number) => `${t}.letter.${n}`,
};
export const textSet = { word: (w: number) => `word.${w}`, line: (l: number) => `line.${l}`, char: (c: string) => `char.${c}` };

// Scripts whose letters join or reorder when shaped. Cutting them apart would change how they read, so words stay whole.
const JOINED = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}\p{Script=Mongolian}]/u;
const RTL = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Hebrew}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

type Cell = { text: string; run: number; left: number; width: number; word: number; space: boolean; newline: boolean };
type Style = { size: number; color: string; weight: number; font: string; ascent: number; descent: number };

export function fontOf(theme: Theme, role: Run["role"] = "body"): string {
  return role === "title" ? theme.fonts.title : role === "mono" ? (theme.fonts.mono ?? theme.fonts.body) : theme.fonts.body;
}

function requestFor(run: Run, d: TextData, theme: Theme): MeasureRequest {
  const clusters: string[] = [];
  const whole = d.split === "word";
  for (const piece of run.text.match(/\s|[^\s]+/g) ?? []) {
    if (/\s/.test(piece)) clusters.push(piece);
    else if (JOINED.test(piece)) clusters.push(piece);
    else if (whole && !CJK.test(piece)) clusters.push(piece);
    else clusters.push(...[...graphemes.segment(piece)].map((s) => s.segment));
  }
  return { clusters, font: fontOf(theme, run.role ?? d.role), weight: run.weight ?? d.weight ?? 400 };
}

const runsOf = (t: string | Run[]): Run[] => (typeof t === "string" ? [{ text: t }] : t);

function layoutState(content: string | Run[], d: TextData, ctx: CompileContext): PartState {
  const measure = ctx.measure ?? realMeasure;
  const runs = runsOf(content);
  const styles: Style[] = [];
  const cells: Cell[] = [];
  let word = 0;
  let inWord = false;
  runs.forEach((run, r) => {
    const request = requestFor(run, d, ctx.theme);
    const m: Measured = measure(request);
    const size = run.size ?? d.size ?? 72;
    styles.push({ size, color: run.color ?? d.color ?? "ink", weight: request.weight, font: request.font, ascent: m.ascent * size, descent: m.descent * size });
    const track = d.tracking ?? 0;
    request.clusters.forEach((text, i) => {
      const space = /^\s$/.test(text);
      const begin = (i ? m.edges[i - 1]! : 0) * size + i * track;
      const width = (m.edges[i]! - (i ? m.edges[i - 1]! : 0)) * size + track;
      if (space) inWord = false;
      else {
        if (!inWord || CJK.test(text)) word++;
        inWord = true;
      }
      cells.push({ text, run: r, left: begin, width, word, space, newline: text === "\n" });
    });
  });

  // Greedy wrapping on measured widths. A space at a line's end takes no room.
  const widthOf = (l: Cell[]) => {
    let end = l.length;
    while (end && l[end - 1]!.space) end--;
    return l.slice(0, end).reduce((a, c) => a + c.width, 0);
  };
  const wrap = (limit: number | undefined) => {
    const out: Cell[][] = [[]];
    for (let i = 0; i < cells.length; ) {
      const c = cells[i]!;
      if (c.newline) {
        out.push([]);
        i++;
        continue;
      }
      let end = i + 1;
      while (end < cells.length && !cells[end]!.space && !c.space && cells[end]!.word === c.word) end++;
      const chunk = cells.slice(i, end);
      const line = out.at(-1)!;
      if (limit && line.length && !c.space && widthOf([...line, ...chunk]) > limit) out.push(chunk);
      else if (!(c.space && !line.length)) line.push(...chunk);
      i = end;
    }
    return out;
  };
  let lines = wrap(d.width);
  // The narrowest width that still needs no more lines, so no word is left alone on the last one.
  if (d.width && d.balance !== false && lines.length > 1) {
    let [low, high] = [0, d.width];
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2;
      if (wrap(mid).length > lines.length) low = mid;
      else high = mid;
    }
    lines = wrap(high);
  }

  const atoms: Atom[] = [];
  const rtl = RTL.test(runs.map((r) => r.text).join(""));
  const widest = Math.max(...lines.map(widthOf));
  let top = 0;
  lines.forEach((line, n) => {
    const ss = line.length ? [...new Set(line.map((c) => c.run))].map((r) => styles[r]!) : [styles[0]!];
    const ascent = Math.max(...ss.map((s) => s.ascent));
    const descent = Math.max(...ss.map((s) => s.descent));
    const tallest = Math.max(...ss.map((s) => s.size));
    // Never tighter than the font's own height, so lines cannot touch.
    const height = Math.max(ascent + descent, tallest * (d.lineHeight ?? 1.25));
    const baseline = top + (height - ascent - descent) / 2 + ascent;
    const used = widthOf(line);
    const align = d.align ?? (rtl ? "right" : "center");
    let pen = align === "left" ? 0 : align === "right" ? widest - used : (widest - used) / 2;
    const placed = rtl ? [...line].reverse() : line;
    const row: Atom[] = [];
    for (const c of placed) {
      if (!c.space) {
        const s = styles[c.run]!;
        const whole = cells.filter((x) => x.word === c.word && !x.space).map((x) => x.text).join("");
        const y = baseline - (s.ascent - s.descent) / 2;
        const home = [`word.${c.word - 1}`];
        row.push({ key: c.text, chunk: whole, x: pen + c.width / 2, y, w: c.width, h: s.ascent + s.descent, kind: "text", home, of: [`line.${n}`], props: { text: c.text, size: s.size, color: s.color, weight: s.weight, font: s.font, anchor: "middle" } });
      }
      pen += c.width;
    }
    atoms.push(...(rtl ? row.reverse() : row)); // parts stay in reading order
    top += height;
  });
  return { atoms: atoms.map((a) => ({ ...a, x: a.x - widest / 2, y: a.y - top / 2 })) };
}

const cache = new WeakMap<CompileContext, Map<string, Cast>>();

export function layoutText(id: string, d: TextData, ctx: CompileContext): Cast {
  const list = d.states ?? (d.text !== undefined ? [d.text] : []);
  if (!list.length) throw new Error(`${id} needs text or states`);
  const key = JSON.stringify([id, d]);
  const memo = cache.get(ctx) ?? cache.set(ctx, new Map()).get(ctx)!;
  const known = memo.get(key);
  if (known) return known;
  const cast = buildCast(id, list.map((s) => layoutState(s, d, ctx)), (_, i) => `letter.${i}`);
  memo.set(key, cast);
  return cast;
}

// One browser start can measure a whole scene's text before it compiles. Optional: it only makes the first compile faster.
export function warmText(items: TextData[], theme: Theme) {
  measureMany(items.flatMap((d) => (d.states ?? [d.text ?? ""]).flatMap((s) => runsOf(s).map((r) => requestFor(r, d, theme)))));
}

export const textKit: Kit = {
  name: "text",
  kinds: {
    words: (n: NodeSpec, ctx) => {
      const cast = layoutText(n.id, n.data as TextData, ctx);
      register(ctx, n.id, castEntry(cast, "letter"));
      return castNodes(cast, n);
    },
  },
  behaviors: partBehaviors,
};
