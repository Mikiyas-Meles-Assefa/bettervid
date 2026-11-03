// A PDF into text by page and its embedded pictures, with no dependency: objects are found by scanning the file (object
// streams included), pages by walking the page tree, and each page's content is run for its text, through the fonts'
// ToUnicode maps. What this cannot read is said in `problems`, by page; nothing is skipped silently. A scanned page has
// no text, but its picture goes to the picture reader like any other.
import { deflateSync, inflateSync } from "node:zlib";
import type { Extracted } from "./office.ts";

const MAX_INFLATED = 200 * 1024 * 1024;
// A picture under this many pixels across is a bullet, a rule or a tile of a texture, not something to show.
const MIN_PICTURE = 48;

type Obj = { dict: string; stream?: Buffer };
const REF = /(\d+)\s+\d+\s+R/;

function decodeStream(o: Obj): Buffer | undefined {
  let data = o.stream;
  if (!data) return undefined;
  const filters = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(o.dict)?.[1]?.match(/\/\w+/g) ?? [];
  for (const f of filters) {
    if (f === "/FlateDecode" || f === "/Fl") data = inflateLoose(data);
    else if (f === "/ASCII85Decode" || f === "/A85") data = ascii85(data);
    else return undefined;
  }
  const predictor = Number(/\/Predictor\s+(\d+)/.exec(o.dict)?.[1] ?? 1);
  const columns = Number(/\/Columns\s+(\d+)/.exec(o.dict)?.[1] ?? 1);
  return predictor >= 10 && !/\/Subtype\s*\/Image/.test(o.dict) ? unpredict(data, columns) : data;
}

function inflateLoose(b: Buffer): Buffer {
  return inflateSync(b, { maxOutputLength: MAX_INFLATED, finishFlush: 2 /* Z_SYNC_FLUSH: tolerate a missing end */ });
}

function ascii85(b: Buffer): Buffer {
  const s = b.toString("latin1").replace(/\s+/g, "").replace(/~>.*$/, "");
  const out: number[] = [];
  let group: number[] = [];
  const flush = (g: number[], keep: number) => {
    const v = g.reduce((a, c) => a * 85 + c, 0);
    for (let i = 0; i < keep; i++) out.push(Math.floor(v / 256 ** (3 - i)) % 256);
  };
  for (const ch of s) {
    if (ch === "z" && !group.length) out.push(0, 0, 0, 0);
    else if ((group.push(ch.charCodeAt(0) - 33), group.length === 5)) (flush(group, 4), (group = []));
  }
  if (group.length) flush([...group, ...Array(5 - group.length).fill(84)], group.length - 1);
  return Buffer.from(out);
}

function unpredict(b: Buffer, columns: number): Buffer {
  const out = Buffer.alloc(Math.floor(b.length / (columns + 1)) * columns);
  for (let r = 0; r * (columns + 1) < b.length - columns; r++) {
    const kind = b[r * (columns + 1)]!;
    for (let c = 0; c < columns; c++) {
      const raw = b[r * (columns + 1) + 1 + c]!;
      const up = r ? out[(r - 1) * columns + c]! : 0;
      out[r * columns + c] = (kind === 2 ? raw + up : raw) & 255;
    }
  }
  return out;
}

function parseObjects(b: Buffer): Map<number, Obj> {
  const objects = new Map<number, Obj>();
  const s = b.toString("latin1");
  const head = /(?:^|[\s>])(\d+)\s+\d+\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(s))) {
    const from = m.index + m[0].length;
    const ended = s.indexOf("endobj", from);
    const streamAt = s.indexOf("stream", from);
    if (streamAt >= 0 && (ended < 0 || streamAt < ended) && s[streamAt - 3] !== "e") {
      const dict = s.slice(from, streamAt);
      let start = streamAt + 6;
      if (s[start] === "\r") start++;
      if (s[start] === "\n") start++;
      const len = Number(/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)?.[1] ?? NaN);
      const stop = Number.isFinite(len) && s.startsWith("endstream", s.slice(start + len, start + len + 4).search(/\S/) + start + len) ? start + len : s.indexOf("endstream", start);
      if (stop < 0) continue;
      objects.set(Number(m[1]), { dict, stream: b.subarray(start, stop) });
      head.lastIndex = stop;
    } else objects.set(Number(m[1]), { dict: s.slice(from, ended < 0 ? undefined : ended) });
  }
  for (const o of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const data = decodeStream(o);
    if (!data) continue;
    const text = data.toString("latin1");
    const first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
    const nums = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) if (!objects.has(nums[i]!)) objects.set(nums[i]!, { dict: text.slice(first + nums[i + 1]!, nums[i + 3] === undefined ? undefined : first + nums[i + 3]!) });
  }
  return objects;
}

