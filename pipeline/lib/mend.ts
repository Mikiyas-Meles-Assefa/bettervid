// Mechanical mends: slips a build names with exactly one fix, made in code before any model is asked. A misspelled word
// the build recognises ("Did you mean pulse?") is replaced when exactly one word of that line is that close to it; a code
// fence or curly quotes around the scene are taken off. Nothing about layout, motion or timing is touched: those notes
// go to the writer.
import type { Problem } from "../../engine/language/syntax.ts";

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row.push(Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[b.length]!;
}

/** The scene with its wrapping taken off: a code fence, curly quotes. */
export const unwrap = (s: string) => s.replace(/^\s*```[\w-]*\s*\n/, "").replace(/\n```\s*$/, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

/** One pass of mends over a built scene's problems. Returns the source and what was changed, in words. */
export function mend(source: string, problems: Problem[]): { source: string; fixed: string[] } {
  const lines = source.split("\n");
  const fixed: string[] = [];
  for (const p of problems) {
    const want = / Did you mean ([^\s?]+)\?/.exec(p.message)?.[1];
    if (!want || !p.line || !lines[p.line - 1]) continue;
    const line = lines[p.line - 1]!;
    // The words of the line, and the names and values of its settings, outside quotes.
    const bare = line.replace(/"[^"]*"/g, (q) => " ".repeat(q.length));
    const words = [...bare.matchAll(/[A-Za-z][\w-]*/g)].map((m) => ({ text: m[0], at: m.index! }));
    const near = words.filter((w) => w.text !== want && distance(w.text.toLowerCase(), want.toLowerCase()) <= 2);
    if (near.length !== 1) continue;
    const w = near[0]!;
    lines[p.line - 1] = line.slice(0, w.at) + want + line.slice(w.at + w.text.length);
    fixed.push(`line ${p.line}: ${w.text} -> ${want}`);
  }
  return { source: lines.join("\n"), fixed };
}
