// A PDF into text by page, its tables, and its pictures, read with pdf.js. A PDF stores words at positions, not in
// reading order, so the page is rebuilt from where the words stand: lines by height, columns by the empty gutter between
// them, tables by rows of short cells that line up. A page whose meaning is not in its text (a scan, a drawn chart, a
// font with no map to letters) is rendered and goes to the picture reader like any picture. What cannot be read is said
// in `problems`, by page.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Extracted } from "./office.ts";

// A picture under this many pixels across is a bullet, a rule or a tile of a texture, not something to show.
const MIN_PICTURE = 48;
// The longest side of a rendered page: enough to read its smallest words.
const RENDER_SIDE = 1800;
const PICTURE_WAIT = 30_000; // ms
// Drawing commands on a page before it is taken to hold a drawn figure, not just rules and boxes around text.
const DRAWN = 24;
const THIN = 2; // points: a path no wider than this is a rule, not a shape
// Measures of layout, as shares of the line's own height unless said otherwise.
const SAME_LINE = 0.5; // two pieces of text this close in height share a line
const CELL_GAP = 1.2; // a gap this wide between words on a line separates two cells
const ALIGN = 1; // cells starting this close stand in one table column
const GUTTER = 0.9; // an empty strip this wide, top to bottom, separates two columns of prose
const CROSSING = 0.15; // the share of lines that may cross a gutter
const PROSE_CHARS = 25; // lines averaging this many characters on both sides of a gutter are prose, not table cells
const MIN_ROWS = 3; // fewer rows than this is not worth calling a table
const CELL_CHARS = 60; // table cells are shorter than this on average

export type Piece = { x: number; y: number; w: number; h: number; text: string };
type Cell = { x: number; end: number; text: string };
type Line = { y: number; h: number; x: number; end: number; cells: Cell[] };
export type PageLayout = { text: string; tables: string[][][] };

