// Reads a zip archive (DOCX, PPTX and XLSX are zips) with Node's own inflate. Entry names are only ever looked up, never
// used as paths on disk, and every entry and the archive's total have a limit, so a hostile file cannot fill memory.
import { inflateRawSync } from "node:zlib";

export const ZIP_LIMITS = { entry: 200 * 1024 * 1024, total: 600 * 1024 * 1024 };

export type Zip = { names: string[]; has(name: string): boolean; bytes(name: string): Buffer; text(name: string): string };

export function readZip(b: Buffer): Zip {
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--)
    if (b.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("it is not a complete zip archive");
  const count = b.readUInt16LE(end + 10);
  let at = b.readUInt32LE(end + 16);
  const entries = new Map<string, { method: number; packed: number; size: number; local: number }>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > b.length || b.readUInt32LE(at) !== 0x02014b50) throw new Error("its zip directory is damaged");
    const [nameLen, extra, comment] = [b.readUInt16LE(at + 28), b.readUInt16LE(at + 30), b.readUInt16LE(at + 32)];
    if (b.readUInt16LE(at + 8) & 1) throw new Error("it is protected with a password");
    entries.set(b.toString("utf8", at + 46, at + 46 + nameLen), { method: b.readUInt16LE(at + 10), packed: b.readUInt32LE(at + 20), size: b.readUInt32LE(at + 24), local: b.readUInt32LE(at + 42) });
    at += 46 + nameLen + extra + comment;
  }
  let total = 0;
  const bytes = (name: string) => {
    const e = entries.get(name);
    if (!e) throw new Error(`it has no ${name}`);
    if (e.local + 30 > b.length || b.readUInt32LE(e.local) !== 0x04034b50) throw new Error(`its entry ${name} is damaged`);
    if (e.size > ZIP_LIMITS.entry || (total += e.size) > ZIP_LIMITS.total) throw new Error("it unpacks to more than the size limit");
    const start = e.local + 30 + b.readUInt16LE(e.local + 26) + b.readUInt16LE(e.local + 28);
    const raw = b.subarray(start, start + e.packed);
    if (e.method === 0) return Buffer.from(raw);
    if (e.method === 8) return inflateRawSync(raw, { maxOutputLength: ZIP_LIMITS.entry });
    throw new Error(`its entry ${name} uses a compression this reader does not know`);
  };
  return { names: [...entries.keys()], has: (n) => entries.has(n), bytes, text: (n) => bytes(n).toString("utf8") };
}
