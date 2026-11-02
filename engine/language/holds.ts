// Holds: silences the voice leaves where the direction wants the picture to work alone. A scene names a hold's start
// and end as moments (`@h2`, `@h2.end`, `@h2+10`, `@h2.end-5`), and they become plain word moments before anything
// else reads the scene, so every later step sees `@N+frames` as always. A hold is anchored on the word it follows, so
// its moments belong to that word's stretch of the video.
import { when } from "../core/compile.ts";
import type { CompileContext } from "../core/types.ts";
import type { Problem } from "./syntax.ts";

// A hold on the narration clock, as the voice records it: the silence begins when word `afterWord` ends.
export type HoldTime = { id: string; afterWord: number; start: number; seconds: number };
// Where a hold sits as moments: frames after the start of the word it follows.
export type HoldMoment = { id: string; word: number; start: number; end: number };

export function holdMoments(holds: HoldTime[] | undefined, ctx: CompileContext): Map<string, HoldMoment> {
  const out = new Map<string, HoldMoment>();
  for (const h of holds ?? []) {
    if (!ctx.words?.[h.afterWord]) continue;
    const base = when({ word: h.afterWord }, ctx);
    const start = Math.max(0, Math.round(h.start * ctx.fps) - base);
    out.set(h.id, { id: h.id, word: h.afterWord, start, end: start + Math.max(1, Math.round(h.seconds * ctx.fps)) });
  }
  return out;
}

const NAMED = /@([A-Za-z][\w]*)(\.start|\.end)?(?:([+-])(\d+))?(?![\w.])/g;

// One named moment as a word moment, or null when the name is not a hold.
export function holdTime(name: string, edge: string | undefined, sign: string | undefined, by: string | undefined, holds: Map<string, HoldMoment>): string | null {
  const h = holds.get(name);
  if (!h) return null;
  const offset = (edge === ".end" ? h.end : h.start) + (sign ? Number(`${sign}${by}`) : 0);
  return `@${h.word}${offset >= 0 ? "+" : ""}${offset}`;
}

// Rewrites every hold moment in a scene into a word moment, line for line, so line numbers stay the same. A name that is
// not a hold of this video is a problem that says which holds there are.
export function expandHolds(source: string, holds: Map<string, HoldMoment>): { source: string; problems: Problem[] } {
  const problems: Problem[] = [];
  const lines = source.split("\n").map((line, i) => {
    if (line.trim().startsWith("#") || !line.includes("@")) return line;
    // Inside quotes are words on screen, not moments.
    return line.split(/("[^"]*")/).map((piece) => (piece.startsWith('"') ? piece : piece.replace(NAMED, (whole, name: string, edge?: string, sign?: string, by?: string) => {
      const t = holdTime(name, edge, sign, by, holds);
      if (t !== null) return t;
      problems.push({ line: i + 1, message: `${whole} names a hold, but this video has no hold called ${name}.${holds.size ? ` Its holds: ${[...holds.keys()].join(", ")}.` : " It has no holds, so use word moments such as @12+5."} The line reads: ${line.trim().slice(0, 120)}` });
      return whole;
    }))).join("");
  });
  return { source: lines.join("\n"), problems };
}
