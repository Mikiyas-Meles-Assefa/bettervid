import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function hash(...parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

export async function write(path: string, data: string | Uint8Array): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return path;
}