function toLines(pieces: Piece[]): Line[] {
  const sorted = pieces.filter((p) => p.text.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Piece[][] = [];
  for (const p of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.y - p.y) <= SAME_LINE * Math.max(row[0]!.h, p.h, 1)) row.push(p);
    else rows.push([p]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const h = Math.max(...row.map((p) => p.h), 1);
    const cells: Cell[] = [];
    for (const p of row) {
      const c = cells.at(-1);
      const gap = c ? p.x - c.end : Infinity;
      if (c && gap <= CELL_GAP * h) {
        c.text += (gap > 0.15 * h && !c.text.endsWith(" ") && !p.text.startsWith(" ") ? " " : "") + p.text;
        c.end = Math.max(c.end, p.x + p.w);
      } else cells.push({ x: p.x, end: p.x + p.w, text: p.text });
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
    return { y: row[0]!.y, h, x: cells[0]!.x, end: Math.max(...cells.map((c) => c.end)), cells };
  });
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const lineText = (l: Line) => l.cells.map((c) => c.text).join(" ");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Where the empty strip between two columns of prose stands, if the page has one. A few lines may cross it (a title). */
function gutterOf(lines: Line[]): number | undefined {
  if (lines.length < MIN_ROWS * 2) return undefined;
  const h = median(lines.map((l) => l.h));
  const cells = lines.flatMap((l) => l.cells);
  const left = Math.min(...cells.map((c) => c.x));
  const right = Math.max(...cells.map((c) => c.end));
  const allowed = Math.floor(lines.length * CROSSING);
  const step = h / 4;
  let best: { at: number; width: number } | undefined;
  let from: number | undefined;
  for (let x = left + step; x <= right; x += step) {
    const open = x < right - step && cells.filter((c) => c.x < x && c.end > x).length <= allowed;
    if (open) from ??= x;
    else if (from !== undefined) {
      if (x - from >= GUTTER * h && (!best || x - from > best.width)) best = { at: (x + from) / 2, width: x - from };
      from = undefined;
    }
  }
  if (!best) return undefined;
  const middle = (best.at - left) / (right - left);
  if (middle < 0.2 || middle > 0.8) return undefined;
  const side = (test: (c: Cell) => boolean) => lines.flatMap((l) => l.cells.filter(test));
  const [a, b] = [side((c) => c.end <= best!.at), side((c) => c.x >= best!.at)];
  if (Math.min(a.length, b.length) < MIN_ROWS) return undefined;
  return mean(a.map((c) => c.text.length)) >= PROSE_CHARS && mean(b.map((c) => c.text.length)) >= PROSE_CHARS ? best.at : undefined;
}

/** Runs of lines that stand as a table become tables; everything else is text in order. */
function readBlock(lines: Line[], out: PageLayout, say: string[]) {
  let i = 0;
  while (i < lines.length) {
    let k = i;
    while (k < lines.length && lines[k]!.cells.length >= 2) k++;
    const run = lines.slice(i, k);
    const rows = run.length >= MIN_ROWS ? tableOf(run) : undefined;
    if (rows) {
      out.tables.push(rows);
      i = k;
    } else if (run.length) {
      say.push(...run.map(lineText));
      i = k;
    } else {
      say.push(lineText(lines[i]!));
      i++;
    }
  }
}

/** The rows of a run of lines, when their cells line up in columns and are short enough to be cells. */
function tableOf(run: Line[]): string[][] | undefined {
  const h = median(run.map((l) => l.h));
  const columns: { x: number; end: number; n: number }[] = [];
  for (const c of run.flatMap((l) => l.cells).sort((a, b) => a.x - b.x)) {
    const col = columns.find((k) => Math.abs(k.x - c.x) <= ALIGN * h || Math.abs(k.end - c.end) <= ALIGN * h);
    if (col) {
      col.n++;
      col.end = Math.max(col.end, c.end);
    } else columns.push({ x: c.x, end: c.end, n: 1 });
  }
  const steady = columns.filter((c) => c.n >= Math.ceil(run.length * 0.6)).sort((a, b) => a.x - b.x);
  if (steady.length < 2) return undefined;
  const cells = run.flatMap((l) => l.cells);
  if (mean(cells.map((c) => c.text.length)) >= CELL_CHARS) return undefined;
  return run.map((l) => {
    const row = steady.map(() => "");
    for (const c of l.cells) {
      let at = 0;
      let bestOverlap = -Infinity;
      steady.forEach((k, j) => {
        const overlap = Math.min(c.end, k.end) - Math.max(c.x, k.x);
        if (overlap > bestOverlap) [at, bestOverlap] = [j, overlap];
      });
      row[at] = row[at] ? `${row[at]} ${c.text}` : c.text;
    }
    return row;
  });
}

/** A page's words back in reading order, from where they stand. */
export function layoutPage(pieces: Piece[]): PageLayout {
  const lines = toLines(pieces);
  const out: PageLayout = { text: "", tables: [] };
  const say: string[] = [];
  const gutter = gutterOf(lines);
  if (gutter === undefined) readBlock(lines, out, say);
  else {
    // Lines that cross the gutter stand on their own; between them, the left column and then the right.
    let held: Line[] = [];
    const flush = () => {
      const part = (test: (c: Cell) => boolean) => held.map((l) => ({ ...l, cells: l.cells.filter(test) })).filter((l) => l.cells.length);
      readBlock(part((c) => c.x < gutter), out, say);
      readBlock(part((c) => c.x >= gutter), out, say);
      held = [];
    };
    for (const l of lines) {
      if (l.cells.some((c) => c.x < gutter && c.end > gutter)) {
        flush();
        readBlock([l], out, say);
      } else held.push(l);
    }
    flush();
  }
  out.text = say.join("\n");
  return out;
}

const readable = (s: string) => {
  const t = s.replace(/\s/g, "");
  return t.length ? (t.match(/[\p{L}\p{N}\p{P}\p{S}]/gu) ?? []).filter((c) => c !== "�").length / t.length : 0;
};

async function engine() {
  const require = createRequire(import.meta.url);
  const [pdfjs, canvas] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("@napi-rs/canvas")]);
  const home = dirname(require.resolve("pdfjs-dist/package.json"));
  return { pdfjs, canvas, assets: { cMapUrl: `${join(home, "cmaps")}/`, cMapPacked: true, standardFontDataUrl: `${join(home, "standard_fonts")}/` } };
}
type Engine = Awaited<ReturnType<typeof engine>>;

async function open(e: Engine, b: Buffer) {
  try {
    const task = e.pdfjs.getDocument({ data: new Uint8Array(b), verbosity: 0, ...e.assets });
    return { doc: await task.promise, close: () => task.destroy() };
  } catch (err) {
    if ((err as Error).name === "PasswordException") throw new Error("it is protected with a password");
    throw new Error(/invalid pdf|no pdf header/i.test((err as Error).message) ? "it is not a readable PDF" : (err as Error).message);
  }
}

/** Opens a PDF to see that it can be read; throws why not. */
export async function probePdf(b: Buffer): Promise<void> {
  const e = await engine();
  await (await open(e, b)).close();
}

