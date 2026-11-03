// One Remotion bundle per entry point and public dir per process, deleted when the process ends. A bundle is about
// 200 MB, so bundling per render or per case fills the disk fast.
//
// With `cache` (or BETTERVID_BUNDLE_CACHE), a bundle without a public dir is kept in that folder under a fingerprint
// of the sources it is built from (path, size and mtime of every source file in the repo), so later processes, such as
// the cases of a long bench run, reuse it. Only the newest bundle per entry is kept there; older ones are deleted.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const SOURCE = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".json", ".glsl", ".frag", ".vert"]);
const SKIP = new Set(["node_modules", "projects", ".claude", ".git", "bench", "research", "docs", "media", "renders", "out", ".venv"]);

const served = new Map<string, Promise<string>>();
const temporary = new Set<string>();
let hooked = false;

function cleanup() {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
  temporary.clear();
}

function hook() {
  if (hooked) return;
  hooked = true;
  process.on("exit", cleanup);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      cleanup();
      process.kill(process.pid, signal);
    });
  }
}

// The sources a bundle may be built from: every source file outside the skipped folders, plus bench/clip.tsx and the
// bench lib it may import.
function fingerprint(entryPoint: string): string {
  const h = createHash("sha256").update(entryPoint);
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith(".")) walk(p);
      } else if (SOURCE.has(extname(e.name))) {
        const s = statSync(p);
        h.update(`${p}\0${s.size}\0${s.mtimeMs}\n`);
      }
    }
  };
  walk(ROOT);
  const bench = join(ROOT, "bench");
  if (existsSync(bench)) for (const e of readdirSync(bench)) if (SOURCE.has(extname(e))) h.update(`${e}\0${statSync(join(bench, e)).mtimeMs}\n`);
  if (existsSync(join(bench, "lib"))) for (const e of readdirSync(join(bench, "lib"))) h.update(`${e}\0${statSync(join(bench, "lib", e)).mtimeMs}\n`);
  return h.digest("hex").slice(0, 16);
}

/** The serve URL (a folder) of the bundle for this entry point, bundling at most once per process. */
export function bundled(entryPoint: string, o: { publicDir?: string; cache?: string } = {}): Promise<string> {
  const entry = resolve(entryPoint);
  const publicDir = o.publicDir ? resolve(o.publicDir) : undefined;
  const key = `${entry}\0${publicDir ?? ""}`;
  const known = served.get(key);
  if (known) return known;
  const cache = publicDir ? undefined : (o.cache ?? process.env.BETTERVID_BUNDLE_CACHE);
  const made = (async () => {
    const { bundle } = await import("@remotion/bundler");
    if (cache) {
      const stem = basename(entry).replace(/\W+/g, "-");
      const outDir = join(resolve(cache), `${stem}-${fingerprint(entry)}`);
      if (existsSync(join(outDir, "index.html"))) return outDir;
      mkdirSync(resolve(cache), { recursive: true });
      for (const e of readdirSync(resolve(cache))) if (e.startsWith(`${stem}-`)) rmSync(join(resolve(cache), e), { recursive: true, force: true });
      hook();
      temporary.add(outDir); // until it is complete, so an interrupted bundle is not left half written
      try {
        await bundle({ entryPoint: entry, outDir });
      } catch (e) {
        rmSync(outDir, { recursive: true, force: true });
        throw e;
      } finally {
        temporary.delete(outDir);
      }
      return outDir;
    }
    hook();
    const url = await bundle({ entryPoint: entry, ...(publicDir ? { publicDir } : {}) });
    temporary.add(url);
    return url;
  })();
  made.catch(() => served.delete(key));
  served.set(key, made);
  return made;
}

/** Deletes this process's temporary bundles now (they are also deleted at exit). */
export async function releaseBundles(entryPoint?: string, publicDir?: string) {
  const keys = entryPoint ? [`${resolve(entryPoint)}\0${publicDir ? resolve(publicDir) : ""}`] : [...served.keys()];
  for (const key of keys) {
    const p = served.get(key);
    if (!p) continue;
    served.delete(key);
    const dir = await p.catch(() => undefined);
    if (dir && temporary.has(dir)) {
      rmSync(dir, { recursive: true, force: true });
      temporary.delete(dir);
    }
  }
}
