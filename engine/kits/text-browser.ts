// Real measurement. Widths come from the browser that renders the video, so what we plan is what appears. Results are
// cached on disk and baked into the scene at compile time, so frames stay pure and rendering never asks again.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Measured, MeasureRequest } from "../core/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(tmpdir(), "bettervid-measure-v1");
const EM = 1000; // measured this large, then divided, so rounding in the browser does not matter

function chromePath(): string {
  if (process.env.BETTERVID_CHROME) return process.env.BETTERVID_CHROME;
  const root = resolve(here, "../../node_modules/.remotion/chrome-headless-shell");
  const find = (dir: string): string | undefined => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.name === "chrome-headless-shell" && !e.isDirectory()) return path;
      if (e.isDirectory()) {
        const hit = find(path);
        if (hit) return hit;
      }
    }
  };
  const hit = existsSync(root) ? find(root) : undefined;
  if (!hit) throw new Error("no headless Chrome found: run a Remotion render once, or set BETTERVID_CHROME");
  return hit;
}

// Runs one page and returns what its `window.__result` resolved to.
export function runPage(html: string): unknown {
  const dir = mkdtempSync(join(tmpdir(), "bettervid-page-"));
  try {
    const page = join(dir, "page.html");
    writeFileSync(page, html);
    const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(here, "text-browser-worker.ts"), chromePath(), page], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"], timeout: 90000 });
    return JSON.parse(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Disk cache keyed by content, safe when several processes share it: each entry appears whole or not at all.
export function cached<T>(items: { key: string }[], work: (missing: number[]) => T[]): T[] {
  mkdirSync(CACHE, { recursive: true });
  const path = (key: string) => join(CACHE, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  const out: (T | undefined)[] = items.map((i) => (existsSync(path(i.key)) ? (JSON.parse(readFileSync(path(i.key), "utf8")) as T) : undefined));
  const missing = out.flatMap((v, i) => (v === undefined ? [i] : []));
  if (missing.length) {
    const made = work(missing);
    missing.forEach((m, n) => {
      out[m] = made[n];
      const temp = `${path(items[m]!.key)}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(made[n]));
      renameSync(temp, path(items[m]!.key));
    });
  }
  return out as T[];
}

// In the page: edges are the kerned width up to each cluster. A tiny letter spacing turns off ligatures, because every
// letter is drawn on its own and "fi" must stay two letters.
const measurePage = (requests: MeasureRequest[]) => `<!doctype html><meta charset="utf-8"><script>
const list = ${JSON.stringify(requests).replace(/</g, "\\u003c")};
const c = document.createElement("canvas").getContext("2d");
c.fontKerning = "normal";
c.letterSpacing = "0.01px";
window.__result = list.map((r) => {
  c.font = r.weight + " ${EM}px " + (/[,"']/.test(r.font) ? r.font : JSON.stringify(r.font));
  let s = "";
  const edges = r.clusters.map((k) => { s += k; return c.measureText(s).width / ${EM}; });
  const m = c.measureText("Hg");
  return { edges, ascent: m.fontBoundingBoxAscent / ${EM}, descent: m.fontBoundingBoxDescent / ${EM} };
});
</script>`;

const keyOf = (r: MeasureRequest) => JSON.stringify([r.font, r.weight, r.clusters]);

// Measure many at once. One browser start covers them all, so a scene can warm the cache before it compiles.
export function measureMany(requests: MeasureRequest[]): Measured[] {
  return cached<Measured>(requests.map((r) => ({ key: keyOf(r) })), (missing) => runPage(measurePage(missing.map((i) => requests[i]!))) as Measured[]);
}

const memory = new Map<string, Measured>();
export function measure(r: MeasureRequest): Measured {
  const key = keyOf(r);
  return memory.get(key) ?? memory.set(key, measureMany([r])[0]!).get(key)!;
}
