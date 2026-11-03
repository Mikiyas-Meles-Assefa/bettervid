import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { effortSetting } from "./timing.ts";

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}

// The Python that runs pipeline/tools (needs Pillow and numpy). Set PYTHON when the default python3 lacks them.
export const PYTHON = process.env.PYTHON ?? "python3";

export const sleep =(ms: number) => new Promise((r) => setTimeout(r, ms));

export function hash(...parts: unknown[]): string {
  // Explicit effort overrides also invalidate partial caches inside a resumed stage.
  const effort = effortSetting();
  if (effort) parts.push({ reasoningEffort: effort });
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

export async function write(path: string, data: string | Uint8Array): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return path;
}
