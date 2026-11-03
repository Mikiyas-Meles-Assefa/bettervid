// Shared parts of the spike: render one scene with Manim, check it, and keep a spend ledger with a hard stop.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";


export const HERE = resolve("scripts/manim");
export const STYLE = (n: string) => resolve(`styles/${n}.json`);
const LEDGER = () => join(process.env.BV_OUT!, "spend.jsonl");
export const CAP = 1.0;

export function spent(): number {
  if (!existsSync(LEDGER())) return 0;
  return readFileSync(LEDGER(), "utf8").trim().split("\n").filter(Boolean).reduce((a, l) => a + JSON.parse(l).usd, 0);
}
export function charge(usd: number, what: string) {
  appendFileSync(LEDGER(), JSON.stringify({ usd, what, at: new Date().toISOString() }) + "\n");
}

// Static checks before anything runs. Generated code is untrusted, so only known modules may be imported.
export function lint(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
    const mod = (m[1] ?? m[2])!.split(".")[0]!;
    if (!["bv", "manim", "math", "random", "numpy", "itertools"].includes(mod)) out.push(`import of ${mod} is not allowed`);
  }
  if (/\b(open|exec|eval|__import__|compile)\s*\(/.test(code)) out.push("open, exec, eval, compile and __import__ are not allowed");
  const c = code.match(/\b(?:WHITE|BLACK|GRAY|GREY|BLUE|RED|GREEN|YELLOW|ORANGE|PURPLE|PINK|TEAL|GOLD|MAROON)(?:_[A-E])?\b|#[0-9a-fA-F]{6}\b/g);
  if (c) out.push(`hardcoded colors: ${[...new Set(c)].join(", ")}. Use INK, ACCENT, HIGHLIGHT, PAPER`);
  if (/\bfont\s*=\s*["']/.test(code)) out.push("hardcoded font name. Use the default, or FONT_TITLE");
  if (!/class\s+\w+\(\s*Clip\s*\)/.test(code)) out.push("no class extending Clip");
  return out;
}

export type Render = { ok: boolean; seconds: number; error: string; video: string; report: any };

// Runs Manim with a clean environment: no keys reach generated code.
export function render(sceneFile: string, wordsFile: string, style: string, dir: string, extra: string[] = [], timeout = 240_000): Render {
  mkdirSync(dir, { recursive: true });
  const report = join(dir, "report.json");
  const t0 = Date.now();
  const r = spawnSync("/opt/homebrew/bin/manim", ["render", "-r", "1080,1920", "--fps", "30", "--format", "mp4", "--media_dir", dir, "--disable_caching", "--progress_bar", "none", "-v", "ERROR", ...extra, "-o", "clip", sceneFile], {
    cwd: dir,
    timeout,
    encoding: "utf8",
    env: { PATH: `${HERE}/bin:/Library/TeX/texbin:/opt/homebrew/bin:/usr/bin:/bin`, HOME: process.env.HOME!, PYTHONPATH: HERE, BV_STYLE: STYLE(style), BV_WORDS: wordsFile, BV_REPORT: report, COLUMNS: "120" },
  });
  const seconds = (Date.now() - t0) / 1000;
  const found = spawnSync("find", [dir, "-name", "clip.*", "-not", "-path", "*/partial_movie_files/*"], { encoding: "utf8" }).stdout.trim().split("\n")[0] ?? "";
  const ok = r.status === 0 && !!found && existsSync(report);
  const error = ok ? "" : (r.error ? String(r.error) : (r.stderr + r.stdout)).replace(/[│╭╰╮╯─]/g, "").replace(/ +/g, " ").slice(-1800);
  return { ok, seconds, error, video: found, report: ok ? JSON.parse(readFileSync(report, "utf8")) : null };
}

// Problems a clean render can still have. These go back to Spark like crashes.
export function problems(report: any, lateLimit = 0.3): string[] {
  const out: string[] = [];
  const late = report.cues.filter((c: any) => c.late > lateLimit);
  if (late.length) out.push(`Cues landed late: ${late.map((c: any) => `word ${c.word} "${c.text}" by ${c.late} s`).join(", ")}.`);
  if (report.over > 0) out.push(`The scene ran ${report.over} s past DURATION.`);
  const seen = new Set<string>();
  for (const l of report.layout) {
    const k = `${l.kind}: ${l.what}`;
    if (!seen.has(k)) seen.add(k), out.push(`At word ${l.at_word}, ${l.kind.replace(/_/g, " ")}: ${l.what}.`);
  }
  return out.slice(0, 12);
}

export function code(reply: string): string {
  const m = /```(?:python)?\n([\s\S]*?)```/.exec(reply);
  return (m ? m[1]! : reply).trim() + "\n";
}

export function askFor(b: { context: string; duration: number; words: { text: string; start: number; end: number }[] }): string {
  const table = b.words.map((w, i) => `${i}\t${w.start.toFixed(2)}\t${w.end.toFixed(2)}\t${w.text}`).join("\n");
  return `Context: ${b.context}\n\nDuration: ${b.duration} s\n\nNarration, one word per line (index, start, end, word):\n${table}`;
}

export function writeWords(path: string, words: unknown, duration: number) {
  writeFileSync(path, JSON.stringify({ words, duration }));
}
