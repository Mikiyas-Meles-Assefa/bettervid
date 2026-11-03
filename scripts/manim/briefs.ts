// Test briefs. The first uses real recorded word times; the others have synthetic times (no voice budget), at speech pace.
import { readFileSync } from "node:fs";

export type Word = { text: string; start: number; end: number };
export type Brief = { id: string; context: string; words: Word[]; duration: number; real: boolean };

function paced(s: string): { words: Word[]; duration: number } {
  const words: Word[] = [];
  let t = 0.1;
  for (const text of s.split(/\s+/)) {
    const d = 0.13 + 0.055 * text.length;
    words.push({ text, start: +t.toFixed(3), end: +(t + d).toFixed(3) });
    t += d + (/[.,:;?!]$/.test(text) ? 0.4 : 0.03);
  }
  return { words, duration: +(t + 0.4).toFixed(2) };
}

export function cramerWords(): { words: Word[]; duration: number; from: number } {
  const p = JSON.parse(readFileSync("projects/teach-me-how-to-do-cramers-rule-i-know-t-76cad8/project.json", "utf8"));
  const all: Word[] = p.narration.words;
  const a = all.findIndex((w) => w.start >= 21.6);
  const b = all.findIndex((w) => w.text === "column." && w.start > 35);
  const from = all[a]!.start;
  const words = all.slice(a, b + 1).map((w) => ({ text: w.text, start: +(w.start - from).toFixed(3), end: +(w.end - from).toFixed(3) }));
  return { words, duration: +(words.at(-1)!.end + 0.5).toFixed(2), from };
}

export function briefs(): Brief[] {
  const c = cramerWords();
  return [
    { id: "matrix-column", context: "From a lesson on Cramer's rule for two linear equations in two unknowns. The coefficient matrix and its determinant D were introduced just before this section.", words: c.words, duration: c.duration, real: true },
    { id: "function-graph", context: "From a first lesson on derivatives.", ...paced("Here is the curve y equals x squared. Pick a point on it and draw the line that just touches the curve there. Slide the point to the right and the line gets steeper. At x equals one the slope is two, at x equals two the slope is four. The slope is always twice x, and that rule is the derivative."), real: false },
    { id: "pendulum-energy", context: "From a physics lesson on conservation of energy.", ...paced("Pull a pendulum to one side and hold it. All its energy is stored as height. Let go, and as it falls that height turns into speed. At the bottom it is moving fastest and the stored energy is gone. It rises on the far side, slows, and stops at the same height. Height and speed trade back and forth, and the total never changes."), real: false },
    { id: "quicksort-partition", context: "From a computer science lesson on sorting algorithms. The list is 5, 2, 8, 1, 9, 3.", ...paced("Quicksort starts by picking one value, the pivot. Say we pick the five. Every other value is compared with it. Smaller ones go to the left, larger ones go to the right. Now the five is in its final place and never moves again. The same trick then runs on the left group, and on the right group, until every group has one value."), real: false },
    { id: "pin-tumbler-lock", context: "From an explainer on how everyday things work: the pin tumbler door lock, seen in cross section.", ...paced("Inside a door lock, a row of spring loaded pins blocks the cylinder from turning. Each pin is cut in two at a different height. Push in the right key and its ridges lift every pin so that all the cuts line up with the edge of the cylinder. Nothing blocks it anymore, so the cylinder turns. A wrong key leaves some pin across the gap, and the lock stays shut."), real: false },
  ];
}