/** The balanced `<< >>` or `[ ]` value that follows a key. */
function valueOf(dict: string, key: string): string | undefined {
  const at = new RegExp(`/${key}(?![A-Za-z0-9])\\s*`).exec(dict);
  if (!at) return undefined;
  const i = at.index + at[0].length;
  const open = dict.startsWith("<<", i) ? "<<" : dict[i] === "[" ? "[" : "";
  if (!open) return /^(\d+\s+\d+\s+R|\/[^\s/<>\[\]]+|[-\d.]+|true|false)/.exec(dict.slice(i))?.[0];
  const close = open === "<<" ? ">>" : "]";
  let depth = 0;
  for (let k = i; k < dict.length; k++) {
    if (dict.startsWith(open, k)) depth++, (k += open.length - 1);
    else if (dict.startsWith(close, k) && --depth === 0) return dict.slice(i, k + close.length);
  }
  return undefined;
}

// A font's bytes to text: its ToUnicode map, or else its named encoding with that encoding's changes (/Differences).
type Font = { width: number; map?: Map<number, string>; charset?: string; changes?: Map<number, string> };
const GLYPHS: Record<string, string> = { space: " ", period: ".", comma: ",", hyphen: "-", colon: ":", semicolon: ";", exclam: "!", question: "?", parenleft: "(", parenright: ")", quotesingle: "'", quotedbl: '"', quoteright: "\u2019", quoteleft: "\u2018", quotedblright: "\u201D", quotedblleft: "\u201C", endash: "\u2013", emdash: "\u2014", bullet: "\u2022", slash: "/", ampersand: "&", percent: "%", dollar: "$", plus: "+", equal: "=", fi: "fi", fl: "fl", zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
const glyph = (name: string) => (name.length === 1 ? name : GLYPHS[name] ?? (/^uni[0-9A-Fa-f]{4}$/.test(name) ? String.fromCharCode(parseInt(name.slice(3), 16)) : "\uFFFD"));
function simpleEncoding(dict: string, objects: Map<number, Obj>): Pick<Font, "charset" | "changes"> {
  let e = valueOf(dict, "Encoding") ?? "";
  if (REF.test(e) && !e.startsWith("<<")) e = objects.get(Number(REF.exec(e)![1]))?.dict ?? "";
  const charset = /MacRomanEncoding/.test(e) ? "macintosh" : "windows-1252";
  const list = valueOf(e, "Differences");
  if (!list) return { charset };
  const changes = new Map<number, string>();
  let code = 0;
  for (const m of list.matchAll(/(\d+)|\/([^\s/\]]+)/g)) {
    if (m[1]) code = Number(m[1]);
    else changes.set(code++, glyph(m[2]!));
  }
  return { charset, changes };
}
function fontOf(dict: string, objects: Map<number, Obj>): Font {
  const ref = valueOf(dict, "ToUnicode");
  const cmap = ref && REF.exec(ref) ? objects.get(Number(REF.exec(ref)![1])) : undefined;
  const composite = /\/Subtype\s*\/Type0/.test(dict);
  const text = cmap && decodeStream(cmap)?.toString("latin1");
  if (!text) return composite ? { width: 2 } : { width: 1, ...simpleEncoding(dict, objects) };
  const map = new Map<number, string>();
  const utf = (hex: string) => {
    const b = Buffer.from(hex.replace(/\s/g, ""), "hex");
    return b.length % 2 === 0 ? Buffer.from(b).swap16().toString("utf16le") : "";
  };
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of blk[1]!.matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]*)>/g)) map.set(parseInt(m[1]!.replace(/\s/g, ""), 16), utf(m[2]!));
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const m of blk[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const [lo, hi] = [parseInt(m[1]!, 16), parseInt(m[2]!, 16)];
      if (hi - lo > 65535) continue;
      if (m[3]![0] === "[") [...m[3]!.matchAll(/<([0-9a-fA-F]+)>/g)].forEach((x, i) => map.set(lo + i, utf(x[1]!)));
      else {
        const base = m[3]!.slice(1, -1);
        const tail = parseInt(base.slice(-4), 16);
        for (let c = lo; c <= hi; c++) map.set(c, utf(base.slice(0, -4) + (tail + c - lo).toString(16).padStart(4, "0")));
      }
    }
  const space = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text)?.[1];
  return { width: space ? space.length / 2 : composite ? 2 : 1, map };
}

