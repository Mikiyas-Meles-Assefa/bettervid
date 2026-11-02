// Widths of words in the style's real fonts. The layout's built-in estimate knows no fonts, so a wide face (a chalk or
// display title, a heavy caption) came out wider on screen than planned and ran into the frame's edges. Each character's
// advance is measured once per font in the browser that renders the video (cached on disk), so laying out stays pure
// and fast: a width is a sum of known advances, plus the style's letter spacing.
import type { Theme } from "../core/types.ts";
import { measureMany } from "../kits/text-browser.ts";
import { estimate, type Measure } from "./layout.ts";

const CHARS = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), ..."—–−×÷±≤≥≠≈→←↑↓↔⇒•·°√π∑∞²³¹½¼¾€£¥✓✗…‘’“”éèêàáçñöüäß"];
type Key = "body" | "title" | "mono";

// What a measured font says about a character: its advance in ems, the widest of regular and bold, since words are
// drawn bold when lit and must still fit.
export type FontTable = Record<Key, Record<string, number>>;

export function fontTable(theme: Theme): FontTable {
  const fonts: Record<Key, string> = { body: theme.fonts.body, title: theme.fonts.title, mono: theme.fonts.mono ?? theme.style?.type.mono ?? "Menlo, monospace" };
  const weights = [400, theme.style?.type.bold ?? 700];
  const keys = Object.keys(fonts) as Key[];
  const requests = keys.flatMap((k) => weights.flatMap((weight) => CHARS.map((c) => ({ clusters: [c], font: fonts[k], weight }))));
  const measured = measureMany(requests);
  const out = { body: {}, title: {}, mono: {} } as FontTable;
  let i = 0;
  for (const k of keys) for (const _w of weights) for (const c of CHARS) out[k][c] = Math.max(out[k][c] ?? 0, measured[i++]!.edges[0] ?? 0);
  return out;
}

// A measure from a font table. Text drawn in capitals by the style is measured in capitals; a character the table
// does not have is estimated, scaled by how this font compares with the estimate.
export function tableMeasure(table: FontTable, theme: Theme): Measure {
  const type = theme.style?.type;
  const ratio = {} as Record<Key, number>;
  for (const k of Object.keys(table) as Key[]) {
    const sample = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const real = [...sample].reduce((s, c) => s + (table[k][c] ?? 0), 0);
    ratio[k] = real > 0 ? real / estimate(sample, 1) : 1;
  }
  return (text, size, font) => {
    const k: Key = font === "mono" ? "mono" : font === "title" ? "title" : "body";
    const shown = type?.case === "upper" ? text.toUpperCase() : text;
    const chars = [...shown];
    const width = chars.reduce((s, c) => s + (table[k][c] ?? estimate(c, 1) * ratio[k]), 0);
    return Math.max(0.3, width + (type?.tracking ?? 0) * Math.max(0, chars.length - 1)) * size;
  };
}

const known = new Map<string, Measure>();
// The measure for a theme's fonts, built once per set of fonts.
export function fontMeasure(theme: Theme): Measure {
  const key = JSON.stringify([theme.fonts, theme.style?.type]);
  return known.get(key) ?? known.set(key, tableMeasure(fontTable(theme), theme)).get(key)!;
}
