import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

// Node gives each address 250 ms to connect; IPv6 is unreachable here and Doha to api.meta.ai
// over IPv4 sometimes takes longer, which fails with ETIMEDOUT. Give it 2 s.
setDefaultAutoSelectFamilyAttemptTimeout(2000);

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env`);
  return v;
}

// Raw spike outputs go to media/ (gitignored); summaries go in research/spikes/*.md by hand.
export async function save(path: string, data: string | Uint8Array): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return path;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
