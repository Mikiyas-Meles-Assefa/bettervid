// The three path comparison clips (NEXT.md item 5): one stretch of an existing project, cut with its own voice, made
// into a short project per path, so every clip has the same words, timing, direction and style.
// Usage: node --env-file=.env --experimental-strip-types scripts/path-a-clips.ts <from project> <first word> <last word> <name>
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DemoPhase, DirectionEvent, Project } from "../schemas/project.ts";

const [from, a, b, name] = process.argv.slice(2);
const [first, last] = [Number(a), Number(b)];
const src: Project = JSON.parse(readFileSync(join("projects", from!, "project.json"), "utf8"));
const words = src.narration!.words;
// The cut starts where the word before ends and stops where the word after starts, so no word is clipped.
const t0 = first > 0 ? words[first - 1]!.end : 0;
const t1 = last + 1 < words.length ? words[last + 1]!.start : src.narration!.seconds;
const shift = (w: number) => w - first;
const inside = (w: number) => w >= first && w <= last;
const holds = (src.narration!.holds ?? []).filter((h) => inside(h.afterWord) && h.afterWord < last).map((h) => ({ ...h, afterWord: shift(h.afterWord), start: h.start - t0 }));
const at = (x: DemoPhase["at"]): DemoPhase["at"] | undefined => ("word" in x ? (inside(x.word) ? { word: shift(x.word) } : undefined) : holds.some((h) => h.id === x.hold) ? x : undefined);
const events: DirectionEvent[] = src.direction!.events.filter((e) => e.lastWord >= first && e.firstWord <= last).map((e) => {
  const hs = (e.holds ?? []).filter((h) => holds.some((x) => x.id === h.id)).map((h) => ({ ...h, afterWord: shift(h.afterWord) }));
  // A phase that started before the cut starts at the cut, playing only the steps whose words are inside it.
  const phases = (e.demo?.phases ?? []).map((ph) => ({ ...ph, at: at(ph.at) ?? { word: 0 }, ...(ph.until ? { until: at(ph.until) } : {}) })).map(({ until, ...ph }) => (until ? { ...ph, until } : ph));
  return { ...e, firstWord: Math.max(0, shift(e.firstWord)), lastWord: Math.min(last, e.lastWord) - first, holds: hs, ...(e.demo ? { demo: { ...e.demo, phases } } : {}), ...(e.reveal && !inside(e.reveal.word) ? { reveal: undefined } : e.reveal ? { reveal: { ...e.reveal, word: shift(e.reveal.word) } } : {}) };
});
const out = join("projects", name!);
mkdirSync(out, { recursive: true });
execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(t0), "-to", String(t1), "-i", join("projects", from!, src.narration!.audio), "-c:a", "libmp3lame", "-q:a", "2", join(out, "narration.mp3")]);
const p: Project = {
  ...src,
  id: name!,
  createdAt: new Date().toISOString(),
  stages: {},
  costs: [],
  narration: { ...src.narration!, audio: "narration.mp3", seconds: +(t1 - t0).toFixed(2), words: words.slice(first, last + 1).map((w) => ({ ...w, start: +(w.start - t0).toFixed(3), end: +(w.end - t0).toFixed(3) })), holds },
  direction: { ...src.direction!, events },
} as Project;
for (const k of ["scene", "timeline", "render", "critic", "shots", "assets"] as const) delete (p as Record<string, unknown>)[k];
writeFileSync(join(out, "project.json"), JSON.stringify(p, null, 1));
console.log(`${name}: words ${first} to ${last}, ${(t1 - t0).toFixed(2)} s, ${events.length} events, holds ${holds.map((h) => h.id).join(", ") || "none"}`);
console.log(events.map((e) => `${e.id} ${e.firstWord}-${e.lastWord} ${e.demo ? JSON.stringify(e.demo.phases.map((x) => [x.steps, x.pace, x.at])) : ""}`).join("\n"));