// A decoded picture's samples (pdf.js kinds: 1 one bit, 2 RGB, 3 RGBA) as a PNG.
function pictureBytes(e: Engine, im: { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray }): Buffer | undefined {
  const { width: w, height: h, kind, data } = im;
  if (!data) return undefined;
  const rgba = new Uint8ClampedArray(w * h * 4);
  if (kind === 3) rgba.set(data.subarray(0, rgba.length));
  else if (kind === 2) for (let i = 0; i < w * h; i++) [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]] = [data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!, 255];
  else if (kind === 1) {
    const stride = (w + 7) >> 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = data[y * stride + (x >> 3)]! & (128 >> (x & 7)) ? 255 : 0;
      const i = (y * w + x) * 4;
      [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]] = [v, v, v, 255];
    }
  } else return undefined;
  const c = e.canvas.createCanvas(w, h);
  c.getContext("2d").putImageData(new e.canvas.ImageData(rgba, w, h), 0, 0);
  return c.toBuffer("image/png");
}

// A picture arrives from the worker some time after the page's commands do.
const decoded = (objs: { get(name: string, then: (v: any) => void): unknown }, name: string) =>
  Promise.race([new Promise<any>((ok) => objs.get(name, ok)), new Promise<undefined>((ok) => (setTimeout(ok, PICTURE_WAIT) as unknown as NodeJS.Timeout).unref())]);

/** The pages of a PDF. Throws when it cannot be opened at all, with the reason in plain words. */
export async function readPdf(b: Buffer): Promise<Extracted> {
  const e = await engine();
  const { doc, close } = await open(e, b);
  const { OPS } = e.pdfjs;
  const out: Extracted = { sections: [], tables: [], images: [], problems: [] };
  const seen = new Set<string>();
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const where = `page ${n}`;
      try {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        const pieces = content.items.flatMap((it) => ("str" in it && it.str ? [{ x: it.transform[4] as number, y: it.transform[5] as number, w: it.width, h: it.height || Math.abs(it.transform[3] as number), text: it.str }] : []));
        const layout = layoutPage(pieces);
        const words = [layout.text, ...layout.tables.flat(2)].join(" ");
        const fine = readable(words) >= 0.7;
        if (fine && layout.text.trim()) out.sections.push({ where, text: layout.text });
        if (fine) layout.tables.forEach((rows, i) => out.tables.push({ where: layout.tables.length > 1 ? `${where} table ${i + 1}` : `${where} table`, rows }));

        const ops = await page.getOperatorList();
        // Underlines and table rules are thin; a figure's shapes have area. (A path's third argument is its bounds.)
        const drawn = ops.fnArray.filter((f, i) => {
          if (f === OPS.shadingFill) return true;
          if (f !== OPS.constructPath) return false;
          const box = ops.argsArray[i]![2] as ArrayLike<number> | null | undefined;
          return !box || Math.min(Math.abs(box[2]! - box[0]!), Math.abs(box[3]! - box[1]!)) > THIN;
        }).length;
        const cells = layout.tables.flat(2).length;
        const pictures: { ext: string; bytes: Buffer }[] = [];
        // A page with no words of its own is rendered whole; otherwise its pictures stand on their own.
        const whole = !fine || !words.trim() || drawn >= Math.max(DRAWN, cells * 3);
        if (fine && words.trim()) {
          for (let i = 0; i < ops.fnArray.length; i++) {
            const f = ops.fnArray[i];
            const inline = f === OPS.paintInlineImageXObject;
            if (f !== OPS.paintImageXObject && !inline) continue;
            const arg = ops.argsArray[i]![0];
            if (typeof arg === "string" && seen.has(arg)) continue;
            if (typeof arg === "string") seen.add(arg);
            const im = inline ? arg : await decoded(arg.startsWith("g_") ? page.commonObjs : page.objs, arg);
            if (!im) {
              out.problems.push(`${where}: a picture could not be decoded in time, so it was not used`);
              continue;
            }
            if (Math.min(im.width, im.height) < MIN_PICTURE) continue;
            const png = pictureBytes(e, im);
            if (png) pictures.push({ ext: "png", bytes: png });
            else out.problems.push(`${where}: a ${im.width} by ${im.height} picture could not be decoded, so it was not used`);
          }
        }
        if (whole && (drawn || ops.fnArray.some((f) => f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject || f === OPS.showText))) {
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(3, RENDER_SIDE / Math.max(base.width, base.height)) });
          const canvas = e.canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const ctx = canvas.getContext("2d");
          await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise;
          pictures.push({ ext: "png", bytes: canvas.toBuffer("image/png") });
          if (!fine && words.trim()) out.problems.push(`${where}: its text uses a font with no map to letters, so it is read from the rendered page`);
        }
        for (const pic of pictures) out.images.push({ where, ...pic });
        page.cleanup();
      } catch (err) {
        out.problems.push(`${where}: could not be read: ${(err as Error).message}`);
      }
    }
  } finally {
    await close();
  }
  if (!out.sections.length && !out.tables.length && !out.images.length) throw new Error(out.problems[0] ? `nothing could be read from it (${out.problems[0]})` : "it has no text or pictures that can be read");
  return out;
}
