// DOCX, PPTX and XLSX into what the readers take: text with its location (a slide, a sheet), tables as tables, embedded
// images as pictures. These formats are zips of XML with a small fixed shape, read here with no dependency.
import { posix } from "node:path";
import { readZip, type Zip } from "./zip.ts";

export type Extracted = {
  sections: { where: string; text: string }[];
  tables: { where: string; rows: string[][] }[];
  images: { where: string; ext: string; bytes: Buffer }[];
  problems: string[];
};

const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, c: string) => {
    const k = c.toLowerCase();
    if (k[0] === "#") return String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : Number(k.slice(1)));
    return ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" } as Record<string, string>)[k]!;
  });
const all = (s: string, re: RegExp) => [...s.matchAll(re)];
export const toCsv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n#]/.test(c) ? `"${c.replace(/"/g, '""').replace(/\s*\n\s*/g, " ")}"` : c)).join(",")).join("\n");

const PICTURE_EXT: Record<string, string> = { png: "png", jpg: "jpg", jpeg: "jpg", gif: "gif", webp: "webp" };
function addImage(out: Extracted, z: Zip, name: string, where: string) {
  const ext = PICTURE_EXT[posix.extname(name).slice(1).toLowerCase()];
  if (!z.has(name)) return;
  if (!ext) return void out.problems.push(`${where}: the embedded picture ${posix.basename(name)} is in a format that cannot be read yet, so it was not used`);
  out.images.push({ where, ext, bytes: z.bytes(name) });
}

// ---------------------------------------------------------------------------------------------------------------------
// DOCX

const wordRuns = (p: string) => all(p, /<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g).map((m) => (m[2] ? (m[2] === "tab" ? " " : "\n") : unescape(m[1]!))).join("");

