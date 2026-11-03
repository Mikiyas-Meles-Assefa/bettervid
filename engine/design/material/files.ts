// One of the user's files, as the readers take it, and which reader it goes to. The reader is chosen by what the file
// is (its format), never by its name's words or its topic.
import { readFileSync } from "node:fs";

export type MaterialFile = {
  name: string; // the name the plan uses for it
  file: string; // the file's own name
  path?: string; // where it is on disk (pictures, and text not given inline)
  text?: string; // its text, for text files
  sections?: { where: string; text: string }[]; // a paged file's text by location (a page, a slide), when it has them
  size?: [number, number]; // a picture's width and height in pixels
  about?: string; // what the user said about it, if anything
  kind?: string; // what the user or the importer said it is (notes, doc, csv, code, image), as a hint
};

export type Format = "picture" | "table" | "code" | "text";

const PICTURE = /\.(png|jpe?g|webp|gif|bmp|tiff?|svg|heic|avif)$/i;
const TABLE = /\.(csv|tsv)$/i;
// Source file formats a code reader numbers line by line.
const CODE = /\.(py|js|mjs|cjs|ts|tsx|jsx|java|kt|kts|c|h|cc|cpp|hpp|cs|go|rs|rb|php|swift|m|mm|scala|sh|bash|zsh|ps1|sql|r|jl|lua|pl|hs|ml|ex|exs|erl|clj|dart|vue|svelte|html|css|scss|yaml|yml|toml|ini|json|xml|diff|patch)$/i;

export function formatOf(f: MaterialFile): Format {
  const hint = f.kind?.toLowerCase();
  if (hint === "image" || hint === "picture" || PICTURE.test(f.file)) return "picture";
  if (hint === "csv" || hint === "table" || TABLE.test(f.file)) return "table";
  if (hint === "code" || CODE.test(f.file)) return "code";
  return "text";
}

/** A picture's size in pixels from its header (PNG and JPEG), when the importer did not give it. */
export function pictureSize(path: string): [number, number] | undefined {
  const b = readFileSync(path);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return undefined;
      const marker = b[i + 1]!;
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  return undefined;
}
