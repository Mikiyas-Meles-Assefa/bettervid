// Readers that code can do exactly: a table (CSV or TSV) into data, a code file into numbered lines, a text document
// into headings, sentences, list items and quotes. Every part keeps its location in the file (line numbers), so a plan
// or a requirement can cite it and a check can find it again. No model is involved and nothing is guessed: what is not
// in the file is not in the card.
import type { ChartData, PartCard } from "../types.ts";
import type { MaterialFile } from "./files.ts";

type Parts = PartCard["parts"];
const card = (f: MaterialFile, kind: string, about: string, parts: Parts, extra: Partial<PartCard> = {}): PartCard => ({
  name: f.name,
  file: f.file,
  kind,
  about: f.about ? `${f.about} (${about})` : about,
  parts,
  text: f.text,
  requirements: [],
  checked: { ok: true, notes: ["read by code from the file itself"] },
  ...extra,
});

// ---------------------------------------------------------------------------------------------------------------------
// Tables

/** Splits one CSV line, keeping quoted cells whole. */
export function splitRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) out.push(cur.trim()), (cur = "");
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** A cell as a number, when it is one: thousands separators, a percent sign or a currency sign around it are allowed. */
export function numberOf(cell: string): number | undefined {
  const bare = cell.trim().replace(/^[^\d+\-.]+|[^\d.]+$/g, "");
  const s = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(bare) ? bare.replace(/,/g, "") : bare;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return undefined;
  return Number(s);
}

export type Table = { header: string[]; rows: { line: number; cells: string[] }[]; notes: { line: number; text: string }[] };

export function parseTable(text: string, sep?: string): Table {
  const lines = text.split(/\r?\n/);
  const first = lines.find((l) => l.trim() && !l.trim().startsWith("#")) ?? "";
  const s = sep ?? (first.includes("\t") ? "\t" : first.includes(";") && !first.includes(",") ? ";" : ",");
  const out: Table = { header: [], rows: [], notes: [] };
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    if (l.trim().startsWith("#")) return void out.notes.push({ line: i + 1, text: l.trim().replace(/^#\s*/, "") });
    const cells = splitRow(l, s);
    if (!out.header.length) out.header = cells;
    else out.rows.push({ line: i + 1, cells });
  });
  return out;
}

export function readTable(f: MaterialFile): PartCard {
  const t = parseTable(f.text ?? "");
  const parts: Parts = {};
  t.header.forEach((h, c) => (parts[`column.${c + 1}`] = { about: `column ${c + 1}, headed "${h}"`, text: h }));
  t.rows.forEach((r, k) => (parts[`row.${k + 1}`] = { about: `row ${k + 1} (line ${r.line})`, text: r.cells.join(", ") }));
  t.notes.forEach((n, k) => (parts[`note.${k + 1}`] = { about: `a note in the file (line ${n.line})`, text: n.text }));
  // The data a chart of it would show: the first column as labels and the first column of numbers as values. Other
  // numeric columns stay in the rows, where a plan can ask for them.
  const numeric = t.header.findIndex((_, c) => c > 0 && t.rows.length > 0 && t.rows.every((r) => numberOf(r.cells[c] ?? "") !== undefined));
  let data: ChartData | undefined;
  if (numeric > 0) data = { kind: "table", labels: t.rows.map((r) => r.cells[0] ?? ""), values: t.rows.map((r) => numberOf(r.cells[numeric]!)!), title: t.header[numeric], texts: Object.fromEntries(t.header.map((h, c) => [`column.${c + 1}`, h])) };
  return card(f, "table", `a table of ${t.rows.length} rows and ${t.header.length} columns: ${t.header.join(", ")}`, parts, data ? { data } : {});
}

// ---------------------------------------------------------------------------------------------------------------------
// Code

export function readCode(f: MaterialFile): PartCard {
  const lines = (f.text ?? "").split(/\r?\n/);
  const parts: Parts = {};
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    // A unified diff marks lines removed and added; the mark is the file's own, so it is read as such.
    const diff = /^[-+](?![-+])/.test(l) && lines.some((m) => /^[-+](?![-+])/.test(m) && m[0] !== l[0]) ? (l[0] === "+" ? ", added by the change" : ", removed by the change") : "";
    parts[`line.${i + 1}`] = { about: `line ${i + 1}${diff}`, text: l };
  });
  const numbered = lines.map((l, i) => `${String(i + 1).padStart(3)}  ${l}`).join("\n");
  return card(f, "code", `code, ${lines.length} lines`, parts, { text: numbered });
}

// ---------------------------------------------------------------------------------------------------------------------
// Text documents: headings, list items, sentences and quotes, each with its line.

const SENTENCE = /(?<=[.!?])["')\]]*\s+(?=["'(\[]?[\p{Lu}\p{N}])/u;
const QUOTE = /"([^"\n]{3,})"|“([^”\n]{3,})”/g;

export function readDoc(f: MaterialFile): PartCard {
  const lines = (f.text ?? "").split(/\r?\n/);
  const parts: Parts = {};
  const n = { heading: 0, item: 0, sentence: 0, quote: 0 };
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (!l) return;
    const at = `line ${i + 1}`;
    const md = l.match(/^(#{1,6})\s+(.*)$/);
    const underline = /^(=+|-+)$/.test(lines[i + 1]?.trim() ?? "") && (lines[i + 1]?.trim().length ?? 0) >= 3;
    // Plain text: a line that starts a block (first, or after a blank line), is not a list item and does not end as a
    // sentence does, while text follows it, is the block's heading.
    const opens = !lines[i - 1]?.trim() && !/[.!?;,"')\]]$/.test(l) && !/^([-*•]|\d+[.)])\s/.test(l) && lines.slice(i + 1).some((x) => x.trim());
    if (md || underline || opens) {
      parts[`heading.${++n.heading}`] = { about: `a heading (${at})`, text: md ? md[2]! : l };
      return;
    }
    if (/^(=+|-+)$/.test(l)) return;
    const item = l.match(/^([-*•]|\d+[.)])\s+(.*)$/);
    const body = item ? item[2]! : l;
    if (item) parts[`item.${++n.item}`] = { about: `a list item (${at})`, text: body };
    for (const s of body.split(SENTENCE).map((x) => x.trim()).filter(Boolean)) parts[`sentence.${++n.sentence}`] = { about: `a sentence (${at})`, text: s };
    for (const m of body.matchAll(QUOTE)) parts[`quote.${++n.quote}`] = { about: `a quoted passage (${at})`, text: m[1] ?? m[2]! };
  });
  const said = [n.heading && `${n.heading} headings`, n.item && `${n.item} list items`, `${n.sentence} sentences`, n.quote && `${n.quote} quotes`].filter(Boolean).join(", ");
  return card(f, "document", `a text document of ${lines.filter((l) => l.trim()).length} lines: ${said}`, parts);
}

/** A document with locations of its own (pages, slides): each section is read as a document, and every part says where
 * it stands, so a plan can cite "page 3". */
export function readSections(f: MaterialFile): PartCard {
  const parts: Parts = {};
  const secs = f.sections ?? [];
  for (const s of secs) {
    const key = s.where.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-");
    for (const [k, part] of Object.entries(readDoc({ ...f, text: s.text }).parts)) parts[`${key}.${k}`] = { ...part, about: part.about.replace(/\(line \d+\)/, `(${s.where})`) };
  }
  const text = secs.map((s) => `[${s.where}]\n${s.text}`).join("\n\n");
  return card({ ...f, text }, "document", `a document of ${secs.length} ${secs.length === 1 ? "section" : "sections"}, ${Object.keys(parts).length} parts`, parts);
}