export function readDocx(b: Buffer): Extracted {
  const z = readZip(b);
  const out: Extracted = { sections: [], tables: [], images: [], problems: [] };
  const lines: string[] = [];
  for (const m of all(z.text("word/document.xml"), /<w:tbl[ >][\s\S]*?<\/w:tbl>|<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g)) {
    const x = m[0];
    if (x.startsWith("<w:tbl")) {
      const rows = all(x, /<w:tr[ >][\s\S]*?<\/w:tr>/g).map((r) => all(r[0], /<w:tc[ >][\s\S]*?<\/w:tc>/g).map((c) => all(c[0], /<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g).map((p) => wordRuns(p[0])).join(" ").trim()));
      if (rows.length) out.tables.push({ where: `table ${out.tables.length + 1}`, rows });
      continue;
    }
    const t = wordRuns(x).trim();
    if (!t) {
      lines.push("");
      continue;
    }
    const heading = /<w:pStyle w:val="(?:Heading|Title)/i.test(x);
    lines.push(heading ? `\n# ${t}\n` : /<w:numPr>/.test(x) ? `- ${t}` : `${t}\n`);
  }
  out.sections.push({ where: "document", text: lines.join("\n") });
  for (const n of z.names.filter((n) => n.startsWith("word/media/")).sort()) addImage(out, z, n, "document");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// PPTX

const drawingText = (x: string) => all(x, /<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g).map((p) => all(p[0], /<a:t>([^<]*)<\/a:t>/g).map((t) => unescape(t[1]!)).join("").trim()).filter(Boolean);
const numbered = (names: string[], re: RegExp) => names.flatMap((n) => { const m = re.exec(n); return m ? [[Number(m[1]), n] as const] : []; }).sort((a, b) => a[0] - b[0]);

export function readPptx(b: Buffer): Extracted {
  const z = readZip(b);
  const out: Extracted = { sections: [], tables: [], images: [], problems: [] };
  const shown = new Map<string, string>();
  const slides = numbered(z.names, /^ppt\/slides\/slide(\d+)\.xml$/);
  if (!slides.length) throw new Error("it has no slides");
  for (const [n, name] of slides) {
    const where = `slide ${n}`;
    const xml = z.text(name);
    const lines: string[] = [];
    for (const f of all(xml, /<a:tbl>[\s\S]*?<\/a:tbl>/g)) {
      const rows = all(f[0], /<a:tr[ >][\s\S]*?<\/a:tr>/g).map((r) => all(r[0], /<a:tc[ >/][\s\S]*?<\/a:tc>/g).map((c) => drawingText(c[0]).join(" ")));
      if (rows.length) out.tables.push({ where: `${where} table`, rows });
    }
    for (const sp of all(xml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, ""), /<p:sp>[\s\S]*?<\/p:sp>/g)) {
      const text = drawingText(sp[0]);
      if (!text.length) continue;
      if (/<p:ph [^>]*type="(?:ctrT|t)itle"/i.test(sp[0])) lines.push(`# ${text.join(" ")}`, "");
      else lines.push(...text.map((t) => `- ${t}`));
    }
    out.sections.push({ where, text: lines.join("\n") });
    const rels = `ppt/slides/_rels/slide${n}.xml.rels`;
    if (!z.has(rels)) continue;
    for (const r of all(z.text(rels), /<Relationship\b[^>]*>/g)) {
      const target = /Target="([^"]+)"/.exec(r[0])?.[1];
      if (!target) continue;
      const path = posix.normalize(posix.join("ppt/slides", target));
      if (/relationships\/image"/.test(r[0]) && !shown.has(path)) {
        shown.set(path, where);
        addImage(out, z, path, where);
      }
      if (/relationships\/notesSlide"/.test(r[0]) && z.has(path)) {
        const notes = all(z.text(path), /<p:sp>[\s\S]*?<\/p:sp>/g).filter((s) => /<p:ph [^>]*type="body"/.test(s[0])).flatMap((s) => drawingText(s[0]));
        if (notes.length) out.sections.push({ where: `${where} speaker notes`, text: notes.join("\n") });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// XLSX

const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const column = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** Which cell styles show a number as a date. */
function dateStyles(z: Zip): Set<number> {
  const dates = new Set<number>();
  if (!z.has("xl/styles.xml")) return dates;
  const xml = z.text("xl/styles.xml");
  const custom = new Set(all(xml, /<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g).filter((m) => /[ymd]/i.test(m[2]!.replace(/\[[^\]]*\]|"[^"]*"/g, ""))).map((m) => Number(m[1])));
  const xfs = /<cellXfs[\s\S]*?<\/cellXfs>/.exec(xml)?.[0] ?? "";
  all(xfs, /<xf\b[^>]*>/g).forEach((m, i) => {
    const id = Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] ?? 0);
    if (DATE_FORMATS.has(id) || custom.has(id)) dates.add(i);
  });
  return dates;
}
const fromSerial = (n: number) => {
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString();
  return n % 1 ? d.slice(0, 16).replace("T", " ") : d.slice(0, 10);
};

export function readXlsx(b: Buffer): Extracted {
  const z = readZip(b);
  const out: Extracted = { sections: [], tables: [], images: [], problems: [] };
  const shared = z.has("xl/sharedStrings.xml") ? all(z.text("xl/sharedStrings.xml"), /<si>[\s\S]*?<\/si>|<si\/>/g).map((s) => all(s[0].replace(/<rPh[\s\S]*?<\/rPh>/g, ""), /<t(?: [^>]*)?>([^<]*)<\/t>/g).map((t) => unescape(t[1]!)).join("")) : [];
  const dates = dateStyles(z);
  const rels = new Map(all(z.text("xl/_rels/workbook.xml.rels"), /<Relationship\b[^>]*>/g).map((r) => [/Id="([^"]+)"/.exec(r[0])?.[1], /Target="([^"]+)"/.exec(r[0])?.[1]]));
  for (const s of all(z.text("xl/workbook.xml"), /<sheet\b[^>]*>/g)) {
    const title = unescape(/name="([^"]*)"/.exec(s[0])?.[1] ?? "sheet");
    const target = rels.get(/r:id="([^"]+)"/.exec(s[0])?.[1]);
    if (!target) {
      out.problems.push(`sheet "${title}": the workbook does not say where it is, so it was not read`);
      continue;
    }
    const path = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join("xl", target));
    const rows: string[][] = [];
    for (const r of all(z.text(path), /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)) {
      const row: string[] = [];
      for (const c of all(r[0], /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const body = c[2] ?? "";
        const t = /\bt="(\w+)"/.exec(attrs)?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1);
        let text = "";
        if (t === "inlineStr") text = all(body, /<t(?: [^>]*)?>([^<]*)<\/t>/g).map((x) => unescape(x[1]!)).join("");
        else if (t === "s") text = shared[Number(v)] ?? "";
        else if (t === "b") text = v === "1" ? "TRUE" : "FALSE";
        else if (v !== undefined) text = !t && dates.has(style) && Number.isFinite(Number(v)) ? fromSerial(Number(v)) : unescape(v);
        const at = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const i = at ? column(at) : row.length;
        while (row.length < i) row.push("");
        row[i] = text;
      }
      if (row.some((x) => x.trim())) rows.push(row);
    }
    if (rows.length) out.tables.push({ where: `sheet ${title}`, rows });
    else out.problems.push(`sheet "${title}" is empty`);
  }
  for (const n of z.names.filter((n) => n.startsWith("xl/media/")).sort()) addImage(out, z, n, "workbook");
  return out;
}