function decodeText(bytes: Buffer, f: Font | undefined): string {
  const font = f ?? { width: 1 };
  if (!font.map) {
    if (font.width !== 1) return "\uFFFD".repeat(Math.ceil(bytes.length / 2));
    const decoder = new TextDecoder(font.charset ?? "windows-1252");
    return [...bytes].map((c) => font.changes?.get(c) ?? decoder.decode(Uint8Array.of(c))).join("");
  }
  let out = "";
  for (let i = 0; i + font.width <= bytes.length; i += font.width) {
    const code = font.width === 1 ? bytes[i]! : bytes.readUInt16BE(i);
    out += font.map.get(code) ?? "�";
  }
  return out;
}

function literal(s: string): Buffer {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") {
      out.push(s.charCodeAt(i));
      continue;
    }
    const c = s[++i]!;
    const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
    if (c in esc) out.push(esc[c]!);
    else if (/[0-7]/.test(c)) {
      const oct = /^[0-7]{1,3}/.exec(s.slice(i))![0];
      out.push(parseInt(oct, 8) & 255);
      i += oct.length - 1;
    } else if (c !== "\n" && c !== "\r") out.push(c.charCodeAt(0));
  }
  return Buffer.from(out);
}

const hexBytes = (s: string) => {
  const h = s.replace(/\s/g, "");
  return Buffer.from(h.length % 2 ? `${h}0` : h, "hex");
};

