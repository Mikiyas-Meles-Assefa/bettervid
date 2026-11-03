// The user's files on their way into a project: what may be uploaded, the safe name each is stored under, and the
// folder it goes in. Used by the web app while files wait for their project, and by `pipeline new --material`.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import { decodeText, probe } from "../../engine/design/material/index.ts";
import type { InputFile } from "../../schemas/project.ts";

const MB = 1024 * 1024;
// Public mode has no login, so it holds far less on disk per visitor than a person's own machine.
export const UPLOAD_LIMITS = {
  local: { file: 100 * MB, total: 400 * MB, files: 30, staged: Infinity },
  public: { file: 15 * MB, total: 40 * MB, files: 8, staged: 500 * MB },
};
export type UploadLimits = (typeof UPLOAD_LIMITS)["local"];
export const showSize = (n: number) => (n >= MB ? `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const NAME_MAX = 100;
/** The name a file is stored under: its own last path segment, with only letters, digits, dot, dash and underscore. */
export function safeName(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop()!.normalize("NFC");
  const clean = base.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/\.{2,}/g, ".").replace(/^[.-]+/, "").replace(/-+$/, "");
  const ext = extname(clean).slice(0, 12);
  const stem = (ext ? clean.slice(0, -extname(clean).length) : clean).slice(0, NAME_MAX - ext.length);
  return `${stem || "file"}${ext}`;
}

/** The name, changed only as far as needed not to replace a file already there. */
export function freeName(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let i = 2; ; i++) if (!taken(`${stem}-${i}${ext}`)) return `${stem}-${i}${ext}`;
}

/** A path inside a folder, or an error if a name would lead out of it. */
export function inside(folder: string, name: string): string {
  const root = resolve(folder);
  const path = resolve(root, name);
  if (!path.startsWith(root + sep)) throw new Error(`"${name}" is not a file name.`);
  return path;
}

const OLD_OFFICE: Record<string, string> = { ".doc": "DOCX", ".ppt": "PPTX", ".xls": "XLSX" };
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  ".png": (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47,
  ".jpg": (b) => b[0] === 0xff && b[1] === 0xd8,
  ".jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
  ".gif": (b) => b.subarray(0, 3).toString("latin1") === "GIF",
  ".webp": (b) => b.subarray(8, 12).toString("latin1") === "WEBP",
};
const PICTURE_ELSE = /\.(svg|bmp|tiff?|heic|avif)$/i;
const BINARY = /\.(zip|rar|7z|gz|tar|exe|dmg|mp4|mov|mp3|wav|m4a|webm|key|pages|numbers)$/i;

export function typeLabel(name: string): string {
  const e = extname(name).slice(1).toUpperCase();
  return e || "TEXT";
}

/** Why this file cannot be used, in words for the person who chose it, or undefined when it can. */
export async function uploadProblem(name: string, b: Buffer): Promise<string | undefined> {
  const ext = extname(name).toLowerCase();
  if (!b.length) return `${name} is empty.`;
  if (OLD_OFFICE[ext]) return `${name} is in the older ${ext.slice(1).toUpperCase()} format. Save it as ${OLD_OFFICE[ext]} and add it again.`;
  if (PICTURE_ELSE.test(name)) return `${name}: this picture format cannot be read yet. Use PNG, JPG, WEBP or GIF.`;
  if (BINARY.test(name)) return `${name}: this kind of file cannot be read. Use documents, slides, spreadsheets, text, code or pictures.`;
  if (MAGIC[ext]) return MAGIC[ext]!(b) ? undefined : `${name} does not look like a ${ext.slice(1).toUpperCase()} picture. It may be damaged or misnamed.`;
  if ([".pdf", ".docx", ".pptx", ".xlsx"].includes(ext)) {
    try {
      await probe(name, b);
      return undefined;
    } catch (e) {
      return `${name} could not be read: ${(e as Error).message}.`;
    }
  }
  // Everything else is read as text, so it has to be text.
  const utf16 = (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff);
  if (!utf16 && b.subarray(0, 8192).includes(0)) return `${name} is not a text file, and this kind of file cannot be read.`;
  if (!decodeText(b).trim()) return `${name} has no text in it.`;
  return undefined;
}

/** Why a file of this size may not join the ones already waiting, or undefined. */
export function sizeProblem(name: string, size: number, waiting: number[], limits: UploadLimits): string | undefined {
  if (size > limits.file) return `${name} is ${showSize(size)}. The limit is ${showSize(limits.file)} per file.`;
  if (waiting.length >= limits.files) return `That is more than ${limits.files} files. Remove one to add another.`;
  if (waiting.reduce((a, b) => a + b, 0) + size > limits.total) return `Adding ${name} goes over the ${showSize(limits.total)} limit for one video.`;
  return undefined;
}

export const materialDir = (projectDir: string) => join(projectDir, "material");

/** Checks the files in a folder and copies them into the project's material folder. Throws what is wrong with the first
 * file that cannot be used: nothing is dropped silently. */
export async function storeMaterial(from: string, projectDir: string, limits: UploadLimits = UPLOAD_LIMITS.local): Promise<InputFile[]> {
  const out = materialDir(projectDir);
  const names = statSync(from).isDirectory() ? readdirSync(from).filter((n) => !n.startsWith(".") && statSync(join(from, n)).isFile()).sort() : [basename(from)];
  const folder = statSync(from).isDirectory() ? from : resolve(from, "..");
  mkdirSync(out, { recursive: true });
  const files: InputFile[] = [];
  const sizes: number[] = [];
  for (const raw of names) {
    const name = freeName(safeName(raw), (n) => existsSync(join(out, n)));
    const src = join(folder, raw);
    const tooBig = sizeProblem(name, statSync(src).size, sizes, limits);
    if (tooBig) throw new Error(tooBig);
    const bytes = readFileSync(src);
    const problem = await uploadProblem(name, bytes);
    if (problem) throw new Error(problem);
    copyFileSync(src, inside(out, name));
    sizes.push(bytes.length);
    files.push({ name, type: typeLabel(name), size: bytes.length, hash: createHash("sha256").update(bytes).digest("hex").slice(0, 16) });
  }
  return files;
}
