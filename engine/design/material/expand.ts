// One uploaded file on disk into the files the readers take. A paged document becomes its text by location, one table
// file per table and one picture per embedded image, each written to `out` under a name made here, never one from
// inside the file. Whatever cannot be read comes back in `problems`; a file that cannot be opened at all throws.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { formatOf, type MaterialFile } from "./files.ts";
import { readDocx, readPptx, readXlsx, toCsv, type Extracted } from "./office.ts";
import { readPdf } from "./pdf.ts";

const PAGED: Record<string, (b: Buffer) => Extracted> = { ".pdf": readPdf, ".docx": readDocx, ".pptx": readPptx, ".xlsx": readXlsx };
export const isPaged = (file: string) => extname(file).toLowerCase() in PAGED;

/** Text as written: UTF-8 or UTF-16 by its mark, or Latin-1 when it is not valid UTF-8 (older spreadsheets export that). */
export function decodeText(b: Buffer): string {
  if (b[0] === 0xff && b[1] === 0xfe) return b.toString("utf16le", 2);
  if (b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2, b.length - (b.length % 2))).swap16().toString("utf16le");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b).replace(/^﻿/, "");
  } catch {
    return b.toString("latin1");
  }
}

/** Opens a paged file to see that it can be read; throws why not. */
export function probe(file: string, b: Buffer): void {
  PAGED[extname(file).toLowerCase()]?.(b);
}

export function expand(f: { name: string; file: string; path: string }, out: string, limits = { pictures: 40 }): { files: MaterialFile[]; problems: string[] } {
  const bytes = readFileSync(f.path);
  const read = PAGED[extname(f.file).toLowerCase()];
  if (!read) {
    const one: MaterialFile = { name: f.name, file: f.file, path: f.path };
    if (formatOf(one) !== "picture") one.text = decodeText(bytes);
    return { files: [one], problems: [] };
  }
  const x = read(bytes);
  const files: MaterialFile[] = [];
  const problems = [...x.problems];
  if (x.sections.some((s) => s.text.trim())) files.push({ name: f.name, file: f.file, path: f.path, sections: x.sections.filter((s) => s.text.trim()), kind: "doc" });
  const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  x.tables.forEach((t, i) => {
    const name = `${f.name}.${slug(t.where)}${x.tables.filter((o) => o.where === t.where).length > 1 ? `-${i + 1}` : ""}.csv`;
    files.push({ name, file: name, text: toCsv(t.rows), about: `the table in ${f.file}, ${t.where}`, kind: "table" });
  });
  mkdirSync(out, { recursive: true });
  x.images.slice(0, limits.pictures).forEach((im, i) => {
    const name = `${f.name}.image-${i + 1}.${im.ext}`;
    const path = join(out, name);
    writeFileSync(path, im.bytes);
    files.push({ name, file: name, path, about: `a picture in ${f.file}, ${im.where}`, kind: "image" });
  });
  if (x.images.length > limits.pictures) problems.push(`it holds ${x.images.length} pictures; only the first ${limits.pictures} were read`);
  return { files, problems };
}