// One string, a hex string, a name, a number, an array opener or an operator at a time.
const TOKEN = /\((?:[^()\\]|\\[\s\S]|\((?:[^()\\]|\\[\s\S]|\([^()]*\))*\))*\)|<[0-9a-fA-F\s]*>|\/[^\s/<>()[\]{}%]*|[-+]?\d*\.?\d+|[A-Za-z'"*][A-Za-z0-9'"*]*|\[|\]|<<|>>/g;

type Page = { text: string; pictures: { ext: string; bytes: Buffer }[]; problems: string[] };

function runContent(content: string, resources: string, objects: Map<number, Obj>, page: Page, seen: Set<number>, depth = 0) {
  const deref = (v: string | undefined) => (v && REF.test(v) && !v.startsWith("<<") ? objects.get(Number(REF.exec(v)![1]))?.dict : v);
  const fontsDict = deref(valueOf(resources, "Font")) ?? "";
  const fonts = new Map<string, Font>();
  for (const m of fontsDict.matchAll(/\/([^\s/<>]+)\s+(\d+)\s+\d+\s+R/g)) {
    const o = objects.get(Number(m[2]));
    if (o) fonts.set(m[1]!, fontOf(o.dict, objects));
  }
  const xobjects = deref(valueOf(resources, "XObject")) ?? "";
  let font: Font | undefined;
  let leading = 0;
  let y = NaN;
  const stack: string[] = [];
  let array: string[] | undefined;
  const say = (t: string) => void (page.text += t);
  const moveTo = (ny: number) => {
    if (!Number.isNaN(y) && Math.abs(ny - y) > 0.5 && !page.text.endsWith("\n")) say("\n");
    y = ny;
  };
  const stringOf = (tok: string) => decodeText(tok[0] === "(" ? literal(tok.slice(1, -1)) : hexBytes(tok.slice(1, -1)), font);
  // Inline images hold raw bytes that are not operators.
  const code = content.replace(/\bBI\b[\s\S]*?\bID\b[\s\S]*?\bEI\b/g, " ");
  for (const m of code.matchAll(TOKEN)) {
    const t = m[0];
    if (t === "[") array = [];
    else if (t === "]") {
      if (array) stack.push(`\0${array.join("\0")}`);
      array = undefined;
    } else if (array) array.push(t);
    else if (/^[(<\/\-+.\d]/.test(t) && t !== "<<") stack.push(t);
    else {
      const a = stack.splice(0);
      const n = (i: number) => Number(a.at(i) ?? 0);
      if (t === "Tf") font = fonts.get(a.at(-2)?.slice(1) ?? "");
      else if (t === "TL") leading = n(-1);
      else if (t === "Tm") moveTo(n(-1));
      else if (t === "Td") {
        if (n(-1)) moveTo((Number.isNaN(y) ? 0 : y) + n(-1));
      } else if (t === "TD") {
        leading = -n(-1);
        moveTo((Number.isNaN(y) ? 0 : y) + n(-1));
      } else if (t === "T*") moveTo((Number.isNaN(y) ? 0 : y) - (leading || 1));
      else if (t === "ET") say(page.text.endsWith("\n") || !page.text ? "" : " ");
      else if (t === "Tj" || t === "'" || t === '"') {
        if (t !== "Tj") moveTo((Number.isNaN(y) ? 0 : y) - (leading || 1));
        if (a.at(-1)) say(stringOf(a.at(-1)!));
      } else if (t === "TJ") {
        for (const x of (a.at(-1) ?? "").split("\0").filter(Boolean)) {
          if (x[0] === "(" || x[0] === "<") say(stringOf(x));
          // A gap of this many thousandths of the font size is where a space stands.
          else if (Number(x) < -180 && !page.text.endsWith(" ")) say(" ");
        }
      } else if (t === "Do") {
        const id = new RegExp(`/${(a.at(-1) ?? "").slice(1).replace(/[^\w.+-]/g, "\\$&")}\\s+(\\d+)\\s+\\d+\\s+R`).exec(xobjects)?.[1];
        const o = id ? objects.get(Number(id)) : undefined;
        if (!o || seen.has(Number(id))) continue;
        if (/\/Subtype\s*\/Image/.test(o.dict)) {
          seen.add(Number(id));
          picture(o, objects, page);
        } else if (/\/Subtype\s*\/Form/.test(o.dict) && depth < 4) {
          const inner = decodeStream(o);
          if (inner) runContent(inner.toString("latin1"), deref(valueOf(o.dict, "Resources")) ?? resources, objects, page, seen, depth + 1);
        }
      }
    }
  }
}

const chunk = (type: string, data: Buffer) => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
};
function crc32(b: Buffer): number {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
/** Raw rows of samples (or rows already PNG-filtered) as a PNG file. */
export function encodePng(w: number, h: number, colors: 1 | 3, data: Buffer, filtered: boolean): Buffer {
  const stride = w * colors;
  let rows = data;
  if (!filtered) {
    rows = Buffer.alloc((stride + 1) * h);
    for (let r = 0; r < h; r++) data.copy(rows, r * (stride + 1) + 1, r * stride, (r + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colors === 3 ? 2 : 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

function picture(o: Obj, objects: Map<number, Obj>, page: Page) {
  const w = Number(/\/Width\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
  const h = Number(/\/Height\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
  if (Math.min(w, h) < MIN_PICTURE) return;
  const filters = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(o.dict)?.[1]?.match(/\/\w+/g) ?? [];
  if (filters.at(-1) === "/DCTDecode" && filters.length === 1 && o.stream) return void page.pictures.push({ ext: "jpg", bytes: Buffer.from(o.stream) });
  let space = valueOf(o.dict, "ColorSpace") ?? "";
  if (REF.test(space) && !space.startsWith("[")) space = objects.get(Number(REF.exec(space)![1]))?.dict.trim() ?? "";
  const colors = /DeviceRGB|CalRGB/.test(space) || (/ICCBased/.test(space) && /\/N\s+3/.test(objects.get(Number(REF.exec(space)?.[1]))?.dict ?? "")) ? 3 : /DeviceGray|CalGray/.test(space) || (/ICCBased/.test(space) && /\/N\s+1/.test(objects.get(Number(REF.exec(space)?.[1]))?.dict ?? "")) ? 1 : 0;
  const bits = Number(/\/BitsPerComponent\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
  if ((filters.length && !filters.every((f) => f === "/FlateDecode" || f === "/Fl")) || !colors || bits !== 8) {
    page.problems.push(`a ${w} by ${h} picture is stored in a way that cannot be read yet (${[...filters, space.slice(0, 24)].join(" ") || "unknown"}), so it was not used`);
    return;
  }
  const data = decodeStream(o);
  if (!data) return;
  const filtered = Number(/\/Predictor\s+(\d+)/.exec(o.dict)?.[1] ?? 1) >= 10;
  if (data.length < (w * colors + (filtered ? 1 : 0)) * h) return void page.problems.push(`a ${w} by ${h} picture is damaged, so it was not used`);
  page.pictures.push({ ext: "png", bytes: encodePng(w, h, colors as 1 | 3, data, filtered) });
}

const readable = (s: string) => {
  const t = s.replace(/\s/g, "");
  return t.length ? (t.match(/[\p{L}\p{N}\p{P}\p{S}]/gu) ?? []).filter((c) => c !== "�").length / t.length : 0;
};

/** The pages of a PDF in reading order. Throws when it cannot be opened at all, with the reason in plain words. */
export function readPdf(b: Buffer): Extracted {
  if (b.subarray(0, 1024).indexOf("%PDF") < 0) throw new Error("it is not a PDF");
  const objects = parseObjects(b);
  if (/\/Encrypt\b/.test(b.subarray(Math.max(0, b.length - 4096)).toString("latin1")) || [...objects.values()].some((o) => /\/Type\s*\/XRef/.test(o.dict) && /\/Encrypt\b/.test(o.dict))) throw new Error("it is protected with a password or encrypted");
  const catalog = [...objects.values()].filter((o) => /\/Type\s*\/Catalog/.test(o.dict)).at(-1);
  const rootRef = catalog && valueOf(catalog.dict, "Pages");
  if (!rootRef) throw new Error("its page tree could not be found");
  const pages: { dict: string; resources: string }[] = [];
  const walk = (ref: string, inherited: string, trail: Set<number>) => {
    const id = Number(REF.exec(ref)?.[1]);
    const o = objects.get(id);
    if (!o || trail.has(id)) return;
    trail.add(id);
    const own = valueOf(o.dict, "Resources");
    const res = own ? (own.startsWith("<<") ? own : objects.get(Number(REF.exec(own)?.[1]))?.dict ?? inherited) : inherited;
    if (/\/Type\s*\/Pages/.test(o.dict) || (/\/Kids/.test(o.dict) && !/\/Type\s*\/Page\b/.test(o.dict))) {
      const kids = valueOf(o.dict, "Kids") ?? "";
      const list = kids.startsWith("[") ? kids : objects.get(Number(REF.exec(kids)?.[1]))?.dict ?? "";
      for (const k of list.matchAll(/\d+\s+\d+\s+R/g)) walk(k[0], res, trail);
    } else pages.push({ dict: o.dict, resources: res });
  };
  walk(rootRef, "", new Set());
  if (!pages.length) throw new Error("it has no pages");
  const out: Extracted = { sections: [], tables: [], images: [], problems: [] };
  const seen = new Set<number>();
  pages.forEach(({ dict, resources }, i) => {
    const where = `page ${i + 1}`;
    const page: Page = { text: "", pictures: [], problems: [] };
    const contents = valueOf(dict, "Contents") ?? "";
    const direct = contents.startsWith("[") ? contents : REF.test(contents) ? contents : "";
    let list = [...direct.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
    // The contents may be a reference to an array of references.
    if (list.length === 1 && !objects.get(list[0]!)?.stream) list = [...(objects.get(list[0]!)?.dict ?? "").matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
    const parts = list.map((id) => objects.get(id)).filter((o): o is Obj => !!o).map((o) => decodeStream(o));
    if (parts.some((x) => !x)) page.problems.push("part of this page is stored in a way that cannot be read yet");
    try {
      runContent(parts.filter(Boolean).map((x) => x!.toString("latin1")).join("\n"), resources, objects, page, seen);
    } catch (e) {
      page.problems.push(`this page could not be read: ${(e as Error).message}`);
    }
    const text = page.text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
    if (text && readable(text) < 0.7) page.problems.push("its text uses a font with no map to letters, so the text could not be read");
    else if (text) out.sections.push({ where, text });
    else if (!page.pictures.length && (parts.length || list.length) && !seen.size) page.problems.push("no text or picture could be read from it");
    for (const pic of page.pictures) out.images.push({ where, ...pic });
    for (const pr of page.problems) out.problems.push(`${where}: ${pr}`);
  });
  if (!out.sections.length && !out.images.length) throw new Error(out.problems[0] ? `nothing could be read from it (${out.problems[0]})` : "it has no text or pictures that can be read");
  return out;
}
